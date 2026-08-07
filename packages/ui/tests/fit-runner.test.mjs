import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runFitGeneration } from '../scripts/lib/fit-generation-run.mjs';
import { runBrain } from '../../web/scripts/ai/lib/ai-client.mjs';

const validFitDraft = fs.readFileSync(
  new URL('../../web/specs/media-plan-save-via-nectar-ai.md', import.meta.url),
  'utf8'
);

function temporaryTelemetryRoot(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fit-generation-run-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function readJsonLines(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function emptySemanticFitDraft() {
  return {
    flowTitle: '', metadataRows: [], userStory: { asA: '', iWantTo: '', soThat: '' },
    preconditions: [], outOfScope: [], stabilityRows: [], variants: { columns: [], rows: [] },
    includes: [], businessRules: [], dataCases: [], testData: [], mocks: [], flowSteps: [],
    negativeCases: [], acceptanceCriteria: [], notes: []
  };
}

function productionFlowRunner(draft = emptySemanticFitDraft()) {
  return (prompt, options) => runBrain(prompt, {
    ...options,
    env: { OPENAI_API_KEY: 'sk-test', AI_RESULT_CACHE: 'false' },
    hasBinary: () => false,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(draft) } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      })
    })
  });
}

test('fit generation records a private spec-fit lifecycle and returns its run id', async (t) => {
  const telemetryRoot = temporaryTelemetryRoot(t);
  const controller = new AbortController();
  const result = await runFitGeneration({
    request: {
      prompt: 'PRIVATE SOURCE AND TEMPLATE',
      systemPrompt: 'Private fit instructions'
    },
    processEnv: {},
    telemetryRoot,
    runId: 'fit-success-1',
    signal: controller.signal,
    resolveEnvImpl: () => ({ env: { AI_BRAIN: 'openai' } }),
    runBrainImpl: async (prompt, options) => {
      assert.equal(prompt, 'PRIVATE SOURCE AND TEMPLATE');
      assert.equal(options.systemPrompt, 'Private fit instructions');
      assert.equal(options.outputKind, 'flow-spec-draft');
      assert.equal(options.stage, 'spec-fit');
      assert.equal(options.signal, controller.signal);
      options.onAttempt({
        provider: 'openai',
        model: 'gpt-fit',
        stage: 'spec-fit',
        attempt: 1,
        status: 'succeeded',
        durationMs: 25,
        usage: {
          inputTokens: 12,
          uncachedInputTokens: 12,
          outputTokens: 7,
          cachedTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          totalTokens: 19
        }
      });
      return {
        text: JSON.stringify(emptySemanticFitDraft()),
        brain: { kind: 'openai', model: 'gpt-fit' },
        usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 }
      };
    }
  });

  assert.match(result.text, /^# Flow: NEEDS_REVIEW$/m);
  assert.equal(result.brain.kind, 'openai');
  assert.equal(result.runId, 'fit-success-1');

  const runDirectory = path.join(telemetryRoot, 'fit-success-1');
  const manifest = JSON.parse(fs.readFileSync(path.join(runDirectory, 'manifest.json'), 'utf8'));
  const events = readJsonLines(path.join(runDirectory, 'events.jsonl'));
  assert.equal(manifest.stage, 'spec-fit');
  assert.equal(manifest.status, 'succeeded');
  assert.equal(manifest.attempts, 1);
  assert.equal(manifest.quality.reviewPassed, null);
  assert.equal(manifest.quality.fastGatePassed, null);
  assert.equal(manifest.quality.fullGatePassed, null);
  assert.equal(manifest.quality.repairCount, 0);
  assert.match(manifest.quality.qualityFingerprint, /^[a-f0-9]{64}$/);
  assert.ok(events.some((event) => event.type === 'provider-attempt' && event.stage === 'spec-fit'));
  assert.equal(fs.statSync(runDirectory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(runDirectory, 'manifest.json')).mode & 0o777, 0o600);

  const persisted = fs.readFileSync(path.join(runDirectory, 'manifest.json'), 'utf8') +
    fs.readFileSync(path.join(runDirectory, 'events.jsonl'), 'utf8');
  assert.doesNotMatch(persisted, /PRIVATE SOURCE AND TEMPLATE|Private fit instructions|Media Plan Save Via Nectar AI/);
});

test('fit generation records deterministic draft-validation failure after a paid response', async (t) => {
  const telemetryRoot = temporaryTelemetryRoot(t);
  const unusableOutput = '# Flow: PRIVATE unusable output\n';

  await assert.rejects(
    runFitGeneration({
      request: { prompt: 'prompt', systemPrompt: 'instructions' },
      processEnv: {},
      telemetryRoot,
      runId: 'fit-invalid-draft',
      resolveEnvImpl: () => ({ env: {} }),
      runBrainImpl: async (_prompt, options) => {
        options.onAttempt({
          provider: 'openai',
          model: 'gpt-fit',
          stage: 'spec-fit',
          attempt: 1,
          status: 'succeeded',
          usage: {
            inputTokens: 10,
            uncachedInputTokens: 10,
            outputTokens: 3,
            totalTokens: 13
          }
        });
        return {
          text: unusableOutput,
          brain: { kind: 'openai', model: 'gpt-fit' },
          usage: { inputTokens: 10, uncachedInputTokens: 10, outputTokens: 3, totalTokens: 13 }
        };
      }
    }),
    /semantic JSON or Markdown rendered by the trusted flow-spec formatter/i
  );

  const runDirectory = path.join(telemetryRoot, 'fit-invalid-draft');
  const manifest = JSON.parse(fs.readFileSync(path.join(runDirectory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.failureStage, 'spec-fit');
  assert.equal(manifest.failureReason, 'invalid-fit-output');
  assert.equal(manifest.attempts, 1);
  assert.equal(manifest.quality.qualityFingerprint, null);
  const persisted = fs.readFileSync(path.join(runDirectory, 'manifest.json'), 'utf8') +
    fs.readFileSync(path.join(runDirectory, 'events.jsonl'), 'utf8');
  assert.doesNotMatch(persisted, /PRIVATE unusable output/);
});

test('fit generation finalizes failures without persisting provider error details', async (t) => {
  const telemetryRoot = temporaryTelemetryRoot(t);

  await assert.rejects(
    runFitGeneration({
      request: { prompt: 'PRIVATE FAILED PROMPT', systemPrompt: 'Private instructions' },
      processEnv: {},
      telemetryRoot,
      runId: 'fit-failure-1',
      resolveEnvImpl: () => ({ env: {} }),
      runBrainImpl: async (_prompt, options) => {
        options.onAttempt({
          provider: 'openai',
          model: 'gpt-fit',
          stage: 'spec-fit',
          attempt: 1,
          status: 'malformed',
          usage: null,
          failureStage: 'provider',
          failureReason: 'malformed-output'
        });
        throw Object.assign(new Error('PRIVATE malformed provider body'), {
          failureReason: 'malformed-output'
        });
      }
    }),
    /PRIVATE malformed provider body/
  );

  const runDirectory = path.join(telemetryRoot, 'fit-failure-1');
  const manifest = JSON.parse(fs.readFileSync(path.join(runDirectory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.stage, 'spec-fit');
  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.failureStage, 'spec-fit');
  assert.equal(manifest.failureReason, 'malformed-output');
  assert.equal(manifest.failedAttempts, 1);
  assert.equal(manifest.quality.qualityFingerprint, null);
  assert.equal(manifest.quality.repairCount, 0);

  const persisted = fs.readFileSync(path.join(runDirectory, 'manifest.json'), 'utf8') +
    fs.readFileSync(path.join(runDirectory, 'events.jsonl'), 'utf8');
  assert.doesNotMatch(persisted, /PRIVATE FAILED PROMPT|Private instructions|PRIVATE malformed provider body/);
});

test('fit generation allowlists failure reasons before writing telemetry', async (t) => {
  const telemetryRoot = temporaryTelemetryRoot(t);

  await assert.rejects(
    runFitGeneration({
      request: { prompt: 'prompt', systemPrompt: 'instructions' },
      processEnv: {},
      telemetryRoot,
      runId: 'fit-sensitive-reason',
      resolveEnvImpl: () => ({ env: {} }),
      runBrainImpl: async () => {
        throw Object.assign(new Error('provider failed'), { failureReason: 'sk-private-secret-reason' });
      }
    }),
    /provider failed/
  );

  const manifestPath = path.join(telemetryRoot, 'fit-sensitive-reason', 'manifest.json');
  const persisted = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(persisted);
  assert.equal(manifest.failureReason, 'spec-fit-failed');
  assert.doesNotMatch(persisted, /sk-private-secret-reason/);
});

test('fit generation does not discard a valid paid result when post-response telemetry storage fails', async (t) => {
  const telemetryRoot = temporaryTelemetryRoot(t);
  const runDirectory = path.join(telemetryRoot, 'fit-telemetry-disk-failure');
  const warnings = [];

  const result = await runFitGeneration({
    request: { prompt: 'prompt', systemPrompt: 'instructions' },
    processEnv: {},
    telemetryRoot,
    runId: 'fit-telemetry-disk-failure',
    resolveEnvImpl: () => ({ env: {} }),
    onTelemetryError: (message) => warnings.push(String(message)),
    runBrainImpl: async () => {
      fs.rmSync(runDirectory, { recursive: true, force: true });
      return {
        text: JSON.stringify(emptySemanticFitDraft()),
        brain: { kind: 'openai', model: 'gpt-fit' },
        usage: { inputTokens: 10, uncachedInputTokens: 10, outputTokens: 5, totalTokens: 15 }
      };
    }
  });

  assert.match(result.text, /^# Flow: NEEDS_REVIEW$/m);
  assert.equal(result.runId, 'fit-telemetry-disk-failure');
  assert.ok(warnings.some((warning) => /telemetry.*incomplete/i.test(warning)));
});

test('fit generation rejects an oversized request before starting a provider call', async (t) => {
  const telemetryRoot = temporaryTelemetryRoot(t);
  let providerCalls = 0;

  await assert.rejects(
    runFitGeneration({
      request: { prompt: 'x'.repeat(21), systemPrompt: '' },
      processEnv: {},
      telemetryRoot,
      runId: 'fit-prompt-cap',
      resolveEnvImpl: () => ({ env: { AI_SPEC_FIT_MAX_PROMPT_CHARS: '20' } }),
      runBrainImpl: async () => {
        providerCalls += 1;
        throw new Error('provider must not be called');
      }
    }),
    /above AI_SPEC_FIT_MAX_PROMPT_CHARS=20/i
  );

  assert.equal(providerCalls, 0);
  const manifest = JSON.parse(fs.readFileSync(path.join(telemetryRoot, 'fit-prompt-cap', 'manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.failureReason, 'prompt-too-large');
  assert.equal(manifest.attempts, 0);
});

test('fit generation counts the appended semantic contract before invoking a near-limit provider', async (t) => {
  const telemetryRoot = temporaryTelemetryRoot(t);
  let providerCalls = 0;

  await assert.rejects(
    runFitGeneration({
      request: { prompt: 'x', systemPrompt: 'y' }, processEnv: {}, telemetryRoot,
      runId: 'fit-contract-budget',
      resolveEnvImpl: () => ({ env: { AI_SPEC_FIT_MAX_PROMPT_CHARS: '2' } }),
      runBrainImpl: async () => {
        providerCalls += 1;
        return { text: JSON.stringify(emptySemanticFitDraft()), brain: { kind: 'openai', model: 'gpt-fit' }, usage: null };
      }
    }),
    /above AI_SPEC_FIT_MAX_PROMPT_CHARS=2/i
  );

  assert.equal(providerCalls, 0);
  const manifest = JSON.parse(fs.readFileSync(path.join(telemetryRoot, 'fit-contract-budget', 'manifest.json'), 'utf8'));
  assert.equal(manifest.failureReason, 'prompt-too-large');
  assert.equal(manifest.attempts, 0);
});

test('fit generation renders injected raw semantic JSON before validation and output', async (t) => {
  const telemetryRoot = temporaryTelemetryRoot(t);
  const result = await runFitGeneration({
    request: { prompt: 'prompt', systemPrompt: 'instructions' }, processEnv: {}, telemetryRoot,
    runId: 'fit-raw-semantic', resolveEnvImpl: () => ({ env: {} }),
    runBrainImpl: async () => ({ text: JSON.stringify(emptySemanticFitDraft()), brain: { kind: 'openai', model: 'gpt-fit' }, usage: null })
  });

  assert.match(result.text, /^# Flow: NEEDS_REVIEW$/m);
  assert.match(result.text, /## Data Cases as JSON[\s\S]*"caseId": "DC-001"/);
});

test('fit generation rejects lookalike provider Markdown and accepts actual runBrain output', async (t) => {
  const telemetryRoot = temporaryTelemetryRoot(t);
  await assert.rejects(
    runFitGeneration({
      request: { prompt: 'prompt', systemPrompt: 'instructions' }, processEnv: {}, telemetryRoot,
      runId: 'fit-untrusted-markdown', resolveEnvImpl: () => ({ env: {} }),
      runBrainImpl: async () => ({ text: validFitDraft, flowSpecProvenance: 'flow-spec-rendered/v1', brain: { kind: 'openai', model: 'gpt-fit' }, usage: null })
    }),
    /semantic JSON or Markdown rendered by the trusted flow-spec formatter/i
  );

  const accepted = await runFitGeneration({
    request: { prompt: 'prompt', systemPrompt: 'instructions' }, processEnv: {}, telemetryRoot,
    runId: 'fit-trusted-markdown', resolveEnvImpl: () => ({ env: {} }),
    runBrainImpl: productionFlowRunner()
  });
  assert.match(accepted.text, /^# Flow: NEEDS_REVIEW$/m);

  await assert.rejects(
    runFitGeneration({
      request: { prompt: 'prompt', systemPrompt: 'instructions' }, processEnv: {}, telemetryRoot,
      runId: 'fit-mutated-trusted-markdown', resolveEnvImpl: () => ({ env: {} }),
      runBrainImpl: async (prompt, options) => {
        const trusted = await productionFlowRunner()(prompt, options);
        trusted.text += '\n<!-- mutated -->';
        return trusted;
      }
    }),
    /semantic JSON or Markdown rendered by the trusted flow-spec formatter/i
  );
});

test('fit generation forwards cancellation and records a bounded cancelled failure', async (t) => {
  const telemetryRoot = temporaryTelemetryRoot(t);
  const controller = new AbortController();

  await assert.rejects(
    runFitGeneration({
      request: { prompt: 'prompt', systemPrompt: 'instructions' },
      processEnv: {},
      telemetryRoot,
      runId: 'fit-cancelled',
      signal: controller.signal,
      resolveEnvImpl: () => ({ env: {} }),
      runBrainImpl: async (_prompt, options) => {
        assert.equal(options.signal, controller.signal);
        controller.abort();
        throw Object.assign(new Error('private cancellation detail'), { name: 'AbortError' });
      }
    }),
    /private cancellation detail/
  );

  const manifest = JSON.parse(fs.readFileSync(path.join(telemetryRoot, 'fit-cancelled', 'manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.failureReason, 'cancelled');
  assert.equal(manifest.attempts, 1);
  assert.doesNotMatch(fs.readFileSync(path.join(telemetryRoot, 'fit-cancelled', 'events.jsonl'), 'utf8'), /private cancellation detail/);
});
