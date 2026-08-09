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
} from '../generated-test-gate.mjs';
import { reviewGeneratedTest } from '../review-generated-test.mjs';
import { reviewRecordedTest } from '../review-recorded-test.mjs';
import { isPendingGenerationSpec, validateSpecDirectory } from '../validate-flow-spec.mjs';
import { resolveEnv } from '../lib/ai-client.mjs';
import { executeGeneratedPair } from '../lib/generated-gate-runner.mjs';
import {
  ensureVerifiedDirectory,
  readVerifiedJsonFile,
  verifiedDirectory
} from '../lib/verified-file-read.mjs';
import { buildGateEnvironment, knownSecretEnvValues } from '../lib/gate-environment.mjs';
import { resolveHealContract, reviewHealContract } from './test-heal-contract.mjs';
import { collectHealContext } from './test-heal-context.mjs';
import {
  HEAL_DOM_EVIDENCE_CLASSIFICATIONS,
  buildHealDomEvidence,
  collectFailureAttachments,
  extractPageSnapshotLines,
  extractTestidCandidatesFromTrace,
  readZipTextEntries
} from './test-heal-dom-evidence.mjs';
import { verifyScopedRoleEvidence } from './test-heal-scoped-role.mjs';
import { triageRuntimeFailure } from './test-heal-triage.mjs';
import { containsSecretLikeValue, redactSecretMaterial } from '../lib/secret-safety.mjs';
import {
  canonicalContractTestPath,
  testSuiteRootForPath,
  withTestSuiteRoot
} from '../lib/test-suite-root.mjs';
import {
  MAX_AUTOHEAL_MAX_ATTEMPTS,
  MAX_HEAL_EVIDENCE_ITEMS,
  MAX_HEAL_SOURCE_BYTES,
  analyzeHealSource,
  autoHealEnabled,
  autoHealMaxAttempts,
  autoHealVerifyRuns,
  buildHealRejectionDigest,
  extractRuntimeFailureEvidence,
  healTestSource,
  normalizeHealPolicyIssueCodes,
  redactKnownSecretValues,
  verifyHealedSourcePolicy
} from './test-heal.mjs';

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
  const contractTestPath = canonicalContractTestPath(testPath);
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
    if (target === contractTestPath) matches.push({ specPath, validation });
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple specs claim target ${contractTestPath}: ${matches.map((match) => match.specPath).join(', ')}.`
    );
  }
  return matches[0] ?? null;
}

export function inferStandaloneProject(testPath) {
  const contractTestPath = canonicalContractTestPath(testPath);
  if (LOCAL_FIXTURE_TARGET.test(contractTestPath)) return 'local-chromium';
  if (contractTestPath.endsWith('.authenticated.spec.ts')) return 'chromium-auth';
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

function directoryIdentity(directory) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Standalone verification directory must remain a real directory: ${directory}`);
  }
  return Object.freeze({ dev: stat.dev, ino: stat.ino });
}

function sameDirectoryIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function strictDescendant(candidate, root) {
  const relative = path.relative(root, candidate);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function assertStandaloneRunDirectoryIdentity(identity) {
  const root = verifiedDirectory(identity.rootReal, 'Standalone verification run root');
  const run = verifiedDirectory(identity.runReal, 'Standalone verification execution directory');
  if (root.real !== identity.rootReal
    || run.real !== identity.runReal
    || !strictDescendant(run.real, root.real)
    || !sameDirectoryIdentity(identity.root, directoryIdentity(root.real))
    || !sameDirectoryIdentity(identity.run, directoryIdentity(run.real))) {
    throw new Error('Standalone verification run root or execution directory identity changed before browser work.');
  }
}

function prepareStandaloneRunDirectory(requestedRunRoot, createDirectory = fs.mkdirSync) {
  const verifiedRoot = ensureVerifiedDirectory(
    requestedRunRoot,
    'Standalone verification run root',
    0o700
  );
  const rootIdentity = directoryIdentity(verifiedRoot.real);
  const runDir = path.join(
    verifiedRoot.real,
    `heal-verify-${Date.now()}-${process.pid}-${crypto.randomUUID()}`
  );
  createDirectory(runDir, { mode: 0o700 });
  const verifiedRunDir = verifiedDirectory(runDir, 'Standalone verification execution directory');
  if (!strictDescendant(verifiedRunDir.real, verifiedRoot.real)) {
    throw new Error('Standalone verification execution directory escaped its verified run root.');
  }
  const runDirIdentity = Object.freeze({
    rootReal: verifiedRoot.real,
    root: rootIdentity,
    runReal: verifiedRunDir.real,
    run: directoryIdentity(verifiedRunDir.real)
  });
  assertStandaloneRunDirectoryIdentity(runDirIdentity);
  return Object.freeze({ runDir: verifiedRunDir.real, runDirIdentity });
}

// Single-project verification lane for tests that are not bound to a flow spec.
// Mirrors executeGeneratedPair's per-project contract: JSON report verified for
// the exact repeat count with retries=0, flaky or skipped outcomes fail.
export function executeStandaloneTarget({
  testPath,
  project,
  repeatEach,
  purpose = 'gate',
  env,
  webRoot = process.cwd(),
  runRoot,
  commandRunner = defaultCommandRunner,
  packageManager = detectPackageManager(webRoot),
  createRunDirectory = fs.mkdirSync
}) {
  const resolvedRunRoot = path.resolve(runRoot ?? path.join(webRoot, '.ai-runs'));
  const preparedRun = prepareStandaloneRunDirectory(resolvedRunRoot, createRunDirectory);
  const { runDir, runDirIdentity } = preparedRun;
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
    repeatEach,
    purpose
  });
  const profile = project === 'local-chromium' ? 'local-runtime' : 'external-runtime';
  assertStandaloneRunDirectoryIdentity(runDirIdentity);
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
    cleanupFailedRunDir({ runDir, runDirIdentity }, resolvedRunRoot);
    return { passed: true, attempted: true, stage: 'accepted', issues: [], artifacts: [], runDir: undefined };
  }
  return {
    passed: false,
    attempted: true,
    stage: playwrightFailureStage(status, verdict),
    issues: verdict.issues ?? [`Playwright exited ${status} for ${testPath}.`],
    artifacts: [{ project, jsonReportPath, htmlReportDir, testResultsDir }],
    runDir,
    runDirIdentity
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

const MAX_ERROR_CONTEXT_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const MAX_TRACE_ATTACHMENT_BYTES = 64 * 1024 * 1024;
const TRACE_EVENT_ENTRY_PATTERN = /(^|\/)[^/]*\.trace$/;

function readBoundedArtifactFile(artifactPath, rootDir, maxBytes) {
  const realRoot = fs.realpathSync(rootDir);
  const realPath = fs.realpathSync(artifactPath);
  if (!strictDescendant(realPath, realRoot)) return undefined;
  const stat = fs.lstatSync(realPath);
  if (!stat.isFile() || stat.size > maxBytes) return undefined;
  return fs.readFileSync(realPath);
}

// Distills bounded, sanitized DOM evidence (accessibility-snapshot lines and
// live data-testid candidates) from the failed run's own artifacts: the
// error-context markdown attachment and the trace's frame-snapshot events.
// Best-effort by design — any structural or read problem yields undefined and
// the heal proceeds exactly as before. Must run BEFORE cleanupFailedRunDir
// deletes the run directory. Raw artifacts (traces, screenshots, HTML) never
// leave this function; only distilled candidate lines do.
export function collectBaselineDomEvidence(execution, targetTestFile, {
  secretValues = [],
  readReport = (reportPath) => readVerifiedJsonFile({
    filePath: reportPath,
    rootPath: path.dirname(reportPath),
    maxBytes: 32 * 1024 * 1024,
    label: 'Playwright JSON report'
  }),
  readArtifactFile = readBoundedArtifactFile
} = {}) {
  const pageSnapshotLines = [];
  const testIdCandidates = [];
  for (const artifact of execution?.artifacts ?? []) {
    if (!artifact?.jsonReportPath || !artifact?.testResultsDir) continue;
    let attachments;
    try {
      attachments = collectFailureAttachments(readReport(artifact.jsonReportPath), targetTestFile);
    } catch {
      continue;
    }
    for (const attachment of attachments) {
      try {
        if (attachment.name === 'error-context' && attachment.contentType === 'text/markdown') {
          const bytes = readArtifactFile(
            attachment.path,
            artifact.testResultsDir,
            MAX_ERROR_CONTEXT_ATTACHMENT_BYTES
          );
          if (!bytes) continue;
          pageSnapshotLines.push(...extractPageSnapshotLines(bytes.toString('utf8'), { secretValues }));
        } else if (attachment.name === 'trace' && attachment.contentType === 'application/zip') {
          const bytes = readArtifactFile(attachment.path, artifact.testResultsDir, MAX_TRACE_ATTACHMENT_BYTES);
          if (!bytes) continue;
          const entries = readZipTextEntries(bytes, {
            nameFilter: (name) => TRACE_EVENT_ENTRY_PATTERN.test(name)
          });
          for (const entry of entries) {
            testIdCandidates.push(...extractTestidCandidatesFromTrace(entry.text, { secretValues }));
          }
        }
      } catch {
        // One unreadable attachment must never abort DOM-evidence collection.
      }
    }
  }
  return buildHealDomEvidence({ pageSnapshotLines, testIdCandidates });
}

// Verification runs can leave traces/screenshots that may embed tokens. Once
// their evidence has been distilled into sanitized text, the run directory is
// deleted so nothing credential-bearing lingers under .ai-runs.
function cleanupFailedRunDir(execution, runRoot) {
  const runDir = execution?.runDir;
  if (!runDir) return;
  try {
    const root = verifiedDirectory(path.resolve(runRoot), 'Standalone verification cleanup root');
    const run = verifiedDirectory(path.resolve(runDir), 'Standalone verification cleanup directory');
    if (!strictDescendant(run.real, root.real)) return;
    const captured = execution.runDirIdentity;
    if (captured) {
      if (captured.rootReal !== root.real || captured.runReal !== run.real) return;
      if (!sameDirectoryIdentity(captured.root, directoryIdentity(root.real))) return;
      if (!sameDirectoryIdentity(captured.run, directoryIdentity(run.real))) return;
    }
    fs.rmSync(run.real, { recursive: true, force: true });
  } catch {
    // Cleanup is best effort and must never cross an unverified path.
  }
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

function boundRegularFileStat(stat) {
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs
  });
}

function sameBoundRegularFileStat(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function readDescriptorBytes(descriptor, size, label) {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_HEAL_SOURCE_BYTES) {
    throw new Error(`${label} has an invalid or oversized file length.`);
  }
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const count = fs.readSync(descriptor, bytes, offset, size - offset, offset);
    if (count === 0) throw new Error(`${label} changed while its bytes were read.`);
    offset += count;
  }
  return bytes;
}

function closeBoundRegularFile(binding) {
  if (!binding || binding.closed) return;
  binding.closed = true;
  fs.closeSync(binding.descriptor);
}

function removePathWithoutFollowingLinks(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isDirectory()) fs.unlinkSync(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function removeBoundRegularFile(binding) {
  if (!binding) return;
  closeBoundRegularFile(binding);
  removePathWithoutFollowingLinks(binding.path);
}

function createBoundRegularFile(filePath, source, mode, label) {
  const bytes = Buffer.isBuffer(source) ? Buffer.from(source) : Buffer.from(String(source), 'utf8');
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
    if (!opened.isFile()
      || pathStat.isSymbolicLink()
      || !pathStat.isFile()
      || opened.dev !== pathStat.dev
      || opened.ino !== pathStat.ino) {
      throw new Error(`${label} is not the exclusively created regular file.`);
    }
    const actualBytes = readDescriptorBytes(descriptor, opened.size, label);
    const after = fs.fstatSync(descriptor);
    if (!sameBoundRegularFileStat(boundRegularFileStat(opened), boundRegularFileStat(after))
      || !actualBytes.equals(bytes)) {
      throw new Error(`${label} changed while it was bound to its descriptor.`);
    }
    return {
      path: filePath,
      descriptor,
      closed: false,
      bytes,
      sha256: sha256(bytes),
      stat: boundRegularFileStat(after)
    };
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { removePathWithoutFollowingLinks(filePath); } catch {}
    throw error;
  }
}

function assertBoundRegularFileUnchanged(binding, label) {
  if (!binding || binding.closed) throw new Error(`${label} descriptor is not available.`);
  const pathStat = fs.lstatSync(binding.path);
  const opened = fs.fstatSync(binding.descriptor);
  if (pathStat.isSymbolicLink()
    || !pathStat.isFile()
    || !opened.isFile()
    || !sameBoundRegularFileStat(binding.stat, boundRegularFileStat(pathStat))
    || !sameBoundRegularFileStat(binding.stat, boundRegularFileStat(opened))) {
    throw new Error(`${label} path or inode changed during verification.`);
  }
  const bytes = readDescriptorBytes(binding.descriptor, opened.size, label);
  const after = fs.fstatSync(binding.descriptor);
  const afterPath = fs.lstatSync(binding.path);
  if (!sameBoundRegularFileStat(binding.stat, boundRegularFileStat(after))
    || afterPath.isSymbolicLink()
    || !afterPath.isFile()
    || !sameBoundRegularFileStat(binding.stat, boundRegularFileStat(afterPath))
    || !bytes.equals(binding.bytes)
    || sha256(bytes) !== binding.sha256) {
    throw new Error(`${label} metadata or bytes changed during verification.`);
  }
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
  targetPath,
  webRoot = process.cwd(),
  env = process.env,
  commandRunner = spawnSync,
  packageManager = detectPackageManager(webRoot)
}) {
  const [command, args] = packageManager === 'pnpm'
    ? ['pnpm', ['exec', 'eslint', targetPath, candidatePath, '--format=json', '--max-warnings=0']]
    : packageManager === 'yarn'
      ? ['yarn', ['eslint', targetPath, candidatePath, '--format=json', '--max-warnings=0']]
      : ['npx', ['eslint', targetPath, candidatePath, '--format=json', '--max-warnings=0']];
  try {
    const result = commandRunner(command, args, {
      cwd: webRoot,
      encoding: 'utf8',
      env: buildGateEnvironment(env, { profile: 'static' }),
      maxBuffer: MAX_HEAL_ARCHIVE_FILE_BYTES,
      shell: false
    });
    if (![0, 1].includes(result?.status) || result.signal || result.error) {
      return { passed: false, issues: ['ESLint did not accept the heal candidate.'] };
    }

    const reports = JSON.parse(String(result.stdout ?? ''));
    if (!Array.isArray(reports)) {
      return { passed: false, issues: ['ESLint did not accept the heal candidate.'] };
    }
    const reportFor = (filePath) => {
      const expectedPath = path.resolve(webRoot, filePath);
      const matches = reports.filter((report) => (
        report
        && typeof report.filePath === 'string'
        && path.resolve(webRoot, report.filePath) === expectedPath
      ));
      return matches.length === 1 ? matches[0] : null;
    };
    const findingCounts = (report) => {
      if (!report || !Array.isArray(report.messages)) return null;
      if ((report.fatalErrorCount ?? 0) > 0 || report.messages.some((message) => message?.fatal)) {
        return null;
      }
      const counts = new Map();
      for (const message of report.messages) {
        if (!message
          || !Number.isInteger(message.severity)
          || typeof message.message !== 'string') return null;
        const fingerprint = JSON.stringify([
          message.ruleId ?? null,
          message.severity,
          message.message
        ]);
        counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
      }
      return counts;
    };
    const targetFindings = findingCounts(reportFor(targetPath));
    const candidateFindings = findingCounts(reportFor(candidatePath));
    if (!targetFindings || !candidateFindings) {
      return { passed: false, issues: ['ESLint did not accept the heal candidate.'] };
    }
    let increasedFindings = 0;
    for (const [fingerprint, count] of candidateFindings) {
      increasedFindings += Math.max(0, count - (targetFindings.get(fingerprint) ?? 0));
    }
    if (increasedFindings > 0) {
      return {
        passed: false,
        issues: [
          `ESLint found ${increasedFindings} new or increased candidate finding${increasedFindings === 1 ? '' : 's'}.`
        ]
      };
    }
    return { passed: true, issues: [] };
  } catch {
    // A thrown runner is an abnormal lint exit and receives the same bounded,
    // non-provider-controlled diagnostic as a nonzero process status.
  }
  return { passed: false, issues: ['ESLint did not accept the heal candidate.'] };
}

function assertHealableTarget(absoluteTarget, webRoot, testSuiteRoot) {
  const testsRoot = path.join(webRoot, testSuiteRoot);
  if (!fs.existsSync(absoluteTarget)) {
    throw new Error(`Heal target does not exist: ${absoluteTarget}`);
  }
  const stat = fs.lstatSync(absoluteTarget);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Heal target must be a regular file: ${absoluteTarget}`);
  }
  const realTarget = fs.realpathSync(absoluteTarget);
  const realWebRoot = fs.realpathSync(webRoot);
  const realTestsRoot = fs.realpathSync(testsRoot);
  if (realTestsRoot !== path.join(realWebRoot, testSuiteRoot)) {
    throw new Error(`Heal test suite root must remain inside ${realWebRoot}: ${testsRoot}`);
  }
  const relative = path.relative(realTestsRoot, realTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Heal target must live inside the ${testSuiteRoot} directory: ${absoluteTarget}`);
  }
  return stat;
}

function createHealArchive(webRoot, runId) {
  const directory = path.join(webRoot, '.ai-runs', 'heal', runId);
  ensureVerifiedDirectory(directory, 'Test-heal audit directory', 0o700);
  fs.chmodSync(directory, 0o700);
  const archiveBytes = (fileName, contents) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fileName)) {
      throw new Error(`Invalid test-heal audit file name: ${fileName}`);
    }
    const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(String(contents), 'utf8');
    if (bytes.length > MAX_HEAL_ARCHIVE_FILE_BYTES) {
      throw new Error(`Test-heal audit file exceeds ${MAX_HEAL_ARCHIVE_FILE_BYTES} bytes: ${fileName}`);
    }
    return bytes;
  };
  return {
    directory,
    write(fileName, contents) {
      const bytes = archiveBytes(fileName, contents);
      const archivePath = path.join(directory, fileName);
      fs.writeFileSync(archivePath, bytes, { flag: 'wx', mode: 0o600 });
      fs.chmodSync(archivePath, 0o600);
      return archivePath;
    },
    replace(fileName, contents) {
      const bytes = archiveBytes(fileName, contents);
      const archivePath = path.join(directory, fileName);
      const current = fs.lstatSync(archivePath);
      if (current.isSymbolicLink() || !current.isFile()) {
        throw new Error(`Test-heal audit replacement must target a regular file: ${fileName}`);
      }
      const temporaryPath = path.join(directory, `.${fileName}.${crypto.randomUUID()}.tmp`);
      try {
        fs.writeFileSync(temporaryPath, bytes, { flag: 'wx', mode: 0o600 });
        fs.chmodSync(temporaryPath, 0o600);
        fs.renameSync(temporaryPath, archivePath);
      } finally {
        fs.rmSync(temporaryPath, { force: true });
      }
      return archivePath;
    }
  };
}

function sanitizedDiagnosticText(value, secretValues) {
  const knownRedacted = redactKnownSecretValues(String(value ?? ''), secretValues);
  const shapedRedacted = redactSecretMaterial(knownRedacted);
  // Provider evidence is useful only if it is safe to forward. Redact long
  // credential alphabets unconditionally so repetitive prefixes cannot dilute
  // an embedded Base64 or token suffix.
  return shapedRedacted
    .replace(/[A-Za-z0-9._~+\/=-]{20,}/g, '<redacted>')
    .replace(/\S{80,}/g, '<redacted>')
    .slice(0, 2_000);
}

function auditAttemptTrail(attemptTrail) {
  return attemptTrail.slice(-MAX_AUTOHEAL_MAX_ATTEMPTS).map((entry) => {
    const policyWarning = entry.checks?.policy === 'warning'
      || (Array.isArray(entry.policyIssueCodes) && entry.policyIssueCodes.length > 0);
    const policyIssueCodes = normalizeHealPolicyIssueCodes(entry.policyIssueCodes, {
      requireAtLeastOne: policyWarning
    });
    return {
      attempt: entry.attempt,
      outcome: entry.outcome,
      ...(entry.checks ? { checks: { ...entry.checks } } : {}),
      ...(policyIssueCodes.length > 0 ? { policyIssueCodes } : {})
    };
  });
}

function sanitizedEvidenceList(value, secretValues) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_HEAL_EVIDENCE_ITEMS)
    .map((item) => sanitizedDiagnosticText(item, secretValues).trim())
    .filter(Boolean);
}

function publicDiagnostic(status) {
  const normalizedStatus = String(status ?? 'error')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .slice(0, 64)
    .toUpperCase();
  const code = `HEAL_${normalizedStatus}`;
  return `${code}: Diagnostic details were omitted.`;
}

function sanitizePublicResult(result) {
  const sanitized = { ...result };
  if (Array.isArray(result.issues)) {
    sanitized.issues = result.issues.length > 0 ? [publicDiagnostic(result.status)] : [];
  }
  if (Object.hasOwn(result, 'detail')) {
    sanitized.detail = publicDiagnostic(result.status);
  }
  if (Object.hasOwn(result, 'policyIssueCodes')) {
    sanitized.policyIssueCodes = normalizeHealPolicyIssueCodes(result.policyIssueCodes, {
      requireAtLeastOne: true
    });
  }
  if (Array.isArray(result.attemptTrail)) {
    sanitized.attemptTrail = auditAttemptTrail(result.attemptTrail);
  }
  if (Array.isArray(result.auditIssues)) {
    sanitized.auditIssues = result.auditIssues.length > 0
      ? ['HEAL_AUDIT_FAILURE: Audit details were omitted.']
      : [];
  }
  return sanitized;
}

function containsCandidateSecretLiteral(source) {
  const text = String(source ?? '').replace(
    /^(\/\*\s+(?:spec|recording):[^\r\n]*\bsha256:)[a-f0-9]{64}(\s+\*\/)/i,
    '$1<traceability-sha256>$2'
  );
  const containsSecretFragment = (value) => {
    const fragments = value.match(/[A-Za-z0-9._~+/-]{20,}/g) ?? [];
    return fragments.some((fragment) => {
      for (let index = 0; index <= fragment.length - 20; index += 1) {
        if (containsSecretLikeValue(fragment.slice(index))) return true;
      }
      return false;
    });
  };
  if (containsSecretFragment(text)) return true;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token !== ts.SyntaxKind.StringLiteral
      && token !== ts.SyntaxKind.NoSubstitutionTemplateLiteral
      && token !== ts.SyntaxKind.RegularExpressionLiteral) continue;
    const tokenText = scanner.getTokenText();
    const literal = token === ts.SyntaxKind.RegularExpressionLiteral
      ? tokenText.slice(1, tokenText.lastIndexOf('/'))
      : tokenText.slice(1, -1);
    if (containsSecretLikeValue(literal)) return true;
    if (containsSecretFragment(literal)) return true;
  }
  return false;
}

function sourceSafetyIssue(source, secretValues, label) {
  const normalizedSource = String(source ?? '');
  // Keep preflight checks deterministic. Generic candidate semantics belong to
  // verifyHealedSourcePolicy; every rejection below that boundary records only
  // a reason code, never candidate source.
  if (redactKnownSecretValues(normalizedSource, secretValues) !== normalizedSource) {
    return `${label} contains a known secret value and cannot be healed or archived.`;
  }
  if (containsSecretLikeValue(normalizedSource)) {
    return `${label} contains secret-like material and cannot be healed or archived.`;
  }
  return null;
}

function candidateSourceSafetyIssue(source, secretValues) {
  const normalizedSource = String(source ?? '');
  const commonIssue = sourceSafetyIssue(normalizedSource, secretValues, 'Heal candidate source');
  if (commonIssue) return commonIssue;
  if (analyzeHealSource(normalizedSource).containsSecrets || containsCandidateSecretLiteral(normalizedSource)) {
    return 'Heal candidate source contains secret-like material and cannot be healed or archived.';
  }
  return null;
}

function acceptedCandidateResult({
  status,
  attempt,
  candidateSha256,
  candidatePath,
  diffPath,
  policyIssueCodes,
  backupPath
}) {
  return {
    status,
    attemptsUsed: attempt,
    candidateSha256,
    candidatePath,
    diffPath,
    ...(backupPath ? { backupPath } : {}),
    ...(policyIssueCodes.length > 0 ? { policyIssueCodes } : {})
  };
}

function preserveTerminalLineEnding(originalSource, candidateSource) {
  const originalEnding = String(originalSource).match(/(?:\r\n|\r|\n)$/)?.[0] ?? '';
  const candidateWithoutEnding = String(candidateSource).replace(/(?:\r\n|\r|\n)$/, '');
  return `${candidateWithoutEnding}${originalEnding}`;
}

function rejectedAttemptAudit(attempt, outcome, reasonCodes = []) {
  const boundedReasonCodes = reasonCodes.includes('UNVERIFIED_SCOPED_ROLE_LOCATOR')
    ? ['UNVERIFIED_SCOPED_ROLE_LOCATOR']
    : [];
  return `${JSON.stringify({
    schema: 'test-heal-rejected-attempt/v1',
    attempt,
    outcome,
    ...(boundedReasonCodes.length ? { reasonCodes: boundedReasonCodes } : {})
  }, null, 2)}\n`;
}

function structuredProviderAudit(healed, attempt, secretValues) {
  const result = healed?.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const record = { attempt };
  const brain = result.brain;
  if (brain && typeof brain === 'object' && !Array.isArray(brain)) {
    if (typeof brain.kind === 'string' && brain.kind.trim()) {
      record.kind = sanitizedDiagnosticText(brain.kind, secretValues);
    }
    if (typeof brain.model === 'string' && brain.model.trim()) {
      record.model = sanitizedDiagnosticText(brain.model, secretValues);
    }
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
  return status === 'already-green'
    || status === 'proposal-ready'
    || status === 'healed';
}

export function renderHealResults(results) {
  const events = [];
  const write = (stream, line) => events.push({ stream, line });
  let allGreen = true;

  for (const result of results) {
    const policyIssueCodes = normalizeHealPolicyIssueCodes(result.policyIssueCodes);
    const hasPolicyWarnings = policyIssueCodes.length > 0;
    const suffix = result.attemptsUsed > 0 ? ` after ${result.attemptsUsed} attempt(s)` : '';
    if (result.status === 'healed' && hasPolicyWarnings) {
      write('stderr', `HEALED WITH POLICY WARNINGS ${result.target}${suffix}. Backup: ${result.backupPath}`);
    } else if (result.status === 'healed') {
      write('stdout', `HEALED ${result.target}${suffix}. Backup: ${result.backupPath}`);
    } else if (result.status === 'proposal-ready' && hasPolicyWarnings) {
      write('stdout', `PROPOSAL READY WITH POLICY WARNINGS ${result.target}${suffix} (target unchanged). Diff: ${result.diffPath}. Archive: ${result.archiveDir}`);
    } else if (result.status === 'proposal-ready') {
      write('stdout', `PROPOSAL READY ${result.target}${suffix} (target unchanged). Diff: ${result.diffPath}. Archive: ${result.archiveDir}`);
    } else if (result.status === 'already-green') {
      write('stdout', `ALREADY GREEN ${result.target} (no changes made).`);
    } else {
      write('stderr', `NOT HEALED ${result.target} (${result.status})${suffix}.`);
      for (const issue of result.issues ?? []) write('stderr', `- ${issue}`);
      if (result.archiveDir) write('stderr', `  Evidence: ${result.archiveDir}`);
    }
    if (hasPolicyWarnings) {
      write('stderr', `- Policy warnings: ${policyIssueCodes.join(', ')}`);
    }
    if (!isSuccessfulHealStatus(result.status)
      || (result.status === 'healed' && hasPolicyWarnings)) allGreen = false;
  }

  return {
    exitCode: allGreen ? 0 : 1,
    events
  };
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
  collectDomEvidence = collectBaselineDomEvidence,
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
  const requestedTarget = String(testPath ?? '');
  const requestedTestSuiteRoot = path.isAbsolute(requestedTarget)
    ? undefined
    : testSuiteRootForPath(requestedTarget);
  const absoluteTarget = path.resolve(webRoot, requestedTarget);
  const relativeTarget = normalizePortablePath(path.relative(webRoot, absoluteTarget));
  if (!relativeTarget || relativeTarget.startsWith('..')) {
    throw new Error(`Heal target must live inside ${webRoot}: ${testPath}`);
  }
  const target = normalizePlaywrightTarget(relativeTarget);
  const testSuiteRoot = requestedTestSuiteRoot ?? testSuiteRootForPath(target);
  assertHealableTarget(absoluteTarget, webRoot, testSuiteRoot);
  const verificationEnv = withTestSuiteRoot(env, target);
  sweepStaleHealCandidates(absoluteTarget, log);
  const startingTarget = captureTargetSnapshot(absoluteTarget);
  const originalBytes = startingTarget.bytes;
  const originalSource = originalBytes.toString('utf8');
  const originalSha = startingTarget.snapshot.sha256;
  const runRoot = path.join(webRoot, '.ai-runs');
  const runId = `${Date.now()}-${process.pid}-${crypto.randomUUID()}`;
  const secretValues = knownSecretEnvValues(env);
  const originalSafetyIssue = sourceSafetyIssue(originalSource, secretValues, 'Heal target source');
  if (originalSafetyIssue) throw new Error(originalSafetyIssue);

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
    return sanitizePublicResult({
      status: 'dirty-target',
      target,
      attemptsUsed: 0,
      issues: [`${target} has uncommitted Git changes; rerun with --allow-dirty only if applying over them is intentional.`]
    });
  }

  const resolvedProject = project ?? inferStandaloneProject(target);
  // executeGeneratedPair returns the execution shape directly:
  // { passed, attempted, stage, issues, artifacts, runDir }.
  const runVerification = (pathToRun, runs = repeatEach) => (contract.kind === 'spec'
    ? executePair(
        { specPath: contract.specPath, testPath: pathToRun, validation: contract.validation },
        {
          repeatEach: runs,
          workers: 1,
          purpose: runs === 1 ? 'diagnostic' : 'healer-candidate',
          env: verificationEnv,
          runRoot
        }
      )
    : executeStandalone({
        testPath: pathToRun,
        project: resolvedProject,
        repeatEach: runs,
        purpose: runs === 1 ? 'diagnostic' : 'healer-candidate',
        env: verificationEnv,
        webRoot,
        runRoot
      }));

  const contractDescription = contract.kind === 'spec'
    ? `spec-bound via ${contract.specPath}`
    : contract.kind === 'recording'
      ? `recording-bound via ${contract.recordingPath}; standalone project ${resolvedProject}`
      : `handwritten; standalone project ${resolvedProject}`;
  // Per-stage wall-clock accounting (baseline run, triage, each provider
  // attempt, each verify run) persisted into heal-summary.json so the cost of
  // a heal run stays auditable without re-running it.
  const stageTimings = [];
  const timeStage = (label, work) => {
    const startedAtMs = Date.now();
    try {
      return work();
    } finally {
      stageTimings.push({ ...label, durationMs: Date.now() - startedAtMs });
    }
  };
  log(`[heal] ${target}: baseline verification (1 diagnostic run, retries=0, ${contractDescription}).`);
  let execution = timeStage({ stage: 'baseline' }, () => runVerification(target, 1));
  if (execution.passed) {
    cleanupFailedRunDir(execution, runRoot);
    return sanitizePublicResult({ status: 'already-green', target, attemptsUsed: 0 });
  }
  if (execution.stage === 'runtime-environment') {
    cleanupFailedRunDir(execution, runRoot);
    // An environment abort must still leave archived evidence: the audit found
    // aborts that wrote nothing at all, leaving no status, classification, or
    // timing trail. Only sanitized structural fields are written here.
    const environmentTriage = timeStage({ stage: 'triage' }, () => triageRuntimeFailure({
      evidence: [],
      stage: execution.stage
    }));
    const environmentResult = {
      status: 'environment-failure',
      target,
      attemptsUsed: 0,
      issues: execution.issues,
      detail: 'Baseline run failed for environment reasons; healing would mask an infrastructure problem.'
    };
    try {
      const archive = archiveFactory(webRoot, runId);
      archive.write('heal-summary.json', `${JSON.stringify({
        schema: 'test-heal-run/v1',
        runId,
        target,
        contractKind: contract.kind,
        status: 'environment-failure',
        attemptsUsed: 0,
        verifyRuns: repeatEach,
        originalSha256: originalSha,
        triage: environmentTriage,
        issues: sanitizedEvidenceList(execution.issues, secretValues),
        providerAttempts: [],
        mode: { apply, allowDirty },
        attemptTrail: [],
        timings: stageTimings
      }, null, 2)}\n`);
      return sanitizePublicResult({ ...environmentResult, archiveDir: archive.directory });
    } catch (error) {
      // Mirror the healed-path audit degradation: a failed archive write must
      // degrade to auditIssues, never turn an environment abort into a crash.
      return sanitizePublicResult({ ...environmentResult, auditIssues: [error.message] });
    }
  }

  let evidence;
  let domEvidence;
  try {
    evidence = sanitizedEvidenceList(collectEvidence(execution, target, { secretValues }), secretValues);
    // DOM evidence must be distilled while the run directory (and therefore
    // the error-context and trace attachments) still exists.
    try {
      domEvidence = collectDomEvidence(execution, target, { secretValues });
    } catch {
      domEvidence = undefined;
    }
  } finally {
    cleanupFailedRunDir(execution, runRoot);
  }
  const archive = archiveFactory(webRoot, runId);
  const archiveOriginalPath = archive.write('original.ts', originalBytes);
  let triage = timeStage({ stage: 'triage' }, () => triageRuntimeFailure({ evidence, stage: execution.stage }));
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
      attemptTrail: auditAttemptTrail(attemptTrail),
      timings: stageTimings
    }, null, 2)}\n`);
    return sanitizePublicResult({
      ...result,
      target,
      archiveDir: archive.directory,
      attemptTrail
    });
  };
  const evidenceAudit = () => `${JSON.stringify({
    schema: 'test-heal-evidence/v1',
    evidence: triage.reasonCodes,
    triage,
    // Counts only: the sanitized DOM evidence itself rides in the prompt, and
    // the audit trail must stay free of page content.
    ...(domEvidence ? {
      domEvidence: {
        pageSnapshotLines: domEvidence.pageSnapshot.length,
        testIdCandidates: domEvidence.testIdCandidates.length
      }
    } : {})
  }, null, 2)}\n`;
  archive.write('evidence.json', evidenceAudit());
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
  const archiveRejectedAttempt = (attempt, outcome, reasonCodes = []) => archive.write(
    `attempt-${attempt}.${outcome}.json`,
    rejectedAttemptAudit(attempt, outcome, reasonCodes)
  );

  // A crash must not leave an unreviewed candidate inside tests/ where normal
  // suite runs would execute it.
  let activeCandidate = null;
  let activePromotion = null;
  const removeActiveCandidate = () => {
    if (activeCandidate) removeBoundRegularFile(activeCandidate);
    if (activePromotion) removeBoundRegularFile(activePromotion);
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
      let policyIssueCodes = [];
      const recordAttempt = (outcome) => {
        attemptTrail.push({
          attempt,
          outcome,
          ...(Object.keys(checks).length > 0 ? { checks: { ...checks } } : {}),
          ...(policyIssueCodes.length > 0 ? { policyIssueCodes: [...policyIssueCodes] } : {})
        });
      };
      let healed;
      const providerStartedAtMs = Date.now();
      try {
        healed = await heal({
          testPath: target,
          source: originalSource,
          evidence,
          notes,
          attempt,
          maxAttempts: attemptsBudget,
          repositoryContext,
          domEvidence: HEAL_DOM_EVIDENCE_CLASSIFICATIONS.has(triage.classification)
            ? domEvidence
            : undefined,
          env,
          signal
        });
        stageTimings.push({ stage: 'provider', attempt, durationMs: Date.now() - providerStartedAtMs });
      } catch (error) {
        stageTimings.push({ stage: 'provider', attempt, durationMs: Date.now() - providerStartedAtMs });
        // A thrown brain (for example a provider CLI failure) must still leave
        // a providerAttempts record; the audit found brain-error attempt
        // trails with providerAttempts=[] and therefore no usage evidence.
        providerAttempts.push({ attempt, kind: 'brain-error', usage: null });
        recordAttempt('brain-error', error.message);
        return finish({ status: 'brain-error', attemptsUsed: attempt, issues: [error.message] });
      }
      if (typeof healed?.code === 'string') {
        healed = {
          ...healed,
          code: preserveTerminalLineEnding(originalSource, healed.code)
        };
      }
      // The provider call already happened, so its audit record (sanitized
      // kind/model plus bounded numeric usage) is recorded even when the
      // candidate below is rejected for safety reasons.
      const providerAudit = structuredProviderAudit(healed, attempt, secretValues);
      if (providerAudit) providerAttempts.push(providerAudit);
      const candidateSafetyIssue = candidateSourceSafetyIssue(healed?.code, secretValues);
      if (candidateSafetyIssue) {
        checks.policy = 'rejected';
        if (!providerAudit) providerAttempts.push({ attempt, kind: 'brain-error', usage: null });
        recordAttempt('brain-error', candidateSafetyIssue);
        return finish({ status: 'brain-error', attemptsUsed: attempt, issues: [candidateSafetyIssue] });
      }
      if (typeof healed.promptSchema === 'string' && healed.promptSchema.trim()) {
        const candidatePromptSchema = healed.promptSchema.trim();
        promptSchema = /^[a-z][a-z0-9-]{0,63}\/v\d+$/.test(candidatePromptSchema)
          ? candidatePromptSchema
          : sanitizedDiagnosticText(candidatePromptSchema, secretValues);
      }

      // The ORIGINAL source is the immutable baseline for every attempt, so a
      // later attempt cannot ratchet the rules by comparing against an earlier
      // (already accepted-for-iteration) candidate.
      const locatorEvidence = verifyScopedRoleEvidence({
        previousSource: originalSource,
        healedSource: healed.code,
        repositoryContext,
        // Observed-page grounding for introduced named role locators: the
        // sanitized baseline-failure DOM evidence carries the accessibility
        // snapshot (role + accessible name) the candidate must name.
        domEvidence
      });
      checks.locatorEvidence = locatorEvidence.passed ? 'passed' : 'rejected';
      if (!locatorEvidence.passed) {
        archiveRejectedAttempt(attempt, 'rejected-locator-evidence', locatorEvidence.reasonCodes);
        recordAttempt('locator-evidence-rejected');
        log(`[heal] ${target}: attempt ${attempt} rejected by scoped locator evidence.`);
        notes = buildHealRejectionDigest({
          attempt,
          gate: 'scoped locator evidence',
          findings: sanitizedEvidenceList(locatorEvidence.reasonCodes, secretValues)
        });
        continue;
      }

      const policy = verifyHealedSourcePolicy({ previousSource: originalSource, healedSource: healed.code });
      const semanticPolicyIssueCodes = policy.passed
        ? []
        : normalizeHealPolicyIssueCodes(policy.issueCodes, { requireAtLeastOne: true });
      policyIssueCodes = normalizeHealPolicyIssueCodes([
        ...locatorEvidence.warningCodes,
        ...semanticPolicyIssueCodes
      ]);
      checks.policy = policyIssueCodes.length > 0 ? 'warning' : 'passed';
      if (policyIssueCodes.length > 0) {
        log(`[heal] ${target}: attempt ${attempt} continues with policy warnings: ${policyIssueCodes.join(', ')}.`);
      }

      const candidateAbsolute = healCandidatePath(absoluteTarget, `${runId}-a${attempt}`);
      const candidateRelative = normalizePortablePath(path.relative(webRoot, candidateAbsolute));
      const candidateBinding = createBoundRegularFile(
        candidateAbsolute,
        healed.code,
        0o600,
        'Test-heal candidate'
      );
      activeCandidate = candidateBinding;
      try {
        const types = typecheck({ candidatePath: candidateAbsolute, targetPath: absoluteTarget, webRoot });
        checks.typecheck = types.passed ? 'passed' : 'rejected';
        if (!types.passed) {
          archiveRejectedAttempt(attempt, 'rejected-typecheck');
          recordAttempt('typecheck-rejected', types.issues.join(' '));
          log(`[heal] ${target}: attempt ${attempt} rejected by typecheck.`);
          notes = buildHealRejectionDigest({
            attempt,
            gate: 'typecheck',
            findings: sanitizedEvidenceList(types.issues, secretValues)
          });
          continue;
        }

        const lintResult = lint({ candidatePath: candidateAbsolute, targetPath: absoluteTarget, webRoot, env });
        checks.lint = lintResult.passed ? 'passed' : 'rejected';
        if (!lintResult.passed) {
          archiveRejectedAttempt(attempt, 'rejected-lint');
          recordAttempt('lint-rejected', lintResult.issues.join(' '));
          log(`[heal] ${target}: attempt ${attempt} rejected by lint.`);
          notes = buildHealRejectionDigest({
            attempt,
            gate: 'lint',
            findings: sanitizedEvidenceList(lintResult.issues, secretValues)
          });
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
          archiveRejectedAttempt(attempt, 'rejected-review');
          recordAttempt('static-review-rejected', review.issues.join(' '));
          log(`[heal] ${target}: attempt ${attempt} rejected by static review.`);
          notes = buildHealRejectionDigest({
            attempt,
            gate: 'static review',
            findings: sanitizedEvidenceList(review.issues, secretValues)
          });
          continue;
        }

        execution = timeStage({ stage: 'verify', attempt }, () => runVerification(candidateRelative));
        if (execution.passed) cleanupFailedRunDir(execution, runRoot);
        checks.runtime = execution.passed
          ? 'passed'
          : execution.stage === 'runtime-environment' ? 'environment-failure' : 'failed';
        if (execution.passed) {
          const candidateSha = candidateBinding.sha256;
          const candidateStillMatches = () => {
            try {
              assertBoundRegularFileUnchanged(candidateBinding, 'Test-heal candidate');
              return true;
            } catch {
              return false;
            }
          };
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
            archiveRejectedAttempt(attempt, `rejected-${diff.outcome}`);
            recordAttempt(diff.outcome, diff.issues.join(' '));
            notes = buildHealRejectionDigest({
              attempt,
              gate: 'candidate diff',
              findings: sanitizedEvidenceList(diff.issues, secretValues)
            });
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
          const candidateArchivePath = archive.write('candidate.ts', candidateBinding.bytes);
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
            return finish(acceptedCandidateResult({
              status: 'proposal-ready',
              attempt,
              candidateSha256: candidateSha,
              candidatePath: candidateArchivePath,
              diffPath,
              policyIssueCodes
            }));
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
          const promotionPath = path.join(
            path.dirname(absoluteTarget),
            `.${path.basename(absoluteTarget)}.${runId}.${crypto.randomUUID()}.promotion`
          );
          activePromotion = createBoundRegularFile(
            promotionPath,
            candidateBinding.bytes,
            startingTarget.mode,
            'Test-heal promotion source'
          );
          if (activePromotion.sha256 !== candidateSha) {
            throw new Error('Test-heal promotion source does not match the verified candidate bytes.');
          }
          if (!candidateStillMatches()) {
            checks.candidateIntegrity = 'rejected';
            recordAttempt('aborted-candidate-mutation');
            return finish({
              status: 'aborted-candidate-mutation',
              attemptsUsed: attempt,
              candidateSha256: candidateSha,
              candidatePath: candidateArchivePath,
              diffPath,
              issues: ['The healed candidate changed while its promotion source was prepared; it was not promoted.']
            });
          }
          assertBoundRegularFileUnchanged(activePromotion, 'Test-heal promotion source');
          fs.unlinkSync(candidateAbsolute);
          let finalTarget;
          try {
            finalTarget = captureTargetSnapshot(absoluteTarget).snapshot;
          } catch {
            finalTarget = null;
          }
          if (!finalTarget || !snapshotsEqual(finalTarget, startingTarget.snapshot)) {
            checks.targetSnapshot = 'changed';
            recordAttempt('aborted-concurrent-edit');
            return finish({
              status: 'aborted-concurrent-edit',
              attemptsUsed: attempt,
              candidateSha256: candidateSha,
              candidatePath: candidateArchivePath,
              diffPath,
              issues: [`${target} changed immediately before promotion; the concurrent edit was preserved.`]
            });
          }
          assertBoundRegularFileUnchanged(activePromotion, 'Test-heal promotion source');
          fs.renameSync(activePromotion.path, absoluteTarget);
          closeBoundRegularFile(activePromotion);
          activePromotion = null;
          closeBoundRegularFile(candidateBinding);
          activeCandidate = null;
          recordAttempt('healed');
          const healedResult = acceptedCandidateResult({
            status: 'healed',
            attempt,
            candidateSha256: candidateSha,
            candidatePath: candidateArchivePath,
            diffPath,
            backupPath: archiveOriginalPath,
            policyIssueCodes
          });
          try {
            return finish(healedResult);
          } catch (error) {
            return sanitizePublicResult({
              ...healedResult,
              target,
              archiveDir: archive.directory,
              attemptTrail,
              auditIssues: [error.message]
            });
          }
        }

        let freshEvidence;
        let freshDomEvidence;
        try {
          freshEvidence = collectEvidence(execution, candidateRelative, { secretValues });
          try {
            freshDomEvidence = collectDomEvidence(execution, candidateRelative, { secretValues });
          } catch {
            freshDomEvidence = undefined;
          }
        } finally {
          cleanupFailedRunDir(execution, runRoot);
        }
        // A fresh page observation from the candidate's failed verify run
        // supersedes the baseline one; otherwise the baseline stays.
        domEvidence = freshDomEvidence ?? domEvidence;
        evidence = sanitizedEvidenceList(
          Array.isArray(freshEvidence) && freshEvidence.length > 0 ? freshEvidence : (execution.issues ?? []),
          secretValues
        );
        triage = timeStage({ stage: 'triage', attempt }, () => triageRuntimeFailure({ evidence, stage: execution.stage }));
        archive.replace('evidence.json', evidenceAudit());

        if (execution.stage === 'runtime-environment') {
          archiveRejectedAttempt(attempt, 'env-failure');
          recordAttempt('environment-failure', (execution.issues ?? []).join(' '));
          return finish({
            status: 'environment-failure',
            attemptsUsed: attempt,
            issues: execution.issues,
            triage
          });
        }

        if (!triage.repairable) {
          archiveRejectedAttempt(attempt, 'not-repairable');
          recordAttempt('not-repairable', triage.reasonCodes.join(' '));
          return finish({
            status: 'not-repairable',
            attemptsUsed: attempt,
            issues: triage.reasonCodes,
            triage
          });
        }

        archiveRejectedAttempt(attempt, 'still-failing');
        recordAttempt('still-failing', (execution.issues ?? []).slice(0, 2).join(' '));
        // The fresh (already sanitized) evidence rides along so the next
        // prompt states WHY the candidate still failed, not just that it did.
        notes = buildHealRejectionDigest({
          attempt,
          gate: 'runtime verification',
          findings: [`Attempt ${attempt} candidate still failed runtime verification.`, ...evidence]
        });
      } finally {
        removeActiveCandidate();
        activeCandidate = null;
        activePromotion = null;
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

export function helpText() {
  return `Usage:
  AI_AUTOHEAL_ENABLED=true node scripts/ai/heal-test.mjs --test <path/to/file.spec.ts> [--test <another.spec.ts> ...]
    [--spec <specs/flow.md>] [--dir specs] [--project <playwright-project>]
    [--max-attempts N] [--verify-runs N] [--dom-snapshot <.ai-runs/dom-discovery/...>]
    [--apply [--allow-dirty]]

Runs each target test first (baseline). A test that passes the single diagnostic baseline run
is reported as already-green and never modified. For a runtime failure the healer asks the
heal brain (stage 'heal', see AI_HEAL_* env) for a repaired file.
AST-level anti-masking policy violations are recorded as warnings.
Typecheck, lint, contract review, and runtime verification remain hard gates.
Candidates that pass those gates are verified with exact consecutive repetitions
(all verification lanes use --workers=1 and --retries=0; flaky = fail).
Only locator-drift and synchronization runtime failures are repairable. Product, auth, network,
data, assertion-mismatch, and unclassified failures are reported as not-repairable. A baseline-green
target returns already-green without a proposal. For a repairable failing target that produces a
fully verified single-test candidate, default mode archives proposal-ready and leaves the target
unchanged. Policy warnings are reported separately from the accepted proposal or applied status.
An applied result with policy warnings exits non-zero.
Environment, non-repairable, and manual-change-required paths return their own statuses
and might not create a candidate proposal. Page Object or Component source is context-only and
returns manual-change-required; it is never auto-promoted. Only --apply can atomically promote a
fully verified target (clean unless --allow-dirty is explicit); integrity and concurrency checks
always remain. Every attempt and the original file are archived under .ai-runs/heal/<run-id>/.

Settings:
  AI_AUTOHEAL_ENABLED       must be true to generate a repair proposal (default false)
  AI_AUTOHEAL_MAX_ATTEMPTS  heal attempts per test, 1..${MAX_AUTOHEAL_MAX_ATTEMPTS} (default 3); --max-attempts overrides.
                            Policy warnings and typecheck/lint/review rejections consume attempts too.
  AI_AUTOHEAL_VERIFY_RUNS   consecutive green runs required, 2 or 3 (default 2); --verify-runs overrides
  --dom-snapshot            optional verified selector-discovery artifact below .ai-runs/dom-discovery
  --apply                   promote a fully verified single-file candidate
  --allow-dirty             permit --apply over a target already dirty at start; requires --apply

Environment failures (missing browser, broken config, unreadable report) abort healing instead of
masking infrastructure problems. Spec-bound targets are additionally re-checked by the static
reviewer, so a heal can never weaken the locator policy or drop the traceability header. Recorded
targets use the recorded reviewer before runtime verification.
Recorded/smoke/accessibility/visual targets run under local-chromium automatically; use
--project to override the inferred project for other layouts.`;
}

function printHelp() {
  console.log(helpText());
}

export async function runCli() {
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
  let secretValues;
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
    secretValues = knownSecretEnvValues(env);
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
      results.push(sanitizePublicResult(
        { status: 'error', target: testPath, attemptsUsed: 0, issues: [error.message] },
        secretValues
      ));
    }
  }

  const rendered = renderHealResults(results);
  for (const event of rendered.events) {
    if (event.stream === 'stdout') console.log(event.line);
    else console.error(event.line);
  }
  process.exitCode = rendered.exitCode;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  await runCli();
}
