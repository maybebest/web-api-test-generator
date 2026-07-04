// Locks the perf redaction module (fixtures/perf/redact.ts) — the sole enforcement of the
// "perf capture must never persist unredacted tokens" constraint. Every bypass fixed in the
// adversarial reviews has a case here; extend this file whenever redact.ts gains a rule.
//
// redact.ts is TypeScript and this harness is plain node:test, so the module is transpiled
// in-memory with the repo's own typescript package (no reliance on Node's native type stripping)
// and imported from a temp file.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

async function loadRedactModule() {
  const ts = require('typescript');
  const sourcePath = path.resolve(here, '../../../fixtures/perf/redact.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const out = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  });
  const tmp = path.join(os.tmpdir(), `perf-redact-under-test-${process.pid}-${Math.random().toString(16).slice(2)}.mjs`);
  fs.writeFileSync(tmp, out.outputText);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    fs.unlinkSync(tmp);
  }
}

const { redactUrl, redactSecrets } = await loadRedactModule();

test('redactUrl masks sensitive query param names and keeps benign params', () => {
  assert.equal(redactUrl('https://x/reset?token=eyJabc.def.ghi&page=1'), 'https://x/reset?token=***&page=1');
  assert.equal(redactUrl('https://x/list?sig=deadbeef&limit=10'), 'https://x/list?sig=***&limit=10');
});

test('redactUrl strips userinfo credentials', () => {
  assert.equal(redactUrl('https://admin:Sup3rSecret@api.example.com/data'), 'https://api.example.com/data');
});

test('redactUrl masks secret-shaped values under unlisted param names', () => {
  const hex32 = '4f8a2bc19d3e57f6a0b1c2d3e4f5a6b7';
  assert.equal(redactUrl(`https://x/cb?blob=${hex32}`), 'https://x/cb?blob=***');
});

test('redactUrl masks JWT-shaped path segments but keeps normal paths', () => {
  assert.equal(
    redactUrl('https://api/reset/eyJhbGciOiJI.secretpayloadxx.sigsigsig/confirm'),
    'https://api/reset/***/confirm'
  );
  assert.equal(redactUrl('https://www.google.com/planning?q=hello&page=2'), 'https://www.google.com/planning?q=hello&page=2');
});

test('hash-router fragments (#/route?token=…) are redacted even for short tokens', () => {
  // The composite key '/reset-password?token' used to dodge the anchored param regex entirely.
  assert.equal(
    redactUrl('https://app.example.com/#/reset-password?token=Xk3nPqZLmvB8sT4w'),
    'https://app.example.com/#/reset-password?token=***'
  );
  // Benign hash-router params stay readable.
  assert.equal(redactUrl('https://app.example.com/#/plans?page=2'), 'https://app.example.com/#/plans?page=2');
});

test('plain k=v fragments are redacted', () => {
  assert.equal(redactUrl('https://x/#access_token=eyJa.bbbbbb.cccccc&x=1'), 'https://x/#access_token=***&x=1');
});

test('base64 values containing + survive URLSearchParams space-decoding and are still masked', () => {
  const base64Plus = encodeURIComponent('Ab1+Cd2+Ef3+Gh4+Ij5+Kl6+Mn7+Op8+Qr9+St0+');
  assert.equal(redactUrl(`https://x/cb?blob=${base64Plus}`), 'https://x/cb?blob=***');
});

test('long letters-only mixed-case tokens are masked; lowercase slugs are not', () => {
  const alphaToken = 'AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfGhIjKlMn'; // 40 chars, no digits
  assert.equal(redactUrl(`https://x/cb?k=${alphaToken}`), 'https://x/cb?k=***');
  assert.equal(
    redactUrl('https://x/docs?section=performance-collection-implementation-notes'),
    'https://x/docs?section=performance-collection-implementation-notes'
  );
});

test('content-hashed asset filenames in paths are NOT masked (perf reports must identify assets)', () => {
  const asset = 'https://cdn.example.com/static/app.4f8a2bc19d3e57f6a0b1c2d3e4f5a6b7.chunk.js';
  assert.equal(redactUrl(asset), asset);
});

test('redactSecrets scrubs JWTs, bearer credentials, and key=value pairs incl. code/key/session', () => {
  assert.equal(
    redactSecrets('Login failed: Authorization: Bearer eyJabc.deffff.ghiiii and token=SEKRET123xyz'),
    'Login failed: Authorization: *** *** and token=***'
  );
  assert.equal(redactSecrets('exchange failed code=ABC123 for session=xyz9'), 'exchange failed code=*** for session=***');
});

test('redactSecrets sweeps standalone secret-shaped tokens but leaves paths and prose intact', () => {
  const hex32 = '4f8a2bc19d3e57f6a0b1c2d3e4f5a6b7';
  assert.equal(redactSecrets(`boom ${hex32} happened`), 'boom *** happened');
  const prose = 'error at /api/v1/users/settings/preferences/notifications while loading the planner';
  assert.equal(redactSecrets(prose), prose);
});
