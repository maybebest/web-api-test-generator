#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { GENERATION_MODES, resolveGenerationMode, specGenerationMode, specSha256 } from './lib/spec-parser.mjs';
import { verifyGlobalChecksReceipt } from './lib/generated-gate-fingerprint.mjs';
import {
  FULL_GATE_REPEAT_EACH,
  GENERATED_GATE_REPEAT_VALUES,
  PROMOTION_GATE_REPEAT_EACH
} from './lib/generated-gate-policy.mjs';
import { resolveEnv } from './lib/ai-client.mjs';
import { buildGateEnvironment } from './lib/gate-environment.mjs';
import {
  acceptedGeneratedGateVerdict,
  classifyGeneratedGateFailure
} from './lib/generated-gate-verdict.mjs';
import { reviewGeneratedTest } from './review-generated-test.mjs';
import {
  generationSubjectFingerprint,
  linkGenerationRunFullGate
} from './lib/generation-run.mjs';
import { ensureVerifiedDirectory, readVerifiedJsonFile } from './lib/verified-file-read.mjs';
import { validateSpecDirectory, validateSpecFile } from './validate-flow-spec.mjs';

const defaultWebRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FULL_GATE_OUTCOMES = new Map([
  ['accepted:PASSED', true],
  ['static-review:STATIC_REVIEW_FAILED', false],
  ['runtime-test:RUNTIME_TEST_FAILED', false],
  ['input-validation:INPUT_VALIDATION_FAILED', null],
  ['global-static:GLOBAL_STATIC_CHECK_FAILED', null],
  ['runtime-environment:RUNTIME_ENVIRONMENT_FAILED', null]
]);

export function parseArgs(args) {
  const parsed = {
    spec: undefined,
    test: undefined,
    mode: undefined,
    allProjects: false,
    projects: [],
    repeatEach: FULL_GATE_REPEAT_EACH,
    globalChecksComplete: undefined,
    verdictFile: undefined,
    runId: undefined
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--spec') {
      parsed.spec = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--test') {
      parsed.test = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--mode') {
      parsed.mode = args[index + 1];
      if (!GENERATION_MODES.has(parsed.mode)) {
        throw new Error(`Unsupported generation mode: ${parsed.mode}. Use "single" or "suite".`);
      }
      index += 1;
      continue;
    }

    if (arg === '--all-projects') {
      parsed.allProjects = true;
      continue;
    }

    if (arg === '--repeat-each') {
      const repeatEach = Number(args[index + 1]);
      if (!GENERATED_GATE_REPEAT_VALUES.has(repeatEach)) {
        throw new Error(
          `--repeat-each must be ${PROMOTION_GATE_REPEAT_EACH} (promotion) or ${FULL_GATE_REPEAT_EACH} (full).`
        );
      }
      parsed.repeatEach = repeatEach;
      index += 1;
      continue;
    }

    if (arg === '--global-checks-complete') {
      const fingerprint = args[index + 1];
      if (!/^[a-f0-9]{64}$/i.test(fingerprint ?? '')) {
        throw new Error('--global-checks-complete requires a 64-character SHA-256 fingerprint.');
      }
      parsed.globalChecksComplete = fingerprint.toLowerCase();
      index += 1;
      continue;
    }

    if (arg === '--verdict-file') {
      const verdictFile = args[index + 1];
      if (!verdictFile || verdictFile.startsWith('--')) {
        throw new Error('--verdict-file requires a private output path.');
      }
      parsed.verdictFile = verdictFile;
      index += 1;
      continue;
    }

    if (arg === '--run-id') {
      const runId = args[index + 1];
      if (typeof runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(runId)) {
        throw new Error('--run-id must be a generation run id containing only letters, numbers, and hyphens.');
      }
      parsed.runId = runId;
      index += 1;
      continue;
    }

    if (arg === '--projects') {
      if (!args[index + 1]) {
        throw new Error('--projects requires a comma-separated project list.');
      }
      parsed.projects = parseProjectList(args[index + 1]);
      if (parsed.projects.length === 0) {
        throw new Error('--projects requires at least one project.');
      }
      index += 1;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (parsed.allProjects && parsed.projects.length > 0) {
    throw new Error('Use either --all-projects or --projects, not both.');
  }
  if (parsed.runId && parsed.repeatEach !== FULL_GATE_REPEAT_EACH) {
    throw new Error('--run-id can link quality only from the full three-repeat gate.');
  }

  return parsed;
}

export function writeGeneratedGateVerdict(verdictFile, verdict) {
  const absolutePath = path.resolve(verdictFile);
  const parent = path.dirname(absolutePath);
  if (!fs.existsSync(parent)) {
    throw new Error(`Gate verdict parent directory does not exist: ${parent}`);
  }
  const parentStat = fs.lstatSync(parent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new Error(`Gate verdict parent must be a regular directory, not a symbolic link: ${parent}`);
  }
  try {
    // O_EXCL (`wx`) fails if the destination already exists, including a
    // symbolic link. Writing the tiny bounded verdict directly avoids a
    // check-then-rename race that could replace another file.
    fs.writeFileSync(absolutePath, `${JSON.stringify(verdict, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    fs.chmodSync(absolutePath, 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Gate verdict target already exists: ${absolutePath}`);
    }
    throw error;
  }
}

function sameFileSnapshot(left, right) {
  return left.absolutePath === right.absolutePath
    && left.device === right.device
    && left.inode === right.inode
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.sha256 === right.sha256;
}

export function captureFullGateTargetSnapshot(testPath) {
  const absolutePath = path.resolve(testPath ?? '');
  const before = fs.lstatSync(absolutePath);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error('Full gate quality can link only from a regular generated test file.');
  }

  let descriptor;
  try {
    descriptor = fs.openSync(
      absolutePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
    );
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error('Generated test changed while its full-gate snapshot was opened.');
    }
    const source = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (
      opened.dev !== after.dev
      || opened.ino !== after.ino
      || opened.size !== after.size
      || opened.mtimeMs !== after.mtimeMs
      || opened.ctimeMs !== after.ctimeMs
    ) {
      throw new Error('Generated test changed while its full-gate snapshot was captured.');
    }
    return Object.freeze({
      absolutePath,
      device: after.dev,
      inode: after.ino,
      size: after.size,
      mtimeMs: after.mtimeMs,
      ctimeMs: after.ctimeMs,
      sha256: createHash('sha256').update(source).digest('hex')
    });
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function targetIdentityWithinWebRoot(testPath, webRoot) {
  const root = path.resolve(webRoot);
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('Full gate web root must be a real directory.');
  }
  const absoluteTest = path.resolve(testPath);
  const relative = path.relative(root, absoluteTest).split(path.sep).join('/');
  if (!relative || relative.startsWith('../') || path.posix.isAbsolute(relative)) {
    throw new Error('Full gate target must remain inside the web package root.');
  }
  if (!relative.startsWith('tests/') || !relative.endsWith('.spec.ts')) {
    throw new Error('Full gate target identity must be a tests/**/*.spec.ts path.');
  }
  const realRoot = fs.realpathSync(root);
  const realTest = fs.realpathSync(absoluteTest);
  const realRelative = path.relative(realRoot, realTest);
  if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new Error('Full gate target resolves outside the web package root.');
  }
  return relative;
}

export function linkFullGateOutcome({
  args,
  verdict,
  telemetryRoot,
  webRoot = defaultWebRoot,
  targetSnapshot = args?.fullGateTargetSnapshot,
  specFingerprint = args?.fullGateSpecSha256
} = {}) {
  if (!args?.runId) return null;
  if (args.repeatEach !== FULL_GATE_REPEAT_EACH) {
    throw new Error('A generation run id can link quality only from the full three-repeat gate.');
  }
  if (!targetSnapshot) {
    throw new Error('Full gate quality requires a target snapshot captured before execution.');
  }
  const currentSnapshot = captureFullGateTargetSnapshot(args.test);
  if (!sameFileSnapshot(targetSnapshot, currentSnapshot)) {
    throw new Error('Generated test changed during the full gate; refusing to link a stale quality result.');
  }

  const currentSpecFingerprint = specSha256(args.spec);
  const originalSpecFingerprint = specFingerprint ?? currentSpecFingerprint;
  if (originalSpecFingerprint !== currentSpecFingerprint) {
    throw new Error('Flow spec changed during the full gate; refusing to link a stale quality result.');
  }
  const outcomeKey = `${verdict?.stage}:${verdict?.reasonCode}`;
  if (!FULL_GATE_OUTCOMES.has(outcomeKey)) {
    throw new Error('Full gate verdict has an unsupported stage/reason combination.');
  }
  const fullGatePassed = FULL_GATE_OUTCOMES.get(outcomeKey);
  if (verdict?.passed !== (fullGatePassed === true)) {
    throw new Error('Full gate verdict pass state is inconsistent with its stage and reason.');
  }
  const targetIdentity = targetIdentityWithinWebRoot(args.test, webRoot);
  const subjectFingerprint = generationSubjectFingerprint({
    specSha256: originalSpecFingerprint,
    targetIdentity
  });
  return linkGenerationRunFullGate({
    ...(telemetryRoot ? { telemetryRoot } : {}),
    runId: args.runId,
    fullGatePassed,
    sourceSha256: targetSnapshot.sha256,
    subjectFingerprint,
    outcomeStage: verdict.stage,
    reasonCode: verdict.reasonCode
  });
}

function parseProjectList(value) {
  return (value ?? '')
    .split(',')
    .map((project) => project.trim())
    .filter(Boolean);
}

function detectPackageManager() {
  if (fs.existsSync('package-lock.json')) {
    return 'npm';
  }

  if (fs.existsSync('pnpm-lock.yaml')) {
    return 'pnpm';
  }

  if (fs.existsSync('yarn.lock')) {
    return 'yarn';
  }

  return 'npm';
}

function packageRunCommand(packageManager, script, extraArgs = []) {
  if (packageManager === 'pnpm') {
    return ['pnpm', ['run', script, ...extraArgs]];
  }

  if (packageManager === 'yarn') {
    return ['yarn', [script, ...extraArgs]];
  }

  return extraArgs.length > 0 ? ['npm', ['run', script, '--', ...extraArgs]] : ['npm', ['run', script]];
}

function playwrightCommand(packageManager, args) {
  if (packageManager === 'pnpm') {
    return ['pnpm', ['exec', 'playwright', ...args]];
  }

  if (packageManager === 'yarn') {
    return ['yarn', ['playwright', ...args]];
  }

  return ['npx', ['playwright', ...args]];
}

// The full command/env for one Playwright execution stage. The CLI
// --reporter=html,json flag REPLACES the config's ['html', { open: 'never' }]
// reporter entry, so without pinning the html reporter via env it falls back
// to open:'on-failure' locally — auto-opening the report and BLOCKING the
// gate on any local failure. PLAYWRIGHT_HTML_OPEN (current) and
// PW_TEST_HTML_REPORT_OPEN (legacy) both pin it to 'never'.
export function buildPlaywrightStage({
  packageManager,
  testPath,
  testPaths,
  project,
  extraEnv = {},
  jsonReportPath,
  htmlReportDir,
  testResultsDir,
  repeatEach = FULL_GATE_REPEAT_EACH,
  workers,
  diagnostic = false
}) {
  const diagnosticSingleRun = diagnostic === true && repeatEach === 1;
  if (!diagnosticSingleRun && !GENERATED_GATE_REPEAT_VALUES.has(repeatEach)) {
    throw new Error(
      `repeat-each must be ${PROMOTION_GATE_REPEAT_EACH} (promotion) or ${FULL_GATE_REPEAT_EACH} (full).`
    );
  }
  if (workers !== undefined && (!Number.isSafeInteger(workers) || workers <= 0)) {
    throw new Error('workers must be a positive safe integer.');
  }
  const normalizedTestPaths = normalizePlaywrightTargets(testPaths ?? [testPath]);
  const playwrightArgs = [
    'test',
    ...normalizedTestPaths,
    `--project=${project}`,
    '--reporter=html,json',
    '--retries=0',
    `--repeat-each=${repeatEach}`
  ];
  if (workers !== undefined) playwrightArgs.push(`--workers=${workers}`);
  if (normalizedTestPaths.length === 1 && !diagnosticSingleRun) playwrightArgs.push('--max-failures=1');
  if (testResultsDir) {
    playwrightArgs.push(`--output=${path.resolve(testResultsDir)}`);
  }
  const [command, args] = playwrightCommand(packageManager, playwrightArgs);

  return {
    command,
    args,
    testPath: normalizedTestPaths[0],
    testPaths: normalizedTestPaths,
    env: {
      ...extraEnv,
      PLAYWRIGHT_JSON_OUTPUT_NAME: path.resolve(jsonReportPath),
      ...(htmlReportDir ? { PLAYWRIGHT_HTML_OUTPUT_DIR: path.resolve(htmlReportDir) } : {}),
      PLAYWRIGHT_HTML_OPEN: 'never',
      PW_TEST_HTML_REPORT_OPEN: 'never'
    }
  };
}

function normalizePlaywrightTargets(values) {
  if (!Array.isArray(values)) throw new Error('Playwright test targets must be an array.');
  const normalized = [];
  const seen = new Set();
  for (const value of values) {
    const target = normalizePortablePath(value);
    if (
      !target
      || target === '.'
      || target.startsWith('-')
      || target === '..'
      || target.startsWith('../')
      || !/\.spec\.ts$/i.test(target)
    ) {
      throw new Error(`Unsafe Playwright test target: ${target || '<empty>'}.`);
    }
    if (!seen.has(target)) {
      seen.add(target);
      normalized.push(target);
    }
  }
  if (normalized.length === 0) throw new Error('Playwright requires at least one test target.');
  return normalized;
}

export function normalizePlaywrightTarget(value) {
  return normalizePlaywrightTargets([value])[0];
}

function tscCommand(packageManager) {
  const args = ['tsc', '--noEmit', '--pretty', 'false', '-p', 'tsconfig.json'];

  if (packageManager === 'pnpm') {
    return ['pnpm', ['exec', ...args]];
  }

  if (packageManager === 'yarn') {
    return ['yarn', args];
  }

  return ['npx', args];
}

export function projectPlanForSpec(metadata, { allProjects = false, projects = [], env = {} } = {}) {
  const testType = metadata['Test Type']?.toLowerCase();
  const auth = metadata.Auth?.toLowerCase();

  if (auth === 'required') {
    if (env.E2E_AUTH_ENABLED !== 'true') {
      throw new Error('Spec requires auth, but E2E_AUTH_ENABLED is not true. Enable auth and configure chromium-auth.');
    }
    return [{ project: 'chromium-auth', env: {} }];
  }

  const requestedProjects =
    projects.length > 0
      ? projects
      : allProjects
        ? projectsForAllBrowsers(testType)
        : defaultProjectsForGeneratedTests(testType, metadata['Target Test File']);

  return requestedProjects.map((project) => ({ project, env: envForProject(testType, project) }));
}

function defaultProjectsForGeneratedTests(testType, targetTestFile) {
  const normalizedTarget = String(targetTestFile ?? '').replace(/\\/g, '/');
  if (/^tests\/(?:smoke|accessibility|visual)\/.+\.spec\.ts$/.test(normalizedTarget)) {
    return ['local-chromium'];
  }
  if (['smoke', 'regression', 'accessibility', 'visual'].includes(testType)) {
    return ['chromium'];
  }

  throw new Error(`Unsupported Test Type: ${testType}`);
}

function projectsForAllBrowsers(testType) {
  if (testType === 'regression') {
    return ['chromium', 'firefox', 'webkit'];
  }

  if (['smoke', 'accessibility', 'visual'].includes(testType)) {
    return ['chromium'];
  }

  throw new Error(`Unsupported Test Type: ${testType}`);
}

function envForProject(testType, project) {
  if (testType === 'visual' && project === 'chromium') {
    return { ENABLE_VISUAL_TESTS: 'true' };
  }

  return {};
}

function runCommand(command, args, env) {
  console.log('');
  console.log(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    env
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

function safeRunSegment(value) {
  const segment = String(value ?? '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return segment.slice(0, 80) || 'generated-test';
}

export function prepareSinglePairGateRunDirectory({
  specPath,
  aiRunsRoot = path.resolve('.ai-runs')
}) {
  const aiRunsRootExisted = fs.existsSync(aiRunsRoot);
  const verifiedRoot = ensureVerifiedDirectory(aiRunsRoot, 'Generated-test run root');
  const specName = safeRunSegment(path.basename(specPath, path.extname(specPath)));
  const parentRunDir = path.join(
    verifiedRoot.resolved,
    `gate-${Date.now()}-${process.pid}-${randomUUID()}-${specName}`
  );
  ensureVerifiedDirectory(parentRunDir, 'Generated-test gate parent');
  const runDir = path.join(parentRunDir, `gate-execution-${Date.now()}-${process.pid}-${randomUUID()}`);
  ensureVerifiedDirectory(runDir, 'Generated-test gate execution directory');
  return Object.freeze({
    aiRunsRoot: verifiedRoot.resolved,
    aiRunsRootExisted,
    parentRunDir,
    runDir
  });
}

export function copyEvidence(runDir, rootDir = '.') {
  const sources = ['playwright-report', 'test-results'].filter((artifactDir) =>
    fs.existsSync(path.join(rootDir, artifactDir))
  );

  if (sources.length === 0) {
    console.error('No playwright-report/test-results artifacts exist to copy as failure evidence.');
    return undefined;
  }

  const evidenceDir = path.join(runDir, 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  for (const artifactDir of sources) {
    fs.cpSync(path.join(rootDir, artifactDir), path.join(evidenceDir, artifactDir), { recursive: true, force: true });
  }

  console.error(`Failure evidence copied to ${evidenceDir}`);
  return evidenceDir;
}

// Execution honesty: Playwright exits 0 when every test self-skips, so the
// gate parses the machine-readable JSON report and fails unless at least one
// test for the target file genuinely passed and nothing failed or skipped.
const MAX_PLAYWRIGHT_REPORT_COUNT = 1_000_000;
const PLAYWRIGHT_OUTCOMES = ['expected', 'unexpected', 'flaky', 'skipped'];

function emptyExecutionCounts() {
  return { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function reportExecutionContract(report, expected) {
  if (expected === undefined) return { issues: [], projectId: undefined, stats: undefined };
  const issues = [];
  if (
    !plainObject(report)
    || !Array.isArray(report.suites)
    || !Array.isArray(report.errors)
    || !plainObject(report.stats)
  ) {
    issues.push('Playwright JSON report execution contract is missing the required report envelope.');
  }
  let stats;
  if (plainObject(report?.stats)) {
    const candidate = {};
    let statsValid = true;
    for (const outcome of PLAYWRIGHT_OUTCOMES) {
      const value = report.stats[outcome];
      if (!Number.isSafeInteger(value) || value < 0 || value > MAX_PLAYWRIGHT_REPORT_COUNT) {
        statsValid = false;
      } else {
        candidate[outcome] = value;
      }
    }
    if (!statsValid) {
      issues.push(
        `Playwright JSON report stats must contain bounded integer expected/unexpected/flaky/skipped counts (0-${MAX_PLAYWRIGHT_REPORT_COUNT}).`
      );
    } else {
      stats = candidate;
    }
  }
  const projects = report?.config?.projects;
  const matchingProjects = Array.isArray(projects)
    ? projects.filter((project) => project?.name === expected.project)
    : [];
  if (matchingProjects.length !== 1) {
    issues.push('Playwright JSON report execution contract is missing one exact requested project configuration.');
    return { issues, projectId: undefined, stats };
  }
  const [project] = matchingProjects;
  if (typeof project.id !== 'string' || project.id.length === 0) {
    issues.push('Playwright JSON report execution contract has no usable requested project identity.');
  }
  if (project.repeatEach !== expected.repeatEach || project.retries !== expected.retries) {
    issues.push('Playwright JSON report execution contract does not match the requested repeat/retry policy.');
  }
  return { issues, projectId: project.id, stats };
}

export function verifyPlaywrightJsonReports(report, targetTestFiles, expectedExecution) {
  const targets = normalizePlaywrightTargets(targetTestFiles);
  const executionContract = reportExecutionContract(report, expectedExecution);
  const environmentIssues = Array.isArray(report?.errors) && report.errors.length > 0
    ? [
        `Playwright JSON report contains ${report.errors.length} top-level setup, teardown, or configuration error(s).`,
        ...executionContract.issues
      ]
    : [...executionContract.issues];
  let targetProjectContractMismatch = false;
  let targetRepeatContractMismatch = false;
  let targetResultContractMismatch = false;
  let reportTreeContractMismatch = false;
  let duplicateLogicalSpecId = false;
  let unaccountedExecutionCount = 0;
  let totalExecutionCount = 0;
  const completeCounts = emptyExecutionCounts();
  const logicalSpecIds = new Set();
  const states = new Map(targets.map((target) => [target, {
    issues: [],
    counts: emptyExecutionCounts(),
    ambiguousFiles: new Set()
  }]));

  const targetForReportFile = (reportFile) => {
    if (!reportFile) return undefined;
    const matches = targets.filter((target) => reportFileMatchesTarget(reportFile, target));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      const normalizedFile = normalizeReportPath(reportFile);
      for (const target of matches) states.get(target).ambiguousFiles.add(normalizedFile);
    }
    return undefined;
  };

  const visitSuite = (suite, inheritedFile) => {
    if (!plainObject(suite)) {
      reportTreeContractMismatch = true;
      return;
    }
    const suiteFile = suite?.file ?? inheritedFile;
    const specs = suite.specs ?? [];
    const childSuites = suite.suites ?? [];
    if (!Array.isArray(specs) || !Array.isArray(childSuites)) {
      reportTreeContractMismatch = true;
      return;
    }
    for (const spec of specs) {
      if (!plainObject(spec)) {
        reportTreeContractMismatch = true;
        continue;
      }
      const tests = Array.isArray(spec.tests) ? spec.tests : [];
      if (!Array.isArray(spec.tests)) reportTreeContractMismatch = true;
      if (expectedExecution !== undefined) {
        if (typeof spec.id !== 'string' || spec.id.length === 0 || spec.id.length > 1024) {
          reportTreeContractMismatch = true;
        } else if (logicalSpecIds.has(spec.id)) {
          duplicateLogicalSpecId = true;
        } else {
          logicalSpecIds.add(spec.id);
        }
      }
      const target = targetForReportFile(spec.file ?? suiteFile);
      const counts = target ? states.get(target).counts : undefined;
      if (!target && expectedExecution !== undefined) unaccountedExecutionCount += tests.length;
      if (expectedExecution !== undefined && tests.length !== expectedExecution.repeatEach) {
        targetRepeatContractMismatch = true;
      }

      for (const testEntry of tests) {
        totalExecutionCount += 1;
        if (totalExecutionCount > MAX_PLAYWRIGHT_REPORT_COUNT || !plainObject(testEntry)) {
          reportTreeContractMismatch = true;
          continue;
        }
        if (PLAYWRIGHT_OUTCOMES.includes(testEntry.status)) {
          completeCounts[testEntry.status] += 1;
          if (counts) counts[testEntry.status] += 1;
        } else {
          reportTreeContractMismatch = true;
        }
        if (!target) continue;
        if (
          expectedExecution !== undefined
          && (
            testEntry?.projectName !== expectedExecution.project
            || testEntry?.projectId !== executionContract.projectId
          )
        ) {
          targetProjectContractMismatch = true;
        }
        if (expectedExecution !== undefined) {
          const hasOfficialResultShape = typeof testEntry?.expectedStatus === 'string'
            && Array.isArray(testEntry?.results);
          const resultProvesRetryZeroPass = testEntry?.status !== 'expected'
            || (
              hasOfficialResultShape
              &&
              testEntry.expectedStatus === 'passed'
              && testEntry.results.length === 1
              && testEntry.results[0]?.status === 'passed'
              && testEntry.results[0]?.retry === 0
            );
          if (!hasOfficialResultShape || !resultProvesRetryZeroPass) {
            targetResultContractMismatch = true;
          }
        }
      }
    }

    for (const child of childSuites) {
      visitSuite(child, suiteFile);
    }
  };

  for (const suite of Array.isArray(report?.suites) ? report.suites : []) {
    visitSuite(suite, undefined);
  }
  if (expectedExecution !== undefined) {
    if (reportTreeContractMismatch) {
      environmentIssues.push(
        'Playwright JSON report execution contract contains malformed or unbounded suite execution evidence.'
      );
    }
    if (duplicateLogicalSpecId) {
      environmentIssues.push(
        'Playwright JSON report execution contract contains duplicate logical spec ids.'
      );
    }
    if (unaccountedExecutionCount > 0) {
      environmentIssues.push(
        `Playwright JSON report execution contract contains ${unaccountedExecutionCount} execution(s) outside the requested target set.`
      );
    }
    if (executionContract.stats) {
      for (const outcome of PLAYWRIGHT_OUTCOMES) {
        if (executionContract.stats[outcome] !== completeCounts[outcome]) {
          environmentIssues.push(
            'Playwright JSON report stats do not reconcile with the complete suite execution evidence.'
          );
          break;
        }
      }
    }
  }
  if (targetProjectContractMismatch) {
    environmentIssues.push(
      'Playwright JSON report execution contract does not prove that every target result used the requested project.'
    );
  }
  if (targetRepeatContractMismatch) {
    environmentIssues.push(
      'Playwright JSON report execution contract does not prove the requested repeat count for every target test.'
    );
  }
  if (targetResultContractMismatch) {
    environmentIssues.push(
      'Playwright JSON report execution contract does not contain complete retry-0 pass evidence for every target result.'
    );
  }

  const verdicts = new Map();
  for (const target of targets) {
    const state = states.get(target);
    const { counts } = state;
    const issues = [...environmentIssues, ...state.issues];
    for (const ambiguousFile of [...state.ambiguousFiles].sort(codePointCompare)) {
      issues.push(
        `Playwright JSON report path "${ambiguousFile}" is ambiguous for requested target ${target}; shortened shared-report paths must identify exactly one target.`
      );
    }
    if (counts.expected < 1) {
      issues.push(
        `Playwright JSON report contains no passing test for ${target} (expected=${counts.expected}). The gate requires at least one genuinely executed passing test.`
      );
    }
    if (counts.unexpected > 0) {
      issues.push(`Playwright JSON report shows ${counts.unexpected} unexpected (failed) test(s) for ${target}.`);
    }
    if (counts.flaky > 0) {
      issues.push(
        `Playwright JSON report shows ${counts.flaky} flaky test(s) for ${target}: target test passed only after retry (flaky) — generated tests must pass deterministically (spec Allowed Retries: 0).`
      );
    }
    if (counts.skipped > 0) {
      issues.push(
        `Playwright JSON report shows ${counts.skipped} skipped test(s) for ${target}. Skipped tests exit 0 without verifying anything; remove test.skip/test.fixme to pass the gate.`
      );
    }
    verdicts.set(target, {
      passed: issues.length === 0,
      environmentFailure: environmentIssues.length > 0,
      issues,
      counts
    });
  }
  return verdicts;
}

export function verifyPlaywrightJsonReport(report, targetTestFile, expectedExecution) {
  const normalizedTarget = normalizePlaywrightTargets([targetTestFile])[0];
  return verifyPlaywrightJsonReports(report, [normalizedTarget], expectedExecution).get(normalizedTarget);
}

function codePointCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeReportPath(value) {
  return normalizePortablePath(value);
}

function normalizePortablePath(value) {
  const portable = String(value ?? '').trim().replace(/\\/g, '/');
  if (!portable || portable.includes('\0')) return '';
  return path.posix.normalize(portable);
}

function reportFileMatchesTarget(reportFile, target) {
  if (!reportFile) {
    return false;
  }

  const normalized = normalizeReportPath(reportFile);
  return normalized === target || target.endsWith(`/${normalized}`) || normalized.endsWith(`/${target}`);
}

export function readJsonReportVerdict(
  jsonReportPath,
  targetTestFile,
  maxReportBytes = 32 * 1024 * 1024,
  expectedExecution
) {
  try {
    const report = readVerifiedJsonFile({
      filePath: jsonReportPath,
      rootPath: path.dirname(jsonReportPath),
      maxBytes: maxReportBytes,
      label: 'Playwright JSON report'
    });
    return {
      ...verifyPlaywrightJsonReport(report, targetTestFile, expectedExecution),
      readable: true
    };
  } catch (error) {
    return {
      passed: false,
      readable: false,
      issues: [
        `Playwright JSON report is not a readable bounded regular file: ${jsonReportPath} (${error.message}).`
      ],
      counts: { expected: 0, unexpected: 0, flaky: 0, skipped: 0 }
    };
  }
}

export function playwrightFailureStage(status, reportVerdict) {
  const reportProvesQualityFailure = reportVerdict
    && reportVerdict.readable !== false
    && reportVerdict.environmentFailure !== true
    && reportVerdict.passed === false;
  return reportProvesQualityFailure && (status === 0 || status === 1)
    ? 'runtime-test'
    : 'runtime-environment';
}

// Successful gates clean their JSON reports back up; only failure evidence may
// stay behind, so a green run leaves no .ai-runs leftovers for ai:clean:check.
function runCli() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    printHelp();
    return 1;
  }

  if (!args.spec || !args.test) {
    printHelp();
    return finishCli(args, classifyGeneratedGateFailure({
      stage: 'input-validation',
      issues: ['Both --spec and --test are required.']
    }), 1);
  }

  // A later quality link is valid only for the exact inputs that entered the
  // gate. Capture both before validation or any external command can run, then
  // require the target identity, file metadata, bytes, and behavioral spec
  // digest to still match when the gate finishes.
  if (args.runId) {
    try {
      args.fullGateTargetSnapshot = captureFullGateTargetSnapshot(args.test);
      args.fullGateSpecSha256 = specSha256(args.spec);
    } catch (error) {
      console.error(`Could not capture full-gate inputs: ${error.message}`);
      return finishCli(
        { ...args, runId: undefined },
        classifyGeneratedGateFailure({
          stage: 'input-validation',
          issues: [error.message]
        }),
        1
      );
    }
  }

  const validation = validateSpecFile(args.spec);
  if (!validation.valid) {
    console.error(`Spec validation failed: ${args.spec}`);
    for (const issue of validation.issues) {
      console.error(`- ${issue}`);
    }
    return finishCli(args, classifyGeneratedGateFailure({
      stage: 'input-validation',
      issues: validation.issues
    }), 1);
  }

  // Explicit --mode wins; a flag that contradicts the spec's Generation Mode
  // metadata is a hard error; otherwise the spec metadata (default single).
  let generationMode;
  try {
    generationMode = resolveGenerationMode({ cliMode: args.mode, specMode: specGenerationMode(validation.metadata) });
  } catch (error) {
    console.error(error.message);
    return finishCli(args, classifyGeneratedGateFailure({
      stage: 'input-validation',
      issues: [error.message]
    }), 1);
  }

  const packageManager = detectPackageManager();
  const resolvedEnvironment = resolveEnv(process.env).env;
  const staticEnvironment = buildGateEnvironment(resolvedEnvironment, { profile: 'static' });
  const staticCommands = args.globalChecksComplete
    ? []
    : [packageRunCommand(packageManager, 'test:e2e:list', [args.test]), tscCommand(packageManager)];

  if (args.globalChecksComplete) {
    const specDir = inferSpecDirectory(args.spec);
    const directoryResult = validateSpecDirectory(specDir);
    const receipt = directoryResult.valid
      ? verifyGlobalChecksReceipt({
        expectedFingerprint: args.globalChecksComplete,
        specDir,
        directoryResult
      })
      : undefined;
    if (!directoryResult.valid || !receipt.valid) {
      const fingerprintIssue = !directoryResult.valid
        ? directoryResult.issues
        : [receipt.issue];
      for (const issue of fingerprintIssue) {
        console.error(`- ${issue}`);
      }
      return finishCli(args, classifyGeneratedGateFailure({
        stage: 'global-static',
        issues: fingerprintIssue
      }), 1);
    }
  }

  const review = reviewGeneratedTest({
    specPath: args.spec,
    testPath: args.test,
    mode: generationMode,
    validation
  });
  for (const warning of review.warnings) {
    console.warn(`- ${warning}`);
  }
  if (!review.passed) {
    console.error(`Generated test review failed: ${args.test}`);
    for (const issue of review.issues) {
      console.error(`- ${issue}`);
    }
    return finishCli(args, classifyGeneratedGateFailure({
      stage: 'static-review',
      issues: review.issues
    }), 1);
  }

  for (const [command, commandArgs] of staticCommands) {
    const status = runCommand(command, commandArgs, staticEnvironment);
    if (status !== 0) {
      return finishCli(args, classifyGeneratedGateFailure({
        stage: 'global-static',
        issues: [`Global static command failed: ${command} ${commandArgs.join(' ')} (exit ${status}).`]
      }), status);
    }
  }

  let projectPlan;
  try {
    projectPlan = projectPlanForSpec(validation.metadata, {
      allProjects: args.allProjects,
      projects: args.projects,
      env: resolvedEnvironment
    });
  } catch (error) {
    console.error(error.message);
    return finishCli(args, classifyGeneratedGateFailure({
      stage: 'runtime-environment',
      issues: [error.message]
    }), 1);
  }

  let runPaths;
  try {
    runPaths = prepareSinglePairGateRunDirectory({ specPath: args.spec });
  } catch (error) {
    return finishCli(args, classifyGeneratedGateFailure({
      stage: 'runtime-environment',
      issues: [`Could not prepare a verified generated-test run directory: ${error.message}`]
    }), 1);
  }
  const { aiRunsRoot, aiRunsRootExisted, parentRunDir, runDir } = runPaths;
  for (const { project, env } of projectPlan) {
    const jsonReportPath = path.join(runDir, `playwright-report-${project}.json`);
    const htmlReportDir = path.join(runDir, `html-${project}`);
    const testResultsDir = path.join(runDir, `test-results-${project}`);

    const stage = buildPlaywrightStage({
      packageManager,
      testPath: args.test,
      project,
      extraEnv: env,
      jsonReportPath,
      htmlReportDir,
      testResultsDir,
      repeatEach: args.repeatEach
    });
    const runtimeProfile = project === 'local-chromium' ? 'local-runtime' : 'external-runtime';
    const status = runCommand(stage.command, stage.args, {
      ...buildGateEnvironment(resolvedEnvironment, { profile: runtimeProfile }),
      ...stage.env
    });

    const reportVerdict = readJsonReportVerdict(
      jsonReportPath,
      args.test,
      32 * 1024 * 1024,
      { project, repeatEach: args.repeatEach, retries: 0 }
    );
    if (status !== 0 || !reportVerdict.passed) {
      console.error(`Playwright JSON report verdict failed for project ${project}:`);
      for (const issue of reportVerdict.issues) {
        console.error(`- ${issue}`);
      }
      console.error(`Failure artifacts preserved at ${runDir}`);
      return finishCli(args, classifyGeneratedGateFailure({
        stage: playwrightFailureStage(status, reportVerdict),
        issues: reportVerdict.issues
      }), status !== 0 ? status : 1);
    }

    console.log(
      `Playwright JSON report verdict passed for project ${project}: expected=${reportVerdict.counts.expected}, unexpected=${reportVerdict.counts.unexpected}, skipped=${reportVerdict.counts.skipped}, flaky=${reportVerdict.counts.flaky}.`
    );
  }

  fs.rmSync(runDir, { recursive: true, force: true });
  removeEmptyDirectory(parentRunDir);
  if (!aiRunsRootExisted) {
    removeEmptyDirectory(aiRunsRoot);
  }

  console.log('');
  console.log('Generated test gate passed.');
  return finishCli(args, acceptedGeneratedGateVerdict(), 0);
}

function finishCli(args, verdict, exitCode) {
  let finishFailed = false;
  if (args?.runId) {
    try {
      linkFullGateOutcome({ args, verdict });
      console.log(`Linked full-gate quality to generation run ${args.runId}.`);
    } catch (error) {
      console.error(`Could not link full-gate quality: ${error.message}`);
      finishFailed = true;
    }
  }
  if (args?.verdictFile) {
    try {
      writeGeneratedGateVerdict(args.verdictFile, verdict);
    } catch (error) {
      console.error(`Could not write generated-gate verdict: ${error.message}`);
      finishFailed = true;
    }
  }
  return finishFailed ? 1 : exitCode;
}

function inferSpecDirectory(specPath) {
  let cursor = path.resolve(path.dirname(specPath));
  while (true) {
    if (path.basename(cursor) === 'specs') {
      return cursor;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      return path.resolve(path.dirname(specPath));
    }
    cursor = parent;
  }
}

function removeEmptyDirectory(directory) {
  if (fs.existsSync(directory) && fs.lstatSync(directory).isDirectory() && fs.readdirSync(directory).length === 0) {
    fs.rmdirSync(directory);
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/generated-test-gate.mjs --spec <spec-path> --test <test-file> [--mode single|suite] [--repeat-each 2|3] [--verdict-file <fresh-private-path>] [--run-id <verified-generation-run>]
  node scripts/ai/generated-test-gate.mjs --spec <spec-path> --test <test-file> --all-projects
  node scripts/ai/generated-test-gate.mjs --spec <spec-path> --test <test-file> --projects chromium,webkit

Runs the generated-test acceptance gate for a spec/test pair. Default generated-test execution target is Chromium only. Cross-browser generated-test execution is opt-in.
Without --mode, the spec's optional "Generation Mode" metadata applies (default single).
A --mode flag that contradicts the spec's Generation Mode is a hard error.
The full gate runs three repeats by default; --repeat-each 2 selects the promotion
candidate lane. The Playwright stage runs with --reporter=html,json (html pinned to never
auto-open via PLAYWRIGHT_HTML_OPEN/PW_TEST_HTML_REPORT_OPEN) and fails unless
the JSON report shows at least one passing test and zero failed, flaky, or
skipped tests for the target file. --verdict-file writes generated-gate-verdict/v1 JSON
with exclusive creation and mode 0600. --global-checks-complete <sha256> is an internal
batch receipt; it skips listing/typecheck only when current specs, configuration, and
TypeScript inputs still match the receipt. On the default three-repeat lane, --run-id
links the full-gate outcome to the matching accepted generation-run/v1 manifest. The
current test must still reproduce that run's accepted quality fingerprint. Successful
verified generation records the usable id as generation.runId in its task manifest.`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  process.exitCode = runCli() ?? 0;
}
