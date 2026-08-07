// AI brain abstraction. Selects and runs an "AI brain" with this precedence
// (highest first), overridable by env AI_BRAIN (auto|anthropic|openai|claude-cli|codex-cli;
// claude/codex are accepted aliases for the CLI brains):
//   1. ANTHROPIC_API_KEY set (env or .env) -> 'anthropic'   (Anthropic Messages REST API via fetch)
//   2. OPENAI_API_KEY set (env or .env)    -> 'openai'      (OpenAI Chat Completions via fetch)
//   3. `claude` binary resolvable          -> 'claude-cli'  (Claude Code CLI, headless `claude -p`)
//   4. `codex` binary resolvable           -> 'codex-cli'   (`codex exec`)
//   5. otherwise                           -> 'none'
// "Resolvable" (see resolveBinary) means: an AI_BRAIN_<NAME>_PATH override, OR on PATH, OR in a
// common off-PATH install location (e.g. ~/.claude/local/claude) — so the CLI brains work with no
// API key even when the installed app/CLI is not on the bare PATH.
// AI_BRAIN forces a specific kind and errors clearly when the forced brain is
// unavailable (missing key or missing binary). selectBrain is pure: it only reads
// env + the filesystem (PATH lookup) and never makes a network call or spawns a
// process. Dependency-free: node: builtins plus the already-vendored `typescript`
// package (used by the static reviewers too) for output sanity checks.
//
// .env support: the npm scripts run plain `node`, so process.env alone would miss
// <repoRoot>/.env. resolveEnv() merges a tiny dependency-free .env parse under the
// real environment — variables already set in the real environment ALWAYS win.

import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import ts from 'typescript';

import {
  DEFAULT_GENERATION_CACHE_DIR,
  createGenerationCacheCandidate,
  createGenerationCacheKey,
  readGenerationCache
} from './generation-cache.mjs';
import {
  CODE_OUTPUT_SCHEMA,
  OUTPUT_KINDS,
  REST_OUTPUT_CONTRACT,
  STRUCTURED_REST_OUTPUT_CONTRACT,
  decodeStructuredOutput,
  getOutputContract,
  validateContractOutput
} from './output-contracts.mjs';
import { compactRestGenerationTask } from './rest-prompt.mjs';
import { GENERATION_POLICY_VERSION } from './generation-policy.mjs';

export {
  CODE_OUTPUT_SCHEMA,
  OUTPUT_KINDS,
  REST_OUTPUT_CONTRACT,
  STRUCTURED_REST_OUTPUT_CONTRACT
} from './output-contracts.mjs';

export const BRAIN_KINDS = ['anthropic', 'openai', 'claude-cli', 'codex-cli', 'none'];
export const AI_STAGES = ['spec-fit', 'test-generation', 'recording-generation', 'repair', 'heal'];
export const GENERATION_USAGE_SCHEMA = 'generation-usage/v1';
// Trust is module-private, not a response property. Only this module can add a
// result after semantic decoding, deterministic rendering, and contract
// validation. The WeakMap is non-serializable and never enters cache/telemetry.
const trustedFlowSpecResults = new WeakMap();
export function isTrustedFlowSpecResult(result) {
  return Boolean(result && typeof result === 'object' && trustedFlowSpecResults.get(result) === result.text);
}

// Anthropic aliases are the canonical model ids — no date suffix.
const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8';
// Dated OpenAI snapshot instead of the floating "gpt-4o" alias, for reproducibility.
const DEFAULT_OPENAI_MODEL = 'gpt-4o-2024-11-20';
const DEFAULT_ANTHROPIC_MAX_TOKENS = 16000;
const DEFAULT_OPENAI_MAX_TOKENS = 16000;
const DEFAULT_BRAIN_TIMEOUT_MS = 120000;
export const DEFAULT_MAX_PROMPT_CHARS = 200_000;
export const HARD_MAX_PROMPT_CHARS = 2_000_000;
const MAX_HTTP_RETRIES = 2;
const MAX_RETRY_AFTER_MS = 30000;
const DEFAULT_PROMPT_CACHE_TTL = '5m';
const DEFAULT_OPENAI_PROMPT_CACHE_KEY_PREFIX = 'playwright-test-generation-v3';
export const REST_CONTRACT_VERSION = 'rest-output-v2';
const generationFlights = new Map();

// Repo root resolved relative to this file (scripts/ai/lib/ai-client.mjs), never cwd.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MONOREPO_ROOT = path.resolve(REPO_ROOT, '..', '..');
const DARWIN_SANDBOX_EXEC = '/usr/bin/sandbox-exec';

const COMMON_CLI_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'COLORTERM',
  'NO_COLOR',
  'TMPDIR',
  'TMP',
  'TEMP',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'SystemRoot',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'USERPROFILE'
];
const CODEX_CLI_ENV_KEYS = [
  'CODEX_HOME',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT_ID'
];
const CLAUDE_CLI_ENV_KEYS = [
  'CLAUDE_CONFIG_DIR',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN'
];

// CLI subprocesses deliberately receive neither the repository's test credentials nor
// the other provider's credentials. HOME and the selected provider's config directory
// remain available so an already authenticated CLI keeps working without copying auth
// material into the temporary workspace.
export function buildCliEnvironment(providerKind, sourceEnv = process.env) {
  const providerKeys = providerKind === 'codex-cli'
    ? CODEX_CLI_ENV_KEYS
    : providerKind === 'claude-cli'
      ? CLAUDE_CLI_ENV_KEYS
      : [];
  const childEnv = {};
  for (const key of [...COMMON_CLI_ENV_KEYS, ...providerKeys]) {
    if (sourceEnv[key] !== undefined) {
      childEnv[key] = String(sourceEnv[key]);
    }
  }
  return childEnv;
}

export function defaultDotEnvPath() {
  return path.join(REPO_ROOT, '.env');
}

// Tiny dependency-free .env parser: KEY=VALUE lines, `export ` prefix allowed,
// comments (#) and blank lines ignored, optional single/double quotes stripped.
// Inline-comment semantics deliberately match the installed `dotenv` package
// (which playwright.config.ts still uses on the same .env): an unquoted `#`
// starts a comment even with no whitespace before it (`KEY=a#b` -> "a"), while
// `#` inside a quoted value is preserved and a trailing `# ...` after the
// closing quote is dropped. Pinned by parseDotEnv tests in ai-client.test.mjs.
export function parseDotEnv(content) {
  const values = {};

  for (const rawLine of String(content ?? '').split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const eqIndex = withoutExport.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }

    const key = withoutExport.slice(0, eqIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    let value = withoutExport.slice(eqIndex + 1).trim();

    // Leading quoted block followed only by whitespace/comment: keep the quoted
    // content verbatim (a `#` inside the quotes is data, not a comment).
    let quotedBlockConsumed = false;
    const quoteChar = value.startsWith('"') || value.startsWith("'") ? value[0] : null;
    if (quoteChar) {
      const closingIndex = value.indexOf(quoteChar, 1);
      if (closingIndex !== -1) {
        const rest = value.slice(closingIndex + 1).trim();
        if (rest === '' || rest.startsWith('#')) {
          value = value.slice(1, closingIndex);
          quotedBlockConsumed = true;
        }
      }
    }

    if (!quotedBlockConsumed) {
      // dotenv semantics: in an unquoted value the first `#` starts a comment
      // even without preceding whitespace (`a#b` parses to "a").
      const hashIndex = value.indexOf('#');
      if (hashIndex !== -1) {
        value = value.slice(0, hashIndex).trimEnd();
      }

      // Legacy symmetric-quote strip for values that still look fully quoted
      // (e.g. an unterminated-then-completed oddity like 'a'b' -> a'b, matching dotenv).
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
    }

    values[key] = value;
  }

  return values;
}

// Merges <repoRoot>/.env (if present) UNDER the real environment: variables already
// set in the real environment are never overridden. Returns the merged env plus a
// per-key source map ('environment' | '.env') so callers like ai-doctor can report
// where a value came from without ever printing key material. AI_DOTENV_PATH (real
// env only) overrides the .env location, which keeps tests hermetic.
export function resolveEnv(env = process.env, { dotEnvPath } = {}) {
  const envPathOverride = typeof env.AI_DOTENV_PATH === 'string' ? env.AI_DOTENV_PATH.trim() : '';
  const resolvedDotEnvPath = dotEnvPath ?? (envPathOverride || defaultDotEnvPath());

  let dotEnvValues = {};
  let dotEnvLoaded = false;
  if (existsSync(resolvedDotEnvPath)) {
    try {
      dotEnvValues = parseDotEnv(readFileSync(resolvedDotEnvPath, 'utf8'));
      dotEnvLoaded = true;
    } catch {
      // An unreadable .env is treated as absent; the real environment still works.
    }
  }

  const merged = { ...env };
  const sources = {};

  for (const key of Object.keys(dotEnvValues)) {
    if (merged[key] === undefined) {
      merged[key] = dotEnvValues[key];
      sources[key] = '.env';
    }
  }

  for (const key of Object.keys(env)) {
    if (env[key] !== undefined) {
      sources[key] = 'environment';
    }
  }

  return { env: merged, sources, dotEnvPath: resolvedDotEnvPath, dotEnvLoaded };
}

// Reports where a key's value came from for diagnostics: 'environment' | '.env' |
// 'absent'. Whitespace-only values count as absent (matching selectBrain). Never
// returns key material.
export function keySource(resolved, name) {
  const value = resolved.env[name];
  if (value === undefined || String(value).trim() === '') {
    return 'absent';
  }

  return resolved.sources[name] === '.env' ? '.env' : 'environment';
}

function isExecutableFile(fullPath) {
  if (!fullPath || !existsSync(fullPath)) {
    return false;
  }
  if (process.platform === 'win32') {
    return true;
  }
  try {
    accessSync(fullPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Per-binary off-PATH install locations so an installed Claude/Codex CLI is found even when its
// directory is not on PATH (e.g. the Claude Code CLI installs to ~/.claude/local/claude).
function commonBinaryLocations(name, env) {
  const home = (env.HOME ?? env.USERPROFILE ?? '').trim();
  if (!home) {
    return [];
  }
  const byName = {
    claude: [path.join(home, '.claude', 'local', 'claude')],
    codex: [path.join(home, '.codex', 'bin', 'codex')]
  };
  return byName[name] ?? [];
}

// Resolves an executable named `name` to an absolute path, or undefined. Resolution order:
//   1. AI_BRAIN_<NAME>_PATH override (point directly at a binary anywhere; e.g. AI_BRAIN_CLAUDE_PATH)
//   2. process.env.PATH entries (darwin/linux verify X_OK; Windows-ish appends .exe/.cmd/.bat)
//   3. common off-PATH install locations (e.g. ~/.claude/local/claude)
// This is what lets the CLI brains be used with no API key even when the installed app/CLI is not
// on the bare PATH.
export function resolveBinary(name, env = process.env) {
  const override = (env['AI_BRAIN_' + name.toUpperCase() + '_PATH'] ?? '').trim();
  if (override) {
    return isExecutableFile(override) ? override : undefined;
  }

  const rawPath = env.PATH ?? env.Path ?? '';
  const candidates = process.platform === 'win32'
    ? [name, `${name}.exe`, `${name}.cmd`, `${name}.bat`]
    : [name];
  for (const dir of rawPath.split(path.delimiter).filter(Boolean)) {
    for (const candidate of candidates) {
      const fullPath = path.join(dir, candidate);
      if (isExecutableFile(fullPath)) {
        return fullPath;
      }
    }
  }

  for (const fullPath of commonBinaryLocations(name, env)) {
    if (isExecutableFile(fullPath)) {
      return fullPath;
    }
  }

  return undefined;
}

// Checks whether an executable named `name` is resolvable (PATH, override, or common location).
export function hasBinary(name, env = process.env) {
  return resolveBinary(name, env) !== undefined;
}

function stagePrefix(stage) {
  if (!AI_STAGES.includes(stage)) {
    throw new Error(`Unsupported AI stage: ${stage}. Use one of ${AI_STAGES.join('|')}.`);
  }
  return stage.replaceAll('-', '_').toUpperCase();
}

export function resolveStageEnv(env = process.env, stage = 'test-generation') {
  const prefix = stagePrefix(stage);
  const resolved = { ...env };
  const overrides = [
    ['BRAIN', 'AI_BRAIN'],
    ['ANTHROPIC_MODEL', 'AI_ANTHROPIC_MODEL'],
    ['OPENAI_MODEL', 'AI_OPENAI_MODEL'],
    ['ANTHROPIC_MAX_TOKENS', 'ANTHROPIC_MAX_TOKENS'],
    ['OPENAI_MAX_TOKENS', 'OPENAI_MAX_TOKENS'],
    ['PROMPT_CACHE', 'AI_PROMPT_CACHE'],
    ['MAX_PROMPT_CHARS', 'AI_MAX_PROMPT_CHARS'],
    ['OPENAI_REASONING_EFFORT', 'OPENAI_REASONING_EFFORT'],
    ['OPENAI_VERBOSITY', 'OPENAI_VERBOSITY'],
    ['OPENAI_SERVICE_TIER', 'OPENAI_SERVICE_TIER']
  ];
  for (const [stageSuffix, globalName] of overrides) {
    const stageName = `AI_${prefix}_${stageSuffix}`;
    if (resolved[stageName] !== undefined && String(resolved[stageName]).trim() !== '') {
      resolved[globalName] = resolved[stageName];
    }
  }
  return resolved;
}

// Pure: returns the chosen brain descriptor without any network/process side effects.
// The binary check is injectable via options.hasBinary so tests stay hermetic.
// Callers that want .env support must pass resolveEnv(...).env — selectBrain itself
// never reads the filesystem for env values.
export function selectBrain(env = process.env, { hasBinary: hasBinaryFn = hasBinary, stage = 'test-generation' } = {}) {
  const settingsEnv = resolveStageEnv(env, stage);
  const forced = (settingsEnv.AI_BRAIN ?? 'auto').trim().toLowerCase();
  const anthropicKey = (settingsEnv.ANTHROPIC_API_KEY ?? '').trim();
  const openaiKey = (settingsEnv.OPENAI_API_KEY ?? '').trim();
  const anthropicModel = (settingsEnv.AI_ANTHROPIC_MODEL ?? '').trim() || DEFAULT_ANTHROPIC_MODEL;
  const openaiModel = (settingsEnv.AI_OPENAI_MODEL ?? '').trim() || DEFAULT_OPENAI_MODEL;

  const anthropic = () => ({ kind: 'anthropic', label: 'Anthropic Messages API', model: anthropicModel });
  const openai = () => ({ kind: 'openai', label: 'OpenAI Chat Completions API', model: openaiModel });
  const claudeCli = () => ({ kind: 'claude-cli', label: 'Claude Code CLI (claude)' });
  const codexCli = () => ({ kind: 'codex-cli', label: 'Codex CLI (codex)' });
  const none = () => ({ kind: 'none', label: 'No AI brain available' });

  if (forced === 'anthropic') {
    if (!anthropicKey) {
      throw new Error(
        'AI_BRAIN=anthropic but ANTHROPIC_API_KEY is not set (environment or .env). Set the key or unset AI_BRAIN.'
      );
    }
    return anthropic();
  }
  if (forced === 'openai') {
    if (!openaiKey) {
      throw new Error(
        'AI_BRAIN=openai but OPENAI_API_KEY is not set (environment or .env). Set the key or unset AI_BRAIN.'
      );
    }
    return openai();
  }
  if (forced === 'claude-cli' || forced === 'claude') {
    if (!hasBinaryFn('claude', settingsEnv)) {
      throw new Error(
        `AI_BRAIN=${forced} but no claude binary is on PATH. Install the Claude Code CLI or unset AI_BRAIN.`
      );
    }
    return claudeCli();
  }
  if (forced === 'codex-cli' || forced === 'codex') {
    if (!hasBinaryFn('codex', settingsEnv)) {
      throw new Error(
        `AI_BRAIN=${forced} but no codex binary is on PATH. Install the Codex CLI or unset AI_BRAIN.`
      );
    }
    return codexCli();
  }

  if (forced !== 'auto' && forced !== '') {
    throw new Error(
      `Unsupported AI_BRAIN value: ${forced}. Use one of auto|anthropic|openai|claude-cli|codex-cli (claude/codex are accepted aliases).`
    );
  }

  if (anthropicKey) {
    return anthropic();
  }
  if (openaiKey) {
    return openai();
  }
  if (hasBinaryFn('claude', settingsEnv)) {
    return claudeCli();
  }
  if (hasBinaryFn('codex', settingsEnv)) {
    return codexCli();
  }

  return none();
}

function positiveInt(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function promptCharBudget(env) {
  const raw = env.AI_MAX_PROMPT_CHARS;
  if (raw === undefined || String(raw).trim() === '') {
    return DEFAULT_MAX_PROMPT_CHARS;
  }

  const normalized = String(raw).trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(
      `AI_MAX_PROMPT_CHARS must be a whole number between 1 and ${HARD_MAX_PROMPT_CHARS}.`
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed > HARD_MAX_PROMPT_CHARS) {
    throw new Error(
      `AI_MAX_PROMPT_CHARS must be a whole number between 1 and ${HARD_MAX_PROMPT_CHARS}.`
    );
  }
  return parsed;
}

function enforcePromptCharBudget(payload, budget) {
  const promptChars = String(payload ?? '').length;
  if (promptChars > budget) {
    throw new Error(
      `AI prompt is ${promptChars} characters, above the effective AI_MAX_PROMPT_CHARS=${budget}. ` +
      'Reduce the task context or raise the explicit budget.'
    );
  }
}

function booleanSetting(env, name, defaultValue) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === '') {
    return defaultValue;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  throw new Error(`${name} must be true or false (received ${JSON.stringify(raw)}).`);
}

function enumSetting(env, name, allowed, defaultValue) {
  const raw = String(env[name] ?? '').trim().toLowerCase();
  if (!raw) {
    return defaultValue;
  }
  if (!allowed.includes(raw)) {
    throw new Error(`${name} must be one of ${allowed.join('|')} (received ${JSON.stringify(env[name])}).`);
  }
  return raw;
}

function isModernOpenAIModel(model) {
  return /^gpt-5(?:\.|-|$)/i.test(model) || /^o\d/i.test(model);
}

function supportsOpenAIStructuredOutput(model) {
  // The pinned default and current GPT-5/o-series routes support json_schema.
  // Older legacy snapshots can opt out with AI_STRUCTURED_OUTPUT=false.
  return /^(gpt-4o|gpt-4\.1|gpt-5|o\d)/i.test(model);
}

function tokenNumber(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function sumKnown(...values) {
  return values.every((value) => value !== null) ? values.reduce((sum, value) => sum + value, 0) : null;
}

function codexCliModelSetting(env) {
  const model = String(env.AI_CODEX_CLI_MODEL ?? '').trim();
  if (!model) return null;
  if (model.length > 256 || /[\r\n\0]/.test(model)) {
    throw new Error('AI_CODEX_CLI_MODEL must be a single-line model identifier no longer than 256 characters.');
  }
  return model;
}

function buildCliProbeEnvironment(sourceEnv) {
  const probeEnv = {};
  for (const key of ['PATH', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT']) {
    if (sourceEnv[key] !== undefined) probeEnv[key] = String(sourceEnv[key]);
  }
  return probeEnv;
}

function codexCliIdentity(binary, explicitModel, sourceEnv, spawnSyncImpl, timeoutMs, protectedRoot) {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'ai-cli-version-'));
  let result;
  try {
    chmodSync(workspace, 0o500);
    const invocation = isolateCliInvocation(binary, ['--version'], protectedRoot);
    result = spawnSyncImpl(invocation.binary, invocation.args, {
      shell: false, cwd: workspace, env: buildCliProbeEnvironment(sourceEnv), encoding: 'utf8',
      maxBuffer: 4096, timeout: timeoutMs, killSignal: 'SIGKILL'
    });
  } finally {
    try { chmodSync(workspace, 0o700); } catch {}
    rmSync(workspace, { recursive: true, force: true });
  }
  if (result?.error || result?.status !== 0) {
    throw new Error('Unable to determine the Codex CLI version identity required for exact-result caching. Verify the configured Codex binary supports `codex --version`, or set AI_RESULT_CACHE=false to bypass optional exact caching.');
  }
  const version = String(result.stdout ?? '').trim().replace(/\s+/g, '-');
  if (!version || version.length > 256 || /[^A-Za-z0-9._+@:-]/.test(version)) {
    throw new Error('Codex CLI returned an unusable version identity required for exact-result caching. Verify the configured Codex binary supports `codex --version`, or set AI_RESULT_CACHE=false to bypass optional exact caching.');
  }
  return explicitModel ? `codex-cli@${version}:model=${explicitModel}` : `codex-cli@${version}:default`;
}

// Codex `exec --json` emits one JSON object per state change. Only the completed
// assistant message is a response; lifecycle/tool events never become generated output.
export function decodeCodexJsonlOutput(rawOutput, outputContract = OUTPUT_KINDS.playwright) {
  const contract = typeof outputContract === 'string' ? getOutputContract(outputContract) : outputContract;
  let assistantMessage = null;
  let completedUsage = null;
  const lines = String(rawOutput ?? '').split(/\r\n|\r|\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(`Codex CLI JSONL line ${index + 1} is not valid JSON.`);
    }
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new Error(`Codex CLI JSONL line ${index + 1} must be an object.`);
    }
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
      if (typeof event.item.text !== 'string' || !event.item.text.trim()) {
        throw new Error('Codex CLI final assistant message must contain non-empty text.');
      }
      assistantMessage = event.item.text;
    }
    if (event.type === 'turn.completed' && event.usage !== undefined) {
      if (!event.usage || typeof event.usage !== 'object' || Array.isArray(event.usage)) {
        throw new Error('Codex CLI turn.completed usage must be an object when present.');
      }
      completedUsage = event.usage;
    }
  }

  if (assistantMessage === null) {
    throw new Error('Codex CLI JSONL did not contain a final assistant message.');
  }

  const text = decodeStructuredOutput(assistantMessage, contract);
  if (completedUsage === null) return { text, usage: null };

  const inputTokens = tokenNumber(completedUsage.input_tokens);
  const cachedTokens = tokenNumber(completedUsage.cached_input_tokens) ?? 0;
  const outputTokens = tokenNumber(completedUsage.output_tokens);
  const cacheWriteTokens = tokenNumber(completedUsage.cache_creation_input_tokens) ?? 0;
  const reasoningTokens = tokenNumber(completedUsage.reasoning_output_tokens ?? completedUsage.reasoning_tokens) ?? 0;
  return {
    text,
    usage: {
      inputTokens,
      uncachedInputTokens: inputTokens === null ? null : Math.max(0, inputTokens - cachedTokens - cacheWriteTokens),
      outputTokens,
      cachedTokens,
      cacheWriteTokens,
      reasoningTokens,
      totalTokens: tokenNumber(completedUsage.total_tokens) ?? sumKnown(inputTokens, outputTokens)
    }
  };
}

function baseUsage({ provider, model, inputTokens, uncachedInputTokens, outputTokens, cachedTokens, cacheWriteTokens, totalTokens,
  reasoningTokens, retryCount, latencyMs, requestId, responseId, serviceTier, promptMetrics,
  providerPromptCacheStatus }) {
  const normalizedInput = tokenNumber(inputTokens);
  const normalizedOutput = tokenNumber(outputTokens);
  const normalizedCached = tokenNumber(cachedTokens) ?? 0;
  const normalizedCacheWrite = tokenNumber(cacheWriteTokens) ?? 0;
  const normalizedReasoning = tokenNumber(reasoningTokens) ?? 0;

  return {
    schemaVersion: GENERATION_USAGE_SCHEMA,
    provider,
    model,
    requestId: requestId ?? null,
    responseId: responseId ?? null,
    serviceTier: serviceTier ?? null,
    inputTokens: normalizedInput,
    uncachedInputTokens: tokenNumber(uncachedInputTokens),
    outputTokens: normalizedOutput,
    cachedTokens: normalizedCached,
    cacheWriteTokens: normalizedCacheWrite,
    reasoningTokens: normalizedReasoning,
    totalTokens: tokenNumber(totalTokens) ?? sumKnown(normalizedInput, normalizedOutput),
    retryCount,
    // Error responses normally expose no usage, so retry token cost cannot be
    // measured honestly. Zero is only recorded when no retry occurred.
    retryTokens: retryCount === 0 ? 0 : null,
    requestCount: retryCount + 1,
    successfulRequests: 1,
    latencyMs,
    resultCacheHit: false,
    resultCacheStatus: 'disabled',
    providerPromptCacheStatus,
    singleFlightJoined: false,
    savedTokens: 0,
    ...promptMetrics
  };
}

function providerPromptCacheControl(provider, model, enabled) {
  if (provider === 'anthropic') return enabled ? 'explicit-stable' : 'disabled';
  if (/^gpt-5\.6(?:-|$)/i.test(model)) return enabled ? 'explicit-stable' : 'explicit-off';
  return enabled ? 'explicit-stable' : 'automatic-possible';
}

function responseIdentifiers(response, data) {
  return {
    requestId: data?.request_id ?? response.headers?.get?.('x-request-id') ?? response.headers?.get?.('request-id') ?? null,
    responseId: data?.id ?? null
  };
}

function logUsage(usage) {
  console.error(`[ai-client] usage ${JSON.stringify(usage)}`);
}

function notifyAttempt(onAttempt, attempt) {
  if (typeof onAttempt !== 'function') return;
  try {
    onAttempt(attempt);
  } catch {
    // Telemetry must never turn an otherwise usable provider response into a
    // failed (and potentially repeated) paid generation.
    console.error('[ai-client] generation attempt telemetry could not be recorded.');
  }
}

function providerFailure(error, {
  usage = null, failureReason, recorded = false, provider = null, model = null, retryCount = null
} = {}) {
  error.usage = usage;
  error.failureReason = failureReason;
  error.attemptRecorded = recorded;
  error.provider = provider ?? usage?.provider ?? null;
  error.model = model ?? usage?.model ?? null;
  error.retryCount = retryCount ?? usage?.retryCount ?? 0;
  return error;
}

function attemptRecord({ provider, model, stage, attempt, status, durationMs, usage = null,
  retryStatus = null, failureReason = null, httpStatus = null }) {
  return {
    provider,
    model,
    stage,
    attempt,
    status,
    durationMs,
    usage,
    retryStatus,
    failureStage: failureReason ? 'provider' : null,
    failureReason,
    httpStatus
  };
}

function runObservedCli({
  brain,
  binary,
  args,
  prompt,
  stage,
  sourceEnv,
  protectedRoot,
  signal,
  timeoutMs,
  spawnSyncImpl,
  onAttempt,
  outputSchema,
  cliModel,
  now = Date.now,
  decode = (text) => text
}) {
  const startedAt = now();
  let rawText;
  try {
    rawText = runCliBrain(binary, args, prompt, {
      providerKind: brain.kind,
      sourceEnv,
      protectedRoot,
      signal,
      timeoutMs,
      spawnSyncImpl,
      outputSchema,
      cliModel
    });
  } catch (error) {
    const failureReason = 'cli-failed';
    notifyAttempt(onAttempt, attemptRecord({
      provider: brain.kind,
      model: brain.model,
      stage,
      attempt: 1,
      status: 'failed',
      durationMs: now() - startedAt,
      usage: null,
      retryStatus: 'not-retried',
      failureReason
    }));
    throw providerFailure(error, {
      usage: null,
      failureReason,
      recorded: true,
      provider: brain.kind,
      model: brain.model,
      retryCount: 0
    });
  }
  try {
    return { value: decode(rawText), durationMs: now() - startedAt };
  } catch (error) {
    notifyAttempt(onAttempt, attemptRecord({
      provider: brain.kind, model: brain.model, stage, attempt: 1, status: 'malformed',
      durationMs: now() - startedAt, usage: null, retryStatus: 'not-retried', failureReason: 'malformed-output'
    }));
    throw providerFailure(error, {
      usage: null, failureReason: 'malformed-output', recorded: true,
      provider: brain.kind, model: brain.model, retryCount: 0
    });
  }
}

// Selects the brain and executes it, returning { text, brain, usage }.
// REST usage follows generation-usage/v1; CLI brains do not expose provider usage.
// fetch/spawnSync/hasBinary/sleep are injectable so tests stay hermetic.
export async function runBrain(prompt, {
  env = process.env,
  signal,
  fetchImpl = fetch,
  spawnSyncImpl = spawnSync,
  hasBinary: hasBinaryFn = hasBinary,
  sleep = delay,
  systemPrompt = REST_OUTPUT_CONTRACT,
  cacheDir,
  outputKind = OUTPUT_KINDS.playwright,
  stage = 'test-generation',
  contextFingerprint = null,
  generationFingerprint = null,
  cacheIdentityPrompt,
  currentTargetSha256,
  onAttempt,
  cliProtectedRoot = MONOREPO_ROOT,
  now = Date.now
} = {}) {
  const outputContract = getOutputContract(outputKind);
  const settingsEnv = resolveStageEnv(env, stage);
  const maxPromptChars = promptCharBudget(settingsEnv);
  let brain = selectBrain(settingsEnv, { hasBinary: hasBinaryFn, stage });
  const timeoutMs = positiveInt(settingsEnv.AI_BRAIN_TIMEOUT_MS) ?? DEFAULT_BRAIN_TIMEOUT_MS;
  // AbortSignal.timeout covers the whole call (including retries/backoff) when the
  // caller does not provide its own signal.
  const effectiveSignal = signal ?? AbortSignal.timeout(timeoutMs);
  if (brain.kind === 'none') {
    throw new Error(
      'No AI brain available: set ANTHROPIC_API_KEY or OPENAI_API_KEY (environment or .env), or install the claude or codex CLI.'
    );
  }

  const structuredOutputRequested = booleanSetting(settingsEnv, 'AI_STRUCTURED_OUTPUT', true);
  const isCliBrain = brain.kind === 'claude-cli' || brain.kind === 'codex-cli';
  const structuredOutput = brain.kind === 'codex-cli'
    ? true
    : brain.kind === 'anthropic'
    ? structuredOutputRequested
    : brain.kind === 'openai' && structuredOutputRequested && supportsOpenAIStructuredOutput(brain.model);
  const effectiveSystemPrompt = structuredOutput
    ? outputContract.structuredSystemPrompt(systemPrompt)
    : outputContract.unstructuredSystemPrompt(systemPrompt);
  const originalPrompt = String(prompt ?? '');
  const compactPrompt = !isCliBrain && outputContract.kind === OUTPUT_KINDS.playwright
    && booleanSetting(settingsEnv, 'AI_COMPACT_REST_PROMPT', true);
  const effectivePrompt = compactPrompt ? compactRestGenerationTask(originalPrompt) : originalPrompt;
  const wrapCliPrompt = outputContract.kind === OUTPUT_KINDS.flowSpecDraft || systemPrompt !== REST_OUTPUT_CONTRACT;
  const transportPrompt = isCliBrain && wrapCliPrompt
    ? `${effectiveSystemPrompt}\n\n${effectivePrompt}`
    : effectivePrompt;
  enforcePromptCharBudget(isCliBrain ? transportPrompt : `${effectiveSystemPrompt}${transportPrompt}`, maxPromptChars);

  const promptMetrics = {
    originalPromptChars: originalPrompt.length,
    promptChars: effectivePrompt.length,
    systemPromptChars: isCliBrain && !wrapCliPrompt ? 0 : effectiveSystemPrompt.length + (isCliBrain && wrapCliPrompt ? 2 : 0),
    compactedPromptChars: effectivePrompt.length,
    compactionSavedChars: Math.max(0, originalPrompt.length - effectivePrompt.length)
  };
  const promptCache = booleanSetting(settingsEnv, 'AI_PROMPT_CACHE', false);
  const hasVerifiedTargetState = currentTargetSha256 === null
    || (typeof currentTargetSha256 === 'string' && /^[a-f0-9]{64}$/.test(currentTargetSha256));
  if (currentTargetSha256 !== undefined && !hasVerifiedTargetState) {
    throw new TypeError('currentTargetSha256 must be a lowercase SHA-256 digest, null for proven missing, or omitted for unknown.');
  }
  // Unit tests use injected transports. Avoid touching the repository cache unless
  // a test explicitly supplies cacheDir; production fetch keeps caching on by default.
  const resultCache = outputContract.kind === OUTPUT_KINDS.playwright
    && booleanSetting(settingsEnv, 'AI_RESULT_CACHE', true)
    && brain.kind !== 'claude-cli'
    && hasVerifiedTargetState
    && ((isCliBrain ? spawnSyncImpl === spawnSync : fetchImpl === fetch) || cacheDir !== undefined);
  const codexCliModel = brain.kind === 'codex-cli' ? codexCliModelSetting(settingsEnv) : null;
  let cacheModel = brain.model;
  if (brain.kind === 'codex-cli') {
    cacheModel = resultCache
      ? codexCliIdentity(resolveBinary('codex', settingsEnv) ?? 'codex', codexCliModel, settingsEnv, spawnSyncImpl, timeoutMs, cliProtectedRoot)
      : codexCliModel ?? 'codex-cli-default';
    brain = {
      ...brain,
      model: codexCliModel ?? 'codex-cli-default'
    };
  } else if (brain.kind === 'claude-cli') {
    brain = { ...brain, model: 'claude-cli-default' };
  }
  const cacheKnobs = {
    outputKind: outputContract.kind,
    outputContract: outputContract.id,
    stage,
    contextFingerprint,
    generationFingerprint,
    policyVersion: GENERATION_POLICY_VERSION,
    structuredOutput,
    compactPrompt,
    cacheEpoch: String(settingsEnv.AI_RESULT_CACHE_EPOCH ?? ''),
    maxTokens: brain.kind === 'anthropic'
      ? positiveInt(settingsEnv.ANTHROPIC_MAX_TOKENS) ?? DEFAULT_ANTHROPIC_MAX_TOKENS
      : brain.kind === 'openai'
        ? positiveInt(settingsEnv.OPENAI_MAX_TOKENS) ?? DEFAULT_OPENAI_MAX_TOKENS
        : null,
    reasoningEffort: brain.kind === 'openai' ? String(settingsEnv.OPENAI_REASONING_EFFORT ?? '') : '',
    verbosity: brain.kind === 'openai' ? String(settingsEnv.OPENAI_VERBOSITY ?? '') : ''
  };
  const cacheKey = resultCache ? createGenerationCacheKey({
    provider: brain.kind,
    model: cacheModel,
    systemPrompt: isCliBrain && !wrapCliPrompt ? outputContract.id : effectiveSystemPrompt,
    prompt: cacheIdentityPrompt ?? transportPrompt,
    contractVersion: `${REST_CONTRACT_VERSION}:${outputContract.id}`,
    knobs: cacheKnobs
  }) : null;
  const resultCacheStatus = cacheKey ? 'miss' : 'disabled';
  const providerPromptCacheStatus = isCliBrain
    ? 'not-supported'
    : providerPromptCacheControl(brain.kind, brain.model, promptCache);

  const readAcceptedCache = async () => {
    try {
      const startedAt = Date.now();
      const cached = await readGenerationCache({
        cacheDir,
        key: cacheKey,
        provider: brain.kind,
        model: cacheModel,
        contractVersion: `${REST_CONTRACT_VERSION}:${outputContract.id}`,
        currentTargetSha256
      });
      if (cached) {
        const sourceTotalTokens = tokenNumber(cached.usage.totalTokens)
          ?? sumKnown(tokenNumber(cached.usage.inputTokens), tokenNumber(cached.usage.outputTokens));
        const usage = {
          schemaVersion: GENERATION_USAGE_SCHEMA,
          provider: brain.kind,
          model: brain.model,
          requestId: null,
          responseId: null,
          serviceTier: null,
          inputTokens: 0,
          uncachedInputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
          retryCount: 0,
          retryTokens: 0,
          requestCount: 0,
          successfulRequests: 0,
          latencyMs: Date.now() - startedAt,
          resultCacheHit: true,
          resultCacheStatus: 'hit',
          providerPromptCacheStatus,
          singleFlightJoined: false,
          savedTokens: sourceTotalTokens ?? 0,
          sourceTotalTokens,
          ...promptMetrics
        };
        logUsage(usage);
        return { text: cached.text, brain, usage, cacheReference: cached.cacheReference };
      }
    } catch (error) {
      console.error(`[ai-client] result cache read skipped: ${error.message}`);
    }
    return null;
  };

  const executeProvider = async () => {
    let result;
    const enrichedOnAttempt = typeof onAttempt === 'function'
      ? (attempt) => {
          const terminalCacheStatus = attempt.retryStatus === 'retrying'
            ? {}
            : { resultCacheStatus, providerPromptCacheStatus };
          onAttempt({
            ...attempt,
            ...terminalCacheStatus,
            usage: attempt.usage ? {
              ...attempt.usage,
              resultCacheStatus,
              providerPromptCacheStatus,
              singleFlightJoined: false
            } : null
          });
        }
      : undefined;
    try {
      switch (brain.kind) {
        case 'anthropic': {
          result = await runAnthropic(effectivePrompt, {
            env: settingsEnv, model: brain.model, signal: effectiveSignal, fetchImpl, sleep,
            systemPrompt: effectiveSystemPrompt, structuredOutput, promptCache, promptMetrics, outputContract,
            stage, onAttempt: enrichedOnAttempt
          });
          break;
        }
        case 'openai': {
          result = await runOpenai(effectivePrompt, {
            env: settingsEnv, model: brain.model, signal: effectiveSignal, fetchImpl, sleep,
            systemPrompt: effectiveSystemPrompt, structuredOutput, promptCache, promptMetrics, outputContract,
            stage, onAttempt: enrichedOnAttempt
          });
          break;
        }
        case 'claude-cli': {
          const observed = runObservedCli({
            brain,
            binary: resolveBinary('claude', settingsEnv) ?? 'claude',
            args: ['-p'],
            prompt: transportPrompt,
            stage,
            sourceEnv: settingsEnv,
            protectedRoot: cliProtectedRoot,
            signal,
            timeoutMs,
            spawnSyncImpl,
            now,
            onAttempt,
            decode: outputContract.kind === OUTPUT_KINDS.flowSpecDraft
              ? (value) => validateContractOutput(decodeStructuredOutput(value, outputContract), outputContract)
              : undefined
          });
          result = {
            text: observed.value,
            usage: baseUsage({
              provider: brain.kind,
              model: brain.model,
              inputTokens: null,
              uncachedInputTokens: null,
              outputTokens: null,
              cachedTokens: 0,
              cacheWriteTokens: 0,
              reasoningTokens: 0,
              retryCount: 0,
              latencyMs: observed.durationMs,
              promptMetrics,
              providerPromptCacheStatus
            }),
            attempt: { attempt: 1, durationMs: observed.durationMs }
          };
          break;
        }
        case 'codex-cli': {
          const observed = runObservedCli({
            brain,
            binary: resolveBinary('codex', settingsEnv) ?? 'codex',
            args: ['exec', '-'],
            prompt: transportPrompt,
            stage,
            sourceEnv: settingsEnv,
            protectedRoot: cliProtectedRoot,
            signal,
            timeoutMs,
            spawnSyncImpl,
            now,
            onAttempt,
            outputSchema: outputContract.schema,
            cliModel: codexCliModel,
            decode: (value) => decodeCodexJsonlOutput(value, outputContract)
          });
          const decoded = observed.value;
          const usage = decoded.usage;
          result = {
            text: decoded.text,
            usage: baseUsage({
              provider: brain.kind,
              model: brain.model,
              inputTokens: usage?.inputTokens,
              uncachedInputTokens: usage?.uncachedInputTokens,
              outputTokens: usage?.outputTokens,
              cachedTokens: usage?.cachedTokens,
              cacheWriteTokens: usage?.cacheWriteTokens,
              totalTokens: usage?.totalTokens,
              reasoningTokens: usage?.reasoningTokens,
              retryCount: 0,
              latencyMs: observed.durationMs,
              promptMetrics,
              providerPromptCacheStatus
            }),
            attempt: { attempt: 1, durationMs: observed.durationMs }
          };
          break;
        }
        default:
          throw new Error(`Unsupported AI brain: ${brain.kind}`);
      }
    } catch (error) {
      if (error.usage) {
        error.usage = {
          ...error.usage,
          resultCacheStatus,
          providerPromptCacheStatus,
          singleFlightJoined: false
        };
      }
      throw error;
    }
    result.usage = {
      ...result.usage,
      resultCacheStatus,
      providerPromptCacheStatus,
      singleFlightJoined: false
    };
    logUsage(result.usage);

    // Syntax validation protects the candidate hand-off, but never makes the
    // response reusable. Only verified-generate may promote this in-memory
    // candidate after static and executed acceptance succeed.
    try {
      // A cached candidate must always be syntax/contract-valid. Legacy Claude
      // CLI calls without the exact cache retain their raw-output compatibility.
      if (outputContract.kind === OUTPUT_KINDS.flowSpecDraft || !isCliBrain || cacheKey) {
        if (outputContract.kind === OUTPUT_KINDS.playwright) {
          extractCodeBlock(result.text);
        } else {
          validateContractOutput(result.text, outputContract);
        }
      }
    } catch (error) {
      const failure = providerFailure(error, {
        usage: result.usage,
        failureReason: 'malformed-output',
        recorded: true
      });
      notifyAttempt(onAttempt, attemptRecord({
        ...result.attempt,
        provider: brain.kind,
        model: brain.model,
        stage,
        status: 'malformed',
        usage: result.usage,
        failureReason: 'malformed-output'
      }));
      throw failure;
    }
    notifyAttempt(onAttempt, attemptRecord({
      ...result.attempt,
      provider: brain.kind,
      model: brain.model,
      stage,
      status: 'succeeded',
      usage: result.usage
    }));
    const cacheCandidate = cacheKey
      ? createGenerationCacheCandidate({
          cacheDir,
          key: cacheKey,
          provider: brain.kind,
          model: cacheModel,
          contractVersion: `${REST_CONTRACT_VERSION}:${outputContract.id}`,
          text: result.text,
          inputTargetSha256: currentTargetSha256,
          usage: result.usage
        })
      : undefined;
    const { attempt: _attempt, ...publicResult } = result;
    const publicResultWithBrain = {
      ...publicResult,
      brain,
      ...(cacheCandidate ? { cacheCandidate } : {})
    };
    if (outputContract.kind === OUTPUT_KINDS.flowSpecDraft) trustedFlowSpecResults.set(publicResultWithBrain, publicResultWithBrain.text);
    return publicResultWithBrain;
  };

  if (!cacheKey) return executeProvider();
  // Stored keys remain semantic-only; in-memory coalescing is also scoped to
  // the physical cache directory so candidates can never cross cache roots.
  const flightKey = JSON.stringify([
    path.resolve(cacheDir ?? DEFAULT_GENERATION_CACHE_DIR),
    cacheKey,
    currentTargetSha256 === null ? 'missing' : currentTargetSha256
  ]);
  const existingFlight = generationFlights.get(flightKey);
  if (existingFlight) {
    const joinedAt = Date.now();
    try {
      const result = await existingFlight;
      const sourceTotalTokens = tokenNumber(result.usage?.sourceTotalTokens)
        ?? tokenNumber(result.usage?.totalTokens)
        ?? sumKnown(tokenNumber(result.usage?.inputTokens), tokenNumber(result.usage?.outputTokens));
      const usage = {
        ...result.usage,
        inputTokens: 0,
        uncachedInputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        retryCount: 0,
        retryTokens: 0,
        requestCount: 0,
        successfulRequests: 0,
        latencyMs: Date.now() - joinedAt,
        resultCacheHit: false,
        resultCacheStatus: 'single-flight-join',
        singleFlightJoined: true,
        savedTokens: sourceTotalTokens ?? 0,
        sourceTotalTokens
      };
      logUsage(usage);
      return { ...result, usage, singleFlightJoined: true };
    } catch (error) {
      const joinedError = new Error(error.message, { cause: error });
      joinedError.name = error.name;
      joinedError.usage = null;
      joinedError.failureReason = error.failureReason ?? 'single-flight-leader-failed';
      joinedError.provider = error.provider ?? brain.kind;
      joinedError.model = error.model ?? brain.model;
      joinedError.retryCount = 0;
      joinedError.singleFlightJoined = true;
      joinedError.providerPromptCacheStatus = providerPromptCacheStatus;
      throw joinedError;
    }
  }
  const flight = (async () => {
    const cached = await readAcceptedCache();
    return cached ?? executeProvider();
  })().finally(() => generationFlights.delete(flightKey));
  generationFlights.set(flightKey, flight);
  return flight;
}

// Bounded retry for transient HTTP failures: 429 and 5xx only, 2 retries max,
// Retry-After honored when present (capped), exponential backoff otherwise.
function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

function retryDelayMs(response, attempt) {
  const retryAfter = response.headers?.get?.('retry-after');
  if (retryAfter) {
    const seconds = Number.parseInt(String(retryAfter).trim(), 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
    }
  }

  return 1000 * 2 ** attempt;
}

async function fetchWithRetry(url, init, {
  provider, providerKind, model, stage, fetchImpl, sleep, signal, onAttempt
}) {
  let attempt = 0;
  const startedAt = Date.now();

  for (;;) {
    const attemptStartedAt = Date.now();
    let response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      const failure = providerFailure(error, {
        usage: null, failureReason: 'network-error', recorded: true, provider: providerKind, model, retryCount: attempt
      });
      notifyAttempt(onAttempt, attemptRecord({
        provider: providerKind,
        model,
        stage,
        attempt: attempt + 1,
        status: 'failed',
        durationMs: Date.now() - attemptStartedAt,
        usage: null,
        retryStatus: 'not-retried',
        failureReason: 'network-error'
      }));
      throw failure;
    }
    if (response.ok || !isRetryableStatus(response.status) || attempt >= MAX_HTTP_RETRIES) {
      return {
        response,
        retryCount: attempt,
        latencyMs: Date.now() - startedAt,
        attemptLatencyMs: Date.now() - attemptStartedAt
      };
    }

    const delayMs = retryDelayMs(response, attempt);
    notifyAttempt(onAttempt, attemptRecord({
      provider: providerKind,
      model,
      stage,
      attempt: attempt + 1,
      status: 'failed',
      durationMs: Date.now() - attemptStartedAt,
      usage: null,
      retryStatus: 'retrying',
      failureReason: `http-${response.status}`,
      httpStatus: response.status
    }));
    console.error(
      `[ai-client] ${provider} returned HTTP ${response.status}; retry ${attempt + 1}/${MAX_HTTP_RETRIES} in ${delayMs}ms.`
    );
    await sleep(delayMs, undefined, { signal: signal ?? init.signal });
    attempt += 1;
  }
}

async function runAnthropic(prompt, {
  env, model, signal, fetchImpl, sleep, systemPrompt, structuredOutput, promptCache, promptMetrics, outputContract,
  stage, onAttempt
}) {
  const maxTokens = positiveInt(env.ANTHROPIC_MAX_TOKENS) ?? DEFAULT_ANTHROPIC_MAX_TOKENS;
  const cacheTtl = enumSetting(env, 'ANTHROPIC_PROMPT_CACHE_TTL', ['5m', '1h'], DEFAULT_PROMPT_CACHE_TTL);

  const requestBody = {
    model,
    max_tokens: maxTokens,
    system: promptCache
      ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral', ttl: cacheTtl } }]
      : systemPrompt,
    messages: [{ role: 'user', content: prompt }]
  };
  if (structuredOutput) {
    requestBody.output_config = {
      format: { type: 'json_schema', schema: outputContract.schema }
    };
  }

  // Determinism note: temperature/top_p/top_k are deliberately NOT sent — they are
  // removed on current Opus models and return HTTP 400. Determinism is honestly
  // delegated to the static gates (ai:test:review / ai:test:gate), which re-check
  // every generated file regardless of sampling.
  const request = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify(requestBody),
    signal
  }, {
    provider: 'Anthropic', providerKind: 'anthropic', model, stage, fetchImpl, sleep, signal, onAttempt
  });
  const { response, retryCount, latencyMs, attemptLatencyMs } = request;

  try {
    await assertOk(response, 'Anthropic');
  } catch (error) {
    const failure = providerFailure(error, {
      usage: null,
      failureReason: `http-${response.status}`,
      recorded: true,
      provider: 'anthropic',
      model,
      retryCount
    });
    notifyAttempt(onAttempt, attemptRecord({
      provider: 'anthropic', model, stage, attempt: retryCount + 1, status: 'failed',
      durationMs: attemptLatencyMs, usage: null, retryStatus: retryCount > 0 ? 'exhausted' : 'not-retried',
      failureReason: `http-${response.status}`, httpStatus: response.status
    }));
    throw failure;
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    const failure = providerFailure(error, {
      usage: null, failureReason: 'malformed-response', recorded: true, provider: 'anthropic', model, retryCount
    });
    notifyAttempt(onAttempt, attemptRecord({
      provider: 'anthropic', model, stage, attempt: retryCount + 1, status: 'malformed',
      durationMs: attemptLatencyMs, usage: null, failureReason: 'malformed-response'
    }));
    throw failure;
  }

  const uncachedInputTokens = tokenNumber(data?.usage?.input_tokens);
  const cachedTokens = tokenNumber(data?.usage?.cache_read_input_tokens) ?? 0;
  const cacheWriteTokens = tokenNumber(data?.usage?.cache_creation_input_tokens) ?? 0;
  const inputTokens = uncachedInputTokens === null
    ? null
    : uncachedInputTokens + cachedTokens + cacheWriteTokens;
  const identifiers = responseIdentifiers(response, data);
  const usage = baseUsage({
    provider: 'anthropic',
    model,
    inputTokens,
    uncachedInputTokens,
    outputTokens: data?.usage?.output_tokens,
    cachedTokens,
    cacheWriteTokens,
    reasoningTokens: data?.usage?.thinking_tokens,
    retryCount,
    latencyMs,
    ...identifiers,
    serviceTier: data?.usage?.service_tier,
    promptMetrics,
    providerPromptCacheStatus: providerPromptCacheControl('anthropic', model, promptCache)
  });

  const failResponse = (message, failureReason, status) => {
    const failure = providerFailure(new Error(message), { usage, failureReason, recorded: true });
    notifyAttempt(onAttempt, attemptRecord({
      provider: 'anthropic', model, stage, attempt: retryCount + 1, status,
      durationMs: attemptLatencyMs, usage, failureReason
    }));
    throw failure;
  };

  if (data?.stop_reason === 'max_tokens') {
    failResponse(
      `Anthropic response was truncated (stop_reason=max_tokens at max_tokens=${maxTokens}). ` +
      'Raise ANTHROPIC_MAX_TOKENS (environment or .env) and re-run; no file was written.',
      'truncated',
      'truncated'
    );
  }
  if (data?.stop_reason === 'refusal') {
    failResponse(
      'Anthropic refused to generate (stop_reason=refusal). Inspect the generation task for content the model will not work with; no file was written.',
      'refused',
      'refused'
    );
  }

  const rawText = Array.isArray(data?.content)
    ? data.content.filter((block) => block?.type === 'text' || typeof block?.text === 'string').map((block) => block.text ?? '').join('')
    : '';

  if (!rawText) {
    failResponse('Anthropic API returned an empty text response.', 'empty-response', 'empty');
  }

  let text;
  try {
    text = structuredOutput || outputContract.kind === OUTPUT_KINDS.flowSpecDraft
      ? decodeStructuredOutput(rawText, outputContract)
      : rawText;
  } catch (error) {
    const failure = providerFailure(error, { usage, failureReason: 'malformed-output', recorded: true });
    notifyAttempt(onAttempt, attemptRecord({
      provider: 'anthropic', model, stage, attempt: retryCount + 1, status: 'malformed',
      durationMs: attemptLatencyMs, usage, failureReason: 'malformed-output'
    }));
    throw failure;
  }
  return { text, usage, attempt: { attempt: retryCount + 1, durationMs: attemptLatencyMs } };
}

async function runOpenai(prompt, {
  env, model, signal, fetchImpl, sleep, systemPrompt, structuredOutput, promptCache, promptMetrics, outputContract,
  stage, onAttempt
}) {
  const maxTokens = positiveInt(env.OPENAI_MAX_TOKENS) ?? DEFAULT_OPENAI_MAX_TOKENS;
  const modernModel = isModernOpenAIModel(model);
  const requestBody = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ]
  };

  if (modernModel) {
    requestBody.max_completion_tokens = maxTokens;
  } else {
    requestBody.temperature = 0;
    requestBody.seed = 42;
    requestBody.max_tokens = maxTokens;
  }

  if (structuredOutput) {
    requestBody.response_format = {
      type: 'json_schema',
      json_schema: {
        name: outputContract.schemaName,
        strict: true,
        schema: outputContract.schema
      }
    };
  }

  const stablePromptCacheKey = String(env.OPENAI_PROMPT_CACHE_KEY ?? '').trim() ||
    `${DEFAULT_OPENAI_PROMPT_CACHE_KEY_PREFIX}:${createHash('sha256')
      .update(JSON.stringify({ model, systemPrompt, contract: outputContract.id }), 'utf8')
      .digest('hex')
      .slice(0, 24)}`;

  const explicitPromptCacheModel = /^gpt-5\.6(?:-|$)/i.test(model);
  if (explicitPromptCacheModel) {
    // GPT-5.6 otherwise writes a changing implicit user-message prefix at a
    // billable rate. Explicit mode with no marked block is a true cache-off
    // request; opt-in marks only the stable system content block.
    requestBody.prompt_cache_options = promptCache
      ? { mode: 'explicit', ttl: '30m' }
      : { mode: 'explicit' };
    if (promptCache) {
      requestBody.prompt_cache_key = stablePromptCacheKey;
      requestBody.messages[0] = {
        role: 'system',
        content: [{
          type: 'text',
          text: systemPrompt,
          prompt_cache_breakpoint: { mode: 'explicit' }
        }]
      };
    }
  } else if (promptCache) {
    requestBody.prompt_cache_key = stablePromptCacheKey;
  }

  if (/^gpt-5\.6(?:-|$)/i.test(model)) {
    requestBody.reasoning_effort = enumSetting(
      env,
      'OPENAI_REASONING_EFFORT',
      ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      'none'
    );
    requestBody.verbosity = enumSetting(env, 'OPENAI_VERBOSITY', ['low', 'medium', 'high'], 'low');
  }

  const serviceTier = enumSetting(env, 'OPENAI_SERVICE_TIER', ['auto', 'default', 'flex', 'priority'], undefined);
  if (serviceTier) {
    requestBody.service_tier = serviceTier;
  }

  const request = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(requestBody),
    signal
  }, {
    provider: 'OpenAI', providerKind: 'openai', model, stage, fetchImpl, sleep, signal, onAttempt
  });
  const { response, retryCount, latencyMs, attemptLatencyMs } = request;

  try {
    await assertOk(response, 'OpenAI');
  } catch (error) {
    const failure = providerFailure(error, {
      usage: null,
      failureReason: `http-${response.status}`,
      recorded: true,
      provider: 'openai',
      model,
      retryCount
    });
    notifyAttempt(onAttempt, attemptRecord({
      provider: 'openai', model, stage, attempt: retryCount + 1, status: 'failed',
      durationMs: attemptLatencyMs, usage: null, retryStatus: retryCount > 0 ? 'exhausted' : 'not-retried',
      failureReason: `http-${response.status}`, httpStatus: response.status
    }));
    throw failure;
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    const failure = providerFailure(error, {
      usage: null, failureReason: 'malformed-response', recorded: true, provider: 'openai', model, retryCount
    });
    notifyAttempt(onAttempt, attemptRecord({
      provider: 'openai', model, stage, attempt: retryCount + 1, status: 'malformed',
      durationMs: attemptLatencyMs, usage: null, failureReason: 'malformed-response'
    }));
    throw failure;
  }
  const choice = data?.choices?.[0];

  const inputTokens = tokenNumber(data?.usage?.prompt_tokens);
  const cachedTokens = tokenNumber(data?.usage?.prompt_tokens_details?.cached_tokens) ?? 0;
  const cacheWriteTokens = tokenNumber(data?.usage?.prompt_tokens_details?.cache_write_tokens) ?? 0;
  const identifiers = responseIdentifiers(response, data);
  const usage = baseUsage({
    provider: 'openai',
    model,
    inputTokens,
    uncachedInputTokens: inputTokens === null ? null : Math.max(0, inputTokens - cachedTokens - cacheWriteTokens),
    outputTokens: data?.usage?.completion_tokens,
    cachedTokens,
    cacheWriteTokens,
    reasoningTokens: data?.usage?.completion_tokens_details?.reasoning_tokens,
    retryCount,
    latencyMs,
    ...identifiers,
    serviceTier: data?.service_tier,
    promptMetrics,
    providerPromptCacheStatus: providerPromptCacheControl('openai', model, promptCache)
  });

  const failResponse = (message, failureReason, status) => {
    const failure = providerFailure(new Error(message), { usage, failureReason, recorded: true });
    notifyAttempt(onAttempt, attemptRecord({
      provider: 'openai', model, stage, attempt: retryCount + 1, status,
      durationMs: attemptLatencyMs, usage, failureReason
    }));
    throw failure;
  };

  if (choice?.finish_reason === 'length') {
    failResponse(
      `OpenAI response was truncated (finish_reason=length at max_tokens=${maxTokens}). ` +
      'Raise OPENAI_MAX_TOKENS (environment or .env) and re-run; no file was written.',
      'truncated',
      'truncated'
    );
  }
  if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') {
    failResponse(
      'OpenAI refused to generate the requested output; inspect the generation task and re-run. No file was written.',
      'refused',
      'refused'
    );
  }

  const rawText = choice?.message?.content ?? '';

  if (!rawText) {
    failResponse('OpenAI API returned an empty text response.', 'empty-response', 'empty');
  }

  let text;
  try {
    text = structuredOutput || outputContract.kind === OUTPUT_KINDS.flowSpecDraft
      ? decodeStructuredOutput(rawText, outputContract)
      : rawText;
  } catch (error) {
    const failure = providerFailure(error, { usage, failureReason: 'malformed-output', recorded: true });
    notifyAttempt(onAttempt, attemptRecord({
      provider: 'openai', model, stage, attempt: retryCount + 1, status: 'malformed',
      durationMs: attemptLatencyMs, usage, failureReason: 'malformed-output'
    }));
    throw failure;
  }
  return { text, usage, attempt: { attempt: retryCount + 1, durationMs: attemptLatencyMs } };
}

function cliProviderArgs(providerKind, args, workspace, { outputSchemaPath, cliModel } = {}) {
  if (providerKind === 'claude-cli') {
    return [
      ...args,
      '--safe-mode',
      '--tools',
      '',
      '--strict-mcp-config',
      '--permission-mode',
      'plan',
      '--no-session-persistence',
      '--no-chrome'
    ];
  }
  if (providerKind === 'codex-cli') {
    const codexArgs = [
      'exec',
      '--sandbox',
      'read-only',
      '--cd',
      workspace,
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--color',
      'never',
      '-c',
      'shell_environment_policy.inherit=none',
      '--json',
      '--output-schema',
      outputSchemaPath,
      ...(cliModel ? ['--model', cliModel] : []),
      '-'
    ];
    return codexArgs;
  }
  return args;
}

function schemeString(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function isolateCliInvocation(binary, args, protectedRoot) {
  if (process.platform !== 'darwin' || !existsSync(DARWIN_SANDBOX_EXEC)) {
    return { binary, args };
  }
  const canonicalProtectedRoot = realpathSync(path.resolve(protectedRoot));
  const profile = [
    '(version 1)',
    '(allow default)',
    `(deny file-write* (subpath "${schemeString(canonicalProtectedRoot)}"))`
  ].join('\n');
  return {
    binary: DARWIN_SANDBOX_EXEC,
    args: ['-p', profile, binary, ...args]
  };
}

// shell:false; the potentially sensitive task is sent over stdin instead of argv.
// The provider starts in a disposable, read-only workspace with a provider-specific
// no-tools/read-only policy. On macOS, Seatbelt additionally denies writes anywhere
// under the monorepo even if the provider process itself is compromised.
function runCliBrain(binary, args, prompt, {
  providerKind,
  sourceEnv = process.env,
  protectedRoot = MONOREPO_ROOT,
  signal,
  timeoutMs,
  spawnSyncImpl = spawnSync,
  outputSchema,
  cliModel
} = {}) {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'ai-cli-provider-'));
  try {
    let outputSchemaPath;
    if (providerKind === 'codex-cli') {
      if (!outputSchema || typeof outputSchema !== 'object' || Array.isArray(outputSchema)) {
        throw new TypeError('Codex CLI requires an object output schema.');
      }
      outputSchemaPath = path.join(workspace, 'output-schema.json');
      writeFileSync(outputSchemaPath, `${JSON.stringify(outputSchema)}\n`, { encoding: 'utf8', mode: 0o400 });
      chmodSync(outputSchemaPath, 0o400);
    }
    chmodSync(workspace, 0o500);
    const providerArgs = cliProviderArgs(providerKind, args, workspace, { outputSchemaPath, cliModel });
    const invocation = isolateCliInvocation(binary, providerArgs, protectedRoot);
    const result = spawnSyncImpl(invocation.binary, invocation.args, {
      shell: false,
      cwd: workspace,
      env: buildCliEnvironment(providerKind, sourceEnv),
      encoding: 'utf8',
      input: prompt,
      maxBuffer: 64 * 1024 * 1024,
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      signal
    });

    if (result.error) {
      if (result.error.code === 'ETIMEDOUT') {
        throw new Error(`${binary} CLI timed out after ${timeoutMs}ms (raise AI_BRAIN_TIMEOUT_MS to allow longer runs).`);
      }
      throw new Error(`Failed to run ${binary} CLI: ${result.error.message}`);
    }

    if (result.status !== 0) {
      const stderr = (result.stderr ?? '').trim();
      throw new Error(`${binary} CLI exited with status ${result.status}${stderr ? `: ${stderr.slice(0, 500)}` : ''}.`);
    }

    return result.stdout ?? '';
  } finally {
    // Restore owner write permission only for removal; the provider has already exited.
    try {
      chmodSync(workspace, 0o700);
    } catch {
      // rmSync below still gives the best cleanup attempt after a provider-side failure.
    }
    rmSync(workspace, { recursive: true, force: true });
  }
}

async function assertOk(response, provider) {
  if (response.ok) {
    return;
  }

  let snippet = '';
  try {
    snippet = (await response.text()).slice(0, 500);
  } catch {
    // Ignore body read failures; the status alone is still actionable.
  }

  throw new Error(`${provider} API request failed with status ${response.status}${snippet ? `: ${snippet}` : ''}.`);
}

// Quick plausibility check before any extracted block may be written to disk:
// the candidate must parse as TypeScript with no parse diagnostics and contain at
// least one statement. This rejects prose ("I cannot help with that."), shell
// snippets, and truncated tails that happen to sit inside a fence.
function isPlausibleTypeScript(code) {
  if (!code) {
    return false;
  }

  const sourceFile = ts.createSourceFile('generated.spec.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics = sourceFile.parseDiagnostics ?? [];
  return sourceFile.statements.length > 0 && diagnostics.length === 0;
}

// Pulls the test file out of a chat response. Collects ALL fenced blocks with their
// info strings, prefers ts/typescript-tagged fences (longest first), falls back to
// the longest bare fence, and THROWS — never returning prose — when a fence does not
// close (truncated output), when no ts/bare fence exists (refusals, commentary), or
// when no candidate parses as plausible TypeScript. CRLF input is normalized to LF.
export function extractCodeBlock(text) {
  const source = String(text ?? '');
  const lines = source.split(/\r\n|\r|\n/);
  const fences = [];
  let open = null;

  for (const line of lines) {
    const marker = line.match(/^\s*```(.*)$/);
    if (!marker) {
      if (open) {
        open.lines.push(line);
      }
      continue;
    }

    if (!open) {
      open = { info: marker[1].trim().toLowerCase(), lines: [] };
      continue;
    }

    if (marker[1].trim() === '') {
      fences.push({ info: open.info, content: open.lines.join('\n') });
      open = null;
    } else {
      // A ```lang line inside an open fence is literal content (Markdown closing
      // fences carry no info string), e.g. a fence echoed from the task body.
      open.lines.push(line);
    }
  }

  if (open) {
    throw new Error(
      'AI response contains a code fence that never closes (likely truncated output); refusing to extract a test file.'
    );
  }

  const tagged = fences.filter((fence) => fence.info === 'ts' || fence.info === 'typescript');
  const bare = fences.filter((fence) => fence.info === '');
  const candidates = (tagged.length > 0 ? tagged : bare)
    .slice()
    .sort((a, b) => b.content.length - a.content.length);

  if (candidates.length === 0) {
    throw new Error(
      'AI response contains no ```ts/```typescript (or bare) fenced code block; refusing to write a test file.'
    );
  }

  for (const candidate of candidates) {
    const code = candidate.content.trim();
    if (isPlausibleTypeScript(code)) {
      return code;
    }
  }

  throw new Error(
    'No fenced code block in the AI response parses as plausible TypeScript; refusing to write a test file.'
  );
}
