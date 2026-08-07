import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import { validateAuthenticatedTarget } from './scripts/ai/lib/authenticated-target.mjs';
import { resolveConfiguredTestDir } from './scripts/ai/lib/test-suite-root.mjs';

export { validateAuthenticatedTarget } from './scripts/ai/lib/authenticated-target.mjs';

if (process.env.AI_GATE_SANITIZED_ENV !== 'true') {
  dotenv.config({ quiet: true });
}

const configuredTestDir = resolveConfiguredTestDir(process.env);

export const AUTHENTICATED_ARTIFACT_POLICY = {
  trace: 'off',
  screenshot: 'off',
  video: 'off'
} as const;

export const AUTHENTICATED_REPORTER_POLICY = [['list']] as const;

const isCI = Boolean(process.env.CI);
const localFixtureURL = 'http://127.0.0.1:3000';
// Local non-auth projects always exercise the committed deterministic fixture. The external URL
// is reserved for authenticated projects, so setting it can never redirect the local CI gates.
const externalBaseURL = process.env.PLAYWRIGHT_TEST_BASE_URL?.trim();
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

if (isAuthEnabled && !externalBaseURL) {
  throw new Error('E2E_AUTH_ENABLED=true requires PLAYWRIGHT_TEST_BASE_URL for the external authenticated suite.');
}

const authenticatedBaseURL =
  isAuthEnabled && externalBaseURL
    ? validateAuthenticatedTarget(externalBaseURL, process.env.E2E_AUTH_ALLOWED_HOSTS)
    : externalBaseURL;

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
const localFixtureSpecPattern =
  /(?:tests|tests-dev)[\\/](?:smoke|accessibility|visual|recorded)[\\/]/;

export default defineConfig({
  testDir: configuredTestDir,
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
  workers: isCI ? 1 : undefined,
  reporter: isAuthEnabled
    ? [...AUTHENTICATED_REPORTER_POLICY]
    : [
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
    baseURL: localFixtureURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 30_000
  },
  webServer: {
    command: 'node local-fixture/server.mjs',
    url: `${localFixtureURL}/__health`,
    reuseExistingServer: !isCI,
    timeout: 15_000
  },
  projects: [
    ...(isAuthEnabled && !reuseAuthState
      ? [
          {
            name: 'setup',
            testMatch: /.*\.setup\.ts/,
            workers: 1,
            use: {
              baseURL: authenticatedBaseURL,
              ...(httpCredentials ? { httpCredentials } : {})
            }
          }
        ]
      : []),
    {
      name: 'local-chromium',
      testMatch: localFixtureSpecPattern,
      testIgnore: [authenticatedSpecPattern],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: localFixtureURL
      }
    },
    ...(externalBaseURL
      ? [
          { name: 'chromium', device: devices['Desktop Chrome'] },
          { name: 'firefox', device: devices['Desktop Firefox'] },
          { name: 'webkit', device: devices['Desktop Safari'] },
          { name: 'mobile-chrome', device: devices['Pixel 5'] }
        ].map(({ name, device }) => ({
          name,
          workers: 1,
          testIgnore: [authenticatedSpecPattern, localFixtureSpecPattern],
          use: {
            ...device,
            baseURL: externalBaseURL,
            ...(httpCredentials ? { httpCredentials } : {})
          }
        }))
      : []),
    ...(isAuthEnabled
      ? [
          {
            name: 'chromium-auth',
            testMatch: authenticatedSpecPattern,
            workers: 1,
            use: {
              ...devices['Desktop Chrome'],
              baseURL: authenticatedBaseURL,
              ...(httpCredentials ? { httpCredentials } : {}),
              storageState,
              // Authenticated traces include request headers, cookies, and storage state. The CI
              // job publishes Allure artifacts, so never retain browser media from this project.
              ...AUTHENTICATED_ARTIFACT_POLICY
            },
            dependencies: reuseAuthState ? [] : ['setup']
          }
        ]
      : [])
  ]
});
