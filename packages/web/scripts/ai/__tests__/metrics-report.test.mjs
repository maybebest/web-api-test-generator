import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  appendSnapshot,
  computeMetrics,
  createSnapshot,
  parseMetricsArgs,
  readHistory,
  readMetricsInputs,
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
    quality: { reviewPassed, repairCount }
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
}

function writeSyntheticRuns(root) {
  // A: promoted through a paid provider attempt.
  writeGenerationRun(root, 'run-a-promoted', {
    startedAt: '2026-08-01T10:00:00.000Z',
    status: 'succeeded',
    endToEndLatencyMs: 5000,
    reviewPassed: true,
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
  // D: result-cache hit; promoted with zero billed tokens.
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

test('parseMetricsArgs understands report, snapshot, and trend modes', () => {
  assert.deepEqual(parseMetricsArgs([]).mode, 'report');
  const snapshot = parseMetricsArgs(['--snapshot', '--label', 'iter1', '--since', '2026-08-01T00:00:00Z']);
  assert.equal(snapshot.mode, 'snapshot');
  assert.equal(snapshot.label, 'iter1');
  assert.equal(snapshot.since, Date.parse('2026-08-01T00:00:00Z'));
  const trend = parseMetricsArgs(['--trend']);
  assert.equal(trend.mode, 'trend');
  const withRunIds = parseMetricsArgs(['--run-ids', 'a, b']);
  assert.deepEqual(withRunIds.runIds, ['a', 'b']);
  assert.throws(() => parseMetricsArgs(['--snapshot']), /--label/);
  assert.throws(() => parseMetricsArgs(['--since', 'not-a-date']), /--since/);
  assert.throws(() => parseMetricsArgs(['--snapshot', '--label', 'x', '--trend']), /one of/);
  assert.throws(() => parseMetricsArgs(['--wat']), /Unexpected argument/);
});

test('computeMetrics derives all eight metrics from mixed synthetic runs', (t) => {
  const root = tempDirectory(t);
  writeSyntheticRuns(root);
  const metrics = computeMetrics(readMetricsInputs(root), {});

  // 1. yield: promoted A+D over provider-spawning A,B,C,D (preflight run E excluded).
  assert.equal(metrics.yield, 0.5);
  // 2. tokens per accepted: (1000 + 500 + 0 + 0) / 2 promoted.
  assert.equal(metrics.tokensPerAccepted, 750);
  // 3. first-pass static rate: reached A,B,D; first-pass passes A,D.
  assert.equal(metrics.firstPassStaticRate, 2 / 3);
  // 4. waste by stage: only run B billed tokens on a failed run.
  assert.equal(metrics.wasteByStage.wastedTokens, 500);
  assert.deepEqual(metrics.wasteByStage.staticReview, { tokens: 500, share: 1 });
  assert.deepEqual(metrics.wasteByStage.environment, { tokens: 0, share: 0 });
  assert.deepEqual(metrics.wasteByStage.runtime, { tokens: 0, share: 0 });
  assert.deepEqual(metrics.wasteByStage.other, { tokens: 0, share: 0 });
  // 5. cache: misses from A and B, hit from D.
  assert.deepEqual(metrics.cache, {
    hits: 1, lookups: 3, savedTokens: 300, savedShare: 300 / 1800
  });
  // 6. time to accepted over promoted runs only.
  assert.deepEqual(metrics.timeToAccepted, { p50Ms: 800, p95Ms: 5000 });
  // 7. heal frugality: one of three heal runs had zero provider attempts.
  assert.equal(metrics.healFrugality, 1 / 3);
  // 8. tokens per successful heal: all heal tokens over the single healed run.
  assert.equal(metrics.tokensPerSuccessfulHeal, 600);

  assert.equal(metrics.totals.runs, 5);
  assert.equal(metrics.totals.promoted, 2);
  assert.equal(metrics.totals.providerSpawning, 4);
  assert.equal(metrics.totals.billedTokens, 1500);
  assert.equal(metrics.totals.healRuns, 3);
});

test('computeMetrics returns nulls, not NaN, on an empty window', (t) => {
  const root = tempDirectory(t);
  const metrics = computeMetrics(readMetricsInputs(root), {});
  assert.equal(metrics.yield, null);
  assert.equal(metrics.tokensPerAccepted, null);
  assert.equal(metrics.firstPassStaticRate, null);
  assert.equal(metrics.wasteByStage.wastedTokens, 0);
  assert.equal(metrics.wasteByStage.staticReview.share, null);
  assert.equal(metrics.cache.savedShare, null);
  assert.deepEqual(metrics.timeToAccepted, { p50Ms: null, p95Ms: null });
  assert.equal(metrics.healFrugality, null);
  assert.equal(metrics.tokensPerSuccessfulHeal, null);
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
  assert.equal(windowed.totals.runs, 2);
  assert.equal(windowed.yield, 0);
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
  assert.equal(byRunId.totals.runs, 2);
  assert.equal(byRunId.yield, 1);
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
  assert.equal(metrics.totals.runs, summary.generations);
});

test('createSnapshot and appendSnapshot write committable, injected-clock JSONL rows', (t) => {
  const root = tempDirectory(t);
  writeSyntheticRuns(root);
  const historyPath = path.join(root, '.ai-metrics', 'metrics-history.jsonl');
  const metrics = computeMetrics(readMetricsInputs(root), {});
  const first = createSnapshot({
    metrics,
    label: 'iter1-baseline',
    window: { since: null, until: null, runIds: null },
    now: new Date('2026-08-09T08:00:00.000Z'),
    gitSha: 'a'.repeat(40)
  });
  appendSnapshot(historyPath, first);
  appendSnapshot(historyPath, createSnapshot({
    metrics,
    label: 'iter2',
    window: { since: Date.parse('2026-08-01T00:00:00Z'), until: null, runIds: null },
    now: new Date('2026-08-09T09:00:00.000Z'),
    gitSha: 'b'.repeat(40)
  }));

  const rows = readHistory(historyPath);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].schemaVersion, 'ai-efficiency-snapshot/v1');
  assert.equal(rows[0].generatedAt, '2026-08-09T08:00:00.000Z');
  assert.equal(rows[0].gitSha, 'a'.repeat(40));
  assert.equal(rows[0].label, 'iter1-baseline');
  assert.equal(rows[0].metrics.yield, 0.5);
  assert.equal(rows[1].label, 'iter2');
  assert.equal(rows[1].window.since, '2026-08-01T00:00:00.000Z');
  const rawLines = fs.readFileSync(historyPath, 'utf8').trim().split('\n');
  assert.equal(rawLines.length, 2);
  for (const line of rawLines) JSON.parse(line);
});

test('renderTrend prints one fixed-width row per snapshot plus deltas and null dashes', () => {
  const base = {
    schemaVersion: 'ai-efficiency-snapshot/v1',
    generatedAt: '2026-08-09T08:00:00.000Z',
    gitSha: 'c'.repeat(40),
    window: { since: null, until: null, runIds: null }
  };
  const nullMetrics = {
    yield: 0,
    tokensPerAccepted: null,
    firstPassStaticRate: 0,
    wasteByStage: {
      wastedTokens: 900,
      environment: { tokens: 0, share: 0 },
      staticReview: { tokens: 900, share: 1 },
      runtime: { tokens: 0, share: 0 },
      other: { tokens: 0, share: 0 }
    },
    cache: { hits: 0, lookups: 3, savedTokens: 0, savedShare: null },
    timeToAccepted: { p50Ms: null, p95Ms: null },
    healFrugality: null,
    tokensPerSuccessfulHeal: null,
    totals: { runs: 3, promoted: 0, providerSpawning: 3, billedTokens: 900, healRuns: 0 }
  };
  const laterMetrics = {
    ...nullMetrics,
    yield: 1 / 3,
    tokensPerAccepted: 81000,
    firstPassStaticRate: 2 / 3,
    cache: { hits: 1, lookups: 4, savedTokens: 18763, savedShare: 0.188 },
    timeToAccepted: { p50Ms: 7126, p95Ms: 73335 },
    totals: { runs: 4, promoted: 2, providerSpawning: 3, billedTokens: 80983, healRuns: 0 }
  };
  const output = renderTrend([
    { ...base, label: 'iter1-baseline', metrics: nullMetrics },
    { ...base, label: 'iter2', metrics: laterMetrics }
  ]);
  const lines = output.split('\n');
  assert.match(lines[0], /label\s+yield\s+tokens\/acc\s+firstPass/);
  const iter1 = lines.find((line) => line.startsWith('iter1-baseline'));
  const iter2 = lines.find((line) => line.startsWith('iter2'));
  assert.ok(iter1 && iter2);
  // Null metrics render as dashes, not NaN.
  assert.match(iter1, /-/);
  assert.doesNotMatch(output, /NaN/);
  assert.match(iter2, /33\.3%/);
  assert.match(iter2, /81000/);
  // Fixed-width columns: yield starts at the same offset in every data row.
  assert.equal(iter1.indexOf('0.0%') > 0, true);
  const delta = lines.find((line) => line.trimStart().startsWith('Δ'));
  assert.ok(delta, 'expected a delta line between consecutive snapshots');
  assert.match(delta, /\+33\.3pp/);
});

test('CLI end-to-end: report, snapshot, and trend against a fixture directory', (t) => {
  const root = tempDirectory(t);
  writeSyntheticRuns(root);
  const historyPath = path.join(root, '.ai-metrics', 'metrics-history.jsonl');

  const report = spawnSync(process.execPath, [scriptPath, '--dir', root, '--json'], { encoding: 'utf8' });
  assert.equal(report.status, 0, report.stderr);
  const parsed = JSON.parse(report.stdout);
  assert.equal(parsed.metrics.yield, 0.5);

  const snapshot = spawnSync(process.execPath, [
    scriptPath, '--dir', root, '--history', historyPath,
    '--snapshot', '--label', 'cli-snap'
  ], { encoding: 'utf8' });
  assert.equal(snapshot.status, 0, snapshot.stderr);
  const rows = readHistory(historyPath);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, 'cli-snap');
  assert.equal(typeof rows[0].generatedAt, 'string');

  const trend = spawnSync(process.execPath, [
    scriptPath, '--history', historyPath, '--trend'
  ], { encoding: 'utf8' });
  assert.equal(trend.status, 0, trend.stderr);
  assert.match(trend.stdout, /cli-snap/);
  assert.match(trend.stdout, /50\.0%/);
});
