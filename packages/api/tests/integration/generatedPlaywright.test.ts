import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/defaultConfig.js';
import { generateFromHar } from '../../src/generator/orchestrator.js';

const tmpRoot = path.resolve('tests/.tmp/playwright-generated');
const require = createRequire(import.meta.url);

describe('generated Playwright API tests', () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    await closeServer(server);
    server = undefined;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('runs generated tests against a mocked API server', async () => {
    server = http.createServer(async (request, response) => {
      if (request.method === 'GET' && request.url === '/v1/users?limit=1') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ users: [{ id: 'user-1', name: 'Ada' }], total: 1 }));
        return;
      }

      // GET-only JSON endpoint (no request-body fixture anywhere in its spec file): exercises the
      // schema-validation path, which loads the schema via loadJsonFromTestFile.
      if (request.method === 'GET' && request.url === '/v1/orders') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ orders: [{ id: 'order-1', total: 12 }], total: 1 }));
        return;
      }

      if (request.method === 'POST' && request.url === '/v1/users') {
        const body = JSON.parse(await readRequest(request)) as { name?: unknown };
        if (!body.name) {
          response.writeHead(400, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'name is required' }));
          return;
        }

        if (typeof body.name !== 'string') {
          response.writeHead(422, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'name must be a string' }));
          return;
        }

        response.writeHead(201, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ id: 'user-2', name: 'Grace', createdAt: '2026-05-29T12:00:01.000Z' }));
        return;
      }

      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not found' }));
    });

    await listen(server);
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const harPath = path.join(tmpRoot, 'session.har');
    const outDir = path.join(tmpRoot, 'generated');

    await fs.mkdir(tmpRoot, { recursive: true });
    await fs.writeFile(harPath, JSON.stringify(buildMockHar(baseUrl), null, 2), 'utf8');

    await generateFromHar(
      {
        harInputs: [harPath],
        outDir,
        baseUrl,
        include: [],
        exclude: [],
        ignoredDomains: [],
        firstPartyDomains: [],
        methods: [],
        statuses: [],
        generationModes: ['smoke', 'extended'],
        inferenceLevel: 'balanced',
        inferredRunMode: 'mixed',
        negativeStatusPolicy: 'family',
        mutationPolicy: 'guarded',
        ai: false,
        dryRun: false
      },
      defaultConfig
    );

    const playwrightCli = require.resolve('@playwright/test/cli');
    await runPlaywright([playwrightCli, 'test', outDir, '--config', path.resolve('playwright.config.ts')], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AUTH_SETUP_ENABLED: 'false',
        BASE_URL: baseUrl,
        // The generated preflight spec requires these; dummy values keep the run hermetic.
        TEST_EMAIL: 'integration-test@example.com',
        TEST_PASSWORD: 'integration-test-password'
      }
    });
  });
});

function buildMockHar(baseUrl: string): unknown {
  return {
    log: {
      version: '1.2',
      creator: { name: 'integration-test', version: '1.0.0' },
      entries: [
        {
          time: 50,
          request: {
            method: 'GET',
            url: `${baseUrl}/v1/users?limit=1`,
            headers: [{ name: 'Accept', value: 'application/json' }],
            queryString: [{ name: 'limit', value: '1' }]
          },
          response: {
            status: 200,
            headers: [{ name: 'Content-Type', value: 'application/json' }],
            content: {
              mimeType: 'application/json',
              text: JSON.stringify({ users: [{ id: 'user-1', name: 'Ada' }], total: 1 })
            }
          }
        },
        {
          time: 60,
          request: {
            method: 'GET',
            url: `${baseUrl}/v1/orders`,
            headers: [{ name: 'Accept', value: 'application/json' }]
          },
          response: {
            status: 200,
            headers: [{ name: 'Content-Type', value: 'application/json' }],
            content: {
              mimeType: 'application/json',
              text: JSON.stringify({ orders: [{ id: 'order-1', total: 12 }], total: 1 })
            }
          }
        },
        {
          time: 75,
          request: {
            method: 'POST',
            url: `${baseUrl}/v1/users`,
            headers: [{ name: 'Content-Type', value: 'application/json' }],
            postData: {
              mimeType: 'application/json',
              text: JSON.stringify({ name: 'Grace' })
            }
          },
          response: {
            status: 201,
            headers: [{ name: 'Content-Type', value: 'application/json' }],
            content: {
              mimeType: 'application/json',
              text: JSON.stringify({ id: 'user-2', name: 'Grace', createdAt: '2026-05-29T12:00:01.000Z' })
            }
          }
        }
      ]
    }
  };
}

function listen(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(serverToClose: http.Server | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!serverToClose?.listening) {
      resolve();
      return;
    }

    serverToClose.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function readRequest(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function runPlaywright(
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Playwright exited with ${code ?? 'unknown'}\n${stdout}\n${stderr}`));
    });
  });
}
