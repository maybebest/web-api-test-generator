import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildGateEnvironment,
  createCandidatePath,
  readGeneratedGateVerdict,
  reconcileGeneratedGateResult,
  runVerifiedGeneration as runVerifiedGenerationImpl
} from '../verified-generate.mjs';
import * as verifiedGenerate from '../verified-generate.mjs';
import {
  PROMOTION_GATE_POLICY,
  PROMOTION_GATE_REPEAT_EACH
} from '../lib/generated-gate-policy.mjs';
import { acceptedGenerationQualityFingerprint } from '../lib/generation-quality.mjs';
import { knownSecretEnvValues } from '../lib/gate-environment.mjs';
import { specSha256 } from '../lib/spec-parser.mjs';

async function runVerifiedGeneration(options) {
  return runVerifiedGenerationImpl({
    browserExecutableExists: () => true,
    ...options,
    env: {
      PLAYWRIGHT_TEST_BASE_URL: 'https://qa.example.test',
      // Hermetic default: the environment preflight spawns a config-load child
      // and probes the external origin, so tests opt in explicitly instead.
      AI_ENV_PREFLIGHT: 'false',
      ...(options.env ?? {})
    }
  });
}

function fixture() {
  const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verified-generate-'));
  const target = path.join(webRoot, 'tests', 'regression', 'checkout.spec.ts');
  const specPath = path.join(webRoot, 'specs', 'checkout.md');
  const sourceSpec = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../../../specs/special-preconditions/media-planner-minimum-campaign-duration.md'
  );
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.writeFileSync(target, 'const oldTarget = true;\n');
  fs.writeFileSync(
    specPath,
    fs.readFileSync(sourceSpec, 'utf8')
      .replace('| Auth | required |', '| Auth | none |')
      .replace(
        '| Target Test File | tests/regression/media-planner-minimum-campaign-duration.authenticated.spec.ts |',
        '| Target Test File | tests/regression/checkout.spec.ts |'
      )
  );
  return { webRoot, target, specPath };
}

function taskFixture() {
  const base = fixture();
  const sourceSpec = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../../../specs/special-preconditions/media-planner-minimum-campaign-duration.md'
  );
  const specPath = path.join(base.webRoot, 'specs', 'checkout.md');
  const taskDir = path.join(base.webRoot, '.ai-runs', 'task-run');
  const taskPath = path.join(taskDir, 'generation-task.md');
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.mkdirSync(taskDir, { recursive: true });
  fs.copyFileSync(sourceSpec, specPath);
  fs.writeFileSync(taskPath, '# generated task\n');
  fs.writeFileSync(path.join(taskDir, 'manifest.json'), `${JSON.stringify({
    specPath: 'specs/checkout.md',
    targetTestFile: 'tests/regression/checkout.spec.ts',
    specSha256: specSha256(specPath),
    generationMode: 'single'
  })}\n`);
  return { ...base, specPath, taskPath, manifestPath: path.join(taskDir, 'manifest.json') };
}

test('verified generation formats one exact bounded safe run-id success line', () => {
  assert.equal(verifiedGenerate.formatGenerationRunIdLine('accepted-run-123'), 'Generation run ID: accepted-run-123');
  assert.throws(() => verifiedGenerate.formatGenerationRunIdLine('../escape'), /run id/i);
  assert.throws(() => verifiedGenerate.formatGenerationRunIdLine('x'.repeat(65)), /run id/i);
});

test('verified generation gates a sibling candidate twice and promotes it atomically after acceptance', async () => {
  const { webRoot, target } = fixture();
  const calls = [];

  const result = await runVerifiedGeneration({
    specPath: 'specs/checkout.md',
    out: 'tests/regression/checkout.spec.ts',
    webRoot,
    candidateId: () => 'accepted-run',
    generate: async (options) => {
      calls.push(['generate', options]);
      assert.equal(options.promptTarget, 'tests/regression/checkout.spec.ts');
      assert.match(options.outPath, /\.checkout\.accepted-run\.candidate\.spec\.ts$/);
      return {
        code: 'const acceptedCandidate = true;\n',
        promptPath: options.specPath,
        result: {
          brain: { kind: 'openai', model: 'gpt-test' },
          usage: { totalTokens: 25 },
          cacheCandidate: { key: 'a'.repeat(64) }
        }
      };
    },
    gate: async (options) => {
      calls.push(['gate', options]);
      assert.equal(options.repeatEach, PROMOTION_GATE_REPEAT_EACH);
      assert.equal(fs.readFileSync(options.testPath, 'utf8'), 'const acceptedCandidate = true;\n');
      return { passed: true, stage: 'accepted', reasonCode: 'PASSED' };
    },
    promoteCache: async (candidate, quality) => {
      assert.equal(
        fs.readFileSync(target, 'utf8'),
        'const acceptedCandidate = true;\n',
        'target rename must complete before accepted-cache promotion'
      );
      calls.push(['promote-cache', candidate, quality]);
    }
  });

  assert.equal(fs.readFileSync(target, 'utf8'), 'const acceptedCandidate = true;\n');
  assert.equal(fs.statSync(target).mode & 0o777, 0o644);
  assert.equal(fs.existsSync(result.candidatePath), false);
  assert.equal(result.outPath, target);
  assert.deepEqual(calls.map(([name]) => name), ['generate', 'gate', 'promote-cache']);
  assert.equal(calls[2][2].validationStatus, 'accepted');
  assert.match(calls[2][2].qualityFingerprint, /^[a-f0-9]{64}$/);
  const manifest = JSON.parse(fs.readFileSync(
    path.join(webRoot, '.ai-runs', 'generation', 'accepted-run', 'manifest.json'),
    'utf8'
  ));
  assert.equal(manifest.quality.fastGatePassed, true);
  assert.equal(manifest.quality.promotionGatePolicy, PROMOTION_GATE_POLICY);
  assert.equal(manifest.quality.promotionGateRepeatEach, PROMOTION_GATE_REPEAT_EACH);
  assert.equal(
    manifest.quality.qualityFingerprint,
    acceptedGenerationQualityFingerprint({
      sourceSha256: 'ad86eabb9792894bae435756cb6aea5eaa0e3c3fdab3a621df938fda77df0c10',
      repairCount: 0
    })
  );
});

// Iteration-3 salvage gap: a review-clean candidate cascade-rejected by an
// unrelated global-static failure was preserved under .ai-runs/rejected but
// had no path back through the gate except a full paid regeneration
// (18,864 tokens for the feed candidate). --replay-rejected feeds the
// preserved bytes through the same review + fast-gate + promotion path with
// zero provider calls.
test('replay-rejected gates and promotes the archived candidate with zero provider calls', async () => {
  const { webRoot, target } = fixture();
  const archived = 'const replayedCandidate = true;\n';
  const sourceRunId = 'rejected-source-1';
  fs.mkdirSync(path.join(webRoot, '.ai-runs', 'rejected', sourceRunId), { recursive: true });
  fs.writeFileSync(path.join(webRoot, '.ai-runs', 'rejected', sourceRunId, 'candidate.ts'), archived);
  const calls = [];

  const result = await runVerifiedGeneration({
    specPath: 'specs/checkout.md',
    out: 'tests/regression/checkout.spec.ts',
    webRoot,
    replayRejected: sourceRunId,
    candidateId: () => 'replay-run',
    generate: async () => {
      throw new Error('replay must never call the provider');
    },
    repair: async () => {
      throw new Error('replay must never repair');
    },
    gate: async (options) => {
      calls.push(['gate', fs.readFileSync(options.testPath, 'utf8')]);
      return { passed: true, stage: 'accepted', reasonCode: 'PASSED', staticReviewWarningCount: 2 };
    }
  });

  assert.equal(fs.readFileSync(target, 'utf8'), archived);
  assert.deepEqual(calls, [['gate', archived]]);
  assert.equal(result.runId, 'replay-run');
  assert.equal(result.cachePromotion.promoted, false);
  const runDir = path.join(webRoot, '.ai-runs', 'generation', 'replay-run');
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'succeeded');
  assert.equal(manifest.attempts, 0, 'a replay run must record zero provider attempts');
  assert.equal(manifest.quality.fastGatePassed, true);
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.ok(
    events.some((event) => event.stage === 'replay' && event.status === 'completed'),
    'telemetry must record a completed replay stage'
  );
  assert.equal(events.filter((event) => event.type === 'provider-attempt').length, 0);
});

test('replay-rejected fails closed when no preserved candidate exists', async () => {
  const { webRoot, target } = fixture();

  await assert.rejects(
    runVerifiedGeneration({
      specPath: 'specs/checkout.md',
      out: 'tests/regression/checkout.spec.ts',
      webRoot,
      replayRejected: 'missing-run',
      generate: async () => {
        throw new Error('replay must never call the provider');
      },
      gate: async () => {
        throw new Error('a missing replay source must never reach the gate');
      }
    }),
    /rejected candidate/i
  );

  assert.equal(fs.readFileSync(target, 'utf8'), 'const oldTarget = true;\n');
  const manifest = JSON.parse(fs.readFileSync(
    path.join(webRoot, '.ai-runs', 'generation', fs.readdirSync(path.join(webRoot, '.ai-runs', 'generation'))[0], 'manifest.json'),
    'utf8'
  ));
  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.failureStage, 'replay');
  assert.equal(manifest.attempts, 0);
});

test('a rejected replay is archived again and never repaired even with repair enabled', async () => {
  const { webRoot, target } = fixture();
  const archived = 'const rereviewedCandidate = true;\n';
  const sourceRunId = 'rejected-source-2';
  fs.mkdirSync(path.join(webRoot, '.ai-runs', 'rejected', sourceRunId), { recursive: true });
  fs.writeFileSync(path.join(webRoot, '.ai-runs', 'rejected', sourceRunId, 'candidate.ts'), archived);

  await assert.rejects(
    runVerifiedGeneration({
      specPath: 'specs/checkout.md',
      out: 'tests/regression/checkout.spec.ts',
      webRoot,
      env: { AI_REPAIR_ENABLED: 'true' },
      replayRejected: sourceRunId,
      candidateId: () => 'replay-run-fail',
      generate: async () => {
        throw new Error('replay must never call the provider');
      },
      repair: async () => {
        throw new Error('replay must never repair');
      },
      gate: async () => ({
        passed: false,
        stage: 'static-review',
        reasonCode: 'STATIC_REVIEW_FAILED',
        diagnostics: ['replayed candidate failed static review'],
        repairable: true
      })
    }),
    /Fast acceptance gate failed/
  );

  assert.equal(fs.readFileSync(target, 'utf8'), 'const oldTarget = true;\n');
  assert.equal(
    fs.readFileSync(path.join(webRoot, '.ai-runs', 'rejected', 'replay-run-fail', 'candidate.ts'), 'utf8'),
    archived
  );
  // The replay source archive is untouched.
  assert.equal(
    fs.readFileSync(path.join(webRoot, '.ai-runs', 'rejected', sourceRunId, 'candidate.ts'), 'utf8'),
    archived
  );
});

test('post-provider telemetry write failure never discards an accepted generated candidate', async () => {
  const { webRoot, target } = fixture();
  const runId = 'telemetry-write-fails';

  const result = await runVerifiedGeneration({
    specPath: 'specs/checkout.md',
    out: 'tests/regression/checkout.spec.ts',
    webRoot,
    candidateId: () => runId,
    generate: async () => {
      const eventsPath = path.join(webRoot, '.ai-runs', 'generation', runId, 'events.jsonl');
      fs.rmSync(eventsPath);
      fs.mkdirSync(eventsPath);
      return { code: 'const acceptedDespiteTelemetryFailure = true;\n', result: {} };
    },
    gate: async () => ({ passed: true, stage: 'accepted', reasonCode: 'PASSED' })
  });

  assert.equal(result.outPath, target);
  assert.equal(fs.readFileSync(target, 'utf8'), 'const acceptedDespiteTelemetryFailure = true;\n');
});

test('a rejected candidate is archived outside the test tree and never replaces the target', async () => {
  const { webRoot, target } = fixture();
  let rejected;
  let promoted = false;

  await assert.rejects(
    runVerifiedGeneration({
      specPath: 'specs/checkout.md',
      out: 'tests/regression/checkout.spec.ts',
      webRoot,
      candidateId: () => 'rejected-run',
      generate: async () => ({
        code: 'const rejectedCandidate = true;\n',
        promptPath: 'specs/checkout.md',
        result: {
          brain: { kind: 'openai', model: 'gpt-test' },
          usage: { totalTokens: 25 },
          cacheCandidate: { key: 'b'.repeat(64) }
        }
      }),
      gate: async ({ repeatEach }) => {
        assert.equal(repeatEach, PROMOTION_GATE_REPEAT_EACH);
        return {
          passed: false,
          stage: 'static-review',
          reasonCode: 'STATIC_REVIEW_FAILED',
          reason: 'locator policy failed'
        };
      },
      rejectCache: async (candidate, reason) => {
        rejected = { candidate, reason };
      },
      promoteCache: async () => { promoted = true; }
    }),
    (error) => {
      assert.match(error.message, /fast acceptance gate failed/i);
      assert.match(error.archivePath, /\.ai-runs\/rejected\/rejected-run\/candidate\.ts$/);
      assert.equal(fs.readFileSync(error.archivePath, 'utf8'), 'const rejectedCandidate = true;\n');
      return true;
    }
  );

  assert.equal(fs.readFileSync(target, 'utf8'), 'const oldTarget = true;\n');
  assert.equal(rejected.reason.validationStatus, 'rejected');
  assert.equal(rejected.reason.failureStage, 'static-review');
  assert.equal(promoted, false);
  const manifest = JSON.parse(fs.readFileSync(
    path.join(webRoot, '.ai-runs', 'generation', 'rejected-run', 'manifest.json'),
    'utf8'
  ));
  assert.equal(manifest.quality.promotionGatePolicy, PROMOTION_GATE_POLICY);
  assert.equal(manifest.quality.promotionGateRepeatEach, PROMOTION_GATE_REPEAT_EACH);
});

test('a fast-gate rejection invalidates the exact accepted cache hit', async () => {
  const { webRoot } = fixture();
  const cacheReference = { schemaVersion: 'generation-cache-reference/v1', key: 'c'.repeat(64), entryVersion: 'd'.repeat(64) };
  let invalidated;
  await assert.rejects(runVerifiedGeneration({
    specPath: 'specs/checkout.md', out: 'tests/regression/checkout.spec.ts', webRoot,
    candidateId: () => 'cached-rejection',
    generate: async () => ({ code: 'const cached = true;\n', result: { cacheReference } }),
    gate: async () => ({ passed: false, stage: 'static-review', reason: 'rejected' }),
    invalidateCache: async (reference) => { invalidated = reference; }
  }), /fast acceptance gate failed/i);
  assert.deepEqual(invalidated, cacheReference);
});

test('an accepted exact-cache hit is re-gated twice, promoted, and keeps its bound reference', async () => {
  const { webRoot, target } = fixture();
  const cacheReference = {
    schemaVersion: 'generation-cache-reference/v1',
    key: '1'.repeat(64),
    entryVersion: '2'.repeat(64)
  };
  let promoted = false;
  let invalidated = false;

  const result = await runVerifiedGeneration({
    specPath: 'specs/checkout.md',
    out: 'tests/regression/checkout.spec.ts',
    webRoot,
    candidateId: () => 'cached-acceptance',
    generate: async () => ({
      code: 'const acceptedCacheHit = true;\n',
      result: { cacheReference }
    }),
    gate: async ({ repeatEach, testPath }) => {
      assert.equal(repeatEach, 2);
      assert.equal(fs.readFileSync(testPath, 'utf8'), 'const acceptedCacheHit = true;\n');
      return { passed: true, stage: 'accepted', reasonCode: 'PASSED' };
    },
    promoteCache: async () => { promoted = true; },
    invalidateCache: async () => { invalidated = true; }
  });

  assert.equal(fs.readFileSync(target, 'utf8'), 'const acceptedCacheHit = true;\n');
  assert.equal(result.cachePromotion.promoted, false);
  assert.equal(result.cachePromotion.reason, 'no-cache-candidate');
  assert.equal(promoted, false);
  assert.equal(invalidated, false);
  const manifest = JSON.parse(fs.readFileSync(
    path.join(webRoot, '.ai-runs', 'generation', 'cached-acceptance', 'manifest.json'),
    'utf8'
  ));
  assert.deepEqual(manifest.cacheReference, cacheReference);
});

test('an explicitly enabled deterministic static failure gets exactly one bounded repair attempt', async () => {
  const { webRoot, target } = fixture();
  const dotEnvPath = path.join(webRoot, '.env.test');
  fs.writeFileSync(dotEnvPath, 'AI_REPAIR_ENABLED=true\n');
  const gates = [];
  const rejected = [];
  const promoted = [];
  let repairs = 0;

  const result = await runVerifiedGeneration({
    specPath: 'specs/checkout.md',
    out: 'tests/regression/checkout.spec.ts',
    webRoot,
    env: { AI_DOTENV_PATH: dotEnvPath },
    candidateId: () => 'repair-run',
    generate: async () => ({
      code: 'const firstCandidate = true;\n',
      result: { cacheCandidate: { key: '1'.repeat(64) } }
    }),
    gate: async ({ testPath, repeatEach }) => {
      assert.equal(repeatEach, PROMOTION_GATE_REPEAT_EACH);
      gates.push(fs.readFileSync(testPath, 'utf8'));
      if (gates.length === 1) {
        return {
          schema: 'generated-gate-verdict/v1',
          passed: false,
          stage: 'static-review',
          reasonCode: 'STATIC_REVIEW_FAILED',
          diagnostics: ['Missing final assertion.'],
          repairable: true
        };
      }
      return { schema: 'generated-gate-verdict/v1', passed: true, stage: 'accepted', reasonCode: 'PASSED', diagnostics: [], repairable: false };
    },
    repair: async ({ source, verdict }) => {
      repairs += 1;
      assert.equal(source, 'const firstCandidate = true;\n');
      assert.equal(verdict.reasonCode, 'STATIC_REVIEW_FAILED');
      return {
        code: 'const repairedCandidate = true;\n',
        result: { cacheCandidate: { key: '2'.repeat(64) } }
      };
    },
    rejectCache: async (candidate) => rejected.push(candidate.key),
    promoteCache: async (candidate) => promoted.push(candidate.key)
  });

  assert.equal(repairs, 1);
  assert.deepEqual(gates, ['const firstCandidate = true;\n', 'const repairedCandidate = true;\n']);
  assert.deepEqual(rejected, ['1'.repeat(64)]);
  assert.deepEqual(promoted, ['2'.repeat(64)]);
  assert.equal(result.repairCount, 1);
  assert.equal(fs.readFileSync(target, 'utf8'), 'const repairedCandidate = true;\n');
});

test('repair never retries a second failed candidate or a non-static failure', async () => {
  const { webRoot, target } = fixture();
  let repairs = 0;
  let gates = 0;
  let promoted = false;
  const rejected = [];

  await assert.rejects(
    runVerifiedGeneration({
      specPath: 'specs/checkout.md',
      out: 'tests/regression/checkout.spec.ts',
      webRoot,
      env: { AI_REPAIR_ENABLED: 'true' },
      candidateId: () => 'repair-fails',
      generate: async () => ({
        code: 'const candidate = true;\n',
        result: { cacheCandidate: { key: '3'.repeat(64) } }
      }),
      gate: async ({ repeatEach }) => {
        assert.equal(repeatEach, PROMOTION_GATE_REPEAT_EACH);
        gates += 1;
        return {
          schema: 'generated-gate-verdict/v1',
          passed: false,
          stage: 'static-review',
          reasonCode: 'STATIC_REVIEW_FAILED',
          diagnostics: ['Still invalid.'],
          repairable: true
        };
      },
      repair: async () => {
        repairs += 1;
        return {
          code: 'const stillInvalid = true;\n',
          result: { cacheCandidate: { key: '4'.repeat(64) } }
        };
      },
      rejectCache: async (candidate) => { rejected.push(candidate.key); },
      promoteCache: async () => { promoted = true; }
    }),
    /fast acceptance gate failed/i
  );

  assert.equal(repairs, 1);
  assert.equal(gates, 2);
  assert.deepEqual(rejected, ['3'.repeat(64), '4'.repeat(64)]);
  assert.equal(promoted, false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'const oldTarget = true;\n');
  const manifest = JSON.parse(fs.readFileSync(
    path.join(webRoot, '.ai-runs', 'generation', 'repair-fails', 'manifest.json'),
    'utf8'
  ));
  assert.equal(manifest.quality.promotionGatePolicy, PROMOTION_GATE_POLICY);
  assert.equal(manifest.quality.promotionGateRepeatEach, PROMOTION_GATE_REPEAT_EACH);
});

test('invalid repair configuration fails before generation and pre-provider repair failures do not invent paid attempts', async () => {
  for (const [setting, expected] of [
    [{ AI_REPAIR_ENABLED: 'sometimes' }, /true or false/],
    [{ AI_REPAIR_ENABLED: 'true', AI_REPAIR_MAX_SOURCE_BYTES: '128kb' }, /AI_REPAIR_MAX_SOURCE_BYTES/]
  ]) {
    const { webRoot } = fixture();
    let generated = false;
    await assert.rejects(
      runVerifiedGeneration({
        specPath: 'specs/checkout.md',
        out: 'tests/regression/checkout.spec.ts',
        webRoot,
        env: { ...setting, AI_DOTENV_PATH: path.join(webRoot, 'missing.env') },
        generate: async () => {
          generated = true;
        }
      }),
      expected
    );
    assert.equal(generated, false);
  }

  {
    const { webRoot } = fixture();
    await assert.rejects(
      runVerifiedGeneration({
        specPath: 'specs/checkout.md',
        out: 'tests/regression/checkout.spec.ts',
        webRoot,
        env: { AI_REPAIR_ENABLED: 'true', AI_DOTENV_PATH: path.join(webRoot, 'missing.env') },
        candidateId: () => 'repair-preflight-fails',
        generate: async () => ({ code: 'const candidate = true;\n', result: {} }),
        gate: async () => ({
          schema: 'generated-gate-verdict/v1',
          passed: false,
          stage: 'static-review',
          reasonCode: 'STATIC_REVIEW_FAILED',
          diagnostics: ['Static issue.'],
          repairable: true
        }),
        repair: async () => {
          throw new Error('repair source rejected before provider');
        }
      }),
      /rejected before provider/
    );
    const runDir = path.join(webRoot, '.ai-runs', 'generation', 'repair-preflight-fails');
    const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'));
    const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(manifest.quality.repairCount, 1);
    assert.equal(events.filter((event) => event.type === 'provider-attempt' && event.stage === 'repair').length, 0);
  }
});

test('authenticated generation records a rejected preflight and makes zero provider attempts when Chromium is unavailable', async () => {
  const { webRoot, specPath } = taskFixture();
  const authenticatedTarget = path.join(webRoot, 'tests', 'regression', 'checkout.authenticated.spec.ts');
  fs.writeFileSync(authenticatedTarget, 'const authenticatedTarget = true;\n');
  let generated = false;

  await assert.rejects(
    runVerifiedGeneration({
      specPath,
      out: 'tests/regression/checkout.authenticated.spec.ts',
      webRoot,
      env: {
        E2E_AUTH_ENABLED: 'true',
        E2E_USER_EMAIL: 'qa-user@example.test',
        E2E_USER_PASSWORD: 'not-a-secret-fixture',
        E2E_AUTH_SUCCESS_SELECTOR: '[data-testid="signed-in"]'
      },
      candidateId: () => 'missing-chromium',
      browserExecutableExists: () => false,
      generate: async () => {
        generated = true;
      }
    }),
    /Generation readiness failed: Chromium executable/i
  );

  assert.equal(generated, false);
  assert.equal(fs.readFileSync(authenticatedTarget, 'utf8'), 'const authenticatedTarget = true;\n');
  const runDir = path.join(webRoot, '.ai-runs', 'generation', 'missing-chromium');
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.some((event) => event.type === 'stage' && event.stage === 'preflight' && event.status === 'rejected'), true);
  assert.equal(events.filter((event) => event.type === 'provider-attempt').length, 0);
});

test('authenticated generation makes zero provider calls for unsafe external target configuration', async () => {
  const rejectedTargets = [
    ['http-url', 'http://qa.example.test', '', /requires HTTPS/],
    ['embedded-credentials', 'https://user:pass@qa.example.test', '', /requires HTTPS/],
    ['nonstandard-port', 'https://qa.example.test:8443', '', /requires HTTPS/],
    ['query', 'https://qa.example.test?token=value', '', /requires HTTPS/],
    ['fragment', 'https://qa.example.test/#fragment', '', /requires HTTPS/],
    ['production-host', 'https://www.example.com', '', /unclassified host/],
    ['malformed-allowlist', 'https://qa.example.test', '*.example.test', /hostnames only/]
  ];

  for (const [id, baseUrl, allowedHosts, expectedError] of rejectedTargets) {
    const { webRoot, specPath } = taskFixture();
    const target = path.join(webRoot, 'tests', 'regression', 'checkout.authenticated.spec.ts');
    fs.writeFileSync(target, 'const originalAuthenticatedTarget = true;\n');
    let generateCalls = 0;

    await assert.rejects(
      runVerifiedGeneration({
        specPath,
        out: 'tests/regression/checkout.authenticated.spec.ts',
        webRoot,
        env: {
          E2E_AUTH_ENABLED: 'true',
          E2E_AUTH_REUSE_STATE: 'false',
          PLAYWRIGHT_TEST_BASE_URL: baseUrl,
          E2E_AUTH_ALLOWED_HOSTS: allowedHosts,
          E2E_USER_EMAIL: 'qa-user@example.test',
          E2E_USER_PASSWORD: 'not-a-secret-fixture',
          E2E_AUTH_SUCCESS_SELECTOR: '[data-testid="signed-in"]'
        },
        candidateId: () => `unsafe-target-${id}`,
        generate: async () => {
          generateCalls += 1;
        }
      }),
      expectedError
    );

    assert.equal(generateCalls, 0, id);
    assert.equal(fs.readFileSync(target, 'utf8'), 'const originalAuthenticatedTarget = true;\n', id);
    const runDir = path.join(webRoot, '.ai-runs', 'generation', `unsafe-target-${id}`);
    const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(events.filter((event) => event.type === 'provider-attempt').length, 0, id);
  }
});

test('missing or malformed flow input rejects preflight before a provider can run', async () => {
  for (const [kind, prepare] of [
    ['missing', () => 'specs/missing.md'],
    ['malformed', (webRoot) => {
      const malformedPath = path.join(webRoot, 'specs', 'malformed.md');
      fs.mkdirSync(path.dirname(malformedPath), { recursive: true });
      fs.writeFileSync(malformedPath, '# Flow: malformed\n');
      return 'specs/malformed.md';
    }]
  ]) {
    const { webRoot, target } = fixture();
    let generated = false;
    const specPath = prepare(webRoot);

    await assert.rejects(
      runVerifiedGeneration({
        specPath,
        out: 'tests/regression/checkout.spec.ts',
        webRoot,
        candidateId: () => `invalid-flow-${kind}`,
        generate: async () => {
          generated = true;
        }
      }),
      /Generation readiness failed:/
    );

    assert.equal(generated, false);
    assert.equal(fs.readFileSync(target, 'utf8'), 'const oldTarget = true;\n');
    const runDir = path.join(webRoot, '.ai-runs', 'generation', `invalid-flow-${kind}`);
    const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(events.some((event) => event.type === 'stage' && event.stage === 'preflight' && event.status === 'rejected'), true);
    assert.equal(events.filter((event) => event.type === 'provider-attempt').length, 0);
  }
});

test('verified generation rejects symlink targets before invoking a model', async () => {
  const { webRoot, target } = fixture();
  const outside = path.join(webRoot, 'outside.spec.ts');
  fs.writeFileSync(outside, 'const outside = true;\n');
  fs.rmSync(target);
  fs.symlinkSync(outside, target);
  let generated = false;

  await assert.rejects(
    runVerifiedGeneration({
      specPath: 'specs/checkout.md',
      out: 'tests/regression/checkout.spec.ts',
      webRoot,
      generate: async () => {
        generated = true;
      }
    }),
    /symbolic link/
  );

  assert.equal(generated, false);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'const outside = true;\n');
});

test('task generation fails closed before a provider call when manifest target or source hash is stale', async () => {
  for (const mutation of ['target', 'hash']) {
    const { webRoot, taskPath, manifestPath } = taskFixture();
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (mutation === 'target') manifest.targetTestFile = 'tests/regression/a-different-test.spec.ts';
    else manifest.specSha256 = '0'.repeat(64);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    let generated = false;

    await assert.rejects(
      runVerifiedGeneration({
        taskPath,
        out: 'tests/regression/checkout.spec.ts',
        webRoot,
        generate: async () => {
          generated = true;
        }
      }),
      mutation === 'target' ? /target.*does not match/i : /hash.*does not match/i
    );
    assert.equal(generated, false);
  }
});

test('task generation rejects a regular task reached through an in-root ancestor symlink', async () => {
  const { webRoot } = taskFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-generation-task-'));
  const linkedTask = path.join(webRoot, '.ai-runs', 'escape', 'generation-task.md');
  fs.writeFileSync(path.join(outside, 'generation-task.md'), '# attacker controlled task\n');
  fs.writeFileSync(path.join(outside, 'manifest.json'), '{}\n');
  fs.symlinkSync(outside, path.join(webRoot, '.ai-runs', 'escape'), 'dir');
  let generated = false;

  await assert.rejects(
    runVerifiedGeneration({
      taskPath: linkedTask,
      out: 'tests/regression/checkout.spec.ts',
      webRoot,
      generate: async () => {
        generated = true;
      }
    }),
    /symbolic link|outside.*\.ai-runs|real task root/i
  );
  assert.equal(generated, false);
  fs.rmSync(outside, { recursive: true, force: true });
});

test('candidate naming preserves the authenticated project suffix', () => {
  assert.equal(
    createCandidatePath('/repo/tests/regression/checkout.authenticated.spec.ts', 'run-1'),
    '/repo/tests/regression/.checkout.run-1.candidate.authenticated.spec.ts'
  );
});

test('a concurrent target edit wins and the verified candidate is not promoted', async () => {
  const { webRoot, target } = fixture();

  await assert.rejects(
    runVerifiedGeneration({
      specPath: 'specs/checkout.md',
      out: 'tests/regression/checkout.spec.ts',
      webRoot,
      candidateId: () => 'target-conflict',
      generate: async () => ({ code: 'const candidate = true;\n', result: {} }),
      gate: async () => {
        fs.writeFileSync(target, 'const userEdit = true;\n');
        return { passed: true };
      }
    }),
    /target changed while generation was running/i
  );

  assert.equal(fs.readFileSync(target, 'utf8'), 'const userEdit = true;\n');
});

test('a gate may inspect but never mutate the candidate being promoted', async () => {
  const { webRoot, target } = fixture();

  await assert.rejects(
    runVerifiedGeneration({
      specPath: 'specs/checkout.md',
      out: 'tests/regression/checkout.spec.ts',
      webRoot,
      candidateId: () => 'candidate-mutated',
      generate: async () => ({ code: 'const candidate = true;\n', result: {} }),
      gate: async ({ testPath }) => {
        fs.appendFileSync(testPath, 'const gateMutation = true;\n');
        return { passed: true };
      }
    }),
    /candidate changed during verification/i
  );

  assert.equal(fs.readFileSync(target, 'utf8'), 'const oldTarget = true;\n');
});

test('a same-byte symbolic-link replacement is rejected without target or cache promotion', async () => {
  const { webRoot, target } = fixture();
  const outside = path.join(webRoot, 'outside-candidate.spec.ts');
  const source = 'const candidate = true;\n';
  fs.writeFileSync(outside, source, { mode: 0o640 });
  let promoted = false;
  let rejected = false;

  await assert.rejects(
    runVerifiedGeneration({
      specPath: 'specs/checkout.md',
      out: 'tests/regression/checkout.spec.ts',
      webRoot,
      candidateId: () => 'candidate-symlink-swap',
      generate: async () => ({
        code: source,
        result: { cacheCandidate: { key: '3'.repeat(64) } }
      }),
      gate: async ({ testPath }) => {
        fs.unlinkSync(testPath);
        fs.symlinkSync(outside, testPath);
        return { passed: true, stage: 'accepted', reasonCode: 'PASSED' };
      },
      rejectCache: async () => { rejected = true; },
      promoteCache: async () => { promoted = true; }
    }),
    /candidate changed during verification/i
  );

  assert.equal(fs.readFileSync(target, 'utf8'), 'const oldTarget = true;\n');
  assert.equal(fs.readFileSync(outside, 'utf8'), source);
  assert.equal(fs.statSync(outside).mode & 0o777, 0o640);
  assert.equal(rejected, true);
  assert.equal(promoted, false);
});

test('a same-byte regular-file inode swap is rejected without target or cache promotion', async () => {
  const { webRoot, target } = fixture();
  const source = 'const candidate = true;\n';
  let promoted = false;
  let rejected = false;

  await assert.rejects(
    runVerifiedGeneration({
      specPath: 'specs/checkout.md',
      out: 'tests/regression/checkout.spec.ts',
      webRoot,
      candidateId: () => 'candidate-inode-swap',
      generate: async () => ({
        code: source,
        result: { cacheCandidate: { key: '4'.repeat(64) } }
      }),
      gate: async ({ testPath }) => {
        const replacement = `${testPath}.replacement`;
        fs.writeFileSync(replacement, source, { flag: 'wx', mode: 0o600 });
        fs.renameSync(replacement, testPath);
        return { passed: true, stage: 'accepted', reasonCode: 'PASSED' };
      },
      rejectCache: async () => { rejected = true; },
      promoteCache: async () => { promoted = true; }
    }),
    /candidate changed during verification/i
  );

  assert.equal(fs.readFileSync(target, 'utf8'), 'const oldTarget = true;\n');
  assert.equal(rejected, true);
  assert.equal(promoted, false);
});

test('cache promotion failure does not turn an already promoted target into a false failure', async () => {
  const { webRoot, target } = fixture();

  const result = await runVerifiedGeneration({
    specPath: 'specs/checkout.md',
    out: 'tests/regression/checkout.spec.ts',
    webRoot,
    candidateId: () => 'cache-failed',
    generate: async () => ({
      code: 'const accepted = true;\n',
      result: { cacheCandidate: { key: 'd'.repeat(64) } }
    }),
    gate: async () => ({ passed: true }),
    promoteCache: async () => {
      throw new Error('disk full');
    }
  });

  assert.equal(fs.readFileSync(target, 'utf8'), 'const accepted = true;\n');
  assert.equal(result.cachePromotion.promoted, false);
});

test('cache-reference telemetry binding failure never turns an accepted target into a false failure', async () => {
  const { webRoot, target } = fixture();
  let invalidated;
  const result = await runVerifiedGeneration({
    specPath: 'specs/checkout.md', out: 'tests/regression/checkout.spec.ts', webRoot,
    candidateId: () => 'cache-bind-failed',
    generate: async () => ({ code: 'const accepted = true;\n', result: { cacheCandidate: { key: 'e'.repeat(64) } } }),
    gate: async () => ({ passed: true, stage: 'accepted', reasonCode: 'PASSED' }),
    promoteCache: async () => ({ schemaVersion: 'generation-cache-reference/v1', key: 'unsafe', entryVersion: 'f'.repeat(64) }),
    invalidateCache: async (reference) => { invalidated = reference; }
  });
  assert.equal(fs.readFileSync(target, 'utf8'), 'const accepted = true;\n');
  assert.equal(result.cachePromotion.promoted, true);
  assert.equal(invalidated.key, 'unsafe');
});

test('gate subprocess environment does not inherit provider credentials', () => {
  const environment = buildGateEnvironment({
    PATH: '/bin',
    E2E_AUTH_ENABLED: 'true',
    E2E_USER_EMAIL: 'qa-user@example.test',
    E2E_USER_PASSWORD: 'non-production-password',
    E2E_ADMIN_EMAIL: 'qa-admin@example.test',
    E2E_ADMIN_PASSWORD: 'non-production-admin-password',
    E2E_HTTP_BASIC_USERNAME: 'preview-user',
    E2E_HTTP_BASIC_PASSWORD: 'preview-password',
    E2E_LOGIN_PATH: '/sign-in',
    E2E_AUTH_SUCCESS_SELECTOR: '[data-testid="signed-in"]',
    ANTHROPIC_API_KEY: 'secret-a',
    OPENAI_API_KEY: 'secret-o',
    AI_REPAIR_TOKEN: 'secret-r',
    GITHUB_TOKEN: 'secret-github',
    AWS_SECRET_ACCESS_KEY: 'secret-aws',
    GOOGLE_API_KEY: 'secret-google',
    NPM_TOKEN: 'secret-npm',
    DATABASE_PASSWORD: 'secret-db',
    SESSION_COOKIE: 'secret-cookie',
    E2E_MP_TOKEN: 'secret-unlisted-e2e-token',
    RANDOM_BENIGN_SETTING: 'do-not-forward'
  });

  assert.equal(environment.PATH, '/bin');
  assert.equal(environment.E2E_AUTH_ENABLED, 'true');
  assert.equal(environment.E2E_USER_EMAIL, 'qa-user@example.test');
  assert.equal(environment.E2E_USER_PASSWORD, 'non-production-password');
  assert.equal(environment.E2E_ADMIN_EMAIL, 'qa-admin@example.test');
  assert.equal(environment.E2E_ADMIN_PASSWORD, 'non-production-admin-password');
  assert.equal(environment.E2E_HTTP_BASIC_USERNAME, 'preview-user');
  assert.equal(environment.E2E_HTTP_BASIC_PASSWORD, 'preview-password');
  assert.equal(environment.E2E_LOGIN_PATH, '/sign-in');
  assert.equal(environment.E2E_AUTH_SUCCESS_SELECTOR, '[data-testid="signed-in"]');
  assert.equal(environment.ANTHROPIC_API_KEY, '');
  assert.equal(environment.OPENAI_API_KEY, '');
  assert.equal(environment.AI_GATE_SANITIZED_ENV, 'true');
  for (const name of [
    'AI_REPAIR_TOKEN',
    'GITHUB_TOKEN',
    'AWS_SECRET_ACCESS_KEY',
    'GOOGLE_API_KEY',
    'NPM_TOKEN',
    'DATABASE_PASSWORD',
    'SESSION_COOKIE',
    'E2E_MP_TOKEN',
    'RANDOM_BENIGN_SETTING'
  ]) {
    assert.equal(environment[name], undefined, name);
  }
});

test('static and local gate profiles strip login and API credentials before module import', () => {
  const source = {
    PATH: '/bin',
    E2E_AUTH_ENABLED: 'true',
    E2E_USER_EMAIL: 'qa-user@example.test',
    E2E_USER_PASSWORD: 'non-production-password',
    API_AUTHORIZATION: 'Bearer api-secret',
    CHANNEL_BEARER_TOKEN: 'channel-secret',
    E2E_MP_ONSITE_CHANNEL: 'Onsite Display'
  };

  for (const profile of ['static', 'local-runtime']) {
    const environment = buildGateEnvironment(source, { profile });
    assert.equal(environment.PATH, '/bin');
    assert.equal(environment.E2E_MP_ONSITE_CHANNEL, 'Onsite Display');
    assert.equal(environment.E2E_USER_EMAIL, '');
    assert.equal(environment.E2E_USER_PASSWORD, '');
    assert.equal(environment.API_AUTHORIZATION, '');
    assert.equal(environment.CHANNEL_BEARER_TOKEN, '');
    assert.equal(environment.AI_GATE_SANITIZED_ENV, 'true');
  }
});

test('standard user email is secret while the Basic username is external-only runtime configuration', () => {
  const source = {
    PATH: '/bin',
    E2E_HTTP_BASIC_USERNAME: 'psychicbook',
    E2E_USER_EMAIL: 'returning-user@example.test'
  };

  const externalEnvironment = buildGateEnvironment(source, { profile: 'external-runtime' });
  assert.equal(externalEnvironment.E2E_HTTP_BASIC_USERNAME, 'psychicbook');
  assert.equal(externalEnvironment.E2E_USER_EMAIL, 'returning-user@example.test');
  assert.deepEqual(knownSecretEnvValues(source), ['returning-user@example.test']);

  for (const profile of ['static', 'local-runtime']) {
    const environment = buildGateEnvironment(source, { profile });
    assert.equal(environment.E2E_HTTP_BASIC_USERNAME, undefined);
    assert.equal(environment.E2E_USER_EMAIL, '');
  }
});

test('verified generation passes dotenv-auth configuration through the sanitized gate boundary', async () => {
  const { webRoot } = fixture();
  const dotEnvPath = path.join(webRoot, '.env.test');
  fs.writeFileSync(dotEnvPath, [
    'E2E_AUTH_ENABLED=true',
    'E2E_USER_EMAIL=dotenv-user@example.test',
    'E2E_USER_PASSWORD=dotenv-password',
    'OPENAI_API_KEY=provider-secret',
    'GITHUB_TOKEN=github-secret'
  ].join('\n'));
  let gateEnvironment;

  await runVerifiedGeneration({
    specPath: 'specs/checkout.md',
    out: 'tests/regression/checkout.spec.ts',
    webRoot,
    env: { AI_DOTENV_PATH: dotEnvPath },
    candidateId: () => 'dotenv-gate-env',
    generate: async () => ({ code: 'const accepted = true;\n', result: {} }),
    gate: async ({ env }) => {
      gateEnvironment = env;
      return { passed: true, stage: 'accepted', reasonCode: 'PASSED' };
    }
  });

  assert.equal(gateEnvironment.E2E_USER_EMAIL, 'dotenv-user@example.test');
  assert.equal(gateEnvironment.E2E_USER_PASSWORD, 'dotenv-password');
  assert.equal(gateEnvironment.OPENAI_API_KEY, '');
  assert.equal(gateEnvironment.GITHUB_TOKEN, undefined);
  assert.equal(gateEnvironment.AI_DOTENV_PATH, undefined);
});

test('a malformed or contradictory machine verdict can never override a failed gate process', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-verdict-'));
  const verdictPath = path.join(directory, 'verdict.json');
  fs.writeFileSync(verdictPath, '{not-json');
  assert.equal(readGeneratedGateVerdict(verdictPath), null);

  const reconciled = reconcileGeneratedGateResult(
    { status: 1, error: null },
    {
      schema: 'generated-gate-verdict/v1',
      passed: true,
      stage: 'accepted',
      reasonCode: 'PASSED',
      diagnostics: [],
      repairable: false
    }
  );
  assert.equal(reconciled.passed, false);
  assert.equal(reconciled.stage, 'runtime-environment');
  assert.equal(reconciled.repairable, false);
});

test('a failed environment preflight rejects the run with zero provider attempts and its own failure reason', async () => {
  const { webRoot, target } = fixture();
  let observed;
  let generated = false;

  await assert.rejects(
    runVerifiedGeneration({
      specPath: 'specs/checkout.md',
      out: 'tests/regression/checkout.spec.ts',
      webRoot,
      env: { AI_ENV_PREFLIGHT: 'true', E2E_USER_PASSWORD: 'hunter2secret' },
      candidateId: () => 'environment-preflight-fails',
      environmentPreflight: async (options) => {
        observed = options;
        return { passed: false, diagnostics: ['Origin https://qa.example.test is unreachable.'] };
      },
      generate: async () => {
        generated = true;
      }
    }),
    /Environment preflight failed: Origin https:\/\/qa\.example\.test is unreachable\./
  );

  assert.equal(generated, false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'const oldTarget = true;\n');
  assert.equal(observed.env.AI_GATE_SANITIZED_ENV, 'true');
  assert.equal(observed.env.PLAYWRIGHT_TEST_BASE_URL, 'https://qa.example.test');
  // External-browser plans probe under the external-runtime profile, which
  // keeps the auth runtime credentials the gate will also use.
  assert.equal(observed.env.E2E_USER_PASSWORD, 'hunter2secret');
  assert.equal(observed.webRoot, webRoot);
  assert.equal(observed.projects.some(({ project }) => project === 'chromium'), true);
  const runDir = path.join(webRoot, '.ai-runs', 'generation', 'environment-preflight-fails');
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.failureStage, 'environment-preflight');
  assert.equal(manifest.failureReason, 'environment-preflight');
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const rejectedEvent = events.find((event) =>
    event.type === 'stage' && event.stage === 'environment-preflight' && event.status === 'rejected');
  assert.equal(rejectedEvent.failureStage, 'environment-preflight');
  assert.equal(rejectedEvent.failureReason, 'environment-preflight');
  assert.equal(events.filter((event) => event.type === 'provider-attempt').length, 0);
});

test('environment preflight runs after readiness preflight and before generation', async () => {
  const { webRoot, target } = fixture();
  const order = [];

  await runVerifiedGeneration({
    specPath: 'specs/checkout.md',
    out: 'tests/regression/checkout.spec.ts',
    webRoot,
    env: { AI_ENV_PREFLIGHT: 'true' },
    candidateId: () => 'environment-preflight-passes',
    environmentPreflight: async () => {
      order.push('environment-preflight');
      return { passed: true, probedOrigin: 'https://qa.example.test', diagnostics: [] };
    },
    generate: async () => {
      order.push('generate');
      return { code: 'const accepted = true;\n', result: {} };
    },
    gate: async () => ({ passed: true, stage: 'accepted', reasonCode: 'PASSED' })
  });

  assert.deepEqual(order, ['environment-preflight', 'generate']);
  assert.equal(fs.readFileSync(target, 'utf8'), 'const accepted = true;\n');
  const runDir = path.join(webRoot, '.ai-runs', 'generation', 'environment-preflight-passes');
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const stageIndex = (stage, status) => events.findIndex((event) =>
    event.type === 'stage' && event.stage === stage && event.status === status);
  assert.notEqual(stageIndex('preflight', 'completed'), -1);
  assert.notEqual(stageIndex('environment-preflight', 'completed'), -1);
  assert.notEqual(stageIndex('test-generation', 'started'), -1);
  assert.ok(stageIndex('preflight', 'completed') < stageIndex('environment-preflight', 'started'));
  assert.ok(stageIndex('environment-preflight', 'completed') < stageIndex('test-generation', 'started'));
});

test('a local-fixture-only plan runs the environment preflight under the local-runtime profile', async () => {
  const { webRoot } = fixture();
  const specPath = path.join(webRoot, 'specs', 'checkout.md');
  fs.writeFileSync(
    specPath,
    fs.readFileSync(specPath, 'utf8')
      .replace('| Test Type | regression |', '| Test Type | smoke |')
      .replace(
        '| Target Test File | tests/regression/checkout.spec.ts |',
        '| Target Test File | tests/smoke/checkout.spec.ts |'
      )
  );
  const smokeTarget = path.join(webRoot, 'tests', 'smoke', 'checkout.spec.ts');
  fs.mkdirSync(path.dirname(smokeTarget), { recursive: true });
  fs.writeFileSync(smokeTarget, 'const oldTarget = true;\n');
  let observed;

  await runVerifiedGeneration({
    specPath: 'specs/checkout.md',
    out: 'tests/smoke/checkout.spec.ts',
    webRoot,
    env: { AI_ENV_PREFLIGHT: 'true', E2E_USER_PASSWORD: 'hunter2secret' },
    candidateId: () => 'environment-preflight-local-profile',
    environmentPreflight: async (options) => {
      observed = options;
      return { passed: true, probedOrigin: null, diagnostics: [] };
    },
    generate: async () => ({ code: 'const accepted = true;\n', result: {} }),
    gate: async () => ({ passed: true, stage: 'accepted', reasonCode: 'PASSED' })
  });

  assert.ok(observed, 'the environment preflight must run');
  assert.equal(observed.projects.every(({ project }) => project === 'local-chromium'), true);
  assert.equal(observed.env.AI_GATE_SANITIZED_ENV, 'true');
  // The fast-gate runs local-chromium under the local-runtime profile, so the
  // preflight must not carry auth or API secrets for a local-only plan.
  assert.equal(observed.env.E2E_USER_PASSWORD, '');
  assert.equal(fs.readFileSync(smokeTarget, 'utf8'), 'const accepted = true;\n');
});

test('AI_ENV_PREFLIGHT=false records a skip event and never invokes the environment preflight', async () => {
  const { webRoot, target } = fixture();
  let preflighted = 0;

  await runVerifiedGeneration({
    specPath: 'specs/checkout.md',
    out: 'tests/regression/checkout.spec.ts',
    webRoot,
    candidateId: () => 'environment-preflight-skipped',
    environmentPreflight: async () => {
      preflighted += 1;
      return { passed: false, diagnostics: ['must never run'] };
    },
    generate: async () => ({ code: 'const accepted = true;\n', result: {} }),
    gate: async () => ({ passed: true, stage: 'accepted', reasonCode: 'PASSED' })
  });

  assert.equal(preflighted, 0);
  assert.equal(fs.readFileSync(target, 'utf8'), 'const accepted = true;\n');
  const runDir = path.join(webRoot, '.ai-runs', 'generation', 'environment-preflight-skipped');
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.some((event) =>
    event.type === 'stage-skipped' && event.stage === 'environment-preflight'), true);
});

test('an invalid AI_ENV_PREFLIGHT value fails closed before any run directory or provider call', async () => {
  const { webRoot } = fixture();
  let generated = false;

  await assert.rejects(
    runVerifiedGeneration({
      specPath: 'specs/checkout.md',
      out: 'tests/regression/checkout.spec.ts',
      webRoot,
      env: { AI_ENV_PREFLIGHT: 'maybe' },
      candidateId: () => 'environment-preflight-invalid-flag',
      generate: async () => {
        generated = true;
      }
    }),
    /AI_ENV_PREFLIGHT must be true or false/
  );

  assert.equal(generated, false);
  assert.equal(
    fs.existsSync(path.join(webRoot, '.ai-runs', 'generation', 'environment-preflight-invalid-flag')),
    false
  );
});

test('the default environment preflight is wired and fails a web root whose Playwright config is missing', async () => {
  const { webRoot } = fixture();
  let generated = false;

  await assert.rejects(
    runVerifiedGeneration({
      specPath: 'specs/checkout.md',
      out: 'tests/regression/checkout.spec.ts',
      webRoot,
      env: { AI_ENV_PREFLIGHT: 'true' },
      candidateId: () => 'environment-preflight-default',
      generate: async () => {
        generated = true;
      }
    }),
    /Environment preflight failed:.*playwright\.config\.ts/
  );

  assert.equal(generated, false);
  const runDir = path.join(webRoot, '.ai-runs', 'generation', 'environment-preflight-default');
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.filter((event) => event.type === 'provider-attempt').length, 0);
});
