#!/usr/bin/env node

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { resolveEnv } from './lib/ai-client.mjs';
import { buildGateEnvironment } from './lib/gate-environment.mjs';

export function runLocalPlaywright({
  args = [],
  env = process.env,
  spawnSyncImpl = spawnSync
} = {}) {
  const sanitizedEnvironment = buildGateEnvironment(resolveEnv(env).env, { profile: 'local-runtime' });
  const result = spawnSyncImpl('playwright', ['test', '--project=local-chromium', ...args], {
    stdio: 'inherit',
    shell: false,
    env: sanitizedEnvironment
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  process.exitCode = runLocalPlaywright({ args: process.argv.slice(2) });
}
