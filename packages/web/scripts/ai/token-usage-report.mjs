#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPORTABLE_STAGES = new Set(['test-generation', 'recording-generation', 'repair', 'spec-fit']);
const REPORTABLE_PROVIDERS = new Set(['anthropic', 'openai', 'claude-cli', 'codex-cli']);
const REPORTABLE_STATUSES = new Set([
  'started', 'running', 'completed', 'succeeded', 'failed', 'rejected', 'cancelled',
  'truncated', 'refused', 'empty', 'malformed'
]);
const REPORTABLE_RETRY_STATUSES = new Set(['retrying', 'retryable', 'exhausted', 'not-retried']);
const REPORTABLE_FAILURE_STAGES = new Set([
  'provider', 'candidate-integrity', 'promotion-conflict', 'input-assembly', 'preflight',
  'environment-preflight',
  'test-generation', 'recording-generation', 'fast-gate', 'repair', 'promotion', 'input-validation', 'global-static',
  'static-review', 'runtime-environment', 'runtime-test', 'full-gate', 'spec-fit'
]);
const REPORTABLE_FAILURE_REASONS = new Set([
  'cli-failed', 'malformed-output', 'malformed-response', 'network-error',
  'single-flight-leader-failed', 'retry-usage-unknown', 'generation-readiness-failed',
  'environment-preflight',
  'gate-rejected', 'candidate-integrity', 'promotion-conflict', 'truncated', 'refused',
  'generation-failed', 'input-assembly-failed', 'preflight-failed', 'test-generation-failed',
  'recording-generation-failed',
  'fast-gate-failed', 'repair-failed', 'promotion-failed'
]);
const TELEMETRY_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export function parseArgs(args) {
  const parsed = {
    dir: path.join(webRoot, '.ai-runs'),
    json: false,
    require: false,
    maxTokensPerGeneration: undefined,
    maxRetries: undefined
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--require') parsed.require = true;
    else if (arg === '--dir') parsed.dir = requiredValue(args, ++index, '--dir');
    else if (arg === '--max-tokens-per-generation') {
      parsed.maxTokensPerGeneration = positiveInteger(requiredValue(args, ++index, arg), arg);
    } else if (arg === '--max-retries') {
      parsed.maxRetries = nonNegativeInteger(requiredValue(args, ++index, arg), arg);
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
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

function positiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function nonNegativeInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
  return parsed;
}

function manifestPaths(root) {
  if (!fs.existsSync(root)) return [];
  const found = [];
  const pending = [path.resolve(root)];

  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) pending.push(candidate);
      else if (entry.isFile() && entry.name === 'manifest.json') found.push(candidate);
    }
  }

  return found.sort();
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function booleanOrNull(value) {
  return typeof value === 'boolean' ? value : null;
}

function attemptCountOrOne(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function weightedCount(rows, predicate = () => true) {
  return rows.reduce(
    (total, row) => total + (predicate(row) ? attemptCountOrOne(row.attemptCount) : 0),
    0
  );
}

function reportableStage(value) {
  return typeof value === 'string' && REPORTABLE_STAGES.has(value) ? value : null;
}

function reportableProvider(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase();
  return REPORTABLE_PROVIDERS.has(normalized) ? normalized : null;
}

function boundedTelemetryLabel(value) {
  return typeof value === 'string' && TELEMETRY_LABEL_PATTERN.test(value) ? value : null;
}

function positiveSafeIntegerOrNull(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function reportableStatus(value) {
  return typeof value === 'string' && REPORTABLE_STATUSES.has(value) ? value : null;
}

function reportableRetryStatus(value) {
  return typeof value === 'string' && REPORTABLE_RETRY_STATUSES.has(value) ? value : null;
}

function reportableFailureStage(value) {
  return typeof value === 'string' && REPORTABLE_FAILURE_STAGES.has(value) ? value : null;
}

function reportableFailureReason(value) {
  if (typeof value !== 'string') return null;
  return REPORTABLE_FAILURE_REASONS.has(value) || /^http-[1-5][0-9]{2}$/.test(value) ? value : null;
}

function subjectFingerprintOrNull(value) {
  return typeof value === 'string' && SHA256_PATTERN.test(value) ? value.toLowerCase() : null;
}

function eventStageOrManifest(event, manifest) {
  return Object.hasOwn(event ?? {}, 'stage')
    ? reportableStage(event.stage)
    : reportableStage(manifest?.stage);
}

function readEventLines(eventsPath, invalidEvents) {
  if (!fs.existsSync(eventsPath)) {
    invalidEvents.push({ eventsPath, error: 'events.jsonl is missing' });
    return [];
  }
  const stat = fs.lstatSync(eventsPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    invalidEvents.push({ eventsPath, error: 'events.jsonl is not a regular file' });
    return [];
  }
  const events = [];
  for (const [index, line] of fs.readFileSync(eventsPath, 'utf8').split('\n').entries()) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      invalidEvents.push({ eventsPath, line: index + 1, error: error.message });
    }
  }
  return events;
}

function generationHistoryIssues(manifest, events) {
  const issues = [];
  if (events.some((event, index) => !Number.isSafeInteger(event.sequence) || event.sequence !== index)) {
    issues.push('event sequence must be unique, monotonic, and contiguous from zero');
  }
  if (!Number.isSafeInteger(manifest.events) || manifest.events !== events.length) {
    issues.push(`manifest events=${manifest.events ?? 'missing'} does not match JSONL events=${events.length}`);
  }

  const attempts = events.filter((event) => event.type === 'provider-attempt');
  const failedAttempts = attempts.filter((event) => event.status !== 'succeeded');
  if (!Number.isSafeInteger(manifest.attempts) || manifest.attempts !== attempts.length) {
    issues.push(`manifest attempts=${manifest.attempts ?? 'missing'} does not match provider attempts=${attempts.length}`);
  }
  if (!Number.isSafeInteger(manifest.failedAttempts) || manifest.failedAttempts !== failedAttempts.length) {
    issues.push(
      `manifest failedAttempts=${manifest.failedAttempts ?? 'missing'} does not match failed provider attempts=${failedAttempts.length}`
    );
  }

  const starts = events.filter((event) => event.type === 'run-started');
  if (starts.length !== 1 || events[0]?.type !== 'run-started') {
    issues.push('history must begin with exactly one run-started event');
  }
  const finishes = events.filter((event) => event.type === 'run-finished');
  if (['succeeded', 'failed'].includes(manifest.status)) {
    if (finishes.length !== 1 || finishes[0]?.status !== manifest.status) {
      issues.push(`terminal manifest status=${manifest.status} requires one matching run-finished event`);
    }
  } else if (finishes.length > 0) {
    issues.push('a nonterminal manifest must not contain run-finished');
  }

  if (
    manifest.status === 'succeeded'
    && !events.some((event) => event.type === 'provider-attempt' || event.type === 'result-cache')
  ) {
    issues.push('succeeded generation has no provider-attempt or result-cache evidence');
  }
  return issues;
}

function usageRow({
  manifestPath, runId, stage, subjectFingerprint, provider, model, status, durationMs,
  retryStatus, failureStage, failureReason, usage, source, attemptCount = 1
}) {
  const resultCacheStatuses = new Set(['disabled', 'miss', 'hit', 'single-flight-join']);
  const providerCacheStatuses = new Set(['disabled', 'explicit-off', 'explicit-stable', 'automatic-possible']);
  const hasUsage = usage !== null && usage !== undefined && typeof usage === 'object' && !Array.isArray(usage);
  const inputTokens = numberOrNull(usage?.inputTokens);
  const cachedTokens = hasUsage ? numberOrNull(usage.cachedTokens) ?? 0 : null;
  const cacheWriteTokens = hasUsage ? numberOrNull(usage.cacheWriteTokens) ?? 0 : null;
  const reportedUncached = numberOrNull(usage?.uncachedInputTokens);
  const uncachedInputTokens = reportedUncached ?? (
    inputTokens === null ? null : Math.max(0, inputTokens - cachedTokens - cacheWriteTokens)
  );
  return {
    manifestPath,
    runId,
    source,
    stage: reportableStage(stage),
    subjectFingerprint: subjectFingerprintOrNull(subjectFingerprint),
    provider: reportableProvider(provider),
    model: boundedTelemetryLabel(model),
    status: reportableStatus(status),
    attemptCount: attemptCountOrOne(attemptCount),
    retryStatus: reportableRetryStatus(retryStatus),
    failureStage: reportableFailureStage(failureStage),
    failureReason: reportableFailureReason(failureReason),
    durationMs: numberOrNull(durationMs),
    inputTokens,
    uncachedInputTokens,
    outputTokens: numberOrNull(usage?.outputTokens),
    cachedTokens,
    cacheWriteTokens,
    reasoningTokens: hasUsage ? numberOrNull(usage.reasoningTokens) ?? 0 : null,
    totalTokens: numberOrNull(usage?.totalTokens),
    retryCount: numberOrNull(usage?.retryCount),
    retryTokens: numberOrNull(usage?.retryTokens),
    latencyMs: numberOrNull(usage?.latencyMs) ?? numberOrNull(durationMs),
    resultCacheHit: hasUsage ? usage.resultCacheHit === true : null,
    resultCacheStatus: hasUsage && resultCacheStatuses.has(usage.resultCacheStatus)
      ? usage.resultCacheStatus
      : hasUsage && usage.resultCacheHit === true ? 'hit' : null,
    providerPromptCacheStatus: hasUsage && providerCacheStatuses.has(usage.providerPromptCacheStatus)
      ? usage.providerPromptCacheStatus
      : null,
    singleFlightJoined: hasUsage ? usage.singleFlightJoined === true : null,
    savedTokens: hasUsage ? numberOrNull(usage.savedTokens) ?? 0 : null,
    promptChars: numberOrNull(usage?.promptChars),
    compactionSavedChars: numberOrNull(usage?.compactionSavedChars),
    usageKnown: hasUsage && inputTokens !== null && numberOrNull(usage.outputTokens) !== null
  };
}

export function readGenerationUsage(root) {
  const rows = [];
  const runs = [];
  const cacheRows = [];
  const invalidManifests = [];
  const invalidEvents = [];
  const loaded = [];

  for (const manifestPath of manifestPaths(root)) {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      invalidManifests.push({ manifestPath, error: error.message });
      continue;
    }

    loaded.push({ manifestPath, manifest });
  }

  const newRunIds = new Set();
  for (const { manifestPath, manifest } of loaded) {
    if (manifest?.schemaVersion !== 'generation-run/v1') continue;
    const runId = typeof manifest.runId === 'string' ? manifest.runId : path.basename(path.dirname(manifestPath));
    newRunIds.add(runId);
    const run = {
      runId,
      manifestPath,
      source: 'generation-run/v1',
      stage: reportableStage(manifest.stage),
      subjectFingerprint: subjectFingerprintOrNull(manifest.subjectFingerprint),
      status: reportableStatus(manifest.status),
      failureStage: reportableFailureStage(manifest.failureStage),
      failureReason: reportableFailureReason(manifest.failureReason),
      endToEndLatencyMs: numberOrNull(manifest.endToEndLatencyMs),
      quality: {
        reviewPassed: booleanOrNull(manifest?.quality?.reviewPassed),
        fastGatePassed: booleanOrNull(manifest?.quality?.fastGatePassed),
        fullGatePassed: booleanOrNull(manifest?.quality?.fullGatePassed),
        promotionGatePolicy: boundedTelemetryLabel(manifest?.quality?.promotionGatePolicy),
        promotionGateRepeatEach: positiveSafeIntegerOrNull(manifest?.quality?.promotionGateRepeatEach),
        repairCount: numberOrNull(manifest?.quality?.repairCount) ?? 0
      }
    };
    runs.push(run);
    const eventsPath = path.join(path.dirname(manifestPath), 'events.jsonl');
    const invalidBeforeHistory = invalidEvents.length;
    const validEvents = [];
    for (const event of readEventLines(eventsPath, invalidEvents)) {
      if (event?.schemaVersion !== 'generation-run-event/v1') {
        invalidEvents.push({ eventsPath, error: 'event has an unsupported schema version' });
        continue;
      }
      if (event.runId !== runId) {
        invalidEvents.push({ eventsPath, error: 'event run id does not match its manifest' });
        continue;
      }
      validEvents.push(event);
    }
    if (invalidEvents.length === invalidBeforeHistory) {
      const issues = generationHistoryIssues(manifest, validEvents);
      if (issues.length > 0) invalidEvents.push({ eventsPath, error: issues.join('; ') });
    }
    for (const event of validEvents) {
      if (event.type === 'provider-attempt') {
        rows.push(usageRow({
          manifestPath,
          runId,
          stage: eventStageOrManifest(event, manifest),
          subjectFingerprint: manifest.subjectFingerprint,
          provider: event.provider,
          model: event.model,
          status: event.status,
          durationMs: event.durationMs,
          retryStatus: event.retryStatus,
          failureStage: event.failureStage,
          failureReason: event.failureReason,
          usage: event.usage,
          source: 'generation-run/v1'
        }));
      } else if (event.type === 'result-cache') {
        cacheRows.push(usageRow({
          manifestPath,
          runId,
          stage: eventStageOrManifest(event, manifest),
          subjectFingerprint: manifest.subjectFingerprint,
          provider: event.provider,
          model: event.model,
          status: event.status,
          durationMs: event.durationMs,
          usage: event.usage,
          source: 'generation-run/v1-cache'
        }));
      }
    }
    const declaredAttempts = Number.isSafeInteger(manifest.attempts) && manifest.attempts >= 0
      ? manifest.attempts
      : null;
    const observedAttempts = validEvents.filter((event) => event.type === 'provider-attempt').length;
    const missingAttempts = declaredAttempts === null ? 0 : declaredAttempts - observedAttempts;
    if (['succeeded', 'failed'].includes(manifest.status) && missingAttempts > 0) {
      // One weighted row preserves the declared paid-attempt delta without
      // allocating an attacker-controlled number of objects. Unknown event
      // bodies never supply provider, model, status, token, or failure data.
      rows.push(usageRow({
        manifestPath,
        runId,
        stage: manifest.stage,
        subjectFingerprint: manifest.subjectFingerprint,
        provider: null,
        model: null,
        status: null,
        durationMs: null,
        retryStatus: null,
        failureStage: null,
        failureReason: null,
        usage: null,
        source: 'generation-run/v1-missing-attempt',
        attemptCount: missingAttempts
      }));
    }
  }

  for (const { manifestPath, manifest } of loaded) {
    if (manifest?.schemaVersion === 'generation-run/v1') continue;
    const runId = typeof manifest?.generation?.runId === 'string'
      ? manifest.generation.runId
      : typeof manifest?.runId === 'string' ? manifest.runId : null;
    if (runId && newRunIds.has(runId)) continue;

    const usage = manifest?.generation?.usage;
    if (!usage || typeof usage !== 'object') continue;
    const legacyRunId = runId ?? `legacy:${manifestPath}`;
    const row = usageRow({
      manifestPath,
      runId: legacyRunId,
      stage: null,
      subjectFingerprint: null,
      provider: usage.provider ?? manifest.generation.brain ?? null,
      model: manifest.generation.model ?? null,
      status: 'succeeded',
      durationMs: usage.latencyMs,
      usage,
      source: 'legacy-manifest'
    });
    if (row.resultCacheHit) cacheRows.push(row);
    else rows.push(row);
    runs.push({
      runId: legacyRunId,
      manifestPath,
      source: 'legacy-manifest',
      stage: null,
      subjectFingerprint: null,
      status: 'succeeded',
      failureStage: null,
      failureReason: null,
      endToEndLatencyMs: row.latencyMs,
      quality: {
        reviewPassed: null,
        fastGatePassed: null,
        fullGatePassed: null,
        promotionGatePolicy: null,
        promotionGateRepeatEach: null,
        repairCount: 0
      }
    });
  }

  return { rows, runs, cacheRows, invalidManifests, invalidEvents };
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + (row[field] ?? 0), 0);
}

function nearestRank(values, percentile) {
  const sorted = values.filter((value) => value !== null).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

function rate(values) {
  const known = values.filter((value) => typeof value === 'boolean');
  return known.length === 0 ? null : known.filter(Boolean).length / known.length;
}

function failureStageCounts(rows, runs) {
  const counts = new Map();
  const stagesByRun = new Map();
  for (const row of rows) {
    if (row.status === null || row.status === undefined || row.status === 'succeeded') continue;
    const stage = row.failureStage ?? 'provider';
    counts.set(stage, (counts.get(stage) ?? 0) + attemptCountOrOne(row.attemptCount));
    if (!stagesByRun.has(row.runId)) stagesByRun.set(row.runId, new Set());
    stagesByRun.get(row.runId).add(stage);
  }
  for (const run of runs) {
    if (run.status !== 'failed' || !run.failureStage) continue;
    if (stagesByRun.get(run.runId)?.has(run.failureStage)) continue;
    counts.set(run.failureStage, (counts.get(run.failureStage) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function countByValue(values) {
  const counts = Object.create(null);
  for (const value of values) {
    if (value === null || value === undefined) continue;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => codePointCompare(left, right)));
}

function codePointCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function summarizeStageRows(rows, cacheRows) {
  const logicalInputTokens = sum(rows, 'uncachedInputTokens') + sum(rows, 'cachedTokens') + sum(rows, 'cacheWriteTokens');
  const exactCacheRecords = [...rows, ...cacheRows]
    .filter((row) => ['miss', 'hit', 'single-flight-join'].includes(row.resultCacheStatus));
  const exactCacheHits = exactCacheRecords.filter((row) => row.resultCacheStatus === 'hit').length;
  const exactCacheMisses = exactCacheRecords.filter((row) => row.resultCacheStatus === 'miss').length;
  const exactCacheJoins = exactCacheRecords.filter((row) => row.resultCacheStatus === 'single-flight-join').length;
  return {
    attempts: weightedCount(rows),
    knownUsageAttempts: weightedCount(rows, (row) => row.usageKnown),
    unknownUsageAttempts: weightedCount(rows, (row) => !row.usageKnown),
    failedAttempts: weightedCount(rows, (row) => row.status !== null && row.status !== undefined && row.status !== 'succeeded'),
    attemptsWithUnknownStatus: weightedCount(rows, (row) => row.status === null || row.status === undefined),
    inputTokens: logicalInputTokens,
    uncachedInputTokens: sum(rows, 'uncachedInputTokens'),
    cachedTokens: sum(rows, 'cachedTokens'),
    cacheWriteTokens: sum(rows, 'cacheWriteTokens'),
    outputTokens: sum(rows, 'outputTokens'),
    reasoningTokens: sum(rows, 'reasoningTokens'),
    totalTokens: sum(rows, 'totalTokens'),
    attemptsWithUnknownTotalTokens: weightedCount(rows, (row) => row.totalTokens === null),
    retries: weightedCount(rows, (row) => row.source === 'generation-run/v1' && row.retryStatus === 'retrying') +
      rows.filter((row) => row.source === 'legacy-manifest').reduce((total, row) => total + (row.retryCount ?? 0), 0),
    retryTokensKnown: sum(rows, 'retryTokens'),
    retriesWithUnknownTokens: weightedCount(rows, (row) =>
      (row.source === 'generation-run/v1' && row.retryStatus === 'retrying' && row.usageKnown === false) ||
      (row.source === 'legacy-manifest' && (row.retryCount ?? 0) > 0 && row.retryTokens === null)
    ),
    resultCacheHits: exactCacheHits,
    exactCacheLookups: exactCacheRecords.length,
    exactCacheHits,
    exactCacheMisses,
    exactCacheJoins,
    exactCacheHitRatio: exactCacheRecords.length === 0 ? null : exactCacheHits / exactCacheRecords.length,
    savedRequests: exactCacheHits + exactCacheJoins,
    savedTokens: sum(cacheRows, 'savedTokens'),
    promptChars: sum(rows, 'promptChars') + sum(cacheRows, 'promptChars'),
    compactionSavedChars: sum(rows, 'compactionSavedChars') + sum(cacheRows, 'compactionSavedChars'),
    cacheReadRatio: logicalInputTokens === 0 ? null : sum(rows, 'cachedTokens') / logicalInputTokens,
    providerLatencyP50Ms: nearestRank(rows.map((row) => row.durationMs ?? row.latencyMs), 0.5),
    providerLatencyP95Ms: nearestRank(rows.map((row) => row.durationMs ?? row.latencyMs), 0.95),
    providerPromptCacheControls: countByValue(rows.map((row) => row.providerPromptCacheStatus))
  };
}

function summariesByStage(rows, cacheRows) {
  const names = [...new Set([...rows, ...cacheRows].map((row) => row.stage ?? 'unknown'))].sort(codePointCompare);
  return Object.fromEntries(names.map((stage) => [stage, summarizeStageRows(
    rows.filter((row) => (row.stage ?? 'unknown') === stage),
    cacheRows.filter((row) => (row.stage ?? 'unknown') === stage)
  )]));
}

export function summarizeGenerationUsage({ rows, runs = [], cacheRows = [], invalidManifests = [], invalidEvents = [] }) {
  const logicalInputTokens = sum(rows, 'uncachedInputTokens') + sum(rows, 'cachedTokens') + sum(rows, 'cacheWriteTokens');
  const exactCacheRecords = [...rows, ...cacheRows]
    .filter((row) => ['miss', 'hit', 'single-flight-join'].includes(row.resultCacheStatus));
  const exactCacheHits = exactCacheRecords.filter((row) => row.resultCacheStatus === 'hit').length;
  const exactCacheMisses = exactCacheRecords.filter((row) => row.resultCacheStatus === 'miss').length;
  const exactCacheJoins = exactCacheRecords.filter((row) => row.resultCacheStatus === 'single-flight-join').length;
  const attemptsWithUnknownTotalTokens = weightedCount(rows, (row) => row.totalTokens === null);
  const incompleteRuns = runs.filter((run) =>
    run.source === 'generation-run/v1' && !['succeeded', 'failed'].includes(run.status)
  );
  const firstPassReviews = runs.map((run) => {
    const review = run.quality.reviewPassed;
    if (typeof review !== 'boolean') return null;
    return review === true && run.quality.repairCount === 0;
  });
  return {
    schemaVersion: 'generation-usage-report/v2',
    generations: runs.length || rows.length + cacheRows.length,
    attempts: weightedCount(rows),
    knownUsageAttempts: weightedCount(rows, (row) => row.usageKnown),
    failedAttempts: weightedCount(rows, (row) => row.status !== null && row.status !== undefined && row.status !== 'succeeded'),
    attemptsWithUnknownStatus: weightedCount(rows, (row) => row.status === null || row.status === undefined),
    // CLI-backed providers can still consume a metered subscription even
    // though their processes expose no token counts. Never present those
    // calls (or an unrecognized provider) as zero-cost usage.
    unknownUsageAttempts: weightedCount(rows, (row) => !row.usageKnown),
    incompleteRuns: incompleteRuns.length,
    // A persisted nonterminal run may have been killed between a provider
    // charge and its next event write, so its in-flight usage is unknowable.
    unknownInFlightRuns: incompleteRuns.length,
    failureStages: failureStageCounts(rows, runs),
    inputTokens: logicalInputTokens,
    uncachedInputTokens: sum(rows, 'uncachedInputTokens'),
    outputTokens: sum(rows, 'outputTokens'),
    cachedTokens: sum(rows, 'cachedTokens'),
    cacheWriteTokens: sum(rows, 'cacheWriteTokens'),
    reasoningTokens: sum(rows, 'reasoningTokens'),
    totalTokens: sum(rows, 'totalTokens'),
    attemptsWithUnknownTotalTokens,
    // Backward-compatible alias retained for existing report consumers.
    generationsWithUnknownTotalTokens: attemptsWithUnknownTotalTokens,
    retries: weightedCount(rows, (row) => row.source === 'generation-run/v1' && row.retryStatus === 'retrying') +
      rows.filter((row) => row.source === 'legacy-manifest').reduce((total, row) => total + (row.retryCount ?? 0), 0),
    retryTokensKnown: sum(rows, 'retryTokens'),
    retriesWithUnknownTokens: weightedCount(rows, (row) =>
      (row.source === 'generation-run/v1' && row.retryStatus === 'retrying' && row.usageKnown === false) ||
      (row.source === 'legacy-manifest' && (row.retryCount ?? 0) > 0 && row.retryTokens === null)
    ),
    resultCacheHits: exactCacheHits,
    exactCacheLookups: exactCacheRecords.length,
    exactCacheHits,
    exactCacheMisses,
    exactCacheJoins,
    exactCacheHitRatio: exactCacheRecords.length === 0 ? null : exactCacheHits / exactCacheRecords.length,
    savedRequests: exactCacheHits + exactCacheJoins,
    savedTokens: sum(cacheRows, 'savedTokens'),
    promptChars: sum(rows, 'promptChars') + sum(cacheRows, 'promptChars'),
    compactionSavedChars: sum(rows, 'compactionSavedChars') + sum(cacheRows, 'compactionSavedChars'),
    providerLatencyP50Ms: nearestRank(rows.map((row) => row.durationMs ?? row.latencyMs), 0.5),
    providerLatencyP95Ms: nearestRank(rows.map((row) => row.durationMs ?? row.latencyMs), 0.95),
    endToEndLatencyP50Ms: nearestRank(runs.map((run) => run.endToEndLatencyMs), 0.5),
    endToEndLatencyP95Ms: nearestRank(runs.map((run) => run.endToEndLatencyMs), 0.95),
    cacheReadRatio: logicalInputTokens === 0 ? null : sum(rows, 'cachedTokens') / logicalInputTokens,
    providerPromptCacheControls: countByValue(rows.map((row) => row.providerPromptCacheStatus)),
    promotionGatePolicyDistribution: countByValue(runs.map((run) => run.quality.promotionGatePolicy)),
    promotionGateRepeatEachDistribution: countByValue(runs.map((run) => run.quality.promotionGateRepeatEach)),
    firstPassReviewRate: rate(firstPassReviews),
    fastGateRate: rate(runs.map((run) => run.quality.fastGatePassed)),
    fullGateRate: rate(runs.map((run) => run.quality.fullGatePassed)),
    repairCount: runs.reduce((total, run) => total + run.quality.repairCount, 0),
    byStage: summariesByStage(rows, cacheRows),
    invalidManifests: invalidManifests.length,
    invalidEvents: invalidEvents.length
  };
}

export function evaluateBudgets(rows, { maxTokensPerGeneration, maxRetries }) {
  const violations = [];
  const byRun = new Map();
  for (const row of rows) {
    const key = row.runId ?? row.manifestPath;
    if (!byRun.has(key)) {
      byRun.set(key, { manifestPath: row.manifestPath, totalTokens: 0, knownTokenRows: 0, retryCount: 0 });
    }
    const run = byRun.get(key);
    if (row.totalTokens !== null) {
      run.totalTokens += row.totalTokens;
      run.knownTokenRows += 1;
    }
    if (row.source === 'generation-run/v1') {
      if (row.retryStatus === 'retrying') run.retryCount += 1;
    } else {
      run.retryCount += row.retryCount ?? 0;
    }
  }

  for (const run of byRun.values()) {
    if (
      maxTokensPerGeneration !== undefined &&
      run.knownTokenRows > 0 &&
      run.totalTokens > maxTokensPerGeneration
    ) {
      violations.push(`${run.manifestPath}: totalTokens=${run.totalTokens} exceeds ${maxTokensPerGeneration}`);
    }
    if (maxRetries !== undefined && run.retryCount > maxRetries) {
      violations.push(`${run.manifestPath}: retryCount=${run.retryCount} exceeds ${maxRetries}`);
    }
  }
  return violations;
}

function printHuman(summary) {
  console.log('AI generation token usage');
  console.log(`- Generations: ${summary.generations}`);
  console.log(`- Provider attempts: ${summary.attempts} (${summary.failedAttempts} failed, ${summary.unknownUsageAttempts} with unknown usage)`);
  if (summary.incompleteRuns > 0) {
    console.log(`- Incomplete generation runs: ${summary.incompleteRuns} (${summary.unknownInFlightRuns} with unknown in-flight usage)`);
  }
  console.log(
    `- Tokens: uncached-input=${summary.uncachedInputTokens}, cache-read=${summary.cachedTokens}, ` +
    `cache-write=${summary.cacheWriteTokens}, output=${summary.outputTokens}, total=${summary.totalTokens}` +
    (summary.attemptsWithUnknownTotalTokens > 0
      ? ` (${summary.attemptsWithUnknownTotalTokens} attempt(s) with unreported totals)`
      : '')
  );
  console.log(`- Provider cache read ratio: ${summary.cacheReadRatio ?? 'unknown'}`);
  console.log(`- Reasoning tokens: ${summary.reasoningTokens}`);
  console.log(`- Retries: ${summary.retries} (${summary.retriesWithUnknownTokens} with unreported token cost)`);
  console.log(
    `- Exact-result cache: lookups=${summary.exactCacheLookups}, hits=${summary.exactCacheHits}, ` +
    `misses=${summary.exactCacheMisses}, joins=${summary.exactCacheJoins}, ` +
    `hit-ratio=${summary.exactCacheHitRatio ?? 'unknown'}, saved-requests=${summary.savedRequests}, ` +
    `tokens-avoided=${summary.savedTokens}`
  );
  console.log(`- Provider prompt-cache controls: ${JSON.stringify(summary.providerPromptCacheControls)}`);
  for (const [stage, stageSummary] of Object.entries(summary.byStage)) {
    console.log(
      `- Stage ${stage}: attempts=${stageSummary.attempts}, unknown=${stageSummary.unknownUsageAttempts}, ` +
      `uncached-input=${stageSummary.uncachedInputTokens}, cache-read=${stageSummary.cachedTokens}, ` +
      `cache-write=${stageSummary.cacheWriteTokens}, output=${stageSummary.outputTokens}, ` +
      `reasoning=${stageSummary.reasoningTokens}, saved-requests=${stageSummary.savedRequests}`
    );
  }
  console.log(`- Provider latency p50/p95: ${summary.providerLatencyP50Ms ?? 'unknown'}/${summary.providerLatencyP95Ms ?? 'unknown'} ms`);
  console.log(`- End-to-end latency p50/p95: ${summary.endToEndLatencyP50Ms ?? 'unknown'}/${summary.endToEndLatencyP95Ms ?? 'unknown'} ms`);
  console.log(
    `- Quality rates: first-pass-review=${summary.firstPassReviewRate ?? 'unknown'}, ` +
    `fast-gate=${summary.fastGateRate ?? 'unknown'}, full-gate=${summary.fullGateRate ?? 'unknown'}`
  );
  console.log(`- Quality context — promotion gate policy distribution: ${JSON.stringify(summary.promotionGatePolicyDistribution)}`);
  console.log(`- Quality context — promotion gate repeat distribution: ${JSON.stringify(summary.promotionGateRepeatEachDistribution)}`);
  console.log(`- Prompt compaction: characters removed=${summary.compactionSavedChars}`);
  if (summary.invalidManifests > 0) console.log(`- Invalid manifests: ${summary.invalidManifests}`);
  if (summary.invalidEvents > 0) console.log(`- Invalid events: ${summary.invalidEvents}`);
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/token-usage-report.mjs [--dir <runs>] [--json] [--require]
    [--max-tokens-per-generation <n>] [--max-retries <n>]

Aggregates generation-run/v1 events and legacy generation-usage/v1 manifests.
Token buckets are disjoint. Unknown paid-attempt usage stays unknown and makes
--require fail instead of being converted to zero. Running or otherwise
nonterminal manifests are incomplete with unknown in-flight usage and also
make --require fail.`);
}

function runCli() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const collected = readGenerationUsage(options.dir);
  const summary = summarizeGenerationUsage(collected);
  if (options.json) console.log(JSON.stringify({ summary, rows: collected.rows }, null, 2));
  else printHuman(summary);

  const violations = evaluateBudgets(collected.rows, options);
  for (const violation of violations) console.error(`Token budget violation: ${violation}`);
  const requirementViolations = [];
  if (options.require && summary.generations === 0) {
    requirementViolations.push('Token report requirement failed: no generation runs were found.');
  }
  if (options.require && summary.unknownUsageAttempts > 0) {
    requirementViolations.push(
      `Token report requirement failed: ${summary.unknownUsageAttempts} paid provider attempt(s) have unknown usage.`
    );
  }
  if (options.require && summary.incompleteRuns > 0) {
    requirementViolations.push(
      `Token report requirement failed: ${summary.incompleteRuns} generation run(s) are incomplete with unknown usage.`
    );
  }
  for (const violation of requirementViolations) console.error(violation);
  if (
    collected.invalidManifests.length > 0 ||
    collected.invalidEvents.length > 0 ||
    violations.length > 0 ||
    requirementViolations.length > 0
  ) {
    process.exitCode = 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) runCli();
