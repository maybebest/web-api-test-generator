import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

const tmpDirs: string[] = [];
type ReplayChild = ChildProcessByStdio<null, Readable, Readable>;

const children: ReplayChild[] = [];
const scriptPath = path.resolve("scripts/replay-mock-server.mjs");

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill("SIGTERM");
  }
  await Promise.all(
    tmpDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("request-aware replay mock", () => {
  it("fails before listening when the manifest is malformed, empty, or missing request contract fields", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "har-api-replay-mock-invalid-"),
    );
    tmpDirs.push(root);
    const manifestPath = path.join(root, "manifest.json");

    await fs.writeFile(manifestPath, "{bad json", "utf8");
    const malformed = runInvalidManifest(manifestPath, await openPort());
    expect(malformed.status).not.toBe(0);
    expect(malformed.stderr).toContain("invalid JSON");

    await fs.writeFile(manifestPath, '{"routes":[]}', "utf8");
    const empty = runInvalidManifest(manifestPath, await openPort());
    expect(empty.status).not.toBe(0);
    expect(empty.stderr).toContain("non-empty routes array");

    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        routes: [
          {
            method: "GET",
            pathPattern: "/v1/users",
            hostname: "api.example.test",
          },
        ],
      }),
      "utf8",
    );
    const incomplete = runInvalidManifest(manifestPath, await openPort());
    expect(incomplete.status).not.toBe(0);
    expect(incomplete.stderr).toContain("pathWithQuery");
  });

  it("matches host, exact query, declared headers, canonical JSON body, and returns captured response body", async () => {
    const { port } = await startServer([
      jsonRoute(),
      jsonRoute({
        hostname: "two.example.test",
        status: 202,
        responseBody: { host: "two", ok: true },
      }),
    ]);
    const baseUrl = `http://127.0.0.1:${port}`;

    expect((await fetch(`${baseUrl}/__health`)).status).toBe(200);
    const response = await fetch(
      `${baseUrl}/v1/users/replay-user?expand=profile&tag=a&tag=b`,
      requestInit(
        "api.example.test",
        JSON.stringify({ roles: ["admin"], name: "replay@example.test" }),
      ),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ id: "replay-user", ok: true });

    const secondHost = await fetch(
      `${baseUrl}/v1/users/replay-user?expand=profile&tag=a&tag=b`,
      requestInit(
        "two.example.test",
        JSON.stringify({ name: "replay@example.test", roles: ["admin"] }),
      ),
    );
    expect(secondHost.status).toBe(202);
    expect(await secondHost.json()).toEqual({ host: "two", ok: true });
  });

  it("fails closed for wrong query, declared header, body, host, method, and undeclared path", async () => {
    const { port } = await startServer([jsonRoute()]);
    const baseUrl = `http://127.0.0.1:${port}`;
    const validBody = JSON.stringify({
      name: "replay@example.test",
      roles: ["admin"],
    });

    const wrongQuery = await fetch(
      `${baseUrl}/v1/users/replay-user?expand=profile&tag=b&tag=a`,
      requestInit("api.example.test", validBody),
    );
    expect(wrongQuery.status).toBe(409);
    expect(await wrongQuery.json()).toMatchObject({
      mismatches: expect.arrayContaining(["path-or-query"]),
    });

    const wrongHeader = await fetch(
      `${baseUrl}/v1/users/replay-user?expand=profile&tag=a&tag=b`,
      {
        ...requestInit("api.example.test", validBody),
        headers: {
          ...requestInit("api.example.test", validBody).headers,
          "x-site-uuid": "wrong-site",
        },
      },
    );
    expect(wrongHeader.status).toBe(409);
    expect(await wrongHeader.json()).toMatchObject({
      mismatches: expect.arrayContaining(["header:x-site-uuid"]),
    });

    const wrongBody = await fetch(
      `${baseUrl}/v1/users/replay-user?expand=profile&tag=a&tag=b`,
      requestInit(
        "api.example.test",
        JSON.stringify({ name: "Mallory", roles: ["admin"] }),
      ),
    );
    expect(wrongBody.status).toBe(409);
    expect(await wrongBody.json()).toMatchObject({
      mismatches: expect.arrayContaining(["body"]),
    });

    expect(
      (
        await fetch(
          `${baseUrl}/v1/users/replay-user?expand=profile&tag=a&tag=b`,
          requestInit("unknown.example.test", validBody),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(
          `${baseUrl}/v1/users/replay-user?expand=profile&tag=a&tag=b`,
          {
            ...requestInit("api.example.test", validBody),
            method: "PUT",
          },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${baseUrl}/v1/undeclared`, {
          headers: { "x-har-replay-host": "api.example.test" },
        })
      ).status,
    ).toBe(404);
  });

  it("compares form pairs and handles captured string bodies without depending on line endings", async () => {
    const { port } = await startServer([
      {
        method: "POST",
        pathPattern: "/v1/preferences",
        pathWithQuery: "/v1/preferences",
        hostname: "api.example.test",
        requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
        requestContentType: "application/x-www-form-urlencoded",
        requestBody: "enabled=1&enabled=0&token=${CSRF_TOKEN}",
        status: 204,
        contentType: "application/json",
      },
      {
        method: "POST",
        pathPattern: "/v1/raw",
        pathWithQuery: "/v1/raw",
        hostname: "api.example.test",
        requestHeaders: { "content-type": "text/plain" },
        requestBody: "first\r\nsecond",
        status: 200,
        contentType: "text/plain",
        responseBody: "accepted",
      },
    ]);
    const baseUrl = `http://127.0.0.1:${port}`;

    const form = await fetch(`${baseUrl}/v1/preferences`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-har-replay-host": "api.example.test",
      },
      body: "enabled=1&enabled=0&token=replay-csrf-token",
    });
    expect(form.status).toBe(204);

    const reordered = await fetch(`${baseUrl}/v1/preferences`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-har-replay-host": "api.example.test",
      },
      body: "enabled=0&enabled=1&token=replay-csrf-token",
    });
    expect(reordered.status).toBe(409);

    const text = await fetch(`${baseUrl}/v1/raw`, {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        "x-har-replay-host": "api.example.test",
      },
      body: "first\nsecond",
    });
    expect(text.status).toBe(200);
    expect(await text.text()).toBe("accepted");
  });
});

function jsonRoute(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    method: "POST",
    pathPattern: "/v1/users/{id}",
    pathWithQuery: "/v1/users/${USER_ID}?expand=profile&tag=a&tag=b",
    hostname: "api.example.test",
    requestHeaders: {
      accept: "application/json",
      "content-type": "application/json",
      "x-site-uuid": "${X_SITE_UUID}",
    },
    requestContentType: "application/json",
    requestBody: { name: "${TEST_EMAIL}", roles: ["admin"] },
    status: 201,
    contentType: "application/json; charset=utf-8",
    responseBody: { id: "${USER_ID}", ok: true },
    ...overrides,
  };
}

function requestInit(hostname: string, body: string): RequestInit {
  return {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-har-replay-host": hostname,
      "x-site-uuid": "replay-site",
    },
    body,
  };
}

function runInvalidManifest(manifestPath: string, port: number) {
  return spawnSync(process.execPath, [scriptPath], {
    env: {
      ...process.env,
      REPLAY_MANIFEST: manifestPath,
      REPLAY_PORT: String(port),
    },
    encoding: "utf8",
  });
}

async function startServer(
  routes: Array<Record<string, unknown>>,
): Promise<{ port: number }> {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "har-api-replay-mock-route-"),
  );
  tmpDirs.push(root);
  const manifestPath = path.join(root, "manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify({ routes }), "utf8");
  const port = await openPort();
  const child = spawn(process.execPath, [scriptPath], {
    env: {
      ...process.env,
      REPLAY_MANIFEST: manifestPath,
      REPLAY_PORT: String(port),
      CSRF_TOKEN: "replay-csrf-token",
      TEST_EMAIL: "replay@example.test",
      USER_ID: "replay-user",
      X_SITE_UUID: "replay-site",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  await waitForListening(child);
  return { port };
}

async function openPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a replay test port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForListening(child: ReplayChild): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Replay mock did not start in time.")),
      5000,
    );
    const onData = (chunk: Buffer) => {
      if (chunk.toString("utf8").includes("[replay-mock] listening")) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Replay mock exited before listening (code ${code}).`));
    });
  });
}
