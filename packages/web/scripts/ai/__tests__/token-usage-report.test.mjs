import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  evaluateBudgets,
  parseArgs,
  readGenerationUsage,
  summarizeGenerationUsage
} from '../token-usage-report.mjs';

function tempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'token-usage-report-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeManifest(root, name, usage) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({
    generation: { brain: 'openai', model: 'gpt-test', usage }
  }));
}

function writeGenerationRun(root, runId, { manifest = {}, attempts = [], cacheEvents = [] } = {}) {
  const directory = path.join(root, 'generation', runId);
  fs.mkdirSync(directory, { recursive: true });
  const status = manifest.status ?? 'succeeded';
  const providerEvents = attempts.map((attempt) => ({
    schemaVersion: 'generation-run-event/v1',
    runId,
    type: 'provider-attempt',
    timestamp: '2026-08-02T10:00:00.100Z',
    stage: 'test-generation',
    ...attempt
  }));
  const events = [
    {
      schemaVersion: 'generation-run-event/v1', runId, type: 'run-started',
      timestamp: '2026-08-02T10:00:00.000Z', stage: 'test-generation', status: 'started'
    },
    ...providerEvents,
    ...cacheEvents,
    ...(['succeeded', 'failed'].includes(status) ? [{
      schemaVersion: 'generation-run-event/v1', runId, type: 'run-finished',
      timestamp: '2026-08-02T10:00:00.900Z', stage: 'test-generation', status
    }] : [])
  ].map((event, sequence) => ({ ...event, sequence }));
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({
    schemaVersion: 'generation-run/v1',
    runId,
    stage: 'test-generation',
    status,
    events: events.length,
    attempts: attempts.length,
    failedAttempts: attempts.filter((attempt) => attempt.status !== 'succeeded').length,
    endToEndLatencyMs: 300,
    failureStage: null,
    failureReason: null,
    quality: {
      reviewPassed: true,
      fastGatePassed: true,
      fullGatePassed: null,
      repairCount: 0,
      qualityFingerprint: null
    },
    ...manifest
  }));
  fs.writeFileSync(path.join(directory, 'events.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
}

test('token usage report aggregates provider, retry, compaction, and exact-cache metrics', (t) => {
  const directory = tempDirectory(t);
  writeManifest(directory, 'first', {
    provider: 'openai',
    inputTokens: 100,
    outputTokens: 20,
    cachedTokens: 60,
    cacheWriteTokens: 5,
    reasoningTokens: 4,
    totalTokens: 120,
    retryCount: 1,
    retryTokens: null,
    promptChars: 2000,
    compactionSavedChars: 300
  });
  writeManifest(directory, 'second', {
    provider: 'openai',
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    retryCount: 0,
    retryTokens: 0,
    resultCacheHit: true,
    savedTokens: 120,
    promptChars: 1700,
    compactionSavedChars: 300
  });

  const collected = readGenerationUsage(directory);
  const summary = summarizeGenerationUsage(collected);

  assert.equal(summary.generations, 2);
  assert.equal(summary.totalTokens, 120);
  assert.equal(summary.generationsWithUnknownTotalTokens, 0);
  assert.equal(summary.cachedTokens, 60);
  assert.equal(summary.cacheWriteTokens, 5);
  assert.equal(summary.reasoningTokens, 4);
  assert.equal(summary.retries, 1);
  assert.equal(summary.retriesWithUnknownTokens, 1);
  assert.equal(summary.resultCacheHits, 1);
  assert.equal(summary.savedTokens, 120);
  assert.equal(summary.compactionSavedChars, 600);
});

test('token usage report enforces per-generation token and retry budgets', (t) => {
  const directory = tempDirectory(t);
  writeManifest(directory, 'over-budget', { totalTokens: 501, retryCount: 2 });
  const { rows } = readGenerationUsage(directory);

  const violations = evaluateBudgets(rows, { maxTokensPerGeneration: 500, maxRetries: 1 });
  assert.equal(violations.length, 2);
  assert.match(violations[0], /totalTokens=501/);
  assert.match(violations[1], /retryCount=2/);
});

test('token budgets aggregate all attempts in a run instead of treating each paid attempt as a generation', () => {
  const rows = [
    {
      runId: 'multi-attempt', manifestPath: '/runs/multi/manifest.json', source: 'generation-run/v1',
      totalTokens: 300, retryCount: null, retryStatus: 'retrying'
    },
    {
      runId: 'multi-attempt', manifestPath: '/runs/multi/manifest.json', source: 'generation-run/v1',
      totalTokens: 300, retryCount: null, retryStatus: 'retrying'
    },
    {
      runId: 'multi-attempt', manifestPath: '/runs/multi/manifest.json', source: 'generation-run/v1',
      totalTokens: 100, retryCount: null, retryStatus: null
    }
  ];

  const violations = evaluateBudgets(rows, { maxTokensPerGeneration: 500, maxRetries: 1 });
  assert.equal(violations.length, 2);
  assert.match(violations[0], /totalTokens=700/);
  assert.match(violations[1], /retryCount=2/);
});

test('token usage report ignores manifests without generation usage and reports malformed JSON', (t) => {
  const directory = tempDirectory(t);
  fs.mkdirSync(path.join(directory, 'empty'));
  fs.writeFileSync(path.join(directory, 'empty', 'manifest.json'), JSON.stringify({ specPath: 'spec.md' }));
  fs.mkdirSync(path.join(directory, 'broken'));
  fs.writeFileSync(path.join(directory, 'broken', 'manifest.json'), '{broken');

  const collected = readGenerationUsage(directory);
  assert.equal(collected.rows.length, 0);
  assert.equal(collected.invalidManifests.length, 1);
});

test('token usage report rejects mismatched event schemas and run ids instead of silently dropping evidence', (t) => {
  const directory = tempDirectory(t);
  writeGenerationRun(directory, 'expected-run');
  const eventsPath = path.join(directory, 'generation', 'expected-run', 'events.jsonl');
  fs.writeFileSync(eventsPath, `${JSON.stringify({
    schemaVersion: 'generation-run-event/v0',
    runId: 'different-run',
    type: 'provider-attempt'
  })}\n`);

  const collected = readGenerationUsage(directory);
  assert.equal(collected.invalidEvents.length, 1);
  assert.match(collected.invalidEvents[0].error, /schema|run id/i);
});

test('token usage report CLI arguments are strict', () => {
  assert.deepEqual(
    parseArgs(['--dir', '/tmp/runs', '--json', '--require', '--max-tokens-per-generation', '1000', '--max-retries', '0']),
    {
      dir: '/tmp/runs',
      json: true,
      require: true,
      maxTokensPerGeneration: 1000,
      maxRetries: 0
    }
  );
  assert.throws(() => parseArgs(['--unknown']), /Unexpected argument/);
  assert.throws(() => parseArgs(['--max-retries', '-1']), /non-negative integer/);
});

test('full-funnel report aggregates attempts, disjoint token buckets, nearest-rank latency, and quality rates', (t) => {
  const directory = tempDirectory(t);
  writeGenerationRun(directory, 'run-1', {
    attempts: [
      {
        provider: 'openai', model: 'gpt-test', attempt: 1, status: 'failed', durationMs: 10,
        retryStatus: 'retrying', failureStage: 'provider', failureReason: 'http-429', usage: null
      },
      {
        provider: 'openai', model: 'gpt-test', attempt: 2, status: 'succeeded', durationMs: 100,
        usage: {
          inputTokens: 100,
          uncachedInputTokens: 30,
          cachedTokens: 60,
          cacheWriteTokens: 10,
          outputTokens: 20,
          reasoningTokens: 4,
          totalTokens: 120,
          promptChars: 1_700,
          compactionSavedChars: 300,
          resultCacheHit: false,
          resultCacheStatus: 'miss',
          providerPromptCacheStatus: 'explicit-stable',
          singleFlightJoined: false,
          savedTokens: 0
        }
      }
    ],
    manifest: { endToEndLatencyMs: 300 }
  });
  writeGenerationRun(directory, 'run-2', {
    attempts: [{
      provider: 'anthropic', model: 'claude-test', attempt: 1, status: 'succeeded', durationMs: 200,
      usage: {
        inputTokens: 50,
        uncachedInputTokens: 50,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 10,
        reasoningTokens: 0,
        totalTokens: 60,
        resultCacheHit: false,
        resultCacheStatus: 'disabled',
        providerPromptCacheStatus: 'disabled',
        singleFlightJoined: false,
        savedTokens: 0
      }
    }],
    manifest: {
      status: 'failed',
      endToEndLatencyMs: 500,
      failureStage: 'static-review',
      failureReason: 'gate-rejected',
      quality: {
        reviewPassed: false,
        fastGatePassed: false,
        fullGatePassed: null,
        repairCount: 0,
        qualityFingerprint: null
      }
    }
  });
  writeGenerationRun(directory, 'run-3', {
    attempts: [],
    manifest: {
      endToEndLatencyMs: 100,
      quality: {
        reviewPassed: true,
        fastGatePassed: true,
        fullGatePassed: true,
        repairCount: 1,
        qualityFingerprint: 'a'.repeat(64)
      }
    },
    cacheEvents: [{
      schemaVersion: 'generation-run-event/v1',
      runId: 'run-3',
      sequence: 0,
      type: 'result-cache',
      timestamp: '2026-08-02T10:00:00.000Z',
      stage: 'test-generation',
      status: 'completed',
      provider: 'openai',
      model: 'gpt-test',
      durationMs: 2,
      usage: {
        inputTokens: 0,
        uncachedInputTokens: 0,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        resultCacheHit: true,
        resultCacheStatus: 'hit',
        providerPromptCacheStatus: 'automatic-possible',
        singleFlightJoined: false,
        savedTokens: 120
      }
    }]
  });

  const collected = readGenerationUsage(directory);
  const summary = summarizeGenerationUsage(collected);

  assert.equal(summary.generations, 3);
  assert.equal(summary.attempts, 3);
  assert.equal(summary.failedAttempts, 1);
  assert.equal(summary.unknownUsageAttempts, 1);
  assert.deepEqual(summary.failureStages, { provider: 1, 'static-review': 1 });
  assert.equal(summary.inputTokens, 150);
  assert.equal(summary.uncachedInputTokens, 80);
  assert.equal(summary.cachedTokens, 60);
  assert.equal(summary.cacheWriteTokens, 10);
  assert.equal(summary.outputTokens, 30);
  assert.equal(summary.reasoningTokens, 4);
  assert.equal(summary.promptChars, 1_700);
  assert.equal(summary.compactionSavedChars, 300);
  assert.equal(summary.retries, 1);
  assert.equal(summary.retriesWithUnknownTokens, 1);
  assert.equal(summary.providerLatencyP50Ms, 100);
  assert.equal(summary.providerLatencyP95Ms, 200);
  assert.equal(summary.endToEndLatencyP50Ms, 300);
  assert.equal(summary.endToEndLatencyP95Ms, 500);
  assert.equal(summary.cacheReadRatio, 0.4);
  assert.equal(summary.resultCacheHits, 1);
  assert.equal(summary.exactCacheLookups, 2);
  assert.equal(summary.exactCacheMisses, 1);
  assert.equal(summary.exactCacheJoins, 0);
  assert.equal(summary.exactCacheHitRatio, 0.5);
  assert.deepEqual(summary.providerPromptCacheControls, { disabled: 1, 'explicit-stable': 1 });
  assert.equal(summary.savedTokens, 120);
  assert.equal(summary.firstPassReviewRate, 1 / 3);
  assert.equal(summary.fastGateRate, 2 / 3);
  assert.equal(summary.fullGateRate, 1);
  assert.equal(summary.repairCount, 1);
});

test('promotion gate metadata is defensively retained and reported separately from token usage', (t) => {
  const directory = tempDirectory(t);
  const successfulAttempt = () => ({
    provider: 'openai', model: 'gpt-test', attempt: 1, status: 'succeeded', durationMs: 10,
    usage: { inputTokens: 4, uncachedInputTokens: 4, outputTokens: 2, totalTokens: 6 }
  });
  writeManifest(directory, 'legacy', {
    provider: 'openai', inputTokens: 4, uncachedInputTokens: 4, outputTokens: 2, totalTokens: 6
  });
  writeGenerationRun(directory, 'historical-run', { attempts: [successfulAttempt()] });
  writeGenerationRun(directory, 'v2-policy-run', {
    attempts: [successfulAttempt()],
    manifest: {
      quality: {
        reviewPassed: true,
        fastGatePassed: true,
        fullGatePassed: null,
        promotionGatePolicy: 'verified-fast-gate/v2',
        promotionGateRepeatEach: 1,
        repairCount: 0
      }
    }
  });
  writeGenerationRun(directory, 'v3-policy-run', {
    attempts: [successfulAttempt()],
    manifest: {
      quality: {
        reviewPassed: true,
        fastGatePassed: true,
        fullGatePassed: null,
        promotionGatePolicy: 'verified-promotion-gate/v3',
        promotionGateRepeatEach: 2,
        repairCount: 0
      }
    }
  });
  for (const [runId, promotionGatePolicy, promotionGateRepeatEach] of [
    ['zero-repeat', 'constructor', 0],
    ['code-point-upper', 'A-policy', 0],
    ['code-point-lower', 'a-policy', 0],
    ['fractional-repeat', 'x'.repeat(129), 1.5],
    ['oversized-repeat', 'not a telemetry label', Number.MAX_SAFE_INTEGER + 1]
  ]) {
    writeGenerationRun(directory, runId, {
      attempts: [successfulAttempt()],
      manifest: {
        quality: {
          promotionGatePolicy,
          promotionGateRepeatEach
        }
      }
    });
  }

  const collected = readGenerationUsage(directory);
  const summary = summarizeGenerationUsage(collected);
  const qualityByRunId = Object.fromEntries(collected.runs.map((run) => [run.runId, run.quality]));
  const legacyQuality = collected.runs.find((run) => run.source === 'legacy-manifest').quality;

  assert.deepEqual(legacyQuality, {
    reviewPassed: null,
    fastGatePassed: null,
    fullGatePassed: null,
    promotionGatePolicy: null,
    promotionGateRepeatEach: null,
    repairCount: 0
  });
  assert.equal(qualityByRunId['historical-run'].promotionGatePolicy, null);
  assert.equal(qualityByRunId['historical-run'].promotionGateRepeatEach, null);
  assert.equal(qualityByRunId['v3-policy-run'].promotionGatePolicy, 'verified-promotion-gate/v3');
  assert.equal(qualityByRunId['v3-policy-run'].promotionGateRepeatEach, 2);
  assert.equal(qualityByRunId['zero-repeat'].promotionGateRepeatEach, null);
  assert.equal(qualityByRunId['fractional-repeat'].promotionGateRepeatEach, null);
  assert.equal(qualityByRunId['oversized-repeat'].promotionGateRepeatEach, null);
  assert.equal(qualityByRunId['fractional-repeat'].promotionGatePolicy, null);
  assert.equal(qualityByRunId['oversized-repeat'].promotionGatePolicy, null);
  assert.deepEqual(summary.promotionGatePolicyDistribution, {
    'A-policy': 1,
    'a-policy': 1,
    constructor: 1,
    'verified-fast-gate/v2': 1,
    'verified-promotion-gate/v3': 1
  });
  assert.deepEqual(Object.keys(summary.promotionGatePolicyDistribution), [
    'A-policy', 'a-policy', 'constructor', 'verified-fast-gate/v2', 'verified-promotion-gate/v3'
  ]);
  assert.deepEqual(summary.promotionGateRepeatEachDistribution, { 1: 1, 2: 1 });

  const script = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'token-usage-report.mjs');
  const child = spawnSync(process.execPath, [script, '--dir', directory], { encoding: 'utf8', shell: false });
  assert.equal(child.status, 0);
  assert.match(child.stdout, /Quality context — promotion gate policy distribution: \{"A-policy":1,"a-policy":1,"constructor":1,"verified-fast-gate\/v2":1,"verified-promotion-gate\/v3":1\}/);
  assert.match(child.stdout, /Quality context — promotion gate repeat distribution: \{"1":1,"2":1\}/);
});

test('new generation-run events take precedence over a legacy manifest with the same run id', (t) => {
  const directory = tempDirectory(t);
  writeGenerationRun(directory, 'same-run', {
    attempts: [{
      provider: 'openai', model: 'gpt-new', attempt: 1, status: 'succeeded', durationMs: 25,
      usage: {
        inputTokens: 11, uncachedInputTokens: 11, cachedTokens: 0, cacheWriteTokens: 0,
        outputTokens: 4, reasoningTokens: 0, totalTokens: 15, resultCacheHit: false, savedTokens: 0
      }
    }]
  });
  const legacyDirectory = path.join(directory, 'legacy-copy');
  fs.mkdirSync(legacyDirectory);
  fs.writeFileSync(path.join(legacyDirectory, 'manifest.json'), JSON.stringify({
    generation: {
      runId: 'same-run',
      brain: 'openai',
      model: 'gpt-old',
      usage: { inputTokens: 999, outputTokens: 1, totalTokens: 1000 }
    }
  }));

  const collected = readGenerationUsage(directory);
  const summary = summarizeGenerationUsage(collected);
  assert.equal(summary.generations, 1);
  assert.equal(summary.attempts, 1);
  assert.equal(summary.totalTokens, 15);
  assert.equal(collected.rows[0].model, 'gpt-new');
});

test('exact-cache reporting separates persistent hits, misses, and single-flight joins', (t) => {
  const directory = tempDirectory(t);
  writeGenerationRun(directory, 'cache-miss', {
    attempts: [{
      provider: 'openai', model: 'gpt-test', attempt: 1, status: 'succeeded', durationMs: 10,
      usage: {
        inputTokens: 10, uncachedInputTokens: 10, cachedTokens: 0, cacheWriteTokens: 0,
        outputTokens: 5, reasoningTokens: 0, totalTokens: 15,
        resultCacheHit: false, resultCacheStatus: 'miss', providerPromptCacheStatus: 'automatic-possible',
        singleFlightJoined: false, savedTokens: 0
      }
    }]
  });
  for (const [runId, resultCacheStatus, resultCacheHit, savedTokens] of [
    ['cache-hit', 'hit', true, 15],
    ['cache-join', 'single-flight-join', false, 15]
  ]) {
    writeGenerationRun(directory, runId, {
      cacheEvents: [{
        schemaVersion: 'generation-run-event/v1', runId, sequence: 0, type: 'result-cache',
        timestamp: '2026-08-02T10:00:00.000Z', stage: 'test-generation', status: 'completed',
        provider: 'openai', model: 'gpt-test', durationMs: 1,
        usage: {
          inputTokens: 0, uncachedInputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0,
          outputTokens: 0, reasoningTokens: 0, totalTokens: 0,
          resultCacheHit, resultCacheStatus, providerPromptCacheStatus: 'automatic-possible',
          singleFlightJoined: resultCacheStatus === 'single-flight-join', savedTokens
        }
      }]
    });
  }

  const summary = summarizeGenerationUsage(readGenerationUsage(directory));
  assert.equal(summary.exactCacheLookups, 3);
  assert.equal(summary.exactCacheHits, 1);
  assert.equal(summary.exactCacheMisses, 1);
  assert.equal(summary.exactCacheJoins, 1);
  assert.equal(summary.exactCacheHitRatio, 1 / 3);
  assert.equal(summary.savedRequests, 2);
  assert.equal(summary.savedTokens, 30);
});

test('--require fails when a paid provider attempt has unknown usage', (t) => {
  const directory = tempDirectory(t);
  writeGenerationRun(directory, 'unknown-paid-attempt', {
    attempts: [{
      provider: 'openai', model: 'gpt-test', attempt: 1, status: 'failed', durationMs: 12,
      failureStage: 'provider', failureReason: 'http-500', usage: null
    }],
    manifest: {
      status: 'failed',
      failureStage: 'provider',
      failureReason: 'http-500',
      quality: {
        reviewPassed: null,
        fastGatePassed: null,
        fullGatePassed: null,
        repairCount: 0,
        qualityFingerprint: null
      }
    }
  });

  const script = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'token-usage-report.mjs');
  const child = spawnSync(process.execPath, [script, '--dir', directory, '--json', '--require'], {
    encoding: 'utf8',
    shell: false
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /unknown usage/i);
});

test('--require classifies an interrupted running manifest as incomplete unknown usage', (t) => {
  const directory = tempDirectory(t);
  writeGenerationRun(directory, 'interrupted-run', {
    manifest: {
      status: 'running',
      endToEndLatencyMs: null,
      quality: {
        reviewPassed: null,
        fastGatePassed: null,
        fullGatePassed: null,
        repairCount: 0,
        qualityFingerprint: null
      }
    }
  });

  const summary = summarizeGenerationUsage(readGenerationUsage(directory));
  assert.equal(summary.incompleteRuns, 1);
  assert.equal(summary.unknownInFlightRuns, 1);

  const script = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'token-usage-report.mjs');
  const child = spawnSync(process.execPath, [script, '--dir', directory, '--json', '--require'], {
    encoding: 'utf8',
    shell: false
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /incomplete.*unknown usage/i);
});

test('metered CLI provider attempts without token accounting remain unknown', (t) => {
  const directory = tempDirectory(t);
  writeGenerationRun(directory, 'cli-generation', {
    attempts: [{
      provider: 'codex-cli', model: 'codex', attempt: 1, status: 'succeeded', durationMs: 20,
      usage: null
    }]
  });

  const summary = summarizeGenerationUsage(readGenerationUsage(directory));
  assert.equal(summary.attempts, 1);
  assert.equal(summary.unknownUsageAttempts, 1);
});

test('a succeeded run without provider or result-cache evidence is invalid instead of zero-cost', (t) => {
  const directory = tempDirectory(t);
  writeGenerationRun(directory, 'unsubstantiated-success');

  const collected = readGenerationUsage(directory);
  const summary = summarizeGenerationUsage(collected);
  assert.equal(summary.generations, 1);
  assert.equal(summary.invalidEvents, 1);
  assert.match(collected.invalidEvents[0].error, /succeeded.*provider-attempt.*result-cache/i);

  const script = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'token-usage-report.mjs');
  const child = spawnSync(process.execPath, [script, '--dir', directory, '--json', '--require'], {
    encoding: 'utf8',
    shell: false
  });
  assert.equal(child.status, 1);
});

test('generation history reconciles event sequence and manifest attempt counters', (t) => {
  const directory = tempDirectory(t);
  writeGenerationRun(directory, 'counter-mismatch', {
    attempts: [{
      provider: 'openai', model: 'gpt-test', attempt: 1, status: 'succeeded', durationMs: 20,
      usage: { inputTokens: 4, uncachedInputTokens: 4, outputTokens: 2, totalTokens: 6 }
    }],
    manifest: { attempts: 9 }
  });
  const eventsPath = path.join(directory, 'generation', 'counter-mismatch', 'events.jsonl');
  const events = fs.readFileSync(eventsPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  events[1].sequence = 7;
  fs.writeFileSync(eventsPath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);

  const collected = readGenerationUsage(directory);
  assert.equal(collected.invalidEvents.length, 1);
  assert.match(collected.invalidEvents[0].error, /sequence.*attempt/i);
});

test('corrupt paid-attempt events become explicit unknown usage instead of measured zero', (t) => {
  const directory = tempDirectory(t);
  const subjectFingerprint = 'b'.repeat(64);
  const declaredAttempts = 50_000;
  writeGenerationRun(directory, 'corrupt-paid-attempt', {
    attempts: [{
      provider: 'openai', model: 'gpt-test', attempt: 1, status: 'succeeded', durationMs: 20,
      usage: { inputTokens: 4, uncachedInputTokens: 4, outputTokens: 2, totalTokens: 6 }
    }],
    manifest: { stage: 'repair', subjectFingerprint, attempts: declaredAttempts }
  });
  const eventsPath = path.join(directory, 'generation', 'corrupt-paid-attempt', 'events.jsonl');
  const lines = fs.readFileSync(eventsPath, 'utf8').trim().split('\n');
  lines[1] = '{"private":"CORRUPT PROVIDER BODY CANARY"';
  fs.writeFileSync(eventsPath, `${lines.join('\n')}\n`);

  const collected = readGenerationUsage(directory);
  assert.equal(collected.invalidEvents.length, 1);
  assert.equal(collected.rows.length, 1, 'missing attempts must use one bounded aggregate row');
  assert.deepEqual({
    source: collected.rows[0].source,
    stage: collected.rows[0].stage,
    subjectFingerprint: collected.rows[0].subjectFingerprint,
    provider: collected.rows[0].provider,
    model: collected.rows[0].model,
    status: collected.rows[0].status,
    attemptCount: collected.rows[0].attemptCount,
    usageKnown: collected.rows[0].usageKnown
  }, {
    source: 'generation-run/v1-missing-attempt',
    stage: 'repair',
    subjectFingerprint,
    provider: null,
    model: null,
    status: null,
    attemptCount: declaredAttempts,
    usageKnown: false
  });
  for (const field of [
    'inputTokens', 'uncachedInputTokens', 'outputTokens', 'cachedTokens', 'cacheWriteTokens',
    'reasoningTokens', 'totalTokens', 'retryCount', 'retryTokens', 'latencyMs', 'resultCacheHit',
    'resultCacheStatus', 'providerPromptCacheStatus', 'singleFlightJoined', 'savedTokens',
    'promptChars', 'compactionSavedChars'
  ]) {
    assert.equal(collected.rows[0][field], null, `${field} must remain unknown`);
  }

  const summary = summarizeGenerationUsage(collected);
  assert.equal(summary.attempts, declaredAttempts);
  assert.equal(summary.unknownUsageAttempts, declaredAttempts);
  assert.equal(summary.attemptsWithUnknownTotalTokens, declaredAttempts);
  assert.equal(summary.failedAttempts, 0, 'missing status must not be guessed as failure');
  assert.equal(summary.attemptsWithUnknownStatus, declaredAttempts);
  assert.equal(summary.byStage.repair.attempts, declaredAttempts);
  assert.equal(summary.byStage.repair.unknownUsageAttempts, declaredAttempts);
  assert.equal(summary.byStage.repair.attemptsWithUnknownStatus, declaredAttempts);
  assert.doesNotMatch(JSON.stringify({ rows: collected.rows, summary }), /CORRUPT|PROVIDER BODY CANARY/);
});

test('usage rows retain allowlisted stage and subject identity and byStage reconciles disjoint totals', (t) => {
  const directory = tempDirectory(t);
  const subjectFingerprint = 'a'.repeat(64);
  writeGenerationRun(directory, 'repair-run', {
    attempts: [{
      provider: 'openai', model: 'gpt-test', attempt: 1, stage: 'repair', status: 'succeeded', durationMs: 25,
      prompt: 'PRIVATE PROMPT CANARY', response: 'PRIVATE RESPONSE CANARY',
      usage: {
        inputTokens: 30, uncachedInputTokens: 20, cachedTokens: 5, cacheWriteTokens: 5,
        outputTokens: 7, reasoningTokens: 2, totalTokens: 37,
        resultCacheHit: false, resultCacheStatus: 'miss', providerPromptCacheStatus: 'explicit-off'
      }
    }],
    manifest: { subjectFingerprint }
  });
  writeGenerationRun(directory, 'fit-run', {
    attempts: [{
      provider: 'codex-cli', model: 'codex', attempt: 1, stage: 'spec-fit', status: 'succeeded', durationMs: 50,
      usage: null
    }],
    manifest: { stage: 'spec-fit', subjectFingerprint: null }
  });
  writeGenerationRun(directory, 'cache-run', {
    cacheEvents: [{
      schemaVersion: 'generation-run-event/v1', runId: 'cache-run', type: 'result-cache',
      timestamp: '2026-08-02T10:00:00.000Z', stage: 'test-generation', status: 'completed',
      provider: 'openai', model: 'gpt-test', durationMs: 3,
      prompt: 'PRIVATE CACHE PROMPT', response: 'PRIVATE CACHE RESPONSE',
      usage: {
        inputTokens: 0, uncachedInputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0,
        outputTokens: 0, reasoningTokens: 0, totalTokens: 0,
        resultCacheHit: true, resultCacheStatus: 'hit', providerPromptCacheStatus: 'explicit-off',
        singleFlightJoined: false, savedTokens: 37
      }
    }],
    manifest: { subjectFingerprint }
  });

  const collected = readGenerationUsage(directory);
  const repairRow = collected.rows.find((row) => row.runId === 'repair-run');
  const fitRow = collected.rows.find((row) => row.runId === 'fit-run');
  const cacheRow = collected.cacheRows.find((row) => row.runId === 'cache-run');
  assert.equal(repairRow.stage, 'repair');
  assert.equal(repairRow.subjectFingerprint, subjectFingerprint);
  assert.equal(fitRow.stage, 'spec-fit');
  assert.equal(fitRow.subjectFingerprint, null);
  assert.equal(cacheRow.stage, 'test-generation');
  assert.equal(cacheRow.subjectFingerprint, subjectFingerprint);

  const summary = summarizeGenerationUsage(collected);
  assert.deepEqual(Object.keys(summary.byStage), ['repair', 'spec-fit', 'test-generation']);
  assert.equal(summary.byStage.repair.attempts, 1);
  assert.equal(summary.byStage.repair.unknownUsageAttempts, 0);
  assert.equal(summary.byStage.repair.uncachedInputTokens, 20);
  assert.equal(summary.byStage.repair.cachedTokens, 5);
  assert.equal(summary.byStage.repair.cacheWriteTokens, 5);
  assert.equal(summary.byStage.repair.outputTokens, 7);
  assert.equal(summary.byStage.repair.reasoningTokens, 2);
  assert.equal(summary.byStage['spec-fit'].unknownUsageAttempts, 1);
  assert.equal(summary.byStage['test-generation'].exactCacheHits, 1);
  assert.equal(summary.byStage['test-generation'].savedRequests, 1);
  assert.equal(summary.byStage['test-generation'].savedTokens, 37);
  for (const field of [
    'attempts', 'knownUsageAttempts', 'unknownUsageAttempts', 'failedAttempts', 'attemptsWithUnknownStatus',
    'inputTokens', 'uncachedInputTokens', 'cachedTokens', 'cacheWriteTokens', 'outputTokens',
    'reasoningTokens', 'totalTokens', 'attemptsWithUnknownTotalTokens', 'retries',
    'retryTokensKnown', 'retriesWithUnknownTokens', 'resultCacheHits', 'exactCacheLookups',
    'exactCacheHits', 'exactCacheMisses', 'exactCacheJoins', 'savedRequests', 'savedTokens',
    'promptChars', 'compactionSavedChars'
  ]) {
    const perStage = Object.values(summary.byStage).reduce((total, stage) => total + stage[field], 0);
    assert.equal(perStage, summary[field], `${field} must reconcile`);
  }
  const perStagePromptCacheControls = Object.values(summary.byStage).reduce((counts, stage) => {
    for (const [status, count] of Object.entries(stage.providerPromptCacheControls)) {
      counts[status] = (counts[status] ?? 0) + count;
    }
    return counts;
  }, {});
  assert.deepEqual(perStagePromptCacheControls, summary.providerPromptCacheControls);
  assert.doesNotMatch(JSON.stringify({ rows: collected.rows, cacheRows: collected.cacheRows, summary }), /PRIVATE/);
});

test('recording-generation provider usage retains its full-funnel stage identity', (t) => {
  const directory = tempDirectory(t);
  writeGenerationRun(directory, 'recording-generation-run', {
    attempts: [{
      provider: 'openai',
      model: 'gpt-recording',
      attempt: 1,
      stage: 'recording-generation',
      status: 'succeeded',
      durationMs: 75,
      usage: {
        inputTokens: 30,
        uncachedInputTokens: 30,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 10,
        reasoningTokens: 0,
        totalTokens: 40,
        resultCacheHit: false,
        resultCacheStatus: 'disabled',
        providerPromptCacheStatus: 'disabled',
        singleFlightJoined: false,
        savedTokens: 0
      }
    }],
    manifest: { stage: 'recording-generation' }
  });

  const collected = readGenerationUsage(directory);
  const summary = summarizeGenerationUsage(collected);

  assert.equal(collected.rows[0].stage, 'recording-generation');
  assert.deepEqual(Object.keys(summary.byStage), ['recording-generation']);
  assert.equal(summary.byStage['recording-generation'].attempts, 1);
  assert.equal(summary.byStage['recording-generation'].totalTokens, 40);
});

test('legacy usage keeps null identity and aggregates under an explicit unknown stage', (t) => {
  const directory = tempDirectory(t);
  writeManifest(directory, 'legacy', {
    provider: 'openai', inputTokens: 4, uncachedInputTokens: 4,
    outputTokens: 2, totalTokens: 6, retryCount: 0
  });

  const collected = readGenerationUsage(directory);
  assert.equal(collected.rows[0].stage, null);
  assert.equal(collected.rows[0].subjectFingerprint, null);
  const summary = summarizeGenerationUsage(collected);
  assert.deepEqual(Object.keys(summary.byStage), ['unknown']);
  assert.equal(summary.byStage.unknown.attempts, 1);
  assert.equal(summary.byStage.unknown.uncachedInputTokens, 4);
});

test('unallowlisted and prototype-like event stages remain unknown without leaking arbitrary fields', (t) => {
  const directory = tempDirectory(t);
  const uppercaseFingerprint = 'ABCDEF'.repeat(10) + 'ABCD';
  writeGenerationRun(directory, 'unknown-stage-run', {
    attempts: [{
      provider: 'PRIVATE PROVIDER BODY CANARY', model: 'm'.repeat(129), attempt: 1,
      stage: '__proto__', status: 'failed', failureStage: 'constructor',
      failureReason: `PRIVATE_PROVIDER_BODY_CANARY_${'x'.repeat(256)}`,
      prompt: 'ARBITRARY_STAGE_PROMPT_CANARY', providerBody: 'ARBITRARY_STAGE_BODY_CANARY',
      usage: {
        inputTokens: 9, uncachedInputTokens: 7, cachedTokens: 1, cacheWriteTokens: 1,
        outputTokens: 3, reasoningTokens: 1, totalTokens: 12, promptChars: 90,
        compactionSavedChars: 11, resultCacheStatus: 'miss', providerPromptCacheStatus: 'explicit-off'
      }
    }],
    manifest: { stage: 'test-generation', subjectFingerprint: uppercaseFingerprint }
  });

  const collected = readGenerationUsage(directory);
  assert.equal(collected.rows[0].stage, null, 'an explicitly invalid event stage must not inherit the manifest stage');
  assert.equal(collected.rows[0].subjectFingerprint, uppercaseFingerprint.toLowerCase());
  assert.equal(collected.rows[0].provider, null);
  assert.equal(collected.rows[0].model, null);
  assert.equal(collected.rows[0].failureStage, null);
  assert.equal(collected.rows[0].failureReason, null);
  const summary = summarizeGenerationUsage(collected);
  assert.deepEqual(Object.keys(summary.byStage), ['unknown']);
  assert.equal(summary.byStage.unknown.failedAttempts, summary.failedAttempts);
  assert.equal(summary.byStage.unknown.totalTokens, summary.totalTokens);
  assert.equal(summary.byStage.unknown.attemptsWithUnknownTotalTokens, summary.attemptsWithUnknownTotalTokens);
  assert.equal(summary.byStage.unknown.promptChars, summary.promptChars);
  assert.equal(summary.byStage.unknown.compactionSavedChars, summary.compactionSavedChars);
  assert.equal(summary.byStage.unknown.exactCacheMisses, summary.exactCacheMisses);
  assert.equal(summary.byStage.unknown.providerPromptCacheControls['explicit-off'], 1);
  assert.deepEqual(summary.failureStages, { provider: 1 });
  assert.doesNotMatch(
    JSON.stringify({ rows: collected.rows, summary }),
    /ARBITRARY_STAGE|providerBody|__proto__|constructor|PRIVATE_PROVIDER_BODY/
  );
});

test('environment-preflight failures stay visible in the failure-stage buckets with their reason', (t) => {
  const directory = tempDirectory(t);
  writeGenerationRun(directory, 'environment-preflight-run', {
    manifest: {
      status: 'failed',
      failureStage: 'environment-preflight',
      failureReason: 'environment-preflight'
    },
    attempts: []
  });

  const collected = readGenerationUsage(directory);
  const summary = summarizeGenerationUsage(collected);

  const run = collected.runs.find((entry) => entry.runId === 'environment-preflight-run');
  assert.equal(run.failureStage, 'environment-preflight');
  assert.equal(run.failureReason, 'environment-preflight');
  assert.deepEqual(summary.failureStages, { 'environment-preflight': 1 });
  assert.equal(summary.attempts, 0, 'a preflight-failed run must record zero provider attempts');
});
