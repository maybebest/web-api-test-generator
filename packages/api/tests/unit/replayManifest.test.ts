import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readReplayManifest,
  validateReplayManifest,
} from "../../src/utils/replayManifest.js";

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tmpDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("replay manifest validation", () => {
  it("fails closed for missing, malformed, incomplete, and duplicate request contracts", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "har-api-replay-manifest-"),
    );
    tmpDirs.push(root);
    const manifestPath = path.join(root, "replay-manifest.json");

    expect(() => readReplayManifest(manifestPath)).toThrow(
      /missing, unreadable, or invalid JSON/,
    );
    await fs.writeFile(manifestPath, "{bad json", "utf8");
    expect(() => readReplayManifest(manifestPath)).toThrow(/invalid JSON/);
    expect(() => validateReplayManifest({ routes: [] })).toThrow(
      /non-empty routes array/,
    );
    expect(() =>
      validateReplayManifest({ routes: [route({ pathWithQuery: undefined })] }),
    ).toThrow(/pathWithQuery/);
    expect(() =>
      validateReplayManifest({ routes: [route({ requestHeaders: [] })] }),
    ).toThrow(/requestHeaders/);
    expect(() =>
      validateReplayManifest({
        routes: [route(), route({ status: 201, responseBody: { ok: false } })],
      }),
    ).toThrow(/ambiguous duplicate replay request/);
  });

  it("accepts the same method/path on different captured hosts and preserves the complete contract", () => {
    const manifest = validateReplayManifest({
      routes: [
        route(),
        route({
          hostname: "two.example.test",
          status: 201,
          responseBody: { host: "two" },
        }),
      ],
    });

    expect(manifest.routes).toHaveLength(2);
    expect(manifest.routes[0]).toMatchObject({
      hostname: "api.example.test",
      method: "POST",
      pathWithQuery: "/v1/users/${USER_ID}?expand=profile",
      requestHeaders: {
        accept: "application/json",
        "content-type": "application/json",
        "x-site-uuid": "${X_SITE_UUID}",
      },
      requestBody: { name: "${TEST_EMAIL}", roles: ["admin"] },
      responseBody: { id: "${USER_ID}", ok: true },
    });
  });

  it("rejects unsafe targets, reserved host headers, and non-JSON bodies", () => {
    expect(() =>
      validateReplayManifest({
        routes: [
          route({ pathWithQuery: "https://live.example.test/v1/users" }),
        ],
      }),
    ).toThrow(/absolute-path template/);
    expect(() =>
      validateReplayManifest({
        routes: [
          route({
            requestHeaders: { "x-har-replay-host": "other.example.test" },
          }),
        ],
      }),
    ).toThrow(/reserved header/);
    expect(() =>
      validateReplayManifest({ routes: [route({ requestBody: undefined })] }),
    ).toThrow(/JSON value/);
  });

  it("forces replay routing, deterministic placeholders, and auth isolation over ambient variables", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "har-api-replay-config-"),
    );
    tmpDirs.push(root);
    const manifestPath = path.join(root, "replay-manifest.json");
    await fs.writeFile(
      manifestPath,
      JSON.stringify({ routes: [route()] }),
      "utf8",
    );

    const port = "48765";
    const script = [
      "import('./playwright.replay.config.ts').then((module) => {",
      "console.log(JSON.stringify({",
      "baseUrl: process.env.BASE_URL,",
      "hostUrl: process.env.BASE_URL_API_EXAMPLE_TEST,",
      "replayMode: process.env.HAR_API_REPLAY_MODE,",
      "replayOrigin: process.env.HAR_API_REPLAY_ORIGIN,",
      "userId: process.env.USER_ID,",
      "manifest: module.default.webServer.env.REPLAY_MANIFEST,",
      "reuse: module.default.webServer.reuseExistingServer",
      "}));",
      "});",
    ].join("");
    const result = spawnSync(
      path.resolve("node_modules/.bin/tsx"),
      ["-e", script],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          REPLAY_MANIFEST: manifestPath,
          REPLAY_PORT: port,
          BASE_URL: "https://live.example.invalid",
          BASE_URL_API_EXAMPLE_TEST: "https://live.example.invalid",
          USER_ID: "ambient-user",
        },
        encoding: "utf8",
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      baseUrl: `http://127.0.0.1:${port}`,
      hostUrl: `http://127.0.0.1:${port}`,
      replayMode: "true",
      replayOrigin: `http://127.0.0.1:${port}`,
      userId: "replay-user",
      manifest: manifestPath,
      reuse: false,
    });
  });
});

function route(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    method: "POST",
    pathPattern: "/v1/users/{id}",
    pathWithQuery: "/v1/users/${USER_ID}?expand=profile",
    hostname: "api.example.test",
    requestHeaders: {
      accept: "application/json",
      "content-type": "application/json",
      "x-site-uuid": "${X_SITE_UUID}",
    },
    requestContentType: "application/json",
    requestBody: { name: "${TEST_EMAIL}", roles: ["admin"] },
    status: 200,
    contentType: "application/json",
    responseBody: { id: "${USER_ID}", ok: true },
    ...overrides,
  };
}
