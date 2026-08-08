const ROOTS = new Set(['tests', 'tests-dev']);

export function resolveRootTestDir(env = process.env) {
  const root = String(env.PLAYWRIGHT_TEST_SUITE_ROOT ?? 'tests');
  if (!ROOTS.has(root)) {
    throw new Error('PLAYWRIGHT_TEST_SUITE_ROOT must be tests or tests-dev.');
  }
  return `./${root}`;
}
