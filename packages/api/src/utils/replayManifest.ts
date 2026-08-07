import fs from "node:fs";
import type { JsonValue } from "../types/json.js";

export interface ReplayManifestRoute {
  method: string;
  pathPattern: string;
  pathWithQuery: string;
  hostname: string;
  requestHeaders: Record<string, string>;
  requestContentType?: string;
  requestBody?: JsonValue;
  status: number;
  contentType: string;
  responseBody?: JsonValue;
}

export interface ReplayManifest {
  routes: ReplayManifestRoute[];
}

/** Reads and validates the complete request/response contract used by credential-free replay. */
export function readReplayManifest(filePath: string): ReplayManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `Replay manifest is missing, unreadable, or invalid JSON at ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return validateReplayManifest(parsed, filePath);
}

export function validateReplayManifest(
  value: unknown,
  label = "replay manifest",
): ReplayManifest {
  if (
    !isRecord(value) ||
    !Array.isArray(value.routes) ||
    value.routes.length === 0
  ) {
    throw new Error(`${label} must contain a non-empty routes array.`);
  }

  const routes = value.routes.map((route, index) =>
    validateRoute(route, index, label),
  );
  const routeKeys = new Set<string>();
  for (const route of routes) {
    // Host is explicit because all captured origins share one loopback listener. Different hosts may
    // legitimately expose the same method/path; only a fully identical request contract is ambiguous.
    const key = canonicalStringify({
      hostname: route.hostname,
      method: route.method,
      pathWithQuery: route.pathWithQuery,
      requestHeaders: route.requestHeaders,
      requestContentType: route.requestContentType ?? null,
      hasRequestBody: route.requestBody !== undefined,
      requestBody: route.requestBody ?? null,
    });
    if (routeKeys.has(key)) {
      throw new Error(
        `${label} contains an ambiguous duplicate replay request: ${route.hostname} ${route.method} ${route.pathWithQuery}`,
      );
    }
    routeKeys.add(key);
  }

  return { routes };
}

function validateRoute(
  value: unknown,
  index: number,
  label: string,
): ReplayManifestRoute {
  if (!isRecord(value)) {
    throw new Error(`${label} route ${index} must be an object.`);
  }

  const routeLabel = `${label} route ${index}`;
  const method = requiredString(
    value.method,
    `${routeLabel} method`,
  ).toUpperCase();
  const pathPattern = validateRequestTarget(
    requiredString(value.pathPattern, `${routeLabel} pathPattern`),
    `${routeLabel} pathPattern`,
  );
  const pathWithQuery = validateRequestTarget(
    requiredString(value.pathWithQuery, `${routeLabel} pathWithQuery`),
    `${routeLabel} pathWithQuery`,
    true,
  );
  const hostname = requiredString(
    value.hostname,
    `${routeLabel} hostname`,
  ).toLowerCase();
  const requestHeaders = validateHeaders(
    value.requestHeaders,
    `${routeLabel} requestHeaders`,
  );
  const requestContentType = optionalHeaderValue(
    value.requestContentType,
    `${routeLabel} requestContentType`,
  );
  const contentType = requiredString(
    value.contentType,
    `${routeLabel} contentType`,
  );
  const status = value.status;

  if (!/^[A-Z]+$/.test(method)) {
    throw new Error(`${routeLabel} has an invalid HTTP method.`);
  }
  if (
    !/^[a-z0-9.-]+$/.test(hostname) ||
    hostname.startsWith(".") ||
    hostname.endsWith(".")
  ) {
    throw new Error(`${routeLabel} has an invalid hostname.`);
  }
  if (
    !Number.isInteger(status) ||
    Number(status) < 100 ||
    Number(status) > 599
  ) {
    throw new Error(`${routeLabel} has an invalid HTTP status.`);
  }
  if (/\r|\n/.test(contentType)) {
    throw new Error(`${routeLabel} contentType must not contain line breaks.`);
  }

  const requestBody = optionalJsonValue(value, "requestBody", routeLabel);
  const responseBody = optionalJsonValue(value, "responseBody", routeLabel);

  return {
    method,
    pathPattern,
    pathWithQuery,
    hostname,
    requestHeaders,
    ...(requestContentType ? { requestContentType } : {}),
    ...(requestBody.present ? { requestBody: requestBody.value } : {}),
    status: Number(status),
    contentType,
    ...(responseBody.present ? { responseBody: responseBody.value } : {}),
  };
}

function validateRequestTarget(
  value: string,
  label: string,
  allowQuery = false,
): string {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\r\n#]/.test(value)
  ) {
    throw new Error(
      `${label} must be an absolute-path template without an origin, fragment, or line breaks.`,
    );
  }
  if (!allowQuery && value.includes("?")) {
    throw new Error(`${label} must not contain a query string.`);
  }
  return value;
}

function validateHeaders(
  value: unknown,
  label: string,
): Record<string, string> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object of declared header strings.`);
  }

  const headers: Record<string, string> = {};
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
    headers[name] = rawValue;
  }
  return headers;
}

function optionalHeaderValue(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const result = requiredString(value, label);
  if (/[\r\n]/.test(result)) {
    throw new Error(`${label} must not contain line breaks.`);
  }
  return result;
}

function optionalJsonValue(
  record: Record<string, unknown>,
  key: string,
  label: string,
): { present: false } | { present: true; value: JsonValue } {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return { present: false };
  }
  if (!isJsonValue(record[key])) {
    throw new Error(`${label} ${key} must be a JSON value.`);
  }
  return { present: true, value: record[key] };
}

function isJsonValue(value: unknown): value is JsonValue {
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

function canonicalStringify(
  value: JsonValue | Record<string, unknown>,
): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalStringify(value[key] as JsonValue | Record<string, unknown>)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
