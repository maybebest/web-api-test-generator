#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadPackageEnvironment } from './run-auth-regression.mjs';

// These exact AC-001 cases were audited as navigation/configuration reads. Keep
// this list explicit: a repository-wide grep previously selected mutating tests
// whose titles happened to contain AC-001 or AC-002.
export const READ_ONLY_SMOKE_TARGETS = Object.freeze([
  'tests/regression/media-planner-booking-deadline.authenticated.spec.ts',
  'tests/regression/media-planner-channel-deletion-recompute.authenticated.spec.ts',
  'tests/regression/media-planner-cross-cutting-journeys.authenticated.spec.ts',
  'tests/regression/media-planner-store-level-validation.authenticated.spec.ts',
  'tests/regression/skus/channel-level-hero-edit-and-deletion-sync.authenticated.spec.ts',
  'tests/regression/skus/hero-sku-indicators-and-count-recompute.authenticated.spec.ts',
  'tests/regression/skus/max-hero-skus-per-channel.authenticated.spec.ts',
  'tests/regression/skus/single-prompt-hero-measurement-parsing.authenticated.spec.ts'
]);

export const READ_ONLY_SMOKE_TITLE = '\\bAC-001\\b';

export function validateReadOnlySmokeArgs(args) {
  if (args.length > 0) {
    throw new Error(
      'The authenticated read-only smoke runner owns its complete test selection and accepts no CLI arguments.'
    );
  }
}

export function buildReadOnlySmokeArgs() {
  return [
    'test',
    ...READ_ONLY_SMOKE_TARGETS,
    '--grep',
    READ_ONLY_SMOKE_TITLE,
    '--project=chromium-auth',
    '--workers=1',
    '--retries=0'
  ];
}

function main() {
  loadPackageEnvironment();
  validateReadOnlySmokeArgs(process.argv.slice(2));

  const missing = [];
  if (process.env.E2E_AUTH_ENABLED !== 'true') missing.push('E2E_AUTH_ENABLED=true');
  if (!process.env.PLAYWRIGHT_TEST_BASE_URL?.trim()) missing.push('PLAYWRIGHT_TEST_BASE_URL');
  if (missing.length > 0) {
    console.error(
      `Authenticated read-only smoke is opt-in and cannot start. Configure: ${missing.join(', ')}.`
    );
    process.exit(1);
  }

  const require = createRequire(import.meta.url);
  const playwrightCli = require.resolve('@playwright/test/cli');
  const result = spawnSync(process.execPath, [playwrightCli, ...buildReadOnlySmokeArgs()], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ALLURE_ENABLED: 'false',
      COLLECT_PERF: 'false'
    }
  });
  process.exit(result.status ?? 1);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main();
}
