#!/usr/bin/env node
// @ts-check
// Off-main-thread runner for "Fit to Template".
//
// The UI server is a single-threaded HTTP server. ai-client's CLI brains
// (claude-cli/codex-cli) execute via a synchronous spawnSync that would block
// the event loop for the whole AI timeout if run in-process. This runner is
// spawned as a child process by the server so that blocking happens here, in
// its own process, leaving the UI responsive.
//
// Usage: node fit-runner.mjs <request-json-path>
// The request file is { prompt: string, systemPrompt: string }.
// API keys/brain selection arrive via the inherited environment, not argv,
// so they never appear in `ps`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runFitGeneration } from './lib/fit-generation-run.mjs';

async function main() {
  const controller = new AbortController();
  const abortForSignal = (signalName) => {
    if (!controller.signal.aborted) {
      controller.abort(new Error(`Fit generation cancelled by ${signalName}.`));
    }
  };
  const onSigint = () => abortForSignal('SIGINT');
  const onSigterm = () => abortForSignal('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);

  try {
    const requestPath = process.argv[2];
    if (!requestPath) {
      throw new Error('Missing request file path argument.');
    }

    const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
    if (typeof request.prompt !== 'string' || !request.prompt) {
      throw new Error('Request is missing a prompt.');
    }

    const result = await runFitGeneration({ request, signal: controller.signal });
    process.stdout.write(JSON.stringify(result));
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    process.stderr.write(String(error?.message || error));
    process.exitCode = 1;
  });
}
