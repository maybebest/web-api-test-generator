import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildPlaywrightSupportFile } from '../../src/generator/playwrightSupport.js';

// Written inside the project so the emitted file resolves @playwright/test and ajv from the
// project node_modules when imported below.
const tmpDir = path.resolve('tests/.tmp/playwright-support-unit');

interface EmittedSupportModule {
  resolveGeneratedEnvValue(envName: string): string;
}

async function importEmittedSupportModule(): Promise<EmittedSupportModule> {
  const filePath = path.join(tmpDir, 'apiTestUtils.ts');
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.writeFile(filePath, buildPlaywrightSupportFile(), 'utf8');
  return (await import(filePath)) as EmittedSupportModule;
}

describe('emitted playwright support file', () => {
  afterAll(async () => {
    delete process.env.GENERATED_ENV_FILE;
    delete process.env.HAR_TEST_BLANK_VAR;
    delete process.env.HAR_TEST_EMPTY_PROCESS_VAR;
    delete process.env.HAR_TEST_SET_VAR;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('treats blank required env values as missing instead of passing preflight vacuously', async () => {
    const envFilePath = path.join(tmpDir, 'generated-auth.env');
    await fs.mkdir(tmpDir, { recursive: true });
    // Exactly the state produced by copying .env.generated.example: blank NAME= lines.
    await fs.writeFile(envFilePath, 'HAR_TEST_BLANK_VAR=\nHAR_TEST_SET_VAR=real-value\n', 'utf8');
    process.env.GENERATED_ENV_FILE = envFilePath;
    process.env.HAR_TEST_EMPTY_PROCESS_VAR = '';

    const support = await importEmittedSupportModule();

    expect(() => support.resolveGeneratedEnvValue('HAR_TEST_BLANK_VAR')).toThrow(
      /Missing required environment variable HAR_TEST_BLANK_VAR/
    );
    expect(() => support.resolveGeneratedEnvValue('HAR_TEST_EMPTY_PROCESS_VAR')).toThrow(
      /Missing required environment variable HAR_TEST_EMPTY_PROCESS_VAR/
    );
    expect(() => support.resolveGeneratedEnvValue('HAR_TEST_DEFINITELY_UNSET_VAR')).toThrow(
      /Missing required environment variable HAR_TEST_DEFINITELY_UNSET_VAR/
    );
    expect(support.resolveGeneratedEnvValue('HAR_TEST_SET_VAR')).toBe('real-value');
  });
});
