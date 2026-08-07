import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/defaultConfig.js';
import type { CliGenerateOptions, HarApiTestConfig } from '../../src/types/config.js';
import {
  readVerifiedGeneratedOutputMarker,
  writeGeneratedOutputMarker
} from '../../src/utils/generatedOutput.js';
import {
  buildGenerationProvenance,
  stableSha256,
  type CalibrationProvenanceInput,
  type GeneratorBuildIdentity
} from '../../src/utils/provenance.js';

const tmpDirs: string[] = [];
const generatorBuild: GeneratorBuildIdentity = {
  buildId: 'har-api-tests@test-build',
  sha256: stableSha256('test generator build')
};

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('generation provenance', () => {
  it('is stable across object key order, checkout roots, output paths, and dry-run mode', async () => {
    expect(stableSha256({ beta: 2, alpha: 1 })).toBe(stableSha256({ alpha: 1, beta: 2 }));

    const left = await createCaptureRoot();
    const right = await createCaptureRoot();
    const calibrationOverrides = [{ title: 'negative: GET /users rejects invalid id', observedStatus: 404 }];
    const leftCalibration: CalibrationProvenanceInput = {
      present: true,
      content: JSON.stringify(calibrationOverrides),
      overrides: calibrationOverrides
    };
    const rightCalibration: CalibrationProvenanceInput = {
      present: true,
      content: JSON.stringify(calibrationOverrides),
      overrides: calibrationOverrides
    };

    const leftProvenance = await buildGenerationProvenance({
      harInputs: [left.harPath],
      config: defaultConfig,
      options: baseOptions(left.harPath, path.join(left.root, 'generated')),
      calibration: leftCalibration,
      generatorBuild
    });
    const rightProvenance = await buildGenerationProvenance({
      harInputs: [right.harPath],
      config: defaultConfig,
      options: { ...baseOptions(right.harPath, path.join(right.root, 'elsewhere')), dryRun: true },
      calibration: rightCalibration,
      generatorBuild
    });

    expect(leftProvenance.inputs).toEqual(rightProvenance.inputs);
    expect(leftProvenance.inputs.files[0]?.path).toBe('input-001/session.har');
    expect(leftProvenance.effectiveConfigSha256).toBe(rightProvenance.effectiveConfigSha256);
    expect(leftProvenance.effectiveOptionsSha256).toBe(rightProvenance.effectiveOptionsSha256);
    expect(leftProvenance.calibration.semanticSha256).toBe(rightProvenance.calibration.semanticSha256);
    expect(leftProvenance.calibration.contentSha256).toBe(rightProvenance.calibration.contentSha256);
    expect(leftProvenance.fingerprintSha256).toBe(rightProvenance.fingerprintSha256);
  });

  it('invalidates the fingerprint for every output-shaping input', async () => {
    const capture = await createCaptureRoot();
    const options = baseOptions(capture.harPath, path.join(capture.root, 'generated'));
    const calibration: CalibrationProvenanceInput = { present: false, overrides: [] };
    const build = (overrides: {
      config?: HarApiTestConfig;
      options?: CliGenerateOptions;
      calibration?: CalibrationProvenanceInput;
      generatorBuild?: GeneratorBuildIdentity;
    } = {}) =>
      buildGenerationProvenance({
        harInputs: [capture.harPath],
        config: overrides.config ?? defaultConfig,
        options: overrides.options ?? options,
        calibration: overrides.calibration ?? calibration,
        generatorBuild: overrides.generatorBuild ?? generatorBuild
      });

    const baseline = await build();
    const configChanged = await build({
      config: { ...defaultConfig, responseTimeBudgetMs: defaultConfig.responseTimeBudgetMs + 1 }
    });
    const optionsChanged = await build({ options: { ...options, ai: true } });
    const calibrationChanged = await build({
      calibration: {
        present: true,
        content: '[{"title":"negative","observedStatus":422}]',
        overrides: [{ title: 'negative', observedStatus: 422 }]
      }
    });
    const generatorChanged = await build({
      generatorBuild: { buildId: 'har-api-tests@other-build', sha256: stableSha256('other build') }
    });

    await fs.writeFile(capture.harPath, JSON.stringify(sampleHar('https://api.example.test/v2/users')), 'utf8');
    const inputChanged = await build();

    for (const changed of [configChanged, optionsChanged, calibrationChanged, generatorChanged, inputChanged]) {
      expect(changed.fingerprintSha256).not.toBe(baseline.fingerprintSha256);
    }
  });

  it('reads legacy v1 markers and writes fingerprinted v2 markers with the same ownership checks', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-marker-versions-'));
    tmpDirs.push(root);
    const outDir = path.join(root, 'generated');
    await fs.mkdir(outDir);
    await fs.writeFile(path.join(outDir, 'example.spec.ts'), 'generated\n', 'utf8');

    await writeGeneratedOutputMarker(outDir);
    await expect(readVerifiedGeneratedOutputMarker(outDir)).resolves.toMatchObject({ formatVersion: 1 });

    const capture = await createCaptureRoot();
    const provenance = await buildGenerationProvenance({
      harInputs: [capture.harPath],
      config: defaultConfig,
      options: baseOptions(capture.harPath, outDir),
      calibration: { present: false, overrides: [] },
      generatorBuild
    });
    await writeGeneratedOutputMarker(outDir, provenance);
    await expect(readVerifiedGeneratedOutputMarker(outDir)).resolves.toMatchObject({
      formatVersion: 2,
      generationFingerprintSha256: provenance.fingerprintSha256,
      provenance
    });
  });
});

async function createCaptureRoot(): Promise<{ root: string; harPath: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-provenance-'));
  tmpDirs.push(root);
  const harPath = path.join(root, 'session.har');
  await fs.writeFile(harPath, JSON.stringify(sampleHar('https://api.example.test/v1/users')), 'utf8');
  return { root, harPath };
}

function baseOptions(harPath: string, outDir: string): CliGenerateOptions {
  return {
    harInputs: [harPath],
    outDir,
    include: [],
    exclude: [],
    ignoredDomains: [],
    firstPartyDomains: [],
    methods: [],
    statuses: [],
    generationModes: ['smoke', 'extended'],
    inferenceLevel: 'balanced',
    inferredRunMode: 'mixed',
    negativeStatusPolicy: 'family',
    mutationPolicy: 'guarded',
    ai: false,
    dryRun: false
  };
}

function sampleHar(url: string): unknown {
  return {
    log: {
      version: '1.2',
      entries: [
        {
          time: 10,
          request: { method: 'GET', url, headers: [] },
          response: {
            status: 200,
            headers: [{ name: 'Content-Type', value: 'application/json' }],
            content: { mimeType: 'application/json', text: '{"users":[]}' }
          }
        }
      ]
    }
  };
}
