import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CliGenerateOptions,
  GenerationInputProvenance,
  GenerationProvenance,
  HarApiTestConfig
} from '../types/config.js';
import type { CalibrationOverride } from '../types/testCase.js';
import { findHarFiles } from './fileSystem.js';

const digestPrefix = 'sha256:';
const portableSeparator = '/';

export interface CalibrationProvenanceInput {
  present: boolean;
  content?: string;
  overrides: CalibrationOverride[];
}

export interface GeneratorBuildIdentity {
  buildId: string;
  sha256: string;
}

export interface BuildGenerationProvenanceOptions {
  harInputs: string[];
  config: HarApiTestConfig;
  options: CliGenerateOptions;
  calibration: CalibrationProvenanceInput;
  /** Test/build hook; production calls hash the actual source or dist tree. */
  generatorBuild?: GeneratorBuildIdentity;
  cwd?: string;
}

/**
 * Builds a deterministic, path-portable description of every input that can shape generated
 * artifacts. Digests use base64url instead of long hexadecimal strings so generated metadata does
 * not resemble captured secrets to the repository's deliberately conservative secret scanner.
 */
export async function buildGenerationProvenance(
  input: BuildGenerationProvenanceOptions
): Promise<GenerationProvenance> {
  const sourceFiles = await hashHarInputs(input.harInputs, input.cwd ?? process.cwd());
  const effectiveConfigSha256 = stableSha256(input.config);
  const effectiveOptionsSha256 = stableSha256(effectiveGenerationOptions(input.options, input.config));
  const calibrationSemanticSha256 = stableSha256(input.calibration.overrides);
  const generator = input.generatorBuild ?? (await currentGeneratorBuildIdentity());
  assertDigest(generator.sha256, 'generator build digest');

  const inputsSha256 = stableSha256(sourceFiles);
  const calibration = {
    present: input.calibration.present,
    ...(input.calibration.content === undefined ? {} : { contentSha256: sha256(input.calibration.content) }),
    semanticSha256: calibrationSemanticSha256,
    entryCount: input.calibration.overrides.length
  };
  const fingerprintSha256 = stableSha256({
    formatVersion: 1,
    inputsSha256,
    effectiveConfigSha256,
    effectiveOptionsSha256,
    calibrationPresent: calibration.present,
    calibrationContentSha256: calibration.contentSha256 ?? null,
    calibrationSemanticSha256,
    generatorBuildId: generator.buildId,
    generatorSha256: generator.sha256
  });

  return {
    formatVersion: 1,
    inputs: {
      sha256: inputsSha256,
      files: sourceFiles
    },
    effectiveConfigSha256,
    effectiveOptionsSha256,
    calibration,
    generator,
    fingerprintSha256
  };
}

/** Stable SHA-256 over JSON values: object keys are sorted; array order remains semantic. */
export function stableSha256(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)));
}

export function isPortableSha256(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[A-Za-z0-9_-]{43}$/.test(value);
}

export function isGenerationProvenance(value: unknown): value is GenerationProvenance {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<GenerationProvenance>;
  const inputs = candidate.inputs;
  const calibration = candidate.calibration;
  const generator = candidate.generator;
  return (
    candidate.formatVersion === 1 &&
    typeof inputs === 'object' &&
    inputs !== null &&
    isPortableSha256(inputs.sha256) &&
    Array.isArray(inputs.files) &&
    inputs.files.every(isGenerationInputProvenance) &&
    isPortableSha256(candidate.effectiveConfigSha256) &&
    isPortableSha256(candidate.effectiveOptionsSha256) &&
    typeof calibration === 'object' &&
    calibration !== null &&
    typeof calibration.present === 'boolean' &&
    (calibration.contentSha256 === undefined || isPortableSha256(calibration.contentSha256)) &&
    isPortableSha256(calibration.semanticSha256) &&
    typeof calibration.entryCount === 'number' &&
    Number.isSafeInteger(calibration.entryCount) &&
    calibration.entryCount >= 0 &&
    typeof generator === 'object' &&
    generator !== null &&
    typeof generator.buildId === 'string' &&
    generator.buildId.length > 0 &&
    isPortableSha256(generator.sha256) &&
    isPortableSha256(candidate.fingerprintSha256)
  );
}

function isGenerationInputProvenance(value: unknown): value is GenerationInputProvenance {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<GenerationInputProvenance>;
  return (
    typeof candidate.path === 'string' &&
    candidate.path.length > 0 &&
    !path.isAbsolute(candidate.path) &&
    typeof candidate.sizeBytes === 'number' &&
    Number.isSafeInteger(candidate.sizeBytes) &&
    candidate.sizeBytes >= 0 &&
    isPortableSha256(candidate.sha256)
  );
}

async function hashHarInputs(inputs: string[], cwd: string): Promise<GenerationInputProvenance[]> {
  const files: GenerationInputProvenance[] = [];
  const seen = new Set<string>();

  for (const [inputIndex, input] of inputs.entries()) {
    const resolvedInput = path.resolve(cwd, input);
    const inputStat = await fs.stat(resolvedInput);
    const discovered = await findHarFiles([resolvedInput]);
    for (const file of discovered) {
      const resolvedFile = path.resolve(file);
      if (seen.has(resolvedFile)) {
        continue;
      }
      seen.add(resolvedFile);

      const content = await fs.readFile(resolvedFile);
      const relativePath = inputStat.isDirectory()
        ? path.relative(resolvedInput, resolvedFile)
        : path.basename(resolvedFile);
      files.push({
        // The input ordinal disambiguates equal relative paths without leaking an absolute root.
        path: `input-${String(inputIndex + 1).padStart(3, '0')}${portableSeparator}${toPortablePath(relativePath)}`,
        sizeBytes: content.byteLength,
        sha256: sha256(content)
      });
    }
  }

  return files.sort((left, right) => compareStrings(left.path, right.path));
}

function effectiveGenerationOptions(options: CliGenerateOptions, config: HarApiTestConfig): object {
  return {
    baseUrl: options.baseUrl ?? null,
    include: options.include,
    exclude: options.exclude,
    ignoredDomains: options.ignoredDomains,
    firstPartyDomains: options.firstPartyDomains,
    methods: options.methods,
    statuses: options.statuses,
    generationModes: options.generationModes ?? config.generation.modes,
    inferenceLevel: options.inferenceLevel ?? config.generation.inferenceLevel,
    inferredRunMode: options.inferredRunMode ?? config.generation.inferredRunMode,
    negativeStatusPolicy: options.negativeStatusPolicy ?? config.generation.negativeStatusPolicy,
    mutationPolicy: options.mutationPolicy ?? config.generation.mutationPolicy,
    ai: options.ai,
    preserveDuplicateQueryParams: config.generation.preserveDuplicateQueryParams ?? false
  };
}

let generatorBuildPromise: Promise<GeneratorBuildIdentity> | undefined;

async function currentGeneratorBuildIdentity(): Promise<GeneratorBuildIdentity> {
  generatorBuildPromise ??= computeGeneratorBuildIdentity();
  return generatorBuildPromise;
}

async function computeGeneratorBuildIdentity(): Promise<GeneratorBuildIdentity> {
  const modulePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(modulePath), '../..');
  const packageJson = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8')) as {
    name?: string;
    version?: string;
  };
  const runtimeTree = modulePath.includes(`${path.sep}dist${path.sep}`) ? 'dist' : 'src';
  const runtimeRoot = path.join(packageRoot, runtimeTree);
  const runtimeFiles = await walkRegularFiles(runtimeRoot);
  const inventory: Array<{ path: string; sizeBytes: number; sha256: string }> = [];

  for (const file of runtimeFiles) {
    const content = await fs.readFile(file);
    inventory.push({
      path: toPortablePath(path.relative(runtimeRoot, file)),
      sizeBytes: content.byteLength,
      sha256: sha256(content)
    });
  }

  const treeSha256 = stableSha256({
    name: packageJson.name ?? 'har-api-tests',
    version: packageJson.version ?? '0.0.0',
    runtimeTree,
    inventory
  });
  return {
    buildId: `${packageJson.name ?? 'har-api-tests'}@${packageJson.version ?? '0.0.0'}+${treeSha256.slice(-12)}`,
    sha256: treeSha256
  };
}

async function walkRegularFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  const entries = (await fs.readdir(root, { withFileTypes: true })).sort((left, right) =>
    compareStrings(left.name, right.name)
  );
  for (const entry of entries) {
    const resolved = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing to fingerprint a generator build containing a symbolic link: ${resolved}`);
    }
    if (entry.isDirectory()) {
      output.push(...(await walkRegularFiles(resolved)));
    } else if (entry.isFile()) {
      output.push(resolved);
    }
  }
  return output;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : canonicalize(item)));
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(object).sort(compareStrings)) {
      const child = object[key];
      if (child !== undefined && typeof child !== 'function' && typeof child !== 'symbol') {
        output[key] = canonicalize(child);
      }
    }
    return output;
  }
  if (value === undefined) {
    return null;
  }
  throw new TypeError(`Cannot create stable JSON provenance for value of type ${typeof value}.`);
}

function sha256(value: string | Buffer): string {
  return `${digestPrefix}${createHash('sha256').update(value).digest('base64url')}`;
}

function assertDigest(value: string, label: string): void {
  if (!isPortableSha256(value)) {
    throw new Error(`Invalid ${label}: expected sha256:<base64url>.`);
  }
}

function toPortablePath(value: string): string {
  return value.split(path.sep).join(portableSeparator);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
