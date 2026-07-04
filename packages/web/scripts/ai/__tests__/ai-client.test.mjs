import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  BRAIN_KINDS,
  REST_OUTPUT_CONTRACT,
  defaultDotEnvPath,
  extractCodeBlock,
  keySource,
  parseDotEnv,
  resolveEnv,
  runBrain,
  selectBrain
} from '../lib/ai-client.mjs';
import { recordGenerationInManifest, resolveOutputPath } from '../ai-generate.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const doctorPath = path.join(repoRoot, 'scripts', 'ai', 'ai-doctor.mjs');

// Stub binary check so the suite never touches the real PATH.
const noBinaries = { hasBinary: () => false };
const allBinaries = { hasBinary: () => true };

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function fakeResponse({ ok = true, status = 200, body = {}, headers = {} } = {}) {
  return {
    ok,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function anthropicBody({ text = 'import { test } from "fixtures/test";', stopReason = 'end_turn', usage = { input_tokens: 11, output_tokens: 22 } } = {}) {
  return { content: [{ type: 'text', text }], stop_reason: stopReason, usage };
}

function openaiBody({ text = 'const a = 1;', finishReason = 'stop', usage = { prompt_tokens: 7, completion_tokens: 9 } } = {}) {
  return { choices: [{ message: { content: text }, finish_reason: finishReason }], usage };
}

// Records each fetch call and replays the queued responses in order.
function recordingFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (queue.length === 0) {
      throw new Error('recordingFetch ran out of queued responses');
    }
    return queue.shift();
  };
  return { calls, fetchImpl };
}

function recordingSleep() {
  const sleeps = [];
  const sleep = async (ms) => {
    sleeps.push(ms);
  };
  return { sleeps, sleep };
}

test('BRAIN_KINDS lists the supported kinds', () => {
  assert.deepEqual(BRAIN_KINDS, ['anthropic', 'openai', 'claude-cli', 'codex-cli', 'none']);
});

// --- selectBrain ---------------------------------------------------------

test('selectBrain prefers anthropic when ANTHROPIC_API_KEY is set', () => {
  const brain = selectBrain({ ANTHROPIC_API_KEY: 'sk-ant-test' }, noBinaries);

  assert.equal(brain.kind, 'anthropic');
  assert.equal(brain.model, 'claude-opus-4-8');
});

test('selectBrain honors AI_ANTHROPIC_MODEL override', () => {
  const brain = selectBrain(
    { ANTHROPIC_API_KEY: 'sk-ant-test', AI_ANTHROPIC_MODEL: 'claude-custom-9' },
    noBinaries
  );

  assert.equal(brain.kind, 'anthropic');
  assert.equal(brain.model, 'claude-custom-9');
});

test('selectBrain falls back to openai when only OPENAI_API_KEY is set', () => {
  const brain = selectBrain({ OPENAI_API_KEY: 'sk-openai-test' }, noBinaries);

  assert.equal(brain.kind, 'openai');
  assert.equal(brain.model, 'gpt-4o-2024-11-20');
});

test('selectBrain honors AI_OPENAI_MODEL override', () => {
  const brain = selectBrain(
    { OPENAI_API_KEY: 'sk-openai-test', AI_OPENAI_MODEL: 'gpt-5-mini' },
    noBinaries
  );

  assert.equal(brain.model, 'gpt-5-mini');
});

test('selectBrain prefers anthropic over openai when both keys are set', () => {
  const brain = selectBrain(
    { ANTHROPIC_API_KEY: 'sk-ant-test', OPENAI_API_KEY: 'sk-openai-test' },
    noBinaries
  );

  assert.equal(brain.kind, 'anthropic');
});

test('AI_BRAIN=claude-cli forces claude-cli regardless of API keys', () => {
  const brain = selectBrain(
    { AI_BRAIN: 'claude-cli', ANTHROPIC_API_KEY: 'sk-ant-test', OPENAI_API_KEY: 'sk-openai-test' },
    allBinaries
  );

  assert.equal(brain.kind, 'claude-cli');
});

test('AI_BRAIN accepts claude and codex as CLI aliases', () => {
  assert.equal(selectBrain({ AI_BRAIN: 'claude' }, allBinaries).kind, 'claude-cli');
  assert.equal(selectBrain({ AI_BRAIN: 'codex' }, allBinaries).kind, 'codex-cli');
});

test('AI_BRAIN=openai forces openai and skips anthropic', () => {
  const brain = selectBrain(
    { AI_BRAIN: 'openai', ANTHROPIC_API_KEY: 'sk-ant-test', OPENAI_API_KEY: 'sk-openai-test' },
    noBinaries
  );

  assert.equal(brain.kind, 'openai');
});

test('AI_BRAIN=anthropic without a key fails fast with an actionable error', () => {
  assert.throws(
    () => selectBrain({ AI_BRAIN: 'anthropic' }, allBinaries),
    /AI_BRAIN=anthropic but ANTHROPIC_API_KEY is not set/
  );
});

test('AI_BRAIN=openai without a key fails fast with an actionable error', () => {
  assert.throws(
    () => selectBrain({ AI_BRAIN: 'openai', ANTHROPIC_API_KEY: 'sk-ant-test' }, allBinaries),
    /AI_BRAIN=openai but OPENAI_API_KEY is not set/
  );
});

test('forced CLI brains fail fast when the binary is missing', () => {
  assert.throws(() => selectBrain({ AI_BRAIN: 'claude-cli' }, noBinaries), /no claude binary is on PATH/);
  assert.throws(() => selectBrain({ AI_BRAIN: 'claude' }, noBinaries), /no claude binary is on PATH/);
  assert.throws(() => selectBrain({ AI_BRAIN: 'codex-cli' }, noBinaries), /no codex binary is on PATH/);
  assert.throws(() => selectBrain({ AI_BRAIN: 'codex' }, noBinaries), /no codex binary is on PATH/);
});

test('selectBrain uses claude-cli when a claude binary is on PATH and no keys are set', () => {
  const brain = selectBrain({}, { hasBinary: (name) => name === 'claude' });

  assert.equal(brain.kind, 'claude-cli');
});

test('selectBrain falls back to codex-cli when only codex is on PATH', () => {
  const brain = selectBrain({}, { hasBinary: (name) => name === 'codex' });

  assert.equal(brain.kind, 'codex-cli');
});

test('selectBrain prefers claude-cli over codex-cli when both are present', () => {
  const brain = selectBrain({}, allBinaries);

  assert.equal(brain.kind, 'claude-cli');
});

test('selectBrain returns none with empty env and no binaries', () => {
  const brain = selectBrain({}, noBinaries);

  assert.equal(brain.kind, 'none');
});

test('selectBrain treats whitespace-only API keys as unset', () => {
  const brain = selectBrain({ ANTHROPIC_API_KEY: '   ' }, noBinaries);

  assert.equal(brain.kind, 'none');
});

test('selectBrain rejects an unknown AI_BRAIN value', () => {
  assert.throws(() => selectBrain({ AI_BRAIN: 'bogus' }, noBinaries), /Unsupported AI_BRAIN value/);
});

// --- .env loading --------------------------------------------------------

test('parseDotEnv handles comments, blanks, quotes, export and values with =', () => {
  const parsed = parseDotEnv([
    '# a comment',
    '',
    'FOO=bar',
    'EMPTY=',
    'QUOTED="quoted value"',
    "SINGLE='single value'",
    'export EXPORTED=yes',
    'EQ=a=b',
    '  INDENTED=ok',
    'NOT A KEY VALUE LINE',
    '=missing-key',
    '1BAD=skipped'
  ].join('\n'));

  assert.deepEqual(parsed, {
    FOO: 'bar',
    EMPTY: '',
    QUOTED: 'quoted value',
    SINGLE: 'single value',
    EXPORTED: 'yes',
    EQ: 'a=b',
    INDENTED: 'ok'
  });
});

test('parseDotEnv handles CRLF input', () => {
  assert.deepEqual(parseDotEnv('A=1\r\nB=2\r\n'), { A: '1', B: '2' });
});

// Inline-comment semantics must match the installed `dotenv` package, because
// playwright.config.ts still parses the SAME .env file with dotenv — a value
// that differs between the two parsers would silently diverge between the AI
// scripts and the Playwright config. Every expectation below was verified
// against dotenv@17 (`require('dotenv').parse(...)`) on this repo.
test('parseDotEnv strips unquoted inline comments exactly like dotenv', () => {
  // Original probe: 'KEY=sk-abc # my key' must parse to "sk-abc", not "sk-abc # my key".
  assert.deepEqual(parseDotEnv('KEY=sk-abc # my key'), { KEY: 'sk-abc' });
  // dotenv starts the comment at the first unquoted '#' even with NO preceding
  // whitespace: 'a#b' parses to "a" (verified, NOT "a#b").
  assert.deepEqual(parseDotEnv('KEY=a#b'), { KEY: 'a' });
  assert.deepEqual(parseDotEnv('KEY=sk-abc# trailing'), { KEY: 'sk-abc' });
  // Only the first '#' matters; inner whitespace before it is trimmed away.
  assert.deepEqual(parseDotEnv('KEY=a #b#c'), { KEY: 'a' });
  assert.deepEqual(parseDotEnv('KEY=  spaced value # comment '), { KEY: 'spaced value' });
  // A value that is nothing but a comment is empty.
  assert.deepEqual(parseDotEnv('KEY=#allcomment'), { KEY: '' });
  assert.deepEqual(parseDotEnv('KEY= # only comment'), { KEY: '' });
});

test('parseDotEnv preserves # inside quoted values exactly like dotenv', () => {
  assert.deepEqual(parseDotEnv('KEY="sk-abc # my key"'), { KEY: 'sk-abc # my key' });
  assert.deepEqual(parseDotEnv("KEY='sk-abc # my key'"), { KEY: 'sk-abc # my key' });
  assert.deepEqual(parseDotEnv('KEY="a#b"'), { KEY: 'a#b' });
  // Comment AFTER the closing quote is dropped; quoted content survives intact.
  assert.deepEqual(parseDotEnv('KEY="quoted" # after quote'), { KEY: 'quoted' });
  assert.deepEqual(parseDotEnv("KEY='a # b' # c"), { KEY: 'a # b' });
});

test('parseDotEnv quote edge cases match dotenv', () => {
  // Unterminated quote: value kept literally (dotenv keeps the opening quote).
  assert.deepEqual(parseDotEnv('KEY="abc'), { KEY: '"abc' });
  // Unterminated quote with an inline '#': comment still cut, quote kept.
  assert.deepEqual(parseDotEnv('KEY="abc # def'), { KEY: '"abc' });
  // Quoted block with trailing non-comment text: kept literally, like dotenv.
  assert.deepEqual(parseDotEnv('KEY="a"b'), { KEY: '"a"b' });
  // Symmetric outer quotes with a quote inside: outer pair stripped, like dotenv.
  assert.deepEqual(parseDotEnv("KEY='a'b'"), { KEY: "a'b" });
});

test('defaultDotEnvPath resolves the repo root relative to the script, not cwd', () => {
  assert.equal(defaultDotEnvPath(), path.join(repoRoot, '.env'));
});

test('resolveEnv loads missing keys from .env but never overrides the real environment', () => {
  withTempDir('ai-client-dotenv-', (dir) => {
    const dotEnvPath = path.join(dir, '.env');
    fs.writeFileSync(dotEnvPath, 'ANTHROPIC_API_KEY=from-file\nOPENAI_API_KEY=file-openai\n');

    const resolved = resolveEnv({ ANTHROPIC_API_KEY: 'from-env' }, { dotEnvPath });

    assert.equal(resolved.dotEnvLoaded, true);
    assert.equal(resolved.env.ANTHROPIC_API_KEY, 'from-env');
    assert.equal(resolved.env.OPENAI_API_KEY, 'file-openai');
    assert.equal(resolved.sources.ANTHROPIC_API_KEY, 'environment');
    assert.equal(resolved.sources.OPENAI_API_KEY, '.env');
  });
});

test('resolveEnv real-env precedence holds even for empty-string environment values', () => {
  withTempDir('ai-client-dotenv-', (dir) => {
    const dotEnvPath = path.join(dir, '.env');
    fs.writeFileSync(dotEnvPath, 'ANTHROPIC_API_KEY=from-file\n');

    const resolved = resolveEnv({ ANTHROPIC_API_KEY: '' }, { dotEnvPath });

    assert.equal(resolved.env.ANTHROPIC_API_KEY, '');
    assert.equal(keySource(resolved, 'ANTHROPIC_API_KEY'), 'absent');
  });
});

test('resolveEnv honors AI_DOTENV_PATH from the real environment', () => {
  withTempDir('ai-client-dotenv-', (dir) => {
    const dotEnvPath = path.join(dir, '.env');
    fs.writeFileSync(dotEnvPath, 'OPENAI_API_KEY=via-override\n');

    const resolved = resolveEnv({ AI_DOTENV_PATH: dotEnvPath });

    assert.equal(resolved.dotEnvPath, dotEnvPath);
    assert.equal(resolved.env.OPENAI_API_KEY, 'via-override');
    assert.equal(keySource(resolved, 'OPENAI_API_KEY'), '.env');
  });
});

test('resolveEnv with a missing .env leaves the environment untouched', () => {
  const resolved = resolveEnv({ FOO: 'bar' }, { dotEnvPath: path.join(os.tmpdir(), 'definitely', 'missing', '.env') });

  assert.equal(resolved.dotEnvLoaded, false);
  assert.equal(resolved.env.FOO, 'bar');
  assert.equal(resolved.env.ANTHROPIC_API_KEY, undefined);
});

test('a key provided only via .env selects the anthropic brain', () => {
  withTempDir('ai-client-dotenv-', (dir) => {
    const dotEnvPath = path.join(dir, '.env');
    fs.writeFileSync(dotEnvPath, 'ANTHROPIC_API_KEY=sk-ant-from-dotenv\n');

    const resolved = resolveEnv({}, { dotEnvPath });
    const brain = selectBrain(resolved.env, noBinaries);

    assert.equal(brain.kind, 'anthropic');
    assert.equal(keySource(resolved, 'ANTHROPIC_API_KEY'), '.env');
  });
});

test('keySource reports absent for unset keys', () => {
  const resolved = resolveEnv({}, { dotEnvPath: path.join(os.tmpdir(), 'missing-such-file', '.env') });

  assert.equal(keySource(resolved, 'ANTHROPIC_API_KEY'), 'absent');
});

// --- extractCodeBlock ----------------------------------------------------

test('extractCodeBlock pulls code out of a ts fence', () => {
  const text = 'Here is your test:\n\n```ts\nimport { test } from "x";\ntest("a", () => {});\n```\n\nDone.';

  assert.equal(extractCodeBlock(text), 'import { test } from "x";\ntest("a", () => {});');
});

test('extractCodeBlock handles a typescript fence and a bare fence', () => {
  assert.equal(extractCodeBlock('```typescript\nconst a = 1;\n```'), 'const a = 1;');
  assert.equal(extractCodeBlock('```\nconst b = 2;\n```'), 'const b = 2;');
});

test('extractCodeBlock skips a leading bash fence and picks the ts fence (reproduced bug)', () => {
  const reply = [
    'Run the gates first:',
    '```bash',
    'npm run ai:test:review',
    '```',
    'Then the test:',
    '```ts',
    'import { test } from "fixtures/test";',
    'test("a", async () => {});',
    '```'
  ].join('\n');

  assert.equal(
    extractCodeBlock(reply),
    'import { test } from "fixtures/test";\ntest("a", async () => {});'
  );
});

test('extractCodeBlock prefers the longest ts fence when several exist', () => {
  const reply = [
    '```ts',
    'const a = 1;',
    '```',
    '```ts',
    'import { test } from "fixtures/test";',
    'test("b", async () => {});',
    '```'
  ].join('\n');

  assert.match(extractCodeBlock(reply), /import \{ test \}/);
});

test('extractCodeBlock prefers a ts fence over a longer bare fence', () => {
  const reply = [
    '```',
    'const padding = "this bare fence is much much much longer than the ts one";',
    '```',
    '```ts',
    'const a = 1;',
    '```'
  ].join('\n');

  assert.equal(extractCodeBlock(reply), 'const a = 1;');
});

test('extractCodeBlock errors instead of returning prose when only non-ts fences exist', () => {
  assert.throws(
    () => extractCodeBlock('```bash\nnpm run ai:test:review\n```'),
    /refusing to write a test file/
  );
});

test('extractCodeBlock errors on a fence that never closes (truncated output)', () => {
  assert.throws(
    () => extractCodeBlock('```ts\nimport { test } from "fixtures/test";\n'),
    /never closes/
  );
});

test('extractCodeBlock errors on refusal prose with no fences (never writes the file)', () => {
  assert.throws(
    () => extractCodeBlock('I cannot help with generating this test file.'),
    /refusing to write a test file/
  );
});

test('extractCodeBlock errors when no fence parses as plausible TypeScript', () => {
  assert.throws(
    () => extractCodeBlock('```\nHere is some prose explaining what the test would do.\n```'),
    /plausible TypeScript/
  );
});

test('extractCodeBlock handles CRLF fences', () => {
  assert.equal(extractCodeBlock('```ts\r\nconst a = 1;\r\n```\r\n'), 'const a = 1;');
});

test('extractCodeBlock treats a ```lang line inside an open fence as content', () => {
  const reply = [
    '```ts',
    'const fenceExample = 1;',
    '```',
    '',
    '```text',
    'not the test',
    '```'
  ].join('\n');

  assert.equal(extractCodeBlock(reply), 'const fenceExample = 1;');
});

// --- runBrain: Anthropic REST --------------------------------------------

test('runBrain anthropic pins the REST output contract and current-API request shape', async () => {
  const { calls, fetchImpl } = recordingFetch([fakeResponse({ body: anthropicBody() })]);

  const result = await runBrain('TASK CONTENT', {
    env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
    ...noBinaries,
    fetchImpl
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].init.headers['x-api-key'], 'sk-ant-test');
  assert.equal(calls[0].init.headers['anthropic-version'], '2023-06-01');
  assert.ok(calls[0].init.signal instanceof AbortSignal);

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'claude-opus-4-8');
  assert.equal(body.max_tokens, 16000);
  assert.equal(body.system, REST_OUTPUT_CONTRACT);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'TASK CONTENT' }]);
  // Sampling params are removed on current Opus models and would return HTTP 400.
  assert.ok(!('temperature' in body));
  assert.ok(!('top_p' in body));
  assert.ok(!('top_k' in body));

  assert.equal(result.text, 'import { test } from "fixtures/test";');
  assert.equal(result.brain.kind, 'anthropic');
  assert.deepEqual(result.usage, { model: 'claude-opus-4-8', inputTokens: 11, outputTokens: 22 });
});

test('runBrain anthropic honors ANTHROPIC_MAX_TOKENS', async () => {
  const { calls, fetchImpl } = recordingFetch([fakeResponse({ body: anthropicBody() })]);

  await runBrain('task', {
    env: { ANTHROPIC_API_KEY: 'sk-ant-test', ANTHROPIC_MAX_TOKENS: '32000' },
    ...noBinaries,
    fetchImpl
  });

  assert.equal(JSON.parse(calls[0].init.body).max_tokens, 32000);
});

test('runBrain anthropic fails fast on stop_reason=max_tokens with an actionable message', async () => {
  const { fetchImpl } = recordingFetch([
    fakeResponse({ body: anthropicBody({ stopReason: 'max_tokens' }) })
  ]);

  await assert.rejects(
    runBrain('task', { env: { ANTHROPIC_API_KEY: 'sk-ant-test' }, ...noBinaries, fetchImpl }),
    /truncated.*max_tokens.*Raise ANTHROPIC_MAX_TOKENS/s
  );
});

test('runBrain anthropic fails fast on stop_reason=refusal', async () => {
  const { fetchImpl } = recordingFetch([
    fakeResponse({ body: anthropicBody({ stopReason: 'refusal' }) })
  ]);

  await assert.rejects(
    runBrain('task', { env: { ANTHROPIC_API_KEY: 'sk-ant-test' }, ...noBinaries, fetchImpl }),
    /refused.*stop_reason=refusal/s
  );
});

test('runBrain retries 429 honoring Retry-After, then succeeds', async () => {
  const { sleeps, sleep } = recordingSleep();
  const { calls, fetchImpl } = recordingFetch([
    fakeResponse({ ok: false, status: 429, headers: { 'retry-after': '2' } }),
    fakeResponse({ body: anthropicBody() })
  ]);

  const result = await runBrain('task', {
    env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
    ...noBinaries,
    fetchImpl,
    sleep
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [2000]);
  assert.equal(result.text, 'import { test } from "fixtures/test";');
});

test('runBrain retries 5xx with exponential backoff when Retry-After is absent', async () => {
  const { sleeps, sleep } = recordingSleep();
  const { calls, fetchImpl } = recordingFetch([
    fakeResponse({ ok: false, status: 503 }),
    fakeResponse({ ok: false, status: 500 }),
    fakeResponse({ body: anthropicBody() })
  ]);

  await runBrain('task', {
    env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
    ...noBinaries,
    fetchImpl,
    sleep
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [1000, 2000]);
});

test('runBrain gives up after 2 retries and surfaces the HTTP failure', async () => {
  const { sleep } = recordingSleep();
  const { calls, fetchImpl } = recordingFetch([
    fakeResponse({ ok: false, status: 500 }),
    fakeResponse({ ok: false, status: 500 }),
    fakeResponse({ ok: false, status: 500 })
  ]);

  await assert.rejects(
    runBrain('task', { env: { ANTHROPIC_API_KEY: 'sk-ant-test' }, ...noBinaries, fetchImpl, sleep }),
    /Anthropic API request failed with status 500/
  );
  assert.equal(calls.length, 3);
});

test('runBrain does not retry non-retryable HTTP errors like 400', async () => {
  const { sleeps, sleep } = recordingSleep();
  const { calls, fetchImpl } = recordingFetch([fakeResponse({ ok: false, status: 400 })]);

  await assert.rejects(
    runBrain('task', { env: { ANTHROPIC_API_KEY: 'sk-ant-test' }, ...noBinaries, fetchImpl, sleep }),
    /status 400/
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(sleeps, []);
});

// --- runBrain: OpenAI REST -----------------------------------------------

test('runBrain openai pins snapshot model, deterministic sampling and the contract', async () => {
  const { calls, fetchImpl } = recordingFetch([fakeResponse({ body: openaiBody() })]);

  const result = await runBrain('TASK CONTENT', {
    env: { OPENAI_API_KEY: 'sk-openai-test' },
    ...noBinaries,
    fetchImpl
  });

  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-openai-test');

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'gpt-4o-2024-11-20');
  assert.equal(body.temperature, 0);
  assert.equal(body.seed, 42);
  assert.equal(body.max_tokens, 16000);
  assert.deepEqual(body.messages, [
    { role: 'system', content: REST_OUTPUT_CONTRACT },
    { role: 'user', content: 'TASK CONTENT' }
  ]);

  assert.equal(result.text, 'const a = 1;');
  assert.deepEqual(result.usage, { model: 'gpt-4o-2024-11-20', inputTokens: 7, outputTokens: 9 });
});

test('runBrain openai honors OPENAI_MAX_TOKENS', async () => {
  const { calls, fetchImpl } = recordingFetch([fakeResponse({ body: openaiBody() })]);

  await runBrain('task', {
    env: { OPENAI_API_KEY: 'sk-openai-test', OPENAI_MAX_TOKENS: '4096' },
    ...noBinaries,
    fetchImpl
  });

  assert.equal(JSON.parse(calls[0].init.body).max_tokens, 4096);
});

test('runBrain openai fails fast on finish_reason=length with an actionable message', async () => {
  const { fetchImpl } = recordingFetch([
    fakeResponse({ body: openaiBody({ finishReason: 'length' }) })
  ]);

  await assert.rejects(
    runBrain('task', { env: { OPENAI_API_KEY: 'sk-openai-test' }, ...noBinaries, fetchImpl }),
    /truncated.*finish_reason=length.*Raise OPENAI_MAX_TOKENS/s
  );
});

// --- runBrain: CLI brains --------------------------------------------------

test('runBrain passes the RAW task to CLI brains with timeout and SIGKILL', async () => {
  const calls = [];
  const spawnSyncImpl = (binary, args, options) => {
    calls.push({ binary, args, options });
    return { status: 0, stdout: 'cli output', stderr: '' };
  };

  const result = await runBrain('RAW TASK', {
    env: { AI_BRAIN: 'claude-cli' },
    hasBinary: () => true,
    spawnSyncImpl
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].binary, 'claude');
  // No REST envelope: the CLI agent receives the task verbatim (it can run commands).
  assert.deepEqual(calls[0].args, ['-p', 'RAW TASK']);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.timeout, 120000);
  assert.equal(calls[0].options.killSignal, 'SIGKILL');
  assert.equal(result.text, 'cli output');
  assert.equal(result.brain.kind, 'claude-cli');
  assert.equal(result.usage, undefined);
});

test('runBrain honors AI_BRAIN_TIMEOUT_MS for CLI brains', async () => {
  const calls = [];
  const spawnSyncImpl = (binary, args, options) => {
    calls.push({ binary, args, options });
    return { status: 0, stdout: 'ok', stderr: '' };
  };

  await runBrain('task', {
    env: { AI_BRAIN: 'codex', AI_BRAIN_TIMEOUT_MS: '5000' },
    hasBinary: () => true,
    spawnSyncImpl
  });

  assert.equal(calls[0].binary, 'codex');
  assert.deepEqual(calls[0].args, ['exec', 'task']);
  assert.equal(calls[0].options.timeout, 5000);
});

test('runBrain surfaces a CLI timeout as an actionable error', async () => {
  const spawnSyncImpl = () => ({ error: { code: 'ETIMEDOUT', message: 'spawnSync claude ETIMEDOUT' } });

  await assert.rejects(
    runBrain('task', { env: { AI_BRAIN: 'claude-cli' }, hasBinary: () => true, spawnSyncImpl }),
    /claude CLI timed out after 120000ms.*AI_BRAIN_TIMEOUT_MS/s
  );
});

test('runBrain throws a clear error when no brain is available', async () => {
  await assert.rejects(
    runBrain('task', { env: {}, hasBinary: () => false }),
    /No AI brain available/
  );
});

// --- ai-generate manifest telemetry ----------------------------------------

test('recordGenerationInManifest adds brain/model/usage to the sibling run manifest', () => {
  withTempDir('ai-generate-manifest-', (dir) => {
    const taskPath = path.join(dir, 'generation-task.md');
    const manifestPath = path.join(dir, 'manifest.json');
    fs.writeFileSync(taskPath, '# task');
    fs.writeFileSync(manifestPath, `${JSON.stringify({ specPath: 'specs/x.md', specSha256: 'abc' })}\n`);

    const updated = recordGenerationInManifest({
      promptPath: taskPath,
      outPath: 'tests/regression/x.spec.ts',
      brain: { kind: 'anthropic', model: 'claude-opus-4-8' },
      usage: { model: 'claude-opus-4-8', inputTokens: 12, outputTokens: 34 },
      now: () => new Date('2026-06-11T00:00:00.000Z')
    });

    assert.equal(updated, true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    // Existing gate-matching fields stay untouched.
    assert.equal(manifest.specPath, 'specs/x.md');
    assert.equal(manifest.specSha256, 'abc');
    assert.deepEqual(manifest.generation, {
      brain: 'anthropic',
      model: 'claude-opus-4-8',
      outPath: 'tests/regression/x.spec.ts',
      completedAt: '2026-06-11T00:00:00.000Z',
      usage: { inputTokens: 12, outputTokens: 34 }
    });
  });
});

test('recordGenerationInManifest is a no-op when no manifest exists', () => {
  withTempDir('ai-generate-no-manifest-', (dir) => {
    const taskPath = path.join(dir, 'generation-task.md');
    fs.writeFileSync(taskPath, '# task');

    const updated = recordGenerationInManifest({
      promptPath: taskPath,
      outPath: 'tests/x.spec.ts',
      brain: { kind: 'claude-cli' },
      usage: undefined
    });

    assert.equal(updated, false);
  });
});

test('resolveOutputPath keeps generated tests under packages/web/tests', () => {
  const webRoot = repoRoot;

  assert.equal(
    resolveOutputPath('tests/regression/generated.spec.ts', webRoot),
    path.join(webRoot, 'tests', 'regression', 'generated.spec.ts')
  );
  assert.equal(
    resolveOutputPath('packages/web/tests/regression/generated.spec.ts', webRoot),
    path.join(webRoot, 'tests', 'regression', 'generated.spec.ts')
  );

  assert.throws(
    () => resolveOutputPath('../api/tests/generated.spec.ts', webRoot),
    /outside packages\/web/
  );
  assert.throws(
    () => resolveOutputPath('specs/generated.md', webRoot),
    /packages\/web\/tests/
  );
  assert.throws(
    () => resolveOutputPath('tests/regression/generated.ts', webRoot),
    /\.spec\.ts/
  );
});

// --- ai-doctor end-to-end (subprocess; no network, no @playwright/test) ----

test('ai-doctor exits 0 with the graceful table when no brain is available', () => {
  const result = spawnSync(process.execPath, [doctorPath], {
    encoding: 'utf8',
    timeout: 30000,
    env: {
      PATH: '',
      AI_DOTENV_PATH: path.join(os.tmpdir(), 'definitely-missing-dir', '.env')
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Selected brain: none/);
  assert.match(result.stdout, /ANTHROPIC_API_KEY: absent/);
  assert.match(result.stdout, /OPENAI_API_KEY: absent/);
  assert.match(result.stdout, /\.env file: not found/);
});

test('ai-doctor --require exits 1 when no brain is available', () => {
  const result = spawnSync(process.execPath, [doctorPath, '--require'], {
    encoding: 'utf8',
    timeout: 30000,
    env: {
      PATH: '',
      AI_DOTENV_PATH: path.join(os.tmpdir(), 'definitely-missing-dir', '.env')
    }
  });

  assert.equal(result.status, 1);
});

test('ai-doctor selects anthropic from a temp .env and reports source=.env without key material', () => {
  withTempDir('ai-doctor-dotenv-', (dir) => {
    const dotEnvPath = path.join(dir, '.env');
    fs.writeFileSync(dotEnvPath, 'ANTHROPIC_API_KEY=sk-ant-fake-for-doctor\n');

    const result = spawnSync(process.execPath, [doctorPath], {
      encoding: 'utf8',
      timeout: 30000,
      env: { PATH: '', AI_DOTENV_PATH: dotEnvPath }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Selected brain: anthropic/);
    assert.match(result.stdout, /Model: claude-opus-4-8/);
    assert.match(result.stdout, /ANTHROPIC_API_KEY: \.env/);
    assert.match(result.stdout, /\.env file: loaded/);
    assert.ok(!result.stdout.includes('sk-ant-fake-for-doctor'), 'doctor must never print key material');
    assert.ok(!result.stderr.includes('sk-ant-fake-for-doctor'), 'doctor must never print key material');
  });
});

test('ai-doctor reports environment as the source when the real env wins over .env', () => {
  withTempDir('ai-doctor-dotenv-', (dir) => {
    const dotEnvPath = path.join(dir, '.env');
    fs.writeFileSync(dotEnvPath, 'ANTHROPIC_API_KEY=sk-ant-from-file\n');

    const result = spawnSync(process.execPath, [doctorPath], {
      encoding: 'utf8',
      timeout: 30000,
      env: { PATH: '', AI_DOTENV_PATH: dotEnvPath, ANTHROPIC_API_KEY: 'sk-ant-from-real-env' }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Selected brain: anthropic/);
    assert.match(result.stdout, /ANTHROPIC_API_KEY: environment/);
    assert.ok(!result.stdout.includes('sk-ant-from-real-env'));
    assert.ok(!result.stdout.includes('sk-ant-from-file'));
  });
});

test('ai-doctor reports a clear error for a forced-but-unavailable brain', () => {
  const result = spawnSync(process.execPath, [doctorPath], {
    encoding: 'utf8',
    timeout: 30000,
    env: {
      PATH: '',
      AI_BRAIN: 'anthropic',
      AI_DOTENV_PATH: path.join(os.tmpdir(), 'definitely-missing-dir', '.env')
    }
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /AI_BRAIN=anthropic but ANTHROPIC_API_KEY is not set/);
});

// --- POM locator-policy convention -----------------------------------------

// locator-policy.md: positional picks (.first()/.last()/.nth(n)) in Page Objects
// and Component Objects are enforced through human review, not the static test
// reviewers — this self-test pins the comment convention so a POM positional
// pick can never land silently without a documented reason.
test('POM positional picks carry a locator-policy:exception comment on the previous line', () => {
  const positionalPick = /\.(?:first|last)\(\)|\.nth\(\s*\d/;
  const pomDirs = ['pages', 'components'];
  const violations = [];

  for (const dir of pomDirs) {
    const dirPath = path.join(repoRoot, dir);
    if (!fs.existsSync(dirPath)) {
      continue;
    }
    for (const entry of fs.readdirSync(dirPath)) {
      if (!entry.endsWith('.ts')) {
        continue;
      }
      const lines = fs.readFileSync(path.join(dirPath, entry), 'utf8').split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const trimmed = lines[i].trim();
        // Skip comment lines: an exception comment may itself mention .first().
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
          continue;
        }
        if (!positionalPick.test(lines[i])) {
          continue;
        }
        const previous = (lines[i - 1] ?? '').trim();
        if (!previous.startsWith('// locator-policy:exception ')) {
          violations.push(`${dir}/${entry}:${i + 1}: ${trimmed}`);
        }
      }
    }
  }

  assert.deepEqual(violations, [], `POM positional picks without exception comment:\n${violations.join('\n')}`);
});
