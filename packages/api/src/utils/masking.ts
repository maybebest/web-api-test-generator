import type { HarApiTestConfig } from '../types/config.js';
import type { JsonArray, JsonObject, JsonValue } from '../types/json.js';
import { isJsonArray, isJsonObject } from '../types/json.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const bearerPattern = /^bearer\s+.+$/i;
const tokenLikePattern = /^[A-Za-z0-9._~+/=-]{24,}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isoDateLikePattern = /^\d{4}-\d{2}-\d{2}(?:T|\b)/;
const numericIdentifierPattern = /^\d{10,}$/;
// A media type such as application/x-www-form-urlencoded or application/vnd.api+json.
// These pass tokenLikePattern (they contain only token-safe characters) but must NOT be
// treated as secrets, otherwise structural headers like content-type get masked to ${API_KEY}.
const mediaTypePattern = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+*-]*$/i;
// Embedded-secret sweeps applied inside larger strings (stringified JSON, form payloads,
// socket.io framed messages) where the secret is not the whole value.
const embeddedEmailPattern = /[^\s@"]+@[^\s@".]+\.[^\s@"]+/g;
const jwtPattern = /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]+)?/g;
const embeddedBearerPattern = /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;

// Headers whose values are structural/protocol metadata, never credentials. They are never
// masked by value shape (only dropped if explicitly listed in secretHeaderNames).
const structuralHeaderNames = new Set([
  'accept',
  'accept-charset',
  'accept-language',
  'accept-ranges',
  'cache-control',
  'content-disposition',
  'content-encoding',
  'content-language',
  'content-type',
  'pragma',
  'vary'
]);

export function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase();
}

export function maskHeaders(
  headers: Record<string, string>,
  config: HarApiTestConfig
): Record<string, string> {
  const output: Record<string, string> = {};
  const ignored = new Set(config.ignoredHeaderNames.map(normalizeHeaderName));
  const secret = new Set(config.secretHeaderNames.map(normalizeHeaderName));

  for (const [rawName, rawValue] of Object.entries(headers).sort(([left], [right]) => left.localeCompare(right))) {
    const name = normalizeHeaderName(rawName);
    if (ignored.has(name)) {
      continue;
    }

    if (secret.has(name)) {
      output[name] = headerPlaceholder(name);
      continue;
    }

    // Structural headers keep their literal value; never run value-shape secret detection on them.
    if (structuralHeaderNames.has(name)) {
      output[name] = rawValue;
      continue;
    }

    if (isSecretLikeValue(rawValue)) {
      output[name] = headerPlaceholder(name);
      continue;
    }

    if (isDynamicHeaderValue(rawValue)) {
      output[name] = headerEnvironmentPlaceholder(name);
      continue;
    }

    output[name] = maskString(rawValue);
  }

  return output;
}

export function maskJsonValue(value: JsonValue, config: HarApiTestConfig, path: string[] = []): JsonValue {
  if (typeof value === 'string') {
    // Recurse into JSON encoded as a string (e.g. Intercom user_data: "{\"email\":...}").
    const embedded = tryParseJsonContainer(value);
    if (embedded !== undefined) {
      return JSON.stringify(maskJsonValue(embedded, config, path));
    }

    return maskString(value, path[path.length - 1]);
  }

  if (isJsonArray(value)) {
    return value.map((item, index) => maskJsonValue(item, config, [...path, String(index)])) as JsonArray;
  }

  if (isJsonObject(value)) {
    const output: JsonObject = {};
    for (const [key, child] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
      output[key] = isSecretField(key, config)
        ? placeholderForField(key)
        : maskJsonValue(child, config, [...path, key]);
    }
    return output;
  }

  return value;
}

export function maskString(value: string, fieldName?: string): string {
  if (fieldName && /email/i.test(fieldName)) {
    return '${TEST_EMAIL}';
  }

  if (fieldName && /(csrf|xsrf)/i.test(fieldName)) {
    return '${CSRF_TOKEN}';
  }

  if (fieldName && /password/i.test(fieldName)) {
    return '${TEST_PASSWORD}';
  }

  if (fieldName && /(token|secret|key|session|cookie)/i.test(fieldName)) {
    return '${API_KEY}';
  }

  if (emailPattern.test(value)) {
    return '${TEST_EMAIL}';
  }

  if (bearerPattern.test(value)) {
    return '${API_AUTHORIZATION}';
  }

  if (tokenLikePattern.test(value) && !looksLikeReadableText(value)) {
    return '${API_TOKEN}';
  }

  // The value is not a single secret, but may embed one (free text, framed payloads).
  return sweepEmbeddedSecrets(value);
}

export function isSecretField(fieldName: string, config: HarApiTestConfig): boolean {
  const normalized = fieldName.toLowerCase();
  return config.secretFieldNames.some((secret) => normalized.includes(secret.toLowerCase()));
}

export function isSecretLikeValue(value: string): boolean {
  // Media types and dynamic identifiers (UUIDs, timestamps, numeric ids) are not secrets;
  // dynamic ids are handled separately by isDynamicHeaderValue.
  if (mediaTypePattern.test(value) || isDynamicHeaderValue(value)) {
    return false;
  }

  return bearerPattern.test(value) || (tokenLikePattern.test(value) && !looksLikeReadableText(value));
}

export function isDynamicHeaderValue(value: string): boolean {
  return uuidPattern.test(value) || numericIdentifierPattern.test(value) || isoDateLikePattern.test(value);
}

/**
 * Replace secrets embedded inside a larger string (stringified JSON bodies, urlencoded blobs,
 * socket.io framed messages). Whole-value secrets are handled earlier in maskString.
 */
export function sweepEmbeddedSecrets(value: string): string {
  if (!value || value.length < 8) {
    return value;
  }

  return value
    .replace(jwtPattern, '${API_TOKEN}')
    .replace(embeddedBearerPattern, 'Bearer ${API_AUTHORIZATION}')
    .replace(embeddedEmailPattern, '${TEST_EMAIL}');
}

function tryParseJsonContainer(value: string): JsonValue | undefined {
  const trimmed = value.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as JsonValue;
    return isJsonObject(parsed) || isJsonArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function headerPlaceholder(headerName: string): string {
  if (headerName === 'authorization') {
    return '${API_AUTHORIZATION}';
  }

  if (headerName.includes('csrf') || headerName.includes('xsrf')) {
    return '${CSRF_TOKEN}';
  }

  if (headerName === 'cookie' || headerName === 'set-cookie') {
    return '${API_COOKIE}';
  }

  return '${API_KEY}';
}

function headerEnvironmentPlaceholder(headerName: string): string {
  const envName = normalizeHeaderName(headerName).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
  return `\${${envName || 'HEADER_VALUE'}}`;
}

function placeholderForField(fieldName: string): string {
  const normalized = fieldName.toLowerCase();
  if (normalized.includes('email')) {
    return '${TEST_EMAIL}';
  }

  if (normalized.includes('password')) {
    return '${TEST_PASSWORD}';
  }

  if (normalized.includes('authorization')) {
    return '${API_AUTHORIZATION}';
  }

  if (normalized.includes('csrf') || normalized.includes('xsrf')) {
    return '${CSRF_TOKEN}';
  }

  if (normalized.includes('cookie') || normalized.includes('session')) {
    return '${API_COOKIE}';
  }

  return '${API_KEY}';
}

function looksLikeReadableText(value: string): boolean {
  if (/\s/.test(value)) {
    return true;
  }

  // Only treat short, purely word-like values as readable. Longer hyphenated strings can be
  // URL-safe tokens or chained GUIDs and must NOT be exempted from masking.
  return value.length <= 24 && /^[a-z0-9-]+$/i.test(value);
}
