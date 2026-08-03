#!/usr/bin/env node

// Flag-gated auto-healer for committed Playwright tests. With
// AI_AUTOHEAL_ENABLED=true it runs the target test, and when the test fails at
// runtime it asks the heal brain for a repaired file, verifies the candidate
// with consecutive green runs (--repeat-each, --retries=0), and only then
// atomically promotes it over the original. The original file is never touched
// until a candidate has proven itself; every attempt is archived under
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
import { readVerifiedJsonFile } from './lib/verified-file-read.mjs';
import { buildGateEnvironment, knownSecretEnvValues } from './lib/gate-environment.mjs';
import { resolveHealContract, reviewHealContract } from './lib/test-heal-contract.mjs';
import { collectHealContext } from './lib/test-heal-context.mjs';
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

export function parseArgs(argv) {
  const args = {
    tests: [],
    spec: undefined,
    specDir: 'specs',
    project: undefined,
    maxAttempts: undefined,
    verifyRuns: undefined,
    domSnapshot: undefined,
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
    else throw new Error(`Unknown flag: ${flag}`);
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
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return {
    directory,
    write(fileName, contents) {
      const archivePath = path.join(directory, fileName);
      fs.writeFileSync(archivePath, contents, { mode: 0o600 });
      return archivePath;
    }
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
  collectEvidence = collectRuntimeEvidence,
  archiveFactory = createHealArchive,
  validateDirectory = validateSpecDirectory,
  domSnapshotPath,
  collectContext = collectHealContext
}) {
  if (!autoHealEnabled(env)) {
    throw new Error('Auto-heal is disabled; set AI_AUTOHEAL_ENABLED=true to allow the healer to modify test files.');
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
  const targetStat = assertHealableTarget(absoluteTarget, webRoot);
  sweepStaleHealCandidates(absoluteTarget, log);
  const originalBytes = fs.readFileSync(absoluteTarget);
  const originalSource = originalBytes.toString('utf8');
  const originalSha = sha256(originalBytes);
  const runRoot = path.join(webRoot, '.ai-runs');
  const runId = `${Date.now()}-${process.pid}-${crypto.randomUUID()}`;
  const secretValues = knownSecretEnvValues(env);

  const contract = resolveHealContract({
    testPath: target,
    source: originalSource,
    explicitSpecPath,
    specDir,
    discoverSpec,
    validateDirectory,
    webRoot
  });

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
    return { status: 'already-green', target, attemptsUsed: 0 };
  }
  if (execution.stage === 'runtime-environment') {
    return {
      status: 'environment-failure',
      target,
      attemptsUsed: 0,
      issues: execution.issues,
      detail: 'Baseline run failed for environment reasons; healing would mask an infrastructure problem.'
    };
  }

  const archive = archiveFactory(webRoot, runId);
  archive.write('original.ts', originalBytes);
  let currentSource = originalSource;
  let evidence = collectEvidence(execution, target, { secretValues });
  cleanupFailedRunDir(execution, runRoot);
  if (evidence.length === 0) evidence = ['The test failed but produced no readable error evidence.'];
  const repositoryContext = collectContext({
    testPath: target,
    source: originalSource,
    evidence,
    webRoot,
    domSnapshotPath,
    secretValues
  });
  let notes = [];
  const attemptTrail = [];
  const finish = (result) => {
    archive.write('heal-summary.json', JSON.stringify({
      schema: 'test-heal-run/v1',
      target,
      status: result.status,
      attemptsUsed: result.attemptsUsed,
      verifyRuns: repeatEach,
      originalSha256: originalSha,
      ...(result.healedSha256 ? { healedSha256: result.healedSha256 } : {}),
      attemptTrail
    }, null, 2));
    return { ...result, target, archiveDir: archive.directory, attemptTrail };
  };

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
        attemptTrail.push({ attempt, outcome: 'brain-error', detail: error.message });
        return finish({ status: 'brain-error', attemptsUsed: attempt, issues: [error.message] });
      }

      // The ORIGINAL source is the immutable baseline for every attempt, so a
      // later attempt cannot ratchet the rules by comparing against an earlier
      // (already accepted-for-iteration) candidate.
      const policy = verifyHealedSourcePolicy({ previousSource: originalSource, healedSource: healed.code });
      if (!policy.passed) {
        const secretRelated = policy.issues.some((issue) => /secret/i.test(issue));
        archive.write(
          secretRelated ? `attempt-${attempt}.rejected-policy.txt` : `attempt-${attempt}.rejected-policy.ts`,
          secretRelated ? policy.issues.join('\n') : healed.code
        );
        attemptTrail.push({ attempt, outcome: 'policy-rejected', detail: policy.issues.join(' ') });
        log(`[heal] ${target}: attempt ${attempt} rejected by deterministic policy guard: ${policy.issues.join(' ')}`);
        notes = policy.issues;
        continue;
      }

      const candidateAbsolute = healCandidatePath(absoluteTarget, `${runId}-a${attempt}`);
      const candidateRelative = normalizePortablePath(path.relative(webRoot, candidateAbsolute));
      fs.writeFileSync(candidateAbsolute, healed.code, { mode: 0o600 });
      activeCandidate = candidateAbsolute;
      try {
        const types = typecheck({ candidatePath: candidateAbsolute, targetPath: absoluteTarget, webRoot });
        if (!types.passed) {
          archive.write(`attempt-${attempt}.rejected-typecheck.ts`, healed.code);
          attemptTrail.push({ attempt, outcome: 'typecheck-rejected', detail: types.issues.join(' ') });
          log(`[heal] ${target}: attempt ${attempt} rejected by typecheck.`);
          notes = types.issues.slice(0, MAX_HEAL_EVIDENCE_ITEMS);
          continue;
        }

        const review = reviewHealContract({
          contract,
          candidatePath: candidateRelative,
          generatedReviewer,
          recordedReviewer
        });
        if (!review.passed) {
          archive.write(`attempt-${attempt}.rejected-review.ts`, healed.code);
          attemptTrail.push({ attempt, outcome: 'static-review-rejected', detail: review.issues.join(' ') });
          log(`[heal] ${target}: attempt ${attempt} rejected by static review.`);
          notes = review.issues.slice(0, MAX_HEAL_EVIDENCE_ITEMS);
          continue;
        }

        execution = runVerification(candidateRelative);
        if (execution.passed) {
          const currentTargetSha = sha256(fs.readFileSync(absoluteTarget));
          if (currentTargetSha !== originalSha) {
            attemptTrail.push({ attempt, outcome: 'aborted-concurrent-edit' });
            return finish({
              status: 'aborted-concurrent-edit',
              attemptsUsed: attempt,
              issues: [`${target} changed on disk while healing was running; the concurrent edit was preserved.`]
            });
          }
          if (sha256(fs.readFileSync(candidateAbsolute)) !== sha256(Buffer.from(healed.code, 'utf8'))) {
            attemptTrail.push({ attempt, outcome: 'aborted-candidate-mutation' });
            return finish({
              status: 'aborted-candidate-mutation',
              attemptsUsed: attempt,
              issues: ['The healed candidate changed on disk during verification; it was not promoted.']
            });
          }
          archive.write(`attempt-${attempt}.promoted.ts`, healed.code);
          fs.renameSync(candidateAbsolute, absoluteTarget);
          activeCandidate = null;
          fs.chmodSync(absoluteTarget, targetStat.mode & 0o777);
          attemptTrail.push({ attempt, outcome: 'healed' });
          return {
            ...finish({
              status: 'healed',
              attemptsUsed: attempt,
              healedSha256: sha256(Buffer.from(healed.code, 'utf8'))
            }),
            backupPath: path.join(archive.directory, 'original.ts')
          };
        }

        if (execution.stage === 'runtime-environment') {
          archive.write(`attempt-${attempt}.env-failure.ts`, healed.code);
          attemptTrail.push({ attempt, outcome: 'environment-failure', detail: (execution.issues ?? []).join(' ') });
          cleanupFailedRunDir(execution, runRoot);
          return finish({ status: 'environment-failure', attemptsUsed: attempt, issues: execution.issues });
        }

        archive.write(`attempt-${attempt}.still-failing.ts`, healed.code);
        attemptTrail.push({ attempt, outcome: 'still-failing', detail: (execution.issues ?? []).slice(0, 2).join(' ') });
        const freshEvidence = collectEvidence(execution, candidateRelative, { secretValues });
        cleanupFailedRunDir(execution, runRoot);
        evidence = freshEvidence.length > 0 ? freshEvidence : (execution.issues ?? []).slice(0, MAX_HEAL_EVIDENCE_ITEMS);
        if (evidence.length === 0) evidence = ['The healed candidate failed but produced no readable error evidence.'];
        notes = [`Attempt ${attempt} was applied and the test still failed; the source below already contains that attempt.`];
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

Runs each target test first (baseline). A test that already passes the required consecutive
runs is reported as already-green and never modified. For a runtime failure the healer asks the
heal brain (stage 'heal', see AI_HEAL_* env) for a repaired file, rejects candidates that violate
the AST-level anti-masking policy (no removed/downgraded/conditional assertions, no skip family,
no sleeps or XPath) or fail typechecking, and verifies survivors with consecutive green runs
(retries=0, flaky = fail; standalone lanes run --workers=1 so the runs are literally serial).
Only a fully verified candidate is atomically promoted over the original; every attempt and the
original file are archived under .ai-runs/heal/<run-id>/.

Settings:
  AI_AUTOHEAL_ENABLED       must be true for any file modification (default false)
  AI_AUTOHEAL_MAX_ATTEMPTS  heal attempts per test, 1..${MAX_AUTOHEAL_MAX_ATTEMPTS} (default 3); --max-attempts overrides.
                            Policy/typecheck/review rejections consume attempts too.
  AI_AUTOHEAL_VERIFY_RUNS   consecutive green runs required, 2 or 3 (default 2); --verify-runs overrides
  --dom-snapshot            optional verified DOM artifact below .ai-runs/dom-discovery

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
      console.error('Auto-heal is disabled; set AI_AUTOHEAL_ENABLED=true (environment or .env) to allow the healer to modify test files.');
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
    } else if (result.status === 'already-green') {
      console.log(`ALREADY GREEN ${result.target} (no changes made).`);
    } else {
      allGreen = false;
      console.error(`NOT HEALED ${result.target} (${result.status})${suffix}.`);
      for (const issue of result.issues ?? []) console.error(`- ${issue}`);
      if (result.archiveDir) console.error(`  Evidence: ${result.archiveDir}`);
    }
  }
  process.exitCode = allGreen ? 0 : 1;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  await runCli();
}
