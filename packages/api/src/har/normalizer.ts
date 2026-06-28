import type { HarApiTestConfig } from '../types/config.js';
import type { HarNameValue, NormalizedHarEntry, ParsedHarEntry, SupportedHttpMethod } from '../types/har.js';
import type { JsonValue } from '../types/json.js';
import { maskHeaders, maskJsonValue, maskString, normalizeHeaderName } from '../utils/masking.js';
import {
  buildPathWithQuery,
  buildPathWithQueryFromPairs,
  firstStablePathSegment,
  inferPathPattern,
  makeEndpointId,
  maskDynamicPath,
  slugify,
  toBaseUrl
} from '../utils/url.js';

export function normalizeHarEntries(
  entries: ParsedHarEntry[],
  config: HarApiTestConfig,
  baseUrlOverride?: string
): NormalizedHarEntry[] {
  return entries
    .map((entry) => normalizeHarEntry(entry, config, baseUrlOverride))
    .sort((left, right) => {
      const groupCompare = left.groupName.localeCompare(right.groupName);
      if (groupCompare !== 0) {
        return groupCompare;
      }

      const pathCompare = left.pathPattern.localeCompare(right.pathPattern);
      if (pathCompare !== 0) {
        return pathCompare;
      }

      return left.method.localeCompare(right.method);
    });
}

export function normalizeHarEntry(
  entry: ParsedHarEntry,
  config: HarApiTestConfig,
  baseUrlOverride?: string
): NormalizedHarEntry {
  const url = new URL(entry.request.url);
  const method = entry.request.method.toUpperCase() as SupportedHttpMethod;
  const queryPairs = entry.request.queryString ?? urlSearchParamsToHarPairs(url.searchParams);
  const rawQuery = toRecord(queryPairs);
  const query = maskQuery(rawQuery);
  const { pattern, dynamicSegments } = inferPathPattern(url.pathname);
  const { maskedPath, placeholders } = maskDynamicPath(url.pathname);
  const id = makeEndpointId(method, `${url.hostname}${pattern}${JSON.stringify(query)}`, entry.entryIndex);
  const groupSegment = firstStablePathSegment(pattern);
  const groupName = slugify(`${url.hostname}-${groupSegment}`);
  const testName = `${method} ${pattern} returns ${entry.response.status}`;
  const requestBody = parseRequestBody(entry.request.postData?.text, entry.request.postData?.mimeType);
  const responseBody = parseResponseBody(entry.response.content?.text, entry.response.content?.mimeType);
  const responseContentType = contentTypeFromHeaders(entry.response.headers) ?? entry.response.content?.mimeType;

  return {
    id,
    sourceFile: entry.sourceFile,
    entryIndex: entry.entryIndex,
    method,
    originalUrl: entry.request.url,
    defaultBaseUrl: baseUrlOverride ?? toBaseUrl(url),
    hostname: url.hostname,
    path: url.pathname,
    pathPattern: pattern,
    pathWithQuery: config.generation.preserveDuplicateQueryParams
      ? buildPathWithQueryFromPairs(maskedPath, maskQueryPairs(queryPairs))
      : buildPathWithQuery(maskedPath, query),
    query,
    requestHeaders: maskHeaders(toRecord(entry.request.headers ?? []), config),
    requestBody: requestBody === undefined ? undefined : maskPayload(requestBody, config, entry.request.postData?.mimeType),
    requestMimeType: entry.request.postData?.mimeType,
    responseStatus: entry.response.status,
    responseHeaders: maskHeaders(toRecord(entry.response.headers ?? []), config),
    responseContentType,
    responseBody: responseBody === undefined ? undefined : (maskJsonValue(responseBody, config) as JsonValue),
    responseTimeMs: Math.max(0, Math.round(entry.timeMs)),
    groupName,
    testName,
    fixtureName: requestBody === undefined ? undefined : `${id}.request.json`,
    schemaName: responseBody === undefined ? undefined : `${id}.response.schema.json`,
    dynamicSegments: placeholders.length > 0 ? placeholders : dynamicSegments.map(() => 'PATH_PARAM')
  };
}

export function toRecord(pairs: HarNameValue[]): Record<string, string> {
  const output: Record<string, string> = {};
  for (const pair of pairs) {
    output[normalizeHeaderName(pair.name)] = pair.value;
  }
  return output;
}

function urlSearchParamsToHarPairs(params: URLSearchParams): HarNameValue[] {
  return [...params.entries()].map(([name, value]) => ({ name, value }));
}

function maskQuery(query: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(query).sort(([left], [right]) => left.localeCompare(right))) {
    output[key] = maskQueryValue(key, value);
  }
  return output;
}

// Ordered, duplicate-preserving counterpart to maskQuery: keeps repeated names and original order
// (key normalized to lower-case to match the collapsed record's masking decisions). Used only when
// generation.preserveDuplicateQueryParams is enabled.
function maskQueryPairs(pairs: HarNameValue[]): Array<[string, string]> {
  return pairs.map((pair) => {
    const key = normalizeHeaderName(pair.name);
    return [key, maskQueryValue(key, pair.value)];
  });
}

function maskQueryValue(key: string, value: string): string {
  const masked = maskString(value, key);
  if (masked !== value) {
    return masked;
  }

  const normalizedKey = key.toLowerCase();
  if (normalizedKey === '_' || normalizedKey.includes('timestamp') || normalizedKey === 'ts') {
    return '${CACHE_BUSTER}';
  }

  if (isDynamicQueryValue(value)) {
    return `\${QUERY_${normalizedKey.replace(/[^a-z0-9]+/g, '_').toUpperCase() || 'VALUE'}}`;
  }

  return value;
}

function isDynamicQueryValue(value: string): boolean {
  return (
    /^\d{10,}$/.test(value) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ||
    /^[0-9a-f]{16,}$/i.test(value) ||
    /^[A-Za-z0-9_-]{24,}$/.test(value) ||
    /^\d{4}-\d{2}-\d{2}/.test(value)
  );
}

function parseRequestBody(text?: string, mimeType?: string): JsonValue | string | undefined {
  if (!text) {
    return undefined;
  }

  if (mimeType?.includes('json')) {
    return parseJson(text);
  }

  return text;
}

function parseResponseBody(text?: string, mimeType?: string): JsonValue | undefined {
  if (!text || !mimeType?.includes('json')) {
    return undefined;
  }

  return parseJson(text);
}

function parseJson(text: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return text;
  }
}

function maskPayload(value: JsonValue | string, config: HarApiTestConfig, mimeType?: string): JsonValue | string {
  if (typeof value !== 'string') {
    return maskJsonValue(value, config);
  }

  if (mimeType?.includes('multipart/form-data')) {
    return maskMultipartPayload(value, config);
  }

  if (mimeType?.includes('application/x-www-form-urlencoded')) {
    return maskUrlEncodedPayload(value, config);
  }

  return maskString(value);
}

function maskMultipartPayload(value: string, _config: HarApiTestConfig): string {
  // Mask every field value (name-aware + value-shape + embedded-secret sweep), preserving boundaries.
  return value.replace(
    /(Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;[^\r\n]*)?\r\n\r\n)([\s\S]*?)(?=\r\n--)/g,
    (_match: string, prefix: string, fieldName: string, fieldValue: string) => `${prefix}${maskString(fieldValue, fieldName)}`
  );
}

function maskUrlEncodedPayload(value: string, _config: HarApiTestConfig): string {
  // Keep the body a urlencoded STRING so it stays consistent with the urlencoded content-type.
  const params = new URLSearchParams(value);
  const pairs: string[] = [];
  for (const [key, paramValue] of params.entries()) {
    pairs.push(`${encodeURIComponent(key)}=${encodeFormValue(maskString(paramValue, key))}`);
  }
  return pairs.join('&');
}

function encodeFormValue(value: string): string {
  // Preserve ${ENV} placeholders un-encoded so runtime placeholder resolution still matches.
  return value
    .split(/(\$\{[A-Z0-9_]+\})/)
    .map((part) => (/^\$\{[A-Z0-9_]+\}$/.test(part) ? part : encodeURIComponent(part)))
    .join('');
}

function contentTypeFromHeaders(headers?: HarNameValue[]): string | undefined {
  const header = headers?.find((candidate) => normalizeHeaderName(candidate.name) === 'content-type');
  return header?.value;
}
