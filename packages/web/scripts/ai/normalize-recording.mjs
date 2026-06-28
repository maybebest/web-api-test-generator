#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import { normalizeRecordingFile } from './lib/recording-parser.mjs';

function parseArgs(args) {
  const parsed = {
    recordingPath: undefined,
    out: undefined
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--out') {
      parsed.out = args[index + 1];
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

function printHelp() {
  console.log(`Usage:
  node scripts/ai/normalize-recording.mjs <recording.json> [--out normalized.json]

Prints or writes the stable recording contract used for generation and drift checks.`);
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

  if (!args.recordingPath) {
    printHelp();
    process.exit(1);
  }

  let normalized;
  try {
    normalized = normalizeRecordingFile(args.recordingPath);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const output = `${JSON.stringify(normalized, null, 2)}\n`;
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, output);
    console.log(`Normalized recording written: ${args.out}`);
    return;
  }

  process.stdout.write(output);
}

runCli();
