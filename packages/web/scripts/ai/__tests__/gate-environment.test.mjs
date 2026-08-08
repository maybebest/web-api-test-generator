import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

import { buildGateEnvironment, knownSecretEnvValues } from '../lib/gate-environment.mjs';

const usersSource = fs.readFileSync(new URL('../../../data/users.ts', import.meta.url), 'utf8');
const usersJavaScript = ts.transpileModule(usersSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const usersModuleUrl = `data:text/javascript;base64,${Buffer.from(usersJavaScript).toString('base64')}`;

function runRequiredEmail(env) {
  return spawnSync(process.execPath, [
    '--input-type=module',
    '--eval',
    `import { requireStandardUserEmail } from ${JSON.stringify(usersModuleUrl)}; process.stdout.write(requireStandardUserEmail());`
  ], {
    encoding: 'utf8',
    env
  });
}

test('suite-root selection reaches static and runtime subprocesses', () => {
  const source = { PLAYWRIGHT_TEST_SUITE_ROOT: 'tests-dev' };
  assert.equal(
    buildGateEnvironment(source, { profile: 'static' }).PLAYWRIGHT_TEST_SUITE_ROOT,
    'tests-dev'
  );
  assert.equal(
    buildGateEnvironment(source, { profile: 'external-runtime' }).PLAYWRIGHT_TEST_SUITE_ROOT,
    'tests-dev'
  );
});

test('PsychicBook credentials reach only external runtime and remain redactable', () => {
  const source = {
    TEST_ENV: 'dev',
    WEB_BASIC_AUTH_USER: 'basic-user',
    WEB_BASIC_AUTH_PASSWORD: 'basic-password',
    AGENT_PASSWORD: 'agent-password',
    ADMIN_EMAIL: 'admin@example.test',
    ADMIN_PASSWORD: 'admin-password'
  };

  const external = buildGateEnvironment(source, { profile: 'external-runtime' });
  const staticEnvironment = buildGateEnvironment(source, { profile: 'static' });

  assert.equal(external.TEST_ENV, 'dev');
  assert.equal(staticEnvironment.TEST_ENV, 'dev');
  assert.equal(external.WEB_BASIC_AUTH_USER, 'basic-user');
  assert.equal(external.WEB_BASIC_AUTH_PASSWORD, 'basic-password');
  assert.equal(external.AGENT_PASSWORD, 'agent-password');
  assert.equal(external.ADMIN_EMAIL, 'admin@example.test');
  assert.equal(external.ADMIN_PASSWORD, 'admin-password');
  assert.notEqual(staticEnvironment.WEB_BASIC_AUTH_USER, 'basic-user');
  assert.notEqual(staticEnvironment.WEB_BASIC_AUTH_PASSWORD, 'basic-password');
  assert.notEqual(staticEnvironment.AGENT_PASSWORD, 'agent-password');
  assert.notEqual(staticEnvironment.ADMIN_EMAIL, 'admin@example.test');
  assert.notEqual(staticEnvironment.ADMIN_PASSWORD, 'admin-password');
  assert.deepEqual(knownSecretEnvValues(source), [
    'basic-user',
    'basic-password',
    'agent-password',
    'admin@example.test',
    'admin-password'
  ]);
});

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
