#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import { parseSpecHeader, specSha256 } from './lib/spec-parser.mjs';

const HEADER_PREFIX_PATTERN = /\/\*\s*spec:/i;
const ALLOWLIST_PATH = path.join('tests', '.no-header-allowlist');
const SPEC_BOUND_DIRS = ['tests/regression', 'tests/smoke', 'tests/accessibility', 'tests/visual'];

function listSpecTests(dir = 'tests') {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const currentPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSpecTests(currentPath));
    } else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
      files.push(currentPath);
    }
  }

  return files.sort();
}

function readAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    return new Set();
  }

  return new Set(
    fs
      .readFileSync(ALLOWLIST_PATH, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
  );
}

function isSpecBound(testPath) {
  return SPEC_BOUND_DIRS.some((dir) => testPath.startsWith(`${dir}/`) || testPath.startsWith(`${dir}${path.sep}`));
}

function checkSpecDrift({ requireHeader = true } = {}) {
  const issues = [];
  const checked = [];
  const allowlist = readAllowlist();
  const testPaths = listSpecTests().map((testPath) => testPath.split(path.sep).join('/'));
  const testPathSet = new Set(testPaths);

  // Allowlist rot: an entry that no longer maps to a real test file silently
  // grants a header exemption to nothing, so flag it for cleanup.
  for (const entry of allowlist) {
    if (!testPathSet.has(entry)) {
      issues.push(
        `${ALLOWLIST_PATH} lists "${entry}", but no such test exists. Remove the stale allowlist entry.`
      );
    }
  }

  for (const normalized of testPaths) {
    const content = fs.readFileSync(normalized, 'utf8');
    const header = parseSpecHeader(content);

    if (!header) {
      if (HEADER_PREFIX_PATTERN.test(content)) {
        issues.push(
          `${normalized}: malformed spec header. Expected /* spec: <path> version:<semver> sha256:<hex> */.`
        );
      } else if (requireHeader && isSpecBound(normalized) && !allowlist.has(normalized)) {
        issues.push(
          `${normalized}: missing spec header. Add /* spec: <path> version:<semver> sha256:<hex> */ or list the test in ${ALLOWLIST_PATH}.`
        );
      }
      continue;
    }

    const { specPath, sha256: expectedHash } = header;
    checked.push({ testPath: normalized, specPath });

    if (!fs.existsSync(specPath)) {
      issues.push(`${normalized}: referenced spec does not exist: ${specPath}`);
      continue;
    }

    const actualHash = specSha256(specPath);
    if (actualHash !== expectedHash) {
      issues.push(`${normalized}: spec drift detected for ${specPath}. expected ${expectedHash}, actual ${actualHash}.`);
    }
  }

  return { checked, issues };
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/check-spec-drift.mjs [--no-require-header]

Checks test header comments of the form:
  /* spec: specs/<flow>.md version:1.0.0 sha256:<hex> */

Fails when the referenced behavioral spec hash no longer matches. By default, every
*.spec.ts under tests/regression, tests/smoke, tests/accessibility, or
tests/visual must either contain the header or appear in
${ALLOWLIST_PATH}. Pass --no-require-header to skip that check.`);
}

function runCli() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const requireHeader = !args.includes('--no-require-header');
  const positional = args.filter((arg) => arg !== '--no-require-header');
  if (positional.length > 0) {
    printHelp();
    process.exit(1);
  }

  const result = checkSpecDrift({ requireHeader });
  if (result.issues.length > 0) {
    console.error('Spec drift check failed:');
    for (const issue of result.issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log(`Spec drift check passed. Header-linked tests checked: ${result.checked.length}.`);
}

runCli();
