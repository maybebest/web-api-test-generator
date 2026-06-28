import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadUserConfig, parseCliArgs } from '../../src/cli/options.js';

describe('CLI argument parsing', () => {
  it('throws when --har is missing', () => {
    expect(() => parseCliArgs(['--out', './tests/generated'])).toThrow(/Missing required --har/);
  });

  it('parses spaced, inline, and comma-separated values', () => {
    const options = parseCliArgs([
      '--har=./examples',
      '--method',
      'GET,POST',
      '--status',
      '200,201',
      '--first-party',
      'heartpace.dev',
      '--ai'
    ]);

    expect(options.harInputs).toEqual(['./examples']);
    expect(options.methods).toEqual(['GET', 'POST']);
    expect(options.statuses).toEqual([200, 201]);
    expect(options.firstPartyDomains).toEqual(['heartpace.dev']);
    expect(options.ai).toBe(true);
  });

  it('defaults generation modes to smoke + extended', () => {
    const options = parseCliArgs(['--har', './examples']);
    expect(options.generationModes).toEqual(['smoke', 'extended']);
    expect(options.inferenceLevel).toBe('balanced');
  });

  it('maps legacy generation-mode aliases and de-duplicates', () => {
    const options = parseCliArgs(['--har', './examples', '--generation-mode', 'replay,inferred,scenario']);
    expect(options.generationModes).toEqual(['smoke', 'extended']);
  });

  it('accepts the new smoke/extended modes directly', () => {
    expect(parseCliArgs(['--har', 'a.har', '--generation-mode', 'smoke']).generationModes).toEqual(['smoke']);
  });

  it('parses --calibration into a resolved overrides path', () => {
    const options = parseCliArgs(['--har', 'a.har', '--calibration', './out/calibration-overrides.json']);
    expect(options.calibrationOverridesPath).toBe(path.resolve('./out/calibration-overrides.json'));
  });

  it('leaves calibrationOverridesPath undefined when --calibration is absent', () => {
    expect(parseCliArgs(['--har', 'a.har']).calibrationOverridesPath).toBeUndefined();
  });

  it('rejects unsupported enum values', () => {
    expect(() => parseCliArgs(['--har', 'a.har', '--generation-mode', 'bogus'])).toThrow(/Unsupported generation mode/);
    expect(() => parseCliArgs(['--har', 'a.har', '--method', 'TRACE'])).toThrow(/Unsupported method/);
    expect(() => parseCliArgs(['--har', 'a.har', '--inference-level', 'wild'])).toThrow(/Unsupported inference level/);
  });
});

describe('user config loading', () => {
  // Inside the project so dynamic imports of the throwing config are transformable.
  const tmpRoot = path.resolve('tests/.tmp/cli-options-unit');

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  async function inDirectory<T>(dir: string, run: () => Promise<T>): Promise<T> {
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      return await run();
    } finally {
      process.chdir(previousCwd);
    }
  }

  it('falls back to defaults only when the default config file is absent', async () => {
    const emptyDir = path.join(tmpRoot, 'empty');
    await fs.mkdir(emptyDir, { recursive: true });

    await inDirectory(emptyDir, async () => {
      await expect(loadUserConfig()).resolves.toEqual({});
    });
  });

  it('surfaces import-time failures of the default config instead of silently using defaults', async () => {
    const brokenDir = path.join(tmpRoot, 'broken');
    await fs.mkdir(path.join(brokenDir, 'config'), { recursive: true });
    await fs.writeFile(
      path.join(brokenDir, 'config', 'har-api-tests.config.ts'),
      "throw new Error('config exploded');\nexport default {};\n",
      'utf8'
    );

    await inDirectory(brokenDir, async () => {
      await expect(loadUserConfig()).rejects.toThrow(/config exploded/);
    });
  });
});
