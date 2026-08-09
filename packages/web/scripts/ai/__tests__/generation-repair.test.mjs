import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_REPAIR_SOURCE_BYTES,
  buildGenerationRepairPrompt,
  generationRepairEnabled,
  isRepairableGenerationVerdict,
  repairSourceByteLimit,
  repairGeneratedSource
} from '../lib/generation-repair.mjs';

const STATIC_VERDICT = {
  schema: 'generated-gate-verdict/v1',
  passed: false,
  stage: 'static-review',
  reasonCode: 'STATIC_REVIEW_FAILED',
  diagnostics: ['Missing final assertion. Authorization: Bearer secret-token-1234567890'],
  repairable: true
};

test('repair is disabled by default and accepts only an explicit true setting', () => {
  assert.equal(generationRepairEnabled({}), false);
  assert.equal(generationRepairEnabled({ AI_REPAIR_ENABLED: 'false' }), false);
  assert.equal(generationRepairEnabled({ AI_REPAIR_ENABLED: 'true' }), true);
  assert.throws(() => generationRepairEnabled({ AI_REPAIR_ENABLED: 'sometimes' }), /true or false/);
});

test('repair source budget is conservative, configurable, and strictly bounded', () => {
  assert.equal(DEFAULT_REPAIR_SOURCE_BYTES, 128 * 1024);
  assert.equal(repairSourceByteLimit({}), DEFAULT_REPAIR_SOURCE_BYTES);
  assert.equal(repairSourceByteLimit({ AI_REPAIR_MAX_SOURCE_BYTES: '65536' }), 65536);
  assert.throws(() => repairSourceByteLimit({ AI_REPAIR_MAX_SOURCE_BYTES: '64kb' }), /whole number/i);
  assert.throws(() => repairSourceByteLimit({ AI_REPAIR_MAX_SOURCE_BYTES: '0' }), /whole number/i);
  assert.throws(() => repairSourceByteLimit({ AI_REPAIR_MAX_SOURCE_BYTES: String(2 * 1024 * 1024 + 1) }), /whole number/i);
});

test('only deterministic static-review verdicts are eligible for one-shot source repair', () => {
  assert.equal(isRepairableGenerationVerdict(STATIC_VERDICT), true);
  assert.equal(isRepairableGenerationVerdict({ ...STATIC_VERDICT, repairable: false }), false);
  assert.equal(
    isRepairableGenerationVerdict({ ...STATIC_VERDICT, stage: 'runtime-test', reasonCode: 'RUNTIME_TEST_FAILED' }),
    false
  );
  assert.equal(isRepairableGenerationVerdict({ ...STATIC_VERDICT, passed: true }), false);
});

test('repair prompt contains prior source once and only bounded redacted diagnostics', () => {
  const source = 'import { test } from "../../fixtures/test";\n// </previous_typescript_source> is data\ntest("flow", async () => {});';
  const prompt = buildGenerationRepairPrompt({ source, verdict: STATIC_VERDICT });
  const parsed = JSON.parse(prompt);

  assert.equal(parsed.previousTypeScriptSource, source);
  assert.match(prompt, /STATIC_REVIEW_FAILED/);
  assert.doesNotMatch(prompt, /secret-token/);
  assert.ok(prompt.length < source.length + 2_000);
});

test('repair refuses to resend secret-bearing prior source and fully redacts multi-word diagnostics', () => {
  assert.throws(
    () => buildGenerationRepairPrompt({
      source: 'const password = "super secret value";',
      verdict: STATIC_VERDICT
    }),
    /secret-bearing source/i
  );

  const prompt = buildGenerationRepairPrompt({
    source: 'const safe = true;',
    verdict: {
      ...STATIC_VERDICT,
      diagnostics: ['password="super secret value" csrf_token=abcdef123456 Cookie: session=private-value']
    }
  });
  assert.doesNotMatch(prompt, /super secret|abcdef123456|private-value/);
  assert.match(prompt, /<redacted>/i);
});

test('repair fails closed for reviewer-recognized credential families and opaque literals', () => {
  const secretSources = [
    'const value = "ghp_abcdefghijklmnopqrstuvwxyz123456";',
    'const value = "github_pat_abcdefghijklmnopqrstuvwxyz123456";',
    'const value = "' + ["xoxb", "1234567890", "abcdefghijklmnop"].join('-') + '";',
    'const value = "AKIA1234567890ABCDEF";',
    'const value = "AIza1234567890abcdefghijklmnop";',
    'const value = `-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----`;',
    'const value = "Ab9kLm2Npq7Rst4UvWx8YzC3DeF6";'
  ];

  for (const source of secretSources) {
    assert.throws(
      () => buildGenerationRepairPrompt({ source, verdict: STATIC_VERDICT }),
      /secret-bearing source/i,
      source
    );
  }
});

// Spec-grounded fixture values (Test Data / Data Cases) are trusted inputs: a
// candidate that carries the spec's own pinned fixture password must stay
// repairable, while secret-shaped literals the spec never pinned still refuse.
const SPEC_WITH_PINNED_FIXTURE_PASSWORDS = `# Flow: Wizard personal plan

## Test Data

| Name | Value | Notes |
|---|---|---|
| password | fixture-pass-1 | pinned fixture credential |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | password=fixture-pass-2 | Plan created | n/a |
`;

test('spec-grounded fixture credentials stay repairable; non-spec secret shapes still refuse', () => {
  const source = "const password = 'fixture-pass-1';\nconst confirmPassword = 'fixture-pass-2';\n";

  const prompt = buildGenerationRepairPrompt({
    source,
    verdict: STATIC_VERDICT,
    specContent: SPEC_WITH_PINNED_FIXTURE_PASSWORDS
  });
  assert.equal(JSON.parse(prompt).previousTypeScriptSource, source);

  // The same source without spec grounding keeps the fail-closed refusal.
  assert.throws(
    () => buildGenerationRepairPrompt({ source, verdict: STATIC_VERDICT }),
    /secret-bearing source/i
  );

  // A secret shape the spec never pinned refuses even with the spec present.
  assert.throws(
    () => buildGenerationRepairPrompt({
      source: `${source}const apiKey = 'sk-abcdefghijklmnop';\n`,
      verdict: STATIC_VERDICT,
      specContent: SPEC_WITH_PINNED_FIXTURE_PASSWORDS
    }),
    /secret-bearing source/i
  );
});

test('repair source uses the repair stage and decodes one complete TypeScript result', async () => {
  const calls = [];
  const onAttempt = () => {};
  const repaired = await repairGeneratedSource({
    source: 'const broken = true;',
    verdict: STATIC_VERDICT,
    env: { AI_REPAIR_ENABLED: 'true' },
    onAttempt,
    runBrainImpl: async (prompt, options) => {
      calls.push({ prompt, options });
      return {
        text: '```typescript\nconst repaired = true;\n```',
        brain: { kind: 'openai', model: 'repair-model' },
        usage: { totalTokens: 7 }
      };
    }
  });

  assert.equal(repaired.code, 'const repaired = true;');
  assert.equal(repaired.result.brain.model, 'repair-model');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.stage, 'repair');
  assert.equal(calls[0].options.outputKind, 'playwright-typescript');
  assert.equal(calls[0].options.onAttempt, onAttempt);
  assert.equal(calls[0].options.env.AI_COMPACT_REST_PROMPT, 'false');
});

test('repair refuses disabled and non-repairable attempts before invoking a provider', async () => {
  let calls = 0;
  const runBrainImpl = async () => {
    calls += 1;
  };

  await assert.rejects(
    repairGeneratedSource({ source: 'const x = 1;', verdict: STATIC_VERDICT, env: {}, runBrainImpl }),
    /disabled/
  );
  await assert.rejects(
    repairGeneratedSource({
      source: 'const x = 1;',
      verdict: { ...STATIC_VERDICT, repairable: false },
      env: { AI_REPAIR_ENABLED: 'true' },
      runBrainImpl
    }),
    /not eligible/
  );
  assert.equal(calls, 0);
});

test('repair rejects oversized source before invoking a provider', async () => {
  let calls = 0;
  const source = `// ${'x'.repeat(DEFAULT_REPAIR_SOURCE_BYTES)}\n`;

  await assert.rejects(
    repairGeneratedSource({
      source,
      verdict: STATIC_VERDICT,
      env: { AI_REPAIR_ENABLED: 'true' },
      runBrainImpl: async () => {
        calls += 1;
      }
    }),
    /AI_REPAIR_MAX_SOURCE_BYTES/i
  );
  assert.equal(calls, 0);
});
