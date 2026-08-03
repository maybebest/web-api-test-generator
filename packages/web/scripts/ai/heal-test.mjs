#!/usr/bin/env node

// Flag-gated auto-healer for committed Playwright tests. With
// AI_AUTOHEAL_ENABLED=true it runs the target test, and when the test fails at
// runtime it asks the heal brain for a repaired file, verifies the candidate
// with consecutive green runs (--repeat-each, --retries=0), and archives a
// proposal by default. Only explicit apply mode atomically promotes a verified
// candidate over the original; every attempt is archived under
// .ai-runs/heal/<run-id>/ for evidence.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import {
  buildPlaywrightStage,
  normalizePlaywrightTarget,
  playwrightFailureStage,
  readJsonReportVerdict
} from './generated-test-gate.mjs';
import { reviewGeneratedTest } from './review-generated-test.mjs';
import { reviewRecordedTest } from './review-recorded-test.mjs';
import { isPendingGenerationSpec, validateSpecDirectory } from './validate-flow-spec.mjs';
import { resolveEnv } from './lib/ai-client.mjs';
import { executeGeneratedPair } from './lib/generated-gate-runner.mjs';
import { ensureVerifiedDirectory, readVerifiedJsonFile } from './lib/verified-file-read.mjs';
import { buildGateEnvironment, knownSecretEnvValues } from './lib/gate-environment.mjs';
import { resolveHealContract, reviewHealContract } from './lib/test-heal-contract.mjs';
import { collectHealContext } from './lib/test-heal-context.mjs';
import { triageRuntimeFailure } from './lib/test-heal-triage.mjs';
import { redactSecretMaterial } from './lib/secret-safety.mjs';
import {
  MAX_AUTOHEAL_MAX_ATTEMPTS,
  MAX_HEAL_EVIDENCE_ITEMS,
  autoHealEnabled,
  autoHealMaxAttempts,
  autoHealVerifyRuns,
  extractRuntimeFailureEvidence,
  healTestSource,
  redactKnownSecretValues,
  verifyHealedSourcePolicy
} from './lib/test-heal.mjs';

// Must mirror localFixtureSpecPattern in playwright.config.ts (smoke,
// accessibility, visual, recorded all run under the local-chromium project).
const LOCAL_FIXTURE_TARGET = /^tests\/(?:smoke|accessibility|visual|recorded)\/.+\.spec\.ts$/;
const MAX_HEAL_ARCHIVE_FILE_BYTES = 1024 * 1024;
const AUDIT_USAGE_FIELDS = [
  'inputTokens',
  'uncachedInputTokens',
  'outputTokens',
  'cachedTokens',
  'cacheWriteTokens',
  'reasoningTokens',
  'totalTokens',
  'retryTokens',
  'retryCount',
  'requestCount'
];

export function parseArgs(argv) {
  const args = {
    tests: [],
    spec: undefined,
    specDir: 'specs',
    project: undefined,
    maxAttempts: undefined,
    verifyRuns: undefined,
    domSnapshot: undefined,
    apply: false,
    allowDirty: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const consumeValue = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${flag} requires a value.`);
      }
      index += 1;
      return value;
    };
    if (flag === '--help' || flag === '-h') args.help = true;
    else if (flag === '--test') args.tests.push(consumeValue());
    else if (flag === '--spec') args.spec = consumeValue();
    else if (flag === '--dir') args.specDir = consumeValue();
    else if (flag === '--project') args.project = consumeValue();
    else if (flag === '--max-attempts') args.maxAttempts = consumeValue();
    else if (flag === '--verify-runs') args.verifyRuns = consumeValue();
    else if (flag === '--dom-snapshot') args.domSnapshot = consumeValue();
    else if (flag === '--apply') args.apply = true;
    else if (flag === '--allow-dirty') args.allowDirty = true;
    else throw new Error(`Unknown flag: ${flag}`);
  }
  if (args.allowDirty && !args.apply) {
    throw new Error('--allow-dirty requires --apply.');
  }
  if (args.spec !== undefined && args.tests.length !== 1) {
    throw new Error('--spec requires exactly one --test target.');
  }
  return args;
}

function normalizePortablePath(value) {
  return String(value ?? '').split(path.sep).join('/').replace(/\\/g, '/');
}

export function discoverSpecForTest(testPath, specDir, {
  validateDirectory = validateSpecDirectory
} = {}) {
  const directoryResult = validateDirectory(specDir);
  if (!directoryResult.valid) {
    throw new Error(
      `Spec directory ${specDir} failed validation; fix it or pass --spec explicitly: ${(directoryResult.issues ?? []).join(' ')}`
    );
  }
  const matches = [];
  for (const { specPath, result: validation } of directoryResult.results) {
    if (isPendingGenerationSpec(validation.metadata)) continue;
    const target = normalizePortablePath(validation.metadata['Target Test File']);
    if (target === testPath) matches.push({ specPath, validation });
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple specs claim target ${testPath}: ${matches.map((match) => match.specPath).join(', ')}.`
    );
  }
  return matches[0] ?? null;
}

export function inferStandaloneProject(testPath) {
  if (LOCAL_FIXTURE_TARGET.test(testPath)) return 'local-chromium';
  if (testPath.endsWith('.authenticated.spec.ts')) return 'chromium-auth';
  return 'chromium';
}

export function healCandidatePath(targetPath, attemptId) {
  const authenticatedSuffix = '.authenticated.spec.ts';
  const suffix = targetPath.endsWith(authenticatedSuffix) ? authenticatedSuffix : '.spec.ts';
  const base = path.basename(targetPath, suffix);
  const safeId = String(attemptId).replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 60) || 'heal';
  return path.join(path.dirname(targetPath), `.${base}.heal-${safeId}.candidate${suffix}`);
}

function defaultCommandRunner(stage) {
  console.log(`$ ${stage.command} ${stage.args.join(' ')}`);
  const result = spawnSync(stage.command, stage.args, {
    stdio: 'inherit',
    shell: false,
    env: stage.env
  });
  if (result.error) {
    console.error(result.error.message);
    return 2;
  }
  if (result.signal || result.status === null) {
    console.error(`Command terminated abnormally${result.signal ? ` (${result.signal})` : ''}.`);
    return 2;
  }
  return result.status;
}

function detectPackageManager(rootDir) {
  if (fs.existsSync(path.resolve(rootDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.resolve(rootDir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

// Single-project verification lane for tests that are not bound to a flow spec.
// Mirrors executeGeneratedPair's per-project contract: JSON report verified for
// the exact repeat count with retries=0, flaky or skipped outcomes fail.
export function executeStandaloneTarget({
  testPath,
  project,
  repeatEach,
  env,
  webRoot = process.cwd(),
  runRoot,
  commandRunner = defaultCommandRunner,
  packageManager = detectPackageManager(webRoot)
}) {
  const resolvedRunRoot = path.resolve(runRoot ?? path.join(webRoot, '.ai-runs'));
  const runDir = path.join(
    resolvedRunRoot,
    `heal-verify-${Date.now()}-${process.pid}-${crypto.randomUUID()}`
  );
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const jsonReportPath = path.join(runDir, 'playwright.json');
  const htmlReportDir = path.join(runDir, 'html');
  const testResultsDir = path.join(runDir, 'test-results');
  const stage = buildPlaywrightStage({
    packageManager,
    testPath,
    project,
    jsonReportPath,
    htmlReportDir,
    testResultsDir,
    repeatEach
  });
  const profile = project === 'local-chromium' ? 'local-runtime' : 'external-runtime';
  const status = commandRunner({
    ...stage,
    // Serial execution keeps "N consecutive runs" literal for repeat-each.
    args: [...stage.args, '--workers=1'],
    kind: 'playwright',
    project,
    env: {
      ...buildGateEnvironment(env, { profile }),
      ...stage.env
    }
  });
  const verdict = readJsonReportVerdict(jsonReportPath, testPath, undefined, {
    project,
    repeatEach,
    retries: 0
  });
  const passed = status === 0 && verdict.passed === true;
  if (passed) {
    fs.rmSync(runDir, { recursive: true, force: true });
    return { passed: true, attempted: true, stage: 'accepted', issues: [], artifacts: [], runDir: undefined };
  }
  return {
    passed: false,
    attempted: true,
    stage: playwrightFailureStage(status, verdict),
    issues: verdict.issues ?? [`Playwright exited ${status} for ${testPath}.`],
    artifacts: [{ project, jsonReportPath, htmlReportDir, testResultsDir }],
    runDir
  };
}

export function collectRuntimeEvidence(execution, targetTestFile, {
  secretValues = [],
  readReport = (reportPath) => readVerifiedJsonFile({
    filePath: reportPath,
    rootPath: path.dirname(reportPath),
    maxBytes: 32 * 1024 * 1024,
    label: 'Playwright JSON report'
  })
} = {}) {
  const evidence = [];
  for (const artifact of execution.artifacts ?? []) {
    if (!artifact?.jsonReportPath) continue;
    try {
      const report = readReport(artifact.jsonReportPath);
      evidence.push(...extractRuntimeFailureEvidence(report, targetTestFile, { secretValues }));
    } catch {
      // A missing or unreadable report falls back to structural gate issues.
    }
  }
  for (const issue of execution.issues ?? []) {
    if (evidence.length >= MAX_HEAL_EVIDENCE_ITEMS) break;
    evidence.push(redactKnownSecretValues(String(issue), secretValues));
  }
  return evidence.slice(0, MAX_HEAL_EVIDENCE_ITEMS);
}

// Verification runs can leave traces/screenshots that may embed tokens. Once
// their evidence has been distilled into sanitized text, the run directory is
// deleted so nothing credential-bearing lingers under .ai-runs.
function cleanupFailedRunDir(execution, runRoot) {
  const runDir = execution?.runDir;
  if (!runDir) return;
  const resolved = path.resolve(runDir);
  if (!resolved.startsWith(`${path.resolve(runRoot)}${path.sep}`)) return;
  fs.rmSync(resolved, { recursive: true, force: true });
}

// The generated-test gates typecheck candidates via their global static stage;
// the healer must not promote a candidate that fails tsc. The candidate is a
// dot-prefixed file that project globs skip, so it is checked in-process by
// building the project program with the candidate substituted for the target.
export function typecheckCandidate({ candidatePath, targetPath, webRoot = process.cwd() }) {
  const configPath = path.join(webRoot, 'tsconfig.json');
  let parsed;
  try {
    parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
      }
    });
  } catch (error) {
    return { passed: false, issues: [`tsconfig.json could not be parsed: ${error.message}`] };
  }
  if (!parsed) {
    return { passed: false, issues: ['tsconfig.json could not be parsed.'] };
  }
  const resolvedTarget = path.resolve(targetPath);
  const rootNames = parsed.fileNames.filter((fileName) => path.resolve(fileName) !== resolvedTarget);
  rootNames.push(path.resolve(candidatePath));
  const program = ts.createProgram({ rootNames, options: { ...parsed.options, noEmit: true } });
  const sourceFile = program.getSourceFile(path.resolve(candidatePath));
  if (!sourceFile) {
    return { passed: false, issues: ['The heal candidate was not loadable for typechecking.'] };
  }
  const diagnostics = [
    ...program.getSyntacticDiagnostics(sourceFile),
    ...program.getSemanticDiagnostics(sourceFile)
  ];
  return {
    passed: diagnostics.length === 0,
    issues: diagnostics.slice(0, MAX_HEAL_EVIDENCE_ITEMS).map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
      const position = diagnostic.file && diagnostic.start !== undefined
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
        : undefined;
      return position ? `TS${diagnostic.code} at ${position.line + 1}:${position.character + 1}: ${message}` : `TS${diagnostic.code}: ${message}`;
    })
  };
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function snapshotFromStat(stat, digest) {
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    sha256: digest
  });
}

function snapshotsEqual(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.sha256 === right.sha256;
}

function captureTargetSnapshot(absoluteTarget) {
  const pathBefore = fs.lstatSync(absoluteTarget);
  if (pathBefore.isSymbolicLink() || !pathBefore.isFile()) {
    throw new Error(`Heal target must remain a regular file: ${absoluteTarget}`);
  }
  const descriptor = fs.openSync(absoluteTarget, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile()
      || !snapshotsEqual(snapshotFromStat(pathBefore, ''), snapshotFromStat(opened, ''))) {
      throw new Error(`Heal target changed while its starting snapshot was opened: ${absoluteTarget}`);
    }
    const bytes = fs.readFileSync(descriptor);
    const openedAfter = fs.fstatSync(descriptor);
    const pathAfter = fs.lstatSync(absoluteTarget);
    const digest = sha256(bytes);
    const snapshot = snapshotFromStat(opened, digest);
    if (pathAfter.isSymbolicLink() || !pathAfter.isFile()
      || bytes.length !== opened.size
      || !snapshotsEqual(snapshot, snapshotFromStat(openedAfter, digest))
      || !snapshotsEqual(snapshot, snapshotFromStat(pathAfter, digest))) {
      throw new Error(`Heal target changed while its starting snapshot was captured: ${absoluteTarget}`);
    }
    return { bytes, mode: opened.mode & 0o777, snapshot };
  } finally {
    fs.closeSync(descriptor);
  }
}

export function gitTargetDirty(target, webRoot = process.cwd()) {
  const result = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all', '--', target], {
    cwd: webRoot,
    encoding: 'utf8',
    shell: false
  });
  if (result.status !== 0) throw new Error('Could not determine heal target Git status.');
  return result.stdout.trim().length > 0;
}

export function lintCandidate({
  candidatePath,
  webRoot = process.cwd(),
  commandRunner = spawnSync,
  packageManager = detectPackageManager(webRoot)
}) {
  const packageArgs = packageManager === 'npm'
    ? ['exec', '--', 'eslint']
    : ['exec', 'eslint'];
  const result = commandRunner(packageManager, [
    ...packageArgs,
    '--no-ignore',
    '--max-warnings=0',
    candidatePath
  ], {
    cwd: webRoot,
    encoding: 'utf8',
    maxBuffer: MAX_HEAL_ARCHIVE_FILE_BYTES,
    shell: false
  });
  if (result.status === 0) return { passed: true, issues: [] };
  const output = [result.stdout, result.stderr, result.error?.message]
    .filter(Boolean)
    .join('\n')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_HEAL_EVIDENCE_ITEMS);
  return { passed: false, issues: output.length > 0 ? output : ['ESLint did not accept the heal candidate.'] };
}

function assertHealableTarget(absoluteTarget, webRoot) {
  const testsRoot = path.join(webRoot, 'tests');
  if (!fs.existsSync(absoluteTarget)) {
    throw new Error(`Heal target does not exist: ${absoluteTarget}`);
  }
  const stat = fs.lstatSync(absoluteTarget);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Heal target must be a regular file: ${absoluteTarget}`);
  }
  const realTarget = fs.realpathSync(absoluteTarget);
  const realTestsRoot = fs.realpathSync(testsRoot);
  const relative = path.relative(realTestsRoot, realTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Heal target must live inside the tests directory: ${absoluteTarget}`);
  }
  return stat;
}

function createHealArchive(webRoot, runId) {
  const directory = path.join(webRoot, '.ai-runs', 'heal', runId);
  ensureVerifiedDirectory(directory, 'Test-heal audit directory', 0o700);
  fs.chmodSync(directory, 0o700);
  return {
    directory,
    write(fileName, contents) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fileName)) {
        throw new Error(`Invalid test-heal audit file name: ${fileName}`);
      }
      const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(String(contents), 'utf8');
      if (bytes.length > MAX_HEAL_ARCHIVE_FILE_BYTES) {
        throw new Error(`Test-heal audit file exceeds ${MAX_HEAL_ARCHIVE_FILE_BYTES} bytes: ${fileName}`);
      }
      const archivePath = path.join(directory, fileName);
      fs.writeFileSync(archivePath, bytes, { flag: 'wx', mode: 0o600 });
      fs.chmodSync(archivePath, 0o600);
      return archivePath;
    }
  };
}

function auditText(value, secretValues) {
  const knownRedacted = redactKnownSecretValues(String(value ?? ''), secretValues);
  return redactSecretMaterial(knownRedacted).slice(0, 2_000);
}

function auditAttemptTrail(attemptTrail, secretValues) {
  return attemptTrail.map((entry) => ({
    attempt: entry.attempt,
    outcome: entry.outcome,
    ...(entry.checks ? { checks: { ...entry.checks } } : {}),
    ...(entry.detail ? { detail: auditText(entry.detail, secretValues) } : {})
  }));
}

function sanitizedEvidenceList(value, secretValues) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_HEAL_EVIDENCE_ITEMS)
    .map((item) => auditText(item, secretValues).trim())
    .filter(Boolean);
}

function structuredProviderAudit(healed, attempt, secretValues) {
  const result = healed?.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const record = { attempt };
  const brain = result.brain;
  if (brain && typeof brain === 'object' && !Array.isArray(brain)) {
    if (typeof brain.kind === 'string' && brain.kind.trim()) record.kind = auditText(brain.kind, secretValues);
    if (typeof brain.model === 'string' && brain.model.trim()) record.model = auditText(brain.model, secretValues);
  }
  const usage = {};
  if (result.usage && typeof result.usage === 'object' && !Array.isArray(result.usage)) {
    for (const field of AUDIT_USAGE_FIELDS) {
      const value = result.usage[field];
      if (value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)) {
        usage[field] = value;
      }
    }
  }
  if (Object.keys(usage).length > 0) record.usage = usage;
  return Object.keys(record).length > 1 ? record : null;
}

function candidateDiff({ archiveOriginalPath, candidateAbsolute, webRoot }) {
  const result = spawnSync('git', [
    'diff', '--no-index', '--no-ext-diff', '--unified=3', '--',
    archiveOriginalPath, candidateAbsolute
  ], { cwd: webRoot, encoding: 'utf8', maxBuffer: MAX_HEAL_ARCHIVE_FILE_BYTES, shell: false });
  if (result.status === 1 && !result.error) return { passed: true, diff: result.stdout };
  if (result.status === 0 && !result.error) {
    return { passed: false, outcome: 'no-change', issues: ['The heal candidate does not change the target.'] };
  }
  return {
    passed: false,
    outcome: 'diff-rejected',
    issues: [`Could not produce a bounded candidate diff${result.error?.message ? `: ${result.error.message}` : '.'}`]
  };
}

export function isSuccessfulHealStatus(status) {
  return status === 'already-green' || status === 'proposal-ready' || status === 'healed';
}

// Removes stale heal candidates for this target left behind by a hard crash,
// so ordinary suite runs never pick up an unreviewed candidate.
function sweepStaleHealCandidates(absoluteTarget, log) {
  const authenticatedSuffix = '.authenticated.spec.ts';
  const suffix = absoluteTarget.endsWith(authenticatedSuffix) ? authenticatedSuffix : '.spec.ts';
  const base = path.basename(absoluteTarget, suffix);
  const directory = path.dirname(absoluteTarget);
  for (const entry of fs.readdirSync(directory)) {
    if (entry.startsWith(`.${base}.heal-`) && entry.endsWith('.spec.ts')) {
      fs.rmSync(path.join(directory, entry), { force: true });
      log(`[heal] removed stale heal candidate ${entry}.`);
    }
  }
}

export async function healSingleTest({
  testPath,
  specPath: explicitSpecPath,
  specDir = 'specs',
  project,
  env = process.env,
  maxAttempts,
  verifyRuns,
  apply = false,
  allowDirty = false,
  webRoot = process.cwd(),
  signal,
  log = (message) => console.log(message),
  discoverSpec = discoverSpecForTest,
  executePair = executeGeneratedPair,
  executeStandalone = executeStandaloneTarget,
  reviewer = undefined,
  generatedReviewer = reviewer ?? reviewGeneratedTest,
  recordedReviewer = reviewRecordedTest,
  heal = healTestSource,
  typecheck = typecheckCandidate,
  lint = lintCandidate,
  targetDirty = gitTargetDirty,
  collectEvidence = collectRuntimeEvidence,
  archiveFactory = createHealArchive,
  validateDirectory = validateSpecDirectory,
  domSnapshotPath,
  collectContext = collectHealContext,
  resolveContract = resolveHealContract,
  reviewContract = reviewHealContract
}) {
  if (!autoHealEnabled(env)) {
    throw new Error('Auto-heal is disabled; set AI_AUTOHEAL_ENABLED=true to allow the healer to generate a repair proposal.');
  }
  if (allowDirty && !apply) {
    throw new Error('allowDirty requires apply=true.');
  }
  const attemptsBudget = maxAttempts ?? autoHealMaxAttempts(env);
  const repeatEach = verifyRuns ?? autoHealVerifyRuns(env);
  // Canonicalize to a repo-relative POSIX target first: spec discovery compares
  // against repo-relative metadata and project inference anchors on tests/, so
  // an absolute --test path must not silently change behavior.
  const absoluteTarget = path.resolve(webRoot, String(testPath ?? ''));
  const relativeTarget = normalizePortablePath(path.relative(webRoot, absoluteTarget));
  if (!relativeTarget || relativeTarget.startsWith('..')) {
    throw new Error(`Heal target must live inside ${webRoot}: ${testPath}`);
  }
  const target = normalizePlaywrightTarget(relativeTarget);
  assertHealableTarget(absoluteTarget, webRoot);
  sweepStaleHealCandidates(absoluteTarget, log);
  const startingTarget = captureTargetSnapshot(absoluteTarget);
  const originalBytes = startingTarget.bytes;
  const originalSource = originalBytes.toString('utf8');
  const originalSha = startingTarget.snapshot.sha256;
  const runRoot = path.join(webRoot, '.ai-runs');
  const runId = `${Date.now()}-${process.pid}-${crypto.randomUUID()}`;
  const secretValues = knownSecretEnvValues(env);

  const contract = resolveContract({
    testPath: target,
    source: originalSource,
    explicitSpecPath,
    specDir,
    discoverSpec,
    validateDirectory,
    webRoot
  });

  // Apply mode is the only mode that can overwrite the target. Refuse a dirty
  // starting target before running browsers or invoking a provider unless the
  // caller explicitly accepted that starting condition.
  if (apply && !allowDirty && targetDirty(target, webRoot)) {
    return {
      status: 'dirty-target',
      target,
      attemptsUsed: 0,
      issues: [`${target} has uncommitted Git changes; rerun with --allow-dirty only if applying over them is intentional.`]
    };
  }

  const resolvedProject = project ?? inferStandaloneProject(target);
  // executeGeneratedPair returns the execution shape directly:
  // { passed, attempted, stage, issues, artifacts, runDir }.
  const runVerification = (pathToRun) => (contract.kind === 'spec'
    ? executePair(
        { specPath: contract.specPath, testPath: pathToRun, validation: contract.validation },
        { repeatEach, env, runRoot }
      )
    : executeStandalone({ testPath: pathToRun, project: resolvedProject, repeatEach, env, webRoot, runRoot }));

  const contractDescription = contract.kind === 'spec'
    ? `spec-bound via ${contract.specPath}`
    : contract.kind === 'recording'
      ? `recording-bound via ${contract.recordingPath}; standalone project ${resolvedProject}`
      : `handwritten; standalone project ${resolvedProject}`;
  log(`[heal] ${target}: baseline verification (${repeatEach} consecutive runs, retries=0, ${contractDescription}).`);
  let execution = runVerification(target);
  if (execution.passed) {
    cleanupFailedRunDir(execution, runRoot);
    return { status: 'already-green', target, attemptsUsed: 0 };
  }
  if (execution.stage === 'runtime-environment') {
    cleanupFailedRunDir(execution, runRoot);
    return {
      status: 'environment-failure',
      target,
      attemptsUsed: 0,
      issues: execution.issues,
      detail: 'Baseline run failed for environment reasons; healing would mask an infrastructure problem.'
    };
  }

  const archive = archiveFactory(webRoot, runId);
  const archiveOriginalPath = archive.write('original.ts', originalBytes);
  let currentSource = originalSource;
  let evidence = sanitizedEvidenceList(collectEvidence(execution, target, { secretValues }), secretValues);
  cleanupFailedRunDir(execution, runRoot);
  const triage = triageRuntimeFailure({ evidence, stage: execution.stage });
  const attemptTrail = [];
  const providerAttempts = [];
  let promptSchema;
  const finish = (result) => {
    archive.write('heal-summary.json', `${JSON.stringify({
      schema: 'test-heal-run/v1',
      runId,
      target,
      contractKind: contract.kind,
      status: result.status,
      attemptsUsed: result.attemptsUsed,
      verifyRuns: repeatEach,
      originalSha256: originalSha,
      ...(result.candidateSha256 ? { candidateSha256: result.candidateSha256 } : {}),
      triage,
      ...(promptSchema ? { promptSchema } : {}),
      providerAttempts,
      mode: { apply, allowDirty },
      attemptTrail: auditAttemptTrail(attemptTrail, secretValues)
    }, null, 2)}\n`);
    return { ...result, target, archiveDir: archive.directory, attemptTrail };
  };
  archive.write('evidence.json', `${JSON.stringify({
    schema: 'test-heal-evidence/v1',
    evidence,
    triage
  }, null, 2)}\n`);
  if (!triage.repairable) {
    return finish({ status: 'not-repairable', attemptsUsed: 0, issues: triage.reasonCodes, triage });
  }

  const repositoryContext = collectContext({
    testPath: target,
    source: originalSource,
    evidence,
    webRoot,
    domSnapshotPath,
    secretValues
  });
  let notes = [];

  // A crash must not leave an unreviewed candidate inside tests/ where normal
  // suite runs would execute it.
  let activeCandidate = null;
  const removeActiveCandidate = () => {
    if (activeCandidate) fs.rmSync(activeCandidate, { force: true });
  };
  const onSignal = (signalName) => {
    removeActiveCandidate();
    process.exit(signalName === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    for (let attempt = 1; attempt <= attemptsBudget; attempt += 1) {
      log(`[heal] ${target}: attempt ${attempt}/${attemptsBudget}.`);
      const checks = {};
      const recordAttempt = (outcome, detail) => {
        attemptTrail.push({
          attempt,
          outcome,
          ...(Object.keys(checks).length > 0 ? { checks: { ...checks } } : {}),
          ...(detail ? { detail } : {})
        });
      };
      let healed;
      try {
        healed = await heal({
          testPath: target,
          source: currentSource,
          evidence,
          notes,
          attempt,
          maxAttempts: attemptsBudget,
          repositoryContext,
          env,
          signal
        });
      } catch (error) {
        recordAttempt('brain-error', error.message);
        return finish({ status: 'brain-error', attemptsUsed: attempt, issues: [error.message] });
      }
      const providerAudit = structuredProviderAudit(healed, attempt, secretValues);
      if (providerAudit) providerAttempts.push(providerAudit);
      if (typeof healed.promptSchema === 'string' && healed.promptSchema.trim()) {
        promptSchema = auditText(healed.promptSchema, secretValues);
      }

      // The ORIGINAL source is the immutable baseline for every attempt, so a
      // later attempt cannot ratchet the rules by comparing against an earlier
      // (already accepted-for-iteration) candidate.
      const policy = verifyHealedSourcePolicy({ previousSource: originalSource, healedSource: healed.code });
      checks.policy = policy.passed ? 'passed' : 'rejected';
      if (!policy.passed) {
        const secretRelated = policy.issues.some((issue) => /secret/i.test(issue));
        archive.write(
          secretRelated ? `attempt-${attempt}.rejected-policy.txt` : `attempt-${attempt}.rejected-policy.ts`,
          secretRelated ? policy.issues.join('\n') : healed.code
        );
        recordAttempt('policy-rejected', policy.issues.join(' '));
        log(`[heal] ${target}: attempt ${attempt} rejected by deterministic policy guard: ${policy.issues.join(' ')}`);
        notes = policy.issues;
        continue;
      }

      const candidateAbsolute = healCandidatePath(absoluteTarget, `${runId}-a${attempt}`);
      const candidateRelative = normalizePortablePath(path.relative(webRoot, candidateAbsolute));
      fs.writeFileSync(candidateAbsolute, healed.code, { flag: 'wx', mode: 0o600 });
      activeCandidate = candidateAbsolute;
      try {
        const types = typecheck({ candidatePath: candidateAbsolute, targetPath: absoluteTarget, webRoot });
        checks.typecheck = types.passed ? 'passed' : 'rejected';
        if (!types.passed) {
          archive.write(`attempt-${attempt}.rejected-typecheck.ts`, healed.code);
          recordAttempt('typecheck-rejected', types.issues.join(' '));
          log(`[heal] ${target}: attempt ${attempt} rejected by typecheck.`);
          notes = types.issues.slice(0, MAX_HEAL_EVIDENCE_ITEMS);
          continue;
        }

        const lintResult = lint({ candidatePath: candidateAbsolute, targetPath: absoluteTarget, webRoot });
        checks.lint = lintResult.passed ? 'passed' : 'rejected';
        if (!lintResult.passed) {
          archive.write(`attempt-${attempt}.rejected-lint.ts`, healed.code);
          recordAttempt('lint-rejected', lintResult.issues.join(' '));
          log(`[heal] ${target}: attempt ${attempt} rejected by lint.`);
          notes = lintResult.issues.slice(0, MAX_HEAL_EVIDENCE_ITEMS);
          continue;
        }

        const review = reviewContract({
          contract,
          candidatePath: candidateRelative,
          generatedReviewer,
          recordedReviewer
        });
        checks.review = review.passed ? 'passed' : 'rejected';
        if (!review.passed) {
          archive.write(`attempt-${attempt}.rejected-review.ts`, healed.code);
          recordAttempt('static-review-rejected', review.issues.join(' '));
          log(`[heal] ${target}: attempt ${attempt} rejected by static review.`);
          notes = review.issues.slice(0, MAX_HEAL_EVIDENCE_ITEMS);
          continue;
        }

        execution = runVerification(candidateRelative);
        if (execution.passed) cleanupFailedRunDir(execution, runRoot);
        checks.runtime = execution.passed
          ? 'passed'
          : execution.stage === 'runtime-environment' ? 'environment-failure' : 'failed';
        if (execution.passed) {
          const candidateSha = sha256(Buffer.from(healed.code, 'utf8'));
          const candidateStillMatches = () => sha256(fs.readFileSync(candidateAbsolute)) === candidateSha;
          if (!candidateStillMatches()) {
            checks.candidateIntegrity = 'rejected';
            recordAttempt('aborted-candidate-mutation');
            return finish({
              status: 'aborted-candidate-mutation',
              attemptsUsed: attempt,
              issues: ['The healed candidate changed on disk during verification; it was not proposed or promoted.']
            });
          }
          checks.candidateIntegrity = 'passed';

          const diff = candidateDiff({ archiveOriginalPath, candidateAbsolute, webRoot });
          checks.diff = diff.passed ? 'passed' : 'rejected';
          if (!diff.passed) {
            archive.write(`attempt-${attempt}.rejected-${diff.outcome}.ts`, healed.code);
            recordAttempt(diff.outcome, diff.issues.join(' '));
            notes = diff.issues;
            continue;
          }
          if (!candidateStillMatches()) {
            checks.candidateIntegrity = 'rejected';
            recordAttempt('aborted-candidate-mutation');
            return finish({
              status: 'aborted-candidate-mutation',
              attemptsUsed: attempt,
              issues: ['The healed candidate changed while its proposal diff was produced; it was not proposed or promoted.']
            });
          }
          const candidateArchivePath = archive.write('candidate.ts', healed.code);
          const diffPath = archive.write('candidate.diff', diff.diff);

          if (repositoryContext.manualChangeRequired) {
            recordAttempt('manual-change-required');
            return finish({
              status: 'manual-change-required',
              attemptsUsed: attempt,
              candidateSha256: candidateSha,
              candidatePath: candidateArchivePath,
              diffPath,
              issues: ['Failure evidence points to a Page Object or Component owner; review the proposal and change the owning file manually.']
            });
          }

          if (!apply) {
            recordAttempt('proposal-ready');
            return finish({
              status: 'proposal-ready',
              attemptsUsed: attempt,
              candidateSha256: candidateSha,
              candidatePath: candidateArchivePath,
              diffPath
            });
          }

          if (!allowDirty && targetDirty(target, webRoot)) {
            checks.targetGit = 'dirty';
            recordAttempt('dirty-target');
            return finish({
              status: 'dirty-target',
              attemptsUsed: attempt,
              candidateSha256: candidateSha,
              candidatePath: candidateArchivePath,
              diffPath,
              issues: [`${target} became dirty while healing was running; the verified candidate was not promoted.`]
            });
          }
          checks.targetGit = allowDirty ? 'allowed-dirty' : 'clean';
          let currentTarget;
          try {
            currentTarget = captureTargetSnapshot(absoluteTarget).snapshot;
          } catch {
            currentTarget = null;
          }
          if (!currentTarget || !snapshotsEqual(currentTarget, startingTarget.snapshot)) {
            checks.targetSnapshot = 'changed';
            recordAttempt('aborted-concurrent-edit');
            return finish({
              status: 'aborted-concurrent-edit',
              attemptsUsed: attempt,
              candidateSha256: candidateSha,
              candidatePath: candidateArchivePath,
              diffPath,
              issues: [`${target} changed on disk while healing was running; the concurrent edit was preserved.`]
            });
          }
          checks.targetSnapshot = 'passed';
          if (!candidateStillMatches()) {
            checks.candidateIntegrity = 'rejected';
            recordAttempt('aborted-candidate-mutation');
            return finish({
              status: 'aborted-candidate-mutation',
              attemptsUsed: attempt,
              candidateSha256: candidateSha,
              candidatePath: candidateArchivePath,
              diffPath,
              issues: ['The healed candidate changed before atomic promotion; it was not promoted.']
            });
          }
          fs.renameSync(candidateAbsolute, absoluteTarget);
          activeCandidate = null;
          fs.chmodSync(absoluteTarget, startingTarget.mode);
          recordAttempt('healed');
          return {
            ...finish({
              status: 'healed',
              attemptsUsed: attempt,
              candidateSha256: candidateSha,
              candidatePath: candidateArchivePath,
              diffPath
            }),
            backupPath: archiveOriginalPath
          };
        }

        if (execution.stage === 'runtime-environment') {
          archive.write(`attempt-${attempt}.env-failure.ts`, healed.code);
          recordAttempt('environment-failure', (execution.issues ?? []).join(' '));
          cleanupFailedRunDir(execution, runRoot);
          return finish({ status: 'environment-failure', attemptsUsed: attempt, issues: execution.issues });
        }

        archive.write(`attempt-${attempt}.still-failing.ts`, healed.code);
        recordAttempt('still-failing', (execution.issues ?? []).slice(0, 2).join(' '));
        const freshEvidence = collectEvidence(execution, candidateRelative, { secretValues });
        cleanupFailedRunDir(execution, runRoot);
        evidence = sanitizedEvidenceList(
          Array.isArray(freshEvidence) && freshEvidence.length > 0 ? freshEvidence : (execution.issues ?? []),
          secretValues
        );
        notes = [`Attempt ${attempt} candidate still failed; the source below contains that prior candidate.`];
        currentSource = healed.code;
      } finally {
        removeActiveCandidate();
        activeCandidate = null;
      }
    }

    return finish({
      status: 'exhausted',
      attemptsUsed: attemptsBudget,
      issues: [`All ${attemptsBudget} heal attempts failed verification; the original test was left untouched.`]
    });
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

function printHelp() {
  console.log(`Usage:
  AI_AUTOHEAL_ENABLED=true node scripts/ai/heal-test.mjs --test <path/to/file.spec.ts> [--test <another.spec.ts> ...]
    [--spec <specs/flow.md>] [--dir specs] [--project <playwright-project>]
    [--max-attempts N] [--verify-runs N] [--dom-snapshot <.ai-runs/dom-discovery/...>]
    [--apply [--allow-dirty]]

Runs each target test first (baseline). A test that already passes the required consecutive
runs is reported as already-green and never modified. For a runtime failure the healer asks the
heal brain (stage 'heal', see AI_HEAL_* env) for a repaired file, rejects candidates that violate
the AST-level anti-masking policy (no removed/downgraded/conditional assertions, no skip family,
no sleeps or XPath) or fail typechecking/linting, and verifies survivors with consecutive green runs
(retries=0, flaky = fail; standalone lanes run --workers=1 so the runs are literally serial).
By default a verified candidate is archived as proposal-ready and the target remains unchanged.
Only --apply can atomically promote it over the original. Every attempt and the original file are
archived under .ai-runs/heal/<run-id>/.

Settings:
  AI_AUTOHEAL_ENABLED       must be true to generate a repair proposal (default false)
  AI_AUTOHEAL_MAX_ATTEMPTS  heal attempts per test, 1..${MAX_AUTOHEAL_MAX_ATTEMPTS} (default 3); --max-attempts overrides.
                            Policy/typecheck/lint/review rejections consume attempts too.
  AI_AUTOHEAL_VERIFY_RUNS   consecutive green runs required, 2 or 3 (default 2); --verify-runs overrides
  --dom-snapshot            optional verified DOM artifact below .ai-runs/dom-discovery
  --apply                   promote a fully verified single-file candidate
  --allow-dirty             permit --apply over a target already dirty at start; requires --apply

Environment failures (missing browser, broken config, unreadable report) abort healing instead of
masking infrastructure problems. Spec-bound targets are additionally re-checked by the static
reviewer, so a heal can never weaken the locator policy or drop the traceability header.
Recorded/smoke/accessibility/visual targets run under local-chromium automatically; use
--project to override the inferred project for other layouts.`);
}

async function runCli() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    printHelp();
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    printHelp();
    return;
  }
  if (args.tests.length === 0) {
    console.error('At least one --test target is required.');
    printHelp();
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(path.resolve('playwright.config.ts'))) {
    console.error('Run the healer from the packages/web directory (playwright.config.ts not found in cwd).');
    process.exitCode = 1;
    return;
  }

  const resolvedEnvironment = resolveEnv(process.env);
  const env = resolvedEnvironment.env;
  let maxAttempts;
  let verifyRuns;
  try {
    if (!autoHealEnabled(env)) {
      console.error('Auto-heal is disabled; set AI_AUTOHEAL_ENABLED=true (environment or .env) to allow a repair proposal.');
      process.exitCode = 1;
      return;
    }
    maxAttempts = args.maxAttempts !== undefined
      ? autoHealMaxAttempts({ AI_AUTOHEAL_MAX_ATTEMPTS: args.maxAttempts })
      : autoHealMaxAttempts(env);
    verifyRuns = args.verifyRuns !== undefined
      ? autoHealVerifyRuns({ AI_AUTOHEAL_VERIFY_RUNS: args.verifyRuns })
      : autoHealVerifyRuns(env);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const testPath of args.tests) {
    try {
      const result = await healSingleTest({
        testPath,
        specPath: args.spec,
        specDir: args.specDir,
        project: args.project,
        env,
        maxAttempts,
        verifyRuns,
        apply: args.apply,
        allowDirty: args.allowDirty,
        domSnapshotPath: args.domSnapshot,
        webRoot: process.cwd()
      });
      results.push(result);
    } catch (error) {
      results.push({ status: 'error', target: testPath, attemptsUsed: 0, issues: [error.message] });
    }
  }

  let allGreen = true;
  for (const result of results) {
    const suffix = result.attemptsUsed > 0 ? ` after ${result.attemptsUsed} attempt(s)` : '';
    if (result.status === 'healed') {
      console.log(`HEALED ${result.target}${suffix}. Backup: ${result.backupPath}`);
    } else if (result.status === 'proposal-ready') {
      console.log(`PROPOSAL READY ${result.target}${suffix} (target unchanged). Diff: ${result.diffPath}. Archive: ${result.archiveDir}`);
    } else if (result.status === 'already-green') {
      console.log(`ALREADY GREEN ${result.target} (no changes made).`);
    } else {
      console.error(`NOT HEALED ${result.target} (${result.status})${suffix}.`);
      for (const issue of result.issues ?? []) console.error(`- ${issue}`);
      if (result.archiveDir) console.error(`  Evidence: ${result.archiveDir}`);
    }
    if (!isSuccessfulHealStatus(result.status)) allGreen = false;
  }
  process.exitCode = allGreen ? 0 : 1;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  await runCli();
}
