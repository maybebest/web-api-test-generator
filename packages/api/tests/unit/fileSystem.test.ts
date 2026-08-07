import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildGeneratedOutputMarker,
  createGeneratedOutputStagingDir,
  generatedOutputMarkerName,
  publishGeneratedOutput,
  verifyGeneratedOutputOwnership,
  writeGeneratedOutputMarker
} from '../../src/utils/generatedOutput.js';
import { assertSafeGeneratedOutputDir } from '../../src/utils/fileSystem.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

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

  it('refuses to stage over a non-empty unowned directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-output-unowned-'));
    tmpDirs.push(root);
    const outDir = path.join(root, 'docs');
    const existingFile = path.join(outDir, 'important.md');
    await fs.mkdir(outDir);
    await fs.writeFile(existingFile, 'keep me\n', 'utf8');

    await expect(createGeneratedOutputStagingDir(outDir)).rejects.toThrow(/without \.har-api-tests-generated\.json/);
    await expect(fs.readFile(existingFile, 'utf8')).resolves.toBe('keep me\n');
  });

  it('publishes a complete staged tree and replaces only unchanged owned output', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-output-owned-'));
    tmpDirs.push(root);
    const outDir = path.join(root, 'generated');
    await fs.mkdir(outDir);
    await fs.writeFile(path.join(outDir, 'old.spec.ts'), 'old\n', 'utf8');
    await writeGeneratedOutputMarker(outDir);

    const stagingDir = await createGeneratedOutputStagingDir(outDir);
    await fs.writeFile(path.join(stagingDir, 'new.spec.ts'), 'new\n', 'utf8');
    await writeGeneratedOutputMarker(stagingDir);
    await publishGeneratedOutput(stagingDir, outDir);

    await expect(fs.readFile(path.join(outDir, 'new.spec.ts'), 'utf8')).resolves.toBe('new\n');
    await expect(fs.access(path.join(outDir, 'old.spec.ts'))).rejects.toThrow();
    await expect(fs.access(path.join(outDir, generatedOutputMarkerName))).resolves.toBeUndefined();
    expect((await fs.readdir(root)).some((entry) => entry.includes('.backup-'))).toBe(false);
  });

  it('refuses to replace owned output after any local file is added or changed', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-output-modified-'));
    tmpDirs.push(root);
    const outDir = path.join(root, 'generated');
    await fs.mkdir(outDir);
    await fs.writeFile(path.join(outDir, 'generated.spec.ts'), 'generated\n', 'utf8');
    await writeGeneratedOutputMarker(outDir);
    await fs.writeFile(path.join(outDir, 'local-notes.md'), 'do not delete\n', 'utf8');

    await expect(createGeneratedOutputStagingDir(outDir)).rejects.toThrow(/modified generated output/);
    await expect(fs.readFile(path.join(outDir, 'local-notes.md'), 'utf8')).resolves.toBe('do not delete\n');
  });

  it('preserves an edit made after the early check but before the atomic destination rename', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-output-concurrent-edit-'));
    tmpDirs.push(root);
    const outDir = path.join(root, 'generated');
    await fs.mkdir(outDir);
    await fs.writeFile(path.join(outDir, 'old.spec.ts'), 'old\n', 'utf8');
    await writeGeneratedOutputMarker(outDir);

    const stagingDir = await createGeneratedOutputStagingDir(outDir);
    await fs.writeFile(path.join(stagingDir, 'new.spec.ts'), 'new\n', 'utf8');
    await writeGeneratedOutputMarker(stagingDir);

    const originalRename = fs.rename.bind(fs);
    const renameSpy = vi.spyOn(fs, 'rename').mockImplementationOnce(async (source, destination) => {
      expect(path.resolve(String(source))).toBe(path.resolve(outDir));
      await fs.writeFile(path.join(outDir, 'concurrent-notes.md'), 'must survive\n', 'utf8');
      await originalRename(source, destination);
    });
    try {
      await expect(publishGeneratedOutput(stagingDir, outDir)).rejects.toThrow(/modified generated output/);
    } finally {
      renameSpy.mockRestore();
    }

    await expect(fs.readFile(path.join(outDir, 'concurrent-notes.md'), 'utf8')).resolves.toBe('must survive\n');
    await expect(fs.readFile(path.join(outDir, 'old.spec.ts'), 'utf8')).resolves.toBe('old\n');
    await expect(fs.readFile(path.join(stagingDir, 'new.spec.ts'), 'utf8')).resolves.toBe('new\n');
    expect((await fs.readdir(root)).some((entry) => entry.includes('.backup-'))).toBe(false);
  });

  it('preserves a file raced into an initially empty destination', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-output-empty-race-'));
    tmpDirs.push(root);
    const outDir = path.join(root, 'generated');
    await fs.mkdir(outDir);

    const stagingDir = await createGeneratedOutputStagingDir(outDir);
    await fs.writeFile(path.join(stagingDir, 'new.spec.ts'), 'new\n', 'utf8');
    await writeGeneratedOutputMarker(stagingDir);

    const originalRename = fs.rename.bind(fs);
    const renameSpy = vi.spyOn(fs, 'rename').mockImplementationOnce(async (source, destination) => {
      await fs.writeFile(path.join(outDir, 'raced-in.txt'), 'must survive\n', 'utf8');
      await originalRename(source, destination);
    });
    try {
      await expect(publishGeneratedOutput(stagingDir, outDir)).rejects.toThrow(/without \.har-api-tests-generated\.json/);
    } finally {
      renameSpy.mockRestore();
    }

    await expect(fs.readFile(path.join(outDir, 'raced-in.txt'), 'utf8')).resolves.toBe('must survive\n');
    await expect(fs.readFile(path.join(stagingDir, 'new.spec.ts'), 'utf8')).resolves.toBe('new\n');
    expect((await fs.readdir(root)).some((entry) => entry.includes('.backup-'))).toBe(false);
  });

  it('rolls back and leaves no backup path when the staging rename fails', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-output-rename-failure-'));
    tmpDirs.push(root);
    const outDir = path.join(root, 'generated');
    const nestedStaging = path.join(outDir, 'nested-staging');
    await fs.mkdir(nestedStaging, { recursive: true });
    await fs.writeFile(path.join(outDir, 'old.spec.ts'), 'old\n', 'utf8');
    await fs.writeFile(path.join(nestedStaging, 'new.spec.ts'), 'new\n', 'utf8');
    await writeGeneratedOutputMarker(nestedStaging);
    // Write the destination marker last so its inventory includes the complete nested staging tree.
    await writeGeneratedOutputMarker(outDir);

    await expect(publishGeneratedOutput(nestedStaging, outDir)).rejects.toThrow();

    await expect(fs.readFile(path.join(outDir, 'old.spec.ts'), 'utf8')).resolves.toBe('old\n');
    await expect(fs.readFile(path.join(nestedStaging, 'new.spec.ts'), 'utf8')).resolves.toBe('new\n');
    expect((await fs.readdir(root)).some((entry) => entry.includes('.backup-'))).toBe(false);
  });

  it('keeps complete published output when backup cleanup fails after partial deletion', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-output-cleanup-failure-'));
    tmpDirs.push(root);
    const outDir = path.join(root, 'generated');
    await fs.mkdir(outDir);
    await fs.writeFile(path.join(outDir, 'old.spec.ts'), 'old\n', 'utf8');
    await writeGeneratedOutputMarker(outDir);

    const stagingDir = await createGeneratedOutputStagingDir(outDir);
    await fs.writeFile(path.join(stagingDir, 'new.spec.ts'), 'new\n', 'utf8');
    await writeGeneratedOutputMarker(stagingDir);
    let retainedBackup = '';
    const rmSpy = vi.spyOn(fs, 'rm').mockImplementationOnce(async (target) => {
      retainedBackup = String(target);
      await fs.unlink(path.join(retainedBackup, 'old.spec.ts'));
      throw new Error('simulated partial cleanup failure');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(publishGeneratedOutput(stagingDir, outDir)).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(retainedBackup));
    } finally {
      rmSpy.mockRestore();
      warnSpy.mockRestore();
    }

    await expect(fs.readFile(path.join(outDir, 'new.spec.ts'), 'utf8')).resolves.toBe('new\n');
    await expect(fs.access(path.join(outDir, 'old.spec.ts'))).rejects.toThrow();
    await expect(fs.access(stagingDir)).rejects.toThrow();
    expect(retainedBackup).toContain('.backup-');
    await expect(fs.access(retainedBackup)).resolves.toBeUndefined();
  });

  it('verifies the committed generated suite ownership marker', async () => {
    await expect(verifyGeneratedOutputOwnership(path.resolve('tests/generated'))).resolves.toBeUndefined();
  });

  it('uses an unambiguous canonical inventory for file paths and content', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'har-api-output-inventory-'));
    tmpDirs.push(root);
    const left = path.join(root, 'left');
    const right = path.join(root, 'right');
    await fs.mkdir(left);
    await fs.mkdir(right);
    await fs.writeFile(path.join(left, 'a'), Buffer.from('x\0file\0b\0y'));
    await fs.writeFile(path.join(right, 'a'), 'x');
    await fs.writeFile(path.join(right, 'b'), 'y');

    const leftMarker = await buildGeneratedOutputMarker(left);
    const rightMarker = await buildGeneratedOutputMarker(right);
    expect(leftMarker.inventorySha256).not.toBe(rightMarker.inventorySha256);
  });
});
