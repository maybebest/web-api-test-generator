import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertPrivateEnvironmentFile,
  loadPackageEnvironment,
  validateUserArgs
} from '../../run-auth-regression.mjs';
import {
  READ_ONLY_SMOKE_TARGETS,
  READ_ONLY_SMOKE_TITLE,
  buildReadOnlySmokeArgs,
  validateReadOnlySmokeArgs
} from '../../run-auth-readonly-smoke.mjs';

test('authenticated runner accepts filters but rejects safety-option overrides', () => {
  assert.deepEqual(validateUserArgs(['--grep', 'AC-001']), ['--grep', 'AC-001']);
  for (const option of ['--project=webkit', '--workers', '-j', '--retries=2', '--repeat-each=1', '--config=other.ts', '-c', '--no-deps']) {
    assert.throws(() => validateUserArgs([option]), /overriding safety options is forbidden/);
  }
});

test('read-only authenticated smoke uses an immutable exact allowlist', () => {
  assert.equal(READ_ONLY_SMOKE_TARGETS.length, 8);
  assert.equal(READ_ONLY_SMOKE_TITLE, '\\bAC-001\\b');
  assert.deepEqual(buildReadOnlySmokeArgs(), [
    'test',
    ...READ_ONLY_SMOKE_TARGETS,
    '--grep',
    '\\bAC-001\\b',
    '--project=chromium-auth',
    '--workers=1',
    '--retries=0'
  ]);
  assert.doesNotThrow(() => validateReadOnlySmokeArgs([]));
  assert.throws(() => validateReadOnlySmokeArgs(['--grep', 'AC-002']), /accepts no CLI arguments/);
  assert.throws(
    () => validateReadOnlySmokeArgs(['tests/regression/media-plan-save-via-nectar-ai.authenticated.spec.ts']),
    /accepts no CLI arguments/
  );
});

test('authenticated runner loads its package env before preflight without overriding explicit values', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-runner-env-'));
  const envFile = path.join(directory, '.env');
  const originalEnabled = process.env.E2E_AUTH_ENABLED;
  const originalBaseUrl = process.env.PLAYWRIGHT_TEST_BASE_URL;

  try {
    fs.writeFileSync(envFile, 'E2E_AUTH_ENABLED=true\nPLAYWRIGHT_TEST_BASE_URL=https://from-file.example\n');
    fs.chmodSync(envFile, 0o600);
    delete process.env.E2E_AUTH_ENABLED;
    process.env.PLAYWRIGHT_TEST_BASE_URL = 'https://explicit.example';

    const result = loadPackageEnvironment(envFile);

    assert.equal(result.error, undefined);
    assert.equal(process.env.E2E_AUTH_ENABLED, 'true');
    assert.equal(process.env.PLAYWRIGHT_TEST_BASE_URL, 'https://explicit.example');
  } finally {
    if (originalEnabled === undefined) delete process.env.E2E_AUTH_ENABLED;
    else process.env.E2E_AUTH_ENABLED = originalEnabled;
    if (originalBaseUrl === undefined) delete process.env.PLAYWRIGHT_TEST_BASE_URL;
    else process.env.PLAYWRIGHT_TEST_BASE_URL = originalBaseUrl;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('authenticated runner refuses permissive or symlinked environment files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-runner-private-env-'));
  const envFile = path.join(directory, '.env');
  const symlink = path.join(directory, '.env-link');
  try {
    fs.writeFileSync(envFile, 'E2E_AUTH_ENABLED=true\n', { mode: 0o644 });
    if (process.platform !== 'win32') {
      assert.throws(() => assertPrivateEnvironmentFile(envFile), /chmod 600/);
    }
    fs.chmodSync(envFile, 0o600);
    assert.doesNotThrow(() => assertPrivateEnvironmentFile(envFile));
    fs.symlinkSync(envFile, symlink);
    assert.throws(() => assertPrivateEnvironmentFile(symlink), /regular non-symlink file/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
