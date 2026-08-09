#!/usr/bin/env node

// Efficiency-metrics report over existing .ai-runs artifacts. Pure
// deterministic aggregation: no provider calls, no generation semantics.
// Token accounting is delegated to token-usage-report.mjs so both reports
// always reconcile on the same artifacts.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { nearestRank, readGenerationUsage } from './token-usage-report.mjs';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_HISTORY_PATH = path.join(webRoot, '.ai-metrics', 'metrics-history.jsonl');
const SNAPSHOT_SCHEMA = 'ai-efficiency-snapshot/v1';
const CACHE_LOOKUP_STATUSES = new Set(['miss', 'hit', 'single-flight-join']);
const STATIC_PASSED_FAILURE_STAGES = new Set([
  'runtime-environment', 'runtime-test', 'full-gate', 'promotion', 'promotion-conflict'
]);
const SUCCESSFUL_HEAL_STATUSES = new Set(['healed', 'proposal-ready']);

export function parseMetricsArgs(args) {
  const parsed = {
    mode: 'report',
    dir: path.join(webRoot, '.ai-runs'),
    historyPath: DEFAULT_HISTORY_PATH,
    label: null,
    since: null,
    until: null,
    runIds: null,
    json: false
  };
  let snapshot = false;
  let trend = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--snapshot') snapshot = true;
    else if (arg === '--trend') trend = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--dir') parsed.dir = requiredValue(args, ++index, '--dir');
    else if (arg === '--history') parsed.historyPath = requiredValue(args, ++index, '--history');
    else if (arg === '--label') parsed.label = requiredValue(args, ++index, '--label');
    else if (arg === '--since') parsed.since = isoTimestamp(requiredValue(args, ++index, '--since'), '--since');
    else if (arg === '--until') parsed.until = isoTimestamp(requiredValue(args, ++index, '--until'), '--until');
    else if (arg === '--run-ids') {
      parsed.runIds = requiredValue(args, ++index, '--run-ids')
        .split(',').map((value) => value.trim()).filter(Boolean);
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (snapshot && trend) throw new Error('Use only one of --snapshot or --trend.');
  if (snapshot) {
    if (!parsed.label) throw new Error('--snapshot requires --label <text>.');
    parsed.mode = 'snapshot';
  } else if (trend) {
    parsed.mode = 'trend';
  }
  return parsed;
}

function requiredValue(args, index, flag) {
  const value = args[index];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function isoTimestamp(value, flag) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be an ISO-8601 timestamp, got: ${value}`);
  }
  return parsed;
}

function epochMsOrNull(value) {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readManifestStartedAt(manifestPath) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return epochMsOrNull(manifest.startedAt) ?? epochMsOrNull(manifest?.generation?.completedAt);
  } catch {
    return null;
  }
}

function readHealRuns(healRoot) {
  if (!fs.existsSync(healRoot)) return [];
  const healRuns = [];
  for (const entry of fs.readdirSync(healRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const epochMatch = /^(\d{10,})-/.exec(entry.name);
    if (!epochMatch) continue;
    const summaryPath = path.join(healRoot, entry.name, 'heal-summary.json');
    let summary;
    try {
      summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    } catch {
      continue;
    }
    if (summary?.schema !== 'test-heal-run/v1') continue;
    const providerAttempts = Array.isArray(summary.providerAttempts) ? summary.providerAttempts : [];
    healRuns.push({
      runId: entry.name,
      epochMs: Number(epochMatch[1]),
      status: typeof summary.status === 'string' ? summary.status : null,
      providerAttemptCount: providerAttempts.length,
      totalTokens: providerAttempts.reduce((total, attempt) => {
        const tokens = attempt?.usage?.totalTokens;
        return total + (typeof tokens === 'number' && Number.isFinite(tokens) && tokens >= 0 ? tokens : 0);
      }, 0)
    });
  }
  return healRuns.sort((left, right) => left.epochMs - right.epochMs);
}

export function readMetricsInputs(dir) {
  const usage = readGenerationUsage(dir);
  const startedAtByRun = new Map();
  for (const run of usage.runs) {
    startedAtByRun.set(run.runId, readManifestStartedAt(run.manifestPath));
  }
  return { usage, startedAtByRun, healRuns: readHealRuns(path.join(dir, 'heal')) };
}

function inWindow(epochMs, window) {
  const { since = null, until = null } = window ?? {};
  if (since === null && until === null) return true;
  if (epochMs === null) return false;
  if (since !== null && epochMs < since) return false;
  if (until !== null && epochMs > until) return false;
  return true;
}

function ratioOrNull(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function sumTokens(rows) {
  return rows.reduce((total, row) => total + (row.totalTokens ?? 0), 0);
}

function wasteBucket(failureStage) {
  if (failureStage === 'environment-preflight') return 'environment';
  if (failureStage === 'static-review') return 'staticReview';
  if (failureStage === 'runtime-environment' || failureStage === 'runtime-test') return 'runtime';
  return 'other';
}

function reachedStaticReview(run) {
  return run.failureStage === 'static-review' || passedStaticReview(run);
}

function passedStaticReview(run) {
  return run.quality.reviewPassed === true
    || run.status === 'succeeded'
    || STATIC_PASSED_FAILURE_STAGES.has(run.failureStage);
}

export function computeMetrics({ usage, startedAtByRun, healRuns }, window = {}) {
  const explicitRunIds = Array.isArray(window.runIds) && window.runIds.length > 0
    ? new Set(window.runIds)
    : null;
  const runs = usage.runs.filter((run) => (explicitRunIds
    ? explicitRunIds.has(run.runId)
    : inWindow(startedAtByRun.get(run.runId) ?? null, window)));
  const runIds = new Set(runs.map((run) => run.runId));
  const rows = usage.rows.filter((row) => runIds.has(row.runId));
  const cacheRows = usage.cacheRows.filter((row) => runIds.has(row.runId));

  const rowsByRun = new Map();
  for (const row of rows) {
    if (!rowsByRun.has(row.runId)) rowsByRun.set(row.runId, []);
    rowsByRun.get(row.runId).push(row);
  }
  const cacheRunIds = new Set(cacheRows.map((row) => row.runId));

  const promotedRuns = runs.filter((run) => run.status === 'succeeded');
  // A run "spawned" the provider path when it recorded a paid attempt or a
  // result-cache lookup that intercepted one. Runs rejected before that
  // point (for example environment-preflight) never reached the provider.
  const providerSpawningRuns = runs.filter((run) =>
    (rowsByRun.get(run.runId) ?? []).length > 0 || cacheRunIds.has(run.runId));

  const billedTokens = sumTokens(rows);
  const savedTokens = cacheRows.reduce((total, row) => total + (row.savedTokens ?? 0), 0);

  const staticReached = runs.filter(reachedStaticReview);
  const staticFirstPass = staticReached.filter((run) =>
    passedStaticReview(run) && (run.quality.repairCount ?? 0) === 0);

  const wasteTokensByBucket = { environment: 0, staticReview: 0, runtime: 0, other: 0 };
  let wastedTokens = 0;
  for (const run of runs) {
    if (run.status !== 'failed') continue;
    const runTokens = sumTokens(rowsByRun.get(run.runId) ?? []);
    wasteTokensByBucket[wasteBucket(run.failureStage)] += runTokens;
    wastedTokens += runTokens;
  }
  const wasteByStage = { wastedTokens };
  for (const [bucket, tokens] of Object.entries(wasteTokensByBucket)) {
    wasteByStage[bucket] = { tokens, share: ratioOrNull(tokens, wastedTokens) };
  }

  const cacheLookupRows = [...rows, ...cacheRows]
    .filter((row) => CACHE_LOOKUP_STATUSES.has(row.resultCacheStatus));
  const cacheHits = cacheLookupRows.filter((row) => row.resultCacheStatus === 'hit').length;

  const selectedHealRuns = healRuns.filter((healRun) => inWindow(healRun.epochMs, window));
  const frugalHealRuns = selectedHealRuns.filter((healRun) => healRun.providerAttemptCount === 0);
  const successfulHealRuns = selectedHealRuns.filter((healRun) => SUCCESSFUL_HEAL_STATUSES.has(healRun.status));
  const healTokens = selectedHealRuns.reduce((total, healRun) => total + healRun.totalTokens, 0);

  return {
    yield: ratioOrNull(promotedRuns.length, providerSpawningRuns.length),
    tokensPerAccepted: ratioOrNull(billedTokens, promotedRuns.length),
    firstPassStaticRate: ratioOrNull(staticFirstPass.length, staticReached.length),
    wasteByStage,
    cache: {
      hits: cacheHits,
      lookups: cacheLookupRows.length,
      savedTokens,
      savedShare: ratioOrNull(savedTokens, savedTokens + billedTokens)
    },
    timeToAccepted: {
      p50Ms: nearestRank(promotedRuns.map((run) => run.endToEndLatencyMs), 0.5),
      p95Ms: nearestRank(promotedRuns.map((run) => run.endToEndLatencyMs), 0.95)
    },
    healFrugality: ratioOrNull(frugalHealRuns.length, selectedHealRuns.length),
    tokensPerSuccessfulHeal: ratioOrNull(healTokens, successfulHealRuns.length),
    totals: {
      runs: runs.length,
      promoted: promotedRuns.length,
      providerSpawning: providerSpawningRuns.length,
      billedTokens,
      savedTokens,
      healRuns: selectedHealRuns.length
    }
  };
}

function isoOrNull(epochMs) {
  return typeof epochMs === 'number' && Number.isFinite(epochMs)
    ? new Date(epochMs).toISOString()
    : null;
}

export function createSnapshot({ metrics, label, window = {}, now, gitSha }) {
  return {
    schemaVersion: SNAPSHOT_SCHEMA,
    generatedAt: now.toISOString(),
    gitSha: typeof gitSha === 'string' && gitSha.length > 0 ? gitSha : null,
    label,
    window: {
      since: isoOrNull(window.since ?? null),
      until: isoOrNull(window.until ?? null),
      runIds: Array.isArray(window.runIds) && window.runIds.length > 0 ? window.runIds : null
    },
    metrics
  };
}

export function appendSnapshot(historyPath, snapshot) {
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  // A single appended line keeps the history valid JSONL even when two
  // snapshot commands race: O_APPEND writes of one small line do not split.
  fs.appendFileSync(historyPath, `${JSON.stringify(snapshot)}\n`);
}

export function readHistory(historyPath) {
  if (!fs.existsSync(historyPath)) return [];
  const rows = [];
  for (const line of fs.readFileSync(historyPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row?.schemaVersion === SNAPSHOT_SCHEMA) rows.push(row);
  }
  return rows;
}

function formatPercent(value) {
  return value === null || value === undefined ? '-' : `${(value * 100).toFixed(1)}%`;
}

function formatInteger(value) {
  return value === null || value === undefined ? '-' : String(Math.round(value));
}

function formatWaste(wasteByStage) {
  if (!wasteByStage || wasteByStage.wastedTokens === 0) return '-';
  const share = (bucket) => Math.round((wasteByStage[bucket]?.share ?? 0) * 100);
  return `${share('environment')}/${share('staticReview')}/${share('runtime')}`;
}

function formatCache(cache) {
  if (!cache) return '-';
  return `${cache.hits}/${cache.lookups}/${cache.savedTokens}`;
}

function formatLatency(timeToAccepted) {
  if (!timeToAccepted || timeToAccepted.p50Ms === null) return '-';
  return `${Math.round(timeToAccepted.p50Ms)}/${Math.round(timeToAccepted.p95Ms)}`;
}

function formatDelta(previous, current, { percent = false } = {}) {
  if (previous === null || previous === undefined || current === null || current === undefined) return '-';
  const difference = current - previous;
  const sign = difference >= 0 ? '+' : '-';
  return percent
    ? `${sign}${Math.abs(difference * 100).toFixed(1)}pp`
    : `${sign}${Math.abs(Math.round(difference))}`;
}

const TREND_COLUMNS = [
  { header: 'label', width: 26, value: (row) => row.label ?? '-' },
  { header: 'yield', width: 8, value: (row) => formatPercent(row.metrics.yield), delta: (a, b) => formatDelta(a.yield, b.yield, { percent: true }) },
  { header: 'tokens/acc', width: 11, value: (row) => formatInteger(row.metrics.tokensPerAccepted), delta: (a, b) => formatDelta(a.tokensPerAccepted, b.tokensPerAccepted) },
  { header: 'firstPass', width: 10, value: (row) => formatPercent(row.metrics.firstPassStaticRate), delta: (a, b) => formatDelta(a.firstPassStaticRate, b.firstPassStaticRate, { percent: true }) },
  { header: 'waste e/s/r', width: 12, value: (row) => formatWaste(row.metrics.wasteByStage) },
  { header: 'cache h/l/saved', width: 16, value: (row) => formatCache(row.metrics.cache), delta: (a, b) => formatDelta(a.cache?.savedTokens, b.cache?.savedTokens) },
  { header: 'tta p50/p95 ms', width: 15, value: (row) => formatLatency(row.metrics.timeToAccepted), delta: (a, b) => formatDelta(a.timeToAccepted?.p50Ms, b.timeToAccepted?.p50Ms) },
  { header: 'healFrugal', width: 11, value: (row) => formatPercent(row.metrics.healFrugality), delta: (a, b) => formatDelta(a.healFrugality, b.healFrugality, { percent: true }) },
  { header: 'tok/heal', width: 9, value: (row) => formatInteger(row.metrics.tokensPerSuccessfulHeal), delta: (a, b) => formatDelta(a.tokensPerSuccessfulHeal, b.tokensPerSuccessfulHeal) }
];

function paddedLine(cells) {
  return TREND_COLUMNS
    .map((column, index) => String(cells[index]).padEnd(column.width))
    .join(' ')
    .trimEnd();
}

export function renderTrend(snapshots) {
  if (snapshots.length === 0) return 'No snapshots recorded yet.';
  const lines = [paddedLine(TREND_COLUMNS.map((column) => column.header))];
  let previous = null;
  for (const snapshot of snapshots) {
    if (previous) {
      lines.push(paddedLine(TREND_COLUMNS.map((column) => (column.delta
        ? column.delta(previous.metrics, snapshot.metrics)
        : column.header === 'label' ? '  Δ' : ''))));
    }
    lines.push(paddedLine(TREND_COLUMNS.map((column) => column.value(snapshot))));
    previous = snapshot;
  }
  return lines.join('\n');
}

function resolveGitSha() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: webRoot, encoding: 'utf8', shell: false
  });
  if (result.status !== 0 || result.error) return null;
  const sha = result.stdout.trim();
  return /^[a-f0-9]{40}$/i.test(sha) ? sha : null;
}

function printHumanReport(metrics, options) {
  const windowText = options.runIds
    ? `run-ids=${options.runIds.join(',')}`
    : `${isoOrNull(options.since) ?? 'beginning'} .. ${isoOrNull(options.until) ?? 'now'}`;
  console.log(`AI efficiency metrics (${windowText})`);
  console.log(`- Yield (promoted/provider-spawning): ${formatPercent(metrics.yield)} (${metrics.totals.promoted}/${metrics.totals.providerSpawning})`);
  console.log(`- Tokens per accepted test: ${formatInteger(metrics.tokensPerAccepted)}`);
  console.log(`- First-pass static-review rate: ${formatPercent(metrics.firstPassStaticRate)}`);
  console.log(
    `- Waste by stage (tokens on failed runs): total=${metrics.wasteByStage.wastedTokens}, ` +
    `environment=${metrics.wasteByStage.environment.tokens}, ` +
    `static-review=${metrics.wasteByStage.staticReview.tokens}, ` +
    `runtime=${metrics.wasteByStage.runtime.tokens}, other=${metrics.wasteByStage.other.tokens}`
  );
  console.log(
    `- Result cache: hits=${metrics.cache.hits}/${metrics.cache.lookups} lookups, ` +
    `saved=${metrics.cache.savedTokens} tokens, saved-share=${formatPercent(metrics.cache.savedShare)}`
  );
  console.log(`- Time to accepted p50/p95: ${formatLatency(metrics.timeToAccepted)} ms`);
  console.log(`- Heal frugality (zero-attempt heals): ${formatPercent(metrics.healFrugality)} of ${metrics.totals.healRuns} heal runs`);
  console.log(`- Tokens per successful heal: ${formatInteger(metrics.tokensPerSuccessfulHeal)}`);
  console.log(`- Window totals: runs=${metrics.totals.runs}, billed=${metrics.totals.billedTokens} tokens, saved=${metrics.totals.savedTokens} tokens`);
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/metrics-report.mjs [--dir <runs>] [--since <iso>] [--until <iso>]
    [--run-ids <id,id,...>] [--json]
  node scripts/ai/metrics-report.mjs --snapshot --label <text> [window flags] [--history <path>]
  node scripts/ai/metrics-report.mjs --trend [--history <path>]

Computes eight efficiency metrics from .ai-runs artifacts (generation + heal).
--snapshot appends one JSONL row to .ai-metrics/metrics-history.jsonl (committable).
--trend prints a fixed-width table of all snapshots with deltas between rows.
Windows filter generation runs by manifest startedAt and heal runs by the
epoch-ms prefix of their run directory names. --run-ids bypasses timestamps
for generation runs when batteries interleave.`);
}

function runCli() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  let options;
  try {
    options = parseMetricsArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  if (options.mode === 'trend') {
    console.log(renderTrend(readHistory(options.historyPath)));
    return;
  }

  const window = { since: options.since, until: options.until, runIds: options.runIds };
  const metrics = computeMetrics(readMetricsInputs(options.dir), window);

  if (options.mode === 'snapshot') {
    const snapshot = createSnapshot({
      metrics, label: options.label, window, now: new Date(), gitSha: resolveGitSha()
    });
    appendSnapshot(options.historyPath, snapshot);
    console.log(`Recorded snapshot '${options.label}' (${snapshot.generatedAt}) to ${options.historyPath}`);
    return;
  }

  if (options.json) console.log(JSON.stringify({ metrics }, null, 2));
  else printHumanReport(metrics, options);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) runCli();
