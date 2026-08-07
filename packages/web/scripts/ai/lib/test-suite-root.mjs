const ROOTS = new Set(['tests', 'tests-dev']);

export const TEST_SUITE_ROOT_ENV = 'PLAYWRIGHT_TEST_SUITE_ROOT';
export const CANONICAL_TEST_ROOT = 'tests';
export const DEV_TEST_ROOT = 'tests-dev';

function portablePath(value) {
  const raw = String(value ?? '');
  const normalized = raw.replaceAll('\\', '/');
  if (
    !raw
    || raw !== raw.trim()
    || raw !== normalized
    || normalized.startsWith('/')
    || normalized.startsWith('-')
    || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
    || normalized === '.'
  ) throw new Error('Path must remain under a safe test suite root.');
  return normalized;
}

export function testSuiteRootForPath(testPath) {
  const normalized = portablePath(testPath);
  const root = normalized.split('/')[0];
  if (!ROOTS.has(root) || normalized === root) {
    throw new Error('Path must remain under a safe test suite root.');
  }
  return root;
}

export function canonicalContractTestPath(testPath) {
  const normalized = portablePath(testPath);
  if (testSuiteRootForPath(normalized) !== DEV_TEST_ROOT) return normalized;
  return CANONICAL_TEST_ROOT + '/' + normalized.slice((DEV_TEST_ROOT + '/').length);
}

export function resolveConfiguredTestDir(env = process.env) {
  const root = String(env[TEST_SUITE_ROOT_ENV] ?? CANONICAL_TEST_ROOT);
  if (!ROOTS.has(root)) throw new Error(TEST_SUITE_ROOT_ENV + ' must be tests or tests-dev.');
  return './' + root;
}

export function withTestSuiteRoot(env, testPath) {
  return { ...env, [TEST_SUITE_ROOT_ENV]: testSuiteRootForPath(testPath) };
}
