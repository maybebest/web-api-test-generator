import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Resolve relative to the repo root (three levels above this file), not
// process.cwd(), so the local binary is found no matter where the caller runs.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function pinnedAgentBrowserVersion(repoRoot = REPO_ROOT) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const version = manifest.devDependencies?.['agent-browser'] ?? manifest.dependencies?.['agent-browser'];
    return typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) ? version : undefined;
  } catch {
    return undefined;
  }
}

export function resolveAgentBrowserBin(repoRoot = REPO_ROOT) {
  const extension = process.platform === 'win32' ? '.cmd' : '';
  const localBin = path.join(repoRoot, 'node_modules', '.bin', `agent-browser${extension}`);

  if (fs.existsSync(localBin)) {
    return { command: localBin, prefixArgs: [] };
  }

  // The npx fallback must be pinned to the lockfile version so an unpinned
  // "latest" package can never be pulled into the agent-browser path.
  const pinnedVersion = pinnedAgentBrowserVersion(repoRoot);
  if (!pinnedVersion) {
    throw new Error(
      'agent-browser binary is not installed and package.json does not pin an exact agent-browser version. Run "npm ci" first.'
    );
  }

  return { command: 'npx', prefixArgs: [`agent-browser@${pinnedVersion}`] };
}

export function runAgentBrowser(args, options = {}) {
  let resolved;
  try {
    resolved = resolveAgentBrowserBin();
  } catch (error) {
    return {
      status: 1,
      stdout: '',
      stderr: error.message
    };
  }

  const { command, prefixArgs } = resolved;
  const result = spawnSync(command, [...prefixArgs, ...args], {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
    shell: false,
    stdio: options.stdio ?? 'pipe'
  });

  if (result.error) {
    return {
      status: 1,
      stdout: result.stdout ?? '',
      stderr: `${result.stderr ?? ''}${result.error.message}`
    };
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}

export function parseJsonOutput(output) {
  const trimmed = String(output ?? '').trim();

  if (!trimmed) {
    throw new Error('Command returned empty output.');
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const jsonStart = Math.min(
      ...['{', '[']
        .map((char) => trimmed.indexOf(char))
        .filter((index) => index >= 0)
    );

    if (!Number.isFinite(jsonStart)) {
      throw new Error('Command output did not contain JSON.');
    }

    return JSON.parse(trimmed.slice(jsonStart));
  }
}
