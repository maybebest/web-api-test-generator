import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { acceptedGeneratedGateVerdict } from '../lib/generated-gate-verdict.mjs';
import { createGenerationRun, finalizeGenerationRun } from '../lib/generation-run.mjs';
import { runVerifiedGeneration as runVerifiedGenerationImpl } from '../verified-generate.mjs';

function tempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accepted-warning-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('accepted gate verdict carries a non-negative static-review warning count', () => {
  // The bare call keeps its exact legacy shape (recording gate path).
  assert.deepEqual(acceptedGeneratedGateVerdict(), {
    schema: 'generated-gate-verdict/v1',
    passed: true,
    stage: 'accepted',
    reasonCode: 'PASSED',
    diagnostics: [],
    repairable: false
  });
  assert.equal(acceptedGeneratedGateVerdict({ staticReviewWarningCount: 0 }).staticReviewWarningCount, 0);
  assert.equal(acceptedGeneratedGateVerdict({ staticReviewWarningCount: 2 }).staticReviewWarningCount, 2);
  // Invalid counts are dropped rather than persisted.
  assert.equal(acceptedGeneratedGateVerdict({ staticReviewWarningCount: -1 }).staticReviewWarningCount, undefined);
  assert.equal(acceptedGeneratedGateVerdict({ staticReviewWarningCount: 1.5 }).staticReviewWarningCount, undefined);
  assert.equal(acceptedGeneratedGateVerdict({ staticReviewWarningCount: 'x' }).staticReviewWarningCount, undefined);
});

test('finalized generation manifests persist the accepted static-review warning count', (t) => {
  const telemetryRoot = tempDirectory(t);

  const warned = createGenerationRun({ telemetryRoot, runId: 'warned-run' });
  const warnedSummary = finalizeGenerationRun(warned, {
    status: 'succeeded',
    quality: {
      reviewPassed: true,
      fastGatePassed: true,
      fullGatePassed: null,
      qualityFingerprint: 'a'.repeat(64),
      repairCount: 0,
      staticReviewWarningCount: 3
    }
  });
  assert.equal(warnedSummary.quality.staticReviewWarningCount, 3);
  const manifest = JSON.parse(fs.readFileSync(warned.manifestPath, 'utf8'));
  assert.equal(manifest.quality.staticReviewWarningCount, 3);

  // Legacy callers that omit the field normalize to null (unknown), never 0.
  const legacy = createGenerationRun({ telemetryRoot, runId: 'legacy-run' });
  const legacySummary = finalizeGenerationRun(legacy, {
    status: 'succeeded',
    quality: {
      reviewPassed: true,
      fastGatePassed: true,
      fullGatePassed: null,
      qualityFingerprint: 'b'.repeat(64),
      repairCount: 0
    }
  });
  assert.equal(legacySummary.quality.staticReviewWarningCount, null);

  // Invalid values normalize to null as well.
  const invalid = createGenerationRun({ telemetryRoot, runId: 'invalid-run' });
  const invalidSummary = finalizeGenerationRun(invalid, {
    status: 'failed',
    failureStage: 'static-review',
    failureReason: 'gate-rejected',
    quality: {
      reviewPassed: false,
      fastGatePassed: false,
      fullGatePassed: null,
      qualityFingerprint: 'c'.repeat(64),
      repairCount: 0,
      staticReviewWarningCount: -4
    }
  });
  assert.equal(invalidSummary.quality.staticReviewWarningCount, null);
});

test('verified generation records the gate warning count in the accepted run manifest', async (t) => {
  const webRoot = tempDirectory(t);
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

  await runVerifiedGenerationImpl({
    browserExecutableExists: () => true,
    specPath: 'specs/checkout.md',
    out: 'tests/regression/checkout.spec.ts',
    webRoot,
    candidateId: () => 'warned-accept-run',
    env: {
      PLAYWRIGHT_TEST_BASE_URL: 'https://qa.example.test',
      AI_ENV_PREFLIGHT: 'false'
    },
    generate: async (options) => ({
      code: 'const acceptedCandidate = true;\n',
      promptPath: options.specPath,
      result: {
        brain: { kind: 'openai', model: 'gpt-test' },
        usage: { totalTokens: 25 }
      }
    }),
    gate: async () => ({
      passed: true,
      stage: 'accepted',
      reasonCode: 'PASSED',
      staticReviewWarningCount: 2
    })
  });

  const manifest = JSON.parse(fs.readFileSync(
    path.join(webRoot, '.ai-runs', 'generation', 'warned-accept-run', 'manifest.json'),
    'utf8'
  ));
  assert.equal(manifest.status, 'succeeded');
  assert.equal(manifest.quality.staticReviewWarningCount, 2);
});
