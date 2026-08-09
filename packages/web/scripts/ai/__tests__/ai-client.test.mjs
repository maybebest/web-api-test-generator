import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  BRAIN_KINDS,
  CODE_OUTPUT_SCHEMA,
  GENERATION_USAGE_SCHEMA,
  REST_OUTPUT_CONTRACT,
  STRUCTURED_REST_OUTPUT_CONTRACT,
  buildCliEnvironment,
  decodeCodexJsonlOutput,
  defaultDotEnvPath,
  extractCodeBlock,
  keySource,
  isTrustedFlowSpecResult,
  parseDotEnv,
  resolveEnv,
  runBrain,
  selectBrain
} from '../lib/ai-client.mjs';
import {
  recordGenerationInManifest,
  recordStandaloneGenerationManifest,
  resolveOutputPath
} from '../ai-generate.mjs';
import { promoteGenerationCache } from '../lib/generation-cache.mjs';
import {
  FLOW_SPEC_DRAFT_SCHEMA,
  flowSpecDraftTransportChars,
  getOutputContract,
  renderFlowSpecDraft
} from '../lib/output-contracts.mjs';

const ACCEPTED_QUALITY_FINGERPRINT = 'c'.repeat(64);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const doctorPath = path.join(repoRoot, 'scripts', 'ai', 'ai-doctor.mjs');

// Stub binary check so the suite never touches the real PATH.
const noBinaries = { hasBinary: () => false };
const allBinaries = { hasBinary: () => true };

function providerArgs(call, binary) {
  if (call.binary !== '/usr/bin/sandbox-exec') {
    return call.args;
  }
  const binaryIndex = call.args.indexOf(binary);
  assert.notEqual(binaryIndex, -1, `expected sandbox wrapper to invoke ${binary}`);
  return call.args.slice(binaryIndex + 1);
}

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    const result = fn(dir);
    if (result && typeof result.finally === 'function') {
      return result.finally(() => fs.rmSync(dir, { recursive: true, force: true }));
    }
    fs.rmSync(dir, { recursive: true, force: true });
    return result;
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
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

function anthropicBody({ text = JSON.stringify({ code: 'import { test } from "fixtures/test";' }), stopReason = 'end_turn', usage = { input_tokens: 11, output_tokens: 22 } } = {}) {
  return { id: 'msg_test_123', content: [{ type: 'text', text }], stop_reason: stopReason, usage };
}

function openaiBody({ text = JSON.stringify({ code: 'const a = 1;' }), finishReason = 'stop', usage = { prompt_tokens: 7, completion_tokens: 9 } } = {}) {
  return { id: 'chatcmpl_test_123', choices: [{ message: { content: text }, finish_reason: finishReason }], usage };
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

function semanticFlowDraft(overrides = {}) {
  return {
    flowTitle: 'Checkout as a returning customer',
    metadataRows: [
      { field: 'Flow ID', value: 'FLOW-CHECKOUT-1' },
      { field: 'Spec Version', value: '1.0.0' },
      { field: 'Owner', value: 'qa@example.test' },
      { field: 'Priority', value: 'P1' },
      { field: 'Test Type', value: 'regression' },
      { field: 'Auth', value: 'none' },
      { field: 'Target Test File', value: 'tests/regression/checkout.spec.ts' },
      { field: 'Base Path', value: '/checkout' },
      { field: 'Tags', value: '@generated @regression' }
    ],
    userStory: { asA: 'returning customer', iWantTo: 'complete checkout', soThat: 'I can place an order' },
    preconditions: ['A deterministic cart exists.'],
    outOfScope: ['Live payment providers.'],
    stabilityRows: [
      { field: 'Parallel Safe', value: 'yes' },
      { field: 'Data Isolation', value: 'per-test' },
      { field: 'Allowed Retries', value: '0' }
    ],
    variants: { columns: ['Locale', 'Role', 'Plan'], rows: [{ values: ['en-US', 'guest', 'standard'] }] },
    includes: ['none'],
    businessRules: [{ ruleId: 'RULE-001', rule: 'Checkout validates the cart.', formula: 'cart total > 0', blockingBehavior: 'Show validation.' }],
    dataCases: [{
      caseId: 'DC-001',
      inputs: [{ name: 'email', value: 'customer@example.test' }],
      expected: [{ name: 'result', value: 'Confirmation is visible' }],
      notes: 'Primary deterministic case'
    }],
    testData: [{ name: 'email', value: 'customer@example.test', notes: 'fake user only' }],
    mocks: [{ method: 'POST', url: '/api/orders', scenario: 'Checkout succeeds', status: 201, bodyJson: '{"requestId":"REQ-999"}' }],
    flowSteps: [
      { step: '1', acIds: ['AC-001'], action: 'Open page', target: '/checkout', input: 'n/a', expectedResult: 'Checkout is visible', assertionHint: 'heading is visible' },
      { step: '2', acIds: ['AC-002'], action: 'Fill email', target: 'Email field', input: 'customer@example.test', expectedResult: 'Email is accepted', assertionHint: 'field has value' },
      { step: '3', acIds: ['AC-003'], action: 'Submit', target: 'Submit button', input: 'n/a', expectedResult: 'Confirmation is visible', assertionHint: 'confirmation heading visible' }
    ],
    negativeCases: [{ caseId: 'NEG-001', scenario: 'Missing email', expectedResult: 'Validation is visible' }],
    acceptanceCriteria: [
      { id: 'AC-001', text: 'The customer can open checkout.' },
      { id: 'AC-002', text: 'The customer can enter an email.' },
      { id: 'AC-003', text: 'The customer sees confirmation.' }
    ],
    notes: ['Fixture-only draft.'],
    ...overrides
  };
}

test('BRAIN_KINDS lists the supported kinds', () => {
  assert.deepEqual(BRAIN_KINDS, ['anthropic', 'openai', 'claude-cli', 'codex-cli', 'none']);
});

test('flow-spec transport budget counts the semantic suffix and CLI separator exactly once', () => {
  const systemPrompt = 'SYSTEM';
  const prompt = 'PROMPT';
  const contractPromptLength = getOutputContract('flow-spec-draft').structuredSystemPrompt(systemPrompt).length;
  assert.equal(flowSpecDraftTransportChars({ systemPrompt, prompt }), contractPromptLength + prompt.length);
  assert.equal(flowSpecDraftTransportChars({ systemPrompt, prompt, isCli: true }), contractPromptLength + prompt.length + 2);
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

test('selectBrain applies stage-specific brain and model overrides without changing global defaults', () => {
  const env = {
    ANTHROPIC_API_KEY: 'sk-ant-test',
    OPENAI_API_KEY: 'sk-openai-test',
    AI_BRAIN: 'openai',
    AI_OPENAI_MODEL: 'gpt-global',
    AI_SPEC_FIT_BRAIN: 'anthropic',
    AI_SPEC_FIT_ANTHROPIC_MODEL: 'claude-fit'
  };

  assert.deepEqual(selectBrain(env, { ...noBinaries, stage: 'spec-fit' }), {
    kind: 'anthropic',
    label: 'Anthropic Messages API',
    model: 'claude-fit'
  });
  assert.equal(selectBrain(env, { ...noBinaries, stage: 'test-generation' }).kind, 'openai');
  assert.equal(selectBrain(env, { ...noBinaries, stage: 'test-generation' }).model, 'gpt-global');
});

test('runBrain honors stage-specific maximum output tokens', async () => {
  const { calls, fetchImpl } = recordingFetch([fakeResponse({ body: openaiBody({
    text: JSON.stringify(semanticFlowDraft({ flowTitle: 'Fitted flow' }))
  }) })]);

  await runBrain('fit this flow', {
    env: {
      OPENAI_API_KEY: 'sk-openai-test',
      OPENAI_MAX_TOKENS: '4096',
      AI_SPEC_FIT_OPENAI_MAX_TOKENS: '768'
    },
    stage: 'spec-fit',
    outputKind: 'flow-spec-draft',
    ...noBinaries,
    fetchImpl
  });

  assert.equal(JSON.parse(calls[0].init.body).max_tokens, 768);
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

test('runBrain anthropic uses structured output, prompt caching, and normalized usage', async () => {
  const { calls, fetchImpl } = recordingFetch([
    fakeResponse({ body: anthropicBody(), headers: { 'x-request-id': 'req_anthropic_123' } })
  ]);

  const result = await runBrain('TASK CONTENT', {
    env: { ANTHROPIC_API_KEY: 'sk-ant-test', AI_PROMPT_CACHE: 'true' },
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
  assert.deepEqual(body.system, [{
    type: 'text',
    text: STRUCTURED_REST_OUTPUT_CONTRACT,
    cache_control: { type: 'ephemeral', ttl: '5m' }
  }]);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'TASK CONTENT' }]);
  assert.equal('cache_control' in body, false);
  assert.deepEqual(body.output_config, {
    format: { type: 'json_schema', schema: CODE_OUTPUT_SCHEMA }
  });
  // Sampling params are removed on current Opus models and would return HTTP 400.
  assert.ok(!('temperature' in body));
  assert.ok(!('top_p' in body));
  assert.ok(!('top_k' in body));

  assert.equal(result.text, '```ts\nimport { test } from "fixtures/test";\n```');
  assert.equal(result.brain.kind, 'anthropic');
  assert.equal(result.usage.schemaVersion, GENERATION_USAGE_SCHEMA);
  assert.equal(result.usage.provider, 'anthropic');
  assert.equal(result.usage.model, 'claude-opus-4-8');
  assert.equal(result.usage.requestId, 'req_anthropic_123');
  assert.equal(result.usage.responseId, 'msg_test_123');
  assert.equal(result.usage.inputTokens, 11);
  assert.equal(result.usage.uncachedInputTokens, 11);
  assert.equal(result.usage.outputTokens, 22);
  assert.equal(result.usage.totalTokens, 33);
  assert.equal(result.usage.cachedTokens, 0);
  assert.equal(result.usage.cacheWriteTokens, 0);
  assert.equal(result.usage.reasoningTokens, 0);
  assert.equal(result.usage.retryCount, 0);
  assert.equal(result.usage.retryTokens, 0);
  assert.equal(result.usage.requestCount, 1);
  assert.equal(result.usage.resultCacheHit, false);
  assert.equal(result.usage.promptChars, 'TASK CONTENT'.length);
  assert.equal(typeof result.usage.latencyMs, 'number');
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
  assert.equal(result.text, '```ts\nimport { test } from "fixtures/test";\n```');
  assert.equal(result.usage.retryCount, 1);
  assert.equal(result.usage.retryTokens, null);
  assert.equal(result.usage.requestCount, 2);
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

test('runBrain openai pins snapshot model, structured output, cache key, and usage', async () => {
  const { calls, fetchImpl } = recordingFetch([
    fakeResponse({ body: openaiBody(), headers: { 'x-request-id': 'req_openai_123' } })
  ]);

  const result = await runBrain('TASK CONTENT', {
    env: { OPENAI_API_KEY: 'sk-openai-test', AI_PROMPT_CACHE: 'true' },
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
    { role: 'system', content: STRUCTURED_REST_OUTPUT_CONTRACT },
    { role: 'user', content: 'TASK CONTENT' }
  ]);
  assert.match(body.messages[0].content, /Policy playwright-generation-policy\/v3/);
  assert.deepEqual(body.response_format, {
    type: 'json_schema',
    json_schema: {
      name: 'playwright_test_file',
      strict: true,
      schema: CODE_OUTPUT_SCHEMA
    }
  });
  assert.match(body.prompt_cache_key, /^playwright-test-generation-v3:[a-f0-9]{24}$/);

  assert.equal(result.text, '```ts\nconst a = 1;\n```');
  assert.equal(result.usage.schemaVersion, GENERATION_USAGE_SCHEMA);
  assert.equal(result.usage.provider, 'openai');
  assert.equal(result.usage.model, 'gpt-4o-2024-11-20');
  assert.equal(result.usage.requestId, 'req_openai_123');
  assert.equal(result.usage.responseId, 'chatcmpl_test_123');
  assert.equal(result.usage.inputTokens, 7);
  assert.equal(result.usage.uncachedInputTokens, 7);
  assert.equal(result.usage.outputTokens, 9);
  assert.equal(result.usage.totalTokens, 16);
});

test('flow-spec drafts use semantic named fields and deterministically project one data-case collection', () => {
  const draft = semanticFlowDraft({
    dataCases: [{
      caseId: 'DC-042',
      inputs: [{ name: 'quantity', value: '2|3' }],
      expected: [{ name: 'message', value: 'Saved\nwith confirmation' }],
      notes: 'Canonical projection'
    }]
  });
  const rendered = renderFlowSpecDraft(draft);

  assert.deepEqual(FLOW_SPEC_DRAFT_SCHEMA.required, [
    'flowTitle', 'metadataRows', 'userStory', 'preconditions', 'outOfScope',
    'stabilityRows', 'variants', 'includes', 'businessRules', 'dataCases',
    'testData', 'mocks', 'flowSteps', 'negativeCases', 'acceptanceCriteria', 'notes'
  ]);
  assert.equal('sections' in FLOW_SPEC_DRAFT_SCHEMA.properties, false);
  assert.match(rendered, /^## Metadata$/m);
  assert.match(rendered, /^## Stability Requirements$/m);
  assert.match(rendered, /^## Variants$/m);
  assert.match(rendered, /^## Business Rules$/m);
  assert.match(rendered, /^## Data Cases$/m);
  assert.match(rendered, /^## Data Cases as JSON$/m);
  assert.match(rendered, /^## Test Data$/m);
  assert.match(rendered, /^## Mocks$/m);
  assert.match(rendered, /^## Flow Steps$/m);
  assert.match(rendered, /^## Negative Cases$/m);
  assert.match(rendered, /^## Acceptance Criteria$/m);
  assert.match(rendered, /\| DC-042 \| \{&quot;quantity&quot;:&quot;2\\\|3&quot;\} \| \{&quot;message&quot;:&quot;Saved\\nwith confirmation&quot;\} \| Canonical projection \|/);
  assert.match(rendered, /```json\n\[\n  \{\n    "caseId": "DC-042",\n    "expected": \{\n      "message": "Saved\\nwith confirmation"\n    \},\n    "inputs": \{\n      "quantity": "2\|3"/);
  assert.match(rendered, /"quantity": "2\|3"/, 'machine JSON retains the raw semantic value');
  assert.equal((rendered.match(/DC-042/g) ?? []).length, 2, 'the one semantic case is projected only to the table and JSON');
  assert.ok(rendered.indexOf('## Metadata') < rendered.indexOf('## Stability Requirements'));
  assert.ok(rendered.indexOf('## Data Cases') < rendered.indexOf('## Data Cases as JSON'));
});

test('runBrain openai uses the semantic flow-spec contract without Playwright or TypeScript instructions', async () => {
  const draft = semanticFlowDraft();
  const { calls, fetchImpl } = recordingFetch([
    fakeResponse({ body: openaiBody({ text: JSON.stringify(draft) }) })
  ]);

  const result = await runBrain('rough manual QA notes', {
    env: { OPENAI_API_KEY: 'sk-openai-test' },
    ...noBinaries,
    fetchImpl,
    outputKind: 'flow-spec-draft',
    systemPrompt: 'Convert the notes into a strict flow spec.'
  });

  const body = JSON.parse(calls[0].init.body);
  assert.doesNotMatch(body.messages[0].content, /TypeScript|Playwright/i);
  assert.ok(body.response_format.json_schema.schema.properties.flowTitle);
  assert.equal(body.response_format.json_schema.name, 'flow_spec_draft');
  assert.match(result.text, /^# Flow: Checkout as a returning customer$/m);
  assert.match(result.text, /^\| Flow ID \| FLOW-CHECKOUT-1 \|$/m);
  assert.match(result.text, /^## Acceptance Criteria$/m);
  assert.match(result.text, /```json/);
  assert.equal(isTrustedFlowSpecResult(result), true);
  assert.doesNotMatch(JSON.stringify(result), /provenance/i);
});

test('unstructured REST flow drafts decode semantic JSON and reject provider Markdown', async () => {
  const draft = semanticFlowDraft();
  const { calls, fetchImpl } = recordingFetch([fakeResponse({ body: openaiBody({ text: JSON.stringify(draft) }) })]);
  const result = await runBrain('rough notes', {
    env: { OPENAI_API_KEY: 'sk-openai-test', AI_STRUCTURED_OUTPUT: 'false' },
    ...noBinaries, fetchImpl, outputKind: 'flow-spec-draft', systemPrompt: 'Fit the source.'
  });
  assert.equal(result.text, renderFlowSpecDraft(draft));
  assert.equal('response_format' in JSON.parse(calls[0].init.body), false);

  const markdown = recordingFetch([fakeResponse({ body: openaiBody({ text: '# Flow: Provider Markdown' }) })]);
  await assert.rejects(
    runBrain('rough notes', {
      env: { OPENAI_API_KEY: 'sk-openai-test', AI_STRUCTURED_OUTPUT: 'false' },
      ...noBinaries, fetchImpl: markdown.fetchImpl, outputKind: 'flow-spec-draft', systemPrompt: 'Fit the source.'
    }),
    /structured output was not valid JSON/i
  );
});

test('Claude and Codex CLI flow drafts decode semantic JSON through the shared renderer', async () => {
  const draft = semanticFlowDraft();
  const expected = renderFlowSpecDraft(draft);
  const claude = await runBrain('rough notes', {
    env: { AI_BRAIN: 'claude-cli', AI_RESULT_CACHE: 'false' }, hasBinary: () => true,
    spawnSyncImpl: () => ({ status: 0, stdout: JSON.stringify(draft), stderr: '' }),
    outputKind: 'flow-spec-draft', systemPrompt: 'Fit the source.'
  });
  assert.equal(claude.text, expected);
  assert.equal(isTrustedFlowSpecResult(claude), true);

  const codex = await runBrain('rough notes', {
    env: { AI_BRAIN: 'codex-cli', AI_RESULT_CACHE: 'false' }, hasBinary: () => true,
    spawnSyncImpl: () => ({
      status: 0,
      stdout: [
        JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(draft) } }),
        '{"type":"turn.completed"}'
      ].join('\n'),
      stderr: ''
    }),
    outputKind: 'flow-spec-draft', systemPrompt: 'Fit the source.'
  });
  assert.equal(codex.text, expected);
  assert.equal(isTrustedFlowSpecResult(codex), true);
});

test('runBrain never promotes a flow-spec draft into the exact-result cache before UI validation', async (context) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-result-cache-'));
  context.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const incompleteDraft = semanticFlowDraft({ flowTitle: 'Incomplete flow', metadataRows: [], dataCases: [] });
  const { calls, fetchImpl } = recordingFetch([
    fakeResponse({ body: openaiBody({ text: JSON.stringify(incompleteDraft) }) }),
    fakeResponse({ body: openaiBody({ text: JSON.stringify(incompleteDraft) }) })
  ]);
  const options = {
    env: { OPENAI_API_KEY: 'sk-openai-test' },
    ...noBinaries,
    fetchImpl,
    cacheDir,
    outputKind: 'flow-spec-draft',
    systemPrompt: 'Convert source notes into a strict flow spec.'
  };

  await runBrain('rough notes', options);
  await runBrain('rough notes', options);

  assert.equal(calls.length, 2);
});

test('runBrain sends REST providers only dynamic task context while CLI keeps the raw task', async () => {
  const task = `# Codex Generation Task: FLOW-1

## Target

- Target test file: tests/generated/flow.spec.ts

## Contract

Repeated static contract boilerplate that belongs in the system prompt.

## Exact Implementation Instructions

Run npm commands that a REST call cannot execute.

## Original Flow Spec

# Flow: Checkout

## Acceptance Criteria

- AC-1: checkout succeeds.
`;
  const { calls, fetchImpl } = recordingFetch([fakeResponse({ body: openaiBody() })]);

  const result = await runBrain(task, {
    env: { OPENAI_API_KEY: 'sk-openai-test' },
    ...noBinaries,
    fetchImpl
  });

  const sentPrompt = JSON.parse(calls[0].init.body).messages[1].content;
  assert.match(sentPrompt, /Target test file/);
  assert.match(sentPrompt, /AC-1: checkout succeeds/);
  assert.doesNotMatch(sentPrompt, /Repeated static contract boilerplate|Run npm commands/);
  assert.ok(result.usage.compactionSavedChars > 0);
  assert.equal(result.usage.promptChars, sentPrompt.length);
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

test('runBrain records OpenAI cached and reasoning token details without double counting', async () => {
  const { fetchImpl } = recordingFetch([fakeResponse({ body: openaiBody({
    usage: {
      prompt_tokens: 100,
      completion_tokens: 30,
      total_tokens: 130,
      prompt_tokens_details: { cached_tokens: 70, cache_write_tokens: 5 },
      completion_tokens_details: { reasoning_tokens: 12 }
    }
  }) })]);

  const result = await runBrain('task', {
    env: { OPENAI_API_KEY: 'sk-openai-test' },
    ...noBinaries,
    fetchImpl
  });

  assert.equal(result.usage.inputTokens, 100);
  assert.equal(result.usage.uncachedInputTokens, 25);
  assert.equal(result.usage.cachedTokens, 70);
  assert.equal(result.usage.cacheWriteTokens, 5);
  assert.equal(result.usage.reasoningTokens, 12);
  assert.equal(result.usage.outputTokens, 30);
  assert.equal(result.usage.totalTokens, 130);
});

test('runBrain records Anthropic cache-read and cache-write input as logical input tokens', async () => {
  const { fetchImpl } = recordingFetch([fakeResponse({ body: anthropicBody({
    usage: {
      input_tokens: 10,
      cache_read_input_tokens: 60,
      cache_creation_input_tokens: 20,
      output_tokens: 15
    }
  }) })]);

  const result = await runBrain('task', {
    env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
    ...noBinaries,
    fetchImpl
  });

  assert.equal(result.usage.inputTokens, 90);
  assert.equal(result.usage.uncachedInputTokens, 10);
  assert.equal(result.usage.cachedTokens, 60);
  assert.equal(result.usage.cacheWriteTokens, 20);
  assert.equal(result.usage.totalTokens, 105);
});

test('runBrain configures GPT-5.6 for low-token non-reasoning generation', async () => {
  const { calls, fetchImpl } = recordingFetch([fakeResponse({ body: openaiBody() })]);

  await runBrain('task', {
    env: { OPENAI_API_KEY: 'sk-openai-test', AI_OPENAI_MODEL: 'gpt-5.6-terra', AI_PROMPT_CACHE: 'true' },
    ...noBinaries,
    fetchImpl
  });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.max_completion_tokens, 16000);
  assert.equal(body.reasoning_effort, 'none');
  assert.equal(body.verbosity, 'low');
  assert.deepEqual(body.prompt_cache_options, { mode: 'explicit', ttl: '30m' });
  assert.match(body.prompt_cache_key, /^playwright-test-generation-v3:[a-f0-9]{24}$/);
  assert.deepEqual(body.messages[0], {
    role: 'system',
    content: [{
      type: 'text',
      text: STRUCTURED_REST_OUTPUT_CONTRACT,
      prompt_cache_breakpoint: { mode: 'explicit' }
    }]
  });
  assert.ok(!('max_tokens' in body));
  assert.ok(!('temperature' in body));
  assert.ok(!('seed' in body));
});

test('GPT-5.6 disables its billable implicit cache breakpoint when provider caching is off', async () => {
  const { calls, fetchImpl } = recordingFetch([fakeResponse({ body: openaiBody() })]);

  await runBrain('changing task', {
    env: { OPENAI_API_KEY: 'sk-openai-test', AI_OPENAI_MODEL: 'gpt-5.6-terra' },
    ...noBinaries,
    fetchImpl
  });

  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.prompt_cache_options, { mode: 'explicit' });
  assert.equal('prompt_cache_key' in body, false);
  assert.equal(typeof body.messages[0].content, 'string');
});

test('runBrain can disable structured output and provider prompt caching explicitly', async () => {
  const text = '```ts\nconst legacy = true;\n```';
  const { calls, fetchImpl } = recordingFetch([fakeResponse({ body: openaiBody({ text }) })]);

  const result = await runBrain('task', {
    env: {
      OPENAI_API_KEY: 'sk-openai-test',
      AI_STRUCTURED_OUTPUT: 'false',
      AI_PROMPT_CACHE: 'false'
    },
    ...noBinaries,
    fetchImpl
  });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.messages[0].content, REST_OUTPUT_CONTRACT);
  assert.ok(!('response_format' in body));
  assert.ok(!('prompt_cache_key' in body));
  assert.equal(result.text, text);
});

test('runBrain exact-result cache is reusable only after downstream acceptance', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-result-cache-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const { calls, fetchImpl } = recordingFetch([fakeResponse({ body: openaiBody() })]);
  const options = {
    env: { OPENAI_API_KEY: 'sk-openai-test' },
    ...noBinaries,
    fetchImpl,
    cacheDir,
    currentTargetSha256: null
  };

  const first = await runBrain('same task', options);
  assert.ok(first.cacheCandidate);
  await promoteGenerationCache(first.cacheCandidate, {
    qualityFingerprint: ACCEPTED_QUALITY_FINGERPRINT,
    outputSha256: 'b'.repeat(64)
  });
  const second = await runBrain('same task', options);

  assert.equal(calls.length, 1);
  assert.equal(first.usage.resultCacheHit, false);
  assert.equal(second.usage.resultCacheHit, true);
  assert.equal(second.usage.requestCount, 0);
  assert.equal(second.usage.totalTokens, 0);
  assert.equal(second.usage.savedTokens, 16);
  assert.equal(second.text, first.text);
});

test('runBrain treats omitted target state as unknown and cannot reuse an explicit missing-target entry', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-result-cache-unknown-target-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const { calls, fetchImpl } = recordingFetch([
    fakeResponse({ body: openaiBody({ text: JSON.stringify({ code: 'const missing = true;' }) }) }),
    fakeResponse({ body: openaiBody({ text: JSON.stringify({ code: 'const unknown = true;' }) }) })
  ]);
  const base = {
    env: { OPENAI_API_KEY: 'sk-openai-test' },
    ...noBinaries,
    fetchImpl,
    cacheDir
  };
  const missing = await runBrain('same state-sensitive task', { ...base, currentTargetSha256: null });
  await promoteGenerationCache(missing.cacheCandidate, {
    qualityFingerprint: ACCEPTED_QUALITY_FINGERPRINT,
    outputSha256: 'b'.repeat(64)
  });
  const unknown = await runBrain('same state-sensitive task', base);

  assert.equal(calls.length, 2);
  assert.equal(unknown.usage.resultCacheStatus, 'disabled');
  assert.equal(unknown.cacheCandidate, undefined);
  assert.match(unknown.text, /const unknown = true;/);
  assert.doesNotMatch(unknown.text, /const missing = true;/);
});

test('runBrain coalesces concurrent identical cache misses into one provider request', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-result-single-flight-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  let release;
  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    await new Promise((resolve) => {
      release = resolve;
    });
    return fakeResponse({ body: openaiBody() });
  };
  const options = {
    env: { OPENAI_API_KEY: 'sk-openai-test' },
    ...noBinaries,
    fetchImpl,
    cacheDir,
    currentTargetSha256: null
  };

  const first = runBrain('same concurrent task', options);
  const second = runBrain('same concurrent task', options);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(callCount, 1);
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(callCount, 1);
  assert.equal(firstResult.text, secondResult.text);
  assert.equal(firstResult.cacheCandidate.key, secondResult.cacheCandidate.key);
});

test('runBrain never joins flights across distinct result-cache directories', async (t) => {
  const firstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-flight-one-'));
  const secondDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-flight-two-'));
  t.after(() => fs.rmSync(firstDir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(secondDir, { recursive: true, force: true }));
  const releases = [];
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    await new Promise((resolve) => releases.push(resolve));
    return fakeResponse({ body: openaiBody() });
  };
  const options = { env: { OPENAI_API_KEY: 'sk-openai-test' }, ...noBinaries, fetchImpl, currentTargetSha256: null };
  const first = runBrain('same task, isolated caches', { ...options, cacheDir: firstDir });
  const second = runBrain('same task, isolated caches', { ...options, cacheDir: secondDir });
  while (releases.length < 2) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  releases.forEach((release) => release());
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.cacheCandidate.cacheDir, path.resolve(firstDir));
  assert.equal(secondResult.cacheCandidate.cacheDir, path.resolve(secondDir));
  await promoteGenerationCache(firstResult.cacheCandidate, { qualityFingerprint: ACCEPTED_QUALITY_FINGERPRINT, outputSha256: 'b'.repeat(64) });
  assert.equal(fs.existsSync(path.join(secondDir, `${secondResult.cacheCandidate.key}.json`)), false);
});

test('runBrain enforces an explicit prompt character budget before calling a provider', async () => {
  const { calls, fetchImpl } = recordingFetch([]);

  await assert.rejects(
    runBrain('too large', {
      env: { OPENAI_API_KEY: 'sk-openai-test', AI_MAX_PROMPT_CHARS: '10' },
      ...noBinaries,
      fetchImpl
    }),
    /above the effective AI_MAX_PROMPT_CHARS=10/
  );
  assert.equal(calls.length, 0);
});

test('runBrain enforces a conservative default prompt budget before REST dispatch', async () => {
  const { calls, fetchImpl } = recordingFetch([]);

  await assert.rejects(
    runBrain('x'.repeat(200_001), {
      env: { OPENAI_API_KEY: 'sk-openai-test' },
      ...noBinaries,
      fetchImpl
    }),
    /above the effective AI_MAX_PROMPT_CHARS=200000/
  );
  assert.equal(calls.length, 0);
});

test('runBrain applies stage-specific prompt budgets before REST dispatch', async () => {
  const { calls, fetchImpl } = recordingFetch([]);

  await assert.rejects(
    runBrain('fit this flow', {
      env: {
        OPENAI_API_KEY: 'sk-openai-test',
        AI_MAX_PROMPT_CHARS: '200000',
        AI_SPEC_FIT_MAX_PROMPT_CHARS: '12'
      },
      stage: 'spec-fit',
      outputKind: 'flow-spec-draft',
      ...noBinaries,
      fetchImpl
    }),
    /above the effective AI_MAX_PROMPT_CHARS=12/
  );
  assert.equal(calls.length, 0);
});

test('runBrain rejects malformed or excessive prompt budget settings', async () => {
  for (const value of ['10junk', '0', '2000001']) {
    await assert.rejects(
      runBrain('task', {
        env: { OPENAI_API_KEY: 'sk-openai-test', AI_MAX_PROMPT_CHARS: value },
        ...noBinaries,
        fetchImpl: async () => {
          assert.fail('provider must not be called for an invalid prompt budget');
        }
      }),
      /AI_MAX_PROMPT_CHARS must be a whole number between 1 and 2000000/
    );
  }
});

// --- runBrain: CLI brains --------------------------------------------------

test('decodeCodexJsonlOutput accepts the final assistant message and normalizes usage', () => {
  const output = decodeCodexJsonlOutput([
    '{"type":"thread.started","thread_id":"thread_test"}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"code\\":\\"const generated = true;\\"}"}}',
    '{"type":"turn.completed","usage":{"input_tokens":20,"cached_input_tokens":5,"output_tokens":7,"reasoning_output_tokens":2}}'
  ].join('\n'), 'playwright-typescript');

  assert.deepEqual(output, {
    text: '```ts\nconst generated = true;\n```',
    usage: {
      inputTokens: 20,
      uncachedInputTokens: 15,
      outputTokens: 7,
      cachedTokens: 5,
      cacheWriteTokens: 0,
      reasoningTokens: 2,
      totalTokens: 27
    }
  });
});

test('decodeCodexJsonlOutput ignores non-contract progress messages before the final payload', () => {
  const output = decodeCodexJsonlOutput([
    '{"type":"item.completed","item":{"type":"agent_message","text":"Working on the requested test."}}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"code\\":\\"const generated = true;\\"}"}}',
    '{"type":"turn.completed"}'
  ].join('\n'), 'playwright-typescript');

  assert.deepEqual(output, {
    text: '```ts\nconst generated = true;\n```',
    usage: null
  });
});

test('decodeCodexJsonlOutput selects the last schema-valid assistant payload before turn completion', () => {
  const output = decodeCodexJsonlOutput([
    '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"code\\":\\"const progress = true;\\"}"}}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"code\\":\\"const final = true;\\"}"}}',
    '{"type":"turn.completed"}'
  ].join('\n'), 'playwright-typescript');

  assert.deepEqual(output, {
    text: '```ts\nconst final = true;\n```',
    usage: null
  });
});

test('decodeCodexJsonlOutput rejects a missing or ambiguous completion boundary', () => {
  assert.throws(
    () => decodeCodexJsonlOutput(
      '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"code\\":\\"const generated = true;\\"}"}}',
      'playwright-typescript'
    ),
    /turn\.completed/
  );
  assert.throws(
    () => decodeCodexJsonlOutput([
      '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"code\\":\\"const generated = true;\\"}"}}',
      '{"type":"turn.completed"}',
      '{"type":"turn.completed"}'
    ].join('\n'), 'playwright-typescript'),
    /multiple turn\.completed/
  );
});

test('decodeCodexJsonlOutput rejects assistant payloads after turn completion', () => {
  assert.throws(
    () => decodeCodexJsonlOutput([
      '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"code\\":\\"const before = true;\\"}"}}',
      '{"type":"turn.completed"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"code\\":\\"const after = true;\\"}"}}'
    ].join('\n'), 'playwright-typescript'),
    /assistant message after turn completion/
  );
});

test('decodeCodexJsonlOutput rejects completion without a pre-completion assistant contract', () => {
  assert.throws(
    () => decodeCodexJsonlOutput([
      '{"type":"item.completed","item":{"type":"agent_message","text":"Still working."}}',
      '{"type":"turn.completed"}'
    ].join('\n'), 'playwright-typescript'),
    /schema-valid assistant message before turn completion/
  );
});

test('decodeCodexJsonlOutput rejects malformed JSONL and missing pre-completion assistant messages', () => {
  assert.throws(
    () => decodeCodexJsonlOutput('{"type":"turn.started"}\nnot-json', 'playwright-typescript'),
    /Codex CLI JSONL line 2 is not valid JSON/
  );
  assert.throws(
    () => decodeCodexJsonlOutput('{"type":"turn.completed"}', 'playwright-typescript'),
    /schema-valid assistant message before turn completion/
  );
});

test('decodeCodexJsonlOutput preserves null usage when Codex omits it', () => {
  const output = decodeCodexJsonlOutput(
    [
      '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"code\\":\\"const noUsage = true;\\"}"}}',
      '{"type":"turn.completed"}'
    ].join('\n'),
    'playwright-typescript'
  );

  assert.deepEqual(output, {
    text: '```ts\nconst noUsage = true;\n```',
    usage: null
  });
});

test('runBrain gives Codex CLI accepted-result cache and explicit model parity', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cli-result-cache-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const calls = [];
  let version = 'codex-cli 1.2.3';
  const spawnSyncImpl = (binary, args, options) => {
    const actualArgs = providerArgs({ binary, args }, 'codex');
    if (!actualArgs.includes('exec')) {
      return { status: 0, stdout: version, stderr: '' };
    }
    const schemaPath = actualArgs[actualArgs.indexOf('--output-schema') + 1];
    calls.push({ providerArgs: actualArgs, schema: JSON.parse(fs.readFileSync(schemaPath, 'utf8')), options });
    return {
      status: 0,
      stdout: [
        '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"code\\":\\"const cached = true;\\"}"}}',
        '{"type":"turn.completed","usage":{"input_tokens":8,"output_tokens":4}}'
      ].join('\n'),
      stderr: ''
    };
  };
  const baseOptions = {
    env: { AI_BRAIN: 'codex-cli', AI_CODEX_CLI_MODEL: 'codex-test-model' },
    hasBinary: () => true,
    spawnSyncImpl,
    cacheDir,
    currentTargetSha256: null
  };

  const first = await runBrain('same Codex task', baseOptions);
  await promoteGenerationCache(first.cacheCandidate, { qualityFingerprint: ACCEPTED_QUALITY_FINGERPRINT, outputSha256: 'b'.repeat(64) });
  const sameModel = await runBrain('same Codex task', baseOptions);
  const changedModel = await runBrain('same Codex task', {
    ...baseOptions,
    env: { ...baseOptions.env, AI_CODEX_CLI_MODEL: 'codex-other-model' }
  });
  version = 'codex-cli 1.2.4';
  const changedVersion = await runBrain('same Codex task', baseOptions);

  assert.equal(calls.length, 3, 'the accepted same-model entry must avoid a second Codex transport');
  assert.deepEqual(calls[0].schema, CODE_OUTPUT_SCHEMA);
  assert.ok(calls[0].providerArgs.includes('--json'));
  assert.deepEqual(
    calls[0].providerArgs.slice(calls[0].providerArgs.indexOf('--model'), calls[0].providerArgs.indexOf('--model') + 2),
    ['--model', 'codex-test-model']
  );
  assert.equal(first.usage.resultCacheHit, false);
  assert.equal(first.usage.model, 'codex-test-model');
  assert.equal(sameModel.usage.resultCacheHit, true);
  assert.equal(sameModel.usage.model, 'codex-test-model');
  assert.equal(sameModel.text, first.text);
  assert.equal(changedModel.usage.resultCacheHit, false);
  assert.notEqual(changedModel.cacheCandidate.key, first.cacheCandidate.key);
  assert.equal(changedVersion.brain.model, 'codex-test-model');
  assert.equal(changedVersion.usage.resultCacheHit, false);
  assert.notEqual(changedVersion.cacheCandidate.key, first.cacheCandidate.key);
});

test('runBrain explains how to recover from a Codex version-probe failure', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-version-failure-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  await assert.rejects(runBrain('task', {
    env: { AI_BRAIN: 'codex-cli', AI_CODEX_CLI_MODEL: 'codex-test-model' }, hasBinary: () => true, cacheDir,
    currentTargetSha256: null,
    spawnSyncImpl: () => ({ status: 1, stdout: '', stderr: 'broken' })
  }), /Verify the configured Codex binary supports `codex --version`, or set AI_RESULT_CACHE=false/);
});

test('runBrain invalidates a default Codex cache entry when its CLI version changes', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cli-version-cache-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  let version = 'codex-cli 1.2.3';
  let providerCalls = 0;
  let versionCalls = 0;
  const probes = [];
  const spawnSyncImpl = (binary, args, options) => {
    if (!args.includes('exec')) {
      versionCalls += 1;
      probes.push({ binary, args, options, cwdExistedDuringSpawn: fs.existsSync(options.cwd) });
      return { status: 0, stdout: version, stderr: '' };
    }
    providerCalls += 1;
    return {
      status: 0,
      stdout: [
        '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"code\\":\\"const versioned = true;\\"}"}}',
        '{"type":"turn.completed"}'
      ].join('\n'),
      stderr: ''
    };
  };
  const options = {
    env: { AI_BRAIN: 'codex-cli' },
    hasBinary: () => true,
    spawnSyncImpl,
    cacheDir,
    currentTargetSha256: null
  };

  const first = await runBrain('same default Codex task', options);
  await promoteGenerationCache(first.cacheCandidate, { qualityFingerprint: ACCEPTED_QUALITY_FINGERPRINT, outputSha256: 'b'.repeat(64) });
  const sameVersion = await runBrain('same default Codex task', options);
  version = 'codex-cli 1.2.4';
  const changedVersion = await runBrain('same default Codex task', options);

  assert.equal(providerCalls, 2, 'only the changed CLI version may dispatch another provider transport');
  assert.equal(versionCalls, 3, 'each cache lookup verifies the installed default identity');
  assert.equal(probes[0].cwdExistedDuringSpawn, true);
  assert.match(path.basename(probes[0].options.cwd), /^ai-cli-version-/);
  assert.equal(fs.existsSync(probes[0].options.cwd), false);
  assert.equal(probes[0].options.env.HOME, undefined);
  assert.equal(probes[0].options.env.CODEX_HOME, undefined);
  assert.equal(probes[0].options.env.OPENAI_API_KEY, undefined);
  assert.equal(probes[0].options.env.HTTPS_PROXY, undefined);
  assert.equal(first.brain.model, 'codex-cli-default');
  assert.equal(sameVersion.usage.resultCacheHit, true);
  assert.equal(changedVersion.brain.model, 'codex-cli-default');
  assert.notEqual(changedVersion.cacheCandidate.key, first.cacheCandidate.key);
});

test('runBrain disables exact caching for Claude until it has a versioned identity', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-cli-no-cache-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  let calls = 0;
  const options = {
    env: { AI_BRAIN: 'claude-cli' }, hasBinary: () => true, cacheDir,
    spawnSyncImpl: () => { calls += 1; return { status: 0, stdout: 'raw Claude output', stderr: '' }; }
  };
  const first = await runBrain('same Claude task', options);
  const second = await runBrain('same Claude task', options);
  assert.equal(calls, 2);
  assert.equal(first.cacheCandidate, undefined);
  assert.equal(second.cacheCandidate, undefined);
});

test('runBrain records malformed Codex JSONL once with the resolved model', async () => {
  const attempts = [];
  await assert.rejects(runBrain('task', {
    env: { AI_BRAIN: 'codex-cli', AI_CODEX_CLI_MODEL: 'codex-test-model' }, hasBinary: () => true,
    spawnSyncImpl: () => ({ status: 0, stdout: 'not-json', stderr: '' }),
    onAttempt: (attempt) => attempts.push(attempt)
  }), /not valid JSON/);
  assert.deepEqual(attempts.map(({ status, failureReason, model }) => ({ status, failureReason, model })), [{
    status: 'malformed', failureReason: 'malformed-output', model: 'codex-test-model'
  }]);
});

test('runBrain uses exact CLI bytes for wrapped budgets and preserves Codex totals and latency', async () => {
  let tick = 0;
  const now = () => (tick += 17);
  const systemPrompt = 'SYSTEM';
  const task = 'TASK';
  const result = await runBrain(task, {
    env: { AI_BRAIN: 'codex-cli', AI_CODEX_CLI_MODEL: 'codex-test', AI_MAX_PROMPT_CHARS: '89' },
    hasBinary: () => true, systemPrompt, now,
    spawnSyncImpl: () => ({ status: 0, stdout: [
      '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"code\\":\\"const measured = true;\\"}"}}',
      '{"type":"turn.completed","usage":{"input_tokens":2,"output_tokens":3,"total_tokens":99}}'
    ].join('\n'), stderr: '' })
  });
  assert.equal(result.usage.systemPromptChars + result.usage.promptChars, 89);
  assert.equal(result.usage.latencyMs, 17);
  assert.equal(result.usage.totalTokens, 99);
});

test('runBrain enforces the default prompt budget before CLI dispatch', async () => {
  const calls = [];

  await assert.rejects(
    runBrain('x'.repeat(200_001), {
      env: { AI_BRAIN: 'claude-cli' },
      hasBinary: () => true,
      spawnSyncImpl: (...args) => calls.push(args)
    }),
    /above the effective AI_MAX_PROMPT_CHARS=200000/
  );
  assert.equal(calls.length, 0);
});

test('runBrain passes the raw task to CLI brains over stdin with timeout and SIGKILL', async () => {
  const calls = [];
  const attempts = [];
  const spawnSyncImpl = (binary, args, options) => {
    calls.push({ binary, args, options, cwdExistedDuringSpawn: fs.existsSync(options.cwd) });
    return { status: 0, stdout: 'cli output', stderr: '' };
  };

  const result = await runBrain('RAW TASK', {
    env: {
      AI_BRAIN: 'claude-cli',
      HOME: '/tmp/cli-home',
      PATH: '/usr/bin:/bin',
      CLAUDE_CONFIG_DIR: '/tmp/cli-home/.claude',
      ANTHROPIC_API_KEY: 'claude-secret',
      OPENAI_API_KEY: 'unrelated-provider-secret',
      E2E_USER_PASSWORD: 'test-secret',
      PWD: repoRoot
    },
    hasBinary: () => true,
    spawnSyncImpl,
    onAttempt: (attempt) => attempts.push(attempt)
  });

  assert.equal(calls.length, 1);
  // No REST envelope: the CLI agent receives the task verbatim, but never in process argv.
  assert.deepEqual(providerArgs(calls[0], 'claude'), [
    '-p',
    '--safe-mode',
    '--tools',
    '',
    '--strict-mcp-config',
    '--permission-mode',
    'plan',
    '--no-session-persistence',
    '--no-chrome'
  ]);
  assert.equal(calls[0].options.input, 'RAW TASK');
  assert.doesNotMatch(calls[0].args.join(' '), /RAW TASK/);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.timeout, 120000);
  assert.equal(calls[0].options.killSignal, 'SIGKILL');
  assert.equal(calls[0].cwdExistedDuringSpawn, true);
  assert.match(path.basename(calls[0].options.cwd), /^ai-cli-provider-/);
  assert.equal(fs.existsSync(calls[0].options.cwd), false, 'isolated CLI workspace must be removed after exit');
  assert.equal(calls[0].options.env.HOME, '/tmp/cli-home');
  assert.equal(calls[0].options.env.CLAUDE_CONFIG_DIR, '/tmp/cli-home/.claude');
  assert.equal(calls[0].options.env.ANTHROPIC_API_KEY, 'claude-secret');
  assert.equal(calls[0].options.env.OPENAI_API_KEY, undefined);
  assert.equal(calls[0].options.env.E2E_USER_PASSWORD, undefined);
  assert.equal(calls[0].options.env.AI_BRAIN, undefined);
  assert.equal(calls[0].options.env.PWD, undefined);
  assert.equal(result.text, 'cli output');
  assert.equal(result.brain.kind, 'claude-cli');
  assert.equal(result.usage.inputTokens, null);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].provider, 'claude-cli');
  assert.equal(attempts[0].status, 'succeeded');
  assert.equal(attempts[0].usage.inputTokens, null);
});

test('runBrain records failed CLI attempts with unknown token usage', async () => {
  const attempts = [];

  await assert.rejects(
    runBrain('task', {
      env: { AI_BRAIN: 'codex-cli' },
      hasBinary: () => true,
      spawnSyncImpl: () => ({ status: 1, stdout: '', stderr: 'failed' }),
      onAttempt: (attempt) => attempts.push(attempt)
    }),
    /codex CLI exited with status 1/
  );

  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].provider, 'codex-cli');
  assert.equal(attempts[0].status, 'failed');
  assert.equal(attempts[0].usage, null);
  assert.equal(attempts[0].failureReason, 'cli-failed');
});

test('runBrain includes a custom Playwright system contract for CLI repair stages', async () => {
  const calls = [];
  await runBrain('PREVIOUS TYPESCRIPT SOURCE', {
    env: { AI_BRAIN: 'codex-cli' },
    hasBinary: () => true,
    spawnSyncImpl: (binary, args, options) => {
      calls.push({ binary, args, options });
      return {
        status: 0,
        stdout: [
          '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"code\\":\\"const repaired = true;\\"}"}}',
          '{"type":"turn.completed"}'
        ].join('\n'),
        stderr: ''
      };
    },
    stage: 'repair',
    systemPrompt: 'REPAIR ONLY THE LISTED DIAGNOSTICS'
  });

  assert.match(calls[0].options.input, /REPAIR ONLY THE LISTED DIAGNOSTICS/);
  assert.match(calls[0].options.input, /PREVIOUS TYPESCRIPT SOURCE/);
  assert.match(calls[0].options.input, /TypeScript/i);
});

test('runBrain honors AI_BRAIN_TIMEOUT_MS for CLI brains', async () => {
  const calls = [];
  const spawnSyncImpl = (binary, args, options) => {
    calls.push({ binary, args, options });
    return {
      status: 0,
      stdout: [
        '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"code\\":\\"const timed = true;\\"}"}}',
        '{"type":"turn.completed"}'
      ].join('\n'),
      stderr: ''
    };
  };

  await runBrain('task', {
    env: { AI_BRAIN: 'codex', AI_BRAIN_TIMEOUT_MS: '5000' },
    hasBinary: () => true,
    spawnSyncImpl
  });

  const isolatedWorkspace = calls[0].options.cwd;
  const codexArgs = providerArgs(calls[0], 'codex');
  assert.deepEqual(codexArgs, [
    'exec',
    '--sandbox',
    'read-only',
    '--cd',
    isolatedWorkspace,
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
    path.join(isolatedWorkspace, 'output-schema.json'),
    '-'
  ]);
  assert.equal(calls[0].options.input, 'task');
  assert.equal(calls[0].options.timeout, 5000);
  assert.equal(fs.existsSync(isolatedWorkspace), false);
});

test('buildCliEnvironment exposes only common runtime settings and the selected provider auth', () => {
  const source = {
    PATH: '/usr/bin:/bin',
    HOME: '/tmp/home',
    LANG: 'en_US.UTF-8',
    HTTPS_PROXY: 'http://proxy.invalid',
    CODEX_HOME: '/tmp/home/.codex',
    CLAUDE_CONFIG_DIR: '/tmp/home/.claude',
    OPENAI_API_KEY: 'openai-secret',
    ANTHROPIC_API_KEY: 'anthropic-secret',
    CLAUDE_CODE_OAUTH_TOKEN: 'claude-oauth-secret',
    DATABASE_URL: 'database-secret',
    API_TOKEN: 'test-secret',
    E2E_USER_PASSWORD: 'password-secret',
    npm_config_user_agent: 'npm-secret-ish',
    PWD: repoRoot
  };

  assert.deepEqual(buildCliEnvironment('codex-cli', source), {
    PATH: '/usr/bin:/bin',
    HOME: '/tmp/home',
    LANG: 'en_US.UTF-8',
    HTTPS_PROXY: 'http://proxy.invalid',
    CODEX_HOME: '/tmp/home/.codex',
    OPENAI_API_KEY: 'openai-secret'
  });
  assert.deepEqual(buildCliEnvironment('claude-cli', source), {
    PATH: '/usr/bin:/bin',
    HOME: '/tmp/home',
    LANG: 'en_US.UTF-8',
    HTTPS_PROXY: 'http://proxy.invalid',
    CLAUDE_CONFIG_DIR: '/tmp/home/.claude',
    ANTHROPIC_API_KEY: 'anthropic-secret',
    CLAUDE_CODE_OAUTH_TOKEN: 'claude-oauth-secret'
  });
});

test('Darwin CLI containment blocks target and unrelated repository writes', {
  skip: process.platform !== 'darwin' || !fs.existsSync('/usr/bin/sandbox-exec')
}, async () => {
  await withTempDir('ai-cli-containment-', async (dir) => {
    const protectedRepo = path.join(dir, 'repo');
    const targetPath = path.join(protectedRepo, 'tests', 'generated.spec.ts');
    const unrelatedPath = path.join(protectedRepo, 'src', 'unrelated.ts');
    const fakeCliPath = path.join(dir, 'fake-claude');
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.mkdirSync(path.dirname(unrelatedPath), { recursive: true });
    fs.writeFileSync(targetPath, 'ORIGINAL TARGET\n');
    fs.writeFileSync(unrelatedPath, 'ORIGINAL UNRELATED\n');
    const shellQuote = (value) => `'${String(value).replaceAll("'", `'\"'\"'`)}'`;
    fs.writeFileSync(fakeCliPath, [
      '#!/bin/sh',
      `printf 'MUTATED TARGET\\n' > ${shellQuote(targetPath)}`,
      `printf 'MUTATED UNRELATED\\n' > ${shellQuote(unrelatedPath)}`,
      "printf '```ts\\nconst safe = true;\\n```\\n'",
      ''
    ].join('\n'));
    fs.chmodSync(fakeCliPath, 0o755);

    const before = {
      target: fs.readFileSync(targetPath, 'utf8'),
      unrelated: fs.readFileSync(unrelatedPath, 'utf8')
    };
    const result = await runBrain('return stdout only', {
      env: {
        AI_BRAIN: 'claude-cli',
        AI_BRAIN_CLAUDE_PATH: fakeCliPath,
        PATH: '/usr/bin:/bin',
        HOME: path.join(dir, 'home')
      },
      hasBinary: () => true,
      cliProtectedRoot: protectedRepo
    });

    assert.equal(result.text, '```ts\nconst safe = true;\n```\n');
    assert.equal(fs.readFileSync(targetPath, 'utf8'), before.target);
    assert.equal(fs.readFileSync(unrelatedPath, 'utf8'), before.unrelated);
  });
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
      usage: {
        schemaVersion: 'generation-usage/v1',
        provider: 'anthropic',
        requestId: null,
        responseId: null,
        serviceTier: null,
        inputTokens: 12,
        uncachedInputTokens: null,
        outputTokens: 34,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: null,
        retryCount: 0,
        retryTokens: null,
        requestCount: null,
        successfulRequests: null,
        latencyMs: null,
        resultCacheHit: false,
        savedTokens: 0,
        sourceTotalTokens: null,
        originalPromptChars: null,
        promptChars: null,
        systemPromptChars: null,
        compactedPromptChars: null,
        compactionSavedChars: null
      }
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

test('recordStandaloneGenerationManifest stores prompt-free telemetry with private permissions', () => {
  withTempDir('ai-generate-standalone-', (dir) => {
    const manifestPath = recordStandaloneGenerationManifest({
      promptPath: '/sensitive/path/private-flow.md',
      outPath: 'tests/generated/private-flow.spec.ts',
      brain: { kind: 'openai', model: 'gpt-test' },
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
      telemetryRoot: dir,
      now: () => new Date('2026-08-01T12:00:00.000Z'),
      id: () => 'fixed-id'
    });

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.schemaVersion, 'standalone-generation/v1');
    assert.equal(manifest.promptFile, 'private-flow.md');
    assert.equal(manifest.generation.usage.totalTokens, 20);
    assert.doesNotMatch(fs.readFileSync(manifestPath, 'utf8'), /sensitive\/path/);
    assert.equal(fs.statSync(path.dirname(manifestPath)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(manifestPath).mode & 0o777, 0o600);
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

test('ai-doctor reports each canonical stage route and the setting sources without secrets', () => {
  withTempDir('ai-doctor-stage-routes-', (dir) => {
    const dotEnvPath = path.join(dir, '.env');
    fs.writeFileSync(dotEnvPath, [
      'ANTHROPIC_API_KEY=sk-ant-stage-secret',
      'OPENAI_API_KEY=sk-openai-stage-secret',
      'AI_BRAIN=openai',
      'AI_OPENAI_MODEL=gpt-global',
      'AI_SPEC_FIT_BRAIN=anthropic',
      'AI_SPEC_FIT_ANTHROPIC_MODEL=claude-fit',
      'AI_REPAIR_BRAIN=auto',
      ''
    ].join('\n'));

    const result = spawnSync(process.execPath, [doctorPath], {
      encoding: 'utf8',
      timeout: 30000,
      env: { PATH: '', AI_DOTENV_PATH: dotEnvPath }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /spec-fit: anthropic \/ claude-fit \(brain: AI_SPEC_FIT_BRAIN from \.env; model: AI_SPEC_FIT_ANTHROPIC_MODEL from \.env\)/
    );
    for (const stage of ['test-generation', 'recording-generation']) {
      assert.match(
        result.stdout,
        new RegExp(`${stage}: openai \\/ gpt-global \\(brain: AI_BRAIN from \\.env; model: AI_OPENAI_MODEL from \\.env\\)`)
      );
    }
    assert.match(
      result.stdout,
      /repair: anthropic \/ claude-opus-4-8 \(brain: ANTHROPIC_API_KEY from \.env \(auto\); model: built-in default\)/
    );
    assert.doesNotMatch(result.stdout + result.stderr, /sk-(?:ant|openai)-stage-secret/);
  });
});

test('ai-doctor help states provider prompt caching is opt-in', () => {
  const result = spawnSync(process.execPath, [doctorPath, '--help'], {
    encoding: 'utf8',
    timeout: 30000,
    env: { PATH: '', AI_DOTENV_PATH: path.join(os.tmpdir(), 'definitely-missing-dir', '.env') }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /AI_PROMPT_CACHE\s+provider prompt caching \(default false\)/);
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
// and Component Objects are enforced by this deterministic repository scan. It
// pins the exception-comment convention so a POM positional pick cannot land
// silently without a documented reason.
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
