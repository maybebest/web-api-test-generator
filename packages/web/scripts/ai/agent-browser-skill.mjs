#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import { runAgentBrowser } from './lib/agent-browser-runner.mjs';

function parseArgs(args) {
  const parsed = {
    out: undefined,
    check: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--out') {
      parsed.out = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--check') {
      parsed.check = true;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return parsed;
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

  const result = runAgentBrowser(['skills', 'get', 'core', '--full']);
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status);
  }

  if (args.check) {
    if (!/agent-browser core|snapshot/i.test(result.stdout)) {
      console.error('agent-browser core skill output did not look valid.');
      process.exit(1);
    }
    console.log('agent-browser core skill is available.');
    return;
  }

  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, result.stdout);
    console.log(`Wrote agent-browser core skill to ${args.out}`);
    return;
  }

  process.stdout.write(result.stdout);
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/agent-browser-skill.mjs [--out <path>] [--check]

Fetches the version-matched agent-browser core skill with:
  agent-browser skills get core --full`);
}

runCli();
