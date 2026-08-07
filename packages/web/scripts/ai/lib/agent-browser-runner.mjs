import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Resolve relative to the repo root (three levels above this file), not
// process.cwd(), so the local binary is found no matter where the caller runs.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const FALLBACK_DOCUMENTATION = 'docs/ai-testing/AGENT_BROWSER.md#classified-failures-and-fallbacks';

const FALLBACKS = Object.freeze({
  timeout: {
    strategy: 'retry-once-then-playwright-cli',
    retryable: true,
    nextStep: 'Retry discovery once, then capture an accessibility snapshot with Playwright CLI.'
  },
  'http-401': {
    strategy: 'authenticated-playwright-fallback',
    retryable: false,
    nextStep: 'Stop agent-browser discovery and require configured authenticated Playwright profile/storage-state evidence.'
  },
  'http-403': {
    strategy: 'authenticated-playwright-or-policy-block',
    retryable: false,
    nextStep: 'Stop agent-browser discovery; require configured authenticated Playwright evidence and an allowlisted non-production origin.'
  },
  challenge: {
    strategy: 'blocked-by-anti-bot-policy',
    retryable: false,
    nextStep: 'Do not bypass the anti-bot challenge. Mark automated discovery blocked; optional visual evidence must remain non-blocking.'
  },
  captcha: {
    strategy: 'blocked-by-anti-bot-policy',
    retryable: false,
    nextStep: 'Do not automate CAPTCHA solving. Mark discovery blocked unless a configured non-production test bypass exists.'
  },
  'empty-snapshot': {
    strategy: 'playwright-cli-snapshot',
    retryable: true,
    nextStep: 'Retry once after page readiness, then use a Playwright CLI accessibility snapshot; screenshots remain opt-in.'
  },
  'process-failure': {
    strategy: 'doctor-then-playwright-cli',
    retryable: true,
    nextStep: 'Run the agent-browser doctor, retry once, then use Playwright CLI accessibility discovery.'
  }
});

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
    resolved = (options.resolveBin ?? resolveAgentBrowserBin)();
  } catch (error) {
    return finalizeResult({
      status: 1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      error
    }, options);
  }

  const { command, prefixArgs } = resolved;
  const timeoutMs = agentBrowserTimeoutMs(options.timeoutMs, { ...process.env, ...(options.env ?? {}) });
  let result;
  try {
    result = (options.spawnSyncImpl ?? spawnSync)(command, [...prefixArgs, ...args], {
      cwd: options.cwd ?? process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, ...(options.env ?? {}) },
      shell: false,
      stdio: options.stdio ?? 'pipe',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: MAX_OUTPUT_BYTES
    });
  } catch (error) {
    return finalizeResult(
      { status: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error), error },
      options,
      timeoutMs
    );
  }

  if (result.error) {
    return finalizeResult({
      status: 1,
      stdout: result.stdout ?? '',
      stderr: `${result.stderr ?? ''}${result.error.message}`,
      error: result.error,
      signal: result.signal
    }, options, timeoutMs);
  }

  return finalizeResult({
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    signal: result.signal
  }, options, timeoutMs);
}

export function agentBrowserTimeoutMs(explicitTimeout, env = process.env) {
  const candidate = explicitTimeout ?? env?.AGENT_BROWSER_TIMEOUT_MS;
  const parsed = Number(candidate);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(parsed, MAX_TIMEOUT_MS);
}

export function classifyAgentBrowserResult(result, options = {}) {
  const combinedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const errorCode = result.error?.code;

  if (errorCode === 'ETIMEDOUT' || result.timedOut === true) {
    return createAgentBrowserFailure('timeout', {
      detail: `agent-browser exceeded the ${result.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms process timeout.`
    });
  }
  if (/\b(?:hcaptcha|recaptcha|captcha(?:\s+iframe)?|cf-turnstile|turnstile\s+challenge)\b/i.test(combinedOutput)) {
    return createAgentBrowserFailure('captcha', { detail: excerpt(combinedOutput) });
  }
  if (/\b(?:cf-chl|cf-challenge|challenge-platform|checking your browser|just a moment|cloudflare\s+challenge)\b/i.test(combinedOutput)) {
    return createAgentBrowserFailure('challenge', { detail: excerpt(combinedOutput) });
  }
  if (/\b(?:401\s+unauthorized|unauthorized|status(?:\s+code)?[:=\s]+401|http(?:\/\d(?:\.\d)?)?\s+401)\b/i.test(combinedOutput)) {
    return createAgentBrowserFailure('http-401', { httpStatus: 401, detail: excerpt(combinedOutput) });
  }
  if (/\b(?:403\s+forbidden|forbidden|status(?:\s+code)?[:=\s]+403|http(?:\/\d(?:\.\d)?)?\s+403)\b/i.test(combinedOutput)) {
    return createAgentBrowserFailure('http-403', { httpStatus: 403, detail: excerpt(combinedOutput) });
  }
  if (
    options.expectSnapshot &&
    Number(result.status) === 0 &&
    (options.snapshotElementCount === 0 || !String(result.stdout ?? '').trim())
  ) {
    return createAgentBrowserFailure('empty-snapshot', {
      detail: options.snapshotElementCount === 0 ? 'Accessibility snapshot contained zero discoverable elements.' : 'Snapshot output was empty.'
    });
  }
  if (Number(result.status) !== 0 || result.error) {
    return createAgentBrowserFailure('process-failure', {
      detail: excerpt(combinedOutput) || result.error?.message || `agent-browser exited with status ${result.status}.`
    });
  }
  return null;
}

export function createAgentBrowserFailure(kind, details = {}) {
  const fallback = FALLBACKS[kind] ?? FALLBACKS['process-failure'];
  return {
    kind,
    ...details,
    fallback: {
      ...fallback,
      documentation: FALLBACK_DOCUMENTATION
    }
  };
}

export function formatAgentBrowserFailure(failure) {
  return `[${failure.kind}] ${failure.detail || 'agent-browser discovery failed.'} Fallback: ${failure.fallback.nextStep}`;
}

function finalizeResult(
  result,
  options,
  timeoutMs = agentBrowserTimeoutMs(options.timeoutMs, { ...process.env, ...(options.env ?? {}) })
) {
  const normalized = {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    signal: result.signal ?? null,
    timeoutMs,
    timedOut: result.error?.code === 'ETIMEDOUT'
  };
  return {
    ...normalized,
    failure: classifyAgentBrowserResult({ ...normalized, error: result.error }, options)
  };
}

function excerpt(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
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
