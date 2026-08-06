import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  buildPlaywrightStage,
  normalizePlaywrightTarget,
  playwrightFailureStage,
  projectPlanForSpec,
  verifyPlaywrightJsonReport,
  verifyPlaywrightJsonReports
} from '../generated-test-gate.mjs';
import { reviewGeneratedTest } from '../review-generated-test.mjs';
import { validateSpecDirectory } from '../validate-flow-spec.mjs';
import { resolveEnv } from './ai-client.mjs';
import { buildGateEnvironment } from './gate-environment.mjs';
import {
  acceptedGeneratedGateVerdict,
  classifyGeneratedGateFailure
} from './generated-gate-verdict.mjs';
import { computeGlobalChecksFingerprint } from './generated-gate-fingerprint.mjs';
import {
  FULL_GATE_REPEAT_EACH,
  GENERATED_GATE_REPEAT_VALUES,
  PROMOTION_GATE_REPEAT_EACH
} from './generated-gate-policy.mjs';
import { ensureVerifiedDirectory, readVerifiedJsonFile } from './verified-file-read.mjs';

export { acceptedGeneratedGateVerdict, classifyGeneratedGateFailure } from './generated-gate-verdict.mjs';
export { computeGlobalChecksFingerprint } from './generated-gate-fingerprint.mjs';

export function runGlobalGeneratedChecks(options = {}) {
  const specDir = options.specDir ?? 'specs';
  const validateDirectory = options.validateDirectory ?? validateSpecDirectory;
  const commandRunner = options.commandRunner ?? runStageCommand;
  const directoryResult = options.directoryResult ?? validateDirectory(specDir);

  if (!directoryResult.valid) {
    return {
      passed: false,
      issues: [...(directoryResult.issues ?? [])],
      directoryResult,
      fingerprint: undefined,
      expectedFingerprint: undefined
    };
  }

  const testPaths = normalizeScopedTestPaths(options.testPaths);
  if (testPaths.length === 0 && options.stages === undefined) {
    return {
      passed: false,
      issues: ['Global generated-test checks require explicit review-green testPaths before Playwright listing.'],
      directoryResult,
      fingerprint: undefined,
      expectedFingerprint: undefined
    };
  }
  const sourceEnvironment = options.env ?? resolveEnv(process.env).env;
  const stages = options.stages ?? globalStages(
    detectPackageManager(options.rootDir ?? '.'),
    testPaths,
    buildGateEnvironment(sourceEnvironment, { profile: 'static' })
  );
  for (const stage of stages) {
    const status = commandRunner(stage);
    if (status !== 0) {
      return {
        passed: false,
        issues: [`Global generated-test stage failed: ${stage.kind} (exit ${status}).`],
        directoryResult,
        fingerprint: undefined,
        expectedFingerprint: undefined
      };
    }
  }

  const fingerprint = computeGlobalChecksFingerprint(specDir, directoryResult, options.rootDir ?? '.');
  return {
    passed: true,
    issues: [],
    directoryResult,
    fingerprint,
    expectedFingerprint: fingerprint
  };
}

export function runGeneratedPairChecks(pair, options = {}) {
  if (!options.reviewOnly) {
    assertCompletedGlobalChecks(options.globalChecks);
  }
  const reviewer = options.reviewer ?? reviewGeneratedTest;
  const review = reviewer({
    specPath: pair.specPath,
    testPath: pair.testPath,
    mode: pair.mode,
    validation: pair.validation
  });

  if (!review.passed) {
    const verdict = classifyGeneratedGateFailure({ stage: 'static-review', issues: review.issues });
    return {
      passed: false,
      pair,
      review,
      execution: { passed: false, attempted: false, issues: ['Execution was not attempted because static review failed.'] },
      verdict
    };
  }

  if (options.reviewOnly) {
    return {
      passed: true,
      pair,
      review,
      execution: { passed: true, attempted: false, issues: [] },
      verdict: acceptedGeneratedGateVerdict()
    };
  }

  const executor = options.executor ?? executeGeneratedPair;
  const execution = executor(pair, options);
  return {
    passed: execution.passed,
    pair,
    review,
    execution,
    verdict: execution.passed
      ? acceptedGeneratedGateVerdict()
      : execution.verdict ?? classifyGeneratedGateFailure({
        stage: execution.stage ?? 'runtime-environment',
        issues: execution.issues
      })
  };
}

export function executeGeneratedPairsGrouped(pairs, options = {}) {
  assertCompletedGlobalChecks(options.globalChecks);
  if (!Array.isArray(pairs)) throw new Error('Grouped generated-test execution requires a pair array.');
  const repeatEach = options.repeatEach ?? FULL_GATE_REPEAT_EACH;
  if (!GENERATED_GATE_REPEAT_VALUES.has(repeatEach)) {
    throw new Error(
      `repeat-each must be ${PROMOTION_GATE_REPEAT_EACH} (promotion) or ${FULL_GATE_REPEAT_EACH} (full).`
    );
  }

  const sourceEnvironment = options.env ?? resolveEnv(process.env).env;
  const projectPlanner = options.projectPlanner ?? projectPlanForSpec;
  const states = pairs.map((pair) => ({
    pair,
    review: pair.precomputedReview,
    lanes: [],
    planningFailure: null
  }));
  const groups = new Map();

  for (const state of states) {
    if (!state.review?.passed) {
      state.planningFailure = {
        stage: 'static-review',
        issues: state.review?.issues ?? ['Grouped execution requires a completed passing in-process review.']
      };
      continue;
    }
    let projectPlan;
    try {
      projectPlan = projectPlanner(state.pair.validation.metadata, {
        allProjects: options.allProjects ?? false,
        projects: state.pair.projects ?? options.projects ?? [],
        env: sourceEnvironment
      });
    } catch {
      state.planningFailure = {
        stage: 'runtime-environment',
        issues: ['Generated pair project planning failed before browser execution.']
      };
      continue;
    }
    if (!Array.isArray(projectPlan) || projectPlan.length === 0) {
      state.planningFailure = {
        stage: 'runtime-environment',
        issues: [`Generated pair selected no Playwright project: ${state.pair.specPath} -> ${state.pair.testPath}.`]
      };
      continue;
    }
    const plannedLanes = [];
    try {
      for (const plan of projectPlan) {
        const project = String(plan?.project ?? '').trim();
        if (!project) throw new Error('invalid project');
        const profile = project === 'local-chromium' ? 'local-runtime' : 'external-runtime';
        const projectEnv = normalizedEnvironment(plan?.env);
        const key = JSON.stringify({ project, profile, repeatEach, projectEnv: Object.entries(projectEnv) });
        if (!plannedLanes.some((lane) => lane.key === key)) {
          plannedLanes.push({ key, project, profile, projectEnv });
        }
      }
    } catch {
      state.planningFailure = {
        stage: 'runtime-environment',
        issues: ['Generated pair selected an invalid Playwright project or project environment.']
      };
      continue;
    }
    for (const planned of plannedLanes) {
      if (!groups.has(planned.key)) {
        groups.set(planned.key, {
          project: planned.project,
          profile: planned.profile,
          repeatEach,
          projectEnv: planned.projectEnv,
          lanes: []
        });
      }
      const lane = { state, project: planned.project, profile: planned.profile, result: null };
      state.lanes.push(lane);
      groups.get(planned.key).lanes.push(lane);
    }
  }

  const packageManager = options.packageManager ?? detectPackageManager(options.rootDir ?? '.');
  const commandRunner = options.commandRunner ?? runStageCommand;
  const requestedRunRoot = path.resolve(options.runRoot ?? '.ai-runs');
  const runRootExisted = fs.existsSync(requestedRunRoot);
  const runRoot = groups.size > 0
    ? ensureVerifiedDirectory(requestedRunRoot, 'Generated-test run root').resolved
    : requestedRunRoot;

  for (const group of groups.values()) {
    const runDir = path.join(runRoot, uniqueGroupRunName(group));
    const safeProject = safeSegment(group.project);
    const jsonReportPath = path.join(runDir, `playwright-${safeProject}.json`);
    const htmlReportDir = path.join(runDir, `html-${safeProject}`);
    const testResultsDir = path.join(runDir, `test-results-${safeProject}`);
    const testPaths = uniqueNormalizedPaths(group.lanes.map((lane) => lane.state.pair.testPath));
    fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
    let status = 1;
    let report;
    let reportVerdicts;
    let commandCompleted = false;
    try {
      const stage = buildPlaywrightStage({
        packageManager,
        testPaths,
        project: group.project,
        extraEnv: group.projectEnv,
        jsonReportPath,
        htmlReportDir,
        testResultsDir,
        repeatEach: group.repeatEach
      });
      const runnableStage = {
        ...stage,
        kind: 'playwright',
        project: group.project,
        env: {
          ...buildGateEnvironment(sourceEnvironment, { profile: group.profile }),
          ...stage.env
        }
      };
      const commandStatus = commandRunner(runnableStage);
      status = Number.isInteger(commandStatus) ? commandStatus : 1;
      commandCompleted = true;
    } catch {
      // A runner exception is group-local. Diagnostics deliberately omit the
      // exception body because provider/auth/project environment values must
      // never be copied into returned gate results.
      status = 1;
    }
    report = readJsonReport(jsonReportPath, options.maxReportBytes);
    if (report) {
      try {
        reportVerdicts = verifyPlaywrightJsonReports(report, testPaths, {
          project: group.project,
          repeatEach: group.repeatEach,
          retries: 0
        });
      } catch {
        reportVerdicts = undefined;
      }
    }
    let groupPassed = true;
    const reportExplainsNonZeroExit = status === 1 && reportVerdicts
      ? [...reportVerdicts.values()].some(
          (verdict) => verdict.passed === false && verdict.environmentFailure !== true
        )
      : false;

    for (const lane of group.lanes) {
      const target = normalizeTestPath(lane.state.pair.testPath);
      const reportVerdict = reportVerdicts?.get(target);
      const reportEnvironmentFailure = reportVerdict?.environmentFailure === true;
      const acceptableExit = status === 0 || reportExplainsNonZeroExit;
      const passed = commandCompleted && acceptableExit && reportVerdict?.passed === true;
      const abnormalExit = status !== 0 && status !== 1;
      const stageName = passed
        ? 'accepted'
        : !commandCompleted || !report || !reportVerdict || reportEnvironmentFailure
          ? 'runtime-environment'
          : playwrightFailureStage(status, reportVerdict);
      const issues = !commandCompleted
        ? [`Grouped Playwright stage did not complete for ${lane.state.pair.testPath}.`]
        : abnormalExit
          ? [`Grouped Playwright stage exited ${status} abnormally for ${lane.state.pair.testPath}.`]
          : reportVerdict?.passed === false
            ? reportVerdict.issues
            : !report
          ? [`Playwright did not produce a readable JSON report (bounded regular file required) for ${lane.state.pair.testPath} (exit ${status}).`]
          : status !== 0 && !reportExplainsNonZeroExit
            ? [`Grouped Playwright stage exited ${status} for ${lane.state.pair.testPath}.`]
            : reportVerdict
              ? []
              : [`Shared Playwright JSON report did not contain a verdict for ${lane.state.pair.testPath}.`];
      lane.result = {
        project: group.project,
        passed,
        attempted: true,
        stage: stageName,
        issues,
        reportVerdict,
        jsonReportPath,
        htmlReportDir,
        testResultsDir,
        runDir
      };
      if (!passed) groupPassed = false;
    }
    if (groupPassed) fs.rmSync(runDir, { recursive: true, force: true });
  }

  if (!runRootExisted && fs.existsSync(runRoot) && fs.readdirSync(runRoot).length === 0) {
    fs.rmdirSync(runRoot);
  }

  return states.map(({ pair, review, lanes, planningFailure }) => {
    if (planningFailure) {
      const verdict = classifyGeneratedGateFailure(planningFailure);
      return {
        passed: false,
        pair,
        review,
        execution: {
          passed: false,
          attempted: false,
          stage: planningFailure.stage,
          issues: planningFailure.issues,
          projects: [],
          artifacts: [],
          runDir: undefined
        },
        verdict
      };
    }
    const projects = lanes.map((lane) => lane.result).filter(Boolean);
    const failed = projects.find((project) => !project.passed);
    const passed = projects.length > 0 && !failed;
    const issues = projects.flatMap((project) => project.issues);
    const execution = {
      passed,
      attempted: projects.some((project) => project.attempted),
      stage: failed?.stage ?? 'accepted',
      issues,
      projects,
      artifacts: projects.map(({ project, jsonReportPath, htmlReportDir, testResultsDir }) => ({
        project, jsonReportPath, htmlReportDir, testResultsDir
      })),
      runDir: failed?.runDir
    };
    return {
      passed,
      pair,
      review,
      execution,
      verdict: passed
        ? acceptedGeneratedGateVerdict()
        : classifyGeneratedGateFailure({ stage: execution.stage, issues })
    };
  });
}

export function runGeneratedPairsSequentially(pairs, options = {}) {
  const results = [];
  for (const pair of pairs) {
    results.push(runGeneratedPairChecks(pair, options));
  }
  return results;
}

export function executeGeneratedPair(pair, options = {}) {
  const sourceEnvironment = options.env ?? resolveEnv(process.env).env;
  const projectPlanner = options.projectPlanner ?? projectPlanForSpec;
  let projectPlan;
  try {
    projectPlan = projectPlanner(pair.validation.metadata, {
      allProjects: options.allProjects ?? false,
      projects: pair.projects ?? options.projects ?? [],
      env: sourceEnvironment
    });
  } catch {
    return {
      passed: false,
      attempted: false,
      stage: 'runtime-environment',
      issues: ['Generated pair project planning failed before browser execution.'],
      artifacts: [],
      runDir: undefined
    };
  }
  if (!Array.isArray(projectPlan) || projectPlan.length === 0) {
    return {
      passed: false,
      attempted: false,
      stage: 'runtime-environment',
      issues: [`Generated pair selected no Playwright project: ${pair.specPath} -> ${pair.testPath}.`],
      artifacts: [],
      runDir: undefined
    };
  }
  const packageManager = options.packageManager ?? detectPackageManager(options.rootDir ?? '.');
  const commandRunner = options.commandRunner ?? runStageCommand;
  const requestedRunRoot = path.resolve(options.runRoot ?? '.ai-runs');
  const runRootExisted = fs.existsSync(requestedRunRoot);
  const runRoot = ensureVerifiedDirectory(requestedRunRoot, 'Generated-test run root').resolved;
  const runDir = path.join(runRoot, uniqueRunName(pair));
  const artifacts = [];
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });

  for (const { project, env } of projectPlan) {
    const safeProject = safeSegment(project);
    const jsonReportPath = path.join(runDir, `playwright-${safeProject}.json`);
    const htmlReportDir = path.join(runDir, `html-${safeProject}`);
    const testResultsDir = path.join(runDir, `test-results-${safeProject}`);
    const stage = buildPlaywrightStage({
      packageManager,
      testPath: pair.testPath,
      project,
      extraEnv: env,
      jsonReportPath,
      htmlReportDir,
      testResultsDir,
      repeatEach: options.repeatEach ?? FULL_GATE_REPEAT_EACH,
      workers: options.workers,
      purpose: options.purpose ?? 'gate'
    });
    const profile = project === 'local-chromium' ? 'local-runtime' : 'external-runtime';
    const runnableStage = {
      ...stage,
      kind: 'playwright',
      testPath: pair.testPath,
      project,
      env: {
        ...buildGateEnvironment(sourceEnvironment, { profile }),
        ...stage.env
      }
    };
    const status = commandRunner(runnableStage);
    const report = readJsonReport(jsonReportPath);
    const verdict = report ? verifyPlaywrightJsonReport(report, pair.testPath, {
      project,
      repeatEach: options.repeatEach ?? FULL_GATE_REPEAT_EACH,
      retries: 0
    }) : undefined;
    artifacts.push({ project, jsonReportPath, htmlReportDir, testResultsDir });

    if (status !== 0 || !verdict?.passed) {
      const issues = verdict?.issues ?? [
        `Playwright did not produce a readable JSON report for ${pair.testPath} (exit ${status}).`
      ];
      return {
        passed: false,
        attempted: true,
        stage: playwrightFailureStage(status, verdict),
        issues,
        artifacts,
        runDir
      };
    }
  }

  fs.rmSync(runDir, { recursive: true, force: true });
  if (!runRootExisted && fs.existsSync(runRoot) && fs.readdirSync(runRoot).length === 0) {
    fs.rmdirSync(runRoot);
  }
  return {
    passed: true,
    attempted: projectPlan.length > 0,
    stage: 'accepted',
    issues: [],
    artifacts: [],
    runDir: undefined
  };
}

function assertCompletedGlobalChecks(globalChecks) {
  if (!globalChecks?.passed || !globalChecks.fingerprint) {
    throw new Error('Pair checks require completed global generated-test checks.');
  }
  if (globalChecks.expectedFingerprint !== globalChecks.fingerprint) {
    throw new Error('Global generated-test checks fingerprint does not match the current batch.');
  }
}

function detectPackageManager(rootDir) {
  if (fs.existsSync(path.resolve(rootDir, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (fs.existsSync(path.resolve(rootDir, 'yarn.lock'))) {
    return 'yarn';
  }
  return 'npm';
}

function normalizeScopedTestPaths(testPaths) {
  if (testPaths === undefined) {
    return [];
  }
  if (!Array.isArray(testPaths)) {
    throw new Error('Global generated-test testPaths must be an array.');
  }
  const normalized = [];
  const seen = new Set();
  for (const value of testPaths) {
    const testPath = String(value ?? '').trim();
    if (!testPath || testPath.startsWith('-') || !/\.spec\.ts$/i.test(testPath)) {
      throw new Error(`Unsafe generated-test list target: ${testPath || '<empty>'}.`);
    }
    if (!seen.has(testPath)) {
      seen.add(testPath);
      normalized.push(testPath);
    }
  }
  return normalized;
}

function globalStages(packageManager, testPaths, env) {
  if (packageManager === 'pnpm') {
    return [
      { kind: 'playwright-list', command: 'pnpm', args: ['run', 'test:e2e:list', '--', ...testPaths], env },
      { kind: 'typescript', command: 'pnpm', args: ['exec', 'tsc', '--noEmit', '--pretty', 'false', '-p', 'tsconfig.json'], env }
    ];
  }
  if (packageManager === 'yarn') {
    return [
      { kind: 'playwright-list', command: 'yarn', args: ['test:e2e:list', '--', ...testPaths], env },
      { kind: 'typescript', command: 'yarn', args: ['tsc', '--noEmit', '--pretty', 'false', '-p', 'tsconfig.json'], env }
    ];
  }
  return [
    { kind: 'playwright-list', command: 'npm', args: ['run', 'test:e2e:list', '--', ...testPaths], env },
    { kind: 'typescript', command: 'npx', args: ['tsc', '--noEmit', '--pretty', 'false', '-p', 'tsconfig.json'], env }
  ];
}

function runStageCommand(stage) {
  console.log(`$ ${stage.command} ${stage.args.join(' ')}`);
  const result = spawnSync(stage.command, stage.args, {
    stdio: 'inherit',
    shell: false,
    env: stage.env ?? buildGateEnvironment(resolveEnv(process.env).env, { profile: 'static' })
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

function uniqueRunName(pair) {
  const base = safeSegment(path.basename(pair.testPath, path.extname(pair.testPath)));
  return `gate-${Date.now()}-${process.pid}-${crypto.randomUUID()}-${base}`;
}

function uniqueGroupRunName(group) {
  return `gate-group-${Date.now()}-${process.pid}-${crypto.randomUUID()}-${safeSegment(group.project)}`;
}

function normalizeTestPath(value) {
  return normalizePlaywrightTarget(value);
}

function uniqueNormalizedPaths(values) {
  return [...new Set(values.map(normalizeTestPath))];
}

function normalizedEnvironment(value) {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Playwright project environment must be an object.');
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name, entry]) => typeof name === 'string' && entry !== undefined)
      .map(([name, entry]) => [name, String(entry)])
      .sort(([left], [right]) => codePointCompare(left, right))
  );
}

function codePointCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeSegment(value) {
  const segment = String(value ?? '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return segment.slice(0, 80) || 'generated-test';
}

function readJsonReport(reportPath, maxReportBytes) {
  const maxBytes = Number.isSafeInteger(maxReportBytes) && maxReportBytes > 0
    ? maxReportBytes
    : 32 * 1024 * 1024;
  try {
    return readVerifiedJsonFile({
      filePath: reportPath,
      rootPath: path.dirname(reportPath),
      maxBytes,
      label: 'Playwright JSON report'
    });
  } catch {
    return undefined;
  }
}
