import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkGenerationReadiness, isRegularExecutableFile } from '../lib/generation-preflight.mjs';

function authenticatedValidation() {
  return {
    valid: true,
    metadata: {
      'Test Type': 'regression',
      Auth: 'required',
      'Target Test File': 'tests/regression/checkout.authenticated.spec.ts'
    }
  };
}

function completeLoginEnv() {
  return {
    E2E_AUTH_ENABLED: 'true',
    PLAYWRIGHT_TEST_BASE_URL: 'https://qa.example.test',
    E2E_USER_EMAIL: 'qa-user@example.test',
    E2E_USER_PASSWORD: 'not-a-secret-fixture',
    E2E_AUTH_SUCCESS_SELECTOR: '[data-testid="signed-in"]'
  };
}

test('authenticated readiness rejects a missing Chromium executable before generation', () => {
  const readiness = checkGenerationReadiness({
    validation: authenticatedValidation(),
    env: completeLoginEnv(),
    webRoot: process.cwd(),
    browserExecutableExists: () => false
  });

  assert.equal(readiness.passed, false);
  assert.deepEqual(readiness.projects.map(({ project }) => project), ['chromium-auth']);
  assert.deepEqual(readiness.diagnostics, ['Chromium executable is not installed or is not a regular executable file.']);
});

test('authenticated readiness uses the supplied environment instead of ambient auth enablement', () => {
  const originalEnabled = process.env.E2E_AUTH_ENABLED;
  process.env.E2E_AUTH_ENABLED = 'true';
  try {
    const readiness = checkGenerationReadiness({
      validation: authenticatedValidation(),
      env: {
        E2E_USER_EMAIL: 'qa-user@example.test',
        E2E_USER_PASSWORD: 'not-a-secret-fixture',
        E2E_AUTH_SUCCESS_SELECTOR: '[data-testid="signed-in"]'
      },
      webRoot: process.cwd(),
      browserExecutableExists: () => true
    });

    assert.equal(readiness.passed, false);
    assert.deepEqual(readiness.diagnostics, [
      'Spec requires auth, but E2E_AUTH_ENABLED is not true. Enable auth and configure chromium-auth.'
    ]);
  } finally {
    if (originalEnabled === undefined) delete process.env.E2E_AUTH_ENABLED;
    else process.env.E2E_AUTH_ENABLED = originalEnabled;
  }
});

test('external browser projects require an explicit non-production base URL while local Chromium does not', () => {
  const { PLAYWRIGHT_TEST_BASE_URL: _baseUrl, ...missingBaseUrl } = completeLoginEnv();
  const external = checkGenerationReadiness({
    validation: authenticatedValidation(),
    env: missingBaseUrl,
    webRoot: process.cwd(),
    browserExecutableExists: () => true
  });
  assert.equal(external.passed, false);
  assert.deepEqual(external.diagnostics, [
    'PLAYWRIGHT_TEST_BASE_URL is required for selected external browser projects.'
  ]);

  const local = checkGenerationReadiness({
    validation: {
      valid: true,
      metadata: {
        'Test Type': 'smoke',
        Auth: 'none',
        'Target Test File': 'tests/smoke/local-flow.spec.ts'
      }
    },
    env: {},
    webRoot: process.cwd(),
    browserExecutableExists: () => true
  });
  assert.equal(local.passed, true);
  assert.deepEqual(local.projects, [{ project: 'local-chromium', env: {} }]);
});

test('external browser readiness rejects targets that authenticated Playwright configuration would refuse', () => {
  const rejected = [
    ['http://qa.example.test', '', /requires HTTPS/],
    ['https://user:pass@qa.example.test', '', /requires HTTPS/],
    ['https://qa.example.test:8443', '', /requires HTTPS/],
    ['https://qa.example.test?token=value', '', /requires HTTPS/],
    ['https://qa.example.test/#fragment', '', /requires HTTPS/],
    ['https://www.example.com', '', /unclassified host/],
    ['https://qa.example.test', '*.example.test', /hostnames only/]
  ];

  for (const [baseUrl, allowedHosts, expected] of rejected) {
    const readiness = checkGenerationReadiness({
      validation: authenticatedValidation(),
      env: {
        ...completeLoginEnv(),
        PLAYWRIGHT_TEST_BASE_URL: baseUrl,
        E2E_AUTH_ALLOWED_HOSTS: allowedHosts
      },
      webRoot: process.cwd(),
      browserExecutableExists: () => true
    });
    assert.equal(readiness.passed, false, baseUrl);
    assert.match(readiness.diagnostics.join('\n'), expected, baseUrl);
  }

  const reviewedHost = checkGenerationReadiness({
    validation: authenticatedValidation(),
    env: {
      ...completeLoginEnv(),
      PLAYWRIGHT_TEST_BASE_URL: 'https://reviewed.example',
      E2E_AUTH_ALLOWED_HOSTS: 'reviewed.example'
    },
    webRoot: process.cwd(),
    browserExecutableExists: () => true
  });
  assert.equal(reviewedHost.passed, true, reviewedHost.diagnostics.join('\n'));
});

test('browser executable readiness accepts only executable regular files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'generation-preflight-executable-'));
  const executablePath = path.join(directory, 'chromium');
  const symlinkPath = path.join(directory, 'chromium-link');
  fs.writeFileSync(executablePath, '#!/bin/sh\n');
  fs.chmodSync(executablePath, 0o700);
  fs.symlinkSync(executablePath, symlinkPath);

  assert.equal(isRegularExecutableFile(executablePath), true);
  assert.equal(isRegularExecutableFile(symlinkPath), false);
  fs.chmodSync(executablePath, 0o600);
  assert.equal(isRegularExecutableFile(executablePath), false);
});

test('authenticated readiness requires a configured reusable state file that is regular and not a symlink', () => {
  const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'generation-preflight-'));
  const statePath = path.join(webRoot, 'playwright', '.auth', 'user.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });

  const missing = checkGenerationReadiness({
    validation: authenticatedValidation(),
    env: { ...completeLoginEnv(), E2E_AUTH_REUSE_STATE: 'true', E2E_AUTH_STATE_PATH: statePath },
    webRoot,
    browserExecutableExists: () => true
  });
  assert.equal(missing.passed, false);
  assert.deepEqual(missing.diagnostics, ['E2E_AUTH_STATE_PATH must point to an existing regular non-symlink file when E2E_AUTH_REUSE_STATE=true.']);

  fs.writeFileSync(statePath, '{}\n');
  const outsidePath = path.join(webRoot, 'outside.json');
  fs.writeFileSync(outsidePath, '{}\n');
  fs.rmSync(statePath);
  fs.symlinkSync(outsidePath, statePath);
  const symlink = checkGenerationReadiness({
    validation: authenticatedValidation(),
    env: { ...completeLoginEnv(), E2E_AUTH_REUSE_STATE: 'true', E2E_AUTH_STATE_PATH: statePath },
    webRoot,
    browserExecutableExists: () => true
  });
  assert.equal(symlink.passed, false);
  assert.deepEqual(symlink.diagnostics, ['E2E_AUTH_STATE_PATH must point to an existing regular non-symlink file when E2E_AUTH_REUSE_STATE=true.']);
});

test('authenticated readiness requires credentials and an authentication success signal when it cannot reuse state', () => {
  const missingCredentials = checkGenerationReadiness({
    validation: authenticatedValidation(),
    env: {
      E2E_AUTH_ENABLED: 'true',
      PLAYWRIGHT_TEST_BASE_URL: 'https://qa.example.test',
      E2E_AUTH_SUCCESS_URL_REGEX: '/home'
    },
    webRoot: process.cwd(),
    browserExecutableExists: () => true
  });
  assert.equal(missingCredentials.passed, false);
  assert.deepEqual(missingCredentials.diagnostics, ['E2E_USER_EMAIL and E2E_USER_PASSWORD are required when E2E_AUTH_REUSE_STATE is not true.']);

  const missingSignal = checkGenerationReadiness({
    validation: authenticatedValidation(),
    env: {
      E2E_AUTH_ENABLED: 'true',
      PLAYWRIGHT_TEST_BASE_URL: 'https://qa.example.test',
      E2E_USER_EMAIL: 'qa-user@example.test',
      E2E_USER_PASSWORD: 'not-a-secret-fixture'
    },
    webRoot: process.cwd(),
    browserExecutableExists: () => true
  });
  assert.equal(missingSignal.passed, false);
  assert.deepEqual(missingSignal.diagnostics, ['Set E2E_AUTH_SUCCESS_SELECTOR or E2E_AUTH_SUCCESS_URL_REGEX when E2E_AUTH_REUSE_STATE is not true.']);
});

test('authenticated readiness accepts complete reusable-state and login configurations without launching a browser', () => {
  const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'generation-preflight-'));
  const statePath = path.join(webRoot, 'state.json');
  fs.writeFileSync(statePath, '{}\n');
  let executableChecks = 0;

  for (const env of [
    { ...completeLoginEnv(), E2E_AUTH_REUSE_STATE: 'false' },
    {
      E2E_AUTH_ENABLED: 'true',
      PLAYWRIGHT_TEST_BASE_URL: 'https://qa.example.test',
      E2E_AUTH_REUSE_STATE: 'true',
      E2E_AUTH_STATE_PATH: statePath
    }
  ]) {
    const readiness = checkGenerationReadiness({
      validation: authenticatedValidation(),
      env,
      webRoot,
      browserExecutableExists: () => {
        executableChecks += 1;
        return true;
      }
    });
    assert.deepEqual(readiness, {
      passed: true,
      projects: [{ project: 'chromium-auth', env: {} }],
      diagnostics: []
    });
  }

  assert.equal(executableChecks, 2);
});
