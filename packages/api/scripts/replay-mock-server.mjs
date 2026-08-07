#!/usr/bin/env node
// Deterministic, credential-free replay server for generated active @smoke tests.
//
// Each manifest route is a complete masked request/response contract. The generated support layer
// routes every captured origin to this loopback server and identifies the original host with
// x-har-replay-host. A request is accepted only when host, method, resolved path+query, every stable
// declared header, and body match. Contract mismatches fail closed instead of returning a canned 2xx.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.REPLAY_PORT ?? 4599);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("REPLAY_PORT must be an integer between 1 and 65535.");
}

const dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath =
  process.env.REPLAY_MANIFEST ??
  path.resolve(dirname, "../tests/generated/replay-manifest.json");
const maxRequestBodyBytes = 5 * 1024 * 1024;

function patternToRegExp(pathPattern) {
  const source = pathPattern
    .split(/\{[^}]+\}/)
    .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]+");
  return new RegExp(`^${source}$`);
}

function loadRoutes() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Replay manifest is missing, unreadable, or invalid JSON at ${manifestPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!isRecord(raw) || !Array.isArray(raw.routes) || raw.routes.length === 0) {
    throw new Error(
      `Replay manifest must contain a non-empty routes array: ${manifestPath}`,
    );
  }

  const routeKeys = new Set();
  const mapped = raw.routes.map((route, index) => {
    const label = `Replay manifest route ${index}`;
    if (!isRecord(route)) {
      throw new Error(`${label} must be an object.`);
    }

    const method = requiredString(
      route.method,
      `${label} method`,
    ).toUpperCase();
    const pathPattern = requestTarget(
      route.pathPattern,
      `${label} pathPattern`,
      false,
    );
    const pathWithQuery = requestTarget(
      route.pathWithQuery,
      `${label} pathWithQuery`,
      true,
    );
    const hostname = requiredString(
      route.hostname,
      `${label} hostname`,
    ).toLowerCase();
    const requestHeaders = declaredHeaders(
      route.requestHeaders,
      `${label} requestHeaders`,
    );
    const requestContentType = optionalHeaderValue(
      route.requestContentType,
      `${label} requestContentType`,
    );
    const status = route.status;
    const contentType = requiredString(
      route.contentType,
      `${label} contentType`,
    );

    if (!/^[A-Z]+$/.test(method)) {
      throw new Error(`${label} has an invalid method.`);
    }
    if (
      !/^[a-z0-9.-]+$/.test(hostname) ||
      hostname.startsWith(".") ||
      hostname.endsWith(".")
    ) {
      throw new Error(`${label} has an invalid hostname.`);
    }
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      throw new Error(`${label} has an invalid status.`);
    }
    if (/\r|\n/.test(contentType)) {
      throw new Error(`${label} has an invalid contentType.`);
    }

    const hasRequestBody = Object.prototype.hasOwnProperty.call(
      route,
      "requestBody",
    );
    const hasResponseBody = Object.prototype.hasOwnProperty.call(
      route,
      "responseBody",
    );
    if (
      (hasRequestBody && !isJsonValue(route.requestBody)) ||
      (hasResponseBody && !isJsonValue(route.responseBody))
    ) {
      throw new Error(
        `${label} requestBody and responseBody must be JSON values when present.`,
      );
    }

    const key = canonicalStringify({
      hostname,
      method,
      pathWithQuery,
      requestHeaders,
      requestContentType: requestContentType ?? null,
      hasRequestBody,
      requestBody: hasRequestBody ? route.requestBody : null,
    });
    if (routeKeys.has(key)) {
      throw new Error(
        `${label} duplicates the replay request contract for ${hostname} ${method} ${pathWithQuery}.`,
      );
    }
    routeKeys.add(key);

    const resolvedPathWithQuery = resolveTemplate(pathWithQuery);
    const resolvedHeaders = Object.fromEntries(
      Object.entries(requestHeaders).map(([name, value]) => [
        name,
        resolveTemplate(value),
      ]),
    );
    const resolvedRequestBody = hasRequestBody
      ? resolveJsonTemplates(route.requestBody)
      : undefined;

    return {
      method,
      hostname,
      pathPattern,
      pathMatch: patternToRegExp(pathPattern),
      pathWithQuery,
      resolvedPathWithQuery,
      requestHeaders: resolvedHeaders,
      requestContentType,
      hasRequestBody,
      requestBody: resolvedRequestBody,
      status,
      contentType,
      hasResponseBody,
      responseBody: hasResponseBody
        ? resolveJsonTemplates(route.responseBody)
        : undefined,
    };
  });

  return mapped;
}

const routes = loadRoutes();
console.log(
  `[replay-mock] loaded ${routes.length} request contract(s) from ${manifestPath}`,
);

const server = http.createServer(async (req, res) => {
  const requestUrl = req.url ?? "/";
  const pathname = requestUrl.split("?", 1)[0];
  if (pathname === "/__health") {
    req.resume();
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    sendJson(res, 413, {
      error: "replay request body exceeds the configured limit",
    });
    return;
  }

  const result = matchRequest(req, requestUrl, body);
  if (result.kind === "not-found") {
    sendJson(res, 404, { error: "replay route not found" });
    return;
  }
  if (result.kind === "mismatch") {
    // Reasons identify contract dimensions only; never echo resolved credentials or request bodies.
    sendJson(res, 409, {
      error: "replay request contract mismatch",
      mismatches: result.reasons,
    });
    return;
  }

  const route = result.route;
  res.writeHead(route.status, { "content-type": route.contentType });
  res.end(responseBodyFor(route));
});

function matchRequest(req, requestUrl, body) {
  const method = (req.method ?? "GET").toUpperCase();
  const originalHostHeader = req.headers["x-har-replay-host"];
  const originalHost =
    typeof originalHostHeader === "string"
      ? originalHostHeader.trim().toLowerCase()
      : "";
  const pathname = requestUrl.split("?", 1)[0];
  const candidates = routes.filter(
    (route) =>
      route.hostname === originalHost &&
      route.method === method &&
      route.pathMatch.test(pathname),
  );

  if (candidates.length === 0) {
    return { kind: "not-found" };
  }

  let closestReasons = ["request"];
  for (const route of candidates) {
    const reasons = requestMismatches(route, req.headers, requestUrl, body);
    if (reasons.length === 0) {
      return { kind: "match", route };
    }
    if (
      reasons.length < closestReasons.length ||
      closestReasons[0] === "request"
    ) {
      closestReasons = reasons;
    }
  }
  return { kind: "mismatch", reasons: closestReasons };
}

function requestMismatches(
  route,
  actualHeaders,
  actualPathWithQuery,
  actualBody,
) {
  const reasons = [];
  if (actualPathWithQuery !== route.resolvedPathWithQuery) {
    reasons.push("path-or-query");
  }

  for (const [name, expectedValue] of Object.entries(route.requestHeaders)) {
    const actualValue = actualHeaders[name];
    if (typeof actualValue !== "string" || actualValue !== expectedValue) {
      reasons.push(`header:${name}`);
    }
  }

  const bodyReason = compareBody(route, actualHeaders, actualBody);
  if (bodyReason) {
    reasons.push(bodyReason);
  }
  return reasons;
}

function compareBody(route, actualHeaders, actualBody) {
  if (!route.hasRequestBody) {
    return actualBody.length === 0 ? undefined : "body";
  }

  const contentType = String(
    route.requestHeaders["content-type"] ??
      route.requestContentType ??
      actualHeaders["content-type"] ??
      "",
  ).toLowerCase();
  const actualText = actualBody.toString("utf8");

  if (contentType.includes("json")) {
    try {
      return canonicalStringify(JSON.parse(actualText)) ===
        canonicalStringify(route.requestBody)
        ? undefined
        : "body";
    } catch {
      return typeof route.requestBody === "string" &&
        actualText === route.requestBody
        ? undefined
        : "body";
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    if (typeof route.requestBody !== "string") {
      return "body";
    }
    return canonicalStringify([
      ...new URLSearchParams(actualText).entries(),
    ]) ===
      canonicalStringify([...new URLSearchParams(route.requestBody).entries()])
      ? undefined
      : "body";
  }

  if (typeof route.requestBody === "string") {
    return normalizeLineEndings(actualText) ===
      normalizeLineEndings(route.requestBody)
      ? undefined
      : "body";
  }

  return actualText === JSON.stringify(route.requestBody) ? undefined : "body";
}

function responseBodyFor(route) {
  if (route.hasResponseBody) {
    if (route.contentType.toLowerCase().includes("json")) {
      return JSON.stringify(route.responseBody);
    }
    return typeof route.responseBody === "string"
      ? route.responseBody
      : JSON.stringify(route.responseBody);
  }
  if (route.contentType.toLowerCase().includes("json")) {
    return "{}";
  }
  if (route.contentType.toLowerCase().includes("html")) {
    return "<!doctype html><html></html>";
  }
  return "";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;
    req.on("data", (chunk) => {
      if (exceeded) {
        return;
      }
      size += chunk.length;
      if (size > maxRequestBodyBytes) {
        exceeded = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () =>
      exceeded
        ? reject(new Error("body limit"))
        : resolve(Buffer.concat(chunks)),
    );
    req.on("error", reject);
  });
}

function resolveTemplate(value) {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name) => {
    const resolved = process.env[name];
    if (resolved === undefined || resolved === "") {
      throw new Error(
        `Replay manifest requires deterministic placeholder ${name}, but it is not set.`,
      );
    }
    return resolved;
  });
}

function resolveJsonTemplates(value) {
  if (typeof value === "string") {
    return resolveTemplate(value);
  }
  if (Array.isArray(value)) {
    return value.map(resolveJsonTemplates);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        resolveJsonTemplates(child),
      ]),
    );
  }
  return value;
}

function requestTarget(value, label, allowQuery) {
  const result = requiredString(value, label);
  if (
    !result.startsWith("/") ||
    result.startsWith("//") ||
    /[\r\n#]/.test(result) ||
    (!allowQuery && result.includes("?"))
  ) {
    throw new Error(`${label} must be a safe absolute-path template.`);
  }
  return result;
}

function declaredHeaders(value, label) {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object of declared header strings.`);
  }
  const result = {};
  for (const [rawName, rawValue] of Object.entries(value).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const name = rawName.trim().toLowerCase();
    if (
      !/^[!#$%&'*+\-.^_`|~0-9a-z]+$/.test(name) ||
      name === "x-har-replay-host"
    ) {
      throw new Error(`${label} contains an invalid or reserved header name.`);
    }
    if (typeof rawValue !== "string" || /[\r\n]/.test(rawValue)) {
      throw new Error(`${label}.${name} must be a string without line breaks.`);
    }
    result[name] = rawValue;
  }
  return result;
}

function optionalHeaderValue(value, label) {
  if (value === undefined) {
    return undefined;
  }
  const result = requiredString(value, label);
  if (/[\r\n]/.test(result)) {
    throw new Error(`${label} must not contain line breaks.`);
  }
  return result;
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function isJsonValue(value) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function canonicalStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeLineEndings(value) {
  return value.replace(/\r\n/g, "\n");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

server.listen(port, "127.0.0.1", () => {
  console.log(`[replay-mock] listening on http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
