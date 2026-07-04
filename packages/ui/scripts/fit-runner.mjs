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

import { resolveEnv, runBrain } from '../../web/scripts/ai/lib/ai-client.mjs';

async function main() {
  const requestPath = process.argv[2];
  if (!requestPath) {
    throw new Error('Missing request file path argument.');
  }

  const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
  if (typeof request.prompt !== 'string' || !request.prompt) {
    throw new Error('Request is missing a prompt.');
  }

  const { env } = resolveEnv(process.env);
  const result = await runBrain(request.prompt, {
    env,
    systemPrompt: request.systemPrompt
  });

  process.stdout.write(
    JSON.stringify({
      text: result.text,
      brain: { kind: result.brain?.kind, model: result.brain?.model ?? null },
      usage: result.usage ?? null
    })
  );
}

main().catch((error) => {
  process.stderr.write(String(error?.message || error));
  process.exit(1);
});
