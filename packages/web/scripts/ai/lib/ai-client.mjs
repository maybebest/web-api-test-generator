// AI brain abstraction. Selects and runs an "AI brain" with this precedence
// (highest first), overridable by env AI_BRAIN (auto|anthropic|openai|claude-cli|codex-cli;
// claude/codex are accepted aliases for the CLI brains):
//   1. ANTHROPIC_API_KEY set (env or .env) -> 'anthropic'   (Anthropic Messages REST API via fetch)
//   2. OPENAI_API_KEY set (env or .env)    -> 'openai'      (OpenAI Chat Completions via fetch)
//   3. `claude` binary on PATH             -> 'claude-cli'  (Claude Code CLI, headless `claude -p`)
//   4. `codex` binary on PATH              -> 'codex-cli'   (`codex exec`)
//   5. otherwise                           -> 'none'
// AI_BRAIN forces a specific kind and errors clearly when the forced brain is
// unavailable (missing key or missing binary). selectBrain is pure: it only reads
// env + the filesystem (PATH lookup) and never makes a network call or spawns a
// process. Dependency-free: node: builtins plus the already-vendored `typescript`
// package (used by the static reviewers too) for output sanity checks.
//
// .env support: the npm scripts run plain `node`, so process.env alone would miss
// <repoRoot>/.env. resolveEnv() merges a tiny dependency-free .env parse under the
// real environment — variables already set in the real environment ALWAYS win.

import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import ts from 'typescript';

export const BRAIN_KINDS = ['anthropic', 'openai', 'claude-cli', 'codex-cli', 'none'];

// Anthropic aliases are the canonical model ids — no date suffix.
const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8';
// Dated OpenAI snapshot instead of the floating "gpt-4o" alias, for reproducibility.
const DEFAULT_OPENAI_MODEL = 'gpt-4o-2024-11-20';
const DEFAULT_ANTHROPIC_MAX_TOKENS = 16000;
const DEFAULT_OPENAI_MAX_TOKENS = 16000;
const DEFAULT_BRAIN_TIMEOUT_MS = 120000;
const MAX_HTTP_RETRIES = 2;
const MAX_RETRY_AFTER_MS = 30000;

// Repo root resolved relative to this file (scripts/ai/lib/ai-client.mjs), never cwd.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Output contract for single-shot REST brains. The generation task file is written
// for interactive coding agents (it tells them to run npm commands); a single REST
// completion cannot run commands, so the envelope pins what the response must be.
// CLI brains (claude/codex) receive the raw task instead — they can run the commands.
export const REST_OUTPUT_CONTRACT = `You are generating a Playwright test file in a single, non-interactive API call.

Output contract (mandatory):
- Respond with EXACTLY ONE fenced \`\`\`ts code block containing the COMPLETE contents of the test file.
- No commentary before or after the code block. No other fenced code blocks of any kind.
- The task below was written for interactive coding agents. Its numbered steps that say to run commands (npm run ..., playwright ..., "Paste this task into Codex") are for those agents only — you cannot run commands. IGNORE the run-command steps and produce the final file contents instead.
- Ground every locator in the DOM discovery / recording evidence included in the task. NEVER invent selectors, test ids, roles, labels, or URLs that are not evidenced by the task content.
- Follow every other rule in the task (spec header comment, fixtures import, test.step structure, locator policy, declared mocks, data cases).`;

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

// Checks whether an executable named `name` exists on process.env.PATH.
// On darwin/linux verifies the file is executable (X_OK); Windows-ish fallback
// appends common executable extensions.
export function hasBinary(name, env = process.env) {
  const rawPath = env.PATH ?? env.Path ?? '';
  if (!rawPath) {
    return false;
  }

  const dirs = rawPath.split(path.delimiter).filter(Boolean);
  const candidates = process.platform === 'win32'
    ? [name, `${name}.exe`, `${name}.cmd`, `${name}.bat`]
    : [name];

  for (const dir of dirs) {
    for (const candidate of candidates) {
      const fullPath = path.join(dir, candidate);
      if (!existsSync(fullPath)) {
        continue;
      }

      if (process.platform === 'win32') {
        return true;
      }

      try {
        accessSync(fullPath, constants.X_OK);
        return true;
      } catch {
        // Not executable; keep looking.
      }
    }
  }

  return false;
}

// Pure: returns the chosen brain descriptor without any network/process side effects.
// The binary check is injectable via options.hasBinary so tests stay hermetic.
// Callers that want .env support must pass resolveEnv(...).env — selectBrain itself
// never reads the filesystem for env values.
export function selectBrain(env = process.env, { hasBinary: hasBinaryFn = hasBinary } = {}) {
  const forced = (env.AI_BRAIN ?? 'auto').trim().toLowerCase();
  const anthropicKey = (env.ANTHROPIC_API_KEY ?? '').trim();
  const openaiKey = (env.OPENAI_API_KEY ?? '').trim();
  const anthropicModel = (env.AI_ANTHROPIC_MODEL ?? '').trim() || DEFAULT_ANTHROPIC_MODEL;
  const openaiModel = (env.AI_OPENAI_MODEL ?? '').trim() || DEFAULT_OPENAI_MODEL;

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
    if (!hasBinaryFn('claude', env)) {
      throw new Error(
        `AI_BRAIN=${forced} but no claude binary is on PATH. Install the Claude Code CLI or unset AI_BRAIN.`
      );
    }
    return claudeCli();
  }
  if (forced === 'codex-cli' || forced === 'codex') {
    if (!hasBinaryFn('codex', env)) {
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
  if (hasBinaryFn('claude', env)) {
    return claudeCli();
  }
  if (hasBinaryFn('codex', env)) {
    return codexCli();
  }

  return none();
}

function positiveInt(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

// Selects the brain and executes it, returning { text, brain, usage }.
// `usage` is { model, inputTokens, outputTokens } for REST brains and undefined for
// CLI brains. fetch/spawnSync/hasBinary/sleep are injectable so tests stay hermetic.
export async function runBrain(prompt, {
  env = process.env,
  signal,
  fetchImpl = fetch,
  spawnSyncImpl = spawnSync,
  hasBinary: hasBinaryFn = hasBinary,
  sleep = delay,
  systemPrompt = REST_OUTPUT_CONTRACT
} = {}) {
  const brain = selectBrain(env, { hasBinary: hasBinaryFn });
  const timeoutMs = positiveInt(env.AI_BRAIN_TIMEOUT_MS) ?? DEFAULT_BRAIN_TIMEOUT_MS;
  // AbortSignal.timeout covers the whole call (including retries/backoff) when the
  // caller does not provide its own signal.
  const effectiveSignal = signal ?? AbortSignal.timeout(timeoutMs);

  switch (brain.kind) {
    case 'anthropic': {
      const { text, usage } = await runAnthropic(prompt, {
        env, model: brain.model, signal: effectiveSignal, fetchImpl, sleep, systemPrompt
      });
      return { text, brain, usage };
    }
    case 'openai': {
      const { text, usage } = await runOpenai(prompt, {
        env, model: brain.model, signal: effectiveSignal, fetchImpl, sleep, systemPrompt
      });
      return { text, brain, usage };
    }
    case 'claude-cli':
      return { text: runCliBrain('claude', ['-p', prompt], { signal, timeoutMs, spawnSyncImpl }), brain };
    case 'codex-cli':
      return { text: runCliBrain('codex', ['exec', prompt], { signal, timeoutMs, spawnSyncImpl }), brain };
    default:
      throw new Error(
        'No AI brain available: set ANTHROPIC_API_KEY or OPENAI_API_KEY (environment or .env), or install the claude or codex CLI.'
      );
  }
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

async function fetchWithRetry(url, init, { provider, fetchImpl, sleep }) {
  let attempt = 0;

  for (;;) {
    const response = await fetchImpl(url, init);
    if (response.ok || !isRetryableStatus(response.status) || attempt >= MAX_HTTP_RETRIES) {
      return response;
    }

    const delayMs = retryDelayMs(response, attempt);
    console.error(
      `[ai-client] ${provider} returned HTTP ${response.status}; retry ${attempt + 1}/${MAX_HTTP_RETRIES} in ${delayMs}ms.`
    );
    await sleep(delayMs);
    attempt += 1;
  }
}

function logUsage(kind, model, inputTokens, outputTokens) {
  console.error(`[ai-client] ${kind} model=${model} input_tokens=${inputTokens ?? 'n/a'} output_tokens=${outputTokens ?? 'n/a'}`);
}

async function runAnthropic(prompt, { env, model, signal, fetchImpl, sleep, systemPrompt }) {
  const maxTokens = positiveInt(env.ANTHROPIC_MAX_TOKENS) ?? DEFAULT_ANTHROPIC_MAX_TOKENS;

  // Determinism note: temperature/top_p/top_k are deliberately NOT sent — they are
  // removed on current Opus models and return HTTP 400. Determinism is honestly
  // delegated to the static gates (ai:test:review / ai:test:gate), which re-check
  // every generated file regardless of sampling.
  const response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }]
    }),
    signal
  }, { provider: 'Anthropic', fetchImpl, sleep });

  await assertOk(response, 'Anthropic');

  const data = await response.json();

  if (data?.stop_reason === 'max_tokens') {
    throw new Error(
      `Anthropic response was truncated (stop_reason=max_tokens at max_tokens=${maxTokens}). ` +
      'Raise ANTHROPIC_MAX_TOKENS (environment or .env) and re-run; no file was written.'
    );
  }
  if (data?.stop_reason === 'refusal') {
    throw new Error(
      'Anthropic refused to generate (stop_reason=refusal). Inspect the generation task for content the model will not work with; no file was written.'
    );
  }

  const text = Array.isArray(data?.content)
    ? data.content.filter((block) => block?.type === 'text' || typeof block?.text === 'string').map((block) => block.text ?? '').join('')
    : '';

  if (!text) {
    throw new Error('Anthropic API returned an empty text response.');
  }

  const inputTokens = data?.usage?.input_tokens ?? null;
  const outputTokens = data?.usage?.output_tokens ?? null;
  logUsage('anthropic', model, inputTokens, outputTokens);

  return { text, usage: { model, inputTokens, outputTokens } };
}

async function runOpenai(prompt, { env, model, signal, fetchImpl, sleep, systemPrompt }) {
  const maxTokens = positiveInt(env.OPENAI_MAX_TOKENS) ?? DEFAULT_OPENAI_MAX_TOKENS;

  const response = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      seed: 42,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ]
    }),
    signal
  }, { provider: 'OpenAI', fetchImpl, sleep });

  await assertOk(response, 'OpenAI');

  const data = await response.json();
  const choice = data?.choices?.[0];

  if (choice?.finish_reason === 'length') {
    throw new Error(
      `OpenAI response was truncated (finish_reason=length at max_tokens=${maxTokens}). ` +
      'Raise OPENAI_MAX_TOKENS (environment or .env) and re-run; no file was written.'
    );
  }

  const text = choice?.message?.content ?? '';

  if (!text) {
    throw new Error('OpenAI API returned an empty text response.');
  }

  const inputTokens = data?.usage?.prompt_tokens ?? null;
  const outputTokens = data?.usage?.completion_tokens ?? null;
  logUsage('openai', model, inputTokens, outputTokens);

  return { text, usage: { model, inputTokens, outputTokens } };
}

// shell:false; prompt is passed as an argv element, never interpolated into a shell string.
// timeout + SIGKILL guard against a wedged CLI hanging the generation run forever.
function runCliBrain(binary, args, { signal, timeoutMs, spawnSyncImpl = spawnSync } = {}) {
  const result = spawnSyncImpl(binary, args, {
    shell: false,
    encoding: 'utf8',
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
