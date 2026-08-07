import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPlaywrightAuthSetupFile,
  buildPlaywrightSupportFile,
  type SupportFileHosts,
} from "../../src/generator/playwrightSupport.js";

// Written inside the project so the emitted file resolves @playwright/test and ajv from the
// project node_modules when imported below.
const tmpDir = path.resolve("tests/.tmp/playwright-support-unit");
const generatedAuthMarker = "# har-api-tests generated auth snapshot v1\n";

interface EmittedSupportModule {
  assertAllowedTarget(urlValue: string, purpose?: string): void;
  clearGeneratedAuthSnapshot(): void;
  clearGeneratedEnvValues(): void;
  replaceGeneratedEnvValues(values: Record<string, string>): void;
  resolveGeneratedEnvValue(envName: string): string;
  sendApiRequest(options: {
    request: { fetch(url: string, options?: unknown): Promise<unknown> };
    defaultBaseUrl: string;
    path: string;
    method: string;
    headers?: Record<string, string>;
    suppressGeneratedAuth?: boolean;
  }): Promise<{ response: unknown; elapsedMs: number; url: string }>;
  updateGeneratedEnvValue(envName: string, value: string): void;
}

interface EmittedAuthSetupModule {
  default(): Promise<void>;
}

const managedEnvironment = [
  "API_AUTHORIZATION",
  "API_COOKIE",
  "API_TOKEN",
  "AUTH_BEARER_ORIGINS",
  "AUTH_COOKIE_ORIGINS",
  "AUTH_API_KEY_ORIGINS",
  "AUTH_SECRET_HEADER_ORIGINS",
  "AUTH_STRATEGY",
  "BASE_URL",
  "BASE_URL_API_EXAMPLE_TEST",
  "CSRF_TOKEN",
  "DOTENV_CONFIG_PATH",
  "GENERATED_ENV_FILE",
  "HAR_API_REPLAY_MODE",
  "HAR_API_REPLAY_ORIGIN",
  "HAR_TEST_BLANK_VAR",
  "HAR_TEST_EMPTY_PROCESS_VAR",
  "HAR_TEST_SET_VAR",
  "TRUSTED_API_ORIGINS",
  "USER_ID",
] as const;
const originalEnvironment = Object.fromEntries(
  managedEnvironment.map((name) => [name, process.env[name]]),
);
let emittedModuleId = 0;

async function importEmittedSupportModule(
  hosts?: SupportFileHosts,
): Promise<EmittedSupportModule> {
  const moduleDirectory = path.join(tmpDir, `support-${emittedModuleId++}`);
  const filePath = path.join(moduleDirectory, "apiTestUtils.ts");
  await fs.mkdir(moduleDirectory, { recursive: true });
  await fs.writeFile(filePath, buildPlaywrightSupportFile(hosts), "utf8");
  return (await import(filePath)) as EmittedSupportModule;
}

async function importEmittedAuthSetupModule(): Promise<EmittedAuthSetupModule> {
  const moduleDirectory = path.join(tmpDir, `auth-${emittedModuleId++}`);
  const supportPath = path.join(moduleDirectory, "apiTestUtils.ts");
  const authSetupPath = path.join(moduleDirectory, "authSetup.ts");
  await fs.mkdir(moduleDirectory, { recursive: true });
  await fs.writeFile(supportPath, buildPlaywrightSupportFile(), "utf8");
  await fs.writeFile(authSetupPath, buildPlaywrightAuthSetupFile(), "utf8");
  return (await import(authSetupPath)) as EmittedAuthSetupModule;
}

function restoreEnvironment(): void {
  for (const name of managedEnvironment) {
    const originalValue = originalEnvironment[name];
    if (originalValue === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = originalValue;
    }
  }
}

describe("emitted playwright support file", () => {
  beforeEach(async () => {
    for (const name of managedEnvironment) {
      delete process.env[name];
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    restoreEnvironment();
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("contains no legacy human-approval runner or ALLOW flags", () => {
    const source = buildPlaywrightSupportFile();

    expect(source).toContain("export const calibrationTest");
    expect(source).toContain("process.env.CALIBRATION_MODE === 'true'");
    expect(source).not.toContain("test.fixme");
    expect(source).not.toContain("inferredTest");
    expect(source).not.toContain("ALLOW_LIVE_API_TESTS");
    expect(source).not.toContain("ALLOW_MUTATING_API_TESTS");
    expect(source).not.toContain("assertMutationAllowed");
  });

  it("treats blank required env values as missing instead of passing preflight vacuously", async () => {
    const envFilePath = path.join(tmpDir, "generated-auth.env");
    await fs.mkdir(tmpDir, { recursive: true });
    // Exactly the state produced by copying .env.generated.example: blank NAME= lines.
    await fs.writeFile(
      envFilePath,
      "HAR_TEST_BLANK_VAR=\nHAR_TEST_SET_VAR=real-value\n",
      "utf8",
    );
    process.env.DOTENV_CONFIG_PATH = envFilePath;
    process.env.HAR_TEST_EMPTY_PROCESS_VAR = "";

    const support = await importEmittedSupportModule();

    expect(() =>
      support.resolveGeneratedEnvValue("HAR_TEST_BLANK_VAR"),
    ).toThrow(/Missing required environment variable HAR_TEST_BLANK_VAR/);
    expect(() =>
      support.resolveGeneratedEnvValue("HAR_TEST_EMPTY_PROCESS_VAR"),
    ).toThrow(
      /Missing required environment variable HAR_TEST_EMPTY_PROCESS_VAR/,
    );
    expect(() =>
      support.resolveGeneratedEnvValue("HAR_TEST_DEFINITELY_UNSET_VAR"),
    ).toThrow(
      /Missing required environment variable HAR_TEST_DEFINITELY_UNSET_VAR/,
    );
    expect(support.resolveGeneratedEnvValue("HAR_TEST_SET_VAR")).toBe(
      "real-value",
    );
  });

  it("writes derived authentication state with owner-only permissions", async () => {
    const privateDirectory = path.join(tmpDir, "private-auth");
    const envFilePath = path.join(privateDirectory, "generated-auth.env");
    process.env.GENERATED_ENV_FILE = envFilePath;
    const support = await importEmittedSupportModule();

    support.updateGeneratedEnvValue(
      "HAR_TEST_PRIVATE_VALUE",
      "derived-test-value",
    );

    expect((await fs.stat(privateDirectory)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(envFilePath)).mode & 0o777).toBe(0o600);
    expect(await fs.readFile(envFilePath, "utf8")).toContain(
      "HAR_TEST_PRIVATE_VALUE=derived-test-value",
    );
  });

  it("atomically replaces the derived snapshot and does not fall back to stale ambient auth", async () => {
    const privateDirectory = path.join(tmpDir, "replacement-auth");
    const envFilePath = path.join(privateDirectory, "generated-auth.env");
    await fs.mkdir(privateDirectory, { recursive: true });
    await fs.writeFile(
      envFilePath,
      `${generatedAuthMarker}API_TOKEN=old-token\nUSER_ID=old-user\n`,
      "utf8",
    );
    process.env.GENERATED_ENV_FILE = envFilePath;
    const support = await importEmittedSupportModule();

    support.replaceGeneratedEnvValues({
      CSRF_TOKEN: "fresh-csrf",
      USER_ID: "fresh-user",
    });
    process.env.API_TOKEN = "stale-ambient-token";
    process.env.AUTH_STRATEGY = "http-login";

    expect(support.resolveGeneratedEnvValue("USER_ID")).toBe("fresh-user");
    expect(() => support.resolveGeneratedEnvValue("API_TOKEN")).toThrow(
      /Missing required environment variable API_TOKEN/,
    );
    expect(await fs.readFile(envFilePath, "utf8")).toBe(
      `${generatedAuthMarker}CSRF_TOKEN=fresh-csrf\nUSER_ID=fresh-user\n`,
    );
    expect(
      (await fs.readdir(privateDirectory)).filter((name) =>
        name.endsWith(".tmp"),
      ),
    ).toEqual([]);

    process.env.AUTH_STRATEGY = "static-env";
    expect(support.resolveGeneratedEnvValue("API_TOKEN")).toBe(
      "stale-ambient-token",
    );
  });

  it("allows only exact explicitly trusted live origins without a separate approval flag", async () => {
    const support = await importEmittedSupportModule();

    expect(() =>
      support.assertAllowedTarget("https://api.example.test/v1/users"),
    ).toThrow(/Add the exact origin to TRUSTED_API_ORIGINS/);

    process.env.TRUSTED_API_ORIGINS = "https://api.example.test";

    expect(() =>
      support.assertAllowedTarget("https://api.example.test/v1/users"),
    ).not.toThrow();
    expect(() =>
      support.assertAllowedTarget(
        "https://user:password@api.example.test/v1/users",
      ),
    ).toThrow(/must not contain credentials/);
    expect(() =>
      support.assertAllowedTarget("https://api.example.test:444/v1/users"),
    ).toThrow(/untrusted origin/);
    expect(() =>
      support.assertAllowedTarget("https://sub.api.example.test/v1/users"),
    ).toThrow(/untrusted origin/);
  });

  it("never deletes or replaces an unowned regular file selected as generated auth state", async () => {
    const envFilePath = path.join(tmpDir, "unowned", "important.env");
    await fs.mkdir(path.dirname(envFilePath), { recursive: true });
    await fs.writeFile(envFilePath, "IMPORTANT_USER_DATA=keep-me\n", "utf8");
    process.env.GENERATED_ENV_FILE = envFilePath;
    const support = await importEmittedSupportModule();

    expect(() => support.clearGeneratedAuthSnapshot()).toThrow(
      /unowned authentication file/,
    );
    expect(() =>
      support.replaceGeneratedEnvValues({ API_TOKEN: "new-token" }),
    ).toThrow(/unowned authentication file/);
    expect(await fs.readFile(envFilePath, "utf8")).toBe(
      "IMPORTANT_USER_DATA=keep-me\n",
    );
  });

  it("restricts replay to the exact configured loopback origin", async () => {
    const support = await importEmittedSupportModule();
    process.env.HAR_API_REPLAY_MODE = "true";
    process.env.HAR_API_REPLAY_ORIGIN = "http://127.0.0.1:4599";

    expect(() =>
      support.assertAllowedTarget("http://127.0.0.1:4599/v1/users"),
    ).not.toThrow();
    expect(() =>
      support.assertAllowedTarget("http://127.0.0.1:4600/v1/users"),
    ).toThrow(/exact loopback replay origin/);
    expect(() =>
      support.assertAllowedTarget("http://localhost:4599/v1/users"),
    ).toThrow(/exact loopback replay origin/);
    expect(() =>
      support.assertAllowedTarget("https://api.example.test/v1/users"),
    ).toThrow(/exact loopback replay origin/);
  });

  it("runs a mutating request once its exact destination is trusted", async () => {
    const support = await importEmittedSupportModule();
    process.env.TRUSTED_API_ORIGINS = "https://api.example.test";
    const fetch = vi.fn(async (_url: string, _options?: unknown) => ({}));

    await expect(
      support.sendApiRequest({
        request: { fetch },
        defaultBaseUrl: "https://api.example.test",
        path: "/v1/users",
        method: "POST",
      }),
    ).resolves.toMatchObject({ url: "https://api.example.test/v1/users" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      maxRedirects: 0,
    });
  });

  it("never infers credential destinations and honors suppressGeneratedAuth for explicit routes", async () => {
    const support = await importEmittedSupportModule({
      primaryHost: "api.example.test",
      knownHosts: ["api.example.test", "other.example.test"],
    });
    process.env.TRUSTED_API_ORIGINS = "https://api.example.test";
    process.env.AUTH_STRATEGY = "static-env";
    process.env.API_COOKIE = "session=explicit-test-cookie";
    process.env.API_AUTHORIZATION = "explicit-test-token";
    const fetch = vi.fn(async (_url: string, _options?: unknown) => ({}));
    const request = { fetch };

    await support.sendApiRequest({
      request,
      defaultBaseUrl: "https://api.example.test",
      path: "/v1/users",
      method: "GET",
    });
    expect(
      (fetch.mock.calls[0]?.[1] as { headers?: Record<string, string> })
        .headers,
    ).toBeUndefined();

    process.env.AUTH_COOKIE_ORIGINS = "https://api.example.test";
    process.env.AUTH_BEARER_ORIGINS = "https://api.example.test";
    await support.sendApiRequest({
      request,
      defaultBaseUrl: "https://api.example.test",
      path: "/v1/users",
      method: "GET",
    });
    expect(
      (fetch.mock.calls[1]?.[1] as { headers?: Record<string, string> })
        .headers,
    ).toMatchObject({
      authorization: "Bearer explicit-test-token",
      cookie: "session=explicit-test-cookie",
    });

    await support.sendApiRequest({
      request,
      defaultBaseUrl: "https://api.example.test",
      path: "/v1/users",
      method: "GET",
      suppressGeneratedAuth: true,
    });
    expect(
      (fetch.mock.calls[2]?.[1] as { headers?: Record<string, string> })
        .headers,
    ).toBeUndefined();
  });

  it("routes captured secret headers only to their exact credential allowlists and disables redirects", async () => {
    const support = await importEmittedSupportModule({
      primaryHost: "api.example.test",
      knownHosts: ["api.example.test"],
      secretHeaderNames: [
        "authorization",
        "cookie",
        "x-api-key",
        "x-csrf-token",
        "x-private-secret",
      ],
    });
    process.env.TRUSTED_API_ORIGINS = "https://api.example.test";
    const fetch = vi.fn(async (_url: string, _options?: unknown) => ({}));
    const requestHeaders = {
      authorization: "Bearer captured-secret",
      cookie: "session=captured-secret",
      "x-api-key": "captured-api-key",
      "x-csrf-token": "captured-csrf",
      "x-private-secret": "captured-private-secret",
    };

    await support.sendApiRequest({
      request: { fetch },
      defaultBaseUrl: "https://api.example.test",
      path: "/v1/users",
      method: "GET",
      headers: requestHeaders,
    });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      maxRedirects: 0,
    });
    expect(
      (fetch.mock.calls[0]?.[1] as { headers?: Record<string, string> })
        .headers,
    ).toBeUndefined();

    process.env.AUTH_BEARER_ORIGINS = "https://api.example.test";
    process.env.AUTH_COOKIE_ORIGINS = "https://api.example.test";
    process.env.AUTH_API_KEY_ORIGINS = "https://api.example.test";
    process.env.AUTH_SECRET_HEADER_ORIGINS = "https://api.example.test";
    await support.sendApiRequest({
      request: { fetch },
      defaultBaseUrl: "https://api.example.test",
      path: "/v1/users",
      method: "GET",
      headers: requestHeaders,
    });
    expect(
      (fetch.mock.calls[1]?.[1] as { headers?: Record<string, string> })
        .headers,
    ).toEqual(requestHeaders);

    delete process.env.AUTH_BEARER_ORIGINS;
    delete process.env.AUTH_COOKIE_ORIGINS;
    delete process.env.AUTH_API_KEY_ORIGINS;
    delete process.env.AUTH_SECRET_HEADER_ORIGINS;
    await support.sendApiRequest({
      request: { fetch },
      defaultBaseUrl: "https://api.example.test",
      path: "/v1/users",
      method: "GET",
      headers: { authorization: "Bearer intentionally-invalid" },
      suppressGeneratedAuth: true,
    });
    expect(
      (fetch.mock.calls[2]?.[1] as { headers?: Record<string, string> })
        .headers,
    ).toEqual({
      authorization: "Bearer intentionally-invalid",
    });
  });

  it("AUTH_STRATEGY=none ignores and global setup removes a stale generated snapshot", async () => {
    const envFilePath = path.join(tmpDir, "stale-auth", "generated-auth.env");
    await fs.mkdir(path.dirname(envFilePath), { recursive: true });
    await fs.writeFile(
      envFilePath,
      `${generatedAuthMarker}API_TOKEN=stale-token\nUSER_ID=stale-user\n`,
      "utf8",
    );
    process.env.GENERATED_ENV_FILE = envFilePath;
    process.env.AUTH_STRATEGY = "none";
    const support = await importEmittedSupportModule();

    expect(() => support.resolveGeneratedEnvValue("API_TOKEN")).toThrow(
      /Missing required environment variable API_TOKEN/,
    );

    const authSetup = await importEmittedAuthSetupModule();
    await authSetup.default();
    await expect(fs.access(envFilePath)).rejects.toThrow();
  });
});
