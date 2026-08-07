import { defineConfig, devices } from '@playwright/test';

// These two read .env themselves, see docs/environment-variables.md.
import { credentials } from './config/credentials';
import { environment } from './config/environments';

/**
 * Suites:
 *   npm run test:api  - API tests only        (tests/api)
 *   npm run test:ui   - UI tests only         (tests/ui)
 *   npm test          - everything, API first (both projects)
 *
 * Every URL comes from config/environments.ts, so switching environment is
 * TEST_ENV=<name> and nothing else.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // One test at a time can hold one support agent, and the pool has a fixed
  // number of them (AGENT_POOL_LOGINS). Running more workers than agents
  // only makes tests queue for an agent, so the two numbers are kept equal.
  workers: process.env.CI ? 2 : credentials.agentPool.logins.length,

  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: environment.webUrl,
    // The whole site sits behind HTTP basic auth.
    httpCredentials: credentials.basicAuth,

    // Without these a stuck click would eat the whole test budget instead of
    // failing with a clear message.
    actionTimeout: 20_000,
    navigationTimeout: 60_000,

    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },

  projects: [
    {
      name: 'api',
      testDir: './tests/api',
      timeout: 120_000,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'ui',
      testDir: './tests/ui',
      // UI tests book real sessions and wait for real chat delivery.
      timeout: 600_000,
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
