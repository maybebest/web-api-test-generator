import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildCodexImprovementPrompt } from '../ai/promptBuilder.js';
import { analyzeEntriesForCodex } from '../ai/analyzer.js';
import { mergeConfig } from '../config/defaultConfig.js';
import { filterHarEntries } from '../har/filters.js';
import { normalizeHarEntries } from '../har/normalizer.js';
import { parseHarInputs } from '../har/parser.js';
import type {
  CliGenerateOptions,
  GenerationSummary,
  GenerationLlmUsage,
  GenerationTimings,
  HarApiTestConfig
} from '../types/config.js';
import type { CalibrationOverride } from '../types/testCase.js';
import {
  createGeneratedOutputStagingDir,
  discardGeneratedOutputStagingDir,
  publishGeneratedOutput,
  readVerifiedGeneratedOutputMarker,
  writeGeneratedOutputMarker
} from '../utils/generatedOutput.js';
import { writeJsonFile, writeTextFile } from '../utils/fileSystem.js';
import { buildGenerationProvenance } from '../utils/provenance.js';
import { planGeneratedTests } from './testPlanner.js';
import { writeGeneratedTests } from './testGenerator.js';

// Committed default so CI regeneration drift checks pick up calibration without extra flags.
const defaultCalibrationOverridesFile = 'config/calibration-overrides.json';

export async function generateFromHar(
  options: CliGenerateOptions,
  config: HarApiTestConfig
): Promise<GenerationSummary> {
  const totalStartedAt = performance.now();
  const timings = emptyTimings();
  const mergedConfig = mergeConfig(config);
  // CLI --preserve-duplicate-query-params wins over the config value when explicitly given. mergeConfig
  // returns a fresh `generation` object, so this override does not mutate the shared defaultConfig.
  if (options.preserveDuplicateQueryParams !== undefined) {
    mergedConfig.generation.preserveDuplicateQueryParams = options.preserveDuplicateQueryParams;
  }
  const generationOptions = {
    modes: options.generationModes ?? mergedConfig.generation.modes,
    inferenceLevel: options.inferenceLevel ?? mergedConfig.generation.inferenceLevel,
    inferredRunMode: options.inferredRunMode ?? mergedConfig.generation.inferredRunMode,
    negativeStatusPolicy: options.negativeStatusPolicy ?? mergedConfig.generation.negativeStatusPolicy,
    mutationPolicy: options.mutationPolicy ?? mergedConfig.generation.mutationPolicy
  };
  let phaseStartedAt = performance.now();
  const parsedEntries = await parseHarInputs(options.harInputs);
  timings.parseMs = elapsedMs(phaseStartedAt);

  phaseStartedAt = performance.now();
  const filteredEntries = filterHarEntries(parsedEntries, mergedConfig, {
    include: options.include,
    exclude: options.exclude,
    ignoredDomains: options.ignoredDomains,
    firstPartyDomains: options.firstPartyDomains,
    methods: options.methods,
    statuses: options.statuses
  });
  timings.filterMs = elapsedMs(phaseStartedAt);

  phaseStartedAt = performance.now();
  const normalizedEntries = normalizeHarEntries(filteredEntries, mergedConfig, options.baseUrl);
  timings.normalizeMs = elapsedMs(phaseStartedAt);

  phaseStartedAt = performance.now();
  const calibration = await loadCalibrationOverrides(options.calibrationOverridesPath);
  timings.calibrationMs = elapsedMs(phaseStartedAt);

  phaseStartedAt = performance.now();
  const provenance = await buildGenerationProvenance({
    harInputs: options.harInputs,
    config: mergedConfig,
    options,
    calibration
  });
  timings.provenanceMs = elapsedMs(phaseStartedAt);

  phaseStartedAt = performance.now();
  const testPlan = planGeneratedTests(normalizedEntries, mergedConfig, {
    ...generationOptions,
    calibrationOverrides: calibration.overrides
  });
  timings.planMs = elapsedMs(phaseStartedAt);
  const generatedFiles: string[] = [];
  const generatedTestCount = testPlan.endpointCases.length + testPlan.scenarioCases.length;

  const smokeCases = testPlan.endpointCases.filter((testCase) => testCase.category === 'smoke');
  if (smokeCases.length > 0 && smokeCases.every((testCase) => testCase.responseBody === undefined)) {
    console.warn(
      '[har-api-tests] No response bodies were captured, so JSON-schema and response-field assertions are disabled. ' +
        'Re-capture HAR with response content to enable schema coverage (run-manifest schemaCoverage="none").'
    );
  }

  let publication: GenerationSummary['publication'] = 'dry-run';
  if (!options.dryRun) {
    if (generatedTestCount === 0) {
      throw new Error(
        `No tests were planned from ${parsedEntries.length} parsed HAR entr${parsedEntries.length === 1 ? 'y' : 'ies'} ` +
          `(${normalizedEntries.length} remained after filtering). Existing output was not modified. ` +
          'Check --first-party, --include, --exclude, --method, --status, and the loaded config.'
      );
    }

    phaseStartedAt = performance.now();
    const existingMarker = await readVerifiedGeneratedOutputMarker(options.outDir);
    timings.outputVerificationMs = addMs(timings.outputVerificationMs, elapsedMs(phaseStartedAt));
    if (
      existingMarker?.formatVersion === 2 &&
      existingMarker.generationFingerprintSha256 === provenance.fingerprintSha256
    ) {
      timings.totalMs = elapsedMs(totalStartedAt);
      return {
        parsedEntries: parsedEntries.length,
        filteredEntries: normalizedEntries.length,
        generatedTests: generatedTestCount,
        generatedFiles: [],
        dryRun: false,
        publication: 'unchanged',
        timings,
        llmUsage: noLlmUsage(),
        provenance
      };
    }

    phaseStartedAt = performance.now();
    const stagingDir = await createGeneratedOutputStagingDir(options.outDir);
    timings.outputVerificationMs = addMs(timings.outputVerificationMs, elapsedMs(phaseStartedAt));
    try {
      phaseStartedAt = performance.now();
      const stagedFiles = await writeGeneratedTests(testPlan, stagingDir, mergedConfig, {
        parsedEntries: parsedEntries.length,
        filteredEntries: normalizedEntries.length,
        sourceHarFiles: [...new Set(parsedEntries.map((entry) => entry.sourceFile))]
      });

      if (options.ai) {
        const analysis = analyzeEntriesForCodex(normalizedEntries);
        const analysisPath = path.join(stagingDir, 'har-analysis.json');
        const promptPath = path.join(stagingDir, 'codex-test-improvement-prompt.md');
        await writeJsonFile(analysisPath, analysis);
        await writeTextFile(promptPath, buildCodexImprovementPrompt(analysis));
        stagedFiles.push(analysisPath, promptPath);
      }
      timings.writeMs = elapsedMs(phaseStartedAt);

      phaseStartedAt = performance.now();
      stagedFiles.push(await writeGeneratedOutputMarker(stagingDir, provenance));
      timings.markerMs = elapsedMs(phaseStartedAt);

      phaseStartedAt = performance.now();
      await publishGeneratedOutput(stagingDir, options.outDir);
      timings.publishMs = elapsedMs(phaseStartedAt);
      generatedFiles.push(
        ...stagedFiles.map((file) => path.join(options.outDir, path.relative(stagingDir, file)))
      );
      publication = 'published';
    } catch (error) {
      await discardGeneratedOutputStagingDir(stagingDir);
      throw error;
    }
  }

  return {
    parsedEntries: parsedEntries.length,
    filteredEntries: normalizedEntries.length,
    generatedTests: generatedTestCount,
    generatedFiles: generatedFiles.sort(),
    dryRun: options.dryRun,
    publication,
    timings: { ...timings, totalMs: elapsedMs(totalStartedAt) },
    llmUsage: noLlmUsage(),
    provenance
  };
}

interface LoadedCalibrationOverrides {
  present: boolean;
  content?: string;
  overrides: CalibrationOverride[];
}

async function loadCalibrationOverrides(explicitPath?: string): Promise<LoadedCalibrationOverrides> {
  const resolved = explicitPath ?? path.resolve(defaultCalibrationOverridesFile);
  let content: string;
  try {
    content = await fs.readFile(resolved, 'utf8');
  } catch (error) {
    if (!explicitPath && isFileNotFound(error)) {
      return { present: false, overrides: [] };
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid calibration overrides JSON in ${resolved}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!Array.isArray(parsed) || !parsed.every(isCalibrationOverride)) {
    throw new Error(
      `Invalid calibration overrides in ${resolved}: expected an array of { title: string, hostname?: string, observedStatus: number }.`
    );
  }

  return { present: true, content, overrides: parsed };
}

function emptyTimings(): GenerationTimings {
  return {
    parseMs: 0,
    filterMs: 0,
    normalizeMs: 0,
    calibrationMs: 0,
    provenanceMs: 0,
    planMs: 0,
    outputVerificationMs: 0,
    writeMs: 0,
    markerMs: 0,
    publishMs: 0,
    totalMs: 0
  };
}

function noLlmUsage(): GenerationLlmUsage {
  return {
    mode: 'not-used',
    requests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    retries: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    retryTokens: 0,
    totalTokens: 0
  };
}

function elapsedMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 1_000) / 1_000;
}

function addMs(left: number, right: number): number {
  return Math.round((left + right) * 1_000) / 1_000;
}

function isCalibrationOverride(value: unknown): value is CalibrationOverride {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as { title?: unknown; hostname?: unknown; observedStatus?: unknown };
  return (
    typeof candidate.title === 'string' &&
    typeof candidate.observedStatus === 'number' &&
    (candidate.hostname === undefined || typeof candidate.hostname === 'string')
  );
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
