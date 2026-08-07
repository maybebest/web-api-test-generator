#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AI_STAGES,
  hasBinary,
  keySource,
  resolveBinary,
  resolveEnv,
  selectBrain
} from './lib/ai-client.mjs';

function stagePrefix(stage) {
  return stage.replaceAll('-', '_').toUpperCase();
}

function sourcedSetting(resolved, name) {
  const source = keySource(resolved, name);
  return source === 'absent' ? null : `${name} from ${source}`;
}

function automaticBrainSource(resolved, brain) {
  if (brain.kind === 'anthropic') return `${sourcedSetting(resolved, 'ANTHROPIC_API_KEY')} (auto)`;
  if (brain.kind === 'openai') return `${sourcedSetting(resolved, 'OPENAI_API_KEY')} (auto)`;
  if (brain.kind === 'claude-cli') return 'claude CLI discovery (auto)';
  if (brain.kind === 'codex-cli') return 'codex CLI discovery (auto)';
  return 'automatic discovery';
}

function brainSettingSource(resolved, stage, brain) {
  const stageName = `AI_${stagePrefix(stage)}_BRAIN`;
  const stageValue = String(resolved.env[stageName] ?? '').trim().toLowerCase();
  if (stageValue) {
    return stageValue === 'auto'
      ? automaticBrainSource(resolved, brain)
      : sourcedSetting(resolved, stageName);
  }

  const globalValue = String(resolved.env.AI_BRAIN ?? '').trim().toLowerCase();
  if (globalValue && globalValue !== 'auto') return sourcedSetting(resolved, 'AI_BRAIN');

  return automaticBrainSource(resolved, brain);
}

function modelSettingSource(resolved, stage, brain) {
  if (brain.kind === 'codex-cli') {
    return sourcedSetting(resolved, 'AI_CODEX_CLI_MODEL')
      ?? 'CLI default label (installed version is also in exact-cache identity)';
  }
  if (brain.kind !== 'anthropic' && brain.kind !== 'openai') return null;
  const provider = brain.kind.toUpperCase();
  const stageName = `AI_${stagePrefix(stage)}_${provider}_MODEL`;
  return sourcedSetting(resolved, stageName)
    ?? sourcedSetting(resolved, `AI_${provider}_MODEL`)
    ?? 'built-in default';
}

function stageRoute(resolved, stage) {
  const brain = selectBrain(resolved.env, { stage });
  const codexModel = brain.kind === 'codex-cli' ? String(resolved.env.AI_CODEX_CLI_MODEL ?? '').trim() : '';
  const route = brain.model
    ? `${brain.kind} / ${brain.model}`
    : codexModel
      ? `${brain.kind} / ${codexModel}`
      : brain.kind === 'codex-cli'
        ? `${brain.kind} / CLI default (installed version plus default label in exact-cache identity)`
        : brain.kind;
  const details = [`brain: ${brainSettingSource(resolved, stage, brain)}`];
  const modelSource = modelSettingSource(resolved, stage, brain);
  if (modelSource) details.push(`model: ${modelSource}`);
  return `- ${stage}: ${route} (${details.join('; ')})`;
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/ai-doctor.mjs [--require]

Reports the effective brain/model route for every generation stage from the
current environment plus <repo>/.env, including setting sources but no secrets.
Variables already set in the real environment always win over .env values.
Makes no network call and spawns no model. Exits 0 normally; with --require,
exits 1 when no brain is available so CI can fail closed.

Selection order (override with AI_BRAIN; forced brains error when unavailable):
  1. ANTHROPIC_API_KEY set (env or .env) -> anthropic  (Anthropic Messages API)
  2. OPENAI_API_KEY set (env or .env)    -> openai     (OpenAI Chat Completions API)
  3. claude CLI resolvable               -> claude-cli (Claude Code CLI)
  4. codex CLI resolvable                -> codex-cli  (Codex CLI)
  5. otherwise                           -> none
  (CLI brains resolve via AI_BRAIN_<NAME>_PATH, then PATH, then a common install
   location such as ~/.claude/local/claude — no API key needed when installed.)

Env knobs (set in the environment or in <repo>/.env):
  AI_BRAIN             auto | anthropic | openai | claude-cli | codex-cli
                       (claude/codex are accepted aliases; default auto)
  ANTHROPIC_API_KEY    selects the Anthropic Messages API brain
  OPENAI_API_KEY       selects the OpenAI Chat Completions brain
  AI_ANTHROPIC_MODEL   Anthropic model id (default claude-opus-4-8)
  AI_OPENAI_MODEL      OpenAI model id (default gpt-4o-2024-11-20)
  AI_CODEX_CLI_MODEL   optional Codex CLI --model and exact-cache identity
  ANTHROPIC_MAX_TOKENS Anthropic max_tokens (default 16000)
  OPENAI_MAX_TOKENS    OpenAI max_tokens (default 16000)
  AI_<STAGE>_BRAIN     optional route override for SPEC_FIT, TEST_GENERATION,
                       RECORDING_GENERATION, or REPAIR
  AI_<STAGE>_<PROVIDER>_MODEL optional provider-model override for one stage
  AI_<STAGE>_<PROVIDER>_MAX_TOKENS optional provider output cap for one stage
  AI_<STAGE>_PROMPT_CACHE and AI_<STAGE>_OPENAI_{REASONING_EFFORT,
                       VERBOSITY,SERVICE_TIER} override runtime knobs for one stage
  AI_REPAIR_ENABLED    allow one repair only for deterministic static-review failures (default false)
  AI_STRUCTURED_OUTPUT provider-enforced JSON schema output (default true)
  AI_COMPACT_REST_PROMPT remove repeated task boilerplate for REST calls (default true)
  AI_PROMPT_CACHE      provider prompt caching (default false)
  AI_RESULT_CACHE      accepted-only local exact-result cache (default true)
  AI_RESULT_CACHE_EPOCH change to invalidate exact-result cache entries
  AI_MAX_PROMPT_CHARS  optional hard system+prompt character budget
  OPENAI_REASONING_EFFORT GPT-5.6 reasoning effort (default none)
  OPENAI_VERBOSITY     GPT-5.6 output verbosity (default low)
  OPENAI_SERVICE_TIER  optional auto | default | flex | priority
  AI_BRAIN_TIMEOUT_MS  per-call timeout for REST and CLI brains (default 120000)
  AI_BRAIN_CLAUDE_PATH path to the claude binary if not on PATH (e.g. ~/.claude/local/claude)
  AI_BRAIN_CODEX_PATH  path to the codex binary if not on PATH
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

  if (brain.kind === 'codex-cli') {
    const model = String(resolved.env.AI_CODEX_CLI_MODEL ?? '').trim();
    console.log(`- Model: ${model || 'CLI default (installed version plus default label in exact-cache identity)'}`);
  }

  if (brain.kind === 'claude-cli') {
    console.log(`- claude binary: ${resolveBinary('claude', resolved.env) ?? 'not found'}`);
  }

  if (brain.kind === 'codex-cli') {
    console.log(`- codex binary: ${resolveBinary('codex', resolved.env) ?? 'not found'}`);
  }

  console.log('');
  console.log('Detected inputs (sources only — key material is never printed):');
  console.log(`- ANTHROPIC_API_KEY: ${keySource(resolved, 'ANTHROPIC_API_KEY')}`);
  console.log(`- OPENAI_API_KEY: ${keySource(resolved, 'OPENAI_API_KEY')}`);
  const aiBrainValue = (resolved.env.AI_BRAIN ?? '').trim() || 'auto';
  const aiBrainSource = keySource(resolved, 'AI_BRAIN');
  console.log(`- AI_BRAIN: ${aiBrainValue} (${aiBrainSource === 'absent' ? 'default' : aiBrainSource})`);
  console.log(`- claude CLI resolvable: ${hasBinary('claude', resolved.env) ? 'yes (' + resolveBinary('claude', resolved.env) + ')' : 'no'}`);
  console.log(`- codex CLI resolvable: ${hasBinary('codex', resolved.env) ? 'yes (' + resolveBinary('codex', resolved.env) + ')' : 'no'}`);
  console.log('');
  console.log('Effective stage routes (sources only):');
  try {
    for (const stage of AI_STAGES) {
      console.log(stageRoute(resolved, stage));
    }
  } catch (error) {
    console.error(`AI brain doctor: ${error.message}`);
    process.exit(1);
  }
  console.log('');
  console.log('Selection order: ANTHROPIC_API_KEY -> OPENAI_API_KEY -> claude CLI -> codex CLI -> none.');
  console.log(
    'CLI brains are resolved via AI_BRAIN_<NAME>_PATH, then PATH, then a common install location ' +
    '(e.g. ~/.claude/local/claude) — so no API key is needed when the claude/codex app is installed.'
  );
  console.log(
    'Env knobs: AI_BRAIN, ANTHROPIC_API_KEY, OPENAI_API_KEY, AI_ANTHROPIC_MODEL, AI_OPENAI_MODEL, AI_CODEX_CLI_MODEL, ' +
    'ANTHROPIC_MAX_TOKENS, OPENAI_MAX_TOKENS, AI_<STAGE>_*, AI_REPAIR_ENABLED, AI_STRUCTURED_OUTPUT, AI_COMPACT_REST_PROMPT, AI_PROMPT_CACHE, ' +
    'AI_RESULT_CACHE, AI_RESULT_CACHE_EPOCH, AI_MAX_PROMPT_CHARS, OPENAI_REASONING_EFFORT, OPENAI_VERBOSITY, ' +
    'OPENAI_SERVICE_TIER, AI_BRAIN_TIMEOUT_MS, AI_BRAIN_CLAUDE_PATH, AI_BRAIN_CODEX_PATH, AI_DOTENV_PATH.'
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
