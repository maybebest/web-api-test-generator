#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hasBinary, keySource, resolveEnv, selectBrain } from './lib/ai-client.mjs';

function printHelp() {
  console.log(`Usage:
  node scripts/ai/ai-doctor.mjs [--require]

Reports which AI brain is selected from the current environment plus <repo>/.env.
Variables already set in the real environment always win over .env values.
Makes no network call and spawns no model. Exits 0 normally; with --require,
exits 1 when no brain is available so CI can fail closed.

Selection order (override with AI_BRAIN; forced brains error when unavailable):
  1. ANTHROPIC_API_KEY set (env or .env) -> anthropic  (Anthropic Messages API)
  2. OPENAI_API_KEY set (env or .env)    -> openai     (OpenAI Chat Completions API)
  3. claude CLI on PATH                  -> claude-cli (Claude Code CLI)
  4. codex CLI on PATH                   -> codex-cli  (Codex CLI)
  5. otherwise                           -> none

Env knobs (set in the environment or in <repo>/.env):
  AI_BRAIN             auto | anthropic | openai | claude-cli | codex-cli
                       (claude/codex are accepted aliases; default auto)
  ANTHROPIC_API_KEY    selects the Anthropic Messages API brain
  OPENAI_API_KEY       selects the OpenAI Chat Completions brain
  AI_ANTHROPIC_MODEL   Anthropic model id (default claude-opus-4-8)
  AI_OPENAI_MODEL      OpenAI model id (default gpt-4o-2024-11-20)
  ANTHROPIC_MAX_TOKENS Anthropic max_tokens (default 16000)
  OPENAI_MAX_TOKENS    OpenAI max_tokens (default 16000)
  AI_BRAIN_TIMEOUT_MS  per-call timeout for REST and CLI brains (default 120000)
  AI_DOTENV_PATH       override the .env path (real environment only)`);
}

function runCli() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  const requireBrain = process.argv.includes('--require');
  const resolved = resolveEnv();

  let brain;
  try {
    brain = selectBrain(resolved.env);
  } catch (error) {
    console.error(`AI brain doctor: ${error.message}`);
    process.exit(1);
  }

  console.log('AI brain doctor');
  console.log(`- .env file: ${resolved.dotEnvLoaded ? 'loaded' : 'not found'} (${resolved.dotEnvPath})`);
  console.log(`- Selected brain: ${brain.kind} (${brain.label})`);

  if (brain.kind === 'anthropic' || brain.kind === 'openai') {
    console.log(`- Model: ${brain.model}`);
  }

  if (brain.kind === 'claude-cli') {
    console.log(`- claude binary on PATH: ${hasBinary('claude') ? 'yes' : 'no'}`);
  }

  if (brain.kind === 'codex-cli') {
    console.log(`- codex binary on PATH: ${hasBinary('codex') ? 'yes' : 'no'}`);
  }

  console.log('');
  console.log('Detected inputs (sources only — key material is never printed):');
  console.log(`- ANTHROPIC_API_KEY: ${keySource(resolved, 'ANTHROPIC_API_KEY')}`);
  console.log(`- OPENAI_API_KEY: ${keySource(resolved, 'OPENAI_API_KEY')}`);
  const aiBrainValue = (resolved.env.AI_BRAIN ?? '').trim() || 'auto';
  const aiBrainSource = keySource(resolved, 'AI_BRAIN');
  console.log(`- AI_BRAIN: ${aiBrainValue} (${aiBrainSource === 'absent' ? 'default' : aiBrainSource})`);
  console.log(`- claude CLI on PATH: ${hasBinary('claude') ? 'yes' : 'no'}`);
  console.log(`- codex CLI on PATH: ${hasBinary('codex') ? 'yes' : 'no'}`);
  console.log('');
  console.log('Selection order: ANTHROPIC_API_KEY -> OPENAI_API_KEY -> claude CLI -> codex CLI -> none.');
  console.log(
    'Env knobs: AI_BRAIN, ANTHROPIC_API_KEY, OPENAI_API_KEY, AI_ANTHROPIC_MODEL, AI_OPENAI_MODEL, ' +
    'ANTHROPIC_MAX_TOKENS, OPENAI_MAX_TOKENS, AI_BRAIN_TIMEOUT_MS, AI_DOTENV_PATH.'
  );

  if (brain.kind === 'none') {
    console.log('');
    console.log(
      'No AI brain available. Set ANTHROPIC_API_KEY or OPENAI_API_KEY (environment or .env), or install the claude or codex CLI.'
    );
    if (requireBrain) {
      process.exit(1);
    }
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli();
}
