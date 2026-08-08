import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const baseEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TEST_ENV: 'dev',
  WEB_BASIC_AUTH_USER: 'fixture-user',
  WEB_BASIC_AUTH_PASSWORD: 'fixture-password',
  AGENT_PASSWORD: 'fixture-password',
  ADMIN_EMAIL: 'admin@example.test',
  ADMIN_PASSWORD: 'fixture-password'
};

test('dev environment lets the real root Playwright config collect tests', () => {
  const result = spawnSync(
    'npx',
    ['playwright', 'test', '--list', '--project=api'],
    { cwd: process.cwd(), env: baseEnv, encoding: 'utf8', shell: false }
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Total: 8 tests in 6 files/);
});
