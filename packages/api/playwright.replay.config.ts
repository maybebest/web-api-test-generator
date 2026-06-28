import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config.js';

// Deterministic, credential-free run of the generated @smoke suite against a local mock
// (scripts/replay-mock-server.mjs). This is the CI-safe counterpart to the opt-in live smoke run:
// it proves the generated tests execute and assert green without a system-under-test.
//
// Usage: npm run test:api:replay  (playwright test tests/generated --grep @smoke -c this file)
const port = Number(process.env.REPLAY_PORT ?? 4599);
const mockUrl = `http://127.0.0.1:${port}`;

// Route every host observed in the capture at the local mock and skip login. resolveBaseUrl honors
// a per-host BASE_URL_<HOST> override; authSetup early-returns when AUTH_SETUP_ENABLED=false. The
// dummy values are non-empty only so the preflight env check passes — the mock never reads them.
const replayEnv: Record<string, string> = {
  BASE_URL: mockUrl,
  BASE_URL_APPS_HEARTPACE_DEV: mockUrl,
  BASE_URL_STAGEAUTOMATION_HEARTPACE_DEV: mockUrl,
  BASE_URL_WORKFORCE_HEARTPACE_DEV: mockUrl,
  AUTH_SETUP_ENABLED: 'false',
  USER_ID: 'replay-user',
  QUERY_ID: 'replay-query',
  X_SITE_UUID: 'replay-site',
  TEST_EMAIL: 'replay@example.test',
  TEST_PASSWORD: 'replay-pass',
  API_TOKEN: 'replay-token'
};
for (const [key, value] of Object.entries(replayEnv)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}

export default defineConfig({
  ...baseConfig,
  webServer: {
    command: 'node scripts/replay-mock-server.mjs',
    url: `${mockUrl}/__health`,
    reuseExistingServer: !process.env.CI,
    env: { REPLAY_PORT: String(port) }
  }
});
