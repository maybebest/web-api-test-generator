import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalContractTestPath,
  resolveConfiguredTestDir,
  testSuiteRootForPath,
  withTestSuiteRoot
} from '../lib/test-suite-root.mjs';

test('recognizes canonical and dev roots exactly', () => {
  assert.equal(testSuiteRootForPath('tests/regression/a.spec.ts'), 'tests');
  assert.equal(testSuiteRootForPath('tests-dev/regression/a.spec.ts'), 'tests-dev');
  assert.equal(
    canonicalContractTestPath('tests-dev/regression/a.spec.ts'),
    'tests/regression/a.spec.ts'
  );
});

test('rejects traversal and sibling lookalikes', () => {
  for (const value of [
    'tests-devil/a.spec.ts',
    'tests-shadow/a.spec.ts',
    'tests-dev//a.spec.ts',
    'tests-dev/./a.spec.ts',
    'tests-dev/',
    'tests-dev/../tests/a.spec.ts',
    '../tests-dev/a.spec.ts',
    '/tmp/a.spec.ts'
  ]) assert.throws(() => testSuiteRootForPath(value), /safe test suite root/i);
});

test('testDir defaults to tests and accepts only tests-dev', () => {
  assert.equal(resolveConfiguredTestDir({}), './tests');
  assert.equal(resolveConfiguredTestDir({ PLAYWRIGHT_TEST_SUITE_ROOT: 'tests' }), './tests');
  assert.equal(resolveConfiguredTestDir({ PLAYWRIGHT_TEST_SUITE_ROOT: 'tests-dev' }), './tests-dev');
  assert.throws(
    () => resolveConfiguredTestDir({ PLAYWRIGHT_TEST_SUITE_ROOT: '../tests' }),
    /PLAYWRIGHT_TEST_SUITE_ROOT/
  );
  assert.throws(
    () => resolveConfiguredTestDir({ PLAYWRIGHT_TEST_SUITE_ROOT: ' tests-dev ' }),
    /PLAYWRIGHT_TEST_SUITE_ROOT/
  );
});

test('healer-owned selection overwrites a caller root', () => {
  assert.deepEqual(
    withTestSuiteRoot(
      { PLAYWRIGHT_TEST_SUITE_ROOT: 'tests', KEEP: 'value' },
      'tests-dev/regression/a.spec.ts'
    ),
    { PLAYWRIGHT_TEST_SUITE_ROOT: 'tests-dev', KEEP: 'value' }
  );
});
