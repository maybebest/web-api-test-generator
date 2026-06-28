import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function findHarFiles(inputs: string[]): Promise<string[]> {
  const files = new Set<string>();

  for (const input of inputs) {
    const resolved = path.resolve(input);
    const stat = await fs.stat(resolved);

    if (stat.isDirectory()) {
      for (const file of await walk(resolved)) {
        if (isHarInputFile(file)) {
          files.add(file);
        }
      }
      continue;
    }

    if (stat.isFile() && isHarInputFile(resolved)) {
      files.add(resolved);
    }
  }

  return [...files].sort();
}

function isHarInputFile(filePath: string): boolean {
  return ['.har', '.json', '.md'].some((extension) => filePath.toLowerCase().endsWith(extension));
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content) as T;
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeTextFile(filePath: string, value: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, value.endsWith('\n') ? value : `${value}\n`, 'utf8');
}

export async function removeGeneratedOutput(outDir: string): Promise<void> {
  assertSafeGeneratedOutputDir(outDir);
  await fs.rm(outDir, { recursive: true, force: true });
}

export function assertSafeGeneratedOutputDir(
  outDir: string,
  cwd = process.cwd(),
  homeDir = os.homedir()
): void {
  const resolvedOutDir = resolveFrom(cwd, outDir);
  const resolvedCwd = path.resolve(cwd);
  const resolvedHome = path.resolve(homeDir);
  const rootDir = path.parse(resolvedOutDir).root;

  const blockedTargets = new Map([
    [rootDir, 'filesystem root'],
    [resolvedCwd, 'project root'],
    [resolvedHome, 'home directory']
  ]);

  for (const [target, label] of blockedTargets) {
    if (samePath(resolvedOutDir, target)) {
      throw new Error(`Refusing to remove generated output at ${label}: ${resolvedOutDir}`);
    }
  }

  const cwdFromOutDir = path.relative(resolvedOutDir, resolvedCwd);
  if (cwdFromOutDir && !cwdFromOutDir.startsWith('..') && !path.isAbsolute(cwdFromOutDir)) {
    throw new Error(`Refusing to remove generated output from a parent of the project: ${resolvedOutDir}`);
  }

  const relativeToProject = path.relative(resolvedCwd, resolvedOutDir);
  const protectedProjectDirs = new Set(['config', 'dist', 'node_modules', 'src', 'tests']);
  const relativeSegments = relativeToProject.split(path.sep).filter(Boolean);

  if (
    relativeSegments.length === 1 &&
    !relativeToProject.startsWith('..') &&
    !path.isAbsolute(relativeToProject) &&
    protectedProjectDirs.has(relativeSegments[0])
  ) {
    throw new Error(`Refusing to remove protected project directory: ${resolvedOutDir}`);
  }
}

async function walk(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const resolved = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(resolved)));
      continue;
    }

    files.push(resolved);
  }

  return files.sort();
}

function resolveFrom(cwd: string, value: string): string {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(cwd, value);
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}
