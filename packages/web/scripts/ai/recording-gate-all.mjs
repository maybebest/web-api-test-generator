#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveEnv } from './lib/ai-client.mjs';
import { buildGateEnvironment } from './lib/gate-environment.mjs';
import { DEFAULT_RECORDINGS_DIR, listRecordingFiles, normalizeRecordingFile } from './lib/recording-parser.mjs';
import { validateRecordingDirectory } from './validate-recording.mjs';

function run(command, args, env) {
  console.log(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false, env });
  return result.status ?? 1;
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/recording-gate-all.mjs [--dir recordings] [--review-only]

Validates, reviews, and gates every Chrome DevTools Recorder JSON/test pair.
--review-only validates and statically reviews every pair without importing or executing a test module.`);
}

export function runRecordingGateAll({
  recordingsDir = DEFAULT_RECORDINGS_DIR,
  reviewOnly = false,
  validateDirectory = validateRecordingDirectory,
  listFiles = listRecordingFiles,
  normalizeFile = normalizeRecordingFile,
  commandRunner = run,
  env = process.env
} = {}) {
  const directoryResult = validateDirectory(recordingsDir);
  if (!directoryResult.valid) {
    return { passed: false, failures: [], issues: directoryResult.issues ?? [] };
  }

  const staticEnvironment = buildGateEnvironment(resolveEnv(env).env, { profile: 'static' });
  const failures = [];
  for (const recordingPath of listFiles(recordingsDir)) {
    const normalized = normalizeFile(recordingPath);
    const commandArgs = reviewOnly
      ? [
          'run', 'ai:recording:review', '--',
          '--recording', recordingPath,
          '--test', normalized.targetTestFile
        ]
      : [
          'run', 'ai:recording:gate', '--',
          '--recording', recordingPath,
          '--test', normalized.targetTestFile
        ];
    const status = commandRunner('npm', commandArgs, staticEnvironment);
    if (status !== 0) failures.push(`${recordingPath} -> ${normalized.targetTestFile}`);
  }
  return { passed: failures.length === 0, failures, issues: [] };
}

function runCli() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const dirIndex = args.indexOf('--dir');
  const recordingsDir = dirIndex >= 0 ? args[dirIndex + 1] : DEFAULT_RECORDINGS_DIR;
  const reviewOnly = args.includes('--review-only');
  const knownArgs = new Set(['--dir', '--review-only']);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!knownArgs.has(arg) && (index === 0 || args[index - 1] !== '--dir')) {
      console.error(`Unexpected argument: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }
  if (!recordingsDir) {
    printHelp();
    process.exit(1);
  }

  const result = runRecordingGateAll({ recordingsDir, reviewOnly });
  if (result.issues.length > 0) {
    console.error(`Recording directory validation failed: ${recordingsDir}`);
    for (const issue of result.issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }
  if (!result.passed) {
    console.error(reviewOnly ? 'Recorded-test static reviews failed:' : 'Recorded-test gates failed:');
    for (const failure of result.failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(reviewOnly ? 'All recorded-test static reviews passed.' : 'All recorded-test gates passed.');
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli();
}
