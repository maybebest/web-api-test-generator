import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { knownSecretEnvValues } from './gate-environment.mjs';
import { EXTERNAL_BROWSER_PROJECTS } from './generation-preflight.mjs';

export const ENVIRONMENT_PREFLIGHT_STAGE = 'environment-preflight';
export const ENVIRONMENT_PREFLIGHT_FAILURE_REASON = 'environment-preflight';
export const ORIGIN_PROBE_TIMEOUT_MS = 10_000;
export const ORIGIN_PROBE_RETRY_DELAY_MS = 2_000;
const CONFIG_LOAD_TIMEOUT_MS = 60_000;
const MAX_DIAGNOSTIC_CHARS = 500;

function parseBoolean(value, name, defaultValue) {
  if (value === undefined || String(value).trim() === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  throw new Error(`${name} must be true or false.`);
}

// Deterministic escape hatch, default ON: the preflight only spends local
// spawn/probe time and can never charge a provider, so opting out is explicit.
export function environmentPreflightEnabled(env = process.env) {
  return parseBoolean(env.AI_ENV_PREFLIGHT, 'AI_ENV_PREFLIGHT', true);
}

function sanitizedDiagnostic(value, secretValues = []) {
  let text = String(value ?? '');
  // Redact by known value first (longest-first so overlapping secrets cannot
  // leave partial suffixes), matching the heal-test.mjs convention.
  for (const secret of [...secretValues].sort((left, right) => right.length - left.length)) {
    text = text.split(secret).join('<redacted>');
  }
  return text
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    // The FIRST lines of a Node child's stderr carry the thrown message; the
    // tail is stack frames, so keep the front when bounding.
    .slice(0, MAX_DIAGNOSTIC_CHARS);
}

const TYPESCRIPT_NATIVE_MIN_VERSION = [22, 18];
const TYPESCRIPT_STRIP_FLAG_MIN_VERSION = [22, 6];

function nodeVersionAtLeast(version, [major, minor]) {
  const [actualMajor = 0, actualMinor = 0] = String(version ?? '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  return actualMajor > major || (actualMajor === major && actualMinor >= minor);
}

// The config-load child imports playwright.config.ts, which needs TypeScript
// type stripping, but the package engines allow any Node >= 20: run plain
// where stripping is native (process.features.typescript, default since
// 22.18), pass --experimental-strip-types on 22.6+, and otherwise skip the
// check with a recorded diagnostic instead of failing a runtime that could
// never load the config. The origin probe is unaffected by the skip.
function typeStrippingPlan({ nodeFeatures, nodeVersion }) {
  if (nodeFeatures?.typescript || nodeVersionAtLeast(nodeVersion, TYPESCRIPT_NATIVE_MIN_VERSION)) {
    return { execArgs: [] };
  }
  if (nodeVersionAtLeast(nodeVersion, TYPESCRIPT_STRIP_FLAG_MIN_VERSION)) {
    return { execArgs: ['--experimental-strip-types'] };
  }
  return {
    skipDiagnostic: `Playwright config load check skipped: Node ${nodeVersion} cannot strip TypeScript types (needs Node 22.6 or newer).`
  };
}

/**
 * Loads the target project's Playwright config in a child Node process under
 * the sanitized gate environment built for the selected project plan's
 * runtime profile (the fast-gate later sanitizes per project). A config whose
 * load-time guards throw (for example E2E_AUTH_ENABLED=true without
 * PLAYWRIGHT_TEST_BASE_URL) would otherwise only fail after provider tokens
 * were already spent. The child imports the config and executes nothing else.
 */
export function checkPlaywrightConfigLoads({
  webRoot,
  env = {},
  spawnSyncImpl = spawnSync,
  timeoutMs = CONFIG_LOAD_TIMEOUT_MS,
  nodeFeatures = process.features,
  nodeVersion = process.versions.node
} = {}) {
  const configPath = path.join(path.resolve(webRoot ?? '.'), 'playwright.config.ts');
  if (!fs.existsSync(configPath)) {
    return { passed: false, diagnostics: [`Playwright config was not found: ${configPath} (expected playwright.config.ts).`] };
  }
  const strippingPlan = typeStrippingPlan({ nodeFeatures, nodeVersion });
  if (strippingPlan.skipDiagnostic) {
    return { passed: true, skipped: true, diagnostics: [strippingPlan.skipDiagnostic] };
  }
  const secretValues = knownSecretEnvValues(env);
  const script = `await import(${JSON.stringify(pathToFileURL(configPath).href)});`;
  const child = spawnSyncImpl(process.execPath, [...strippingPlan.execArgs, '--input-type=module', '-e', script], {
    cwd: path.dirname(configPath),
    env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: timeoutMs
  });
  if (child.error) {
    return { passed: false, diagnostics: [`Playwright config load child failed to run: ${child.error.message}`] };
  }
  if (child.status !== 0) {
    const stderr = sanitizedDiagnostic(child.stderr, secretValues);
    return {
      passed: false,
      diagnostics: [
        `Playwright config failed to load under the sanitized gate environment (exit ${child.status ?? 'signal'}): `
          + (stderr || 'no error output')
      ]
    };
  }
  return { passed: true, diagnostics: [] };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestOnce(origin, method, { timeoutMs, fetchImpl }) {
  const response = await fetchImpl(origin, {
    method,
    redirect: 'manual',
    headers: { accept: '*/*' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  // Any HTTP status — including 3xx/4xx/5xx — proves a server answered on the
  // origin. Cancel the body so a GET fallback never downloads a page.
  try { await response.body?.cancel(); } catch {}
  return response.status;
}

/**
 * Proves the origin the generated test will hit answers HTTP at all: HEAD
 * first, GET when HEAD fails at the transport level, and one retry of that
 * cycle after a fixed delay. Only DNS/connect/TLS/timeout failures count as
 * unreachable; an application-level error status is still a live environment.
 */
export async function probeOriginReachability(origin, {
  timeoutMs = ORIGIN_PROBE_TIMEOUT_MS,
  retryDelayMs = ORIGIN_PROBE_RETRY_DELAY_MS,
  fetchImpl = fetch,
  sleep = defaultSleep
} = {}) {
  const diagnostics = [];
  for (let cycle = 0; cycle < 2; cycle += 1) {
    if (cycle > 0) await sleep(retryDelayMs);
    for (const method of ['HEAD', 'GET']) {
      try {
        const httpStatus = await requestOnce(origin, method, { timeoutMs, fetchImpl });
        return { reachable: true, httpStatus, method, diagnostics: [] };
      } catch (error) {
        diagnostics.push(sanitizedDiagnostic(
          `${method} ${origin} failed${cycle > 0 ? ' after retry' : ''}: ${error?.cause?.message ?? error?.message ?? error}`
        ));
      }
    }
  }
  return { reachable: false, httpStatus: null, method: null, diagnostics };
}

/**
 * The deterministic environment-preflight stage: (a) the Playwright config
 * must load under the sanitized gate environment built for the plan's runtime
 * profile (skipped with a diagnostic on runtimes without TypeScript type
 * stripping), and (b) when the selected project plan targets an external
 * browser project, the origin behind PLAYWRIGHT_TEST_BASE_URL must answer
 * HTTP. Local-fixture-only plans skip the probe because Playwright starts
 * that server itself. No provider is ever involved.
 */
export async function checkEnvironmentPreflight({
  projects = [],
  env = {},
  webRoot,
  spawnSyncImpl,
  fetchImpl,
  timeoutMs,
  retryDelayMs,
  sleep,
  nodeFeatures,
  nodeVersion
} = {}) {
  const configResult = checkPlaywrightConfigLoads({
    webRoot,
    env,
    ...(spawnSyncImpl ? { spawnSyncImpl } : {}),
    ...(nodeFeatures !== undefined ? { nodeFeatures } : {}),
    ...(nodeVersion !== undefined ? { nodeVersion } : {})
  });
  if (!configResult.passed) {
    return { passed: false, probedOrigin: null, httpStatus: null, diagnostics: configResult.diagnostics };
  }
  // A skipped config-load check records its diagnostic on every later return
  // so the telemetry never claims the config was actually loaded.
  const configDiagnostics = Array.isArray(configResult.diagnostics) ? configResult.diagnostics : [];

  const usesExternalBrowser = (Array.isArray(projects) ? projects : [])
    .some((entry) => EXTERNAL_BROWSER_PROJECTS.has(entry?.project));
  if (!usesExternalBrowser) {
    return { passed: true, probedOrigin: null, httpStatus: null, diagnostics: configDiagnostics };
  }

  const rawBaseUrl = String(env.PLAYWRIGHT_TEST_BASE_URL ?? '').trim();
  if (!rawBaseUrl) {
    return {
      passed: false,
      probedOrigin: null,
      httpStatus: null,
      diagnostics: [...configDiagnostics, 'PLAYWRIGHT_TEST_BASE_URL is required to probe the external target origin.']
    };
  }
  let origin;
  try {
    origin = new URL(rawBaseUrl).origin;
  } catch {
    return {
      passed: false,
      probedOrigin: null,
      httpStatus: null,
      diagnostics: [...configDiagnostics, 'PLAYWRIGHT_TEST_BASE_URL must be a valid absolute URL to probe the external target origin.']
    };
  }

  const probe = await probeOriginReachability(origin, {
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(retryDelayMs !== undefined ? { retryDelayMs } : {}),
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(sleep ? { sleep } : {})
  });
  return {
    passed: probe.reachable,
    probedOrigin: origin,
    httpStatus: probe.httpStatus,
    diagnostics: probe.reachable
      ? configDiagnostics
      : [...configDiagnostics, `Target origin ${origin} is unreachable.`, ...probe.diagnostics]
  };
}
