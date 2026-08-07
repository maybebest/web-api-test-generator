#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeGlobalChecksFingerprint,
  executeGeneratedPairsGrouped,
  runGeneratedPairChecks,
  runGlobalGeneratedChecks
} from './lib/generated-gate-runner.mjs';
import { resolveEnv } from './lib/ai-client.mjs';
import { FULL_GATE_REPEAT_EACH } from './lib/generated-gate-policy.mjs';
import { reviewGeneratedTest } from './review-generated-test.mjs';
import { isPendingGenerationSpec, validateSpecDirectory } from './validate-flow-spec.mjs';

const EXPECTED_RED_PATH = path.join('specs', '.expected-review-red');

// Specs whose review is EXPECTED to fail (intentional honest-red). The assertion
// is inverted: a listed spec that becomes review-green fails until it is removed
// from the list, so an exemption cannot silently mask a fixed suite.
function readExpectedReviewRed(expectedRedPath = EXPECTED_RED_PATH) {
  if (!fs.existsSync(expectedRedPath)) {
    return new Set();
  }
  return new Set(
    fs
      .readFileSync(expectedRedPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
  );
}

function normalizePath(value) {
  return String(value ?? '').split(path.sep).join('/');
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/gate-all.mjs [--dir specs] [--review-only]

Validates the spec directory once, runs Playwright listing and TypeScript compilation once,
then reviews every delivered spec/test pair in-process. Compatible browser targets run in
sequential isolated groups. Default mode refuses pending or skipped execution;
--review-only performs static validation/review and explicitly makes no execution claim.`);
}

function parseArgs(args) {
  const parsed = { specDir: 'specs', reviewOnly: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dir') {
      parsed.specDir = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--review-only') {
      parsed.reviewOnly = true;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!parsed.specDir) {
    throw new Error('--dir requires a value.');
  }
  return parsed;
}

export function runGateAll(options = {}) {
  const specDir = options.specDir ?? 'specs';
  const reviewOnly = options.reviewOnly ?? false;
  const validateDirectory = options.validateDirectory ?? validateSpecDirectory;
  const reviewer = options.reviewer ?? reviewGeneratedTest;
  const globalCheckRunner = options.runGlobalChecks ?? runGlobalGeneratedChecks;
  const pairCheckRunner = options.runPairChecks ?? runGeneratedPairChecks;
  const pairBatchRunner = options.runPairBatch ?? (
    options.runPairChecks
      ? (pairs, pairOptions) => pairs.map((pair) => pairCheckRunner(pair, {
          ...pairOptions,
          reviewer: () => pair.precomputedReview
        }))
      : executeGeneratedPairsGrouped
  );
  const sourceEnvironment = options.env ?? resolveEnv(process.env).env;
  const directoryResult = validateDirectory(specDir);
  if (!directoryResult.valid) {
    return {
      passed: false,
      exitCode: 1,
      issues: [`Spec directory validation failed: ${specDir}`, ...directoryResult.issues],
      failures: [],
      skippedExecution: [],
      pendingGeneration: [],
      expectedRedHits: [],
      reviewed: 0,
      executed: 0
    };
  }

  const expectedRedPath = specDir === 'specs' ? EXPECTED_RED_PATH : path.join(specDir, '.expected-review-red');
  const expectedRed = options.expectedRed ?? readExpectedReviewRed(expectedRedPath);
  const seenSpecs = new Set();
  const failures = [];
  const issues = [];
  const skippedExecution = [];
  const pendingGeneration = [];
  const expectedRedHits = [];
  const normalPairs = [];

  for (const { specPath, result: validation } of directoryResult.results) {
    const normalizedSpecPath = normalizePath(specPath);
    const testPath = validation.metadata['Target Test File'];
    const requiresAuth = validation.metadata.Auth?.toLowerCase() === 'required';
    seenSpecs.add(normalizedSpecPath);

    if (expectedRed.has(normalizedSpecPath)) {
      const review = reviewer({ specPath, testPath, validation });
      if (review.passed) {
        failures.push(`${specPath} -> ${testPath} (unexpectedly green)`);
        issues.push(
          `Expected-red spec unexpectedly PASSED review: ${specPath}. Implement the missing pieces for real and remove it from ${expectedRedPath}.`
        );
      } else {
        expectedRedHits.push(`${specPath} -> ${testPath}`);
      }
      continue;
    }

    if (isPendingGenerationSpec(validation.metadata)) {
      if (testPath && fs.existsSync(path.resolve(testPath))) {
        failures.push(`${specPath} -> ${testPath}`);
        issues.push(
          `Stale Generation Status: ${specPath} is marked pending-generation but ${testPath} already exists. Set "Generation Status | generated" so the test is gated, or remove the stale test file.`
        );
      } else {
        pendingGeneration.push(`${specPath} -> ${testPath}`);
      }
      continue;
    }

    const skipExecution = reviewOnly || (requiresAuth && sourceEnvironment.E2E_AUTH_ENABLED !== 'true');
    if (skipExecution) {
      skippedExecution.push(`${specPath} -> ${testPath}`);
    }
    normalPairs.push({ specPath, testPath, validation, reviewOnly: skipExecution });
  }

  for (const entry of expectedRed) {
    if (!seenSpecs.has(entry)) {
      failures.push(`${entry} (stale expected-red entry)`);
      issues.push(`${expectedRedPath} lists "${entry}", but no such spec exists. Remove the stale entry.`);
    }
  }

  // Static review must happen before Playwright --list or TypeScript compilation:
  // both commands import/evaluate test modules. A rejected generated file must
  // never execute top-level code merely because it was included in a batch.
  let reviewed = 0;
  let staticReviewsPassed = true;
  for (const pair of normalPairs) {
    const review = reviewer({
      specPath: pair.specPath,
      testPath: pair.testPath,
      mode: pair.mode,
      validation: pair.validation
    });
    pair.precomputedReview = review;
    reviewed += 1;
    for (const warning of review.warnings ?? []) {
      console.warn(`${pair.specPath}: ${warning}`);
    }
    if (!review.passed) {
      staticReviewsPassed = false;
      failures.push(`${pair.specPath} -> ${pair.testPath}`);
      issues.push(...review.issues.map((issue) => `${pair.specPath}: ${issue}`));
    }
  }

  let globalChecks;
  if (!staticReviewsPassed) {
    globalChecks = {
      passed: false,
      issues: [],
      directoryResult,
      fingerprint: undefined,
      expectedFingerprint: undefined
    };
  } else if (reviewOnly) {
    globalChecks = undefined;
  } else if (normalPairs.length > 0) {
    globalChecks = globalCheckRunner({
      specDir,
      directoryResult,
      testPaths: normalPairs.map((pair) => pair.testPath),
      env: sourceEnvironment
    });
    if (!globalChecks.passed) {
      failures.push('global generated-test checks');
      issues.push(...globalChecks.issues);
    }
  } else {
    const fingerprint = computeGlobalChecksFingerprint(specDir, directoryResult);
    globalChecks = {
      passed: true,
      issues: [],
      directoryResult,
      fingerprint,
      expectedFingerprint: fingerprint
    };
  }

  let executed = 0;
  if (!reviewOnly && globalChecks?.passed) {
    const executablePairs = normalPairs.filter((pair) => !pair.reviewOnly);
    let pairResults = [];
    try {
      pairResults = pairBatchRunner(executablePairs, {
        globalChecks,
        repeatEach: FULL_GATE_REPEAT_EACH,
        reviewer: (pair) => pair.precomputedReview,
        env: sourceEnvironment
      });
    } catch (error) {
      failures.push('grouped generated-test execution');
      issues.push(`Grouped generated-test execution failed: ${error.message}`);
    }
    for (const result of pairResults) {
      const pair = result.pair;
      if (result.execution.attempted) {
        executed += 1;
      }
      if (!result.passed) {
        failures.push(`${pair.specPath} -> ${pair.testPath}`);
        issues.push(...result.verdict.diagnostics.map((diagnostic) => `${pair.specPath}: ${diagnostic}`));
        if (result.execution.runDir) {
          issues.push(`${pair.specPath}: failure artifacts preserved at ${result.execution.runDir}`);
        }
      }
    }
  }

  if (!reviewOnly && (skippedExecution.length > 0 || pendingGeneration.length > 0)) {
    issues.push('Generated-test execution is incomplete; default gate-all refuses skipped work.');
  }

  const incomplete = !reviewOnly && (skippedExecution.length > 0 || pendingGeneration.length > 0);
  const passed = failures.length === 0 && !incomplete;
  return {
    passed,
    exitCode: passed ? 0 : 1,
    issues,
    failures,
    skippedExecution,
    pendingGeneration,
    expectedRedHits,
    reviewed,
    executed,
    selected: normalPairs.length
  };
}

function printResult(result, reviewOnly) {
  for (const pending of result.pendingGeneration) {
    console.log(`Skipping spec awaiting live generation (Generation Status = pending-generation): ${pending}`);
  }
  for (const hit of result.expectedRedHits) {
    console.log(`Expected-red review confirmed: ${hit}`);
  }
  for (const issue of result.issues) {
    console.error(issue);
  }
  if (result.failures.length > 0) {
    console.error('Generated-test gates failed:');
    for (const failure of result.failures) {
      console.error(`- ${failure}`);
    }
  }
  if (result.skippedExecution.length > 0) {
    console.log('Generated-test pairs reviewed without Playwright execution:');
    for (const skipped of result.skippedExecution) {
      console.log(`- ${skipped}`);
    }
  }
  if (result.expectedRedHits.length > 0) {
    console.log(`Intentional honest-reds confirmed red (listed in ${EXPECTED_RED_PATH}, review must keep failing).`);
  }

  console.log(
    `Generated-test batch summary: selected=${result.selected ?? 0}, reviewed=${result.reviewed}, executed=${result.executed}, pending=${result.pendingGeneration.length}, skipped=${result.skippedExecution.length}.`
  );
  if (result.passed) {
    console.log(
      reviewOnly
        ? 'Static generated-test review completed; no execution is claimed.'
        : 'All generated-test gates passed with no skipped generation or execution.'
    );
  } else if (result.executed === 0) {
    console.error('No generated-test runtime acceptance is claimed.');
  }
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
    process.exitCode = 1;
    return;
  }
  const result = runGateAll(args);
  printResult(result, args.reviewOnly);
  process.exitCode = result.exitCode;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli();
}
