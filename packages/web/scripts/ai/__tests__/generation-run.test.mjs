import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { generateTestSource, recordGenerationInManifest } from '../ai-generate.mjs';
import { runBrain } from '../lib/ai-client.mjs';
import { createGenerationCacheCandidate, createGenerationCacheKey, promoteGenerationCache, readGenerationCache } from '../lib/generation-cache.mjs';
import {
  PROMOTION_GATE_POLICY,
  PROMOTION_GATE_REPEAT_EACH
} from '../lib/generated-gate-policy.mjs';
import {
  acceptedGenerationQualityFingerprint,
  generationQualityFingerprint
} from '../lib/generation-quality.mjs';
import {
  bindGenerationRunSubject,
  bindGenerationRunCacheReference,
  createGenerationRun,
  finalizeGenerationRun,
  linkGenerationRunFullGate,
  recordRunAttempt,
  recordRunEvent
} from '../lib/generation-run.mjs';
import { runVerifiedGeneration } from '../verified-generate.mjs';

const noBinaries = { hasBinary: () => false };
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureBaseUrl = 'https://qa.example.test';
const acceptedSourceSha256 = '205e8c43a278ba22c066e3ae822f57cc42659b2a4654cb14279bc3b4c2d13522';
const acceptedQualityFingerprint = acceptedGenerationQualityFingerprint({
  sourceSha256: acceptedSourceSha256,
  repairCount: 0
});

function tempDirectory(t, prefix = 'generation-run-') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeValidFlowSpec(webRoot, specName, targetName) {
  const source = fs.readFileSync(path.resolve(here, '../../../specs/special-preconditions/media-planner-minimum-campaign-duration.md'), 'utf8')
    .replace('| Auth | required |', '| Auth | none |')
    .replace(/\| Target Test File \| [^|]+ \|/, `| Target Test File | tests/regression/${targetName} |`);
  fs.mkdirSync(path.join(webRoot, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(webRoot, 'specs', specName), source);
}

function fakeResponse({ ok = true, status = 200, body = {}, headers = {} } = {}) {
  return {
    ok,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function openaiBody({ text = JSON.stringify({ code: 'const generated = true;' }), finishReason = 'stop' } = {}) {
  return {
    id: 'chatcmpl-safe-id',
    choices: [{ message: { content: text }, finish_reason: finishReason }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      prompt_tokens_details: { cached_tokens: 60, cache_write_tokens: 10 },
      completion_tokens_details: { reasoning_tokens: 4 }
    }
  };
}

function readJsonLines(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('generation quality fingerprint canonicalizes the v3 two-repeat promotion contract', () => {
  assert.equal(generationQualityFingerprint({
    sourceSha256: acceptedSourceSha256,
    outcome: 'accepted',
    stage: 'accepted',
    reasonCode: 'PASSED',
    repairCount: 0
  }), '66809703ea5c8e70c755a1d1812bc7c55f89268e64597e93d7b5b4ff01c3f11c');
  assert.equal(acceptedQualityFingerprint, '66809703ea5c8e70c755a1d1812bc7c55f89268e64597e93d7b5b4ff01c3f11c');
});

test('generation run persists a private allowlisted lifecycle without prompt, auth, cookie, or DOM contents', (t) => {
  const telemetryRoot = tempDirectory(t);
  const timestamps = [
    new Date('2026-08-02T10:00:00.000Z'),
    new Date('2026-08-02T10:00:00.010Z'),
    new Date('2026-08-02T10:00:00.020Z'),
    new Date('2026-08-02T10:00:00.030Z'),
    new Date('2026-08-02T10:00:00.300Z')
  ];
  const run = createGenerationRun({
    telemetryRoot,
    runId: 'run-safe-1',
    stage: 'test-generation',
    now: () => timestamps.shift() ?? new Date('2026-08-02T10:00:00.300Z'),
    prompt: 'TOP SECRET PROMPT',
    authorization: 'Bearer api-secret'
  });

  recordRunEvent(run, {
    type: 'stage',
    stage: 'input-assembly',
    status: 'completed',
    durationMs: 10,
    prompt: 'TOP SECRET PROMPT',
    cookie: 'session=private-cookie',
    dom: '<main>PRIVATE DOM SNAPSHOT</main>'
  });
  recordRunAttempt(run, {
    provider: 'openai',
    model: 'gpt-test',
    stage: 'test-generation',
    attempt: 1,
    status: 'failed',
    durationMs: 8,
    usage: null,
    retryStatus: 'retryable',
    failureStage: 'provider',
    failureReason: 'http-429',
    apiKey: 'sk-never-write-this'
  });
  recordRunAttempt(run, {
    provider: 'openai',
    model: 'gpt-test',
    stage: 'test-generation',
    attempt: 2,
    status: 'succeeded',
    durationMs: 120,
    usage: {
      inputTokens: 100,
      uncachedInputTokens: 30,
      cachedTokens: 60,
      cacheWriteTokens: 10,
      outputTokens: 20,
      reasoningTokens: 4,
      totalTokens: 120,
      promptChars: 1_700,
      compactionSavedChars: 300,
      resultCacheHit: false,
      prompt: 'DO NOT PERSIST'
    }
  });
  const summary = finalizeGenerationRun(run, {
    status: 'succeeded',
    quality: {
      reviewPassed: true,
      fastGatePassed: true,
      fullGatePassed: null,
      qualityFingerprint: 'a'.repeat(64),
      repairCount: 0
    }
  });

  assert.equal(summary.schemaVersion, 'generation-run/v1');
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.endToEndLatencyMs, 300);
  assert.equal(summary.attempts, 2);
  assert.equal(summary.failedAttempts, 1);
  assert.equal(summary.quality.fastGatePassed, true);
  assert.equal(summary.quality.promotionGatePolicy, null);
  assert.equal(summary.quality.promotionGateRepeatEach, null);

  const raw = fs.readFileSync(run.eventsPath, 'utf8') + fs.readFileSync(run.manifestPath, 'utf8');
  for (const secret of [
    'TOP SECRET PROMPT',
    'Bearer api-secret',
    'private-cookie',
    'PRIVATE DOM SNAPSHOT',
    'sk-never-write-this',
    'DO NOT PERSIST'
  ]) {
    assert.doesNotMatch(raw, new RegExp(secret));
  }

  const events = readJsonLines(run.eventsPath);
  assert.deepEqual(events.map((event) => event.type), ['run-started', 'stage', 'provider-attempt', 'provider-attempt', 'run-finished']);
  assert.equal(events[2].usage, null);
  assert.deepEqual(events[3].usage, {
    inputTokens: 100,
    uncachedInputTokens: 30,
    outputTokens: 20,
    cachedTokens: 60,
    cacheWriteTokens: 10,
    reasoningTokens: 4,
    totalTokens: 120,
    promptChars: 1_700,
    compactionSavedChars: 300,
    resultCacheHit: false,
    resultCacheStatus: 'disabled',
    providerPromptCacheStatus: 'disabled',
    singleFlightJoined: false,
    savedTokens: 0
  });
  assert.equal(fs.statSync(run.directory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(run.eventsPath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(run.manifestPath).mode & 0o777, 0o600);
});

test('generation quality keeps safe historical policy labels and nulls unsafe policy metadata', (t) => {
  const telemetryRoot = tempDirectory(t, 'quality-policy-normalization-');
  const cases = [
    ['historical', 'verified-fast-gate/v2', 'verified-fast-gate/v2'],
    ['control', 'verified-promotion-gate/v3\nPRIVATE', null],
    ['oversized', 'x'.repeat(129), null]
  ];

  for (const [runId, promotionGatePolicy, expected] of cases) {
    const run = createGenerationRun({ telemetryRoot, runId });
    const summary = finalizeGenerationRun(run, {
      status: 'failed',
      quality: { promotionGatePolicy }
    });
    assert.equal(summary.quality.promotionGatePolicy, expected, runId);
  }
});

test('generation quality keeps only historical and shared generated-gate repeat values', (t) => {
  const telemetryRoot = tempDirectory(t, 'quality-repeat-normalization-');
  const cases = [
    ['historical-one', 1, 1],
    ['promotion-two', 2, 2],
    ['full-three', 3, 3],
    ['zero', 0, null],
    ['negative', -1, null],
    ['fractional', 1.5, null],
    ['unknown', 4, null],
    ['oversized', Number.MAX_SAFE_INTEGER, null]
  ];

  for (const [runId, promotionGateRepeatEach, expected] of cases) {
    const run = createGenerationRun({ telemetryRoot, runId });
    const summary = finalizeGenerationRun(run, {
      status: 'failed',
      quality: { promotionGateRepeatEach }
    });
    assert.equal(summary.quality.promotionGateRepeatEach, expected, runId);
  }
});

test('generation run rejects path-like run ids', (t) => {
  const telemetryRoot = tempDirectory(t);
  assert.throws(
    () => createGenerationRun({ telemetryRoot, runId: '../escape' }),
    /run id/i
  );
  assert.equal(fs.existsSync(path.join(telemetryRoot, '..', 'escape')), false);
});

test('generation run rejects a symlinked telemetry root before writing or chmodding its target', (t) => {
  const workspace = tempDirectory(t, 'generation-root-link-');
  const victim = tempDirectory(t, 'generation-root-victim-');
  const telemetryRoot = path.join(workspace, 'generation');
  fs.chmodSync(victim, 0o755);
  fs.symlinkSync(victim, telemetryRoot, 'dir');

  assert.throws(
    () => createGenerationRun({ telemetryRoot, runId: 'must-not-escape' }),
    /telemetry root.*symbolic link/i
  );
  assert.equal(fs.statSync(victim).mode & 0o777, 0o755);
  assert.equal(fs.existsSync(path.join(victim, 'must-not-escape')), false);
});

test('generation run rejects a symlink component when creating a missing telemetry root', (t) => {
  const workspace = tempDirectory(t, 'generation-component-link-');
  const victim = tempDirectory(t, 'generation-component-victim-');
  const linkedParent = path.join(workspace, 'linked-parent');
  fs.symlinkSync(victim, linkedParent, 'dir');

  assert.throws(
    () => createGenerationRun({
      telemetryRoot: path.join(linkedParent, 'generation'),
      runId: 'must-not-follow-component'
    }),
    /telemetry root.*symbolic link/i
  );
  assert.equal(fs.existsSync(path.join(victim, 'generation')), false);
});

test('generation run rejects a symlink ancestor above an existing custom-root anchor', (t) => {
  const workspace = tempDirectory(t, 'generation-ancestor-link-');
  const victim = tempDirectory(t, 'generation-ancestor-victim-');
  const existingAnchor = path.join(victim, 'already-exists');
  fs.mkdirSync(existingAnchor);
  const linkedParent = path.join(workspace, 'linked-parent');
  fs.symlinkSync(victim, linkedParent, 'dir');

  assert.throws(
    () => createGenerationRun({
      telemetryRoot: path.join(linkedParent, 'already-exists', 'generation'),
      runId: 'must-not-follow-ancestor'
    }),
    /telemetry root.*symbolic link/i
  );
  assert.equal(fs.existsSync(path.join(existingAnchor, 'generation')), false);
});

test('full gate linkage atomically records the accepted candidate outcome and preserves its fingerprint', (t) => {
  const telemetryRoot = tempDirectory(t, 'full-gate-link-');
  const run = createGenerationRun({ telemetryRoot, runId: 'full-gate-run' });
  const subjectFingerprint = bindGenerationRunSubject(run, {
    specSha256: 'a'.repeat(64),
    targetIdentity: 'tests/regression/accepted.spec.ts'
  });
  assert.equal(subjectFingerprint, 'b7bc563572be2b29acf89aebb81c49a4b58c7441ad731a470a9b26f94bff70d8');
  finalizeGenerationRun(run, {
    status: 'succeeded',
    quality: {
      reviewPassed: true,
      fastGatePassed: true,
      fullGatePassed: null,
      promotionGatePolicy: PROMOTION_GATE_POLICY,
      promotionGateRepeatEach: PROMOTION_GATE_REPEAT_EACH,
      qualityFingerprint: acceptedQualityFingerprint,
      repairCount: 0
    }
  });

  const updated = linkGenerationRunFullGate({
    telemetryRoot,
    runId: 'full-gate-run',
    fullGatePassed: true,
    sourceSha256: acceptedSourceSha256,
    subjectFingerprint,
    outcomeStage: 'accepted',
    reasonCode: 'PASSED',
    now: () => new Date('2026-08-02T11:00:00.000Z'),
    diagnostics: ['PRIVATE runtime output must not be persisted']
  });

  assert.equal(updated.quality.fullGatePassed, true);
  assert.equal(updated.quality.qualityFingerprint, acceptedQualityFingerprint);
  assert.equal(updated.quality.fullGateUpdatedAt, '2026-08-02T11:00:00.000Z');
  assert.equal(updated.quality.fullGateOutcomeStage, 'accepted');
  const manifestPath = path.join(telemetryRoot, 'full-gate-run', 'manifest.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), updated);
  assert.equal(fs.statSync(manifestPath).mode & 0o777, 0o600);
  assert.doesNotMatch(fs.readFileSync(manifestPath, 'utf8'), /PRIVATE runtime output/);
  const linkedEvents = readJsonLines(path.join(telemetryRoot, 'full-gate-run', 'events.jsonl'))
    .filter((event) => event.type === 'full-gate-linked');
  assert.equal(linkedEvents.length, 1);
  assert.equal(linkedEvents[0].fullGatePassed, true);
});

test('historical v2 one-repeat quality remains readable but cannot satisfy current full-gate linkage', (t) => {
  const telemetryRoot = tempDirectory(t, 'full-gate-mismatch-');
  const run = createGenerationRun({ telemetryRoot, runId: 'changed-candidate-run' });
  const subjectFingerprint = bindGenerationRunSubject(run, {
    specSha256: 'a'.repeat(64),
    targetIdentity: 'tests/regression/accepted.spec.ts'
  });
  finalizeGenerationRun(run, {
    status: 'succeeded',
    quality: {
      reviewPassed: true,
      fastGatePassed: true,
      fullGatePassed: null,
      promotionGatePolicy: 'verified-fast-gate/v2',
      promotionGateRepeatEach: 1,
      qualityFingerprint: 'c4856bd8eea0b7ff742f989443785dd67eaf5448203aa1baf2e27281addf791e',
      repairCount: 0
    }
  });

  const historical = JSON.parse(fs.readFileSync(run.manifestPath, 'utf8'));
  assert.equal(historical.quality.promotionGatePolicy, 'verified-fast-gate/v2');
  assert.equal(historical.quality.promotionGateRepeatEach, 1);

  assert.throws(
    () => linkGenerationRunFullGate({
      telemetryRoot,
      runId: 'changed-candidate-run',
      fullGatePassed: false,
      sourceSha256: acceptedSourceSha256,
      subjectFingerprint,
      outcomeStage: 'runtime-test',
      reasonCode: 'RUNTIME_TEST_FAILED'
    }),
    /promotion gate policy|promotion gate evidence/i
  );
  const manifest = JSON.parse(fs.readFileSync(run.manifestPath, 'utf8'));
  assert.equal(manifest.quality.fullGatePassed, null);
  assert.equal(fs.existsSync(path.join(run.directory, '.quality-update.lock')), false);
});

test('linked full-gate rejection invalidates its recorded exact cache entry', async (t) => {
  const telemetryRoot = tempDirectory(t, 'full-gate-cache-reject-');
  const cacheDir = tempDirectory(t, 'full-gate-cache-');
  const keyOptions = { provider: 'openai', model: 'gpt-test', systemPrompt: 'system', prompt: 'task', contractVersion: 'v1' };
  const key = createGenerationCacheKey(keyOptions);
  const candidate = createGenerationCacheCandidate({ cacheDir, key, provider: 'openai', model: 'gpt-test', contractVersion: 'v1', text: 'const accepted = true;', inputTargetSha256: null });
  const reference = await promoteGenerationCache(candidate, { qualityFingerprint: 'f'.repeat(64), outputSha256: '2'.repeat(64) });
  const run = createGenerationRun({ telemetryRoot, runId: 'cache-rejected-run' });
  const subjectFingerprint = bindGenerationRunSubject(run, { specSha256: 'a'.repeat(64), targetIdentity: 'tests/regression/accepted.spec.ts' });
  bindGenerationRunCacheReference(run, reference);
  finalizeGenerationRun(run, {
    status: 'succeeded',
    quality: {
      reviewPassed: true,
      fastGatePassed: true,
      promotionGatePolicy: PROMOTION_GATE_POLICY,
      promotionGateRepeatEach: PROMOTION_GATE_REPEAT_EACH,
      qualityFingerprint: acceptedQualityFingerprint,
      repairCount: 0
    }
  });

  linkGenerationRunFullGate({ telemetryRoot, cacheDir, runId: 'cache-rejected-run', fullGatePassed: false,
    sourceSha256: acceptedSourceSha256, subjectFingerprint,
    outcomeStage: 'runtime-test', reasonCode: 'RUNTIME_TEST_FAILED' });
  assert.equal(await readGenerationCache({ cacheDir, key, provider: 'openai', model: 'gpt-test', contractVersion: 'v1', currentTargetSha256: null }), null);
});

test('full gate linkage rejects an identical source copied to a different generation subject', (t) => {
  const telemetryRoot = tempDirectory(t, 'full-gate-subject-mismatch-');
  const run = createGenerationRun({ telemetryRoot, runId: 'subject-bound-run' });
  bindGenerationRunSubject(run, {
    specSha256: 'a'.repeat(64),
    targetIdentity: 'tests/regression/accepted.spec.ts'
  });
  finalizeGenerationRun(run, {
    status: 'succeeded',
    quality: {
      reviewPassed: true,
      fastGatePassed: true,
      fullGatePassed: null,
      promotionGatePolicy: PROMOTION_GATE_POLICY,
      promotionGateRepeatEach: PROMOTION_GATE_REPEAT_EACH,
      qualityFingerprint: acceptedQualityFingerprint,
      repairCount: 0
    }
  });

  assert.throws(
    () => linkGenerationRunFullGate({
      telemetryRoot,
      runId: 'subject-bound-run',
      fullGatePassed: true,
      sourceSha256: acceptedSourceSha256,
      subjectFingerprint: 'f889318fe77af251390073816c691350bdf9d78fdfb1c84c4dfa7a4e6d9b19be',
      outcomeStage: 'accepted',
      reasonCode: 'PASSED'
    }),
    /generation subject/i
  );
  assert.equal(JSON.parse(fs.readFileSync(run.manifestPath, 'utf8')).quality.fullGatePassed, null);
});

test('full gate linkage rejects a custom telemetry root reached through a symlink ancestor', (t) => {
  const workspace = tempDirectory(t, 'full-gate-root-alias-');
  const victim = tempDirectory(t, 'full-gate-root-victim-');
  const telemetryRoot = path.join(victim, 'generation');
  const run = createGenerationRun({ telemetryRoot, runId: 'aliased-link-run' });
  const subjectFingerprint = bindGenerationRunSubject(run, {
    specSha256: 'a'.repeat(64),
    targetIdentity: 'tests/regression/accepted.spec.ts'
  });
  finalizeGenerationRun(run, {
    status: 'succeeded',
    quality: {
      reviewPassed: true,
      fastGatePassed: true,
      fullGatePassed: null,
      promotionGatePolicy: PROMOTION_GATE_POLICY,
      promotionGateRepeatEach: PROMOTION_GATE_REPEAT_EACH,
      qualityFingerprint: acceptedQualityFingerprint,
      repairCount: 0
    }
  });
  const alias = path.join(workspace, 'linked-victim');
  fs.symlinkSync(victim, alias, 'dir');

  assert.throws(
    () => linkGenerationRunFullGate({
      telemetryRoot: path.join(alias, 'generation'),
      runId: 'aliased-link-run',
      fullGatePassed: true,
      sourceSha256: acceptedSourceSha256,
      subjectFingerprint,
      outcomeStage: 'accepted',
      reasonCode: 'PASSED'
    }),
    /telemetry root.*symbolic link/i
  );
  assert.equal(JSON.parse(fs.readFileSync(run.manifestPath, 'utf8')).quality.fullGatePassed, null);
});

test('repeated full gate outcomes append audit history instead of erasing the prior verdict', (t) => {
  const telemetryRoot = tempDirectory(t, 'full-gate-history-');
  const run = createGenerationRun({ telemetryRoot, runId: 'full-gate-history-run' });
  const subjectFingerprint = bindGenerationRunSubject(run, {
    specSha256: 'a'.repeat(64),
    targetIdentity: 'tests/regression/accepted.spec.ts'
  });
  finalizeGenerationRun(run, {
    status: 'succeeded',
    quality: {
      reviewPassed: true,
      fastGatePassed: true,
      fullGatePassed: null,
      promotionGatePolicy: PROMOTION_GATE_POLICY,
      promotionGateRepeatEach: PROMOTION_GATE_REPEAT_EACH,
      qualityFingerprint: acceptedQualityFingerprint,
      repairCount: 0
    }
  });
  const common = {
    telemetryRoot,
    runId: 'full-gate-history-run',
    sourceSha256: acceptedSourceSha256,
    subjectFingerprint
  };
  linkGenerationRunFullGate({
    ...common,
    fullGatePassed: false,
    outcomeStage: 'runtime-test',
    reasonCode: 'RUNTIME_TEST_FAILED'
  });
  linkGenerationRunFullGate({
    ...common,
    fullGatePassed: true,
    outcomeStage: 'accepted',
    reasonCode: 'PASSED'
  });

  const history = readJsonLines(run.eventsPath).filter((event) => event.type === 'full-gate-linked');
  assert.deepEqual(history.map((event) => event.fullGatePassed), [false, true]);
  assert.deepEqual(history.map((event) => event.outcomeStage), ['runtime-test', 'accepted']);
  assert.equal(JSON.parse(fs.readFileSync(run.manifestPath, 'utf8')).quality.fullGatePassed, true);
});

test('result-cache events preserve only safe cache metrics without counting a provider attempt', (t) => {
  const telemetryRoot = tempDirectory(t);
  const run = createGenerationRun({ telemetryRoot, runId: 'cache-hit-run' });
  recordRunEvent(run, {
    type: 'result-cache',
    stage: 'test-generation',
    status: 'completed',
    provider: 'openai',
    model: 'gpt-test',
    durationMs: 2,
    usage: {
      inputTokens: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      resultCacheHit: true,
      savedTokens: 120,
      cachedSource: 'PRIVATE GENERATED SOURCE'
    }
  });
  const summary = finalizeGenerationRun(run, { status: 'succeeded' });

  const event = readJsonLines(run.eventsPath).find((entry) => entry.type === 'result-cache');
  assert.equal(summary.attempts, 0);
  assert.equal(event.provider, 'openai');
  assert.equal(event.model, 'gpt-test');
  assert.equal(event.usage.resultCacheHit, true);
  assert.equal(event.usage.savedTokens, 120);
  assert.doesNotMatch(fs.readFileSync(run.eventsPath, 'utf8'), /PRIVATE GENERATED SOURCE/);
});

test('OpenAI truncation preserves supplied usage and reports one classified attempt', async (t) => {
  const attempts = [];
  const cacheDir = tempDirectory(t, 'truncated-cache-status-');
  const response = fakeResponse({ body: openaiBody({ finishReason: 'length' }) });

  await assert.rejects(
    runBrain('dynamic task', {
      env: { OPENAI_API_KEY: 'sk-test' },
      cacheDir,
      currentTargetSha256: null,
      fetchImpl: async () => response,
      onAttempt: (attempt) => attempts.push(attempt),
      ...noBinaries
    }),
    (error) => {
      assert.match(error.message, /truncated/);
      assert.equal(error.failureReason, 'truncated');
      assert.equal(error.usage.uncachedInputTokens, 30);
      assert.equal(error.usage.cachedTokens, 60);
      assert.equal(error.usage.cacheWriteTokens, 10);
      assert.equal(error.usage.outputTokens, 20);
      assert.equal(error.usage.resultCacheStatus, 'miss');
      assert.equal(error.usage.providerPromptCacheStatus, 'automatic-possible');
      return true;
    }
  );

  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, 'truncated');
  assert.equal(attempts[0].attempt, 1);
  assert.equal(attempts[0].usage.totalTokens, 120);
  assert.equal(attempts[0].usage.resultCacheStatus, 'miss');
});

test('malformed structured output preserves usage instead of turning a paid call into an unknown attempt', async () => {
  const attempts = [];
  const response = fakeResponse({ body: openaiBody({ text: '{not-json' }) });

  await assert.rejects(
    runBrain('dynamic task', {
      env: { OPENAI_API_KEY: 'sk-test' },
      fetchImpl: async () => response,
      onAttempt: (attempt) => attempts.push(attempt),
      ...noBinaries
    }),
    (error) => {
      assert.equal(error.failureReason, 'malformed-output');
      assert.equal(error.usage.totalTokens, 120);
      return true;
    }
  );

  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, 'malformed');
  assert.equal(attempts[0].usage.totalTokens, 120);
});

test('OpenAI refusal preserves supplied usage and is classified without storing refusal text', async () => {
  const attempts = [];
  const body = openaiBody({ text: '' });
  body.choices[0].message.refusal = 'provider refusal text that must not become telemetry';
  const response = fakeResponse({ body });

  await assert.rejects(
    runBrain('dynamic task', {
      env: { OPENAI_API_KEY: 'sk-test' },
      fetchImpl: async () => response,
      onAttempt: (attempt) => attempts.push(attempt),
      ...noBinaries
    }),
    (error) => {
      assert.equal(error.failureReason, 'refused');
      assert.equal(error.usage.totalTokens, 120);
      return true;
    }
  );

  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, 'refused');
  assert.equal(attempts[0].failureReason, 'refused');
  assert.equal('refusal' in attempts[0], false);
});

test('HTTP failures report unknown usage and retry delay observes the active abort signal', async () => {
  const controller = new AbortController();
  const attempts = [];
  let fetchCalls = 0;
  const response = fakeResponse({ ok: false, status: 429, headers: { 'retry-after': '30' } });

  await assert.rejects(
    runBrain('dynamic task', {
      env: { OPENAI_API_KEY: 'sk-test' },
      fetchImpl: async () => {
        fetchCalls += 1;
        return response;
      },
      signal: controller.signal,
      onAttempt: (attempt) => {
        attempts.push(attempt);
        if (attempt.retryStatus === 'retrying') controller.abort(new Error('cancelled during retry delay'));
      },
      sleep: async (_delayMs, _value, { signal } = {}) => {
        if (signal?.aborted) throw signal.reason;
      },
      ...noBinaries
    }),
    /cancelled during retry delay/
  );

  assert.equal(fetchCalls, 1);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, 'failed');
  assert.equal(attempts[0].retryStatus, 'retrying');
  assert.equal(attempts[0].usage, null);
});

test('an exhausted HTTP retry exposes provider metadata when the caller cannot forward the attempt observer', async () => {
  let fetchCalls = 0;
  const attempts = [];
  const response = fakeResponse({ ok: false, status: 500 });

  await assert.rejects(
    runBrain('dynamic task', {
      env: { OPENAI_API_KEY: 'sk-test', AI_OPENAI_MODEL: 'gpt-test' },
      fetchImpl: async () => {
        fetchCalls += 1;
        return response;
      },
      sleep: async () => {},
      onAttempt: (attempt) => attempts.push(attempt),
      ...noBinaries
    }),
    (error) => {
      assert.equal(error.provider, 'openai');
      assert.equal(error.model, 'gpt-test');
      assert.equal(error.retryCount, 2);
      assert.equal(error.usage, null);
      assert.equal(error.failureReason, 'http-500');
      return true;
    }
  );
  assert.equal(fetchCalls, 3);
  assert.equal(attempts.at(-1).resultCacheStatus, 'disabled');
  assert.equal(attempts.at(-1).providerPromptCacheStatus, 'automatic-possible');
  assert.equal(attempts.at(-1).usage, null);
});

test('generation-run preserves cache controls for a terminal unknown-usage attempt', (t) => {
  const run = createGenerationRun({ telemetryRoot: tempDirectory(t), runId: 'unknown-usage-cache-control' });
  recordRunAttempt(run, {
    provider: 'openai',
    model: 'gpt-test',
    stage: 'test-generation',
    attempt: 1,
    status: 'failed',
    usage: null,
    resultCacheStatus: 'miss',
    providerPromptCacheStatus: 'automatic-possible'
  });
  finalizeGenerationRun(run, { status: 'failed', failureStage: 'provider', failureReason: 'http-500' });
  const event = readJsonLines(run.eventsPath).find((entry) => entry.type === 'provider-attempt');
  assert.equal(event.usage.resultCacheStatus, 'miss');
  assert.equal(event.usage.providerPromptCacheStatus, 'automatic-possible');
  assert.equal(event.usage.totalTokens, null);
});

test('a concurrent exact single-flight join saves a provider request without duplicating paid usage', async (t) => {
  const cacheDir = tempDirectory(t, 'single-flight-telemetry-');
  let releaseFetch;
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    await new Promise((resolve) => { releaseFetch = resolve; });
    return fakeResponse({ body: openaiBody() });
  };
  const firstAttempts = [];
  const joinedAttempts = [];
  const options = {
    env: { OPENAI_API_KEY: 'sk-test', AI_RESULT_CACHE: 'true' },
    cacheDir,
    currentTargetSha256: 'a'.repeat(64),
    fetchImpl,
    ...noBinaries
  };

  const first = runBrain('same exact task', {
    ...options,
    onAttempt: (attempt) => firstAttempts.push(attempt)
  });
  while (!releaseFetch) await new Promise((resolve) => setImmediate(resolve));
  const joined = runBrain('same exact task', {
    ...options,
    onAttempt: (attempt) => joinedAttempts.push(attempt)
  });
  await new Promise((resolve) => setImmediate(resolve));
  releaseFetch();
  const [leaderResult, joinedResult] = await Promise.all([first, joined]);

  assert.equal(fetchCalls, 1);
  assert.equal(firstAttempts.length, 1);
  assert.equal(joinedAttempts.length, 0);
  assert.equal(leaderResult.usage.resultCacheStatus, 'miss');
  assert.equal(leaderResult.usage.providerPromptCacheStatus, 'automatic-possible');
  assert.equal(joinedResult.singleFlightJoined, true);
  assert.equal(joinedResult.usage.resultCacheStatus, 'single-flight-join');
  assert.equal(joinedResult.usage.totalTokens, 0);
  assert.equal(joinedResult.usage.requestCount, 0);
  assert.equal(joinedResult.usage.savedTokens, leaderResult.usage.totalTokens);
});

test('single-flight never joins different current target preconditions sharing one semantic key', async (t) => {
  const cacheDir = tempDirectory(t, 'single-flight-target-state-');
  const releases = [];
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    await new Promise((resolve) => releases.push(resolve));
    return fakeResponse({ body: openaiBody() });
  };
  const common = {
    env: { OPENAI_API_KEY: 'sk-test', AI_RESULT_CACHE: 'true' }, cacheDir, fetchImpl,
    cacheIdentityPrompt: 'immutable semantic task', ...noBinaries
  };
  const first = runBrain('provider target A', { ...common, currentTargetSha256: 'a'.repeat(64) });
  const second = runBrain('provider target C', { ...common, currentTargetSha256: 'c'.repeat(64) });
  while (releases.length < 2) await new Promise((resolve) => setImmediate(resolve));
  releases.forEach((release) => release());
  const results = await Promise.all([first, second]);
  assert.equal(fetchCalls, 2);
  assert.ok(results.every((result) => result.singleFlightJoined !== true));
});

test('verified generation records provider, gate, promotion, and final quality under one run id', async (t) => {
  const webRoot = tempDirectory(t, 'verified-telemetry-');
  const target = path.join(webRoot, 'tests', 'regression', 'accepted.spec.ts');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  writeValidFlowSpec(webRoot, 'accepted.md', 'accepted.spec.ts');

  const result = await runVerifiedGeneration({
    specPath: 'specs/accepted.md',
    out: 'tests/regression/accepted.spec.ts',
    webRoot,
    env: { PLAYWRIGHT_TEST_BASE_URL: fixtureBaseUrl, AI_ENV_PREFLIGHT: 'false' },
    browserExecutableExists: () => true,
    candidateId: () => 'accepted-run',
    generate: async ({ onAttempt }) => {
      onAttempt?.({
        provider: 'openai',
        model: 'gpt-test',
        stage: 'test-generation',
        attempt: 1,
        status: 'succeeded',
        durationMs: 25,
        usage: {
          inputTokens: 10,
          uncachedInputTokens: 10,
          outputTokens: 5,
          cachedTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          totalTokens: 15
        }
      });
      return {
        code: 'const accepted = true;\n',
        promptPath: 'specs/accepted.md',
        result: { brain: { kind: 'openai', model: 'gpt-test' }, usage: { totalTokens: 15 } }
      };
    },
    gate: async () => ({ passed: true, stage: 'fast-gate' })
  });

  assert.equal(result.runId, 'accepted-run');
  const runDirectory = path.join(webRoot, '.ai-runs', 'generation', 'accepted-run');
  const manifest = JSON.parse(fs.readFileSync(path.join(runDirectory, 'manifest.json'), 'utf8'));
  const events = readJsonLines(path.join(runDirectory, 'events.jsonl'));
  assert.equal(manifest.status, 'succeeded');
  assert.equal(manifest.quality.reviewPassed, true);
  assert.equal(manifest.quality.fastGatePassed, true);
  assert.equal(manifest.quality.promotionGatePolicy, PROMOTION_GATE_POLICY);
  assert.equal(manifest.quality.promotionGateRepeatEach, PROMOTION_GATE_REPEAT_EACH);
  assert.equal(manifest.quality.qualityFingerprint, acceptedQualityFingerprint);
  assert.match(manifest.subjectFingerprint, /^[a-f0-9]{64}$/);
  assert.ok(events.some((event) => event.type === 'provider-attempt' && event.status === 'succeeded'));
  assert.ok(events.some((event) => event.type === 'stage' && event.stage === 'fast-gate' && event.status === 'completed'));
  assert.ok(events.some((event) => event.type === 'stage' && event.stage === 'promotion' && event.status === 'completed'));
});

test('the production generateTestSource seam forwards onAttempt to runBrain', async (t) => {
  const packageRoot = tempDirectory(t, 'generate-attempt-forwarding-');
  fs.mkdirSync(path.join(packageRoot, 'tests'), { recursive: true });
  const taskPath = path.join(packageRoot, 'task.md');
  fs.writeFileSync(taskPath, '# generation task\n');
  const onAttempt = () => {};
  const controller = new AbortController();
  let receivedObserver;
  let receivedSignal;
  let receivedTargetState;

  await generateTestSource({
    taskPath,
    out: 'tests/generated.spec.ts',
    packageRoot,
    resolvedEnv: { env: {} },
    selectBrainImpl: () => ({ kind: 'openai', model: 'gpt-test' }),
    runBrainImpl: async (_prompt, options) => {
      receivedObserver = options.onAttempt;
      receivedSignal = options.signal;
      receivedTargetState = Object.hasOwn(options, 'currentTargetSha256') ? options.currentTargetSha256 : undefined;
      return {
        text: '```ts\nconst generated = true;\n```',
        brain: { kind: 'openai', model: 'gpt-test' },
        usage: null
      };
    },
    onAttempt,
    signal: controller.signal
  });

  assert.equal(receivedObserver, onAttempt);
  assert.equal(receivedSignal, controller.signal);
  assert.equal(receivedTargetState, undefined);
});

test('legacy generation manifests carry the new run id so reporters can deduplicate them', (t) => {
  const directory = tempDirectory(t, 'legacy-run-link-');
  const taskPath = path.join(directory, 'task.md');
  fs.writeFileSync(taskPath, '# task\n');
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ specPath: 'specs/example.md' }));

  assert.equal(recordGenerationInManifest({
    promptPath: taskPath,
    outPath: 'tests/example.spec.ts',
    brain: { kind: 'openai', model: 'gpt-test' },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    runId: 'linked-run',
    now: () => new Date('2026-08-02T10:00:00.000Z')
  }), true);

  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.generation.runId, 'linked-run');
});

test('verified generation finalizes a rejected run without persisting the gate error text', async (t) => {
  const webRoot = tempDirectory(t, 'rejected-telemetry-');
  const target = path.join(webRoot, 'tests', 'regression', 'rejected.spec.ts');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'const old = true;\n');
  writeValidFlowSpec(webRoot, 'rejected.md', 'rejected.spec.ts');

  await assert.rejects(
    runVerifiedGeneration({
      specPath: 'specs/rejected.md',
      out: 'tests/regression/rejected.spec.ts',
      webRoot,
      env: { PLAYWRIGHT_TEST_BASE_URL: fixtureBaseUrl, AI_ENV_PREFLIGHT: 'false' },
      browserExecutableExists: () => true,
      candidateId: () => 'rejected-run',
      generate: async () => ({
        code: 'const candidate = true;\n',
        result: {
          brain: { kind: 'openai', model: 'gpt-test' },
          usage: { inputTokens: 9, uncachedInputTokens: 9, outputTokens: 3, totalTokens: 12 }
        }
      }),
      gate: async () => ({
        passed: false,
        stage: 'static-review',
        reason: 'SECRET locator and DOM details must never reach telemetry'
      })
    }),
    /fast acceptance gate failed/i
  );

  const runDirectory = path.join(webRoot, '.ai-runs', 'generation', 'rejected-run');
  const raw = fs.readFileSync(path.join(runDirectory, 'events.jsonl'), 'utf8') +
    fs.readFileSync(path.join(runDirectory, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(runDirectory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.failureStage, 'static-review');
  assert.equal(manifest.failureReason, 'gate-rejected');
  assert.equal(manifest.quality.promotionGatePolicy, PROMOTION_GATE_POLICY);
  assert.equal(manifest.quality.promotionGateRepeatEach, PROMOTION_GATE_REPEAT_EACH);
  assert.match(manifest.quality.qualityFingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(raw, /SECRET locator|DOM details/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'const old = true;\n');
});

test('verified generation records a single-flight join as a saved request, not a paid provider attempt', async (t) => {
  const webRoot = tempDirectory(t, 'joined-telemetry-');
  fs.mkdirSync(path.join(webRoot, 'tests', 'regression'), { recursive: true });
  writeValidFlowSpec(webRoot, 'joined.md', 'joined.spec.ts');

  await runVerifiedGeneration({
    specPath: 'specs/joined.md',
    out: 'tests/regression/joined.spec.ts',
    webRoot,
    env: { PLAYWRIGHT_TEST_BASE_URL: fixtureBaseUrl, AI_ENV_PREFLIGHT: 'false' },
    browserExecutableExists: () => true,
    candidateId: () => 'joined-run',
    generate: async () => ({
      code: 'const joined = true;\n',
      result: {
        brain: { kind: 'openai', model: 'gpt-test' },
        singleFlightJoined: true,
        usage: {
          inputTokens: 0,
          uncachedInputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
          requestCount: 0,
          resultCacheHit: false,
          resultCacheStatus: 'single-flight-join',
          providerPromptCacheStatus: 'automatic-possible',
          singleFlightJoined: true,
          savedTokens: 120
        }
      }
    }),
    gate: async () => ({ passed: true, stage: 'fast-gate' })
  });

  const runDirectory = path.join(webRoot, '.ai-runs', 'generation', 'joined-run');
  const manifest = JSON.parse(fs.readFileSync(path.join(runDirectory, 'manifest.json'), 'utf8'));
  const events = readJsonLines(path.join(runDirectory, 'events.jsonl'));
  assert.equal(manifest.attempts, 0);
  const join = events.find((event) => event.type === 'result-cache');
  assert.equal(join.usage.resultCacheStatus, 'single-flight-join');
  assert.equal(join.usage.savedTokens, 120);
});

test('a failed single-flight join remains a non-attempt when the leader fails', async (t) => {
  const webRoot = tempDirectory(t, 'failed-join-telemetry-');
  fs.mkdirSync(path.join(webRoot, 'tests', 'regression'), { recursive: true });
  writeValidFlowSpec(webRoot, 'failed-join.md', 'failed-join.spec.ts');
  const joinedError = Object.assign(new Error('leader failed'), {
    provider: 'openai',
    model: 'gpt-test',
    usage: null,
    retryCount: 0,
    failureReason: 'single-flight-leader-failed',
    singleFlightJoined: true
  });

  await assert.rejects(
    runVerifiedGeneration({
      specPath: 'specs/failed-join.md',
      out: 'tests/regression/failed-join.spec.ts',
      webRoot,
      env: { PLAYWRIGHT_TEST_BASE_URL: fixtureBaseUrl, AI_ENV_PREFLIGHT: 'false' },
      browserExecutableExists: () => true,
      candidateId: () => 'failed-join-run',
      generate: async () => { throw joinedError; }
    }),
    /leader failed/
  );

  const runDirectory = path.join(webRoot, '.ai-runs', 'generation', 'failed-join-run');
  const manifest = JSON.parse(fs.readFileSync(path.join(runDirectory, 'manifest.json'), 'utf8'));
  const events = readJsonLines(path.join(runDirectory, 'events.jsonl'));
  assert.equal(manifest.attempts, 0);
  const join = events.find((event) => event.type === 'result-cache');
  assert.equal(join.status, 'failed');
  assert.equal(join.usage.resultCacheStatus, 'single-flight-join');
});

test('verified generation reconstructs every unknown retry attempt when its generator cannot forward onAttempt', async (t) => {
  const webRoot = tempDirectory(t, 'retry-telemetry-');
  fs.mkdirSync(path.join(webRoot, 'tests', 'regression'), { recursive: true });
  writeValidFlowSpec(webRoot, 'retry.md', 'retry.spec.ts');
  const providerError = Object.assign(new Error('provider error with arbitrary private detail'), {
    provider: 'openai',
    model: 'gpt-test',
    retryCount: 2,
    usage: null,
    failureReason: 'http-500'
  });

  await assert.rejects(
    runVerifiedGeneration({
      specPath: 'specs/retry.md',
      out: 'tests/regression/retry.spec.ts',
      webRoot,
      env: { PLAYWRIGHT_TEST_BASE_URL: fixtureBaseUrl, AI_ENV_PREFLIGHT: 'false' },
      browserExecutableExists: () => true,
      candidateId: () => 'retry-run',
      generate: async () => { throw providerError; }
    }),
    /provider error/
  );

  const runDirectory = path.join(webRoot, '.ai-runs', 'generation', 'retry-run');
  const manifest = JSON.parse(fs.readFileSync(path.join(runDirectory, 'manifest.json'), 'utf8'));
  const attempts = readJsonLines(path.join(runDirectory, 'events.jsonl'))
    .filter((event) => event.type === 'provider-attempt');
  assert.equal(manifest.attempts, 3);
  assert.equal(manifest.failedAttempts, 3);
  assert.deepEqual(attempts.map((attempt) => attempt.attempt), [1, 2, 3]);
  assert.ok(attempts.every((attempt) => attempt.provider === 'openai' && attempt.model === 'gpt-test'));
  assert.ok(attempts.every((attempt) => attempt.usage === null));
});

test('candidate-integrity rejection is attributed to promotion safety rather than the already-passed gate', async (t) => {
  const webRoot = tempDirectory(t, 'integrity-stage-');
  fs.mkdirSync(path.join(webRoot, 'tests', 'regression'), { recursive: true });
  writeValidFlowSpec(webRoot, 'integrity.md', 'integrity.spec.ts');

  await assert.rejects(runVerifiedGeneration({
    specPath: 'specs/integrity.md',
    out: 'tests/regression/integrity.spec.ts',
    webRoot,
    env: { PLAYWRIGHT_TEST_BASE_URL: fixtureBaseUrl, AI_ENV_PREFLIGHT: 'false' },
    browserExecutableExists: () => true,
    candidateId: () => 'integrity-run',
    generate: async () => ({ code: 'const candidate = true;\n', result: {} }),
    gate: async ({ testPath }) => {
      fs.appendFileSync(testPath, 'const changed = true;\n');
      return { passed: true, stage: 'fast-gate' };
    }
  }), /changed during verification/);

  const manifest = JSON.parse(fs.readFileSync(
    path.join(webRoot, '.ai-runs', 'generation', 'integrity-run', 'manifest.json'),
    'utf8'
  ));
  assert.equal(manifest.failureStage, 'candidate-integrity');
  assert.equal(manifest.failureReason, 'candidate-integrity');
});
