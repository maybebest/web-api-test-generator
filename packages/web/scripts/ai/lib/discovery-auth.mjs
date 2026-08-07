import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve the optional Playwright storage-state file used by agent-browser discovery.
 * The file is never read here: agent-browser receives only its absolute path.
 */
export function resolveDiscoveryAuthStatePath(env = process.env) {
  const configuredPath = env.E2E_AUTH_STATE_PATH?.trim();
  if (!configuredPath) {
    return undefined;
  }

  const absolutePath = path.resolve(configuredPath);
  let stats;
  try {
    stats = fs.statSync(absolutePath);
  } catch {
    throw new Error('E2E_AUTH_STATE_PATH must point to an existing regular file before DOM discovery can start.');
  }

  if (!stats.isFile()) {
    throw new Error('E2E_AUTH_STATE_PATH must point to an existing regular file before DOM discovery can start.');
  }

  return absolutePath;
}

/**
 * Agent-browser 0.27 parses --state as a global option, so it must appear before
 * the `open` command. Keep this ordering covered independently of process spawning.
 */
export function buildAgentBrowserOpenArgs({ session, url, authStatePath }) {
  return [
    '--session',
    session,
    ...(authStatePath ? ['--state', authStatePath] : []),
    'open',
    url
  ];
}
