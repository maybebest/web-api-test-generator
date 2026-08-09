import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ENVIRONMENT_PREFLIGHT_STAGE,
  checkEnvironmentPreflight,
  checkPlaywrightConfigLoads,
  environmentPreflightEnabled,
  probeOriginReachability
} from '../lib/environment-preflight.mjs';

function tempWebRoot(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'environment-preflight-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeThrowingConfig(webRoot) {
  // Mirrors the load-time guard in the real playwright.config.ts without
  // needing node_modules inside the hermetic temporary web root.
  fs.writeFileSync(path.join(webRoot, 'playwright.config.ts'), [
    'const authEnabled = process.env.E2E_AUTH_ENABLED === "true";',
    'const externalBaseURL = process.env.PLAYWRIGHT_TEST_BASE_URL?.trim();',
    'if (authEnabled && !externalBaseURL) {',
    "  throw new Error('E2E_AUTH_ENABLED=true requires PLAYWRIGHT_TEST_BASE_URL for the external authenticated suite.');",
    '}',
    'export default { loaded: true as const };',
    ''
  ].join('\n'));
}

function startStubServer(t, handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      t.after(() => new Promise((done) => server.close(done)));
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function fakeResponse(status) {
  return { status, body: null };
}

test('environment preflight is enabled by default with an explicit false escape hatch', () => {
  assert.equal(environmentPreflightEnabled({}), true);
  assert.equal(environmentPreflightEnabled({ AI_ENV_PREFLIGHT: '' }), true);
  assert.equal(environmentPreflightEnabled({ AI_ENV_PREFLIGHT: 'true' }), true);
  assert.equal(environmentPreflightEnabled({ AI_ENV_PREFLIGHT: 'false' }), false);
  assert.equal(environmentPreflightEnabled({ AI_ENV_PREFLIGHT: '0' }), false);
  assert.equal(environmentPreflightEnabled({ AI_ENV_PREFLIGHT: 'no' }), false);
  assert.throws(() => environmentPreflightEnabled({ AI_ENV_PREFLIGHT: 'maybe' }), /AI_ENV_PREFLIGHT must be true or false/);
});

test('a Playwright config that throws under the sanitized environment fails the config-load check', (t) => {
  const webRoot = tempWebRoot(t);
  writeThrowingConfig(webRoot);
  const environment = { PATH: process.env.PATH, E2E_AUTH_ENABLED: 'true', AI_GATE_SANITIZED_ENV: 'true' };

  const failed = checkPlaywrightConfigLoads({ webRoot, env: environment });
  assert.equal(failed.passed, false);
  assert.match(failed.diagnostics.join(' '), /requires PLAYWRIGHT_TEST_BASE_URL/);

  const passed = checkPlaywrightConfigLoads({
    webRoot,
    env: { ...environment, PLAYWRIGHT_TEST_BASE_URL: 'https://qa.example.test' }
  });
  assert.equal(passed.passed, true);
  assert.deepEqual(passed.diagnostics, []);
});

test('a missing Playwright config fails the config-load check without spawning anything', (t) => {
  const webRoot = tempWebRoot(t);
  let spawned = 0;

  const result = checkPlaywrightConfigLoads({
    webRoot,
    env: { PATH: process.env.PATH },
    spawnSyncImpl: () => {
      spawned += 1;
      return { status: 0 };
    }
  });

  assert.equal(result.passed, false);
  assert.equal(spawned, 0);
  assert.match(result.diagnostics.join(' '), /playwright\.config\.ts/);
});

test('the config-load child runs plain when the runtime strips TypeScript natively', (t) => {
  const webRoot = tempWebRoot(t);
  writeThrowingConfig(webRoot);
  const spawnArgs = [];

  const result = checkPlaywrightConfigLoads({
    webRoot,
    env: { PATH: process.env.PATH },
    nodeFeatures: { typescript: 'strip' },
    nodeVersion: '22.6.0',
    spawnSyncImpl: (command, args) => {
      spawnArgs.push(args);
      return { status: 0 };
    }
  });

  assert.equal(result.passed, true);
  assert.equal(spawnArgs.length, 1);
  assert.equal(spawnArgs[0].includes('--experimental-strip-types'), false);
});

test('Node 22.18+ runs the config-load child plain even without the typescript feature', (t) => {
  const webRoot = tempWebRoot(t);
  writeThrowingConfig(webRoot);

  for (const nodeVersion of ['22.18.0', '24.1.0']) {
    const spawnArgs = [];
    const result = checkPlaywrightConfigLoads({
      webRoot,
      env: { PATH: process.env.PATH },
      nodeFeatures: { typescript: false },
      nodeVersion,
      spawnSyncImpl: (command, args) => {
        spawnArgs.push(args);
        return { status: 0 };
      }
    });
    assert.equal(result.passed, true, nodeVersion);
    assert.equal(spawnArgs.length, 1, nodeVersion);
    assert.equal(spawnArgs[0].includes('--experimental-strip-types'), false, nodeVersion);
  }
});

test('Node between 22.6 and 22.18 passes --experimental-strip-types to the config-load child', (t) => {
  const webRoot = tempWebRoot(t);
  writeThrowingConfig(webRoot);

  for (const nodeVersion of ['22.6.0', '22.17.1']) {
    const spawnArgs = [];
    const result = checkPlaywrightConfigLoads({
      webRoot,
      env: { PATH: process.env.PATH },
      nodeFeatures: { typescript: false },
      nodeVersion,
      spawnSyncImpl: (command, args) => {
        spawnArgs.push(args);
        return { status: 0 };
      }
    });
    assert.equal(result.passed, true, nodeVersion);
    assert.equal(spawnArgs.length, 1, nodeVersion);
    assert.equal(spawnArgs[0].includes('--experimental-strip-types'), true, nodeVersion);
  }
});

test('a runtime that cannot strip TypeScript skips the config-load check with a diagnostic', (t) => {
  const webRoot = tempWebRoot(t);
  writeThrowingConfig(webRoot);
  let spawned = 0;

  const result = checkPlaywrightConfigLoads({
    webRoot,
    env: { PATH: process.env.PATH },
    nodeFeatures: { typescript: false },
    nodeVersion: '20.19.0',
    spawnSyncImpl: () => {
      spawned += 1;
      return { status: 1, stderr: 'must not run' };
    }
  });

  assert.equal(result.passed, true);
  assert.equal(spawned, 0);
  assert.match(result.diagnostics.join(' '), /skipped/i);
});

test('a skipped config-load check still probes the external origin', async (t) => {
  const webRoot = tempWebRoot(t);
  writeThrowingConfig(webRoot);
  const probedUrls = [];

  const result = await checkEnvironmentPreflight({
    projects: [{ project: 'chromium', env: {} }],
    env: { PATH: process.env.PATH, PLAYWRIGHT_TEST_BASE_URL: 'https://qa.example.test' },
    webRoot,
    nodeFeatures: { typescript: false },
    nodeVersion: '20.19.0',
    spawnSyncImpl: () => assert.fail('a runtime without type stripping must not spawn the config-load child'),
    fetchImpl: async (url) => {
      probedUrls.push(String(url));
      return fakeResponse(200);
    }
  });

  assert.equal(result.passed, true);
  assert.deepEqual(probedUrls, ['https://qa.example.test']);
  assert.match(result.diagnostics.join(' '), /skipped/i);
});

test('config-load diagnostics keep the front of the child stderr where the message lives', (t) => {
  const webRoot = tempWebRoot(t);
  writeThrowingConfig(webRoot);

  const result = checkPlaywrightConfigLoads({
    webRoot,
    env: { PATH: process.env.PATH },
    spawnSyncImpl: () => ({
      status: 1,
      stderr: `Error: E2E_AUTH_ENABLED=true requires PLAYWRIGHT_TEST_BASE_URL\n${'stack frame line\n'.repeat(80)}`
    })
  });

  assert.equal(result.passed, false);
  assert.match(result.diagnostics.join(' '), /requires PLAYWRIGHT_TEST_BASE_URL/);
});

test('config-load diagnostics redact known secret values from the child stderr', (t) => {
  const webRoot = tempWebRoot(t);
  writeThrowingConfig(webRoot);

  const result = checkPlaywrightConfigLoads({
    webRoot,
    env: { PATH: process.env.PATH, E2E_USER_PASSWORD: 'hunter2secret' },
    spawnSyncImpl: () => ({
      status: 1,
      stderr: 'Error: login failed for hunter2secret against the gate origin'
    })
  });

  assert.equal(result.passed, false);
  const joined = result.diagnostics.join(' ');
  assert.doesNotMatch(joined, /hunter2secret/);
  assert.match(joined, /<redacted>/);
});

test('a config-load child that cannot start fails closed with its error message', (t) => {
  const webRoot = tempWebRoot(t);
  writeThrowingConfig(webRoot);

  const result = checkPlaywrightConfigLoads({
    webRoot,
    env: {},
    spawnSyncImpl: () => ({ error: new Error('spawn ENOENT'), status: null })
  });

  assert.equal(result.passed, false);
  assert.match(result.diagnostics.join(' '), /spawn ENOENT/);
});

test('an HTTP response to HEAD proves the origin reachable with one request', async (t) => {
  const seen = [];
  const { origin } = await startStubServer(t, (request, response) => {
    seen.push(request.method);
    response.statusCode = 204;
    response.end();
  });

  const result = await probeOriginReachability(origin, { timeoutMs: 2000, retryDelayMs: 5 });
  assert.equal(result.reachable, true);
  assert.equal(result.httpStatus, 204);
  assert.equal(result.method, 'HEAD');
  assert.deepEqual(seen, ['HEAD']);
});

test('4xx and 5xx responses still count as a reachable origin', async (t) => {
  for (const status of [401, 503]) {
    const { origin } = await startStubServer(t, (request, response) => {
      response.statusCode = status;
      response.end();
    });
    const result = await probeOriginReachability(origin, { timeoutMs: 2000, retryDelayMs: 5 });
    assert.equal(result.reachable, true, `status ${status}`);
    assert.equal(result.httpStatus, status, `status ${status}`);
  }
});

test('a HEAD transport failure falls back to GET before any retry', async (t) => {
  const seen = [];
  const { origin } = await startStubServer(t, (request, response) => {
    seen.push(request.method);
    if (request.method === 'HEAD') {
      request.socket.destroy();
      return;
    }
    response.statusCode = 404;
    response.end('missing');
  });

  const result = await probeOriginReachability(origin, { timeoutMs: 2000, retryDelayMs: 5 });
  assert.equal(result.reachable, true);
  assert.equal(result.httpStatus, 404);
  assert.equal(result.method, 'GET');
  assert.deepEqual(seen, ['HEAD', 'GET']);
});

test('transport failures retry the HEAD/GET cycle exactly once after the configured delay', async () => {
  const calls = [];
  const sleeps = [];

  const result = await probeOriginReachability('https://qa.example.test', {
    timeoutMs: 50,
    retryDelayMs: 2000,
    fetchImpl: async (url, options) => {
      calls.push([url, options.method]);
      throw new TypeError('fetch failed');
    },
    sleep: async (ms) => { sleeps.push(ms); }
  });

  assert.equal(result.reachable, false);
  assert.deepEqual(calls.map(([, method]) => method), ['HEAD', 'GET', 'HEAD', 'GET']);
  assert.deepEqual(sleeps, [2000]);
  assert.match(result.diagnostics.join(' '), /fetch failed/);
});

test('an origin that answers only on the retry is reachable', async () => {
  let attempts = 0;

  const result = await probeOriginReachability('https://qa.example.test', {
    timeoutMs: 50,
    retryDelayMs: 1,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts <= 2) throw new TypeError('fetch failed');
      return fakeResponse(200);
    },
    sleep: async () => {}
  });

  assert.equal(result.reachable, true);
  assert.equal(result.httpStatus, 200);
  assert.equal(attempts, 3);
});

test('an unresponsive origin times out and stays unreachable', async (t) => {
  const { origin } = await startStubServer(t, () => {
    // Accept the connection and never answer.
  });

  const result = await probeOriginReachability(origin, { timeoutMs: 100, retryDelayMs: 5 });
  assert.equal(result.reachable, false);
  assert.ok(result.diagnostics.length > 0);
});

test('a connection-refused origin is unreachable after the single retry', async (t) => {
  const closed = await startStubServer(t, () => {});
  const { origin } = closed;
  await new Promise((resolve) => closed.server.close(resolve));

  const result = await probeOriginReachability(origin, { timeoutMs: 1000, retryDelayMs: 5 });
  assert.equal(result.reachable, false);
  assert.ok(result.diagnostics.length > 0);
});

test('the orchestrated check fails on config load before probing any origin', async (t) => {
  const webRoot = tempWebRoot(t);
  writeThrowingConfig(webRoot);
  let probed = 0;

  const result = await checkEnvironmentPreflight({
    projects: [{ project: 'chromium', env: {} }],
    env: { PATH: process.env.PATH, E2E_AUTH_ENABLED: 'true', PLAYWRIGHT_TEST_BASE_URL: 'https://qa.example.test' },
    webRoot,
    spawnSyncImpl: () => ({ status: 1, stderr: 'Error: config refused to load' }),
    fetchImpl: async () => {
      probed += 1;
      return fakeResponse(200);
    }
  });

  assert.equal(result.passed, false);
  assert.equal(probed, 0);
  assert.match(result.diagnostics.join(' '), /config refused to load/);
});

test('a local-fixture-only project plan never probes an external origin', async (t) => {
  const webRoot = tempWebRoot(t);
  writeThrowingConfig(webRoot);
  let probed = 0;

  const result = await checkEnvironmentPreflight({
    projects: [{ project: 'local-chromium', env: {} }],
    env: { PATH: process.env.PATH },
    webRoot,
    spawnSyncImpl: () => ({ status: 0 }),
    fetchImpl: async () => {
      probed += 1;
      return fakeResponse(200);
    }
  });

  assert.equal(result.passed, true);
  assert.equal(result.probedOrigin, null);
  assert.equal(probed, 0);
});

test('an external project plan probes exactly the origin of the gate base URL', async (t) => {
  const webRoot = tempWebRoot(t);
  writeThrowingConfig(webRoot);
  const probedUrls = [];

  const result = await checkEnvironmentPreflight({
    projects: [{ project: 'chromium', env: {} }],
    env: { PATH: process.env.PATH, PLAYWRIGHT_TEST_BASE_URL: 'https://qa.example.test/app' },
    webRoot,
    spawnSyncImpl: () => ({ status: 0 }),
    fetchImpl: async (url) => {
      probedUrls.push(String(url));
      return fakeResponse(200);
    }
  });

  assert.equal(result.passed, true);
  assert.equal(result.probedOrigin, 'https://qa.example.test');
  assert.deepEqual(probedUrls, ['https://qa.example.test']);
});

test('an unreachable external origin fails the orchestrated check with its probe diagnostics', async (t) => {
  const webRoot = tempWebRoot(t);
  writeThrowingConfig(webRoot);

  const result = await checkEnvironmentPreflight({
    projects: [{ project: 'chromium-auth', env: {} }],
    env: { PATH: process.env.PATH, PLAYWRIGHT_TEST_BASE_URL: 'https://qa.example.test' },
    webRoot,
    spawnSyncImpl: () => ({ status: 0 }),
    fetchImpl: async () => { throw new TypeError('fetch failed'); },
    retryDelayMs: 1
  });

  assert.equal(result.passed, false);
  assert.equal(result.probedOrigin, 'https://qa.example.test');
  assert.match(result.diagnostics.join(' '), /fetch failed/);
});

test('an external project plan without a usable base URL fails the orchestrated check', async (t) => {
  const webRoot = tempWebRoot(t);
  writeThrowingConfig(webRoot);

  for (const value of [undefined, '   ', 'not a url']) {
    const result = await checkEnvironmentPreflight({
      projects: [{ project: 'firefox', env: {} }],
      env: { PATH: process.env.PATH, ...(value === undefined ? {} : { PLAYWRIGHT_TEST_BASE_URL: value }) },
      webRoot,
      spawnSyncImpl: () => ({ status: 0 }),
      fetchImpl: async () => fakeResponse(200)
    });
    assert.equal(result.passed, false, JSON.stringify(value));
    assert.match(result.diagnostics.join(' '), /PLAYWRIGHT_TEST_BASE_URL/, JSON.stringify(value));
  }
});

test('the stage name constant matches the recorded telemetry stage', () => {
  assert.equal(ENVIRONMENT_PREFLIGHT_STAGE, 'environment-preflight');
});
