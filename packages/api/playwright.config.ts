import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["**/*.spec.ts"],
  globalSetup: "./tests/generated/support/authSetup.ts",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/playwright-results.json" }],
    ["junit", { outputFile: "test-results/playwright-junit.xml" }],
  ],
  timeout: 30_000,
  // Stateful shared-session suite; read-only tests can move to a parallel project later via the @mutating tag.
  fullyParallel: false,
  workers: 1,
  // Generated smoke cases include guarded mutations. Retrying them can execute the same write twice
  // and also hides replay nondeterminism, so both local and CI runs fail on the first attempt.
  retries: 0,
  use: {
    // Traces record full request headers (live session cookie, bearer, CSRF token), and CI uploads
    // test artifacts. Live executions therefore never retain traces; deterministic loopback replay
    // can retain them for diagnostics without exposing live credentials.
    trace:
      process.env.HAR_API_REPLAY_MODE === "true" ? "retain-on-failure" : "off",
  },
});
