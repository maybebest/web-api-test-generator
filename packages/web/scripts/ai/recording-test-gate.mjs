#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { normalizeRecordingFile } from './lib/recording-parser.mjs';
import { resolveEnv } from './lib/ai-client.mjs';
import { buildGateEnvironment } from './lib/gate-environment.mjs';

export function parseArgs(args) {
  const parsed = {
    recording: undefined,
    test: undefined,
    repeatEach: 3
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--recording') {
      parsed.recording = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--test') {
      parsed.test = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--repeat-each') {
      const repeatEach = Number(args[index + 1]);
      if (repeatEach !== 1 && repeatEach !== 3) {
        throw new Error('--repeat-each must be 1 (fast) or 3 (full).');
      }
      parsed.repeatEach = repeatEach;
      index += 1;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return parsed;
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
    return 1;
  }

  return result.status ?? 1;
}

function findRunDirForRecording(recordingPath, expectedHash) {
  if (!fs.existsSync('.ai-runs')) {
    return undefined;
  }

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
        entry.manifest.recordingPath === recordingPath &&
        entry.manifest.recordingSha256 === expectedHash
    )
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return candidates[0]?.dir;
}

export function copyEvidence(recordingPath, expectedHash) {
  // Only create an evidence directory when there is evidence to copy. An
  // empty evidence dir would look like captured proof while containing none.
  const artifactDirs = ['playwright-report', 'test-results'].filter((artifactDir) => fs.existsSync(artifactDir));
  if (artifactDirs.length === 0) {
    console.error('No failure evidence found: playwright-report and test-results are missing.');
    return undefined;
  }

  const matched = findRunDirForRecording(recordingPath, expectedHash);
  const evidenceDir = matched
    ? path.join(matched, 'evidence')
    : path.join('.ai-runs', `recording-gate-${Date.now()}-${path.basename(recordingPath, '.json')}`, 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });

  for (const artifactDir of artifactDirs) {
    fs.cpSync(artifactDir, path.join(evidenceDir, artifactDir), { recursive: true, force: true });
  }

  console.error(`Failure evidence copied to ${evidenceDir}`);
  return evidenceDir;
}

// Honesty check for the Playwright stage: a zero exit code alone can hide a
// run that matched no tests, skipped everything, or passed only on retry. The
// JSON report must show at least one expected pass and zero unexpected,
// skipped, or flaky outcomes.
export function playwrightJsonVerdict(report) {
  const stats = report?.stats;
  if (!stats || typeof stats !== 'object') {
    return { ok: false, reason: 'Playwright JSON report does not contain run stats.' };
  }

  const expected = Number(stats.expected);
  const unexpected = Number(stats.unexpected);
  const skipped = Number(stats.skipped);
  const flaky = Number(stats.flaky);

  if (!Number.isInteger(expected) || expected < 1) {
    return { ok: false, reason: `Playwright run must execute at least one expected test (expected=${stats.expected}).` };
  }

  if (unexpected !== 0) {
    return { ok: false, reason: `Playwright run reported unexpected test outcomes (unexpected=${stats.unexpected}).` };
  }

  if (skipped !== 0) {
    return { ok: false, reason: `Playwright run skipped tests; the recording gate must run everything (skipped=${stats.skipped}).` };
  }

  // Flaky-as-failure parity with the generated gate's policy: NaN (missing
  // count) also fails closed because NaN !== 0.
  if (flaky !== 0) {
    return {
      ok: false,
      reason: `target test passed only after retry (flaky) — recorded tests must pass deterministically (flaky=${stats.flaky}).`
    };
  }

  return { ok: true, reason: `expected=${expected} unexpected=0 skipped=0 flaky=0` };
}

// Environment for the chromium execution stage. The HTML reporter must never
// auto-open/serve its report: on failure it blocks forever waiting for
// Ctrl+C, hanging CI and agent runs (same regression class as the generated
// gate). Both env spellings are set to cover Playwright version differences.
export function playwrightStageEnv(reportPath) {
  return {
    PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
    PLAYWRIGHT_HTML_OPEN: 'never',
    PW_TEST_HTML_REPORT_OPEN: 'never'
  };
}

export function buildRecordingPlaywrightArgs(testPath, repeatEach = 3) {
  if (repeatEach !== 1 && repeatEach !== 3) {
    throw new Error('repeat-each must be 1 (fast) or 3 (full).');
  }
  return [
    'test',
    testPath,
    '--project=local-chromium',
    '--reporter=html,json',
    '--retries=0',
    `--repeat-each=${repeatEach}`,
    '--max-failures=1'
  ];
}

// A green run must leave no .ai-runs leftovers behind — ai:clean:check treats
// them as dirty state; only failure evidence may stay. Mirrors
// cleanupJsonReports in generated-test-gate.mjs.
export function cleanupJsonReport(reportPath) {
  fs.rmSync(reportPath, { force: true });

  const reportDir = path.dirname(reportPath);
  if (fs.existsSync(reportDir) && fs.readdirSync(reportDir).length === 0) {
    fs.rmdirSync(reportDir);
  }
}

export function readPlaywrightReportVerdict(reportPath) {
  if (!fs.existsSync(reportPath)) {
    return { ok: false, reason: `Playwright JSON report was not written: ${reportPath}.` };
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (error) {
    return { ok: false, reason: `Playwright JSON report is not valid JSON: ${error.message}` };
  }

  return playwrightJsonVerdict(report);
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/recording-test-gate.mjs --recording <recording.json> --test <test-file> [--repeat-each 1|3]

Runs validation, static review, typecheck, Playwright listing, and chromium execution for one recorded test.
The chromium stage writes a JSON report and the gate fails unless it shows expected>=1, unexpected=0, skipped=0.`);
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

  if (!args.recording || !args.test) {
    printHelp();
    process.exit(1);
  }

  let normalized;
  try {
    normalized = normalizeRecordingFile(args.recording);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const packageManager = detectPackageManager();
  const resolvedEnvironment = resolveEnv(process.env).env;
  const staticEnvironment = buildGateEnvironment(resolvedEnvironment, { profile: 'static' });
  const staticCommands = [
    packageRunCommand(packageManager, 'ai:recording:validate', [args.recording]),
    packageRunCommand(packageManager, 'ai:recording:review', ['--recording', args.recording, '--test', args.test]),
    packageRunCommand(packageManager, 'test:e2e:list', [args.test]),
    tscCommand(packageManager)
  ];

  for (const [command, commandArgs] of staticCommands) {
    const status = runCommand(command, commandArgs, staticEnvironment);
    if (status !== 0) {
      copyEvidence(normalized.recordingPath, normalized.sha256);
      process.exit(status);
    }
  }

  const reportPath = path.join('.ai-runs', 'recording-gate-last-run.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.rmSync(reportPath, { force: true });

  const [playwrightBin, playwrightArgs] = playwrightCommand(
    packageManager,
    buildRecordingPlaywrightArgs(args.test, args.repeatEach)
  );
  const playwrightStatus = runCommand(playwrightBin, playwrightArgs, {
    ...buildGateEnvironment(resolvedEnvironment, { profile: 'local-runtime' }),
    ...playwrightStageEnv(reportPath)
  });
  if (playwrightStatus !== 0) {
    copyEvidence(normalized.recordingPath, normalized.sha256);
    process.exit(playwrightStatus);
  }

  const verdict = readPlaywrightReportVerdict(reportPath);
  if (!verdict.ok) {
    console.error(`Playwright JSON report check failed: ${verdict.reason}`);
    copyEvidence(normalized.recordingPath, normalized.sha256);
    process.exit(1);
  }

  cleanupJsonReport(reportPath);

  console.log('');
  console.log(`Playwright JSON report check passed (${verdict.reason}).`);
  console.log('Recording test gate passed.');
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli();
}
