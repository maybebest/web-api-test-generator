#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { listSpecFiles } from './lib/spec-parser.mjs';
import { isPendingGenerationSpec, validateSpecDirectory, validateSpecFile } from './validate-flow-spec.mjs';

function run(command, args) {
  console.log(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit' });
  return result.status ?? 1;
}

const EXPECTED_RED_PATH = path.join('specs', '.expected-review-red');

// Specs whose review is EXPECTED to fail (intentional honest-red, e.g. suites that reference critical
// precondition helpers whose preconditions cannot yet be arranged for a real headless run — the
// helpers are implemented but need real catalogue ids + a live session + healed locators). gate-all
// INVERTS the assertion for them: a listed spec
// whose review unexpectedly PASSES fails the gate, so the list can never mask a quietly-fixed suite
// — and the reviewer itself stays untouched and red for these specs.
function readExpectedReviewRed() {
  if (!fs.existsSync(EXPECTED_RED_PATH)) {
    return new Set();
  }
  return new Set(
    fs
      .readFileSync(EXPECTED_RED_PATH, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
  );
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/gate-all.mjs [--dir specs]

Validates, reviews, and gates every flow spec/test pair discovered from spec metadata.`);
}

function runCli() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const dirIndex = args.indexOf('--dir');
  const specDir = dirIndex >= 0 ? args[dirIndex + 1] : 'specs';
  if (!specDir) {
    printHelp();
    process.exit(1);
  }

  const directoryResult = validateSpecDirectory(specDir);
  if (!directoryResult.valid) {
    console.error(`Spec directory validation failed: ${specDir}`);
    for (const issue of directoryResult.issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  const failures = [];
  const skippedExecution = [];
  const pendingGeneration = [];
  const expectedRed = readExpectedReviewRed();
  const expectedRedHits = [];
  const seenSpecs = new Set();
  for (const specPath of listSpecFiles(specDir)) {
    const validation = validateSpecFile(specPath);
    const testPath = validation.metadata['Target Test File'];
    const requiresAuth = validation.metadata.Auth?.toLowerCase() === 'required';
    seenSpecs.add(specPath.split(path.sep).join('/'));

    // Expected-red spec: validate must pass, the REVIEW must FAIL (inverted assertion), and
    // execution is never attempted. An unexpectedly green review fails the gate so this list can
    // only acknowledge honest reds, never hide fixed ones.
    if (expectedRed.has(specPath.split(path.sep).join('/'))) {
      const validateStatus = run('npm', ['run', 'ai:spec:validate', '--', specPath]);
      if (validateStatus !== 0) {
        failures.push(`${specPath} -> ${testPath} (expected-red spec failed validation)`);
        continue;
      }
      const reviewStatus = run('npm', ['run', 'ai:test:review', '--', '--spec', specPath, '--test', testPath]);
      if (reviewStatus === 0) {
        console.error(
          `Expected-red spec unexpectedly PASSED review: ${specPath}. Implement the missing pieces for real and remove it from ${EXPECTED_RED_PATH}.`
        );
        failures.push(`${specPath} -> ${testPath} (unexpectedly green)`);
        continue;
      }
      expectedRedHits.push(`${specPath} -> ${testPath}`);
      console.log(`Expected-red review confirmed (listed in ${EXPECTED_RED_PATH}): ${specPath}`);
      continue;
    }

    if (isPendingGenerationSpec(validation.metadata)) {
      // A pending-generation spec whose target test already exists is a stale
      // status: the test would silently dodge every gate while looking covered.
      if (testPath && fs.existsSync(path.resolve(testPath))) {
        console.error(
          `Stale Generation Status: ${specPath} is marked pending-generation but ${testPath} already exists. Set "Generation Status | generated" so the test is gated, or remove the stale test file.`
        );
        failures.push(`${specPath} -> ${testPath}`);
        continue;
      }

      pendingGeneration.push(`${specPath} -> ${testPath}`);
      console.log(`Skipping spec awaiting live generation (Generation Status = pending-generation): ${specPath}`);
      continue;
    }

    if (requiresAuth && process.env.E2E_AUTH_ENABLED !== 'true') {
      const validateStatus = run('npm', ['run', 'ai:spec:validate', '--', specPath]);
      const reviewStatus = run('npm', ['run', 'ai:test:review', '--', '--spec', specPath, '--test', testPath]);
      if (validateStatus !== 0 || reviewStatus !== 0) {
        failures.push(`${specPath} -> ${testPath}`);
        continue;
      }

      skippedExecution.push(`${specPath} -> ${testPath}`);
      console.log(`Skipping Playwright execution for auth-required spec because E2E_AUTH_ENABLED is not true: ${specPath}`);
      continue;
    }

    const status = run('npm', ['run', 'ai:test:gate', '--', '--spec', specPath, '--test', testPath]);
    if (status !== 0) {
      failures.push(`${specPath} -> ${testPath}`);
    }
  }

  // List rot: an expected-red entry that no longer maps to a real spec grants an exemption to
  // nothing — flag it for cleanup (mirrors the drift checker's allowlist-rot rule).
  for (const entry of expectedRed) {
    if (!seenSpecs.has(entry)) {
      console.error(`${EXPECTED_RED_PATH} lists "${entry}", but no such spec exists. Remove the stale entry.`);
      failures.push(`${entry} (stale expected-red entry)`);
    }
  }

  if (failures.length > 0) {
    console.error('Generated-test gates failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  if (skippedExecution.length > 0) {
    console.log('Auth-required generated-test execution skipped because E2E_AUTH_ENABLED is not true:');
    for (const skipped of skippedExecution) {
      console.log(`- ${skipped}`);
    }
  }

  if (pendingGeneration.length > 0) {
    console.log('Specs awaiting live generation (not gated):');
    for (const pending of pendingGeneration) {
      console.log(`- ${pending}`);
    }
  }

  if (expectedRedHits.length > 0) {
    console.log(`Intentional honest-reds confirmed red (listed in ${EXPECTED_RED_PATH}, review must keep failing):`);
    for (const hit of expectedRedHits) {
      console.log(`- ${hit}`);
    }
  }

  console.log('All generated-test gates passed.');
}

runCli();
