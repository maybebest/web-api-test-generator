import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config.js";
import { readReplayManifest } from "./src/utils/replayManifest.js";

// Deterministic, credential-free run of the generated @smoke suite against a local mock
// (scripts/replay-mock-server.mjs). This is the CI-safe counterpart to the opt-in live smoke run:
// it proves the generated tests execute and assert green without a system-under-test.
//
// Usage: npm run test:api:replay  (playwright test tests/generated --grep @smoke -c this file)
const port = Number(process.env.REPLAY_PORT ?? 4599);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("REPLAY_PORT must be an integer between 1 and 65535.");
}
const mockUrl = `http://127.0.0.1:${port}`;

// Per-host overrides are DERIVED from the committed replay manifest instead of a hardcoded host
// list: resolveBaseUrl deliberately keeps foreign hosts on their captured origin (only the primary
// host follows a global BASE_URL), so any manifest host missing a BASE_URL_<HOST> entry would
// escape the mock and hit the real environment. Deriving keeps new captures automatically routed.
// The slug mirrors envHostSlug in tests/generated/support/apiTestUtils.ts.
const configDir = path.dirname(fileURLToPath(import.meta.url));
function envHostSlug(host: string): string {
  return host
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}
const manifestPath = path.resolve(
  process.env.REPLAY_MANIFEST ??
    path.join(configDir, "tests/generated/replay-manifest.json"),
);
const replayManifest = readReplayManifest(manifestPath);
const manifestHosts = [
  ...new Set(replayManifest.routes.map((route) => route.hostname)),
];

function replayPlaceholderValue(name: string): string {
  const explicit: Record<string, string> = {
    API_AUTHORIZATION: "Bearer replay-token",
    API_COOKIE: "session=replay-cookie",
    API_KEY: "replay-key",
    API_TOKEN: "replay-token",
    CACHE_BUSTER: "replay-cache-buster",
    CSRF_TOKEN: "replay-csrf-token",
    QUERY_ID: "replay-query",
    TEST_EMAIL: "replay@example.test",
    TEST_PASSWORD: "replay-pass",
    USER_ID: "replay-user",
    X_SITE_UUID: "replay-site",
  };
  return explicit[name] ?? `replay-${name.toLowerCase().replace(/_/g, "-")}`;
}

const manifestPlaceholderNames = [
  ...new Set(
    [...JSON.stringify(replayManifest).matchAll(/\$\{([A-Z0-9_]+)\}/g)].map(
      (match) => match[1],
    ),
  ),
].sort();
const manifestPlaceholderEnv = Object.fromEntries(
  manifestPlaceholderNames.map((name) => [name, replayPlaceholderValue(name)]),
);

// Route every observed host at the local mock and skip login. The same deterministic placeholder
// values are passed to generated tests and the mock, so both sides resolve the masked contract
// identically without reading ambient credentials.
const replayEnv: Record<string, string> = {
  ...manifestPlaceholderEnv,
  BASE_URL: mockUrl,
  ...Object.fromEntries(
    manifestHosts.map((host) => [`BASE_URL_${envHostSlug(host)}`, mockUrl]),
  ),
  AUTH_STRATEGY: "none",
  // Captured secret headers may only be replayed to this exact loopback origin. Ambient live
  // allowlists are overwritten below together with every other replay boundary.
  AUTH_BEARER_ORIGINS: mockUrl,
  AUTH_COOKIE_ORIGINS: mockUrl,
  AUTH_API_KEY_ORIGINS: mockUrl,
  AUTH_SECRET_HEADER_ORIGINS: mockUrl,
  HAR_API_REPLAY_MODE: "true",
  HAR_API_REPLAY_ORIGIN: mockUrl,
  USER_ID: "replay-user",
  QUERY_ID: "replay-query",
  X_SITE_UUID: "replay-site",
  TEST_EMAIL: "replay@example.test",
  TEST_PASSWORD: "replay-pass",
  API_TOKEN: "replay-token",
  API_AUTHORIZATION: "Bearer replay-token",
  API_COOKIE: "session=replay-cookie",
  API_KEY: "replay-key",
  CACHE_BUSTER: "replay-cache-buster",
  // Several active smoke payload fixtures contain ${CSRF_TOKEN}. Payload placeholders are
  // required even when the matching request header is optional, so replay must seed both.
  CSRF_TOKEN: "replay-csrf-token",
};
for (const [key, value] of Object.entries(replayEnv)) {
  // Replay is an isolation boundary, not a configurable live run. Ambient shell values must never
  // redirect it to a real service or re-enable global authentication.
  process.env[key] = value;
}

export default defineConfig({
  ...baseConfig,
  webServer: {
    command: "node scripts/replay-mock-server.mjs",
    url: `${mockUrl}/__health`,
    // A port collision must fail instead of trusting an unrelated process that happens to answer
    // the health path.
    reuseExistingServer: false,
    env: {
      ...replayEnv,
      REPLAY_MANIFEST: manifestPath,
      REPLAY_PORT: String(port),
    },
  },
});
