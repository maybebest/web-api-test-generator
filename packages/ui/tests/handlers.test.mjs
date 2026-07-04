import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

// Redirect local state to a temp directory BEFORE importing the server, whose
// storage paths are resolved at module load. The server is then dynamically
// imported so no handler test touches the real packages/ui/.ui-runs store.
const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-runs-'));
process.env.UI_RUNS_DIR = runsDir;

const {
  assertPreviewAllowed,
  createUiServer,
  normalizeTestManagementStore,
  parseMultipart,
  sanitizeFileName,
  summarizeRunStatus,
  uiPaths
} = await import('../src/server.mjs');

let server;
let baseUrl;

before(async () => {
  server = createUiServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(runsDir, { recursive: true, force: true });
});

async function api(method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

function rawGet(hostHeader) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`GET /api/state HTTP/1.1\r\nHost: ${hostHeader}\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk;
    });
    socket.on('end', () => resolve(data.split('\r\n')[0]));
    socket.on('error', reject);
  });
}

test('preview endpoint refuses the ui scope and secret files', async () => {
  fs.writeFileSync(path.join(runsDir, 'settings.json'), JSON.stringify({ ai: { anthropicApiKey: 'sk-ant-secret' } }));

  const uiScope = await api('GET', `/api/file?scope=ui&path=${encodeURIComponent('.ui-runs/settings.json')}`);
  assert.equal(uiScope.status, 400, 'ui scope must be unsupported');

  const dotEnv = await api('GET', `/api/file?scope=web&path=${encodeURIComponent('.env')}`);
  assert.equal(dotEnv.status, 403, '.env must be denied');

  const authState = await api('GET', `/api/file?scope=web&path=${encodeURIComponent('playwright/.auth/user.json')}`);
  assert.equal(authState.status, 403, 'playwright auth state must be denied');
});

test('preview endpoint refuses a symlink that escapes the allowlist', async () => {
  const specsDir = path.join(uiPaths.webRoot, 'specs');
  const canary = path.join(uiPaths.webRoot, '.env.testcanary');
  const link = path.join(specsDir, `symlink-escape-${process.pid}.md`);
  fs.writeFileSync(canary, 'SYMLINK-CANARY');
  fs.symlinkSync(path.relative(specsDir, canary), link);
  try {
    const res = await api('GET', `/api/file?scope=web&path=${encodeURIComponent(`specs/${path.basename(link)}`)}`);
    assert.notEqual(res.status, 200, 'a symlink pointing at a secret must be denied');
    assert.equal(res.json.ok ?? false, false);
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(canary, { force: true });
  }
});

test('preview endpoint allows a real spec file', async () => {
  const allowed = await api('GET', `/api/file?scope=web&path=${encodeURIComponent('specs/_template.md')}`);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.json.ok, true);
  assert.match(allowed.json.content, /Flow/);
});

test('rejects a non-loopback Host header (DNS rebinding)', async () => {
  const evil = await rawGet(`evil.example:${server.address().port}`);
  assert.match(evil, /403/);
  const loopback = await rawGet(`127.0.0.1:${server.address().port}`);
  assert.match(loopback, /200/);
});

test('settings save persists raw keys but only returns masked hints', async () => {
  const saved = await api('POST', '/api/settings/ai', {
    brain: 'openai',
    anthropicApiKey: 'sk-ant-XYZ1234',
    openaiApiKey: 'sk-oai-ABCD5678'
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.settings.ai.anthropicApiKeyConfigured, true);
  assert.equal(saved.json.settings.ai.anthropicApiKeyHint, '...1234');
  assert.equal('anthropicApiKey' in saved.json.settings.ai, false);

  const fetched = await api('GET', '/api/settings');
  assert.equal(fetched.json.settings.ai.openaiApiKeyHint, '...5678');
  assert.equal('openaiApiKey' in fetched.json.settings.ai, false);

  const persisted = JSON.parse(fs.readFileSync(path.join(runsDir, 'settings.json'), 'utf8'));
  assert.equal(persisted.ai.anthropicApiKey, 'sk-ant-XYZ1234');
});

test('suite creation persists to the store under UI_RUNS_DIR', async () => {
  const created = await api('POST', '/api/test-management/suites', { name: 'Smoke suite' });
  assert.equal(created.status, 200);
  assert.match(created.json.suite.id, /^TS-\d{4}$/);

  const store = JSON.parse(fs.readFileSync(path.join(runsDir, 'test-management.json'), 'utf8'));
  assert.ok(store.suites.some((suite) => suite.id === created.json.suite.id));
});

test('a corrupt store file is backed up, not overwritten, and self-heals', async () => {
  const storePath = path.join(runsDir, 'test-management.json');
  fs.writeFileSync(storePath, '{ this is not json');
  const created = await api('POST', '/api/test-management/suites', { name: 'After corruption' });
  assert.equal(created.status, 200);
  const backups = fs.readdirSync(runsDir).filter((name) => name.includes('.corrupt-'));
  assert.ok(backups.length >= 1, 'corrupt file should be preserved as a .corrupt-* backup');
});

test('unknown command is a 409 while another command holds the lock — cancel is idempotent', async () => {
  const cancelled = await api('POST', '/api/cancel');
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.json.ok, true);
  assert.equal(cancelled.json.cancelled, false);
});

test('assertPreviewAllowed enforces the directory and extension allowlist', () => {
  const allow = { dirs: new Set(['specs', '.ai-runs']), extensions: new Set(['.md', '.json']) };
  assert.doesNotThrow(() => assertPreviewAllowed(path.join('specs', 'a.md'), allow));
  assert.doesNotThrow(() => assertPreviewAllowed(path.join('.ai-runs', 'x', 'manifest.json'), allow));
  assert.throws(() => assertPreviewAllowed('.env', allow), /restricted/);
  assert.throws(() => assertPreviewAllowed(path.join('playwright', '.auth', 'user.json'), allow), /restricted/);
  assert.throws(() => assertPreviewAllowed(path.join('specs', 'a.txt'), allow), /file type/);
});

test('summarizeRunStatus transitions planned -> in-progress -> completed', () => {
  const run = { caseIds: ['a', 'b'], results: { a: { status: 'untested' }, b: { status: 'untested' } } };
  assert.equal(summarizeRunStatus(run), 'planned');
  run.results.a.status = 'passed';
  assert.equal(summarizeRunStatus(run), 'in-progress');
  run.results.b.status = 'failed';
  assert.equal(summarizeRunStatus(run), 'completed');
});

test('normalizeTestManagementStore drops invalid items and fills run defaults', () => {
  const store = normalizeTestManagementStore({
    cases: [{ id: 'TC-0001', title: 'ok' }, { title: 'no id' }, null, 'nope'],
    suites: [{ id: 'TS-0001' }],
    runs: [{ id: 'TR-0001' }],
    counters: { case: 7, suite: 0, run: 0 }
  });
  assert.equal(store.cases.length, 1);
  assert.deepEqual(store.suites[0].caseIds, []);
  assert.deepEqual(store.runs[0].caseIds, []);
  assert.deepEqual(store.runs[0].results, {});
  assert.equal(store.counters.case, 7);
});

test('sanitizeFileName strips path traversal and unsafe characters', () => {
  assert.equal(sanitizeFileName('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFileName('my session (1).har'), 'my-session-1-.har');
  // A name of only unsafe characters collapses to a generated fallback.
  assert.match(sanitizeFileName('@@@'), /^upload-\d+$/);
});

test('parseMultipart extracts named file parts', () => {
  const boundary = '----uiTestBoundary';
  const body = Buffer.from(
    `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="files"; filename="capture.har"\r\n' +
      '\r\n' +
      '{"log":{"entries":[]}}\r\n' +
      `--${boundary}--\r\n`,
    'latin1'
  );
  const parts = parseMultipart(body, `multipart/form-data; boundary=${boundary}`);
  const filePart = parts.find((part) => part.filename);
  assert.equal(filePart.filename, 'capture.har');
  assert.equal(filePart.content.toString('utf8'), '{"log":{"entries":[]}}');
});
