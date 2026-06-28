#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_RECORDED_TEST_DIR, normalizeRecordingFile } from './lib/recording-parser.mjs';

const HEADER_PATTERN = /\/\*\s*recording:\s+([^\s]+)\s+title:(.*?)\s+sha256:([a-f0-9]{64})\s*\*\//i;

function listRecordedTests(dir = DEFAULT_RECORDED_TEST_DIR) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const currentPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listRecordedTests(currentPath));
    } else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
      files.push(currentPath.split(path.sep).join('/'));
    }
  }

  return files.sort();
}

export function checkRecordingDrift({ testDir = DEFAULT_RECORDED_TEST_DIR } = {}) {
  const issues = [];
  const checked = [];

  for (const testPath of listRecordedTests(testDir)) {
    const content = fs.readFileSync(testPath, 'utf8');
    const match = content.match(HEADER_PATTERN);

    if (!match) {
      issues.push(
        `${testPath}: missing recording header. Add /* recording: <path> title:<title> sha256:<hex> */.`
      );
      continue;
    }

    const [, recordingPath, title, expectedHash] = match;
    if (!fs.existsSync(recordingPath)) {
      issues.push(`${testPath}: referenced recording does not exist: ${recordingPath}`);
      continue;
    }

    let normalized;
    try {
      normalized = normalizeRecordingFile(recordingPath);
    } catch (error) {
      issues.push(`${testPath}: referenced recording is invalid: ${error.message}`);
      continue;
    }

    checked.push({ testPath, recordingPath });
    if (title.trim() !== normalized.title) {
      issues.push(`${testPath}: recording title drift detected. expected "${title.trim()}", actual "${normalized.title}".`);
    }

    if (normalized.sha256 !== expectedHash) {
      issues.push(
        `${testPath}: recording drift detected for ${recordingPath}. expected ${expectedHash}, actual ${normalized.sha256}.`
      );
    }
  }

  return { checked, issues };
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/check-recording-drift.mjs [--dir tests/recorded]

Checks generated recorded-test headers against current normalized Chrome Recorder JSON hashes.`);
}

function runCli() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const dirIndex = args.indexOf('--dir');
  const testDir = dirIndex >= 0 ? args[dirIndex + 1] : DEFAULT_RECORDED_TEST_DIR;
  if (!testDir || args.filter((arg) => arg !== '--dir' && arg !== testDir).length > 0) {
    printHelp();
    process.exit(1);
  }

  const result = checkRecordingDrift({ testDir });
  if (result.issues.length > 0) {
    console.error('Recording drift check failed:');
    for (const issue of result.issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log(`Recording drift check passed. Header-linked tests checked: ${result.checked.length}.`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli();
}
