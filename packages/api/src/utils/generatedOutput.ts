import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { GenerationProvenance } from '../types/config.js';
import { assertSafeGeneratedOutputDir, ensureDir, writeJsonFile } from './fileSystem.js';
import { isGenerationProvenance } from './provenance.js';

export const generatedOutputMarkerName = '.har-api-tests-generated.json';

export interface GeneratedOutputMarkerV1 {
  generator: 'har-api-tests';
  formatVersion: 1;
  inventorySha256: string;
  notice: string;
}

export interface GeneratedOutputMarkerV2 {
  generator: 'har-api-tests';
  formatVersion: 2;
  inventorySha256: string;
  generationFingerprintSha256: string;
  provenance: GenerationProvenance;
  notice: string;
}

export type GeneratedOutputMarker = GeneratedOutputMarkerV1 | GeneratedOutputMarkerV2;

/**
 * Creates a sibling staging directory after proving that an existing destination is either empty
 * or an unchanged directory previously produced by this generator. Nothing at the destination is
 * modified until publishGeneratedOutput is called.
 */
export async function createGeneratedOutputStagingDir(outDir: string): Promise<string> {
  assertSafeGeneratedOutputDir(outDir);
  const resolvedOutDir = path.resolve(outDir);
  await assertReplaceableGeneratedOutput(resolvedOutDir);
  await ensureDir(path.dirname(resolvedOutDir));
  return fs.mkdtemp(path.join(path.dirname(resolvedOutDir), `.${path.basename(resolvedOutDir)}.staging-`));
}

/** Writes a deterministic ownership marker after every generated artifact is in the staging tree. */
export async function writeGeneratedOutputMarker(
  outDir: string,
  provenance?: GenerationProvenance
): Promise<string> {
  const markerPath = path.join(path.resolve(outDir), generatedOutputMarkerName);
  await writeJsonFile(markerPath, await buildGeneratedOutputMarker(outDir, provenance));
  return markerPath;
}

/**
 * Builds the marker without writing it. Omitting the fingerprint intentionally creates a v1 marker
 * for reviewed legacy-output adoption; normal generation always supplies a fingerprint and emits
 * v2. Both versions retain identical inventory ownership semantics.
 */
export async function buildGeneratedOutputMarker(
  outDir: string,
  provenance?: GenerationProvenance
): Promise<GeneratedOutputMarker> {
  const common = {
    generator: 'har-api-tests' as const,
    inventorySha256: await hashGeneratedOutputInventory(outDir),
    notice: 'This entire directory is managed by har-api-tests. Regenerate it instead of editing files in place.'
  };
  if (provenance === undefined) {
    return {
      ...common,
      formatVersion: 1
    };
  }
  if (!isGenerationProvenance(provenance)) {
    throw new Error('Invalid generation provenance for generated-output marker.');
  }
  return {
    ...common,
    formatVersion: 2,
    generationFingerprintSha256: provenance.fingerprintSha256,
    provenance
  };
}

/**
 * Swaps a complete staged tree into place. The previous generated tree is first renamed to a
 * sibling backup, so a failed publish can be rolled back without losing the last good output.
 */
export async function publishGeneratedOutput(stagingDir: string, outDir: string): Promise<void> {
  assertSafeGeneratedOutputDir(outDir);
  const resolvedStagingDir = path.resolve(stagingDir);
  const resolvedOutDir = path.resolve(outDir);
  if (samePath(resolvedStagingDir, resolvedOutDir)) {
    throw new Error('Refusing to publish generated output from the destination directory itself.');
  }

  await assertOwnedGeneratedOutput(resolvedStagingDir, 'staging directory');
  // Claim even a previously absent destination with an empty directory. Moving that directory to
  // backup gives us one atomic boundary for both existing and first-time output, and lets us verify
  // the exact tree that was moved rather than a path that could change after verification.
  await claimGeneratedOutputDestination(resolvedOutDir);
  const backupDir = `${resolvedOutDir}.backup-${randomUUID()}`;
  await fs.rename(resolvedOutDir, backupDir);

  try {
    await assertReplaceableGeneratedOutput(backupDir);
  } catch (error) {
    await restoreGeneratedOutputBackup(backupDir, resolvedOutDir, error);
    throw error;
  }

  try {
    await fs.rename(resolvedStagingDir, resolvedOutDir);
  } catch (error) {
    try {
      await restoreGeneratedOutputBackup(backupDir, resolvedOutDir, error);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `Generated output publish and rollback both failed. Inspect ${resolvedOutDir}, ${resolvedStagingDir}, and ${backupDir}.`
      );
    }
    throw error;
  }
  try {
    await fs.rm(backupDir, { recursive: true, force: true });
  } catch (error) {
    // Recursive removal can fail after deleting only part of the backup. Never replace the newly
    // published, complete tree with a potentially partial backup. Keep the new output and retain
    // whatever backup remains for manual inspection/cleanup.
    console.warn(
      `[har-api-tests] Generated output was published successfully, but the previous-output backup could not be fully removed. ` +
        `The new output remains at ${resolvedOutDir}; inspect and remove ${backupDir} manually. ` +
        `Cleanup error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function discardGeneratedOutputStagingDir(stagingDir: string): Promise<void> {
  await fs.rm(stagingDir, { recursive: true, force: true });
}

/** Read-only verification used by migration checks and CI. */
export async function verifyGeneratedOutputOwnership(outDir: string): Promise<void> {
  await assertOwnedGeneratedOutput(path.resolve(outDir), 'generated output');
}

/**
 * Returns a fully ownership-verified marker for an existing generated tree. Missing and empty
 * destinations have no marker; non-empty unowned or modified destinations fail closed.
 */
export async function readVerifiedGeneratedOutputMarker(outDir: string): Promise<GeneratedOutputMarker | undefined> {
  assertSafeGeneratedOutputDir(outDir);
  const resolvedOutDir = path.resolve(outDir);
  let stat;
  try {
    stat = await fs.lstat(resolvedOutDir);
  } catch (error) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Refusing to inspect generated output because it is not a real directory: ${resolvedOutDir}`);
  }
  if ((await fs.readdir(resolvedOutDir)).length === 0) {
    return undefined;
  }
  return assertOwnedGeneratedOutput(resolvedOutDir, 'generated output');
}

async function claimGeneratedOutputDestination(outDir: string): Promise<void> {
  await ensureDir(path.dirname(outDir));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await fs.mkdir(outDir);
      return;
    } catch (error) {
      if (!isAlreadyExists(error)) {
        throw error;
      }
    }

    try {
      const stat = await fs.lstat(outDir);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`Refusing to replace generated output because it is not a real directory: ${outDir}`);
      }
      return;
    } catch (error) {
      if (isFileNotFound(error)) {
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Refusing to publish generated output because the destination is changing concurrently: ${outDir}`);
}

async function restoreGeneratedOutputBackup(backupDir: string, outDir: string, originalError: unknown): Promise<void> {
  if (await pathExists(outDir)) {
    throw new Error(
      `Could not restore generated output without overwriting a concurrently created destination. ` +
        `Original output remains at ${backupDir}; concurrent output remains at ${outDir}. ` +
        `Original error: ${originalError instanceof Error ? originalError.message : String(originalError)}`
    );
  }
  await fs.rename(backupDir, outDir);
}

async function assertReplaceableGeneratedOutput(outDir: string): Promise<boolean> {
  let stat;
  try {
    stat = await fs.lstat(outDir);
  } catch (error) {
    if (isFileNotFound(error)) {
      return false;
    }
    throw error;
  }

  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Refusing to replace generated output because it is not a real directory: ${outDir}`);
  }

  const entries = await fs.readdir(outDir);
  if (entries.length === 0) {
    return true;
  }

  await assertOwnedGeneratedOutput(outDir, 'existing destination');
  return true;
}

async function assertOwnedGeneratedOutput(outDir: string, label: string): Promise<GeneratedOutputMarker> {
  const markerPath = path.join(outDir, generatedOutputMarkerName);
  let markerStat;
  try {
    markerStat = await fs.lstat(markerPath);
  } catch (error) {
    if (isFileNotFound(error)) {
      throw new Error(
        `Refusing to replace non-empty ${label} without ${generatedOutputMarkerName}: ${outDir}`
      );
    }
    throw error;
  }
  if (markerStat.isSymbolicLink() || !markerStat.isFile()) {
    throw new Error(`Refusing to trust invalid generated-output marker: ${markerPath}`);
  }

  let marker: unknown;
  try {
    marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Refusing to replace ${label} with an unreadable generated-output marker: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!isGeneratedOutputMarker(marker)) {
    throw new Error(`Refusing to replace ${label} with an invalid generated-output marker: ${markerPath}`);
  }

  const actualHash = await hashGeneratedOutputInventory(outDir);
  if (actualHash !== marker.inventorySha256) {
    throw new Error(
      `Refusing to replace modified generated output at ${outDir}. Its files no longer match ${generatedOutputMarkerName}; ` +
        'move the directory aside and regenerate so no local work is lost.'
    );
  }
  return marker;
}

function isGeneratedOutputMarker(value: unknown): value is GeneratedOutputMarker {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<GeneratedOutputMarker>;
  return (
    candidate.generator === 'har-api-tests' &&
    (candidate.formatVersion === 1 ||
      (candidate.formatVersion === 2 &&
        isGenerationProvenance(candidate.provenance) &&
        candidate.generationFingerprintSha256 === candidate.provenance.fingerprintSha256)) &&
    typeof candidate.inventorySha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(candidate.inventorySha256) &&
    typeof candidate.notice === 'string'
  );
}

async function hashGeneratedOutputInventory(outDir: string): Promise<string> {
  const resolvedOutDir = path.resolve(outDir);
  const hash = createHash('sha256');
  await updateInventoryHash(hash, resolvedOutDir, resolvedOutDir);
  return hash.digest('hex');
}

async function updateInventoryHash(
  hash: ReturnType<typeof createHash>,
  rootDir: string,
  currentDir: string
): Promise<void> {
  const entries = (await fs.readdir(currentDir, { withFileTypes: true })).sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  );
  for (const entry of entries) {
    if (samePath(currentDir, rootDir) && entry.name === generatedOutputMarkerName) {
      continue;
    }
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join('/');
    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing to manage symbolic links in generated output: ${absolutePath}`);
    }
    if (entry.isDirectory()) {
      hash.update(`${JSON.stringify({ type: 'directory', path: relativePath })}\n`);
      await updateInventoryHash(hash, rootDir, absolutePath);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Refusing to manage unsupported filesystem entry in generated output: ${absolutePath}`);
    }
    const content = await fs.readFile(absolutePath);
    hash.update(
      `${JSON.stringify({
        type: 'file',
        path: relativePath,
        size: content.byteLength,
        sha256: createHash('sha256').update(content).digest('hex')
      })}\n`
    );
  }
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'EEXIST';
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (isFileNotFound(error)) {
      return false;
    }
    throw error;
  }
}
