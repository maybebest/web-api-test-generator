import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  WASTE_CLASS_RULE_VERSION,
  appendSnapshot,
  appendTriageAudit,
  classifyFailureFacts,
  classifyWasteStage,
  computeMetrics,
  createSnapshot,
  parseMetricsArgs,
  readHistory,
  readMetricsInputs,
  readTriageAudits,
  renderHealFrugality,
  renderTrend
} from '../metrics-report.mjs';
import { readGenerationUsage, summarizeGenerationUsage } from '../token-usage-report.mjs';

const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'metrics-report.mjs'
);

function tempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-report-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function attemptUsage({ totalTokens, resultCacheStatus = 'miss' }) {
  return {
    inputTokens: totalTokens,
    uncachedInputTokens: totalTokens,
    outputTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens,
    resultCacheStatus
  };
}

function writeGenerationRun(root, runId, {
  startedAt,
  status = 'succeeded',
  failureStage = null,
  failureReason = null,
  endToEndLatencyMs = null,
  reviewPassed = null,
  repairCount = 0,
  staticReviewWarningCount,
  attempts = [],
  cacheEvents = []
} = {}) {
  const directory = path.join(root, 'generation', runId);
  fs.mkdirSync(directory, { recursive: true });
  const providerEvents = attempts.map((attempt) => ({
    schemaVersion: 'generation-run-event/v1',
    runId,
    type: 'provider-attempt',
    timestamp: startedAt,
    stage: 'test-generation',
    provider: 'anthropic',
    model: 'claude-test',
    status: 'succeeded',
    ...attempt
  }));
  const cacheRows = cacheEvents.map((event) => ({
    schemaVersion: 'generation-run-event/v1',
    runId,
    type: 'result-cache',
    timestamp: startedAt,
    stage: 'test-generation',
    provider: 'anthropic',
    model: 'claude-test',
    status: 'completed',
    ...event
  }));
  const events = [
    {
      schemaVersion: 'generation-run-event/v1', runId, type: 'run-started',
      timestamp: startedAt, stage: 'test-generation', status: 'started'
    },
    ...providerEvents,
    ...cacheRows,
    {
      schemaVersion: 'generation-run-event/v1', runId, type: 'run-finished',
      timestamp: startedAt, stage: 'test-generation', status, failureStage, failureReason
    }
  ].map((event, sequence) => ({ ...event, sequence }));
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({
    schemaVersion: 'generation-run/v1',
    runId,
    stage: 'test-generation',
    status,
    startedAt,
    failureStage,
    failureReason,
    endToEndLatencyMs,
    events: events.length,
    attempts: providerEvents.length,
    failedAttempts: providerEvents.filter((event) => event.status !== 'succeeded').length,
    quality: {
      reviewPassed,
      repairCount,
      ...(staticReviewWarningCount === undefined ? {} : { staticReviewWarningCount })
    }
  }));
  fs.writeFileSync(
    path.join(directory, 'events.jsonl'),
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`
  );
}

function writeHealRun(root, epochMs, { status, providerAttempts = [] }) {
  const directory = path.join(root, 'heal', `${epochMs}-1-run-${status}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'heal-summary.json'), JSON.stringify({
    schema: 'test-heal-run/v1',
    runId: path.basename(directory),
    status,
    providerAttempts
  }));
  return path.basename(directory);
}

function writeSyntheticRuns(root) {
  // A: promoted through a paid provider attempt, zero reviewer warnings.
  writeGenerationRun(root, 'run-a-promoted', {
    startedAt: '2026-08-01T10:00:00.000Z',
    status: 'succeeded',
    endToEndLatencyMs: 5000,
    reviewPassed: true,
    staticReviewWarningCount: 0,
    attempts: [{ usage: attemptUsage({ totalTokens: 1000 }) }]
  });
  // B: failed at static review with billed tokens.
  writeGenerationRun(root, 'run-b-static-fail', {
    startedAt: '2026-08-01T11:00:00.000Z',
    status: 'failed',
    failureStage: 'static-review',
    failureReason: 'gate-rejected',
    endToEndLatencyMs: 60000,
    reviewPassed: false,
    attempts: [{ usage: attemptUsage({ totalTokens: 500 }) }]
  });
  // C: cli-failed provider attempt; usage unknown, contributes zero tokens.
  writeGenerationRun(root, 'run-c-cli-failed', {
    startedAt: '2026-08-01T12:00:00.000Z',
    status: 'failed',
    failureStage: 'test-generation',
    failureReason: 'cli-failed',
    endToEndLatencyMs: 2000,
    attempts: [{ status: 'failed', failureStage: 'provider', failureReason: 'cli-failed', usage: null }]
  });
  // D: result-cache hit; promoted with zero billed tokens and no provider
  // attempt. Its manifest predates warning telemetry (no warning count).
  writeGenerationRun(root, 'run-d-cache-hit', {
    startedAt: '2026-08-01T13:00:00.000Z',
    status: 'succeeded',
    endToEndLatencyMs: 800,
    reviewPassed: true,
    cacheEvents: [{
      usage: {
        inputTokens: 0, uncachedInputTokens: 0, outputTokens: 0, cachedTokens: 0,
        cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 0,
        resultCacheHit: true, resultCacheStatus: 'hit', savedTokens: 300
      }
    }]
  });
  // E: rejected before any provider work.
  writeGenerationRun(root, 'run-e-preflight', {
    startedAt: '2026-08-01T14:00:00.000Z',
    status: 'failed',
    failureStage: 'environment-preflight',
    failureReason: 'environment-preflight',
    endToEndLatencyMs: 100
  });
  writeHealRun(root, 1754040000000, { status: 'brain-error', providerAttempts: [] });
  writeHealRun(root, 1754041000000, {
    status: 'healed',
    providerAttempts: [{ attempt: 1, kind: 'anthropic', usage: { totalTokens: 400 } }]
  });
  writeHealRun(root, 1754042000000, {
    status: 'exhausted',
    providerAttempts: [{ attempt: 1, kind: 'anthropic', usage: { totalTokens: 200 } }]
  });
}

const V1_TREND_METRICS = {
  yield: 0.25,
  tokensPerAccepted: 40000,
  firstPassStaticRate: 0.5,
  wasteByStage: {
    wastedTokens: 900,
    environment: { tokens: 0, share: 0 },
    staticReview: { tokens: 900, share: 1 },
    runtime: { tokens: 0, share: 0 },
    other: { tokens: 0, share: 0 }
  },
  cache: { hits: 0, lookups: 3, savedTokens: 0, savedShare: null },
  timeToAccepted: { p50Ms: 7000, p95Ms: 70000 },
  healFrugality: null,
  tokensPerSuccessfulHeal: null,
  totals: { runs: 4, promoted: 1, providerSpawning: 4, billedTokens: 40000, savedTokens: 0, healRuns: 0 }
};

test('parseMetricsArgs understands report, snapshot, trend, and audit modes', () => {
  assert.deepEqual(parseMetricsArgs([]).mode, 'report');
  const snapshot = parseMetricsArgs(['--snapshot', '--label', 'iter1', '--since', '2026-08-01T00:00:00Z']);
  assert.equal(snapshot.mode, 'snapshot');
  assert.equal(snapshot.label, 'iter1');
  assert.equal(snapshot.since, Date.parse('2026-08-01T00:00:00Z'));
  const trend = parseMetricsArgs(['--trend']);
  assert.equal(trend.mode, 'trend');
  const withRunIds = parseMetricsArgs(['--run-ids', 'a, b']);
  assert.deepEqual(withRunIds.runIds, ['a', 'b']);

  const audit = parseMetricsArgs([
    '--audit-triage', 'heal-run-1', '--verdict', 'overturned', '--notes', 'was healable'
  ]);
  assert.equal(audit.mode, 'audit-triage');
  assert.equal(audit.auditHealRunId, 'heal-run-1');
  assert.equal(audit.verdict, 'overturned');
  assert.equal(audit.notes, 'was healable');
  const auditsOverride = parseMetricsArgs(['--audits', '/tmp/audits.jsonl']);
  assert.equal(auditsOverride.auditsPath, '/tmp/audits.jsonl');

  assert.throws(() => parseMetricsArgs(['--snapshot']), /--label/);
  assert.throws(() => parseMetricsArgs(['--since', 'not-a-date']), /--since/);
  assert.throws(() => parseMetricsArgs(['--snapshot', '--label', 'x', '--trend']), /one of/);
  assert.throws(() => parseMetricsArgs(['--audit-triage', 'run-1']), /--verdict/);
  assert.throws(() => parseMetricsArgs(['--audit-triage', 'run-1', '--verdict', 'maybe']), /confirmed|overturned/);
  assert.throws(() => parseMetricsArgs(['--audit-triage', 'run-1', '--verdict', 'confirmed', '--trend']), /one of/);
  assert.throws(() => parseMetricsArgs(['--wat']), /Unexpected argument/);
});

test('computeMetrics separates started, provider-called, and call counters with both yields', (t) => {
  const root = tempDirectory(t);
  writeSyntheticRuns(root);
  const metrics = computeMetrics(readMetricsInputs(root), {});

  // started counts every generation run in the window, including the
  // preflight rejection E and the cache-hit promotion D.
  assert.equal(metrics.totals.started, 5);
  // provider-called runs recorded at least one provider attempt: A, B, C.
  // The cache-hit run D is started + promoted but NOT provider-called.
  assert.equal(metrics.totals.providerCalledRuns, 3);
  assert.equal(metrics.totals.providerCalls, 3);
  assert.equal(metrics.totals.promoted, 2);

  assert.equal(metrics.yieldStarted, 2 / 5);
  assert.equal(metrics.yieldProviderCalled, 2 / 3);

  assert.equal(metrics.tokensPerAccepted, 750);
  assert.equal(metrics.firstPassStaticRate, 2 / 3);
  assert.deepEqual(metrics.cache, {
    hits: 1, lookups: 3, savedTokens: 300, savedShare: 300 / 1800
  });
  assert.deepEqual(metrics.timeToAccepted, { p50Ms: 800, p95Ms: 5000 });
  assert.equal(metrics.healFrugality, 1 / 3);
  assert.equal(metrics.tokensPerSuccessfulHeal, 600);
  assert.equal(metrics.totals.billedTokens, 1500);
  assert.equal(metrics.totals.savedTokens, 300);
  assert.equal(metrics.totals.healRuns, 3);
});

test('provider retries stay visible in providerCalls without inflating run counters', (t) => {
  const root = tempDirectory(t);
  writeGenerationRun(root, 'run-retry', {
    startedAt: '2026-08-02T10:00:00.000Z',
    status: 'succeeded',
    endToEndLatencyMs: 9000,
    reviewPassed: true,
    staticReviewWarningCount: 0,
    attempts: [
      { status: 'failed', failureStage: 'provider', failureReason: 'truncated', usage: attemptUsage({ totalTokens: 200 }) },
      { usage: attemptUsage({ totalTokens: 300 }) }
    ]
  });
  const metrics = computeMetrics(readMetricsInputs(root), {});
  assert.equal(metrics.totals.started, 1);
  assert.equal(metrics.totals.providerCalledRuns, 1);
  assert.equal(metrics.totals.providerCalls, 2);
  assert.equal(metrics.yieldStarted, 1);
  assert.equal(metrics.yieldProviderCalled, 1);
});

test('failed runs surface as grouped raw failure facts, classified only at render time', (t) => {
  const root = tempDirectory(t);
  writeSyntheticRuns(root);
  const metrics = computeMetrics(readMetricsInputs(root), {});

  assert.deepEqual(metrics.failureFacts, [
    { stage: 'static-review', reasonCode: 'gate-rejected', terminalOutcome: 'failed', runs: 1, tokens: 500 },
    { stage: 'environment-preflight', reasonCode: 'environment-preflight', terminalOutcome: 'failed', runs: 1, tokens: 0 },
    { stage: 'test-generation', reasonCode: 'cli-failed', terminalOutcome: 'failed', runs: 1, tokens: 0 }
  ]);
  // No classification stored inside the snapshot facts themselves.
  for (const fact of metrics.failureFacts) {
    assert.deepEqual(Object.keys(fact).sort(), ['reasonCode', 'runs', 'stage', 'terminalOutcome', 'tokens']);
  }

  assert.equal(WASTE_CLASS_RULE_VERSION, 'waste-class/v1');
  assert.equal(classifyWasteStage('environment-preflight'), 'environment');
  assert.equal(classifyWasteStage('static-review'), 'staticReview');
  assert.equal(classifyWasteStage('runtime-environment'), 'runtime');
  assert.equal(classifyWasteStage('runtime-test'), 'runtime');
  assert.equal(classifyWasteStage('promotion-conflict'), 'other');

  // Render-time classification reproduces the legacy v1 bucket totals on the
  // same fixture.
  assert.deepEqual(classifyFailureFacts(metrics.failureFacts), {
    wastedTokens: 500,
    environment: { tokens: 0, share: 0 },
    staticReview: { tokens: 500, share: 1 },
    runtime: { tokens: 0, share: 0 },
    other: { tokens: 0, share: 0 }
  });
});

test('failure facts group runs sharing stage, reason, and terminal outcome', (t) => {
  const root = tempDirectory(t);
  for (const [index, tokens] of [[1, 400], [2, 600]]) {
    writeGenerationRun(root, `run-static-${index}`, {
      startedAt: `2026-08-03T0${index}:00:00.000Z`,
      status: 'failed',
      failureStage: 'static-review',
      failureReason: 'gate-rejected',
      reviewPassed: false,
      attempts: [{ usage: attemptUsage({ totalTokens: tokens }) }]
    });
  }
  const metrics = computeMetrics(readMetricsInputs(root), {});
  assert.deepEqual(metrics.failureFacts, [
    { stage: 'static-review', reasonCode: 'gate-rejected', terminalOutcome: 'failed', runs: 2, tokens: 1000 }
  ]);
});

test('accepted runs split into clean, with-warning, and unknown; all stay promoted', (t) => {
  const root = tempDirectory(t);
  writeGenerationRun(root, 'run-clean', {
    startedAt: '2026-08-04T10:00:00.000Z',
    status: 'succeeded',
    endToEndLatencyMs: 1000,
    reviewPassed: true,
    staticReviewWarningCount: 0,
    attempts: [{ usage: attemptUsage({ totalTokens: 100 }) }]
  });
  writeGenerationRun(root, 'run-warned', {
    startedAt: '2026-08-04T11:00:00.000Z',
    status: 'succeeded',
    endToEndLatencyMs: 1000,
    reviewPassed: true,
    staticReviewWarningCount: 3,
    attempts: [{ usage: attemptUsage({ totalTokens: 100 }) }]
  });
  writeGenerationRun(root, 'run-legacy', {
    startedAt: '2026-08-04T12:00:00.000Z',
    status: 'succeeded',
    endToEndLatencyMs: 1000,
    reviewPassed: true,
    attempts: [{ usage: attemptUsage({ totalTokens: 100 }) }]
  });
  const metrics = computeMetrics(readMetricsInputs(root), {});
  assert.deepEqual(metrics.accepted, { clean: 1, withWarning: 1, unknown: 1 });
  assert.equal(metrics.totals.promoted, 3);
  assert.equal(metrics.yieldStarted, 1);
});

test('triage audits produce coverage math and annotate the frugality line', (t) => {
  const root = tempDirectory(t);
  const zeroCallConfirmed = writeHealRun(root, 1754040000000, { status: 'not-repairable' });
  const zeroCallOverturned = writeHealRun(root, 1754041000000, { status: 'brain-error' });
  writeHealRun(root, 1754042000000, {
    status: 'healed',
    providerAttempts: [{ attempt: 1, kind: 'anthropic', usage: { totalTokens: 400 } }]
  });
  const auditsPath = path.join(root, 'triage-audits.jsonl');
  appendTriageAudit(auditsPath, {
    healRunId: zeroCallConfirmed, verdict: 'confirmed', auditedAt: '2026-08-08T20:00:00.000Z'
  });
  appendTriageAudit(auditsPath, {
    healRunId: zeroCallOverturned, verdict: 'overturned',
    auditedAt: '2026-08-08T20:10:00.000Z', notes: 'was actually healable'
  });

  const audited = computeMetrics(readMetricsInputs(root, { auditsPath }), {});
  assert.deepEqual(audited.healTriage, { zeroCallRuns: 2, audited: 2, overturned: 1, coverage: 1 });
  const auditedLine = renderHealFrugality(audited);
  assert.match(auditedLine, /overturn 50\.0%/);
  assert.match(auditedLine, /audit coverage 2\/2/);

  // A later re-audit of the same heal run wins over the earlier row.
  appendTriageAudit(auditsPath, {
    healRunId: zeroCallOverturned, verdict: 'confirmed', auditedAt: '2026-08-08T21:00:00.000Z'
  });
  const reAudited = computeMetrics(readMetricsInputs(root, { auditsPath }), {});
  assert.deepEqual(reAudited.healTriage, { zeroCallRuns: 2, audited: 2, overturned: 0, coverage: 1 });

  // Without audits, coverage is zero and overturn renders as unaudited.
  const unaudited = computeMetrics(readMetricsInputs(root), {});
  assert.deepEqual(unaudited.healTriage, { zeroCallRuns: 2, audited: 0, overturned: 0, coverage: 0 });
  const unauditedLine = renderHealFrugality(unaudited);
  assert.match(unauditedLine, /overturn n\/a - unaudited/);
  assert.match(unauditedLine, /audit coverage 0\/2/);
});

test('triage audit sidecar rows validate on append and tolerate junk on read', (t) => {
  const root = tempDirectory(t);
  const auditsPath = path.join(root, 'triage-audits.jsonl');
  assert.throws(
    () => appendTriageAudit(auditsPath, { healRunId: 'x', verdict: 'maybe', auditedAt: '2026-08-08T20:00:00.000Z' }),
    /confirmed|overturned/
  );
  assert.throws(
    () => appendTriageAudit(auditsPath, { healRunId: '', verdict: 'confirmed', auditedAt: '2026-08-08T20:00:00.000Z' }),
    /healRunId/
  );
  appendTriageAudit(auditsPath, {
    healRunId: 'heal-1', verdict: 'confirmed', auditedAt: '2026-08-08T20:00:00.000Z'
  });
  fs.appendFileSync(auditsPath, 'not-json\n');
  fs.appendFileSync(auditsPath, `${JSON.stringify({ healRunId: 'heal-2', verdict: 'nope', auditedAt: 'x' })}\n`);
  fs.appendFileSync(auditsPath, `${JSON.stringify({ healRunId: 'heal-3', verdict: 'overturned', auditedAt: '2026-08-08T21:00:00.000Z', notes: 'n' })}\n`);
  const rows = readTriageAudits(auditsPath);
  assert.deepEqual(rows.map((row) => row.healRunId), ['heal-1', 'heal-3']);
  assert.equal(rows[1].notes, 'n');
});

test('computeMetrics returns nulls, not NaN, on an empty window', (t) => {
  const root = tempDirectory(t);
  const metrics = computeMetrics(readMetricsInputs(root), {});
  assert.equal(metrics.yieldStarted, null);
  assert.equal(metrics.yieldProviderCalled, null);
  assert.equal(metrics.tokensPerAccepted, null);
  assert.equal(metrics.firstPassStaticRate, null);
  assert.deepEqual(metrics.failureFacts, []);
  assert.equal(metrics.cache.savedShare, null);
  assert.deepEqual(metrics.timeToAccepted, { p50Ms: null, p95Ms: null });
  assert.equal(metrics.healFrugality, null);
  assert.deepEqual(metrics.healTriage, { zeroCallRuns: 0, audited: 0, overturned: 0, coverage: null });
  assert.equal(metrics.tokensPerSuccessfulHeal, null);
  assert.deepEqual(metrics.accepted, { clean: 0, withWarning: 0, unknown: 0 });
  assert.deepEqual(classifyFailureFacts(metrics.failureFacts).wastedTokens, 0);
});

test('window filtering selects generation runs by startedAt and heal runs by epoch prefix', (t) => {
  const root = tempDirectory(t);
  writeSyntheticRuns(root);
  const inputs = readMetricsInputs(root);

  const windowed = computeMetrics(inputs, {
    since: Date.parse('2026-08-01T10:30:00Z'),
    until: Date.parse('2026-08-01T12:30:00Z')
  });
  // Only B and C in window: no promotions, only failures.
  assert.equal(windowed.totals.started, 2);
  assert.equal(windowed.yieldStarted, 0);
  assert.equal(windowed.yieldProviderCalled, 0);
  assert.equal(windowed.tokensPerAccepted, null);
  assert.equal(windowed.cache.hits, 0);

  // Heal windows use the epoch-ms directory prefix.
  const healWindow = computeMetrics(inputs, {
    since: 1754040500000,
    until: 1754042500000
  });
  assert.equal(healWindow.totals.healRuns, 2);
  assert.equal(healWindow.healFrugality, 0);

  const byRunId = computeMetrics(inputs, { runIds: ['run-a-promoted', 'run-d-cache-hit'] });
  assert.equal(byRunId.totals.started, 2);
  assert.equal(byRunId.yieldStarted, 1);
  assert.equal(byRunId.tokensPerAccepted, 500);
});

test('billed and saved totals reconcile with the token usage report on the same artifacts', (t) => {
  const root = tempDirectory(t);
  writeSyntheticRuns(root);
  const metrics = computeMetrics(readMetricsInputs(root), {});
  const summary = summarizeGenerationUsage(readGenerationUsage(root));
  assert.equal(metrics.totals.billedTokens, summary.totalTokens);
  assert.equal(metrics.cache.savedTokens, summary.savedTokens);
  assert.equal(metrics.cache.lookups, summary.exactCacheLookups);
  assert.equal(metrics.cache.hits, summary.exactCacheHits);
  assert.equal(metrics.totals.started, summary.generations);
});

test('createSnapshot writes v2 rows and readHistory renders mixed v1+v2 history', (t) => {
  const root = tempDirectory(t);
  writeSyntheticRuns(root);
  const historyPath = path.join(root, '.ai-metrics', 'metrics-history.jsonl');
  const metrics = computeMetrics(readMetricsInputs(root), {});

  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.writeFileSync(historyPath, `${JSON.stringify({
    schemaVersion: 'ai-efficiency-snapshot/v1',
    generatedAt: '2026-08-08T08:00:00.000Z',
    gitSha: 'a'.repeat(40),
    label: 'legacy-v1',
    window: { since: null, until: null, runIds: null },
    metrics: V1_TREND_METRICS
  })}\n`);

  const snapshot = createSnapshot({
    metrics,
    label: 'v2-first',
    window: { since: null, until: null, runIds: null },
    now: new Date('2026-08-09T09:00:00.000Z'),
    gitSha: 'b'.repeat(40)
  });
  assert.equal(snapshot.schemaVersion, 'ai-efficiency-snapshot/v2');
  assert.equal(snapshot.wasteClassRuleVersion, 'waste-class/v1');
  appendSnapshot(historyPath, snapshot);

  const rows = readHistory(historyPath);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].schemaVersion, 'ai-efficiency-snapshot/v1');
  assert.equal(rows[1].schemaVersion, 'ai-efficiency-snapshot/v2');
  assert.equal(rows[1].generatedAt, '2026-08-09T09:00:00.000Z');
  assert.equal(rows[1].metrics.yieldStarted, 2 / 5);

  const rawLines = fs.readFileSync(historyPath, 'utf8').trim().split('\n');
  assert.equal(rawLines.length, 2);
  for (const line of rawLines) JSON.parse(line);
});

test('renderTrend shows both yields for v2 rows and dashes for v1 rows', (t) => {
  const root = tempDirectory(t);
  writeSyntheticRuns(root);
  const v2Metrics = computeMetrics(readMetricsInputs(root), {});
  const v1Row = {
    schemaVersion: 'ai-efficiency-snapshot/v1',
    generatedAt: '2026-08-08T08:00:00.000Z',
    gitSha: 'c'.repeat(40),
    label: 'legacy-v1',
    window: { since: null, until: null, runIds: null },
    metrics: V1_TREND_METRICS
  };
  const v2Row = createSnapshot({
    metrics: v2Metrics,
    label: 'v2-first',
    window: { since: null, until: null, runIds: null },
    now: new Date('2026-08-09T09:00:00.000Z'),
    gitSha: 'd'.repeat(40)
  });

  const output = renderTrend([v1Row, v2Row]);
  const lines = output.split('\n');
  assert.match(lines[0], /label\s+yieldStart\s+yieldProv\s+tokens\/acc\s+firstPass/);
  const v1Line = lines.find((line) => line.startsWith('legacy-v1'));
  const v2Line = lines.find((line) => line.startsWith('v2-first'));
  assert.ok(v1Line && v2Line);

  // v1 rows show '-' for the new yield fields but keep their other columns.
  const header = lines[0];
  const yieldStartAt = header.indexOf('yieldStart');
  const tokensAt = header.indexOf('tokens/acc');
  assert.match(v1Line.slice(yieldStartAt, tokensAt), /^-\s+-\s*$/);
  assert.match(v1Line, /40000/);
  // Waste classification for v1 rows falls back to the stored buckets.
  assert.match(v1Line, /0\/100\/0/);

  assert.match(v2Line, /40\.0%/);
  assert.match(v2Line, /66\.7%/);
  // v2 waste is classified at render time from the raw facts.
  assert.match(v2Line, /0\/100\/0/);
  assert.doesNotMatch(output, /NaN/);
  const delta = lines.find((line) => line.trimStart().startsWith('Δ'));
  assert.ok(delta, 'expected a delta line between consecutive snapshots');
});

test('CLI end-to-end: report, snapshot, trend, and audit append against fixtures', (t) => {
  const root = tempDirectory(t);
  writeSyntheticRuns(root);
  const healRunId = writeHealRun(root, 1754043000000, { status: 'not-repairable' });
  const historyPath = path.join(root, '.ai-metrics', 'metrics-history.jsonl');
  const auditsPath = path.join(root, '.ai-metrics', 'triage-audits.jsonl');

  const report = spawnSync(process.execPath, [
    scriptPath, '--dir', root, '--audits', auditsPath, '--json'
  ], { encoding: 'utf8' });
  assert.equal(report.status, 0, report.stderr);
  const parsed = JSON.parse(report.stdout);
  assert.equal(parsed.metrics.yieldStarted, 2 / 5);
  assert.equal(parsed.metrics.yieldProviderCalled, 2 / 3);

  const human = spawnSync(process.execPath, [
    scriptPath, '--dir', root, '--audits', auditsPath
  ], { encoding: 'utf8' });
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /Yield \(promoted\/started\)/);
  assert.match(human.stdout, /Yield \(promoted\/provider-called\)/);
  assert.match(human.stdout, /overturn n\/a - unaudited/);

  const badAudit = spawnSync(process.execPath, [
    scriptPath, '--dir', root, '--audits', auditsPath,
    '--audit-triage', 'no-such-heal-run', '--verdict', 'confirmed'
  ], { encoding: 'utf8' });
  assert.equal(badAudit.status, 1);
  assert.match(badAudit.stderr, /no-such-heal-run/);

  const goodAudit = spawnSync(process.execPath, [
    scriptPath, '--dir', root, '--audits', auditsPath,
    '--audit-triage', healRunId, '--verdict', 'confirmed', '--notes', 'manual session'
  ], { encoding: 'utf8' });
  assert.equal(goodAudit.status, 0, goodAudit.stderr);
  const audits = readTriageAudits(auditsPath);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].healRunId, healRunId);
  assert.equal(audits[0].verdict, 'confirmed');
  assert.equal(audits[0].notes, 'manual session');
  assert.equal(typeof audits[0].auditedAt, 'string');

  const snapshot = spawnSync(process.execPath, [
    scriptPath, '--dir', root, '--history', historyPath, '--audits', auditsPath,
    '--snapshot', '--label', 'cli-snap'
  ], { encoding: 'utf8' });
  assert.equal(snapshot.status, 0, snapshot.stderr);
  const rows = readHistory(historyPath);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].schemaVersion, 'ai-efficiency-snapshot/v2');
  assert.equal(rows[0].label, 'cli-snap');
  assert.equal(rows[0].metrics.healTriage.audited, 1);

  const trend = spawnSync(process.execPath, [
    scriptPath, '--history', historyPath, '--trend'
  ], { encoding: 'utf8' });
  assert.equal(trend.status, 0, trend.stderr);
  assert.match(trend.stdout, /cli-snap/);
  assert.match(trend.stdout, /40\.0%/);

  const help = spawnSync(process.execPath, [scriptPath, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--audit-triage/);
  assert.match(help.stdout, /ai-efficiency-snapshot\/v2/);
});
