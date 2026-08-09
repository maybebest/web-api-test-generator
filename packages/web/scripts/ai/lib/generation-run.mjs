import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATION_CACHE_REFERENCE_SCHEMA, invalidateGenerationCacheReference } from './generation-cache.mjs';
import {
  GENERATED_GATE_REPEAT_VALUES,
  PROMOTION_GATE_POLICY,
  PROMOTION_GATE_REPEAT_EACH
} from './generated-gate-policy.mjs';
import { acceptedGenerationQualityFingerprint } from './generation-quality.mjs';

export const GENERATION_RUN_SCHEMA = 'generation-run/v1';
export const GENERATION_RUN_EVENT_SCHEMA = 'generation-run-event/v1';

const defaultWebRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;
const STATUS_PATTERN = /^(?:started|running|completed|succeeded|failed|rejected|cancelled|truncated|refused|empty|malformed)$/;
const RESULT_CACHE_STATUSES = new Set(['disabled', 'miss', 'hit', 'single-flight-join']);
const PROVIDER_CACHE_STATUSES = new Set(['disabled', 'explicit-off', 'explicit-stable', 'automatic-possible']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_MANIFEST_BYTES = 256 * 1024;
const FULL_GATE_OUTCOMES = new Map([
  ['accepted', { reasonCode: 'PASSED', quality: true }],
  ['static-review', { reasonCode: 'STATIC_REVIEW_FAILED', quality: false }],
  ['runtime-test', { reasonCode: 'RUNTIME_TEST_FAILED', quality: false }],
  ['input-validation', { reasonCode: 'INPUT_VALIDATION_FAILED', quality: null }],
  ['global-static', { reasonCode: 'GLOBAL_STATIC_CHECK_FAILED', quality: null }],
  ['runtime-environment', { reasonCode: 'RUNTIME_ENVIRONMENT_FAILED', quality: null }]
]);

function safeRunId(value) {
  if (typeof value !== 'string' || !RUN_ID_PATTERN.test(value)) {
    throw new Error('Generation run id must contain only letters, numbers, and hyphens (1-64 characters).');
  }
  return value;
}

function safeLabel(value) {
  return typeof value === 'string' && LABEL_PATTERN.test(value) ? value : null;
}

function safeStatus(value) {
  return typeof value === 'string' && STATUS_PATTERN.test(value) ? value : null;
}

function nonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function booleanOrNull(value) {
  return typeof value === 'boolean' ? value : null;
}

function isoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Generation telemetry clock returned an invalid timestamp.');
  return date.toISOString();
}

function normalizedUsage(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    inputTokens: nonNegativeInteger(value.inputTokens),
    uncachedInputTokens: nonNegativeInteger(value.uncachedInputTokens),
    outputTokens: nonNegativeInteger(value.outputTokens),
    cachedTokens: nonNegativeInteger(value.cachedTokens) ?? 0,
    cacheWriteTokens: nonNegativeInteger(value.cacheWriteTokens) ?? 0,
    reasoningTokens: nonNegativeInteger(value.reasoningTokens) ?? 0,
    totalTokens: nonNegativeInteger(value.totalTokens),
    promptChars: nonNegativeInteger(value.promptChars),
    compactionSavedChars: nonNegativeInteger(value.compactionSavedChars),
    resultCacheHit: value.resultCacheHit === true,
    resultCacheStatus: RESULT_CACHE_STATUSES.has(value.resultCacheStatus) ? value.resultCacheStatus : 'disabled',
    providerPromptCacheStatus: PROVIDER_CACHE_STATUSES.has(value.providerPromptCacheStatus)
      ? value.providerPromptCacheStatus
      : 'disabled',
    singleFlightJoined: value.singleFlightJoined === true,
    savedTokens: nonNegativeInteger(value.savedTokens) ?? 0
  };
}

function normalizedPromotionGateRepeatEach(value) {
  if (!Number.isSafeInteger(value)) return null;
  return value === 1 || GENERATED_GATE_REPEAT_VALUES.has(value) ? value : null;
}

function normalizedQuality(value) {
  const source = value && typeof value === 'object' ? value : {};
  const fingerprint = typeof source.qualityFingerprint === 'string' && /^[a-f0-9]{64}$/i.test(source.qualityFingerprint)
    ? source.qualityFingerprint.toLowerCase()
    : null;
  return {
    reviewPassed: booleanOrNull(source.reviewPassed),
    fastGatePassed: booleanOrNull(source.fastGatePassed),
    fullGatePassed: booleanOrNull(source.fullGatePassed),
    promotionGatePolicy: safeLabel(source.promotionGatePolicy),
    promotionGateRepeatEach: normalizedPromotionGateRepeatEach(source.promotionGateRepeatEach),
    qualityFingerprint: fingerprint,
    repairCount: nonNegativeInteger(source.repairCount) ?? 0,
    // Reviewer non-blocking warnings observed by the accepting gate. null
    // means unknown (legacy runs and non-accepted paths), never zero.
    staticReviewWarningCount: nonNegativeInteger(source.staticReviewWarningCount),
    // Stable warning-kind identifiers alongside the count; null (unknown) for
    // historical runs that never carried kinds. Bounded and validated so the
    // manifest can never accumulate free text.
    staticReviewWarningKinds: normalizedWarningKinds(source.staticReviewWarningKinds)
  };
}

const WARNING_KIND_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;
const MAX_WARNING_KINDS = 16;

function normalizedWarningKinds(value) {
  if (!Array.isArray(value)) return null;
  if (!value.every((kind) => typeof kind === 'string' && WARNING_KIND_PATTERN.test(kind))) return null;
  return [...new Set(value)].slice(0, MAX_WARNING_KINDS);
}

function normalizedCacheReference(value) {
  if (value === null || value === undefined) return null;
  if (value?.schemaVersion !== GENERATION_CACHE_REFERENCE_SCHEMA
    || !SHA256_PATTERN.test(value.key ?? '')
    || !SHA256_PATTERN.test(value.entryVersion ?? '')
    || Object.keys(value).some((field) => !['schemaVersion', 'key', 'entryVersion'].includes(field))) {
    throw new Error('Generation run cache reference is invalid.');
  }
  return { schemaVersion: value.schemaVersion, key: value.key.toLowerCase(), entryVersion: value.entryVersion.toLowerCase() };
}

function canonicalEvent(run, source, timestamp) {
  const type = safeLabel(source?.type);
  if (!type) throw new Error('Generation telemetry event type must be a safe label.');
  const event = {
    schemaVersion: GENERATION_RUN_EVENT_SCHEMA,
    runId: run.runId,
    sequence: run._sequence,
    type,
    timestamp: isoTimestamp(timestamp)
  };
  const stage = safeLabel(source.stage);
  const status = safeStatus(source.status);
  const durationMs = nonNegativeNumber(source.durationMs);
  if (stage) event.stage = stage;
  if (status) event.status = status;
  if (durationMs !== null) event.durationMs = durationMs;

  if (type === 'provider-attempt' || type === 'result-cache') {
    const provider = safeLabel(source.provider);
    const model = safeLabel(source.model);
    if (provider) event.provider = provider;
    if (model) event.model = model;
    event.usage = normalizedUsage(source.usage ?? (
      source.resultCacheStatus || source.providerPromptCacheStatus
        ? {
            resultCacheStatus: source.resultCacheStatus,
            providerPromptCacheStatus: source.providerPromptCacheStatus
          }
        : null
    ));
    if (type === 'provider-attempt') {
      const attempt = nonNegativeInteger(source.attempt);
      const retryStatus = safeLabel(source.retryStatus);
      const failureStage = safeLabel(source.failureStage);
      const failureReason = safeLabel(source.failureReason);
      const httpStatus = nonNegativeInteger(source.httpStatus);
      if (attempt !== null) event.attempt = attempt;
      if (retryStatus) event.retryStatus = retryStatus;
      if (failureStage) event.failureStage = failureStage;
      if (failureReason) event.failureReason = failureReason;
      if (httpStatus !== null) event.httpStatus = httpStatus;
    }
  }

  if (source.quality !== undefined) event.quality = normalizedQuality(source.quality);
  const failureStage = safeLabel(source.failureStage);
  const failureReason = safeLabel(source.failureReason);
  if (failureStage && event.failureStage === undefined) event.failureStage = failureStage;
  if (failureReason && event.failureReason === undefined) event.failureReason = failureReason;
  return event;
}

function writeManifestAtomic(run) {
  const temporary = path.join(run.directory, `.manifest-${process.pid}-${randomUUID()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(run._manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, run.manifestPath);
  fs.chmodSync(run.manifestPath, 0o600);
}

function appendEvent(run, source, timestamp) {
  if (!run || run._finalized) throw new Error('Generation run is missing or already finalized.');
  const event = canonicalEvent(run, source, timestamp);
  fs.appendFileSync(run.eventsPath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  fs.chmodSync(run.eventsPath, 0o600);
  run._sequence += 1;
  run._manifest.events = run._sequence;
  run._manifest.updatedAt = event.timestamp;
  if (event.type === 'provider-attempt') {
    run._manifest.attempts += 1;
    if (event.status !== 'succeeded') run._manifest.failedAttempts += 1;
  }
  writeManifestAtomic(run);
  return event;
}

function pathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function requireRealDirectory(directory, label = 'Generation telemetry root') {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink()) {
    throw new Error(`${label} must not contain a symbolic link: ${directory}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} must contain only directories: ${directory}`);
  }
}

function lstatIfPresent(entryPath) {
  try {
    return fs.lstatSync(entryPath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function requireDirectoryPathWithoutLinks(directory, label = 'Generation telemetry root') {
  const absolute = path.resolve(directory);
  const parsed = path.parse(absolute);
  let cursor = parsed.root;
  requireRealDirectory(cursor, label);
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const stat = lstatIfPresent(cursor);
    if (!stat) {
      throw new Error(`${label} has a missing existing-path component: ${cursor}`);
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} must not contain a symbolic link: ${cursor}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`${label} must contain only directories: ${cursor}`);
    }
  }
}

function canonicalizeTrustedSystemPrefix(candidate) {
  // macOS exposes its private temporary directory through a root-owned /var
  // symlink. Canonicalize that trusted OS prefix first, then inspect every
  // user-controllable component below it. This keeps ordinary mkdtemp roots
  // usable without allowing a nested attacker-controlled ancestor symlink.
  const temporaryRoot = path.resolve(os.tmpdir());
  if (pathInside(candidate, temporaryRoot)) {
    return path.join(fs.realpathSync(temporaryRoot), path.relative(temporaryRoot, candidate));
  }
  return candidate;
}

function createRootWithoutFollowingLinks(root) {
  const absoluteRoot = canonicalizeTrustedSystemPrefix(path.resolve(root));
  let anchor;
  let missingSegments;

  if (pathInside(absoluteRoot, defaultWebRoot)) {
    anchor = defaultWebRoot;
    requireDirectoryPathWithoutLinks(anchor);
    missingSegments = path.relative(anchor, absoluteRoot).split(path.sep).filter(Boolean);
  } else {
    anchor = absoluteRoot;
    missingSegments = [];
    while (!lstatIfPresent(anchor)) {
      missingSegments.unshift(path.basename(anchor));
      const parent = path.dirname(anchor);
      if (parent === anchor) {
        throw new Error(`Generation telemetry root has no existing directory anchor: ${absoluteRoot}`);
      }
      anchor = parent;
    }
    requireDirectoryPathWithoutLinks(anchor);
  }

  let cursor = anchor;
  for (const segment of missingSegments) {
    cursor = path.join(cursor, segment);
    if (lstatIfPresent(cursor)) {
      requireRealDirectory(cursor);
      continue;
    }
    fs.mkdirSync(cursor, { recursive: false, mode: 0o700 });
    requireRealDirectory(cursor);
  }
  return absoluteRoot;
}

export function createGenerationRun({
  telemetryRoot = path.join(defaultWebRoot, '.ai-runs', 'generation'),
  runId = randomUUID(),
  stage = 'test-generation',
  now = () => new Date()
} = {}) {
  const safeId = safeRunId(runId);
  const safeStage = safeLabel(stage) ?? 'test-generation';
  const root = createRootWithoutFollowingLinks(telemetryRoot);
  const directory = path.join(root, safeId);
  const startedAt = isoTimestamp(now());
  fs.chmodSync(root, 0o700);
  fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
  fs.chmodSync(directory, 0o700);

  const run = {
    runId: safeId,
    directory,
    eventsPath: path.join(directory, 'events.jsonl'),
    manifestPath: path.join(directory, 'manifest.json'),
    _now: now,
    _sequence: 0,
    _finalized: false,
    _manifest: {
      schemaVersion: GENERATION_RUN_SCHEMA,
      runId: safeId,
      stage: safeStage,
      startedAt,
      updatedAt: startedAt,
      completedAt: null,
      status: 'running',
      events: 0,
      attempts: 0,
      failedAttempts: 0,
      subjectFingerprint: null,
      cacheReference: null,
      failureStage: null,
      failureReason: null,
      endToEndLatencyMs: null,
      quality: normalizedQuality(null)
    }
  };
  fs.writeFileSync(run.eventsPath, '', { mode: 0o600, flag: 'wx' });
  writeManifestAtomic(run);
  appendEvent(run, { type: 'run-started', stage: safeStage, status: 'started' }, startedAt);
  return run;
}

export function recordRunEvent(run, event) {
  return appendEvent(run, event, run._now());
}

export function recordRunAttempt(run, attempt) {
  return appendEvent(run, { ...attempt, type: 'provider-attempt' }, run._now());
}

export function finalizeGenerationRun(run, {
  status,
  failureStage = null,
  failureReason = null,
  quality = null
} = {}) {
  if (!run || run._finalized) throw new Error('Generation run is missing or already finalized.');
  const completedAt = isoTimestamp(run._now());
  const finalStatus = status === 'succeeded' ? 'succeeded' : 'failed';
  const safeFailureStage = finalStatus === 'failed' ? safeLabel(failureStage) : null;
  const safeFailureReason = finalStatus === 'failed' ? safeLabel(failureReason) : null;
  const normalized = normalizedQuality(quality);
  appendEvent(run, {
    type: 'run-finished',
    stage: run._manifest.stage,
    status: finalStatus,
    failureStage: safeFailureStage,
    failureReason: safeFailureReason,
    quality: normalized
  }, completedAt);
  run._manifest.completedAt = completedAt;
  run._manifest.status = finalStatus;
  run._manifest.failureStage = safeFailureStage;
  run._manifest.failureReason = safeFailureReason;
  run._manifest.endToEndLatencyMs = Math.max(0, new Date(completedAt).getTime() - new Date(run._manifest.startedAt).getTime());
  run._manifest.quality = normalized;
  run._manifest.updatedAt = completedAt;
  run._finalized = true;
  writeManifestAtomic(run);
  return JSON.parse(JSON.stringify(run._manifest));
}

function normalizedTargetIdentity(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new Error('Generation subject target identity must be a non-empty package-relative path.');
  }
  const normalized = value.trim().replace(/\\/g, '/');
  if (
    normalized.length > 512
    || path.posix.isAbsolute(normalized)
    || path.posix.normalize(normalized) !== normalized
    || !normalized.startsWith('tests/')
    || !normalized.endsWith('.spec.ts')
  ) {
    throw new Error('Generation subject target identity must be a normalized tests/**/*.spec.ts path.');
  }
  return normalized;
}

export function generationSubjectFingerprint({ specSha256, targetIdentity }) {
  if (typeof specSha256 !== 'string' || !SHA256_PATTERN.test(specSha256)) {
    throw new Error('Generation subject spec fingerprint must be a SHA-256 digest.');
  }
  return createHash('sha256').update(JSON.stringify({
    policy: 'generation-subject/v1',
    specSha256: specSha256.toLowerCase(),
    targetIdentity: normalizedTargetIdentity(targetIdentity)
  }), 'utf8').digest('hex');
}

export function bindGenerationRunSubject(run, subject) {
  if (!run || run._finalized) throw new Error('Generation run is missing or already finalized.');
  const fingerprint = generationSubjectFingerprint(subject);
  if (run._manifest.subjectFingerprint && run._manifest.subjectFingerprint !== fingerprint) {
    throw new Error('Generation run is already bound to a different subject.');
  }
  run._manifest.subjectFingerprint = fingerprint;
  run._manifest.updatedAt = isoTimestamp(run._now());
  writeManifestAtomic(run);
  return fingerprint;
}

export function bindGenerationRunCacheReference(run, reference) {
  if (!run || run._finalized) throw new Error('Generation run is missing or already finalized.');
  run._manifest.cacheReference = normalizedCacheReference(reference);
  run._manifest.updatedAt = isoTimestamp(run._now());
  writeManifestAtomic(run);
  return run._manifest.cacheReference;
}

function readLinkableGenerationManifest(manifestPath, runId) {
  const stat = fs.lstatSync(manifestPath);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_MANIFEST_BYTES) {
    throw new Error('Generation run manifest must be a bounded regular file, not a symbolic link.');
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Generation run manifest is not valid JSON: ${error.message}`);
  }
  if (
    manifest?.schemaVersion !== GENERATION_RUN_SCHEMA
    || manifest.runId !== runId
    || manifest.stage !== 'test-generation'
    || manifest.status !== 'succeeded'
    || !SHA256_PATTERN.test(manifest.subjectFingerprint ?? '')
    || manifest.quality?.reviewPassed !== true
    || manifest.quality?.fastGatePassed !== true
    || !SHA256_PATTERN.test(manifest.quality?.qualityFingerprint ?? '')
    || !Number.isSafeInteger(manifest.quality?.repairCount)
    || manifest.quality.repairCount < 0
  ) {
    throw new Error('Generation run is not a finalized, fast-gate-accepted test-generation run.');
  }
  if (
    manifest.quality.promotionGatePolicy !== PROMOTION_GATE_POLICY
    || manifest.quality.promotionGateRepeatEach !== PROMOTION_GATE_REPEAT_EACH
  ) {
    throw new Error('Generation run promotion gate evidence does not match the current promotion gate policy.');
  }
  return manifest;
}

/**
 * Link a later three-repeat gate to the already finalized verified-generation
 * run. The current source digest must reproduce the accepted fast-gate
 * fingerprint, so a stale run id cannot attach quality to a changed target.
 */
export function linkGenerationRunFullGate({
  telemetryRoot = path.join(defaultWebRoot, '.ai-runs', 'generation'),
  runId,
  fullGatePassed,
  sourceSha256,
  subjectFingerprint,
  outcomeStage,
  reasonCode,
  cacheDir,
  now = () => new Date()
}) {
  const safeId = safeRunId(runId);
  const outcome = FULL_GATE_OUTCOMES.get(outcomeStage);
  if (!outcome || outcome.reasonCode !== reasonCode || outcome.quality !== fullGatePassed) {
    throw new Error('Full gate outcome stage, reason code, and quality verdict are inconsistent.');
  }
  if (typeof sourceSha256 !== 'string' || !SHA256_PATTERN.test(sourceSha256)) {
    throw new Error('Full gate source fingerprint must be a SHA-256 digest.');
  }
  if (typeof subjectFingerprint !== 'string' || !SHA256_PATTERN.test(subjectFingerprint)) {
    throw new Error('Full gate generation subject fingerprint must be a SHA-256 digest.');
  }

  const root = canonicalizeTrustedSystemPrefix(path.resolve(telemetryRoot));
  requireDirectoryPathWithoutLinks(root);
  const directory = path.join(root, safeId);
  const directoryStat = fs.lstatSync(directory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new Error('Generation run directory must be a real directory.');
  }
  if (path.dirname(fs.realpathSync(directory)) !== fs.realpathSync(root)) {
    throw new Error('Generation run directory resolves outside the telemetry root.');
  }

  const manifestPath = path.join(directory, 'manifest.json');
  const lockPath = path.join(directory, '.quality-update.lock');
  let lock;
  let temporary;
  try {
    lock = fs.openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Generation run quality is already being updated: ${safeId}`);
    }
    throw error;
  }

  try {
    const manifest = readLinkableGenerationManifest(manifestPath, safeId);
    const normalizedSubjectFingerprint = subjectFingerprint.toLowerCase();
    if (manifest.subjectFingerprint.toLowerCase() !== normalizedSubjectFingerprint) {
      throw new Error('Full gate generation subject does not match the accepted generation run.');
    }
    const normalizedSourceSha256 = sourceSha256.toLowerCase();
    const expectedFingerprint = acceptedGenerationQualityFingerprint({
      sourceSha256: normalizedSourceSha256,
      repairCount: manifest.quality.repairCount
    });
    if (manifest.quality.qualityFingerprint.toLowerCase() !== expectedFingerprint) {
      throw new Error('Generation run does not match the accepted generated candidate at the current test path.');
    }
    if (fullGatePassed === false && manifest.cacheReference) {
      invalidateGenerationCacheReference(normalizedCacheReference(manifest.cacheReference), cacheDir ? { cacheDir } : {});
    }

    const fullGateUpdatedAt = isoTimestamp(now());
    const eventsPath = path.join(directory, 'events.jsonl');
    const eventsStat = fs.lstatSync(eventsPath);
    if (eventsStat.isSymbolicLink() || !eventsStat.isFile()) {
      throw new Error('Generation run event history must be a regular file, not a symbolic link.');
    }
    const sequence = nonNegativeInteger(manifest.events);
    if (sequence === null) {
      throw new Error('Generation run event count is invalid.');
    }
    const linkedEvent = {
      schemaVersion: GENERATION_RUN_EVENT_SCHEMA,
      runId: safeId,
      sequence,
      type: 'full-gate-linked',
      timestamp: fullGateUpdatedAt,
      stage: 'full-gate',
      status: fullGatePassed === true ? 'completed' : fullGatePassed === false ? 'rejected' : 'failed',
      fullGatePassed,
      outcomeStage,
      reasonCode,
      sourceSha256: normalizedSourceSha256,
      subjectFingerprint: normalizedSubjectFingerprint
    };
    const updated = {
      ...manifest,
      events: sequence + 1,
      updatedAt: fullGateUpdatedAt,
      quality: {
        ...manifest.quality,
        fullGatePassed,
        qualityFingerprint: expectedFingerprint,
        fullGateUpdatedAt,
        fullGateOutcomeStage: outcomeStage,
        fullGateReasonCode: reasonCode
      }
    };
    temporary = path.join(directory, `.manifest-full-gate-${process.pid}-${randomUUID()}.tmp`);
    fs.writeFileSync(temporary, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    fs.chmodSync(temporary, 0o600);
    fs.appendFileSync(eventsPath, `${JSON.stringify(linkedEvent)}\n`, { mode: 0o600 });
    fs.chmodSync(eventsPath, 0o600);
    fs.renameSync(temporary, manifestPath);
    temporary = undefined;
    fs.chmodSync(manifestPath, 0o600);
    return JSON.parse(JSON.stringify(updated));
  } finally {
    if (temporary) fs.rmSync(temporary, { force: true });
    if (lock !== undefined) fs.closeSync(lock);
    fs.rmSync(lockPath, { force: true });
  }
}
