#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const LOCKED_OPTION = /^(?:(?:--config|--project|--workers|--retries|--repeat-each|--no-deps)(?:=|$)|-c$|-j$)/;
const packageEnvPath = fileURLToPath(new URL('../.env', import.meta.url));

export function assertPrivateEnvironmentFile(envPath = packageEnvPath) {
  let stats;
  try {
    stats = fs.lstatSync(envPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Authenticated environment must be a regular non-symlink file: ${envPath}`);
  }
  if (process.platform !== 'win32' && (stats.mode & 0o077) !== 0) {
    throw new Error(`Authenticated environment is readable by other users: ${envPath}. Run chmod 600 on it.`);
  }
}

export function loadPackageEnvironment(envPath = packageEnvPath) {
  assertPrivateEnvironmentFile(envPath);
  return dotenv.config({ path: envPath, quiet: true });
}

export function validateUserArgs(args) {
  const forbidden = args.find((arg) => LOCKED_OPTION.test(arg));
  if (forbidden) {
    throw new Error(`Authenticated regression runner owns ${forbidden.split('=')[0]}; overriding safety options is forbidden.`);
  }
  return args;
}

function main() {
  // The package documentation permits credentials and target configuration in
  // packages/web/.env. Load it before the opt-in preflight while preserving any
  // values explicitly supplied by the invoking environment.
  loadPackageEnvironment();
  const userArgs = validateUserArgs(process.argv.slice(2));

  const missing = [];
  if (process.env.E2E_AUTH_ENABLED !== 'true') missing.push('E2E_AUTH_ENABLED=true');
  if (!process.env.PLAYWRIGHT_TEST_BASE_URL?.trim()) missing.push('PLAYWRIGHT_TEST_BASE_URL');

  if (missing.length > 0) {
    console.error(
      `Authenticated regression is opt-in and cannot start. Configure: ${missing.join(', ')}. ` +
        'Use npm run test:e2e:local for credential-free deterministic tests.'
    );
    process.exit(1);
  }

  const require = createRequire(import.meta.url);
  const playwrightCli = require.resolve('@playwright/test/cli');
  const result = spawnSync(
    process.execPath,
    [playwrightCli, 'test', 'tests/regression', ...userArgs, '--project=chromium-auth', '--workers=1', '--retries=0'],
    { stdio: 'inherit', env: process.env }
  );
  process.exit(result.status ?? 1);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main();
}
