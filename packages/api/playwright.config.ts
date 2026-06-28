import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.spec.ts'],
  globalSetup: './tests/generated/support/authSetup.ts',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/playwright-results.json' }],
    ['junit', { outputFile: 'test-results/playwright-junit.xml' }]
  ],
  timeout: 30_000,
  // Stateful shared-session suite; read-only tests can move to a parallel project later via the @mutating tag.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI === 'true' ? 1 : 0,
  use: {
    // Traces record full request headers (live session cookie, bearer, CSRF token), and CI
    // uploads test-results/ and playwright-report/ as artifacts — so the opt-in live smoke run
    // (RUN_GENERATED_API_SMOKE=true) must never retain traces, or a single failure would publish
    // live credentials in a downloadable artifact.
    trace: process.env.RUN_GENERATED_API_SMOKE === 'true' ? 'off' : 'retain-on-failure'
  }
});
