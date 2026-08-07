#!/usr/bin/env node

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { DEFAULT_RECORDINGS_DIR, listRecordingFiles, validateRecordingFile } from './lib/recording-parser.mjs';

export function validateRecordingDirectory(recordingsDir = DEFAULT_RECORDINGS_DIR) {
  const recordingFiles = listRecordingFiles(recordingsDir);
  const issues = [];
  const warnings = [];

  if (!fs.existsSync(recordingsDir)) {
    // A missing directory is a real misconfiguration (e.g. a typo in --dir).
    issues.push(`Recordings directory not found: ${recordingsDir}.`);
  } else if (recordingFiles.length === 0) {
    issues.push(
      `No Chrome DevTools Recorder JSON files to validate in ${recordingsDir}; refusing a zero-recording validation pass.`
    );
  }

  for (const recordingPath of recordingFiles) {
    const result = validateRecordingFile(recordingPath);
    if (!result.valid) {
      issues.push(`${recordingPath}:`);
      issues.push(...result.issues.map((issue) => `  - ${issue}`));
    }
    warnings.push(...result.warnings.map((warning) => `${recordingPath}: ${warning}`));
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    checked: recordingFiles
  };
}

function parseArgs(args) {
  const parsed = {
    recordingPath: undefined,
    dir: undefined
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--dir') {
      parsed.dir = args[index + 1];
      index += 1;
      continue;
    }

    if (!parsed.recordingPath) {
      parsed.recordingPath = arg;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return parsed;
}

function printValidation(result, label) {
  if (result.valid) {
    console.log(`Recording validation passed: ${label}`);
  } else {
    console.error(`Recording validation failed: ${label}`);
    for (const issue of result.issues) {
      console.error(`- ${issue}`);
    }
  }

  if (result.warnings.length > 0) {
    console.warn('Warnings:');
    for (const warning of result.warnings) {
      console.warn(`- ${warning}`);
    }
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/validate-recording.mjs <recording.json>
  node scripts/ai/validate-recording.mjs --dir recordings

Validates Chrome DevTools Recorder JSON before any Playwright test generation.`);
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

  if (args.recordingPath && args.dir) {
    printHelp();
    process.exit(1);
  }

  if (args.recordingPath) {
    const result = validateRecordingFile(args.recordingPath);
    printValidation(result, args.recordingPath);
    if (!result.valid) {
      process.exit(1);
    }
    return;
  }

  const dir = args.dir ?? DEFAULT_RECORDINGS_DIR;
  const result = validateRecordingDirectory(dir);
  printValidation(result, dir);
  if (!result.valid) {
    process.exit(1);
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli();
}
