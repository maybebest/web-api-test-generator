#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { GENERATION_MODES, resolveGenerationMode, specGenerationMode, specSha256 } from './lib/spec-parser.mjs';
import { validateSpecFile } from './validate-flow-spec.mjs';

export function parseArgs(args) {
  const parsed = {
    spec: undefined,
    test: undefined,
    mode: undefined,
    allProjects: false,
    projects: []
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

  return parsed;
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
export function buildPlaywrightStage({ packageManager, testPath, project, extraEnv = {}, jsonReportPath }) {
  const [command, args] = playwrightCommand(packageManager, [
    'test',
    testPath,
    `--project=${project}`,
    '--reporter=html,json'
  ]);

  return {
    command,
    args,
    env: {
      ...extraEnv,
      PLAYWRIGHT_JSON_OUTPUT_NAME: path.resolve(jsonReportPath),
      PLAYWRIGHT_HTML_OPEN: 'never',
      PW_TEST_HTML_REPORT_OPEN: 'never'
    }
  };
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

export function projectPlanForSpec(metadata, { allProjects = false, projects = [] } = {}) {
  const testType = metadata['Test Type']?.toLowerCase();
  const auth = metadata.Auth?.toLowerCase();

  if (auth === 'required') {
    if (process.env.E2E_AUTH_ENABLED !== 'true') {
      throw new Error('Spec requires auth, but E2E_AUTH_ENABLED is not true. Enable auth and configure chromium-auth.');
    }
    return [{ project: 'chromium-auth', env: {} }];
  }

  const requestedProjects =
    projects.length > 0
      ? projects
      : allProjects
        ? projectsForAllBrowsers(testType)
        : defaultProjectsForGeneratedTests(testType);

  return requestedProjects.map((project) => ({ project, env: envForProject(testType, project) }));
}

function defaultProjectsForGeneratedTests(testType) {
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

function runCommand(command, args, env = {}) {
  console.log('');
  console.log(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...env }
  });

  if (result.error) {
    console.error(result.error.message);
    return 1;
  }

  return result.status ?? 1;
}

function findRunDirForSpec(specPath) {
  if (!fs.existsSync('.ai-runs')) {
    return undefined;
  }

  const expectedHash = specSha256(specPath);
  const candidates = fs
    .readdirSync('.ai-runs', { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join('.ai-runs', entry.name))
    .map((dir) => {
      const manifestPath = path.join(dir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        return undefined;
      }

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        return { dir, manifest, mtimeMs: fs.statSync(manifestPath).mtimeMs };
      } catch {
        return undefined;
      }
    })
    .filter(
      (entry) =>
        entry &&
        entry.manifest.specPath === specPath &&
        entry.manifest.specSha256 === expectedHash
    )
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return candidates[0]?.dir;
}

// Returns the run dir for the spec without creating anything: directories are
// only created when there is actually something to write into them, so a
// failed early stage never leaves empty dirs behind that fail ai:clean:check.
function resolveRunDir(specPath) {
  return findRunDirForSpec(specPath) ?? path.join('.ai-runs', `gate-${Date.now()}-${path.basename(specPath, '.md')}`);
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
export function verifyPlaywrightJsonReport(report, targetTestFile) {
  const issues = [];
  const counts = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  const target = normalizeReportPath(targetTestFile);

  const visitSuite = (suite, inheritedFile) => {
    const suiteFile = suite?.file ?? inheritedFile;
    for (const spec of suite?.specs ?? []) {
      if (!reportFileMatchesTarget(spec.file ?? suiteFile, target)) {
        continue;
      }

      for (const testEntry of spec.tests ?? []) {
        if (testEntry.status === 'expected') {
          counts.expected += 1;
        } else if (testEntry.status === 'flaky') {
          counts.flaky += 1;
        } else if (testEntry.status === 'skipped') {
          counts.skipped += 1;
        } else {
          counts.unexpected += 1;
        }
      }
    }

    for (const child of suite?.suites ?? []) {
      visitSuite(child, suiteFile);
    }
  };

  for (const suite of report?.suites ?? []) {
    visitSuite(suite, undefined);
  }

  if (counts.expected < 1) {
    issues.push(
      `Playwright JSON report contains no passing test for ${targetTestFile} (expected=${counts.expected}). The gate requires at least one genuinely executed passing test.`
    );
  }

  if (counts.unexpected > 0) {
    issues.push(`Playwright JSON report shows ${counts.unexpected} unexpected (failed) test(s) for ${targetTestFile}.`);
  }

  if (counts.flaky > 0) {
    issues.push(
      `Playwright JSON report shows ${counts.flaky} flaky test(s) for ${targetTestFile}: target test passed only after retry (flaky) — generated tests must pass deterministically (spec Allowed Retries: 0).`
    );
  }

  if (counts.skipped > 0) {
    issues.push(
      `Playwright JSON report shows ${counts.skipped} skipped test(s) for ${targetTestFile}. Skipped tests exit 0 without verifying anything; remove test.skip/test.fixme to pass the gate.`
    );
  }

  return { passed: issues.length === 0, issues, counts };
}

function normalizeReportPath(value) {
  return String(value ?? '').split(path.sep).join('/').replace(/\\/g, '/');
}

function reportFileMatchesTarget(reportFile, target) {
  if (!reportFile) {
    return false;
  }

  const normalized = normalizeReportPath(reportFile);
  return normalized === target || target.endsWith(`/${normalized}`) || normalized.endsWith(`/${target}`);
}

function readJsonReportVerdict(jsonReportPath, targetTestFile) {
  if (!fs.existsSync(jsonReportPath)) {
    return {
      passed: false,
      issues: [`Playwright exited 0 but the JSON report is missing: ${jsonReportPath}.`],
      counts: { expected: 0, unexpected: 0, flaky: 0, skipped: 0 }
    };
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(jsonReportPath, 'utf8'));
  } catch (error) {
    return {
      passed: false,
      issues: [`Playwright JSON report is not valid JSON: ${jsonReportPath} (${error.message}).`],
      counts: { expected: 0, unexpected: 0, flaky: 0, skipped: 0 }
    };
  }

  return verifyPlaywrightJsonReport(report, targetTestFile);
}

// Successful gates clean their JSON reports back up; only failure evidence may
// stay behind, so a green run leaves no .ai-runs leftovers for ai:clean:check.
function cleanupJsonReports(runDir, jsonReportPaths) {
  for (const jsonReportPath of jsonReportPaths) {
    fs.rmSync(jsonReportPath, { force: true });
  }

  if (fs.existsSync(runDir) && fs.readdirSync(runDir).length === 0) {
    fs.rmdirSync(runDir);
  }
}

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
    process.exit(1);
  }

  if (!args.spec || !args.test) {
    printHelp();
    process.exit(1);
  }

  const validation = validateSpecFile(args.spec);
  if (!validation.valid) {
    console.error(`Spec validation failed: ${args.spec}`);
    for (const issue of validation.issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  // Explicit --mode wins; a flag that contradicts the spec's Generation Mode
  // metadata is a hard error; otherwise the spec metadata (default single).
  let generationMode;
  try {
    generationMode = resolveGenerationMode({ cliMode: args.mode, specMode: specGenerationMode(validation.metadata) });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  let projectPlan;
  try {
    projectPlan = projectPlanForSpec(validation.metadata, {
      allProjects: args.allProjects,
      projects: args.projects
    });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const packageManager = detectPackageManager();
  const runDir = resolveRunDir(args.spec);
  const staticCommands = [
    packageRunCommand(packageManager, 'ai:spec:validate', [args.spec]),
    packageRunCommand(packageManager, 'ai:test:review', [
      '--spec',
      args.spec,
      '--test',
      args.test,
      '--mode',
      generationMode
    ]),
    packageRunCommand(packageManager, 'test:e2e:list'),
    tscCommand(packageManager)
  ];

  for (const [command, commandArgs] of staticCommands) {
    const status = runCommand(command, commandArgs);
    if (status !== 0) {
      copyEvidence(runDir);
      process.exit(status);
    }
  }

  const jsonReportPaths = [];
  for (const { project, env } of projectPlan) {
    const jsonReportPath = path.join(runDir, `playwright-report-${project}.json`);
    fs.mkdirSync(runDir, { recursive: true });
    jsonReportPaths.push(jsonReportPath);

    const stage = buildPlaywrightStage({
      packageManager,
      testPath: args.test,
      project,
      extraEnv: env,
      jsonReportPath
    });
    const status = runCommand(stage.command, stage.args, stage.env);

    const verdict = status === 0 ? readJsonReportVerdict(jsonReportPath, args.test) : undefined;
    if (status !== 0 || !verdict.passed) {
      if (verdict) {
        console.error(`Playwright JSON report verdict failed for project ${project}:`);
        for (const issue of verdict.issues) {
          console.error(`- ${issue}`);
        }
      }
      copyEvidence(runDir);
      process.exit(status !== 0 ? status : 1);
    }

    console.log(
      `Playwright JSON report verdict passed for project ${project}: expected=${verdict.counts.expected}, unexpected=${verdict.counts.unexpected}, skipped=${verdict.counts.skipped}, flaky=${verdict.counts.flaky}.`
    );
  }

  cleanupJsonReports(runDir, jsonReportPaths);

  console.log('');
  console.log('Generated test gate passed.');
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/generated-test-gate.mjs --spec <spec-path> --test <test-file> [--mode single|suite]
  node scripts/ai/generated-test-gate.mjs --spec <spec-path> --test <test-file> --all-projects
  node scripts/ai/generated-test-gate.mjs --spec <spec-path> --test <test-file> --projects chromium,webkit

Runs the generated-test acceptance gate for a spec/test pair. Default generated-test execution target is Chromium only. Cross-browser generated-test execution is opt-in.
Without --mode, the spec's optional "Generation Mode" metadata applies (default single).
A --mode flag that contradicts the spec's Generation Mode is a hard error.
The Playwright stage runs with --reporter=html,json (html pinned to never
auto-open via PLAYWRIGHT_HTML_OPEN/PW_TEST_HTML_REPORT_OPEN) and fails unless
the JSON report shows at least one passing test and zero failed, flaky, or
skipped tests for the target file.`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli();
}
