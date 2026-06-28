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
  for (const specPath of listSpecFiles(specDir)) {
    const validation = validateSpecFile(specPath);
    const testPath = validation.metadata['Target Test File'];
    const requiresAuth = validation.metadata.Auth?.toLowerCase() === 'required';

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

  console.log('All generated-test gates passed.');
}

runCli();
