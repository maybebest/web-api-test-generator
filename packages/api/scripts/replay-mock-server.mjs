#!/usr/bin/env node
// Deterministic replay mock for the generated @smoke suite.
//
// Every ACTIVE @smoke assertion in the committed tests/generated suite expects an exact HTTP status +
// a content-type `toContain(<base type>)` check (application/json OR text/html in current captures),
// with no response-body equality checks. This server is STATUS- and CONTENT-TYPE-AWARE: it loads
// tests/generated/replay-manifest.json (emitted by the generator) and answers each active-smoke
// route with its observed status and content type (plus a minimal type-appropriate body), so a
// capture whose smoke tier includes a 201 create or a text/html page is satisfied without a live
// system-under-test.
//
// Matching is on METHOD + path only (the mock serves one host, so the original hostname is not
// matched); literal routes are matched before {param} pattern routes so a pattern cannot shadow a
// more specific sibling. A request with no manifest match — or when the manifest is absent — falls
// back to 200 + JSON, preserving the original blanket-200 behaviour. No captures, credentials, or
// response bodies are needed, which is what lets `npm run test:api:replay` run in CI.
//
// It deliberately does NOT serve the inferred negative/security cases (those are test.fixme by
// default and excluded by the --grep @smoke filter); replaying a 4xx contract would require
// payload-aware logic and belongs to the calibration workflow, not this smoke replay.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.REPLAY_PORT ?? 4599);
const dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = process.env.REPLAY_MANIFEST ?? path.resolve(dirname, '../tests/generated/replay-manifest.json');

// Turn a generator path pattern ("/users/{param}") into an anchored matcher. Placeholders match a
// single path segment; every other character is matched literally.
function patternToRegExp(pathPattern) {
  const source = pathPattern
    .split(/\{[^}]+\}/)
    .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]+');
  return new RegExp(`^${source}$`);
}

function loadRoutes() {
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const routes = Array.isArray(raw?.routes) ? raw.routes : [];
    const mapped = routes.map((route) => {
      const pathPattern = String(route.pathPattern);
      return {
        method: String(route.method).toUpperCase(),
        match: patternToRegExp(pathPattern),
        // Literal routes (no {param}) are matched before pattern routes: a '/users/{param}' pattern
        // must not shadow the more specific literal '/users/reset' when their statuses differ.
        literal: !pathPattern.includes('{'),
        status: Number(route.status),
        contentType: typeof route.contentType === 'string' && route.contentType ? route.contentType : 'application/json'
      };
    });
    return [...mapped.filter((route) => route.literal), ...mapped.filter((route) => !route.literal)];
  } catch {
    // No manifest (or unreadable): fall back to blanket-200 JSON for every request.
    return [];
  }
}

const routes = loadRoutes();
console.log(`[replay-mock] loaded ${routes.length} route status mapping(s) from ${manifestPath}`);

const DEFAULT_ANSWER = { status: 200, contentType: 'application/json' };

function answerFor(method, url) {
  const pathname = url.split('?', 1)[0];
  const upperMethod = (method ?? 'GET').toUpperCase();
  for (const route of routes) {
    if (route.method === upperMethod && route.match.test(pathname) && Number.isFinite(route.status)) {
      return route;
    }
  }
  return DEFAULT_ANSWER;
}

// Active smokes assert `content-type toContain(<base type>)` (json OR text/html) with no body
// equality, so serve the observed content type with a minimal type-appropriate body.
function bodyFor(contentType) {
  if (contentType.includes('json')) {
    return '{}';
  }
  if (contentType.includes('html')) {
    return '<!doctype html><html></html>';
  }
  return '';
}

const server = http.createServer((req, res) => {
  // Drain any request body so keep-alive sockets don't stall on POST/PUT/PATCH payloads.
  req.resume();
  req.on('end', () => {
    // The webServer readiness probe (/__health) must always answer 200, even if a manifest route
    // pattern happens to match a single root segment — otherwise a status-aware route could shadow it
    // and stall Playwright's server-ready wait.
    const pathname = (req.url ?? '/').split('?', 1)[0];
    if (pathname === '/__health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    const answer = answerFor(req.method, req.url ?? '/');
    res.writeHead(answer.status, { 'content-type': answer.contentType });
    res.end(bodyFor(answer.contentType));
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[replay-mock] listening on http://127.0.0.1:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
