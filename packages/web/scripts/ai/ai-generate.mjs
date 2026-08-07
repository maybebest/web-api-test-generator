#!/usr/bin/env node

import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractCodeBlock, resolveEnv, runBrain, selectBrain } from './lib/ai-client.mjs';
import { buildGenerationInput } from './lib/generation-input.mjs';
import {
  GENERATION_POLICY_VERSION,
  PLAYWRIGHT_GENERATION_POLICY
} from './lib/generation-policy.mjs';
import { RECORDING_GENERATION_POLICY } from './lib/recording-generation-ir.mjs';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = path.resolve(webRoot, '..', '..');
const MAX_GENERATION_TASK_BYTES = 2 * 1024 * 1024;

export function parseArgs(args) {
  const parsed = {
    task: undefined,
    spec: undefined,
    out: undefined,
    contextTarget: undefined,
    mode: undefined,
    domArtifact: undefined,
    draftOnly: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--out') {
      parsed.out = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--spec') {
      parsed.spec = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--mode') {
      parsed.mode = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--dom-artifact') {
      parsed.domArtifact = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--context-target') {
      parsed.contextTarget = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--draft-only') {
      parsed.draftOnly = true;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    if (!parsed.task) {
      parsed.task = arg;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return parsed;
}

export function loadGenerationPrompt({
  taskPath,
  specPath,
  out,
  mode,
  domArtifactPath,
  packageRoot = webRoot
}) {
  if (taskPath && specPath) {
    throw new Error('Provide either a generation task or --spec, not both.');
  }
  if (specPath) {
    const generationInput = buildGenerationInput({
      specPath,
      targetTestFile: out,
      domArtifactPath,
      mode,
      webRoot: packageRoot
    });
    return {
      prompt: generationInput.prompt,
      promptPath: specPath,
      generationInput,
      stage: 'test-generation',
      systemPrompt: PLAYWRIGHT_GENERATION_POLICY,
      generationFingerprint: generationInput.ir.fingerprint,
      contextFingerprint: generationInput.contextPack.fingerprint,
      cacheIdentityPrompt: generationInput.cacheIdentityPrompt,
      currentTargetSha256: generationInput.contextPack.existingTarget.sha256
    };
  }
  if (!taskPath) {
    throw new Error('Missing generation task or --spec input.');
  }
  if (!fs.existsSync(taskPath)) {
    throw new Error(`Input file does not exist: ${taskPath}`);
  }
  const taskStat = fs.lstatSync(taskPath);
  if (taskStat.isSymbolicLink()) {
    throw new Error(`Generation task must not be a symbolic link: ${taskPath}`);
  }
  if (!taskStat.isFile()) {
    throw new Error(`Generation task must be a regular file: ${taskPath}`);
  }
  if (taskStat.size > MAX_GENERATION_TASK_BYTES) {
    throw new Error(`Generation task exceeds the ${MAX_GENERATION_TASK_BYTES} bytes safety limit: ${taskPath}`);
  }
  const prompt = fs.readFileSync(taskPath, 'utf8');
  const manifest = readTaskManifest(taskPath);
  const isFlowTask = /^#\s+Codex Generation Task:/m.test(prompt) || isFlowGenerationManifest(manifest);
  if (isFlowTask) {
    return loadSavedFlowGenerationPrompt({
      taskPath,
      manifest,
      out,
      mode,
      packageRoot
    });
  }
  const isRecording = /^#\s+Codex Recording Generation Task:/m.test(prompt);
  const fingerprints = readTaskManifestFingerprints(taskPath);
  return {
    prompt,
    promptPath: taskPath,
    generationInput: null,
    stage: isRecording ? 'recording-generation' : 'test-generation',
    systemPrompt: isRecording ? RECORDING_GENERATION_POLICY : undefined,
    ...fingerprints
  };
}

function readTaskManifest(taskPath) {
  const manifestPath = path.join(path.dirname(path.resolve(taskPath)), 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  const stat = fs.lstatSync(manifestPath);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1024 * 1024) {
    throw new Error('Generation task manifest must be a bounded regular file, not a symbolic link.');
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error('top level must be an object');
    }
    return manifest;
  } catch (error) {
    throw new Error(`Generation task manifest is not valid JSON: ${error.message}`);
  }
}

function isFlowGenerationManifest(manifest) {
  return !!manifest && (
    typeof manifest.specPath === 'string'
    || typeof manifest.generationMode === 'string'
    || typeof manifest.providerInputPath === 'string'
  );
}

function requiredManifestText(manifest, field) {
  const value = manifest?.[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Saved flow generation manifest requires ${field}; regenerate the task.`);
  }
  return value.trim();
}

function sameWorkspacePath(left, right, packageRoot) {
  const resolve = (value) => path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(packageRoot, value);
  return resolve(left) === resolve(right);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function loadSavedFlowGenerationPrompt({ taskPath, manifest, out, mode, packageRoot }) {
  if (!manifest) {
    throw new Error('Saved flow generation task requires a manifest; regenerate the task.');
  }
  const specPath = requiredManifestText(manifest, 'specPath');
  const targetTestFile = requiredManifestText(manifest, 'targetTestFile');
  const generationMode = requiredManifestText(manifest, 'generationMode');
  const providerInputName = requiredManifestText(manifest, 'providerInputPath');
  const providerInputSha256 = requiredManifestText(manifest, 'providerInputSha256');
  const agentTaskSha256 = requiredManifestText(manifest, 'agentTaskSha256');
  const policyVersion = requiredManifestText(manifest, 'policyVersion');
  const generationFingerprint = requiredManifestText(manifest, 'generationFingerprint');
  const contextFingerprint = requiredManifestText(manifest, 'contextFingerprint');
  const expectedSpecSha256 = requiredManifestText(manifest, 'specSha256');

  if (!out || !sameWorkspacePath(out, targetTestFile, packageRoot)) {
    throw new Error(`Saved flow generation target mismatch: expected ${targetTestFile}.`);
  }
  if (!['single', 'suite'].includes(generationMode) || (mode && mode !== generationMode)) {
    throw new Error(`Saved flow generation mode mismatch: expected ${generationMode}.`);
  }
  if (policyVersion !== GENERATION_POLICY_VERSION) {
    throw new Error(`Saved flow generation policy version is stale: expected ${GENERATION_POLICY_VERSION}.`);
  }
  for (const [label, fingerprint] of [
    ['agent task sha256', agentTaskSha256],
    ['provider input sha256', providerInputSha256],
    ['spec hash', expectedSpecSha256],
    ['generation fingerprint', generationFingerprint],
    ['context fingerprint', contextFingerprint]
  ]) {
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
      throw new Error(`Saved flow generation ${label} must be a SHA-256 digest.`);
    }
  }
  if (!Number.isSafeInteger(manifest.providerInputBytes) || manifest.providerInputBytes < 1) {
    throw new Error('Saved flow generation provider input bytes must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(manifest.agentTaskBytes) || manifest.agentTaskBytes < 1) {
    throw new Error('Saved flow generation agent task bytes must be a positive safe integer.');
  }
  if (path.isAbsolute(providerInputName) || path.basename(providerInputName) !== providerInputName) {
    throw new Error('Saved flow generation provider input path must name a sibling file.');
  }

  const taskDirectory = path.dirname(path.resolve(taskPath));
  const taskStat = fs.lstatSync(taskPath);
  if (taskStat.size !== manifest.agentTaskBytes) {
    throw new Error('Saved flow generation agent task bytes do not match the manifest.');
  }
  const agentTask = fs.readFileSync(taskPath, 'utf8');
  if (sha256(agentTask) !== agentTaskSha256) {
    throw new Error('Saved flow generation agent task sha256 does not match the manifest.');
  }
  const providerInputPath = path.join(taskDirectory, providerInputName);
  if (!fs.existsSync(providerInputPath)) {
    throw new Error('Saved flow generation provider input artifact is missing; regenerate the task.');
  }
  const providerStat = fs.lstatSync(providerInputPath);
  if (providerStat.isSymbolicLink() || !providerStat.isFile() || providerStat.size > MAX_GENERATION_TASK_BYTES) {
    throw new Error('Saved flow generation provider input must be a bounded regular file, not a symbolic link.');
  }
  if (providerStat.size !== manifest.providerInputBytes) {
    throw new Error('Saved flow generation provider input bytes do not match the manifest.');
  }
  const prompt = fs.readFileSync(providerInputPath, 'utf8');
  if (sha256(prompt) !== providerInputSha256) {
    throw new Error('Saved flow generation provider input sha256 does not match the manifest.');
  }

  const sourceSpecPath = path.isAbsolute(specPath) ? path.resolve(specPath) : path.resolve(packageRoot, specPath);
  if (!fs.existsSync(sourceSpecPath)) {
    throw new Error(`Saved flow generation spec no longer exists: ${specPath}.`);
  }
  const sourceStat = fs.lstatSync(sourceSpecPath);
  if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
    throw new Error(`Saved flow generation spec must be a regular non-symlink file: ${specPath}.`);
  }
  const savedDomArtifact = manifest.domDiscoveryArtifact
    ? (path.isAbsolute(manifest.domDiscoveryArtifact)
      ? path.resolve(manifest.domDiscoveryArtifact)
      : path.resolve(packageRoot, manifest.domDiscoveryArtifact))
    : undefined;
  const generationInput = buildGenerationInput({
    specPath,
    specFilePath: sourceSpecPath,
    targetTestFile,
    domArtifactPath: savedDomArtifact,
    mode: generationMode,
    webRoot: packageRoot
  });
  if (generationInput.specSha256 !== expectedSpecSha256) {
    throw new Error('Saved flow generation spec hash no longer matches the current behavioral spec.');
  }
  if (generationInput.ir.fingerprint !== generationFingerprint) {
    throw new Error('Saved flow generation generation fingerprint no longer matches current inputs.');
  }
  if (generationInput.contextPack.fingerprint !== contextFingerprint) {
    throw new Error('Saved flow generation context fingerprint no longer matches current repository evidence.');
  }
  if (generationInput.agentTask !== agentTask) {
    throw new Error('Saved flow generation agent task is not current; regenerate the task.');
  }
  if (generationInput.prompt !== prompt) {
    throw new Error('Saved flow generation provider input is not the current canonical prompt; regenerate the task.');
  }

  return {
    prompt,
    promptPath: providerInputPath,
    generationInput,
    stage: 'test-generation',
    systemPrompt: PLAYWRIGHT_GENERATION_POLICY,
    generationFingerprint,
    contextFingerprint,
    cacheIdentityPrompt: generationInput.cacheIdentityPrompt,
    currentTargetSha256: generationInput.contextPack.existingTarget.sha256
  };
}

function readTaskManifestFingerprints(taskPath) {
  const manifestPath = path.join(path.dirname(path.resolve(taskPath)), 'manifest.json');
  if (!fs.existsSync(manifestPath)) return { generationFingerprint: null, contextFingerprint: null };
  try {
    const stat = fs.lstatSync(manifestPath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1024 * 1024) {
      return { generationFingerprint: null, contextFingerprint: null };
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const fingerprint = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
    return {
      generationFingerprint: fingerprint(manifest.generationFingerprint),
      contextFingerprint: fingerprint(manifest.contextFingerprint)
    };
  } catch {
    return { generationFingerprint: null, contextFingerprint: null };
  }
}

export function resolveOutputPath(out, packageRoot = webRoot) {
  if (!out || !String(out).trim()) {
    throw new Error('Missing --out target.');
  }

  const raw = String(out).trim();
  const packageCandidate = path.resolve(packageRoot, raw);
  const repoCandidate = path.resolve(repoRoot, raw);
  let resolved = path.isAbsolute(raw) ? path.resolve(raw) : packageCandidate;

  if (!path.isAbsolute(raw) && pathInside(repoCandidate, packageRoot)) {
    resolved = repoCandidate;
  }

  const testsRoot = path.join(packageRoot, 'tests');
  if (!pathInside(resolved, packageRoot)) {
    throw new Error(`Refusing to write generated test outside packages/web: ${raw}`);
  }
  if (!pathInside(resolved, testsRoot)) {
    throw new Error(`Generated test output must stay under packages/web/tests: ${raw}`);
  }
  if (!resolved.endsWith('.spec.ts')) {
    throw new Error(`Generated test output must end with .spec.ts: ${raw}`);
  }

  return resolved;
}

function pathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function generationUsageRecord(usage, brain) {
  return usage ? {
    schemaVersion: usage.schemaVersion ?? 'generation-usage/v1',
    provider: usage.provider ?? brain.kind,
    requestId: usage.requestId ?? null,
    responseId: usage.responseId ?? null,
    serviceTier: usage.serviceTier ?? null,
    inputTokens: usage.inputTokens ?? null,
    uncachedInputTokens: usage.uncachedInputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    cachedTokens: usage.cachedTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    reasoningTokens: usage.reasoningTokens ?? 0,
    totalTokens: usage.totalTokens ?? null,
    retryCount: usage.retryCount ?? 0,
    retryTokens: usage.retryTokens ?? null,
    requestCount: usage.requestCount ?? null,
    successfulRequests: usage.successfulRequests ?? null,
    latencyMs: usage.latencyMs ?? null,
    resultCacheHit: usage.resultCacheHit ?? false,
    savedTokens: usage.savedTokens ?? 0,
    sourceTotalTokens: usage.sourceTotalTokens ?? null,
    originalPromptChars: usage.originalPromptChars ?? null,
    promptChars: usage.promptChars ?? null,
    systemPromptChars: usage.systemPromptChars ?? null,
    compactedPromptChars: usage.compactedPromptChars ?? null,
    compactionSavedChars: usage.compactionSavedChars ?? null
  } : null;
}

function generationRunLink(runId) {
  if (runId === undefined || runId === null) return null;
  if (typeof runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(runId)) {
    throw new Error('Generation run id must contain only letters, numbers, and hyphens (1-64 characters).');
  }
  return runId;
}

function generationRecord({ outPath, brain, usage, completedAt, runId }) {
  const linkedRunId = generationRunLink(runId);
  return {
    ...(linkedRunId ? { runId: linkedRunId } : {}),
    brain: brain.kind,
    model: brain.model ?? null,
    outPath,
    completedAt: completedAt.toISOString(),
    usage: generationUsageRecord(usage, brain)
  };
}

// Records the generation outcome (brain, model, token usage) into the run manifest
// that create-generation-task.mjs wrote next to the task file, when one exists.
// Adding the `generation` key is additive: the gates only read specPath/specSha256.
export function recordGenerationInManifest({ promptPath, outPath, brain, usage, runId, now = () => new Date() }) {
  const manifestPath = path.join(path.dirname(path.resolve(promptPath)), 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return false;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.generation = generationRecord({ outPath, brain, usage, runId, completedAt: now() });
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return true;
  } catch (error) {
    console.error(`Warning: could not update run manifest ${manifestPath}: ${error.message}`);
    return false;
  }
}

// Direct --spec generation has no sibling task manifest. Persist the same safe,
// prompt-free telemetry under the ignored .ai-runs tree so every REST call remains
// auditable and `ai:tokens:report` can enforce budgets.
export function recordStandaloneGenerationManifest({
  promptPath,
  outPath,
  brain,
  usage,
  runId,
  telemetryRoot = path.join(webRoot, '.ai-runs', 'usage'),
  now = () => new Date(),
  id = () => randomUUID()
}) {
  const completedAt = now();
  const recordId = id();
  if (typeof recordId !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(recordId)) {
    throw new Error('Standalone generation telemetry id must contain only letters, numbers, and hyphens.');
  }
  const directory = path.join(path.resolve(telemetryRoot), `${completedAt.toISOString().replaceAll(':', '-')}-${recordId}`);
  const manifestPath = path.join(directory, 'manifest.json');
  const manifest = {
    schemaVersion: 'standalone-generation/v1',
    promptFile: path.basename(promptPath),
    generation: generationRecord({ outPath, brain, usage, runId, completedAt })
  };

  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(manifestPath, 0o600);
  return manifestPath;
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/ai-generate.mjs <generation-task.md> --out <target.spec.ts> --draft-only
  node scripts/ai/ai-generate.mjs --spec <spec.md> --out <target.spec.ts> --draft-only [--mode single|suite] [--dom-artifact <selector-candidates.json>]

Validates a saved --spec and builds the canonical provider input (or verifies the
manifest-bound provider input beside an explicit flow generation task), runs the selected AI brain,
extracts the fenced \`\`\`ts code block, and writes it to --out (creating parent
directories). Saved Playwright flow tasks use the same stable policy and output contract
for REST and CLI brains as direct --spec generation. Environment variables are read from the
real environment first, then <repo>/.env (real environment wins).
Run \`npm run ai:brain:doctor\` to see which brain is selected and why.`);
}

// Generates and validates source without touching the destination. The verified
// orchestrator uses this seam to gate a sibling candidate before atomically
// replacing the requested target.
export async function generateTestSource({
  taskPath,
  specPath,
  out,
  promptTarget = out,
  mode,
  domArtifactPath,
  packageRoot = webRoot,
  resolvedEnv,
  signal,
  runBrainImpl = runBrain,
  selectBrainImpl = selectBrain,
  onAttempt
}) {
  const outPath = resolveOutputPath(out, packageRoot);
  const promptRequest = loadGenerationPrompt({
    taskPath,
    specPath,
    out: promptTarget,
    mode,
    domArtifactPath,
    packageRoot
  });
  const resolved = resolvedEnv ?? resolveEnv();
  const selectedBrain = selectBrainImpl(resolved.env, { stage: promptRequest.stage });
  if (selectedBrain.kind === 'none') {
    throw new Error(
      'No AI brain available: set ANTHROPIC_API_KEY or OPENAI_API_KEY (environment or .env), or install the claude or codex CLI.'
    );
  }

  const result = await runBrainImpl(promptRequest.prompt, {
    env: resolved.env,
    signal,
    stage: promptRequest.stage,
    contextFingerprint: promptRequest.contextFingerprint ?? null,
    generationFingerprint: promptRequest.generationFingerprint ?? null,
    cacheIdentityPrompt: promptRequest.cacheIdentityPrompt,
    ...(Object.hasOwn(promptRequest, 'currentTargetSha256')
      ? { currentTargetSha256: promptRequest.currentTargetSha256 }
      : {}),
    onAttempt,
    ...(promptRequest.systemPrompt ? { systemPrompt: promptRequest.systemPrompt } : {})
  });
  const code = extractCodeBlock(result.text);

  return {
    code: code.endsWith('\n') ? code : `${code}\n`,
    outPath,
    promptPath: promptRequest.promptPath,
    promptRequest,
    result
  };
}

async function runCli() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    printHelp();
    process.exit(1);
  }

  if (!(args.task ?? args.spec) || !args.out) {
    printHelp();
    process.exit(1);
  }
  if (!args.draftOnly) {
    console.error('Direct target writes require explicit --draft-only. Use ai:brain:generate for verified candidate generation and atomic promotion.');
    process.exit(1);
  }

  let generation;
  try {
    generation = await generateTestSource({
      taskPath: args.task,
      specPath: args.spec,
      out: args.out,
      promptTarget: args.contextTarget ?? args.out,
      mode: args.mode,
      domArtifactPath: args.domArtifact
    });
  } catch (error) {
    console.error(`AI generation failed: ${error.message}`);
    process.exit(1);
  }

  const { code, outPath, promptPath, result } = generation;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, code);

  const manifestUpdated = recordGenerationInManifest({
    promptPath,
    outPath: args.out,
    brain: result.brain,
    usage: result.usage
  });
  if (!manifestUpdated) {
    recordStandaloneGenerationManifest({
      promptPath,
      outPath: args.out,
      brain: result.brain,
      usage: result.usage
    });
  }

  console.log(`Generated test written via ${result.brain.kind}: ${args.out}`);
  console.log('');
  console.log('Next steps:');
  console.log('- Run `npm run ai:test:review` for the automated spec/quality analysis.');
  console.log('- Run `npm run ai:test:gate` to execute the full machine quality gate.');
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli();
}
