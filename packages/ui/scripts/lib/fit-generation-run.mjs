import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  isTrustedFlowSpecResult,
  resolveEnv,
  runBrain,
  selectBrain
} from '../../../web/scripts/ai/lib/ai-client.mjs';
import {
  createGenerationRun,
  finalizeGenerationRun,
  recordRunAttempt,
  recordRunEvent
} from '../../../web/scripts/ai/lib/generation-run.mjs';
import { validateSpecFile } from '../../../web/scripts/ai/validate-flow-spec.mjs';
import {
  OUTPUT_KINDS,
  decodeStructuredOutput,
  flowSpecDraftTransportChars,
  validateContractOutput
} from '../../../web/scripts/ai/lib/output-contracts.mjs';

const SAFE_FAILURE_REASONS = new Set([
  'network-error',
  'malformed-response',
  'malformed-output',
  'truncated',
  'refused',
  'empty-response',
  'single-flight-leader-failed',
  'generation-failed',
  'invalid-fit-output',
  'prompt-too-large',
  'cancelled',
  'spec-fit-failed'
]);
const DEFAULT_FIT_MAX_PROMPT_CHARS = 160_000;

function safeFailureReason(value) {
  if (SAFE_FAILURE_REASONS.has(value) || /^http-[1-5][0-9]{2}$/.test(value ?? '')) return value;
  return 'spec-fit-failed';
}

function outputFingerprint(text) {
  const outputSha256 = createHash('sha256').update(String(text), 'utf8').digest('hex');
  return createHash('sha256').update(JSON.stringify({
    policy: 'spec-fit-output/v1',
    outputSha256
  }), 'utf8').digest('hex');
}

function validateFitOutput(text) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fit-output-validation-'));
  const draftPath = path.join(directory, 'draft.md');
  try {
    fs.writeFileSync(draftPath, String(text), { mode: 0o600 });
    const validation = validateSpecFile(draftPath, { allowDraft: true });
    if (!validation.valid) {
      const error = new Error(`Fit output is not a valid flow spec: ${validation.issues.slice(0, 8).join('; ')}`);
      error.failureReason = 'invalid-fit-output';
      throw error;
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

// REST brains are decoded by ai-client. This defensive branch keeps the fit
// boundary semantic when an injected runner returns the provider JSON
// directly: decode first, then render through the sole Markdown formatter,
// then validate the resulting spec before it leaves the run.
function renderAndValidateFitOutput(result) {
  const value = result?.text;
  const raw = String(value ?? '').trim();
  const isSemanticJson = raw.startsWith('{');
  if (!isSemanticJson && !isTrustedFlowSpecResult(result)) {
    const error = new Error('Fit output must be semantic JSON or Markdown rendered by the trusted flow-spec formatter.');
    error.failureReason = 'invalid-fit-output';
    throw error;
  }
  const rendered = isSemanticJson
    ? decodeStructuredOutput(raw, OUTPUT_KINDS.flowSpecDraft)
    : validateContractOutput(raw, OUTPUT_KINDS.flowSpecDraft);
  validateFitOutput(rendered);
  return rendered;
}

function attemptStatus(error) {
  if (error?.failureReason === 'truncated') return 'truncated';
  if (error?.failureReason === 'refused') return 'refused';
  if (error?.failureReason === 'malformed-output') return 'malformed';
  return 'failed';
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function enforceFitPromptBudget(request, env, { isCli = false } = {}) {
  const fitLimit = positiveInteger(env?.AI_SPEC_FIT_MAX_PROMPT_CHARS);
  const sharedLimit = positiveInteger(env?.AI_MAX_PROMPT_CHARS);
  const maxChars = fitLimit ?? sharedLimit ?? DEFAULT_FIT_MAX_PROMPT_CHARS;
  const setting = fitLimit !== null
    ? 'AI_SPEC_FIT_MAX_PROMPT_CHARS'
    : sharedLimit !== null ? 'AI_MAX_PROMPT_CHARS' : 'default fit input limit';
  const inputChars = flowSpecDraftTransportChars({
    prompt: request?.prompt,
    systemPrompt: request?.systemPrompt,
    isCli
  });
  if (inputChars > maxChars) {
    throw Object.assign(
      new Error(
        `Fit input is ${inputChars} characters, above ${setting}=${maxChars}. ` +
        'Reduce or split the source notes before generating.'
      ),
      { failureReason: 'prompt-too-large' }
    );
  }
}

function recordFallbackResult(run, result) {
  const usage = result?.usage ?? null;
  if (usage?.resultCacheHit === true || usage?.resultCacheStatus === 'single-flight-join') {
    recordRunEvent(run, {
      type: 'result-cache',
      stage: 'spec-fit',
      status: 'completed',
      durationMs: usage.latencyMs,
      provider: result?.brain?.kind,
      model: result?.brain?.model,
      usage
    });
    return;
  }
  recordRunAttempt(run, {
    provider: result?.brain?.kind ?? usage?.provider ?? 'unknown',
    model: result?.brain?.model ?? usage?.model ?? 'unknown',
    stage: 'spec-fit',
    attempt: 1,
    status: 'succeeded',
    durationMs: usage?.latencyMs,
    usage
  });
}

export async function runFitGeneration({
  request,
  processEnv = process.env,
  telemetryRoot = undefined,
  runId = undefined,
  now = undefined,
  signal = undefined,
  resolveEnvImpl = resolveEnv,
  runBrainImpl = runBrain,
  onTelemetryError = (message) => console.error(message)
}) {
  const run = createGenerationRun({ telemetryRoot, runId, stage: 'spec-fit', now });
  let recordedAttempts = 0;
  let providerCallStarted = false;
  let providerCallCompleted = false;
  const bestEffortTelemetry = (label, operation) => {
    try {
      return operation();
    } catch {
      try {
        onTelemetryError(`[fit-runner] telemetry incomplete during ${label}; preserving the provider result.`);
      } catch {
        // Telemetry and its diagnostic hook are both secondary to an already
        // paid, deterministically validated provider result.
      }
      return undefined;
    }
  };
  const onAttempt = (attempt) => {
    const recorded = bestEffortTelemetry('provider-attempt', () => recordRunAttempt(run, {
      ...attempt,
      ...(attempt?.failureReason ? { failureReason: safeFailureReason(attempt.failureReason) } : {})
    }));
    if (recorded) recordedAttempts += 1;
  };

  try {
    recordRunEvent(run, { type: 'stage', stage: 'spec-fit', status: 'started' });
    const { env } = resolveEnvImpl(processEnv);
    const selectedBrain = runBrainImpl === runBrain ? selectBrain(env, { stage: 'spec-fit' }) : null;
    enforceFitPromptBudget(request, env, {
      isCli: selectedBrain?.kind === 'claude-cli' || selectedBrain?.kind === 'codex-cli'
    });
    // REST providers report attempts at the actual fetch boundary. CLI brains
    // cannot expose usage callbacks, so mark only a successfully selected CLI
    // as potentially metered before entering its synchronous spawn. This
    // avoids classifying configuration/no-brain failures as paid attempts.
    providerCallStarted = runBrainImpl !== runBrain || ['claude-cli', 'codex-cli'].includes(selectedBrain?.kind);
    const result = await runBrainImpl(request.prompt, {
      env,
      signal,
      systemPrompt: request.systemPrompt,
      outputKind: 'flow-spec-draft',
      stage: 'spec-fit',
      onAttempt
    });
    providerCallCompleted = true;
    if (recordedAttempts === 0) {
      bestEffortTelemetry('provider-result', () => recordFallbackResult(run, result));
    }
    const text = renderAndValidateFitOutput(result);
    bestEffortTelemetry('fit-stage-completion', () => recordRunEvent(run, {
      type: 'stage', stage: 'spec-fit', status: 'completed'
    }));
    bestEffortTelemetry('fit-run-finalization', () => finalizeGenerationRun(run, {
      status: 'succeeded',
      quality: {
        reviewPassed: null,
        fastGatePassed: null,
        fullGatePassed: null,
        qualityFingerprint: outputFingerprint(text),
        repairCount: 0
      }
    }));
    return {
      text,
      brain: { kind: result.brain?.kind, model: result.brain?.model ?? null },
      usage: result.usage ?? null,
      runId: run.runId
    };
  } catch (error) {
    const failureReason = signal?.aborted || error?.name === 'AbortError'
      ? 'cancelled'
      : safeFailureReason(error?.failureReason);
    if (
      recordedAttempts === 0
      && providerCallStarted
      && !providerCallCompleted
    ) {
      bestEffortTelemetry('failed-provider-attempt', () => recordRunAttempt(run, {
        provider: error.provider ?? error.brain?.kind ?? error.usage?.provider ?? 'unknown',
        model: error.model ?? error.brain?.model ?? error.usage?.model ?? 'unknown',
        stage: 'spec-fit',
        attempt: 1,
        status: attemptStatus(error),
        usage: error.usage ?? null,
        failureStage: 'provider',
        failureReason
      }));
    }
    bestEffortTelemetry('fit-stage-failure', () => recordRunEvent(run, {
      type: 'stage',
      stage: 'spec-fit',
      status: 'failed',
      failureStage: 'spec-fit',
      failureReason
    }));
    bestEffortTelemetry('failed-fit-run-finalization', () => finalizeGenerationRun(run, {
      status: 'failed',
      failureStage: 'spec-fit',
      failureReason,
      quality: {
        reviewPassed: null,
        fastGatePassed: null,
        fullGatePassed: null,
        qualityFingerprint: null,
        repairCount: 0
      }
    }));
    throw error;
  }
}
