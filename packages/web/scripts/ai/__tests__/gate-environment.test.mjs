import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { buildGateEnvironment, knownSecretEnvValues } from '../lib/gate-environment.mjs';

const usersModuleUrl = pathToFileURL(new URL('../../../data/users.ts', import.meta.url).pathname).href;

function runRequiredEmail(env) {
  return spawnSync(process.execPath, [
    '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
    '--input-type=module',
    '--eval',
    `import { requireStandardUserEmail } from ${JSON.stringify(usersModuleUrl)}; process.stdout.write(requireStandardUserEmail());`
  ], {
    encoding: 'utf8',
    env
  });
}

test('generic user email reaches external gates but not static subprocesses', () => {
  const source = {
    PATH: '/usr/bin',
    E2E_HTTP_BASIC_USERNAME: 'psychicbook',
    E2E_USER_EMAIL: 'returning-user@example.test'
  };

  const external = buildGateEnvironment(source, { profile: 'external-runtime' });
  const staticEnvironment = buildGateEnvironment(source, { profile: 'static' });

  assert.equal(external.E2E_HTTP_BASIC_USERNAME, 'psychicbook');
  assert.equal(external.E2E_USER_EMAIL, 'returning-user@example.test');
  assert.equal(staticEnvironment.E2E_HTTP_BASIC_USERNAME, undefined);
  assert.equal(staticEnvironment.E2E_USER_EMAIL, '');
  assert.deepEqual(knownSecretEnvValues(source), ['returning-user@example.test']);
});

test('required standard user email is trimmed and fails clearly when absent', () => {
  const present = runRequiredEmail({ ...process.env, E2E_USER_EMAIL: '  returning-user@example.test  ' });
  const missingEnv = { ...process.env };
  delete missingEnv.E2E_USER_EMAIL;
  const missing = runRequiredEmail(missingEnv);

  assert.equal(present.status, 0, present.stderr);
  assert.equal(present.stdout, 'returning-user@example.test');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Missing required runtime configuration: E2E_USER_EMAIL/);
});
