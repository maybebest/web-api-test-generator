#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runGeneratedPairsSequentially,
  runGlobalGeneratedChecks
} from './lib/generated-gate-runner.mjs';
import { reviewGeneratedTest } from './review-generated-test.mjs';
import { isPendingGenerationSpec, validateSpecDirectory } from './validate-flow-spec.mjs';

const LOCAL_FIXTURE_TARGET = /^tests\/(?:smoke|accessibility|visual)\/.+\.spec\.ts$/;

export function collectLocalGeneratedPlan(options = {}) {
  const specDir = options.specDir ?? 'specs';
  const directoryResult = options.directoryResult ?? validateSpecDirectory(specDir);
  const fileExists = options.fileExists ?? ((filePath) => fs.existsSync(path.resolve(filePath)));
  const selected = [];
  const excluded = [];
  const issues = [];
  const seenTargets = new Set();

  if (!directoryResult.valid) {
    return {
      specDir,
      directoryResult,
      selected,
      excluded,
      issues: [...(directoryResult.issues ?? [])]
    };
  }

  for (const { specPath, result: validation } of directoryResult.results) {
    const testPath = normalizePath(validation.metadata['Target Test File']);
    if (isPendingGenerationSpec(validation.metadata)) {
      excluded.push({ specPath, testPath, reason: 'pending-generation' });
      continue;
    }

    const auth = validation.metadata.Auth?.toLowerCase();
    if (auth !== 'none') {
      excluded.push({
        specPath,
        testPath,
        reason: auth === 'required' ? 'auth-required' : 'auth-unsupported'
      });
      continue;
    }

    if (!isCanonicalLocalFixtureTarget(testPath) || testPath.endsWith('.authenticated.spec.ts')) {
      excluded.push({ specPath, testPath, reason: 'external-or-unsupported' });
      continue;
    }

    if (!fileExists(testPath)) {
      excluded.push({ specPath, testPath, reason: 'missing-target' });
      issues.push(`${specPath}: delivered local generated target does not exist: ${testPath}`);
      continue;
    }

    if (seenTargets.has(testPath)) {
      excluded.push({ specPath, testPath, reason: 'duplicate-target' });
      continue;
    }
    seenTargets.add(testPath);
    selected.push({
      specPath,
      testPath,
      validation,
      projects: ['local-chromium']
    });
  }

  return { specDir, directoryResult, selected, excluded, issues };
}

export function runLocalGeneratedGate({
  plan,
  runBatch = defaultRunBatch,
  reviewer = reviewGeneratedTest,
  runGlobalChecks = runGlobalGeneratedChecks
} = {}) {
  if (!plan) {
    throw new Error('runLocalGeneratedGate requires a collected plan.');
  }
  if (plan.issues.length > 0) {
    return summarizeRun(plan, [], plan.issues);
  }
  if (plan.selected.length === 0) {
    return summarizeRun(plan, [], []);
  }

  let pairResults;
  try {
    pairResults = runBatch(plan.selected, plan, { reviewer, runGlobalChecks });
  } catch (error) {
    return summarizeRun(plan, [], [error.message]);
  }
  const issues = pairResults
    .filter((result) => !result.passed)
    .flatMap((result) => result.verdict?.diagnostics ?? result.execution?.issues ?? ['Generated pair failed.']);
  return summarizeRun(plan, pairResults, issues);
}

function defaultRunBatch(pairs, plan, {
  reviewer = reviewGeneratedTest,
  runGlobalChecks = runGlobalGeneratedChecks
} = {}) {
  const reviews = new Map();
  for (const pair of pairs) {
    const review = reviewer({
      specPath: pair.specPath,
      testPath: pair.testPath,
      validation: pair.validation
    });
    if (!review.passed) {
      throw new Error(review.issues.join(' '));
    }
    reviews.set(pair.specPath, review);
  }

  const globalChecks = runGlobalChecks({
    specDir: plan.specDir,
    directoryResult: plan.directoryResult,
    testPaths: pairs.map((pair) => pair.testPath)
  });
  if (!globalChecks.passed) {
    throw new Error(globalChecks.issues.join(' '));
  }
  return runGeneratedPairsSequentially(pairs, {
    globalChecks,
    repeatEach: 3,
    reviewer: ({ specPath }) => reviews.get(specPath)
  });
}

function summarizeRun(plan, pairResults, issues) {
  const selected = plan.selected.length;
  const executed = pairResults.filter((result) => result.execution?.attempted).length;
  const allSelectedPassed =
    selected > 0 &&
    pairResults.length === selected &&
    pairResults.every((result) => result.passed && result.execution?.attempted && result.execution?.passed);
  const passed = issues.length === 0 && (selected === 0 || allSelectedPassed);
  return {
    passed,
    selected,
    executed,
    excluded: plan.excluded.length,
    exclusions: plan.excluded,
    issues,
    pairResults,
    runtimeClaim: passed && allSelectedPassed
  };
}

function normalizePath(value) {
  return String(value ?? '').split(path.sep).join('/').replace(/\\/g, '/');
}

function isCanonicalLocalFixtureTarget(testPath) {
  return !path.posix.isAbsolute(testPath) &&
    path.posix.normalize(testPath) === testPath &&
    LOCAL_FIXTURE_TARGET.test(testPath);
}

function printResult(result) {
  console.log(`Local generated-test selection: selected=${result.selected}, executed=${result.executed}, excluded=${result.excluded}.`);
  if (result.exclusions.length > 0) {
    console.log('Explicit exclusions:');
    for (const exclusion of result.exclusions) {
      console.log(`- ${exclusion.reason}: ${exclusion.specPath} -> ${exclusion.testPath || '(no target)'}`);
    }
  }
  for (const issue of result.issues) {
    console.error(`- ${issue}`);
  }
  if (result.runtimeClaim) {
    console.log(`Runtime result: accepted (${result.executed}/${result.selected} selected local generated pairs executed).`);
  } else {
    console.log(`Runtime result: not claimed (selected=${result.selected}, executed=${result.executed}).`);
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/run-local-generated.mjs [--dir specs]

Executes only delivered, unauthenticated generated tests whose target paths are owned by the
deterministic local-fixture Playwright project. Pending, authenticated, and external/unsupported
pairs are reported explicitly and are never counted as executed. A zero-selection run succeeds
but states that no generated-test runtime acceptance is claimed.`);
}

function runCli() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }
  const args = process.argv.slice(2);
  let specDir = 'specs';
  if (args.length > 0) {
    if (args.length !== 2 || args[0] !== '--dir' || !args[1]) {
      console.error('Expected --dir <spec-directory>.');
      printHelp();
      process.exitCode = 1;
      return;
    }
    specDir = args[1];
  }
  const plan = collectLocalGeneratedPlan({ specDir });
  const result = runLocalGeneratedGate({ plan });
  printResult(result);
  process.exitCode = result.passed ? 0 : 1;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli();
}
