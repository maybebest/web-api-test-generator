#!/usr/bin/env node

// Efficiency-metrics report over existing .ai-runs artifacts. Pure
// deterministic aggregation: no provider calls, no generation semantics.
// Token accounting is delegated to token-usage-report.mjs so both reports
// always reconcile on the same artifacts.
//
// Snapshots are ai-efficiency-snapshot/v2. Existing v1 history rows are never
// rewritten; readHistory and renderTrend render mixed v1+v2 history and v1
// rows show '-' for fields v1 did not record.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { nearestRank, readGenerationUsage } from './token-usage-report.mjs';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_HISTORY_PATH = path.join(webRoot, '.ai-metrics', 'metrics-history.jsonl');
const DEFAULT_AUDITS_PATH = path.join(webRoot, '.ai-metrics', 'triage-audits.jsonl');
const SNAPSHOT_SCHEMA_V1 = 'ai-efficiency-snapshot/v1';
const SNAPSHOT_SCHEMA_V2 = 'ai-efficiency-snapshot/v2';
const SNAPSHOT_SCHEMAS = new Set([SNAPSHOT_SCHEMA_V1, SNAPSHOT_SCHEMA_V2]);
const CACHE_LOOKUP_STATUSES = new Set(['miss', 'hit', 'single-flight-join']);
const STATIC_PASSED_FAILURE_STAGES = new Set([
  'runtime-environment', 'runtime-test', 'full-gate', 'promotion', 'promotion-conflict'
]);
const SUCCESSFUL_HEAL_STATUSES = new Set(['healed', 'proposal-ready']);
const TRIAGE_AUDIT_VERDICTS = new Set(['confirmed', 'overturned']);

// Versioned display-classification rule for failure facts. Snapshots store
// raw {stage, reasonCode, terminalOutcome, runs, tokens} rows only; buckets
// are computed at render time so history reclassifies consistently when the
// rule evolves. The version recorded in a snapshot is informational: it names
// the rule that was current when the snapshot was taken.
export const WASTE_CLASS_RULE_VERSION = 'waste-class/v1';

// waste-class/v1: stage vocabulary observed in generation-run/v1 manifests
// (failureStage): environment-preflight, static-review, test-generation,
// runtime-environment, runtime-test, plus rarer terminal stages
// (candidate-integrity, promotion-conflict, ...) which classify as 'other'.
export function classifyWasteStage(stage) {
  if (stage === 'environment-preflight') return 'environment';
  if (stage === 'static-review') return 'staticReview';
  if (stage === 'runtime-environment' || stage === 'runtime-test') return 'runtime';
  return 'other';
}

export function classifyFailureFacts(failureFacts) {
  const tokensByBucket = { environment: 0, staticReview: 0, runtime: 0, other: 0 };
  let wastedTokens = 0;
  for (const fact of Array.isArray(failureFacts) ? failureFacts : []) {
    const tokens = typeof fact?.tokens === 'number' && Number.isFinite(fact.tokens) ? fact.tokens : 0;
    tokensByBucket[classifyWasteStage(fact?.stage)] += tokens;
    wastedTokens += tokens;
  }
  const view = { wastedTokens };
  for (const [bucket, tokens] of Object.entries(tokensByBucket)) {
    view[bucket] = { tokens, share: ratioOrNull(tokens, wastedTokens) };
  }
  return view;
}

export function parseMetricsArgs(args) {
  const parsed = {
    mode: 'report',
    dir: path.join(webRoot, '.ai-runs'),
    historyPath: DEFAULT_HISTORY_PATH,
    auditsPath: DEFAULT_AUDITS_PATH,
    label: null,
    since: null,
    until: null,
    runIds: null,
    auditHealRunId: null,
    verdict: null,
    notes: null,
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
    else if (arg === '--audits') parsed.auditsPath = requiredValue(args, ++index, '--audits');
    else if (arg === '--label') parsed.label = requiredValue(args, ++index, '--label');
    else if (arg === '--since') parsed.since = isoTimestamp(requiredValue(args, ++index, '--since'), '--since');
    else if (arg === '--until') parsed.until = isoTimestamp(requiredValue(args, ++index, '--until'), '--until');
    else if (arg === '--audit-triage') parsed.auditHealRunId = requiredValue(args, ++index, '--audit-triage');
    else if (arg === '--verdict') parsed.verdict = requiredValue(args, ++index, '--verdict');
    else if (arg === '--notes') parsed.notes = requiredValue(args, ++index, '--notes');
    else if (arg === '--run-ids') {
      parsed.runIds = requiredValue(args, ++index, '--run-ids')
        .split(',').map((value) => value.trim()).filter(Boolean);
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  const modeFlags = [snapshot, trend, parsed.auditHealRunId !== null].filter(Boolean).length;
  if (modeFlags > 1) throw new Error('Use only one of --snapshot, --trend, or --audit-triage.');
  if (snapshot) {
    if (!parsed.label) throw new Error('--snapshot requires --label <text>.');
    parsed.mode = 'snapshot';
  } else if (trend) {
    parsed.mode = 'trend';
  } else if (parsed.auditHealRunId !== null) {
    if (!parsed.verdict) throw new Error('--audit-triage requires --verdict confirmed|overturned.');
    if (!TRIAGE_AUDIT_VERDICTS.has(parsed.verdict)) {
      throw new Error(`--verdict must be one of: confirmed, overturned. Got: ${parsed.verdict}`);
    }
    parsed.mode = 'audit-triage';
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

function readManifestFacts(manifestPath) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const warningCount = manifest?.quality?.staticReviewWarningCount;
    return {
      startedAtMs: epochMsOrNull(manifest.startedAt) ?? epochMsOrNull(manifest?.generation?.completedAt),
      staticReviewWarningCount: Number.isSafeInteger(warningCount) && warningCount >= 0 ? warningCount : null
    };
  } catch {
    return { startedAtMs: null, staticReviewWarningCount: null };
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

function validTriageAudit(row) {
  return typeof row?.healRunId === 'string' && row.healRunId.length > 0
    && TRIAGE_AUDIT_VERDICTS.has(row?.verdict)
    && epochMsOrNull(row?.auditedAt) !== null
    && (row.notes === undefined || typeof row.notes === 'string');
}

export function readTriageAudits(auditsPath) {
  if (!auditsPath || !fs.existsSync(auditsPath)) return [];
  const rows = [];
  for (const line of fs.readFileSync(auditsPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (validTriageAudit(row)) rows.push(row);
  }
  return rows;
}

export function appendTriageAudit(auditsPath, { healRunId, verdict, auditedAt, notes }) {
  const row = {
    healRunId,
    verdict,
    auditedAt,
    ...(typeof notes === 'string' && notes.length > 0 ? { notes } : {})
  };
  if (typeof healRunId !== 'string' || healRunId.length === 0 || path.basename(healRunId) !== healRunId) {
    throw new Error('Triage audit healRunId must be a non-empty heal run directory name.');
  }
  if (!validTriageAudit(row)) {
    throw new Error('Triage audit rows require verdict confirmed|overturned and an ISO auditedAt.');
  }
  fs.mkdirSync(path.dirname(auditsPath), { recursive: true });
  // Single-line O_APPEND write: valid JSONL even when two audits race.
  fs.appendFileSync(auditsPath, `${JSON.stringify(row)}\n`);
  return row;
}

export function readMetricsInputs(dir, { auditsPath = null } = {}) {
  const usage = readGenerationUsage(dir);
  const manifestFactsByRun = new Map();
  for (const run of usage.runs) {
    manifestFactsByRun.set(run.runId, readManifestFacts(run.manifestPath));
  }
  return {
    usage,
    manifestFactsByRun,
    healRuns: readHealRuns(path.join(dir, 'heal')),
    triageAudits: readTriageAudits(auditsPath)
  };
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

function reachedStaticReview(run) {
  return run.failureStage === 'static-review' || passedStaticReview(run);
}

function passedStaticReview(run) {
  return run.quality.reviewPassed === true
    || run.status === 'succeeded'
    || STATIC_PASSED_FAILURE_STAGES.has(run.failureStage);
}

export function computeMetrics({ usage, manifestFactsByRun, healRuns, triageAudits = [] }, window = {}) {
  const explicitRunIds = Array.isArray(window.runIds) && window.runIds.length > 0
    ? new Set(window.runIds)
    : null;
  const runs = usage.runs.filter((run) => (explicitRunIds
    ? explicitRunIds.has(run.runId)
    : inWindow(manifestFactsByRun.get(run.runId)?.startedAtMs ?? null, window)));
  const runIds = new Set(runs.map((run) => run.runId));
  const rows = usage.rows.filter((row) => runIds.has(row.runId));
  const cacheRows = usage.cacheRows.filter((row) => runIds.has(row.runId));

  const rowsByRun = new Map();
  for (const row of rows) {
    if (!rowsByRun.has(row.runId)) rowsByRun.set(row.runId, []);
    rowsByRun.get(row.runId).push(row);
  }

  const promotedRuns = runs.filter((run) => run.status === 'succeeded');
  // Unambiguous counters:
  // - started: every generation run in the window;
  // - providerCalledRuns: runs with at least one provider attempt event
  //   (a result-cache-hit promotion is started + promoted, NOT provider-called);
  // - providerCalls: total provider attempts, so retries stay visible.
  const providerCalledRuns = runs.filter((run) => (rowsByRun.get(run.runId) ?? []).length > 0);
  const providerCalls = rows.reduce((total, row) => total + (row.attemptCount ?? 1), 0);

  const billedTokens = sumTokens(rows);
  const savedTokens = cacheRows.reduce((total, row) => total + (row.savedTokens ?? 0), 0);

  const staticReached = runs.filter(reachedStaticReview);
  const staticFirstPass = staticReached.filter((run) =>
    passedStaticReview(run) && (run.quality.repairCount ?? 0) === 0);

  // Raw failure facts: grouped, unclassified rows straight from the runs.
  // Display buckets are derived later via classifyFailureFacts.
  const factGroups = new Map();
  for (const run of runs) {
    if (run.status !== 'failed') continue;
    const stage = run.failureStage ?? 'unknown';
    const reasonCode = run.failureReason ?? 'unknown';
    const terminalOutcome = run.status;
    const key = `${stage} ${reasonCode} ${terminalOutcome}`;
    const group = factGroups.get(key) ?? { stage, reasonCode, terminalOutcome, runs: 0, tokens: 0 };
    group.runs += 1;
    group.tokens += sumTokens(rowsByRun.get(run.runId) ?? []);
    factGroups.set(key, group);
  }
  const failureFacts = [...factGroups.values()].sort((left, right) =>
    right.tokens - left.tokens
    || left.stage.localeCompare(right.stage)
    || left.reasonCode.localeCompare(right.reasonCode));

  const cacheLookupRows = [...rows, ...cacheRows]
    .filter((row) => CACHE_LOOKUP_STATUSES.has(row.resultCacheStatus));
  const cacheHits = cacheLookupRows.filter((row) => row.resultCacheStatus === 'hit').length;

  // Accepted split: warning counts come from manifest quality written by the
  // accepting gate. Runs that predate the telemetry stay 'unknown' (null),
  // never silently 'clean'. Every category still counts as promoted.
  const accepted = { clean: 0, withWarning: 0, unknown: 0 };
  for (const run of promotedRuns) {
    const warningCount = manifestFactsByRun.get(run.runId)?.staticReviewWarningCount ?? null;
    if (warningCount === null) accepted.unknown += 1;
    else if (warningCount > 0) accepted.withWarning += 1;
    else accepted.clean += 1;
  }

  const selectedHealRuns = healRuns.filter((healRun) => inWindow(healRun.epochMs, window));
  const frugalHealRuns = selectedHealRuns.filter((healRun) => healRun.providerAttemptCount === 0);
  const successfulHealRuns = selectedHealRuns.filter((healRun) => SUCCESSFUL_HEAL_STATUSES.has(healRun.status));
  const healTokens = selectedHealRuns.reduce((total, healRun) => total + healRun.totalTokens, 0);

  // Triage audit coverage over ALL heal runs in the window: every heal run
  // carries a triage decision worth auditing, not only zero-provider-call
  // ones (iteration-2's overturned audit — drift labeled synchronization, 1
  // provider attempt — was invisible to zero-call-scoped coverage). The
  // latest audit row per heal run wins, so a re-audit supersedes an earlier
  // verdict. zeroCallRuns stays as the frugality counter.
  const auditByHealRun = new Map();
  for (const audit of triageAudits) auditByHealRun.set(audit.healRunId, audit);
  const auditedHealRuns = selectedHealRuns.filter((healRun) => auditByHealRun.has(healRun.runId));
  const overturnedRuns = auditedHealRuns.filter((healRun) =>
    auditByHealRun.get(healRun.runId).verdict === 'overturned');
  const healTriage = {
    healRuns: selectedHealRuns.length,
    zeroCallRuns: frugalHealRuns.length,
    audited: auditedHealRuns.length,
    overturned: overturnedRuns.length,
    coverage: ratioOrNull(auditedHealRuns.length, selectedHealRuns.length)
  };

  return {
    yieldStarted: ratioOrNull(promotedRuns.length, runs.length),
    yieldProviderCalled: ratioOrNull(promotedRuns.length, providerCalledRuns.length),
    tokensPerAccepted: ratioOrNull(billedTokens, promotedRuns.length),
    firstPassStaticRate: ratioOrNull(staticFirstPass.length, staticReached.length),
    failureFacts,
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
    healTriage,
    tokensPerSuccessfulHeal: ratioOrNull(healTokens, successfulHealRuns.length),
    accepted,
    totals: {
      started: runs.length,
      providerCalledRuns: providerCalledRuns.length,
      providerCalls,
      promoted: promotedRuns.length,
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
    schemaVersion: SNAPSHOT_SCHEMA_V2,
    generatedAt: now.toISOString(),
    gitSha: typeof gitSha === 'string' && gitSha.length > 0 ? gitSha : null,
    label,
    // Informational: the classification rule current at snapshot time. Trend
    // rendering always classifies with the CURRENT rule, not this one.
    wasteClassRuleVersion: WASTE_CLASS_RULE_VERSION,
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
    if (SNAPSHOT_SCHEMAS.has(row?.schemaVersion)) rows.push(row);
  }
  return rows;
}

function formatPercent(value) {
  return value === null || value === undefined ? '-' : `${(value * 100).toFixed(1)}%`;
}

function formatInteger(value) {
  return value === null || value === undefined ? '-' : String(Math.round(value));
}

// Waste view for any history row: v2 rows classify their raw failure facts
// with the current rule; v1 rows fall back to their stored buckets.
function wasteView(metrics) {
  return Array.isArray(metrics?.failureFacts)
    ? classifyFailureFacts(metrics.failureFacts)
    : metrics?.wasteByStage ?? null;
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

export function renderHealFrugality(metrics) {
  const triage = metrics.healTriage ?? null;
  const overturnText = triage && triage.audited > 0
    ? formatPercent(triage.overturned / triage.audited)
    : 'n/a - unaudited';
  // Coverage denominator is ALL heal runs in the window; older snapshot rows
  // predate healTriage.healRuns and fall back to their zero-call counter.
  const coverageText = triage ? `${triage.audited}/${triage.healRuns ?? triage.zeroCallRuns}` : '-';
  return `Heal frugality: ${formatPercent(metrics.healFrugality)} of ${metrics.totals.healRuns} heal runs `
    + `(overturn ${overturnText}, audit coverage ${coverageText})`;
}

const TREND_COLUMNS = [
  { header: 'label', width: 26, value: (row) => row.label ?? '-' },
  { header: 'yieldStart', width: 11, value: (row) => formatPercent(row.metrics.yieldStarted), delta: (a, b) => formatDelta(a.yieldStarted, b.yieldStarted, { percent: true }) },
  { header: 'yieldProv', width: 10, value: (row) => formatPercent(row.metrics.yieldProviderCalled), delta: (a, b) => formatDelta(a.yieldProviderCalled, b.yieldProviderCalled, { percent: true }) },
  { header: 'tokens/acc', width: 11, value: (row) => formatInteger(row.metrics.tokensPerAccepted), delta: (a, b) => formatDelta(a.tokensPerAccepted, b.tokensPerAccepted) },
  { header: 'firstPass', width: 10, value: (row) => formatPercent(row.metrics.firstPassStaticRate), delta: (a, b) => formatDelta(a.firstPassStaticRate, b.firstPassStaticRate, { percent: true }) },
  { header: 'waste e/s/r', width: 12, value: (row) => formatWaste(wasteView(row.metrics)) },
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
  const classified = classifyFailureFacts(metrics.failureFacts);
  console.log(`AI efficiency metrics (${windowText})`);
  console.log(`- Yield (promoted/started): ${formatPercent(metrics.yieldStarted)} (${metrics.totals.promoted}/${metrics.totals.started})`);
  console.log(`- Yield (promoted/provider-called): ${formatPercent(metrics.yieldProviderCalled)} (${metrics.totals.promoted}/${metrics.totals.providerCalledRuns})`);
  console.log(`- Provider calls (attempts incl. retries): ${metrics.totals.providerCalls} across ${metrics.totals.providerCalledRuns} runs`);
  console.log(`- Tokens per accepted test: ${formatInteger(metrics.tokensPerAccepted)}`);
  console.log(
    `- Accepted split: clean=${metrics.accepted.clean}, with-warning=${metrics.accepted.withWarning}, `
    + `unknown=${metrics.accepted.unknown}`
  );
  console.log(`- First-pass static-review rate: ${formatPercent(metrics.firstPassStaticRate)}`);
  console.log(
    `- Waste by class [${WASTE_CLASS_RULE_VERSION}] (tokens on failed runs): total=${classified.wastedTokens}, ` +
    `environment=${classified.environment.tokens}, ` +
    `static-review=${classified.staticReview.tokens}, ` +
    `runtime=${classified.runtime.tokens}, other=${classified.other.tokens}`
  );
  if (metrics.failureFacts.length > 0) {
    console.log('- Failure facts (stage/reason/outcome):');
    for (const fact of metrics.failureFacts) {
      console.log(`    ${fact.stage}/${fact.reasonCode}/${fact.terminalOutcome}: runs=${fact.runs}, tokens=${fact.tokens}`);
    }
  }
  console.log(
    `- Result cache: hits=${metrics.cache.hits}/${metrics.cache.lookups} lookups, ` +
    `saved=${metrics.cache.savedTokens} tokens, saved-share=${formatPercent(metrics.cache.savedShare)}`
  );
  console.log(`- Time to accepted p50/p95: ${formatLatency(metrics.timeToAccepted)} ms`);
  console.log(`- ${renderHealFrugality(metrics)}`);
  console.log(`- Tokens per successful heal: ${formatInteger(metrics.tokensPerSuccessfulHeal)}`);
  console.log(
    `- Window totals: started=${metrics.totals.started}, provider-called=${metrics.totals.providerCalledRuns}, ` +
    `provider-calls=${metrics.totals.providerCalls}, promoted=${metrics.totals.promoted}, ` +
    `billed=${metrics.totals.billedTokens} tokens, saved=${metrics.totals.savedTokens} tokens`
  );
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/metrics-report.mjs [--dir <runs>] [--since <iso>] [--until <iso>]
    [--run-ids <id,id,...>] [--audits <path>] [--json]
  node scripts/ai/metrics-report.mjs --snapshot --label <text> [window flags]
    [--history <path>] [--audits <path>]
  node scripts/ai/metrics-report.mjs --trend [--history <path>]
  node scripts/ai/metrics-report.mjs --audit-triage <healRunId>
    --verdict confirmed|overturned [--notes <text>] [--dir <runs>] [--audits <path>]

Computes efficiency metrics from .ai-runs artifacts (generation + heal) using
unambiguous window counters: started (all generation runs), providerCalledRuns
(runs with >=1 provider attempt; a result-cache hit is started+promoted but
not provider-called), providerCalls (total attempts, retries visible), and
promoted (acceptedClean + acceptedWithWarning). Both yields are reported:
promoted/started and promoted/provider-called.

Failed runs are stored as raw failure facts {stage, reasonCode,
terminalOutcome, runs, tokens}; display buckets (environment/static-review/
runtime/other) are classified at render time by the versioned rule
${WASTE_CLASS_RULE_VERSION}, so history reclassifies consistently.

--snapshot appends one ai-efficiency-snapshot/v2 JSONL row to
.ai-metrics/metrics-history.jsonl (committable). Existing v1 rows are never
rewritten; --trend renders mixed v1+v2 history ('-' for fields v1 lacks).

--audit-triage appends a manual triage-audit row {healRunId, verdict,
auditedAt, notes?} to .ai-metrics/triage-audits.jsonl after validating the
heal run exists under <runs>/heal. Audit rows feed healTriage coverage over
ALL heal runs in the window (zeroCallRuns stays as the frugality counter) and
the overturn annotation on the heal-frugality line ('n/a - unaudited' while
coverage is zero).

Windows filter generation runs by manifest startedAt and heal runs by the
epoch-ms prefix of their run directory names. --run-ids bypasses timestamps
for generation runs when batteries interleave.`);
}

function runAuditTriage(options) {
  const healRunId = options.auditHealRunId;
  if (path.basename(healRunId) !== healRunId || healRunId.includes('..')) {
    console.error(`Invalid heal run id: ${healRunId}`);
    process.exitCode = 1;
    return;
  }
  const summaryPath = path.join(options.dir, 'heal', healRunId, 'heal-summary.json');
  let summary = null;
  try {
    summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  } catch {
    summary = null;
  }
  if (summary?.schema !== 'test-heal-run/v1') {
    console.error(`Heal run not found (no valid heal-summary.json): ${healRunId} under ${path.join(options.dir, 'heal')}`);
    process.exitCode = 1;
    return;
  }
  const row = appendTriageAudit(options.auditsPath, {
    healRunId,
    verdict: options.verdict,
    auditedAt: new Date().toISOString(),
    ...(options.notes ? { notes: options.notes } : {})
  });
  console.log(`Recorded triage audit for ${row.healRunId} (${row.verdict}) to ${options.auditsPath}`);
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

  if (options.mode === 'audit-triage') {
    runAuditTriage(options);
    return;
  }

  const window = { since: options.since, until: options.until, runIds: options.runIds };
  const metrics = computeMetrics(
    readMetricsInputs(options.dir, { auditsPath: options.auditsPath }),
    window
  );

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
