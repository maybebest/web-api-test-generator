import crypto from 'node:crypto';
import { compareStrings } from './compare.js';

const dynamicSegmentPatterns = [
  /^[0-9]+$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  /^[0-9a-f]{16,}$/i,
  /^[A-Za-z0-9_-]{24,}$/,
  /^\d{4}-\d{2}-\d{2}/
];

export function shortHash(value: string, length = 8): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, length);
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/https?:\/\//g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'generated'
  );
}

export function isDynamicSegment(segment: string): boolean {
  return dynamicSegmentPatterns.some((pattern) => pattern.test(segment));
}

export function inferPathPattern(pathname: string): { pattern: string; dynamicSegments: string[] } {
  const dynamicSegments: string[] = [];
  const normalized = pathname
    .split('/')
    .map((segment) => {
      if (!segment) {
        return '';
      }

      if (isDynamicSegment(segment) || decodeURIComponentSafe(segment).includes('@')) {
        dynamicSegments.push(segment);
        return '{param}';
      }

      return segment;
    })
    .join('/');

  return {
    pattern: normalized || '/',
    dynamicSegments
  };
}

export function maskDynamicPath(pathname: string): { maskedPath: string; placeholders: string[] } {
  const placeholders: string[] = [];
  const segments = pathname.split('/');
  const maskedPath = segments
    .map((segment, index) => {
      if (!segment) {
        return '';
      }

      if (isDynamicSegment(segment) || decodeURIComponentSafe(segment).includes('@')) {
        const placeholder = inferPathPlaceholder(segments, index, placeholders.length);
        placeholders.push(placeholder);
        return `\${${placeholder}}`;
      }

      return segment;
    })
    .join('/');

  return {
    maskedPath: maskedPath || '/',
    placeholders
  };
}

export function firstStablePathSegment(pathPattern: string): string {
  return pathPattern
    .split('/')
    .filter(Boolean)
    .find((segment) => !segment.startsWith('{')) ?? 'root';
}

export function buildPathWithQuery(pathname: string, query: Record<string, string>): string {
  const queryString = Object.entries(query)
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeQueryValue(value)}`)
    .join('&');

  return queryString ? `${pathname}?${queryString}` : pathname;
}

// Variant that serializes ordered name/value pairs, preserving repeated keys (?id=1&id=2) and
// their original order. Used only when generation.preserveDuplicateQueryParams is enabled; the
// default path uses buildPathWithQuery (collapsed, key-sorted) to keep committed output stable.
export function buildPathWithQueryFromPairs(
  pathname: string,
  pairs: ReadonlyArray<readonly [string, string]>
): string {
  const queryString = pairs
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeQueryValue(value)}`)
    .join('&');

  return queryString ? `${pathname}?${queryString}` : pathname;
}

export function toBaseUrl(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

export function makeEndpointId(method: string, url: string, index: number): string {
  return `${slugify(`${method}-${url}`)}-${shortHash(`${method}:${url}:${index}`)}`;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function inferPathPlaceholder(segments: string[], index: number, placeholderIndex: number): string {
  const previousSegments = segments.slice(0, index).filter(Boolean).map((segment) => segment.toLowerCase());

  if (previousSegments.some((segment) => segment === 'user' || segment === 'users' || segment === 'me')) {
    return 'USER_ID';
  }

  if (previousSegments.some((segment) => segment === 'account' || segment === 'accounts')) {
    return 'ACCOUNT_ID';
  }

  const previousStableSegment = [...previousSegments].reverse().find((segment) => !isDynamicSegment(segment));
  if (previousStableSegment) {
    return `${slugify(previousStableSegment).replace(/-/g, '_').toUpperCase()}_ID`;
  }

  return `PATH_PARAM_${placeholderIndex + 1}`;
}

function encodeQueryValue(value: string): string {
  // Placeholders (${NAME}) must survive encoding wherever they sit in the value — masking's
  // sweepEmbeddedSecrets can embed one MID-string ("mail to ${TEST_EMAIL} asap"), and a
  // percent-encoded %24%7BTEST_EMAIL%7D would neither resolve at runtime nor be seen by
  // collectPlaceholders. Split on placeholder boundaries and encode only the literal parts.
  return value
    .split(/(\$\{[A-Z0-9_]+\})/)
    .map((part) => (/^\$\{[A-Z0-9_]+\}$/.test(part) ? part : encodeURIComponent(part)))
    .join('');
}
