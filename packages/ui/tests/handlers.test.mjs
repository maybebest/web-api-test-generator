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
  buildWebSpecCheckArgs,
  assertAiCommandOutputUsable,
  parseFitRunnerOutput,
  parseGenerationRunId,
  publicAiCommandResult,
  validatedFitCommandResult,
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

test('uploaded specs land in .ui-uploads and are previewable', async () => {
  const form = new FormData();
  form.append('files', new Blob(['# Flow: Uploaded probe\n'], { type: 'text/markdown' }), 'uploaded-probe.md');
  const upload = await fetch(`${baseUrl}/api/upload?kind=web-spec`, { method: 'POST', body: form });
  const uploadJson = await upload.json();
  assert.equal(upload.status, 200);
  assert.equal(uploadJson.files.length, 1);

  const uploadedPath = uploadJson.files[0].path;
  assert.match(uploadedPath, /^\.ui-uploads\/specs\//);
  try {
    const uploadedAbsolutePath = path.join(uiPaths.webRoot, uploadedPath);
    assert.equal(fs.statSync(uploadedAbsolutePath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(uploadedAbsolutePath)).mode & 0o777, 0o700);
    const preview = await api('GET', `/api/file?scope=web&path=${encodeURIComponent(uploadedPath)}`);
    assert.equal(preview.status, 200);
    assert.match(preview.json.content, /Flow: Uploaded probe/);
  } finally {
    fs.rmSync(path.join(uiPaths.webRoot, path.dirname(uploadedPath)), { recursive: true, force: true });
  }
});

test('accepts multiple files in a single upload', async () => {
  const form = new FormData();
  form.append('files', new Blob(['# Flow: One\n']), 'one.md');
  form.append('files', new Blob(['# Flow: Two\n']), 'two.md');
  const upload = await fetch(`${baseUrl}/api/upload?kind=web-spec`, { method: 'POST', body: form });
  const uploadJson = await upload.json();
  assert.equal(upload.status, 200);
  assert.equal(uploadJson.files.length, 2);
  fs.rmSync(path.join(uiPaths.webRoot, path.dirname(uploadJson.files[0].path)), { recursive: true, force: true });
});

test('uploaded specs are restored by state and README files are not offered as specs', async () => {
  const form = new FormData();
  form.append('files', new Blob(['# Flow: Persistent upload\n']), `persistent-${process.pid}.md`);
  const upload = await fetch(`${baseUrl}/api/upload?kind=web-spec`, { method: 'POST', body: form });
  const uploadJson = await upload.json();
  assert.equal(upload.status, 200);

  const uploadedPath = uploadJson.files[0].path;
  try {
    const state = await api('GET', '/api/state');
    assert.equal(state.status, 200);
    assert.ok(state.json.examples.uploadedSpecs.some((file) => file.path === uploadedPath));
    assert.equal(
      state.json.examples.specs.some((file) => path.basename(file.path).toLowerCase() === 'readme.md'),
      false
    );
    assert.equal(
      state.json.examples.webFlowSpecs.some((file) => path.basename(file.path).toLowerCase() === 'readme.md'),
      false
    );
  } finally {
    fs.rmSync(path.join(uiPaths.webRoot, path.dirname(uploadedPath)), { recursive: true, force: true });
  }
});

test('a rejected multi-file upload leaves no partial files', async () => {
  const uploadRoot = path.join(uiPaths.webRoot, '.ui-uploads', 'specs');
  const before = fs.existsSync(uploadRoot) ? fs.readdirSync(uploadRoot).sort() : [];
  const form = new FormData();
  form.append('files', new Blob(['# Flow: Must not persist\n']), `transaction-${process.pid}.md`);
  form.append('files', new Blob(['not markdown']), `invalid-${process.pid}.txt`);

  const upload = await fetch(`${baseUrl}/api/upload?kind=web-spec`, { method: 'POST', body: form });
  const uploadJson = await upload.json();
  assert.equal(upload.status, 400);
  assert.match(uploadJson.error, /Unsupported file type/);
  const after = fs.existsSync(uploadRoot) ? fs.readdirSync(uploadRoot).sort() : [];
  assert.deepEqual(after, before);
});

test('imported cases preserve source provenance and write only to the managed namespace', async () => {
  const sourcePath = 'specs/_template.md';
  const sourceAbsolutePath = path.join(uiPaths.webRoot, sourcePath);
  const sourceBefore = fs.readFileSync(sourceAbsolutePath, 'utf8');
  const created = await api('POST', '/api/test-management/cases', {
    title: `Imported source ${process.pid}`,
    sourceSpecPath: sourcePath,
    specPath: ''
  });

  assert.equal(created.status, 200);
  assert.equal(created.json.testCase.sourceSpecPath, sourcePath);
  assert.match(created.json.testCase.specPath, /^specs\/test-management\//);
  assert.notEqual(created.json.testCase.specPath, sourcePath);
  assert.equal(fs.readFileSync(sourceAbsolutePath, 'utf8'), sourceBefore);

  const managedAbsolutePath = path.join(uiPaths.webRoot, created.json.testCase.specPath);
  try {
    assert.match(fs.readFileSync(managedAbsolutePath, 'utf8'), /# Flow: Imported source/);
  } finally {
    fs.rmSync(managedAbsolutePath, { force: true });
  }
});

test('managed case saves reject source paths and refuse to clobber an existing file', async () => {
  const sourcePath = path.join(uiPaths.webRoot, 'specs', '_template.md');
  const sourceBefore = fs.readFileSync(sourcePath, 'utf8');
  const unsafe = await api('POST', '/api/test-management/cases', {
    title: 'Unsafe managed path',
    specPath: 'specs/_template.md'
  });
  assert.equal(unsafe.status, 400);
  assert.equal(fs.readFileSync(sourcePath, 'utf8'), sourceBefore);

  const managedRelativePath = `specs/test-management/no-clobber-${process.pid}.md`;
  const managedAbsolutePath = path.join(uiPaths.webRoot, managedRelativePath);
  fs.mkdirSync(path.dirname(managedAbsolutePath), { recursive: true });
  fs.writeFileSync(managedAbsolutePath, 'CANARY\n');
  try {
    const conflict = await api('POST', '/api/test-management/cases', {
      title: 'No clobber',
      specPath: managedRelativePath
    });
    assert.equal(conflict.status, 409);
    assert.equal(fs.readFileSync(managedAbsolutePath, 'utf8'), 'CANARY\n');
  } finally {
    fs.rmSync(managedAbsolutePath, { force: true });
  }
});

test('rejects a non-loopback Host header (DNS rebinding)', async () => {
  const evil = await rawGet(`evil.example:${server.address().port}`);
  assert.match(evil, /403/);
  const loopback = await rawGet(`127.0.0.1:${server.address().port}`);
  assert.match(loopback, /200/);
});

test('settings save persists raw keys but only returns masked hints', async () => {
  // A configured UI_RUNS_DIR can be a pre-existing shared root. Saving a
  // private file must not chmod that caller-owned directory.
  fs.chmodSync(runsDir, 0o755);
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
  assert.equal(fs.statSync(path.join(runsDir, 'settings.json')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(runsDir).mode & 0o777, 0o755);
});

test('optional AI settings can be cleared and timeout parsing is strict', async () => {
  const initial = await api('POST', '/api/settings/ai', {
    brain: 'openai',
    anthropicModel: 'claude-test',
    openaiModel: 'gpt-test',
    timeoutMs: '120000'
  });
  assert.equal(initial.status, 200);

  const cleared = await api('POST', '/api/settings/ai', {
    brain: 'openai',
    anthropicModel: '',
    openaiModel: '',
    timeoutMs: ''
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.settings.ai.anthropicModel, '');
  assert.equal(cleared.json.settings.ai.openaiModel, '');
  assert.equal(cleared.json.settings.ai.timeoutMs, '');

  const malformed = await api('POST', '/api/settings/ai', {
    brain: 'openai',
    timeoutMs: '120s'
  });
  assert.equal(malformed.status, 400);
  assert.match(malformed.json.error, /positive whole number/);

  const overflow = await api('POST', '/api/settings/ai', {
    brain: 'openai',
    timeoutMs: '2147483648'
  });
  assert.equal(overflow.status, 400);
  assert.match(overflow.json.error, /maximum reliable timer delay/);
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
  assert.equal(filePart.content.buffer, body.buffer, 'multipart content should be a zero-copy view of the bounded body');
});

test('generation output parser accepts exactly one safe labeled run id', () => {
  assert.equal(
    parseGenerationRunId('Generated test accepted.\nGeneration run ID: safe-run-123\n'),
    'safe-run-123'
  );
  assert.throws(() => parseGenerationRunId('Generation run ID: ../escape\n'), /run id/i);
  assert.throws(
    () => parseGenerationRunId('Generation run ID: first-run\nGeneration run ID: second-run\n'),
    /exactly one/i
  );
  assert.throws(
    () => parseGenerationRunId('Generation run ID: same-run\nGeneration run ID: same-run\n'),
    /exactly one/i
  );
  assert.throws(() => parseGenerationRunId('prefix Generation run ID: safe-run\n'), /run id/i);
  assert.throws(() => parseGenerationRunId(' Generation run ID: safe-run\n'), /run id/i);
  assert.throws(() => parseGenerationRunId(`Generation run ID: ${'x'.repeat(65)}\n`), /run id/i);
  assert.throws(
    () => parseGenerationRunId('Generation run ID: safe-run\n', { truncated: true }),
    /truncated/i
  );
  assert.throws(() => parseGenerationRunId('Generated without identity\n'), /exactly one/i);
});

test('failed generation and fit results never expose child output canaries', () => {
  const childFailure = {
    ok: false,
    kind: 'web-spec-ai',
    script: 'ai:brain:generate',
    command: 'npm run hidden',
    exitCode: 1,
    durationMs: 23,
    stdout: 'PRIVATE CHILD STDOUT CANARY',
    stderr: 'PRIVATE CHILD STDERR CANARY',
    stdoutTruncated: false,
    stderrTruncated: false
  };
  const publicResult = publicAiCommandResult(childFailure, 'Verified test generation failed.');
  assert.deepEqual(publicResult, {
    ok: false,
    kind: 'web-spec-ai',
    script: 'ai:brain:generate',
    exitCode: 1,
    durationMs: 23,
    error: 'Verified test generation failed.'
  });
  assert.doesNotMatch(JSON.stringify(publicResult), /PRIVATE|STDOUT|STDERR|hidden/);

  assert.throws(
    () => assertAiCommandOutputUsable(childFailure, 'Fit to Template'),
    (error) => error.statusCode === 502
      && /Fit to Template failed\./.test(error.message)
      && !/PRIVATE|STDOUT|STDERR/.test(error.message)
  );
  assert.throws(
    () => assertAiCommandOutputUsable({ ...childFailure, ok: true, stdoutTruncated: true }, 'Fit to Template'),
    /truncated/i
  );

  const invalidDraftCanary = `PRIVATE INVALID FIT DRAFT ${'x'.repeat(2_000)}`;
  const invalidFitSuccess = {
    ...childFailure,
    ok: true,
    stdout: JSON.stringify({ text: `# Flow: ${invalidDraftCanary}\n`, runId: 'safe-fit-run' })
  };
  assert.throws(
    () => validatedFitCommandResult(invalidFitSuccess),
    (error) => error.statusCode === 502
      && error.message === 'Fit to Template returned invalid output.'
      && !error.message.includes(invalidDraftCanary)
      && error.message.length < 128
  );
});

test('fit runner output parsing preserves its safe run id without exposing child fields', () => {
  const parsed = parseFitRunnerOutput(JSON.stringify({
    text: '# Flow: Safe\n',
    brain: { kind: 'openai', model: 'gpt-test' },
    usage: {
      inputTokens: 12,
      outputTokens: 4,
      prompt: 'PRIVATE USAGE PROMPT',
      response: 'PRIVATE USAGE RESPONSE'
    },
    runId: 'fit-run-123',
    prompt: 'PRIVATE PROMPT',
    response: 'PRIVATE RESPONSE'
  }));
  assert.equal(parsed.runId, 'fit-run-123');
  assert.equal(parsed.text, '# Flow: Safe\n');
  assert.deepEqual(parsed.usage, { inputTokens: 12, outputTokens: 4 });
  assert.equal('prompt' in parsed, false);
  assert.equal('response' in parsed, false);
  assert.doesNotMatch(JSON.stringify(parsed), /PRIVATE/);
  assert.throws(
    () => parseFitRunnerOutput(JSON.stringify({ text: '# Flow: Bad\n', runId: '../escape' })),
    /run id/i
  );
});

test('full web gate arguments carry the exact run id only on the explicit three-repeat lane', () => {
  const common = {
    specPath: 'specs/flow.md',
    targetTestFile: 'tests/regression/flow.spec.ts',
    mode: 'single'
  };
  assert.deepEqual(buildWebSpecCheckArgs({ ...common, action: 'gate', runId: 'generation-run-1' }), [
    '--spec', 'specs/flow.md', '--test', 'tests/regression/flow.spec.ts', '--mode', 'single',
    '--repeat-each', '3', '--run-id', 'generation-run-1'
  ]);
  assert.deepEqual(buildWebSpecCheckArgs({ ...common, action: 'review' }), [
    '--spec', 'specs/flow.md', '--test', 'tests/regression/flow.spec.ts', '--mode', 'single'
  ]);
  assert.throws(
    () => buildWebSpecCheckArgs({ ...common, action: 'review', runId: 'generation-run-1' }),
    /only.*full gate/i
  );
});

test('browser generation links are sent only for the exact matching saved subject', async () => {
  const {
    beginGenerationLinkAttempt,
    buildGenerationRunLink,
    buildSpecCheckPayload,
    completeGenerationLinkAttempt,
    invalidateGenerationLinkForSubject
  } = await import('../public/app.js');
  const link = buildGenerationRunLink({
    runId: 'generation-run-1',
    specPath: 'specs/flow.md',
    targetTestFile: 'tests/regression/flow.spec.ts'
  });
  const matching = buildSpecCheckPayload({
    action: 'gate', specPath: 'specs/flow.md', targetTestFile: 'tests/regression/flow.spec.ts', mode: 'single'
  }, link);
  assert.equal(matching.runId, 'generation-run-1');
  assert.equal('runId' in buildSpecCheckPayload({ ...matching, action: 'review' }, link), false);
  assert.equal('runId' in buildSpecCheckPayload({
    action: 'gate', specPath: 'specs/other.md', targetTestFile: 'tests/regression/flow.spec.ts', mode: 'single'
  }, link), false);
  assert.equal('runId' in buildSpecCheckPayload({
    action: 'gate', specPath: 'specs/flow.md', targetTestFile: 'tests/regression/other.spec.ts', mode: 'single'
  }, link), false);

  const browserState = { generationRunLink: link, generationLinkAttempt: null };
  invalidateGenerationLinkForSubject(browserState, {
    specPath: 'specs/flow.md', targetTestFile: 'tests/regression/flow.spec.ts'
  });
  assert.equal(browserState.generationRunLink, link, 'an unchanged exact subject may retain its link');
  invalidateGenerationLinkForSubject(browserState, {
    specPath: 'specs/other.md', targetTestFile: 'tests/regression/flow.spec.ts'
  });
  assert.equal(browserState.generationRunLink, null, 'selecting another spec clears the link');

  browserState.generationRunLink = link;
  const firstAttempt = beginGenerationLinkAttempt(browserState, {
    specPath: 'specs/flow.md', targetTestFile: 'tests/regression/flow.spec.ts'
  });
  assert.equal(browserState.generationRunLink, null, 'generation start clears stale quality linkage');
  const secondAttempt = beginGenerationLinkAttempt(browserState, {
    specPath: 'specs/other.md', targetTestFile: 'tests/regression/other.spec.ts'
  });
  assert.equal(completeGenerationLinkAttempt(browserState, firstAttempt, {
    ok: true, runId: 'stale-run'
  }), false, 'a late A response must not overwrite a newer B attempt');
  assert.equal(browserState.generationRunLink, null);
  assert.equal(completeGenerationLinkAttempt(browserState, secondAttempt, { ok: false }), true);
  assert.equal(browserState.generationRunLink, null, 'generation failure leaves no reusable link');

  const acceptedAttempt = beginGenerationLinkAttempt(browserState, {
    specPath: 'specs/other.md', targetTestFile: 'tests/regression/other.spec.ts'
  });
  completeGenerationLinkAttempt(browserState, acceptedAttempt, { ok: true, runId: 'fresh-run' });
  assert.deepEqual(browserState.generationRunLink, {
    runId: 'fresh-run',
    specPath: 'specs/other.md',
    targetTestFile: 'tests/regression/other.spec.ts'
  });
});

test('real browser mutation and generation paths use the linkage invalidation lifecycle', () => {
  const source = fs.readFileSync(path.join(uiPaths.uiRoot, 'public', 'app.js'), 'utf8');
  assert.match(source, /#spec-target'\)\.addEventListener\('input',[\s\S]*?invalidateGenerationLinkForSubject/);
  assert.match(source, /async function fitSpecToTemplate[\s\S]*?invalidateGenerationLinkForSubject\(state, \{\}, \{ force: true \}\)/);
  assert.match(source, /async function selectSavedSpec[\s\S]*?invalidateGenerationLinkForSubject/);
  assert.match(source, /function selectSpecTask[\s\S]*?invalidateGenerationLinkForSubject/);
  assert.match(source, /async function generateSavedSpec[\s\S]*?beginGenerationLinkAttempt[\s\S]*?completeGenerationLinkAttempt/);
  assert.match(source, /async function generateSpecTask[\s\S]*?beginGenerationLinkAttempt[\s\S]*?completeGenerationLinkAttempt/);
});
