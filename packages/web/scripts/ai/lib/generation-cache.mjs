import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureVerifiedDirectory, readVerifiedFile, verifiedDirectory } from './verified-file-read.mjs';

export const GENERATION_CACHE_SCHEMA_VERSION = 3;
export const GENERATION_CACHE_KEY_VERSION = 'generation-cache-key-v3';
export const GENERATION_CACHE_CANDIDATE_SCHEMA = 'generation-cache-candidate/v2';
export const GENERATION_CACHE_REFERENCE_SCHEMA = 'generation-cache-reference/v1';
export const MAX_GENERATION_CACHE_ENTRY_BYTES = 8 * 1024 * 1024;

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const webPackageRoot = path.resolve(moduleDirectory, '..', '..', '..');

export const DEFAULT_GENERATION_CACHE_DIR = path.join(webPackageRoot, '.ai-cache', 'generations');

const CACHE_KEY_PATTERN = /^[a-f0-9]{64}$/;
const QUALITY_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const ENTRY_VERSION_PATTERN = /^[a-f0-9]{64}$/;
const NUMERIC_USAGE_FIELDS = [
  'inputTokens',
  'outputTokens',
  'cachedTokens',
  'cacheWriteTokens',
  'reasoningTokens',
  'totalTokens',
  'retryCount',
  'retryTokens',
  'latencyMs',
  'savedTokens'
];
const BOOLEAN_USAGE_FIELDS = ['resultCacheHit'];
const STRING_USAGE_FIELDS = ['requestId', 'responseId'];
const USAGE_FIELDS = new Set([
  ...NUMERIC_USAGE_FIELDS,
  ...BOOLEAN_USAGE_FIELDS,
  ...STRING_USAGE_FIELDS
]);

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value;
}

function requireCacheKey(key) {
  if (typeof key !== 'string' || !CACHE_KEY_PATTERN.test(key)) {
    throw new TypeError('Generation cache key must be a lowercase SHA-256 hex digest.');
  }
  return key;
}

function requireQualityFingerprint(value) {
  if (typeof value !== 'string' || !QUALITY_FINGERPRINT_PATTERN.test(value)) {
    throw new TypeError('Generation cache quality fingerprint must be a lowercase SHA-256 hex digest.');
  }
  return value;
}

function canonicalize(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Generation cache key values must contain only finite numbers.');
    }
    return value;
  }

  if (typeof value !== 'object') {
    throw new TypeError(`Unsupported generation cache key value: ${typeof value}.`);
  }

  if (seen.has(value)) {
    throw new TypeError('Generation cache key values must not contain circular references.');
  }
  seen.add(value);

  let normalized;
  if (Array.isArray(value)) {
    normalized = value.map((item) => canonicalize(item, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Generation cache key values must use plain objects.');
    }

    normalized = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) {
        normalized[key] = canonicalize(value[key], seen);
      }
    }
  }

  seen.delete(value);
  return normalized;
}

function normalizedUsageForWrite(usage = {}) {
  if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) {
    throw new TypeError('Generation cache usage must be an object.');
  }

  const normalized = {};
  for (const field of NUMERIC_USAGE_FIELDS) {
    const value = usage[field];
    if (value === undefined) continue;
    if (value === null) {
      normalized[field] = null;
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new TypeError(`Generation cache usage.${field} must be a non-negative finite number or null.`);
    }
    normalized[field] = value;
  }

  for (const field of BOOLEAN_USAGE_FIELDS) {
    const value = usage[field];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') {
      throw new TypeError(`Generation cache usage.${field} must be a boolean.`);
    }
    normalized[field] = value;
  }

  for (const field of STRING_USAGE_FIELDS) {
    const value = usage[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(value)) {
      throw new TypeError(`Generation cache usage.${field} has an invalid value.`);
    }
    normalized[field] = value;
  }

  return normalized;
}

function isStoredUsage(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.keys(value).some((field) => !USAGE_FIELDS.has(field))) return false;

  return NUMERIC_USAGE_FIELDS.every((field) => {
    const item = value[field];
    return item === undefined || item === null || (typeof item === 'number' && Number.isFinite(item) && item >= 0);
  }) && BOOLEAN_USAGE_FIELDS.every((field) => {
    const item = value[field];
    return item === undefined || typeof item === 'boolean';
  }) && STRING_USAGE_FIELDS.every((field) => {
    const item = value[field];
    return item === undefined || (typeof item === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(item));
  });
}

function normalizedTargetSha256(value, name) {
  if (value === null) return null;
  if (typeof value !== 'string' || !QUALITY_FINGERPRINT_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a lowercase SHA-256 hex digest or null for a missing target.`);
  }
  return value;
}

function cacheReference(entry) {
  return Object.freeze({
    schemaVersion: GENERATION_CACHE_REFERENCE_SCHEMA,
    key: entry.key,
    entryVersion: entry.entryVersion
  });
}

function requireCacheReference(reference) {
  if (reference?.schemaVersion !== GENERATION_CACHE_REFERENCE_SCHEMA
    || !CACHE_KEY_PATTERN.test(reference?.key ?? '')
    || !ENTRY_VERSION_PATTERN.test(reference?.entryVersion ?? '')
    || Object.keys(reference).some((field) => !['schemaVersion', 'key', 'entryVersion'].includes(field))) {
    throw new TypeError(`Expected a safe ${GENERATION_CACHE_REFERENCE_SCHEMA}.`);
  }
  return reference;
}

function isExpectedEntry(entry, { key, provider, model, contractVersion }) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
  if (!Object.keys(entry).every((field) => ['schemaVersion', 'key', 'entryVersion', 'responseText', 'usage', 'metadata', 'inputTargetSha256', 'outputSha256'].includes(field))) {
    return false;
  }
  if (entry.schemaVersion !== GENERATION_CACHE_SCHEMA_VERSION || entry.key !== key) return false;
  if (!ENTRY_VERSION_PATTERN.test(entry.entryVersion ?? '')) return false;
  if (!(entry.inputTargetSha256 === null || QUALITY_FINGERPRINT_PATTERN.test(entry.inputTargetSha256 ?? ''))) return false;
  if (!QUALITY_FINGERPRINT_PATTERN.test(entry.outputSha256 ?? '')) return false;
  if (typeof entry.responseText !== 'string' || entry.responseText.trim() === '') return false;
  if (!isStoredUsage(entry.usage)) return false;

  const metadata = entry.metadata;
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  if (!Object.keys(metadata).every((field) => [
    'provider',
    'model',
    'contractVersion',
    'createdAt',
    'acceptedAt',
    'validationStatus',
    'qualityFingerprint'
  ].includes(field))) {
    return false;
  }

  return metadata.provider === provider
    && metadata.model === model
    && metadata.contractVersion === contractVersion
    && typeof metadata.createdAt === 'string'
    && Number.isFinite(Date.parse(metadata.createdAt))
    && typeof metadata.acceptedAt === 'string'
    && Number.isFinite(Date.parse(metadata.acceptedAt))
    && metadata.validationStatus === 'accepted'
    && QUALITY_FINGERPRINT_PATTERN.test(metadata.qualityFingerprint);
}

function cacheFilePath(cacheDir, key) {
  return path.join(path.resolve(cacheDir), `${requireCacheKey(key)}.json`);
}

function cacheLockPath(cacheDir, key) {
  return path.join(path.resolve(cacheDir), `.${requireCacheKey(key)}.lock`);
}

async function acquireCacheLock(cacheDir, key) {
  const lockPath = cacheLockPath(cacheDir, key);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      return { handle: await fs.open(lockPath, 'wx', 0o600), lockPath };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new Error('Generation cache entry remained locked too long.');
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    // Some platforms do not support fsync on directories. The file rename is still atomic.
    if (!['EINVAL', 'EISDIR', 'ENOTSUP', 'EBADF'].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}

export function createGenerationCacheKey({
  provider,
  model,
  systemPrompt,
  prompt,
  contractVersion,
  knobs = {}
}) {
  const keyMaterial = canonicalize({
    keyVersion: GENERATION_CACHE_KEY_VERSION,
    provider: requireNonEmptyString(provider, 'provider'),
    model: requireNonEmptyString(model, 'model'),
    systemPrompt: requireNonEmptyString(systemPrompt, 'systemPrompt'),
    prompt: requireNonEmptyString(prompt, 'prompt'),
    contractVersion: requireNonEmptyString(contractVersion, 'contractVersion'),
    knobs
  });

  return crypto.createHash('sha256').update(JSON.stringify(keyMaterial), 'utf8').digest('hex');
}

export async function readGenerationCache({
  cacheDir = DEFAULT_GENERATION_CACHE_DIR,
  key,
  provider,
  model,
  contractVersion,
  currentTargetSha256
}) {
  requireNonEmptyString(provider, 'provider');
  requireNonEmptyString(model, 'model');
  requireNonEmptyString(contractVersion, 'contractVersion');
  if (!Object.hasOwn(arguments[0], 'currentTargetSha256')) {
    throw new TypeError('currentTargetSha256 must be provided explicitly (null means the target is missing).');
  }
  const currentTarget = normalizedTargetSha256(currentTargetSha256, 'currentTargetSha256');
  let resolvedCacheDir;
  try {
    resolvedCacheDir = verifiedDirectory(cacheDir, 'Generation cache directory').resolved;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  const filePath = cacheFilePath(resolvedCacheDir, key);

  let entry;
  try {
    entry = JSON.parse(readVerifiedFile({
      filePath,
      rootPath: resolvedCacheDir,
      maxBytes: MAX_GENERATION_CACHE_ENTRY_BYTES,
      label: 'Generation cache entry'
    }).content);
  } catch (error) {
    if (error instanceof SyntaxError || error?.code === 'ENOENT') return null;
    throw error;
  }

  if (!isExpectedEntry(entry, { key, provider, model, contractVersion })) return null;
  if (currentTarget !== entry.inputTargetSha256 && currentTarget !== entry.outputSha256) return null;

  return {
    text: entry.responseText,
    usage: { ...entry.usage },
    metadata: { ...entry.metadata },
    cacheReference: cacheReference(entry)
  };
}

export async function writeGenerationCache({
  cacheDir = DEFAULT_GENERATION_CACHE_DIR,
  key,
  provider,
  model,
  contractVersion,
  text,
  usage = {},
  validationStatus,
  qualityFingerprint,
  inputTargetSha256 = null,
  outputSha256,
  now = () => new Date()
}) {
  requireCacheKey(key);
  requireNonEmptyString(provider, 'provider');
  requireNonEmptyString(model, 'model');
  requireNonEmptyString(contractVersion, 'contractVersion');
  requireNonEmptyString(text, 'text');
  if (validationStatus !== 'accepted') {
    throw new TypeError('Generation cache entries may be written only after validationStatus=accepted.');
  }
  requireQualityFingerprint(qualityFingerprint);
  const inputTarget = normalizedTargetSha256(inputTargetSha256, 'inputTargetSha256');
  const outputTarget = normalizedTargetSha256(outputSha256, 'outputSha256');
  if (outputTarget === null) throw new TypeError('outputSha256 must identify the generated output.');

  const createdAt = now();
  if (!(createdAt instanceof Date) || !Number.isFinite(createdAt.getTime())) {
    throw new TypeError('Generation cache now() must return a valid Date.');
  }

  const entry = {
    schemaVersion: GENERATION_CACHE_SCHEMA_VERSION,
    key,
    entryVersion: crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex'),
    responseText: text,
    inputTargetSha256: inputTarget,
    outputSha256: outputTarget,
    usage: normalizedUsageForWrite(usage),
    metadata: {
      provider,
      model,
      contractVersion,
      createdAt: createdAt.toISOString(),
      acceptedAt: createdAt.toISOString(),
      validationStatus,
      qualityFingerprint
    }
  };
  const serialized = `${JSON.stringify(entry)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_GENERATION_CACHE_ENTRY_BYTES) {
    throw new RangeError(`Generation cache entry exceeds ${MAX_GENERATION_CACHE_ENTRY_BYTES} bytes.`);
  }

  const resolvedCacheDir = ensureVerifiedDirectory(cacheDir, 'Generation cache directory').resolved;
  await fs.chmod(resolvedCacheDir, 0o700);

  const filePath = cacheFilePath(resolvedCacheDir, key);
  const temporaryPath = path.join(
    resolvedCacheDir,
    `.${key}.${process.pid}.${crypto.randomUUID()}.tmp`
  );

  let handle;
  let lock;
  try {
    lock = await acquireCacheLock(resolvedCacheDir, key);
    handle = await fs.open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.chmod(temporaryPath, 0o600);
    await fs.rename(temporaryPath, filePath);
    await fs.chmod(filePath, 0o600);
    await syncDirectory(resolvedCacheDir);
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    await lock?.handle.close().catch(() => {});
    if (lock) await fs.rm(lock.lockPath, { force: true }).catch(() => {});
  }

  return Object.freeze({ filePath, cacheReference: cacheReference(entry) });
}

export function createGenerationCacheCandidate({
  cacheDir = DEFAULT_GENERATION_CACHE_DIR,
  key,
  provider,
  model,
  contractVersion,
  text,
  inputTargetSha256 = null,
  usage = {}
}) {
  requireCacheKey(key);
  requireNonEmptyString(provider, 'provider');
  requireNonEmptyString(model, 'model');
  requireNonEmptyString(contractVersion, 'contractVersion');
  requireNonEmptyString(text, 'text');
  return Object.freeze({
    schemaVersion: GENERATION_CACHE_CANDIDATE_SCHEMA,
    cacheDir: path.resolve(cacheDir),
    key,
    provider,
    model,
    contractVersion,
    inputTargetSha256: normalizedTargetSha256(inputTargetSha256, 'inputTargetSha256'),
    text,
    usage: Object.freeze(normalizedUsageForWrite(usage))
  });
}

function requireCandidate(candidate) {
  if (candidate?.schemaVersion !== GENERATION_CACHE_CANDIDATE_SCHEMA) {
    throw new TypeError(`Expected ${GENERATION_CACHE_CANDIDATE_SCHEMA}.`);
  }
  requireCacheKey(candidate.key);
  requireNonEmptyString(candidate.provider, 'candidate.provider');
  requireNonEmptyString(candidate.model, 'candidate.model');
  requireNonEmptyString(candidate.contractVersion, 'candidate.contractVersion');
  requireNonEmptyString(candidate.text, 'candidate.text');
  requireNonEmptyString(candidate.cacheDir, 'candidate.cacheDir');
  normalizedUsageForWrite(candidate.usage);
  normalizedTargetSha256(candidate.inputTargetSha256, 'candidate.inputTargetSha256');
  return candidate;
}

export async function promoteGenerationCache(candidate, {
  qualityFingerprint,
  outputSha256,
  now,
  writeCache = writeGenerationCache
} = {}) {
  const accepted = requireCandidate(candidate);
  const acceptedOutputSha256 = normalizedTargetSha256(outputSha256, 'outputSha256');
  if (acceptedOutputSha256 === null) throw new TypeError('outputSha256 must identify the generated output.');
  const written = await writeCache({
    cacheDir: accepted.cacheDir,
    key: accepted.key,
    provider: accepted.provider,
    model: accepted.model,
    contractVersion: accepted.contractVersion,
    text: accepted.text,
    usage: accepted.usage,
    inputTargetSha256: accepted.inputTargetSha256,
    outputSha256: acceptedOutputSha256,
    validationStatus: 'accepted',
    qualityFingerprint: requireQualityFingerprint(qualityFingerprint),
    ...(now ? { now } : {})
  });
  return requireCacheReference(written?.cacheReference);
}

export function invalidateGenerationCacheReference(reference, {
  cacheDir = DEFAULT_GENERATION_CACHE_DIR
} = {}) {
  const exact = requireCacheReference(reference);
  let lockDescriptor;
  let lockPath;
  let filePath;
  try {
    filePath = cacheFilePath(verifiedDirectory(cacheDir, 'Generation cache directory').resolved, exact.key);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  lockPath = cacheLockPath(path.dirname(filePath), exact.key);
  try {
    lockDescriptor = fsSync.openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
  try {
    const quarantinePath = path.join(path.dirname(filePath), `.${exact.key}.${crypto.randomUUID()}.quarantine`);
    let quarantineDescriptor;
    let isolatedStat;
    try {
      try {
        isolatedStat = fsSync.lstatSync(filePath);
        if (!isolatedStat.isFile() || isolatedStat.isSymbolicLink()
          || isolatedStat.size <= 0 || isolatedStat.size > MAX_GENERATION_CACHE_ENTRY_BYTES) return false;
        fsSync.renameSync(filePath, quarantinePath);
        quarantineDescriptor = fsSync.openSync(
          quarantinePath,
          fsSync.constants.O_RDWR | (fsSync.constants.O_NOFOLLOW ?? 0)
        );
      } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
      }

      const emptyIsolatedEntry = () => {
        fsSync.ftruncateSync(quarantineDescriptor, 0);
        fsSync.fsyncSync(quarantineDescriptor);
      };
      const restoreIsolatedEntry = (content) => {
        let restoreDescriptor;
        try {
          restoreDescriptor = fsSync.openSync(filePath, 'wx', 0o600);
          let offset = 0;
          while (offset < content.length) {
            offset += fsSync.writeSync(restoreDescriptor, content, offset, content.length - offset, offset);
          }
          fsSync.fsyncSync(restoreDescriptor);
        } catch (error) {
          if (error?.code !== 'EEXIST') throw error;
        } finally {
          if (restoreDescriptor !== undefined) fsSync.closeSync(restoreDescriptor);
        }
        emptyIsolatedEntry();
      };

      let content;
      try {
        const before = fsSync.fstatSync(quarantineDescriptor);
        if (!before.isFile() || before.dev !== isolatedStat.dev || before.ino !== isolatedStat.ino
          || before.size !== isolatedStat.size) {
          // The unpredictable quarantine pathname was replaced before it could be
          // opened. Never mutate the replacement through this descriptor.
          return false;
        }
        const captured = Buffer.alloc(before.size);
        let offset = 0;
        while (offset < captured.length) {
          const bytesRead = fsSync.readSync(quarantineDescriptor, captured, offset, captured.length - offset, offset);
          if (bytesRead === 0) throw new Error('Quarantined generation cache entry changed while it was read.');
          offset += bytesRead;
        }
        const after = fsSync.fstatSync(quarantineDescriptor);
        if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
          || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
          throw new Error('Quarantined generation cache entry changed while it was read.');
        }
        content = captured;
      } catch {
        if (content) restoreIsolatedEntry(content);
        else emptyIsolatedEntry();
        return false;
      }

      let entry;
      try {
        entry = JSON.parse(content.toString('utf8'));
      } catch {
        restoreIsolatedEntry(content);
        return false;
      }
      if (entry?.key !== exact.key || entry?.entryVersion !== exact.entryVersion) {
        restoreIsolatedEntry(content);
        return false;
      }
      emptyIsolatedEntry();
      return true;
    } finally {
      if (quarantineDescriptor !== undefined) fsSync.closeSync(quarantineDescriptor);
    }
  } finally {
    fsSync.closeSync(lockDescriptor);
    fsSync.rmSync(lockPath, { force: true });
  }
}

// Rejected candidates are in-memory only, so rejecting one deliberately writes
// nothing. This guarantees a syntax-plausible but gate-invalid response can
// never become an exact-cache hit on a later run.
export async function rejectGenerationCache(candidate, reason = {}) {
  const rejected = requireCandidate(candidate);
  if (reason?.validationStatus && reason.validationStatus !== 'rejected') {
    throw new TypeError('Rejected generation cache candidates require validationStatus=rejected.');
  }
  return { key: rejected.key, validationStatus: 'rejected', failureStage: reason?.failureStage ?? null };
}
