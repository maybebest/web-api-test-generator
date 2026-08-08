import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveRootTestDir } from './test-suite-root.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const collectionEnv = {
  ...process.env,
  WEB_BASIC_AUTH_USER: 'collection-user',
  WEB_BASIC_AUTH_PASSWORD: 'collection-password',
  AGENT_PASSWORD: 'collection-password',
  ADMIN_EMAIL: 'collection-admin@example.invalid',
  ADMIN_PASSWORD: 'collection-password',
  PLAYWRIGHT_TEST_SUITE_ROOT: 'tests-dev'
};

function listProject(project) {
  return execFileSync('npx', ['playwright', 'test', '--list', `--project=${project}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: collectionEnv
  });
}

test('root suite defaults to tests and accepts only tests-dev', () => {
  assert.equal(resolveRootTestDir({}), './tests');
  assert.equal(resolveRootTestDir({ PLAYWRIGHT_TEST_SUITE_ROOT: 'tests' }), './tests');
  assert.equal(resolveRootTestDir({ PLAYWRIGHT_TEST_SUITE_ROOT: 'tests-dev' }), './tests-dev');
  for (const value of [' tests-dev ', '../tests', 'tests-devil', '/tmp/tests']) {
    assert.throws(
      () => resolveRootTestDir({ PLAYWRIGHT_TEST_SUITE_ROOT: value }),
      /PLAYWRIGHT_TEST_SUITE_ROOT/
    );
  }
});

test('project lists select tests-dev when the dev root is requested', () => {
  const apiList = listProject('api');
  const uiList = listProject('ui');

  assert.match(apiList, /\[api\] › api\/experts\/expert-booking\.spec\.ts:/);
  assert.doesNotMatch(apiList, /\.\.\/tests\//);
  assert.match(uiList, /\[ui\] › ui\/articles\/articles-tab\.spec\.ts:/);
  assert.doesNotMatch(uiList, /\.\.\/tests\//);
});
