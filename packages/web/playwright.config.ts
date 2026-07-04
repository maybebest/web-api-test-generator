import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const isCI = Boolean(process.env.CI);
// The system under test is external: point PLAYWRIGHT_TEST_BASE_URL at the
// target environment (e.g. an authenticated dev host). No app is bundled.
const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'http://localhost:3000';
// Some non-production environments sit behind HTTP basic auth — the
// browser-level "system login" prompt, which is
// not part of any application flow. Credentials come from the environment (or
// gitignored .env) only and are never committed.
const httpBasicUsername = process.env.E2E_HTTP_BASIC_USERNAME;
const httpBasicPassword = process.env.E2E_HTTP_BASIC_PASSWORD;
const httpCredentials =
  httpBasicUsername && httpBasicPassword
    ? { username: httpBasicUsername, password: httpBasicPassword }
    : undefined;
const isAuthEnabled = process.env.E2E_AUTH_ENABLED === 'true';
const reuseAuthState = process.env.E2E_AUTH_REUSE_STATE === 'true';
const storageState = process.env.E2E_AUTH_STATE_PATH ?? 'playwright/.auth/user.json';

// Allure is on by default; opt out with ALLURE_ENABLED=false (e.g. for a
// developer without the reporter installed, or a run that does not want
// Allure output).
const allureEnabled = process.env.ALLURE_ENABLED !== 'false';

// Authenticated specs (Auth = required flows) follow the
// "<name>.authenticated.spec.ts" naming rule and run ONLY in the
// chromium-auth project, which supplies storageState. Every non-auth browser
// project ignores them so they can never run unauthenticated (or silently
// match zero tests in chromium-auth).
const authenticatedSpecPattern = /.*\.authenticated\.spec\.ts/;
// Visual baselines are pinned to chromium: one engine owns the screenshots,
// so cross-engine rendering noise cannot churn the committed baselines.
const visualSpecPattern = /tests[\\/]visual[\\/]/;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: [
    ['list'],
    // Aggregates each test's `performance` attachment into the dedicated performance/ folder.
    ['./fixtures/perf/reporter.ts'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    ...(allureEnabled
      ? [['allure-playwright', { resultsDir: 'allure-results', detail: true }] as const]
      : [])
  ],
  // Visual baseline policy: animations are always frozen and a small
  // tolerance absorbs anti-aliasing noise without hiding real regressions.
  expect: {
    // Slow dev environment: allow assertions (toBeVisible/toContainText/etc.) up to
    // 30s instead of the 5s default.
    timeout: 30_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled'
    }
  },
  // Deterministic baseline location, keyed by project and platform so
  // differently-rendered environments never overwrite each other's baselines.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{projectName}-{platform}/{arg}{ext}',
  use: {
    baseURL,
    ...(httpCredentials ? { httpCredentials } : {}),
    trace: isCI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 30_000
  },
  projects: [
    ...(isAuthEnabled && !reuseAuthState
      ? [
          {
            name: 'setup',
            testMatch: /.*\.setup\.ts/
          }
        ]
      : []),
    {
      name: 'chromium',
      testIgnore: [authenticatedSpecPattern],
      use: {
        ...devices['Desktop Chrome']
      }
    },
    {
      name: 'firefox',
      testIgnore: [authenticatedSpecPattern, visualSpecPattern],
      use: {
        ...devices['Desktop Firefox']
      }
    },
    {
      name: 'webkit',
      testIgnore: [authenticatedSpecPattern, visualSpecPattern],
      use: {
        ...devices['Desktop Safari']
      }
    },
    {
      name: 'mobile-chrome',
      testIgnore: [authenticatedSpecPattern, visualSpecPattern],
      use: {
        ...devices['Pixel 5']
      }
    },
    ...(isAuthEnabled
      ? [
          {
            name: 'chromium-auth',
            testMatch: authenticatedSpecPattern,
            use: {
              ...devices['Desktop Chrome'],
              storageState
            },
            dependencies: reuseAuthState ? [] : ['setup']
          }
        ]
      : [])
  ]
});
