import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CliGenerateOptions, HarApiTestConfig } from '../types/config.js';
import type { SupportedHttpMethod } from '../types/har.js';
import type {
  GenerationMode,
  InferenceLevel,
  InferredRunMode,
  MutationPolicy,
  NegativeStatusPolicy
} from '../types/testCase.js';

const supportedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
// New modes are smoke/extended; legacy replay/inferred/scenario are accepted as aliases.
const generationModeAliases: Record<string, GenerationMode> = {
  smoke: 'smoke',
  extended: 'extended',
  replay: 'smoke',
  inferred: 'extended',
  scenario: 'extended'
};
const supportedInferenceLevels = new Set(['conservative', 'balanced', 'aggressive']);
const supportedRunModes = new Set(['mixed', 'all-active', 'replay-only']);
const supportedNegativeStatusPolicies = new Set(['family', 'strict', 'config']);
const supportedMutationPolicies = new Set(['guarded', 'all-skipped', 'all-active']);

export function parseCliArgs(argv: string[]): CliGenerateOptions {
  const values: Record<string, string[]> = {};
  const flags = new Set<string>();
  const positionalArgs: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positionalArgs.push(arg);
      continue;
    }

    const [rawName, inlineValue] = arg.slice(2).split(/=(.*)/s);
    const name = camelCase(rawName);

    if (inlineValue !== undefined && inlineValue !== '') {
      values[name] = [...(values[name] ?? []), inlineValue];
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      values[name] = [...(values[name] ?? []), next];
      index += 1;
      continue;
    }

    flags.add(name);
  }

  if (positionalArgs.length > 0) {
    throw new Error(`Unexpected positional argument: ${positionalArgs[0]}`);
  }

  const harInputs = collect(values.har);
  if (harInputs.length === 0) {
    throw new Error('Missing required --har option.');
  }

  const calibrationPath = first(values.calibration);

  return {
    harInputs,
    outDir: path.resolve(first(values.out) ?? './tests/generated'),
    baseUrl: first(values.baseUrl),
    include: collect(values.include),
    exclude: collect(values.exclude),
    ignoredDomains: collect(values.ignoreDomain),
    firstPartyDomains: collect(values.firstParty),
    methods: collect(values.method).map(normalizeMethod),
    statuses: collect(values.status).map(normalizeStatus),
    generationModes: [...new Set(collect(values.generationMode, ['smoke', 'extended']).map(normalizeGenerationMode))],
    inferenceLevel: normalizeInferenceLevel(first(values.inferenceLevel) ?? 'balanced'),
    inferredRunMode: normalizeInferredRunMode(first(values.inferredRunMode) ?? 'mixed'),
    negativeStatusPolicy: normalizeNegativeStatusPolicy(first(values.negativeStatusPolicy) ?? 'family'),
    mutationPolicy: normalizeMutationPolicy(first(values.mutationPolicy) ?? 'guarded'),
    ai: flags.has('ai') || first(values.ai) === 'true',
    dryRun: flags.has('dryRun') || first(values.dryRun) === 'true',
    preserveDuplicateQueryParams: optionalBoolean(flags, values, 'preserveDuplicateQueryParams'),
    configPath: first(values.config),
    calibrationOverridesPath: calibrationPath === undefined ? undefined : path.resolve(calibrationPath)
  };
}

// Tri-state boolean CLI option: a bare flag (--name) is true, --name=false is false, and an absent
// option is undefined so the config / built-in default is left untouched.
function optionalBoolean(
  flags: Set<string>,
  values: Record<string, string[]>,
  name: string
): boolean | undefined {
  if (flags.has(name)) {
    return true;
  }
  const value = first(values[name]);
  if (value === undefined) {
    return undefined;
  }
  return value === 'true';
}

export async function loadUserConfig(configPath?: string): Promise<Partial<HarApiTestConfig>> {
  const resolved = path.resolve(configPath ?? './config/har-api-tests.config.ts');
  // Only an ABSENT default config falls back to built-in defaults. Any other import failure
  // (top-level throw, broken dependency) must surface: silently using defaults would drop the
  // configured filters and regenerate a completely different suite with no warning.
  if (!configPath && !fs.existsSync(resolved)) {
    return {};
  }

  const module = (await import(pathToFileURL(resolved).href)) as { default?: Partial<HarApiTestConfig> };
  return module.default ?? {};
}

function collect(values?: string[], defaults: string[] = []): string[] {
  return (values ?? defaults)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

function first(values?: string[]): string | undefined {
  return values?.[0];
}

function camelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function normalizeMethod(value: string): SupportedHttpMethod {
  const method = value.toUpperCase();
  if (!supportedMethods.has(method)) {
    throw new Error(`Unsupported method filter: ${value}`);
  }

  return method as SupportedHttpMethod;
}

// Strict, like normalizeMethod: reject anything that is not a 3-digit HTTP status. The previous
// Number.parseInt + isFinite filter silently accepted partial prefixes (e.g. "20x" -> 20, "2oo" -> 2).
function normalizeStatus(value: string): number {
  if (!/^[1-5]\d{2}$/.test(value.trim())) {
    throw new Error(`Unsupported status filter: ${value} (expected a 3-digit HTTP status such as 200)`);
  }
  return Number.parseInt(value, 10);
}

function normalizeGenerationMode(value: string): GenerationMode {
  const mode = generationModeAliases[value];
  if (!mode) {
    throw new Error(`Unsupported generation mode: ${value}`);
  }

  return mode;
}

function normalizeInferenceLevel(value: string): InferenceLevel {
  if (!supportedInferenceLevels.has(value)) {
    throw new Error(`Unsupported inference level: ${value}`);
  }

  return value as InferenceLevel;
}

function normalizeInferredRunMode(value: string): InferredRunMode {
  if (!supportedRunModes.has(value)) {
    throw new Error(`Unsupported inferred run mode: ${value}`);
  }

  return value as InferredRunMode;
}

function normalizeNegativeStatusPolicy(value: string): NegativeStatusPolicy {
  if (!supportedNegativeStatusPolicies.has(value)) {
    throw new Error(`Unsupported negative status policy: ${value}`);
  }

  return value as NegativeStatusPolicy;
}

function normalizeMutationPolicy(value: string): MutationPolicy {
  if (!supportedMutationPolicies.has(value)) {
    throw new Error(`Unsupported mutation policy: ${value}`);
  }

  return value as MutationPolicy;
}
