import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

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

function listProject(project, env = collectionEnv) {
  return execFileSync('npx', ['playwright', 'test', '--list', `--project=${project}`, '--reporter=line'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env
  });
}

function listedProjectConfig(project) {
  const output = execFileSync(
    'npx',
    ['playwright', 'test', '--list', `--project=${project}`, '--reporter=json'],
    { cwd: repoRoot, encoding: 'utf8', env: collectionEnv }
  );
  const jsonStart = output.indexOf('{\n  "config"');
  assert.notEqual(jsonStart, -1, output);
  return JSON.parse(output.slice(jsonStart));
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

test('Playwright project configuration routes collection to the actual tests-dev directories', () => {
  const apiReport = listedProjectConfig('api');
  const uiReport = listedProjectConfig('ui');

  assert.equal(apiReport.config.rootDir, path.join(repoRoot, 'tests-dev'));
  assert.equal(
    apiReport.config.projects.find((project) => project.name === 'api')?.testDir,
    path.join(repoRoot, 'tests-dev', 'api')
  );
  assert.equal(
    uiReport.config.projects.find((project) => project.name === 'ui')?.testDir,
    path.join(repoRoot, 'tests-dev', 'ui')
  );
  assert.ok(apiReport.suites.every((suite) => suite.file.startsWith('api/')));
  assert.ok(uiReport.suites.every((suite) => suite.file.startsWith('ui/')));
});

test('static project listing preserves an existing HTML report sentinel', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'root-list-report-'));
  const reportDirectory = path.join(workspace, 'playwright-report');
  const sentinel = path.join(reportDirectory, 'existing-report.sentinel');
  fs.mkdirSync(reportDirectory, { recursive: true });
  fs.writeFileSync(sentinel, 'preserve-existing-report');

  try {
    const env = { ...collectionEnv, PLAYWRIGHT_HTML_OUTPUT_DIR: reportDirectory };
    listProject('api', env);
    listProject('ui', env);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve-existing-report');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
