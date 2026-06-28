import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSafeGeneratedOutputDir } from '../../src/utils/fileSystem.js';

describe('file-system safety checks', () => {
  const cwd = path.resolve('/workspace/har-api-tests');
  const homeDir = path.resolve('/workspace');

  it('allows nested generated output directories', () => {
    expect(() => assertSafeGeneratedOutputDir('tests/generated', cwd, homeDir)).not.toThrow();
    expect(() => assertSafeGeneratedOutputDir('/tmp/har-api-tests/generated', cwd, homeDir)).not.toThrow();
  });

  it('rejects destructive generated output targets', () => {
    expect(() => assertSafeGeneratedOutputDir('.', cwd, homeDir)).toThrow(/project root/);
    expect(() => assertSafeGeneratedOutputDir('tests', cwd, homeDir)).toThrow(/protected project directory/);
    expect(() => assertSafeGeneratedOutputDir('/workspace', cwd, homeDir)).toThrow(/home directory/);
    expect(() => assertSafeGeneratedOutputDir('/workspace/har-api-tests/..', cwd, homeDir)).toThrow(/home directory/);
  });
});
