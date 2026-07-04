// Redaction shared by the perf collectors. Secrets can hide in more than named query params, so we
// scrub: userinfo (user:pass@), sensitive query/fragment param NAMES, any query/fragment/path token
// whose VALUE is secret-shaped (JWT / long high-entropy), hash-router fragments (#/route?token=…),
// and — for free text like error messages or user-timing names — JWTs, bearer/basic credentials,
// `secretKey=value` pairs, and standalone secret-shaped tokens. Bodies and headers are never
// captured anywhere. Web-only — no packages/api import (patterns are hand-duplicated on purpose).
//
// This module is covered by scripts/ai/__tests__/perf-redaction.test.mjs (runs in ai:test:self);
// every bypass fixed here has a locking test there — extend the test when extending the rules.
const SENSITIVE_PARAM =
  /^(token|access_token|refresh_token|id_token|code|sig|signature|secret|api[_-]?key|key|password|passwd|pwd|auth|authorization|session|sessionid|sid)$/i;

function isJwtShaped(value: string): boolean {
  return /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\./.test(value);
}

function isLongHex(value: string): boolean {
  return /^[A-Fa-f0-9]{32,}$/.test(value);
}

// A single value that looks like a credential regardless of the param name it travels under.
// URLSearchParams decodes '+' to ' ' (form-urlencoded), so normalize spaces back to '+' before the
// charset tests — otherwise any base64 secret containing '+' would slip through.
function looksSecret(raw: string): boolean {
  if (!raw || raw === '***') {
    return false;
  }
  const value = raw.replace(/ /g, '+');
  if (isJwtShaped(value)) {
    return true;
  }
  if (isLongHex(value)) {
    return true;
  }
  // long, mixed alnum token (letters + digits) — presigned sigs, opaque tokens
  if (value.length >= 32 && /[0-9]/.test(value) && /[A-Za-z]/.test(value) && /^[A-Za-z0-9._~+/=-]+$/.test(value)) {
    return true;
  }
  // letters-only tokens carry no digit but are still secret-shaped when long AND mixed-case
  // (random alpha keys); plain lowercase words/slugs stay untouched.
  if (value.length >= 40 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /^[A-Za-z._~+/=-]+$/.test(value)) {
    return true;
  }
  return false;
}

// Path-segment variant: a content-hashed asset filename ("app.3f9c…21ab.js") is >=32 mixed alnum but
// is exactly what a perf report must keep identifiable. When the segment has a file extension, strip
// it and re-test only the stem against the strict shapes (JWT / long hex) — the generic mixed-alnum
// heuristic does not apply to filenames.
function pathSegmentLooksSecret(segment: string): boolean {
  if (!segment) {
    return false;
  }
  const extension = segment.match(/\.[A-Za-z0-9]{1,5}$/);
  if (extension) {
    const stem = segment.slice(0, -extension[0].length);
    return isJwtShaped(stem) || isLongHex(stem);
  }
  return looksSecret(segment);
}

function redactParams(params: URLSearchParams): boolean {
  let changed = false;
  for (const key of [...params.keys()]) {
    const values = params.getAll(key);
    if (SENSITIVE_PARAM.test(key) || values.some(looksSecret)) {
      params.set(key, '***');
      changed = true;
    }
  }
  return changed;
}

// Redact secret-shaped segments of a path-like string ('/reset/eyJ…/confirm'). Returns null when
// nothing changed so callers can avoid rebuilding.
function redactPathSegments(pathname: string): string | null {
  if (!pathname.includes('/')) {
    return null;
  }
  const segments = pathname.split('/');
  let changed = false;
  for (let i = 0; i < segments.length; i += 1) {
    if (pathSegmentLooksSecret(decodeURIComponentSafe(segments[i]))) {
      segments[i] = '***';
      changed = true;
    }
  }
  return changed ? segments.join('/') : null;
}

export function redactUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Not an absolute URL (relative path, data:, etc.): scrub secret-shaped tokens in the string.
    return redactSecrets(raw);
  }

  let changed = false;

  // 1. userinfo — user:pass@host
  if (url.username || url.password) {
    url.username = '';
    url.password = '';
    changed = true;
  }

  // 2. query params — sensitive name OR secret-shaped value
  if (redactParams(url.searchParams)) {
    changed = true;
  }

  // 3. path segments whose value is secret-shaped (JWT / long token embedded in the path)
  const redactedPath = redactPathSegments(url.pathname);
  if (redactedPath !== null) {
    url.pathname = redactedPath;
    changed = true;
  }

  // 4. fragment. SPA hash routers put a whole route + query INSIDE the fragment
  //    ('#/reset-password?token=…'), so split on the first '?' and treat the tail as a query string
  //    (parsing the whole fragment would produce the composite key '/reset-password?token', which
  //    dodges the anchored SENSITIVE_PARAM test). The route part gets path-segment treatment; a
  //    query-less fragment is treated as k=v pairs or a single opaque value.
  if (url.hash.length > 1) {
    const fragment = url.hash.slice(1);
    const questionIdx = fragment.indexOf('?');
    if (questionIdx >= 0) {
      const route = fragment.slice(0, questionIdx);
      const fragParams = new URLSearchParams(fragment.slice(questionIdx + 1));
      const paramsChanged = redactParams(fragParams);
      const redactedRoute = redactPathSegments(route);
      if (paramsChanged || redactedRoute !== null) {
        url.hash = `#${redactedRoute ?? route}?${fragParams.toString()}`;
        changed = true;
      }
    } else if (/[=&]/.test(fragment)) {
      const fragParams = new URLSearchParams(fragment);
      if (redactParams(fragParams)) {
        url.hash = `#${fragParams.toString()}`;
        changed = true;
      }
    } else if (looksSecret(decodeURIComponentSafe(fragment))) {
      url.hash = '#***';
      changed = true;
    }
  }

  return changed ? url.toString() : raw;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Free-text scrubber for values that are not URLs (error messages, user-timing names). Removes
// JWTs, bearer/basic credentials, `sensitiveKey=value` / `sensitiveKey: value` pairs (same key set
// as SENSITIVE_PARAM), and standalone secret-shaped tokens (32+ hex / 32+ mixed alnum). The
// standalone sweep deliberately excludes '/' from its charset so file paths and URLs in prose break
// into short, unmasked segments.
export function redactSecrets(text: string): string {
  if (!text) {
    return text;
  }
  return text
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, '***')
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{10,}/gi, '$1 ***')
    .replace(
      /\b(token|access_token|refresh_token|id_token|api[_-]?key|key|code|secret|password|passwd|pwd|auth|authorization|session|session[_-]?id|sessionid|sid|sig|signature)(["']?\s*[:=]\s*["']?)[^\s"'&<>]+/gi,
      '$1$2***'
    )
    .replace(/[A-Za-z0-9._~+=-]{32,}/g, (match) => (looksSecret(match) ? '***' : match));
}
