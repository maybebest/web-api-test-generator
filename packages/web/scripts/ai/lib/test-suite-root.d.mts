export const TEST_SUITE_ROOT_ENV: 'PLAYWRIGHT_TEST_SUITE_ROOT';
export const CANONICAL_TEST_ROOT: 'tests';
export const DEV_TEST_ROOT: 'tests-dev';

export function testSuiteRootForPath(testPath: string): string;
export function canonicalContractTestPath(testPath: string): string;
export function resolveConfiguredTestDir(env?: NodeJS.ProcessEnv): string;
export function withTestSuiteRoot(env: NodeJS.ProcessEnv, testPath: string): NodeJS.ProcessEnv;
