import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/defaultConfig.js';
import { generateFromHar } from '../../src/generator/orchestrator.js';
import type { CliGenerateOptions } from '../../src/types/config.js';
import { writeGeneratedOutputMarker } from '../../src/utils/generatedOutput.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('generation output safety', () => {
  it('does not touch existing output when filters produce no tests', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-empty-plan-'));
    tmpDirs.push(root);
    const harPath = path.join(root, 'session.har');
    const outDir = path.join(root, 'generated');
    const existingFile = path.join(outDir, 'important.spec.ts');
    await fs.writeFile(harPath, JSON.stringify(sampleHar()), 'utf8');
    await fs.mkdir(outDir);
    await fs.writeFile(existingFile, 'keep this exact content\n', 'utf8');

    await expect(
      generateFromHar(baseOptions(harPath, outDir), {
        ...defaultConfig,
        filters: { ...defaultConfig.filters, firstPartyDomains: ['different.example.test'] }
      })
    ).rejects.toThrow(/No tests were planned.*Existing output was not modified/);

    await expect(fs.readFile(existingFile, 'utf8')).resolves.toBe('keep this exact content\n');
  });

  it('allows a zero-test dry run because it cannot modify output', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-empty-dry-run-'));
    tmpDirs.push(root);
    const harPath = path.join(root, 'session.har');
    const outDir = path.join(root, 'generated');
    await fs.writeFile(harPath, JSON.stringify(sampleHar()), 'utf8');

    const summary = await generateFromHar(
      { ...baseOptions(harPath, outDir), dryRun: true },
      { ...defaultConfig, filters: { ...defaultConfig.filters, firstPartyDomains: ['different.example.test'] } }
    );

    expect(summary.generatedTests).toBe(0);
    expect(summary.generatedFiles).toEqual([]);
    expect(summary.publication).toBe('dry-run');
    expect(summary.llmUsage).toMatchObject({ mode: 'not-used', requests: 0, totalTokens: 0 });
    expect(summary.timings.totalMs).toBeGreaterThanOrEqual(0);
    expect(summary.provenance.fingerprintSha256).toMatch(/^sha256:/);
    await expect(fs.access(outDir)).rejects.toThrow();
  });

  it('returns unchanged for an ownership-verified identical run without replacing output', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-output-noop-'));
    tmpDirs.push(root);
    const harPath = path.join(root, 'session.har');
    const outDir = path.join(root, 'generated');
    await fs.writeFile(harPath, JSON.stringify(sampleHar()), 'utf8');

    const first = await generateFromHar(baseOptions(harPath, outDir), defaultConfig);
    const directoryBefore = await fs.stat(outDir);
    const markerPath = path.join(outDir, '.har-api-tests-generated.json');
    const markerBefore = await fs.stat(markerPath);
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8')) as {
      formatVersion: number;
      generationFingerprintSha256?: string;
    };

    const second = await generateFromHar(baseOptions(harPath, outDir), defaultConfig);
    const directoryAfter = await fs.stat(outDir);
    const markerAfter = await fs.stat(markerPath);

    expect(first.publication).toBe('published');
    expect(marker).toMatchObject({
      formatVersion: 2,
      generationFingerprintSha256: first.provenance.fingerprintSha256
    });
    expect(second.publication).toBe('unchanged');
    expect(second.generatedFiles).toEqual([]);
    expect(second.provenance.fingerprintSha256).toBe(first.provenance.fingerprintSha256);
    expect(directoryAfter.ino).toBe(directoryBefore.ino);
    expect(markerAfter.ino).toBe(markerBefore.ino);
    expect(second.timings.outputVerificationMs).toBeGreaterThanOrEqual(0);
    expect(second.timings.writeMs).toBe(0);
    expect(second.timings.markerMs).toBe(0);
    expect(second.timings.publishMs).toBe(0);
    expect((await fs.readdir(root)).filter((entry) => /\.staging-|\.backup-/.test(entry))).toEqual([]);
  });

  it('never treats a matching fingerprint as a no-op when generated output was locally modified', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-output-noop-modified-'));
    tmpDirs.push(root);
    const harPath = path.join(root, 'session.har');
    const outDir = path.join(root, 'generated');
    const localFile = path.join(outDir, 'local-notes.md');
    await fs.writeFile(harPath, JSON.stringify(sampleHar()), 'utf8');
    await generateFromHar(baseOptions(harPath, outDir), defaultConfig);
    await fs.writeFile(localFile, 'must survive\n', 'utf8');

    await expect(generateFromHar(baseOptions(harPath, outDir), defaultConfig)).rejects.toThrow(
      /modified generated output/
    );
    await expect(fs.readFile(localFile, 'utf8')).resolves.toBe('must survive\n');
  });

  it('accepts a valid legacy v1 marker and migrates it through the normal atomic publish path', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-output-v1-migration-'));
    tmpDirs.push(root);
    const harPath = path.join(root, 'session.har');
    const outDir = path.join(root, 'generated');
    await fs.writeFile(harPath, JSON.stringify(sampleHar()), 'utf8');
    await generateFromHar(baseOptions(harPath, outDir), defaultConfig);

    await writeGeneratedOutputMarker(outDir);
    const legacy = JSON.parse(await fs.readFile(path.join(outDir, '.har-api-tests-generated.json'), 'utf8')) as {
      formatVersion: number;
    };
    expect(legacy.formatVersion).toBe(1);

    const migrated = await generateFromHar(baseOptions(harPath, outDir), defaultConfig);
    const marker = JSON.parse(await fs.readFile(path.join(outDir, '.har-api-tests-generated.json'), 'utf8')) as {
      formatVersion: number;
    };
    expect(migrated.publication).toBe('published');
    expect(marker.formatVersion).toBe(2);
  });

  it('rejects configured output subdirectories that escape the staging tree', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-output-traversal-'));
    tmpDirs.push(root);
    const harPath = path.join(root, 'session.har');
    const outDir = path.join(root, 'generated');
    const escapedDir = path.join(root, 'escaped');
    await fs.writeFile(harPath, JSON.stringify(sampleHar()), 'utf8');

    await expect(
      generateFromHar(baseOptions(harPath, outDir), {
        ...defaultConfig,
        output: { ...defaultConfig.output, supportDir: '../escaped' }
      })
    ).rejects.toThrow(/output\.supportDir must resolve to a nested directory/);

    await expect(fs.access(escapedDir)).rejects.toThrow();
    await expect(fs.access(outDir)).rejects.toThrow();
  });
});

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

function sampleHar(): unknown {
  return {
    log: {
      version: '1.2',
      entries: [
        {
          time: 10,
          request: { method: 'GET', url: 'https://api.example.test/v1/users', headers: [] },
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
