import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCodexImprovementPrompt } from '../ai/promptBuilder.js';
import { analyzeEntriesForCodex } from '../ai/analyzer.js';
import { mergeConfig } from '../config/defaultConfig.js';
import { filterHarEntries } from '../har/filters.js';
import { normalizeHarEntries } from '../har/normalizer.js';
import { parseHarInputs } from '../har/parser.js';
import type { CliGenerateOptions, GenerationSummary, HarApiTestConfig } from '../types/config.js';
import type { CalibrationOverride } from '../types/testCase.js';
import { ensureDir, removeGeneratedOutput, writeJsonFile, writeTextFile } from '../utils/fileSystem.js';
import { planGeneratedTests } from './testPlanner.js';
import { writeGeneratedTests } from './testGenerator.js';

// Committed default so CI regeneration drift checks pick up calibration without extra flags.
const defaultCalibrationOverridesFile = 'config/calibration-overrides.json';

export async function generateFromHar(
  options: CliGenerateOptions,
  config: HarApiTestConfig
): Promise<GenerationSummary> {
  const mergedConfig = mergeConfig(config);
  // CLI --preserve-duplicate-query-params wins over the config value when explicitly given. mergeConfig
  // returns a fresh `generation` object, so this override does not mutate the shared defaultConfig.
  if (options.preserveDuplicateQueryParams !== undefined) {
    mergedConfig.generation.preserveDuplicateQueryParams = options.preserveDuplicateQueryParams;
  }
  const parsedEntries = await parseHarInputs(options.harInputs);
  const filteredEntries = filterHarEntries(parsedEntries, mergedConfig, {
    include: options.include,
    exclude: options.exclude,
    ignoredDomains: options.ignoredDomains,
    firstPartyDomains: options.firstPartyDomains,
    methods: options.methods,
    statuses: options.statuses
  });
  const normalizedEntries = normalizeHarEntries(filteredEntries, mergedConfig, options.baseUrl);
  const calibrationOverrides = await loadCalibrationOverrides(options.calibrationOverridesPath);
  const testPlan = planGeneratedTests(normalizedEntries, mergedConfig, {
    modes: options.generationModes,
    inferenceLevel: options.inferenceLevel,
    inferredRunMode: options.inferredRunMode,
    negativeStatusPolicy: options.negativeStatusPolicy,
    mutationPolicy: options.mutationPolicy,
    calibrationOverrides
  });
  const generatedFiles: string[] = [];

  const smokeCases = testPlan.endpointCases.filter((testCase) => testCase.category === 'smoke');
  if (smokeCases.length > 0 && smokeCases.every((testCase) => testCase.responseBody === undefined)) {
    console.warn(
      '[har-api-tests] No response bodies were captured, so JSON-schema and response-field assertions are disabled. ' +
        'Re-capture HAR with response content to enable schema coverage (run-manifest schemaCoverage="none").'
    );
  }

  if (!options.dryRun) {
    await removeGeneratedOutput(options.outDir);
    await ensureDir(options.outDir);
    generatedFiles.push(
      ...(await writeGeneratedTests(testPlan, options.outDir, mergedConfig, {
        parsedEntries: parsedEntries.length,
        filteredEntries: normalizedEntries.length,
        sourceHarFiles: [...new Set(parsedEntries.map((entry) => entry.sourceFile))]
      }))
    );

    if (options.ai) {
      const analysis = analyzeEntriesForCodex(normalizedEntries);
      const analysisPath = path.join(options.outDir, 'har-analysis.json');
      const promptPath = path.join(options.outDir, 'codex-test-improvement-prompt.md');
      await writeJsonFile(analysisPath, analysis);
      await writeTextFile(promptPath, buildCodexImprovementPrompt(analysis));
      generatedFiles.push(analysisPath, promptPath);
    }
  }

  return {
    parsedEntries: parsedEntries.length,
    filteredEntries: normalizedEntries.length,
    generatedTests: testPlan.endpointCases.length + testPlan.scenarioCases.length,
    generatedFiles: generatedFiles.sort(),
    dryRun: options.dryRun
  };
}

async function loadCalibrationOverrides(explicitPath?: string): Promise<CalibrationOverride[]> {
  const resolved = explicitPath ?? path.resolve(defaultCalibrationOverridesFile);
  let content: string;
  try {
    content = await fs.readFile(resolved, 'utf8');
  } catch (error) {
    if (!explicitPath && isFileNotFound(error)) {
      return [];
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

  return parsed;
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
