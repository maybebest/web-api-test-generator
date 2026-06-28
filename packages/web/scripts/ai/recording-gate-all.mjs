#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

import { DEFAULT_RECORDINGS_DIR, listRecordingFiles, normalizeRecordingFile } from './lib/recording-parser.mjs';
import { validateRecordingDirectory } from './validate-recording.mjs';

function run(command, args) {
  console.log(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit' });
  return result.status ?? 1;
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/recording-gate-all.mjs [--dir recordings]

Validates, reviews, and gates every Chrome DevTools Recorder JSON/test pair.`);
}

function runCli() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const dirIndex = args.indexOf('--dir');
  const recordingsDir = dirIndex >= 0 ? args[dirIndex + 1] : DEFAULT_RECORDINGS_DIR;
  if (!recordingsDir) {
    printHelp();
    process.exit(1);
  }

  const directoryResult = validateRecordingDirectory(recordingsDir);
  if (!directoryResult.valid) {
    console.error(`Recording directory validation failed: ${recordingsDir}`);
    for (const issue of directoryResult.issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  const failures = [];
  for (const recordingPath of listRecordingFiles(recordingsDir)) {
    const normalized = normalizeRecordingFile(recordingPath);
    const status = run('npm', [
      'run',
      'ai:recording:gate',
      '--',
      '--recording',
      recordingPath,
      '--test',
      normalized.targetTestFile
    ]);
    if (status !== 0) {
      failures.push(`${recordingPath} -> ${normalized.targetTestFile}`);
    }
  }

  if (failures.length > 0) {
    console.error('Recorded-test gates failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('All recorded-test gates passed.');
}

runCli();
