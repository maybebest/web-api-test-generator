#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  generateTestSource,
  parseArgs as parseGenerationArgs,
  recordGenerationInManifest,
  recordStandaloneGenerationManifest,
  resolveOutputPath
} from './ai-generate.mjs';
import { invalidateGenerationCacheReference, promoteGenerationCache, rejectGenerationCache } from './lib/generation-cache.mjs';
import { resolveEnv } from './lib/ai-client.mjs';
import {
  generationRepairEnabled,
  isRepairableGenerationVerdict,
  repairSourceByteLimit,
  repairGeneratedSource
} from './lib/generation-repair.mjs';
import {
  bindGenerationRunSubject,
  bindGenerationRunCacheReference,
  createGenerationRun,
  finalizeGenerationRun,
  recordRunAttempt,
  recordRunEvent
} from './lib/generation-run.mjs';
import { buildGateEnvironment } from './lib/gate-environment.mjs';
import {
  PROMOTION_GATE_POLICY,
  PROMOTION_GATE_REPEAT_EACH
} from './lib/generated-gate-policy.mjs';
import {
  acceptedGenerationQualityFingerprint,
  generationQualityFingerprint
} from './lib/generation-quality.mjs';
import { checkGenerationReadiness } from './lib/generation-preflight.mjs';
import { normalizeRecordingFile } from './lib/recording-parser.mjs';
import { specSha256 } from './lib/spec-parser.mjs';
import { validateSpecFile } from './validate-flow-spec.mjs';

const defaultWebRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export class VerifiedGenerationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'VerifiedGenerationError';
    Object.assign(this, details);
  }
}

function pathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function statIdentity(stat) {
  return {
    device: stat.dev,
    inode: stat.ino,
    mode: stat.mode,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs
  };
}

function sameStatIdentity(left, right) {
  return left.device === right.device
    && left.inode === right.inode
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function readDescriptorBytes(descriptor, size, label) {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error(`${label} has an invalid file size.`);
  }
  const source = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const count = fs.readSync(descriptor, source, offset, size - offset, offset);
    if (count === 0) throw new Error(`${label} changed while its bytes were read.`);
    offset += count;
  }
  return source;
}

function closeBoundFile(binding) {
  if (!binding || binding.closed) return;
  binding.closed = true;
  fs.closeSync(binding.descriptor);
}

function createBoundRegularFile(filePath, source, mode, label) {
  const bytes = Buffer.isBuffer(source) ? Buffer.from(source) : Buffer.from(source, 'utf8');
  const flags = fs.constants.O_RDWR
    | fs.constants.O_CREAT
    | fs.constants.O_EXCL
    | (fs.constants.O_NOFOLLOW ?? 0);
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, flags, mode);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new Error(`${label} could not be written completely.`);
      offset += count;
    }
    fs.fchmodSync(descriptor, mode);
    fs.fsyncSync(descriptor);
    const opened = fs.fstatSync(descriptor);
    const pathStat = fs.lstatSync(filePath);
    if (
      !opened.isFile()
      || pathStat.isSymbolicLink()
      || !pathStat.isFile()
      || opened.dev !== pathStat.dev
      || opened.ino !== pathStat.ino
    ) {
      throw new Error(`${label} is not the exclusively created regular file.`);
    }
    const actualBytes = readDescriptorBytes(descriptor, opened.size, label);
    const after = fs.fstatSync(descriptor);
    if (!sameStatIdentity(statIdentity(opened), statIdentity(after)) || !actualBytes.equals(bytes)) {
      throw new Error(`${label} changed while it was bound to its descriptor.`);
    }
    return {
      path: filePath,
      descriptor,
      closed: false,
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      stat: statIdentity(after)
    };
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      const stat = fs.lstatSync(filePath);
      if (!stat.isDirectory()) fs.unlinkSync(filePath);
    } catch {}
    throw error;
  }
}

function assertBoundRegularFileUnchanged(binding, label) {
  if (!binding || binding.closed) throw new Error(`${label} descriptor is not available.`);
  const pathStat = fs.lstatSync(binding.path);
  const opened = fs.fstatSync(binding.descriptor);
  if (
    pathStat.isSymbolicLink()
    || !pathStat.isFile()
    || !opened.isFile()
    || !sameStatIdentity(binding.stat, statIdentity(pathStat))
    || !sameStatIdentity(binding.stat, statIdentity(opened))
  ) {
    throw new Error(`${label} path or inode changed during verification.`);
  }
  const bytes = readDescriptorBytes(binding.descriptor, opened.size, label);
  const after = fs.fstatSync(binding.descriptor);
  const afterPath = fs.lstatSync(binding.path);
  if (
    !sameStatIdentity(binding.stat, statIdentity(after))
    || !sameStatIdentity(binding.stat, statIdentity(afterPath))
    || !bytes.equals(binding.bytes)
  ) {
    throw new Error(`${label} metadata or bytes changed during verification.`);
  }
}

function removePathWithoutFollowingLinks(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isDirectory()) fs.unlinkSync(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function targetSnapshot(target) {
  if (!fs.existsSync(target)) return { exists: false, sha256: null };
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile()) return { exists: true, sha256: null, unsafe: true };
  return { exists: true, sha256: sha256File(target) };
}

function sameSnapshot(first, second) {
  return first.exists === second.exists && first.sha256 === second.sha256 && !second.unsafe;
}

function assertSafeTarget(target, webRoot) {
  const testsRoot = path.join(webRoot, 'tests');
  if (!fs.existsSync(testsRoot)) {
    fs.mkdirSync(testsRoot, { recursive: true });
  }
  const realTestsRoot = fs.realpathSync(testsRoot);
  const targetParent = path.dirname(target);
  const relativeParent = path.relative(testsRoot, targetParent);
  let cursor = testsRoot;

  for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) break;
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing generated-test target through a symbolic link: ${cursor}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`Generated-test target parent is not a directory: ${cursor}`);
    }
  }

  fs.mkdirSync(targetParent, { recursive: true });
  const realParent = fs.realpathSync(targetParent);
  if (!pathInside(realParent, realTestsRoot)) {
    throw new Error(`Generated-test target escapes the real tests directory: ${target}`);
  }
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to replace a generated-test symbolic link: ${target}`);
    }
    if (!stat.isFile()) {
      throw new Error(`Generated-test target is not a regular file: ${target}`);
    }
  }
}

function ensureSafeRunsRoot(webRoot) {
  const runsRoot = path.join(webRoot, '.ai-runs');
  if (fs.existsSync(runsRoot)) {
    const stat = fs.lstatSync(runsRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Generation runs root must be a real directory: ${runsRoot}`);
    }
  } else {
    fs.mkdirSync(runsRoot, { recursive: false, mode: 0o700 });
  }
  const realWebRoot = fs.realpathSync(webRoot);
  const realRunsRoot = fs.realpathSync(runsRoot);
  if (!pathInside(realRunsRoot, realWebRoot)) {
    throw new Error(`Generation runs root resolves outside the package: ${runsRoot}`);
  }
  return { runsRoot, realRunsRoot };
}

function safeCandidateId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(value)) {
    throw new Error('Candidate id must contain only letters, numbers, and hyphens.');
  }
  return value;
}

export function formatGenerationRunIdLine(runId) {
  if (typeof runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(runId)) {
    throw new Error('Generation run id must contain only letters, numbers, and hyphens (1-64 characters).');
  }
  return `Generation run ID: ${runId}`;
}

export function createCandidatePath(target, id) {
  const authenticatedSuffix = '.authenticated.spec.ts';
  const suffix = target.endsWith(authenticatedSuffix) ? authenticatedSuffix : '.spec.ts';
  const base = path.basename(target, suffix);
  const candidateSuffix = suffix === authenticatedSuffix ? '.authenticated.spec.ts' : '.spec.ts';
  return path.join(path.dirname(target), `.${base}.${safeCandidateId(id)}.candidate${candidateSuffix}`);
}

function safeTaskSource(sourcePath, kind, webRoot) {
  if (typeof sourcePath !== 'string' || !sourcePath.trim() || sourcePath.includes('\0')) {
    throw new Error(`Generation manifest does not identify a valid ${kind} source path.`);
  }
  const displayPath = sourcePath.trim();
  const absolutePath = path.isAbsolute(displayPath) ? path.resolve(displayPath) : path.resolve(webRoot, displayPath);
  const approvedRoots = kind === 'flow'
    ? [path.join(webRoot, 'specs'), path.join(webRoot, '.ui-uploads', 'specs')]
    : [path.join(webRoot, 'recordings'), path.join(webRoot, '.ui-uploads', 'recordings')];
  if (!fs.existsSync(absolutePath)) throw new Error(`Generation ${kind} source does not exist: ${displayPath}`);
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 8 * 1024 * 1024) {
    throw new Error(`Unsafe generation ${kind} source: ${displayPath}`);
  }
  const realSource = fs.realpathSync(absolutePath);
  const isApproved = approvedRoots.some((root) => {
    if (!fs.existsSync(root)) return false;
    return pathInside(realSource, fs.realpathSync(root));
  });
  if (!isApproved) {
    throw new Error(`Generation ${kind} source must stay inside an approved ${kind} input directory.`);
  }
  return { displayPath, absolutePath: realSource };
}

function readTaskVerificationInput(taskPath, webRoot, outPath) {
  const absoluteTask = path.isAbsolute(taskPath) ? path.resolve(taskPath) : path.resolve(webRoot, taskPath);
  const { runsRoot: taskRoot, realRunsRoot } = ensureSafeRunsRoot(webRoot);
  if (!pathInside(absoluteTask, taskRoot) || !fs.existsSync(absoluteTask)) {
    throw new Error('Verified task generation requires a task file inside packages/web/.ai-runs.');
  }
  const taskStat = fs.lstatSync(absoluteTask);
  if (taskStat.isSymbolicLink() || !taskStat.isFile() || taskStat.size > 8 * 1024 * 1024) {
    throw new Error(`Unsafe generation task: ${absoluteTask}`);
  }
  let cursor = taskRoot;
  const taskRelative = path.relative(taskRoot, absoluteTask);
  for (const segment of taskRelative.split(path.sep).slice(0, -1)) {
    cursor = path.join(cursor, segment);
    const ancestor = fs.lstatSync(cursor);
    if (ancestor.isSymbolicLink() || !ancestor.isDirectory()) {
      throw new Error(`Generation task ancestor must not be a symbolic link: ${cursor}`);
    }
  }
  const realTask = fs.realpathSync(absoluteTask);
  if (!pathInside(realTask, realRunsRoot)) {
    throw new Error('Generation task resolves outside the real .ai-runs task root.');
  }
  const manifestPath = path.join(path.dirname(absoluteTask), 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Verified task generation requires the sibling manifest.json produced by the task builder.');
  }
  const stat = fs.lstatSync(manifestPath);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1024 * 1024) {
    throw new Error(`Unsafe generation manifest: ${manifestPath}`);
  }
  const realManifest = fs.realpathSync(manifestPath);
  if (!pathInside(realManifest, realRunsRoot) || path.dirname(realManifest) !== path.dirname(realTask)) {
    throw new Error('Generation manifest resolves outside the real task directory.');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new Error(`Invalid generation manifest: ${manifestPath}`);
  }
  if (typeof manifest.targetTestFile !== 'string' || !manifest.targetTestFile.trim()) {
    throw new Error('Generation manifest does not identify its target test file. Rebuild the task.');
  }
  const manifestTarget = path.isAbsolute(manifest.targetTestFile)
    ? path.resolve(manifest.targetTestFile)
    : path.resolve(webRoot, manifest.targetTestFile);
  if (manifestTarget !== path.resolve(outPath)) {
    throw new Error(`Generation manifest target does not match --out: ${manifest.targetTestFile}`);
  }
  if (typeof manifest.specPath === 'string' && manifest.specPath.trim()) {
    const source = safeTaskSource(manifest.specPath, 'flow', webRoot);
    const actualHash = specSha256(source.absolutePath);
    if (manifest.specSha256 !== actualHash) {
      throw new Error('Generation manifest spec hash does not match the current flow spec. Rebuild the task.');
    }
    return { kind: 'flow', sourcePath: source.displayPath, mode: manifest.generationMode, taskPath: realTask };
  }
  if (typeof manifest.recordingPath === 'string' && manifest.recordingPath.trim()) {
    const source = safeTaskSource(manifest.recordingPath, 'recording', webRoot);
    const actualHash = normalizeRecordingFile(source.absolutePath).sha256;
    if (manifest.recordingSha256 !== actualHash) {
      throw new Error('Generation manifest recording hash does not match the current recording. Rebuild the task.');
    }
    return { kind: 'recording', sourcePath: source.displayPath, taskPath: realTask };
  }
  throw new Error('Generation manifest does not identify a flow spec or recording source.');
}

function verificationInput({ specPath, taskPath, mode, webRoot, outPath }) {
  if (specPath) return { kind: 'flow', sourcePath: specPath, mode };
  return readTaskVerificationInput(taskPath, webRoot, outPath);
}

export { buildGateEnvironment } from './lib/gate-environment.mjs';

export function readGeneratedGateVerdict(verdictPath) {
  if (!fs.existsSync(verdictPath)) return null;
  const stat = fs.lstatSync(verdictPath);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 64 * 1024) return null;
  let verdict;
  try {
    verdict = JSON.parse(fs.readFileSync(verdictPath, 'utf8'));
  } catch {
    return null;
  }
  if (
    verdict?.schema !== 'generated-gate-verdict/v1'
    || typeof verdict.passed !== 'boolean'
    || typeof verdict.stage !== 'string'
    || typeof verdict.reasonCode !== 'string'
    || !Array.isArray(verdict.diagnostics)
    || typeof verdict.repairable !== 'boolean'
  ) {
    return null;
  }
  return verdict;
}

export function reconcileGeneratedGateResult(child, structuredVerdict) {
  const processPassed = !child?.error && child?.status === 0;
  if (structuredVerdict?.passed === false) return structuredVerdict;
  if (structuredVerdict?.passed === true && processPassed) return structuredVerdict;
  const issue = child?.error?.message
    ?? (structuredVerdict ? `gate process contradicted its accepted verdict with status ${child?.status ?? 1}` : 'gate did not produce a valid machine verdict');
  return {
    schema: 'generated-gate-verdict/v1',
    passed: false,
    stage: 'runtime-environment',
    reasonCode: 'RUNTIME_ENVIRONMENT_FAILED',
    diagnostics: [issue],
    repairable: false,
    reason: issue
  };
}

function defaultGate({ kind, sourcePath, testPath, mode, repeatEach, webRoot, env }) {
  const script = kind === 'recording' ? 'recording-test-gate.mjs' : 'generated-test-gate.mjs';
  const args = [path.join(webRoot, 'scripts', 'ai', script)];
  let verdictDir;
  let verdictPath;
  if (kind === 'recording') {
    args.push('--recording', sourcePath, '--test', testPath, '--repeat-each', String(repeatEach));
  } else {
    const runsRoot = path.join(webRoot, '.ai-runs');
    fs.mkdirSync(runsRoot, { recursive: true, mode: 0o700 });
    verdictDir = fs.mkdtempSync(path.join(runsRoot, 'gate-verdict-'));
    fs.chmodSync(verdictDir, 0o700);
    verdictPath = path.join(verdictDir, 'verdict.json');
    args.push('--spec', sourcePath, '--test', testPath, '--repeat-each', String(repeatEach));
    if (mode) args.push('--mode', mode);
    args.push('--verdict-file', verdictPath);
  }
  try {
    const child = spawnSync(process.execPath, args, {
      cwd: webRoot,
      stdio: 'inherit',
      shell: false,
      env: env ?? buildGateEnvironment()
    });
    const structured = verdictPath ? readGeneratedGateVerdict(verdictPath) : null;
    if (verdictPath) return reconcileGeneratedGateResult(child, structured);
    return {
      schema: 'generated-gate-verdict/v1',
      passed: !child.error && child.status === 0,
      stage: !child.error && child.status === 0 ? 'accepted' : 'runtime-environment',
      reasonCode: !child.error && child.status === 0 ? 'PASSED' : 'RUNTIME_ENVIRONMENT_FAILED',
      diagnostics: child.error ? [child.error.message] : [`gate exited with status ${child.status ?? 1}`],
      repairable: false,
      reason: child.error?.message ?? `gate exited with status ${child.status ?? 1}`
    };
  } finally {
    if (verdictDir) fs.rmSync(verdictDir, { recursive: true, force: true });
  }
}

function archiveRejectedCandidate(candidatePath, binding, webRoot, id, fileName = 'candidate.ts') {
  if (!binding || !Buffer.isBuffer(binding.bytes)) {
    throw new Error('Rejected candidate archive requires descriptor-bound generated bytes.');
  }
  const directory = path.join(webRoot, '.ai-runs', 'rejected', safeCandidateId(id));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const archivePath = path.join(directory, fileName);
  const archiveBinding = createBoundRegularFile(
    archivePath,
    binding.bytes,
    0o600,
    'Rejected generated candidate archive'
  );
  closeBoundFile(archiveBinding);
  closeBoundFile(binding);
  removePathWithoutFollowingLinks(candidatePath);
  return archivePath;
}

export async function runVerifiedGeneration({
  taskPath,
  specPath,
  out,
  mode,
  domArtifactPath,
  env = process.env,
  signal,
  webRoot = defaultWebRoot,
  candidateId = randomUUID,
  generate = generateTestSource,
  browserExecutableExists,
  repair = repairGeneratedSource,
  gate = defaultGate,
  promoteCache = promoteGenerationCache,
  rejectCache = rejectGenerationCache,
  invalidateCache = invalidateGenerationCacheReference
}) {
  const resolvedEnvironment = resolveEnv(env);
  const repairEnabled = generationRepairEnabled(resolvedEnvironment.env);
  if (repairEnabled) repairSourceByteLimit(resolvedEnvironment.env);
  const gateEnvironment = buildGateEnvironment(resolvedEnvironment.env);
  const outPath = resolveOutputPath(out, webRoot);
  assertSafeTarget(outPath, webRoot);
  const { runsRoot } = ensureSafeRunsRoot(webRoot);
  const initialTarget = targetSnapshot(outPath);
  const id = safeCandidateId(candidateId());
  const candidatePath = createCandidatePath(outPath, id);
  const promptTarget = path.relative(webRoot, outPath).split(path.sep).join('/');
  const run = createGenerationRun({
    telemetryRoot: path.join(runsRoot, 'generation'),
    runId: id,
    stage: 'test-generation'
  });
  let input;
  let generation;
  let currentStage = 'input-assembly';
  let recordedAttempts = 0;
  let gatePassed = null;
  let qualityFingerprint = null;
  let candidateSha256 = null;
  let candidateBinding = null;
  let promotionBinding = null;
  let promotionPath = null;
  let repairCount = 0;
  let currentAttemptBaseline = 0;
  let telemetryHealthy = true;

  const noteTelemetryFailure = (error) => {
    if (telemetryHealthy) {
      console.error(`[verified-generate] telemetry became incomplete; generation will continue: ${error.message}`);
    }
    telemetryHealthy = false;
  };

  const safeRecordRunEvent = (event) => {
    try {
      recordRunEvent(run, event);
    } catch (error) {
      noteTelemetryFailure(error);
    }
  };

  const safeFinalizeGenerationRun = (details) => {
    try {
      finalizeGenerationRun(run, details);
    } catch (error) {
      noteTelemetryFailure(error);
    }
  };

  const onAttempt = (attempt) => {
    recordedAttempts += 1;
    try {
      recordRunAttempt(run, attempt);
    } catch (error) {
      noteTelemetryFailure(error);
    }
  };

  const rejectGeneratedResult = async (reason) => {
    if (generation?.result?.cacheCandidate) await rejectCache(generation.result.cacheCandidate, reason);
    if (generation?.result?.cacheReference) await invalidateCache(generation.result.cacheReference);
  };

  const recordFallbackAttempts = ({
    usage,
    brain,
    provider = brain?.kind ?? usage?.provider ?? 'unknown',
    model: providerModel = brain?.model ?? usage?.model ?? 'unknown',
    retryCount = usage?.retryCount,
    status = 'succeeded',
    failureReason = null,
    stage = currentStage,
    attemptsAtStart = currentAttemptBaseline
  }) => {
    if (recordedAttempts > attemptsAtStart) return;
    if (usage?.resultCacheHit === true || usage?.resultCacheStatus === 'single-flight-join') {
      safeRecordRunEvent({
        type: 'result-cache',
        stage,
        status: 'completed',
        durationMs: usage.latencyMs,
        provider: brain?.kind,
        model: brain?.model,
        usage
      });
      return;
    }
    const retries = Number.isSafeInteger(retryCount) && retryCount >= 0 ? retryCount : 0;
    for (let index = 0; index < retries; index += 1) {
      onAttempt({
        provider,
        model: providerModel,
        stage,
        attempt: index + 1,
        status: 'failed',
        usage: null,
        retryStatus: 'retrying',
        failureStage: 'provider',
        failureReason: 'retry-usage-unknown'
      });
    }
    onAttempt({
      provider,
      model: providerModel,
      stage,
      attempt: retries + 1,
      status,
      durationMs: usage?.latencyMs,
      usage: usage ?? null,
      ...(failureReason ? { failureStage: 'provider', failureReason } : {})
    });
  };

  try {
    const inputStartedAt = Date.now();
    safeRecordRunEvent({ type: 'stage', stage: currentStage, status: 'started' });
    input = verificationInput({ specPath, taskPath, mode, webRoot, outPath });
    if (input.kind === 'flow') {
      const subjectSpecPath = path.isAbsolute(input.sourcePath)
        ? path.resolve(input.sourcePath)
        : path.resolve(webRoot, input.sourcePath);
      if (fs.existsSync(subjectSpecPath)) {
        bindGenerationRunSubject(run, {
          specSha256: specSha256(subjectSpecPath),
          targetIdentity: promptTarget
        });
      }
    }
    safeRecordRunEvent({
      type: 'stage', stage: currentStage, status: 'completed', durationMs: Date.now() - inputStartedAt
    });

    if (input.kind === 'flow') {
      currentStage = 'preflight';
      const preflightStartedAt = Date.now();
      safeRecordRunEvent({ type: 'stage', stage: currentStage, status: 'started' });
      const sourcePath = path.isAbsolute(input.sourcePath)
        ? input.sourcePath
        : path.resolve(webRoot, input.sourcePath);
      let readiness;
      try {
        const validation = validateSpecFile(sourcePath);
        readiness = validation.valid
          ? checkGenerationReadiness({
              validation,
              env: resolvedEnvironment.env,
              webRoot,
              ...(browserExecutableExists ? { browserExecutableExists } : {})
            })
          : {
              passed: false,
              diagnostics: validation.issues?.length > 0
                ? validation.issues
                : ['Flow spec validation failed.']
            };
      } catch (error) {
        readiness = {
          passed: false,
          diagnostics: [`Flow spec could not be validated: ${error.message}`]
        };
      }
      if (!readiness.passed) {
        safeRecordRunEvent({
          type: 'stage',
          stage: currentStage,
          status: 'rejected',
          durationMs: Date.now() - preflightStartedAt,
          failureStage: currentStage,
          failureReason: 'generation-readiness-failed',
          diagnostics: readiness.diagnostics
        });
        throw new Error(`Generation readiness failed: ${readiness.diagnostics.join(' ')}`);
      }
      safeRecordRunEvent({
        type: 'stage', stage: currentStage, status: 'completed', durationMs: Date.now() - preflightStartedAt
      });
    }

    currentStage = 'test-generation';
    currentAttemptBaseline = recordedAttempts;
    const generationStartedAt = Date.now();
    safeRecordRunEvent({ type: 'stage', stage: currentStage, status: 'started' });
    generation = await generate({
      taskPath: input.taskPath ?? taskPath,
      specPath,
      outPath: candidatePath,
      out: candidatePath,
      promptTarget,
      mode,
      domArtifactPath,
      packageRoot: webRoot,
      resolvedEnv: resolvedEnvironment,
      signal,
      onAttempt
    });
    recordFallbackAttempts({
      usage: generation.result?.usage,
      brain: generation.result?.brain,
      stage: currentStage,
      attemptsAtStart: currentAttemptBaseline
    });
    safeRecordRunEvent({
      type: 'stage', stage: currentStage, status: 'completed', durationMs: Date.now() - generationStartedAt
    });
    candidateBinding = createBoundRegularFile(
      candidatePath,
      generation.code,
      0o600,
      'Generated candidate'
    );
    candidateSha256 = candidateBinding.sha256;

    currentStage = 'fast-gate';
    const gateStartedAt = Date.now();
    safeRecordRunEvent({ type: 'stage', stage: currentStage, status: 'started' });
    let verdict = await gate({
      ...input,
      testPath: candidatePath,
      repeatEach: PROMOTION_GATE_REPEAT_EACH,
      webRoot,
      env: gateEnvironment
    });
    gatePassed = verdict?.passed === true;
    safeRecordRunEvent({
      type: 'stage',
      stage: verdict?.stage ?? currentStage,
      status: gatePassed ? 'completed' : 'rejected',
      durationMs: Date.now() - gateStartedAt,
      ...(!gatePassed ? { failureStage: verdict?.stage ?? currentStage, failureReason: 'gate-rejected' } : {})
    });

    if (
      !verdict?.passed
      && input.kind === 'flow'
      && repairEnabled
      && isRepairableGenerationVerdict(verdict)
    ) {
      const firstReason = {
        validationStatus: 'rejected',
        failureStage: verdict.stage,
        reason: verdict.reason ?? verdict.diagnostics?.[0] ?? 'candidate static review failed'
      };
      await rejectGeneratedResult(firstReason);
      archiveRejectedCandidate(candidatePath, candidateBinding, webRoot, id, 'attempt-1.ts');
      candidateBinding = null;

      currentStage = 'repair';
      currentAttemptBaseline = recordedAttempts;
      repairCount = 1;
      const repairStartedAt = Date.now();
      safeRecordRunEvent({ type: 'stage', stage: currentStage, status: 'started' });
      const previousPromptPath = generation.promptPath;
      const repaired = await repair({
        source: generation.code,
        verdict,
        env: resolvedEnvironment.env,
        signal,
        onAttempt
      });
      recordFallbackAttempts({
        usage: repaired.result?.usage,
        brain: repaired.result?.brain,
        stage: currentStage,
        attemptsAtStart: currentAttemptBaseline
      });
      generation = { ...repaired, promptPath: repaired.promptPath ?? previousPromptPath };
      safeRecordRunEvent({
        type: 'stage', stage: currentStage, status: 'completed', durationMs: Date.now() - repairStartedAt
      });
      candidateBinding = createBoundRegularFile(
        candidatePath,
        generation.code,
        0o600,
        'Repaired generated candidate'
      );
      candidateSha256 = candidateBinding.sha256;

      currentStage = 'fast-gate';
      const repairedGateStartedAt = Date.now();
      safeRecordRunEvent({ type: 'stage', stage: currentStage, status: 'started' });
      verdict = await gate({
        ...input,
        testPath: candidatePath,
        repeatEach: PROMOTION_GATE_REPEAT_EACH,
        webRoot,
        env: gateEnvironment
      });
      gatePassed = verdict?.passed === true;
      safeRecordRunEvent({
        type: 'stage',
        stage: verdict?.stage ?? currentStage,
        status: gatePassed ? 'completed' : 'rejected',
        durationMs: Date.now() - repairedGateStartedAt,
        ...(!gatePassed ? { failureStage: verdict?.stage ?? currentStage, failureReason: 'gate-rejected' } : {})
      });
    }

    if (!verdict?.passed) {
      const reason = {
        validationStatus: 'rejected',
        failureStage: verdict?.stage ?? 'fast-gate',
        reason: verdict?.reason ?? verdict?.diagnostics?.[0] ?? 'candidate gate failed'
      };
      await rejectGeneratedResult(reason);
      const archivePath = archiveRejectedCandidate(candidatePath, candidateBinding, webRoot, id);
      candidateBinding = null;
      throw new VerifiedGenerationError(
        `Fast acceptance gate failed for the generated candidate (${reason.reason}); the existing target was not changed.`,
        { archivePath, verdict, failureStage: reason.failureStage, failureReason: 'gate-rejected' }
      );
    }

    try {
      assertBoundRegularFileUnchanged(candidateBinding, 'Generated candidate');
    } catch {
      const reason = {
        validationStatus: 'rejected',
        failureStage: 'candidate-integrity',
        reason: 'candidate changed during verification'
      };
      await rejectGeneratedResult(reason);
      const archivePath = archiveRejectedCandidate(candidatePath, candidateBinding, webRoot, id);
      candidateBinding = null;
      throw new VerifiedGenerationError(
        'The generated candidate changed during verification; it was not promoted.',
        {
          archivePath,
          verdict,
          failureStage: 'candidate-integrity',
          failureReason: 'candidate-integrity'
        }
      );
    }
    if (!sameSnapshot(initialTarget, targetSnapshot(outPath))) {
      const reason = {
        validationStatus: 'rejected',
        failureStage: 'promotion-conflict',
        reason: 'target changed while generation was running'
      };
      await rejectGeneratedResult(reason);
      const archivePath = archiveRejectedCandidate(candidatePath, candidateBinding, webRoot, id);
      candidateBinding = null;
      throw new VerifiedGenerationError(
        'The target changed while generation was running; the concurrent edit was preserved.',
        {
          archivePath,
          verdict,
          failureStage: 'promotion-conflict',
          failureReason: 'promotion-conflict'
        }
      );
    }

    currentStage = 'promotion';
    const promotionStartedAt = Date.now();
    safeRecordRunEvent({ type: 'stage', stage: currentStage, status: 'started' });
    promotionPath = path.join(
      path.dirname(outPath),
      `.${path.basename(outPath)}.${id}.${randomUUID()}.promotion`
    );
    promotionBinding = createBoundRegularFile(
      promotionPath,
      candidateBinding.bytes,
      0o644,
      'Generated candidate promotion source'
    );
    if (promotionBinding.sha256 !== candidateSha256) {
      throw new Error('Generated candidate promotion source does not match the verified bytes.');
    }
    assertBoundRegularFileUnchanged(candidateBinding, 'Generated candidate');
    assertBoundRegularFileUnchanged(promotionBinding, 'Generated candidate promotion source');
    fs.unlinkSync(candidatePath);
    if (!sameSnapshot(initialTarget, targetSnapshot(outPath))) {
      const reason = {
        validationStatus: 'rejected',
        failureStage: 'promotion-conflict',
        reason: 'target changed while generation was running'
      };
      await rejectGeneratedResult(reason);
      const archivePath = archiveRejectedCandidate(candidatePath, candidateBinding, webRoot, id);
      candidateBinding = null;
      closeBoundFile(promotionBinding);
      promotionBinding = null;
      removePathWithoutFollowingLinks(promotionPath);
      promotionPath = null;
      throw new VerifiedGenerationError(
        'The target changed while generation was running; the concurrent edit was preserved.',
        {
          archivePath,
          verdict,
          failureStage: 'promotion-conflict',
          failureReason: 'promotion-conflict'
        }
      );
    }
    assertBoundRegularFileUnchanged(promotionBinding, 'Generated candidate promotion source');
    fs.renameSync(promotionPath, outPath);
    promotionPath = null;
    closeBoundFile(promotionBinding);
    promotionBinding = null;
    closeBoundFile(candidateBinding);
    candidateBinding = null;
    qualityFingerprint = acceptedGenerationQualityFingerprint({
      sourceSha256: candidateSha256,
      repairCount
    });
    let cachePromotion = { promoted: false, reason: 'no-cache-candidate' };
    if (generation.result?.cacheCandidate) {
      try {
        const cacheReference = await promoteCache(generation.result.cacheCandidate, {
          validationStatus: 'accepted',
          qualityFingerprint,
          outputSha256: candidateSha256
        });
        cachePromotion = cacheReference?.schemaVersion
          ? { promoted: true, reason: null, cacheReference }
          : { promoted: true, reason: null };
      } catch (error) {
        cachePromotion = { promoted: false, reason: 'cache-promotion-failed' };
        console.error(`[verified-generate] accepted-cache promotion skipped: ${error.message}`);
      }
    }

    const acceptedCacheReference = cachePromotion.cacheReference ?? generation.result?.cacheReference ?? null;
    if (acceptedCacheReference) {
      try {
        bindGenerationRunCacheReference(run, acceptedCacheReference);
      } catch (error) {
        try { await invalidateCache(acceptedCacheReference); } catch {}
        noteTelemetryFailure(error);
      }
    }

    safeRecordRunEvent({
      type: 'stage', stage: currentStage, status: 'completed', durationMs: Date.now() - promotionStartedAt
    });
    safeFinalizeGenerationRun({
      status: 'succeeded',
      quality: {
        reviewPassed: true,
        fastGatePassed: true,
        fullGatePassed: null,
        promotionGatePolicy: PROMOTION_GATE_POLICY,
        promotionGateRepeatEach: PROMOTION_GATE_REPEAT_EACH,
        qualityFingerprint,
        repairCount
      }
    });
    return { ...generation, outPath, candidatePath, verdict, cachePromotion, repairCount, runId: run.runId };
  } catch (error) {
    if (recordedAttempts === currentAttemptBaseline && error.singleFlightJoined === true) {
      safeRecordRunEvent({
        type: 'result-cache',
        stage: currentStage,
        status: 'failed',
        provider: error.provider ?? 'unknown',
        model: error.model ?? 'unknown',
        usage: {
          inputTokens: 0,
          uncachedInputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
          resultCacheHit: false,
          resultCacheStatus: 'single-flight-join',
          providerPromptCacheStatus: error.providerPromptCacheStatus ?? 'disabled',
          singleFlightJoined: true,
          savedTokens: 0
        }
      });
    } else if (
      recordedAttempts === currentAttemptBaseline
      && (error.usage !== undefined || error.provider || error.brain)
    ) {
      recordFallbackAttempts({
        usage: error.usage ?? null,
        brain: error.brain,
        provider: error.provider ?? error.brain?.kind ?? error.usage?.provider ?? 'unknown',
        model: error.model ?? error.brain?.model ?? error.usage?.model ?? 'unknown',
        retryCount: error.retryCount,
        status: error.failureReason === 'truncated'
          ? 'truncated'
          : error.failureReason === 'refused'
            ? 'refused'
            : error.failureReason === 'malformed-output'
              ? 'malformed'
              : 'failed',
        failureReason: error.failureReason ?? 'generation-failed',
        stage: currentStage,
        attemptsAtStart: currentAttemptBaseline
      });
    }
    const failureStage = error.failureStage ?? error.verdict?.stage ?? currentStage;
    const failureReason = failureStage === 'candidate-integrity'
      ? 'candidate-integrity'
      : failureStage === 'promotion-conflict'
        ? 'promotion-conflict'
        : currentStage === 'fast-gate' || error.verdict
          ? 'gate-rejected'
          : error.failureReason ?? `${currentStage}-failed`;
    qualityFingerprint ??= generationQualityFingerprint({
      sourceSha256: candidateSha256,
      outcome: 'rejected',
      stage: failureStage,
      reasonCode: error.verdict?.reasonCode ?? failureReason,
      repairCount
    });
    if (!run._finalized) {
      safeFinalizeGenerationRun({
        status: 'failed',
        failureStage,
        failureReason,
        quality: {
          reviewPassed: failureStage === 'static-review' ? false : null,
          fastGatePassed: currentStage === 'fast-gate' || error.verdict ? false : gatePassed,
          fullGatePassed: null,
          promotionGatePolicy: PROMOTION_GATE_POLICY,
          promotionGateRepeatEach: PROMOTION_GATE_REPEAT_EACH,
          qualityFingerprint,
          repairCount
        }
      });
    }
    closeBoundFile(candidateBinding);
    closeBoundFile(promotionBinding);
    try { removePathWithoutFollowingLinks(candidatePath); } catch {}
    if (promotionPath) {
      try { removePathWithoutFollowingLinks(promotionPath); } catch {}
    }
    throw error;
  }
}

function recordSuccessfulGeneration(generation, args) {
  const updated = recordGenerationInManifest({
    promptPath: generation.promptPath,
    outPath: args.out,
    brain: generation.result.brain,
    usage: generation.result.usage,
    runId: generation.runId
  });
  if (!updated) {
    recordStandaloneGenerationManifest({
      promptPath: generation.promptPath,
      outPath: args.out,
      brain: generation.result.brain,
      usage: generation.result.usage,
      runId: generation.runId
    });
  }
}

async function runCli() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: node scripts/ai/verified-generate.mjs (--spec <spec.md> | <generation-task.md>) --out <target.spec.ts>');
    return;
  }
  let args;
  try {
    args = parseGenerationArgs(process.argv.slice(2));
    if (!(args.task ?? args.spec) || !args.out) throw new Error('Missing generation input or --out target.');
    const generation = await runVerifiedGeneration({
      taskPath: args.task,
      specPath: args.spec,
      out: args.out,
      mode: args.mode,
      domArtifactPath: args.domArtifact
    });
    recordSuccessfulGeneration(generation, args);
    console.log(`Generated test accepted and promoted: ${args.out}`);
    console.log(formatGenerationRunIdLine(generation.runId));
  } catch (error) {
    console.error(error.message);
    if (error.archivePath) console.error(`Rejected candidate preserved at: ${error.archivePath}`);
    process.exitCode = 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  await runCli();
}
