import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL, URLSearchParams } from 'node:url';

import { createManifest } from '../create-generation-task.mjs';
import {
  classifyAgentBrowserResult,
  parseJsonOutput,
  runAgentBrowser
} from './agent-browser-runner.mjs';
import { resolveDiscoveryAuthStatePath } from './discovery-auth.mjs';
import { buildGenerationInputFromValidatedSpec } from './generation-input.mjs';
import { GENERATION_POLICY_VERSION } from './generation-policy.mjs';
import { resolveGenerationMode, specGenerationMode, specSha256 } from './spec-parser.mjs';
import { validateSpecFile } from '../validate-flow-spec.mjs';

const DEFAULT_WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MAX_SESSIONS = 32;
const MAX_SESSION_STEPS = 25;
const MAX_SPEC_BYTES = 512 * 1024;
const MAX_TASK_BYTES = 1024 * 1024;
const MAX_INPUT_LINE = 2_048;
const MAX_VALUE_LENGTH = 2_000;
const MAX_PREVIEW_LENGTH = 6_000;
const MAX_SNAPSHOT_LENGTH = 8_000;
const MAX_RETURNED_REFS = 100;
const MAX_REDACTION_VALUES = 25;
const SESSION_TTL_MS = 30 * 60 * 1_000;
const ALLOWED_ACTIONS = new Set(['goto', 'click', 'fill', 'select', 'check', 'uncheck', 'press', 'expect']);
const REF_ACTIONS = new Set(['click', 'fill', 'select', 'check', 'uncheck', 'expect']);
const DESTRUCTIVE_NAME_PATTERN = /\b(?:delete|remove|destroy|publish|book|pay|purchase|submit|save|confirm|proceed)\b/i;
const SENSITIVE_TARGET_PATTERN = /\b(?:password|passcode|secret|token|one[- ]?time|otp|verification code|card number|cvv|cvc)\b/i;
const SENSITIVE_URL_PARAM_PATTERN = /^(?:access_?token|auth|authorization|code|credential|key|otp|pass(?:word|code)?|secret|session|sid|signature|sig|token)$/i;
const SECRET_TEXT_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\b(?:sk|xox[baprs])-[A-Za-z0-9_-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g
];
const LABELED_SECRET_PATTERN = /\b(password|passcode|secret|token|otp|session(?:id)?|authorization)\s*[:=]\s*[^\s,;]+/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const CARD_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;
const PHONE_PATTERN = /(?:^|(?<=\s))(?:\+?\d[\d ()-]{8,}\d)(?=$|[\s,;.])/g;

export class McpToolError extends Error {
  constructor(code, message, data = undefined) {
    super(message);
    this.name = 'McpToolError';
    this.code = code;
    this.data = data;
  }
}

export const MCP_TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'plan',
    description: 'Validate an existing flow spec with deterministic policy checks and create a bounded in-memory execution session. No browser action or file write occurs.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['specPath'],
      properties: {
        specPath: {
          type: 'string',
          minLength: 1,
          maxLength: 240,
          pattern: '^specs/[A-Za-z0-9._/-]+\\.md$'
        }
      }
    }
  },
  {
    name: 'act_step',
    description: 'Execute one bounded agent-browser step in a validated plan session, then return a redacted interactive snapshot and fresh element refs. Destructive actions are denied unless an exact machine-policy allowlist entry permits them.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['sessionId', 'action'],
      properties: {
        sessionId: { type: 'string', minLength: 8, maxLength: 128 },
        action: { enum: [...ALLOWED_ACTIONS] },
        url: { type: 'string', minLength: 1, maxLength: MAX_INPUT_LINE },
        ref: { type: 'string', pattern: '^@e[1-9][0-9]*$', maxLength: 16 },
        value: { type: 'string', maxLength: MAX_VALUE_LENGTH },
        key: { enum: ['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'Space'] },
        expectation: { enum: ['visible', 'enabled', 'checked'] }
      }
    }
  },
  {
    name: 'generate_test',
    description: 'Create a preview or atomically write the human task, canonical provider input, and bound manifest under .ai-runs. This tool does not generate Playwright code.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['sessionId'],
      properties: {
        sessionId: { type: 'string', minLength: 8, maxLength: 128 },
        write: { type: 'boolean', default: false }
      }
    }
  }
]);

export function createMcpTools(options = {}) {
  const fileSystem = options.fileSystem ?? fs;
  const webRoot = fileSystem.realpathSync(path.resolve(options.webRoot ?? DEFAULT_WEB_ROOT));
  const validateSpec = options.validateSpec ?? validateSpecFile;
  const browserRunner = options.runBrowser ?? runAgentBrowser;
  const now = options.now ?? (() => new Date());
  const tokenFactory = options.tokenFactory ?? defaultToken;
  const env = options.env ?? process.env;
  const destructiveActionAllowlist = loadDestructiveActionAllowlist(
    options.destructiveActionAllowlist ?? env.MCP_DESTRUCTIVE_ACTION_ALLOWLIST
  );
  const allowedDomains = loadAllowedDomains(webRoot);
  const authStatePath = resolveAuthStateForRoot(env, webRoot);
  const sessions = new Map();

  return {
    definitions: MCP_TOOL_DEFINITIONS,
    async call(name, args = {}) {
      if (name === 'plan') return plan(args);
      if (name === 'act_step') return actStep(args);
      if (name === 'generate_test') return generateTask(args);
      throw new McpToolError('UNKNOWN_TOOL', `Unknown tool: ${boundedString(name, 80)}`);
    },
    async close() {
      for (const session of sessions.values()) {
        if (session.browserTouched) {
          await runBrowserSafely(['--session', session.browserSession, 'close'], { tolerateFailure: true });
        }
      }
      sessions.clear();
    }
  };

  async function plan(args) {
    assertObjectWithKeys(args, ['specPath'], ['specPath']);
    const specPath = requiredString(args.specPath, 'specPath', 240);
    if (!/^specs\/[A-Za-z0-9._/-]+\.md$/.test(specPath)) {
      throw new McpToolError('INVALID_SPEC_PATH', 'specPath must be a relative Markdown file under specs/.');
    }
    await pruneExpiredSessions();
    if (sessions.size >= MAX_SESSIONS) {
      throw new McpToolError('SESSION_LIMIT', `At most ${MAX_SESSIONS} MCP plan sessions may be active.`);
    }

    const absoluteSpecPath = resolveContainedFile(path.join(webRoot, 'specs'), path.resolve(webRoot, specPath), {
      extension: '.md',
      maxBytes: MAX_SPEC_BYTES,
      label: 'specPath'
    });
    const validation = validateSpec(absoluteSpecPath);
    if (!validation?.valid) {
      const issue = validation?.issues?.[0] ?? 'Spec must pass deterministic validation.';
      throw new McpToolError('SPEC_INVALID', redactSensitiveText(issue));
    }
    if (!Array.isArray(validation.flowSteps) || validation.flowSteps.length > MAX_SESSION_STEPS) {
      throw new McpToolError('PLAN_TOO_LARGE', `Flow plans may contain at most ${MAX_SESSION_STEPS} steps.`);
    }

    const targetTestFile = assertTargetTestFile(validation.metadata?.['Target Test File'], webRoot);
    let generationMode;
    try {
      generationMode = resolveGenerationMode({ specMode: specGenerationMode(validation.metadata) });
    } catch (error) {
      throw new McpToolError('INVALID_GENERATION_MODE', redactSensitiveText(error.message));
    }

    const sessionId = tokenFactory('session');
    const createdAt = now();
    const relativeSpecPath = normalizePath(path.relative(webRoot, absoluteSpecPath));
    const session = {
      sessionId,
      browserSession: `mcp-${tokenFactory('browser').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48)}`,
      createdAtMs: createdAt.getTime(),
      lastUsedAtMs: createdAt.getTime(),
      stepCount: 0,
      browserTouched: false,
      latestRefs: new Map(),
      redactionValues: new Set(),
      relativeSpecPath,
      absoluteSpecPath,
      validation,
      generationMode,
      targetTestFile
    };
    sessions.set(sessionId, session);

    return {
      kind: 'validated-plan',
      sessionId,
      flowId: boundedString(validation.metadata['Flow ID'], 100),
      specVersion: boundedString(validation.metadata['Spec Version'], 40),
      generationMode,
      basePath: boundedString(validation.metadata['Base Path'], 500),
      targetTestFile,
      acceptanceCriteria: (validation.acceptanceCriteria ?? []).slice(0, 50).map((value) => boundedString(value, 20)),
      steps: validation.flowSteps.map(boundedPlanStep),
      policyVerdict: {
        decision: 'allow',
        engine: 'deterministic-spec-policy',
        destructiveActions: destructiveActionAllowlist.size > 0 ? 'exact-allowlist' : 'deny'
      },
      limits: {
        maxSteps: MAX_SESSION_STEPS,
        maxReturnedRefs: MAX_RETURNED_REFS,
        destructiveActions: destructiveActionAllowlist.size > 0 ? 'exact machine allowlist' : 'denied by default'
      }
    };
  }

  async function actStep(args) {
    assertObjectWithKeys(
      args,
      ['sessionId', 'action', 'url', 'ref', 'value', 'key', 'expectation'],
      ['sessionId', 'action']
    );
    const session = await requireSession(args.sessionId);
    const action = requiredString(args.action, 'action', 20);
    if (!ALLOWED_ACTIONS.has(action)) {
      throw new McpToolError('INVALID_ACTION', 'action is not in the allowed MCP action enum.');
    }
    assertActionShape(action, args);
    if (session.stepCount >= MAX_SESSION_STEPS) {
      throw new McpToolError('STEP_LIMIT', `Session step limit of ${MAX_SESSION_STEPS} has been reached.`);
    }

    const command = buildActionCommand(session, action, args);
    assertDestructiveActionAllowed(action, args, command.refMetadata);
    if ((action === 'fill' || action === 'select') && session.redactionValues.size < MAX_REDACTION_VALUES) {
      session.redactionValues.add(String(args.value));
    }

    let expectationMet;
    session.browserTouched = true;
    const result = await runBrowserSafely(command.args);
    if (action === 'expect') {
      expectationMet = extractBooleanResult(result.stdout, args.expectation);
    }

    session.stepCount += 1;
    session.lastUsedAtMs = now().getTime();
    session.latestRefs.clear();
    const snapshot = await captureSnapshot(session);

    return {
      kind: 'executed-step',
      sessionId: session.sessionId,
      action,
      step: session.stepCount,
      ...(action === 'goto' ? { url: safeUrlForOutput(args.url) } : {}),
      ...(action === 'expect' ? { expectation: args.expectation, expectationMet } : {}),
      snapshot
    };
  }

  function buildActionCommand(session, action, args) {
    const prefix = ['--session', session.browserSession];
    if (action === 'goto') {
      const url = assertAllowedUrl(args.url, allowedDomains);
      return {
        args: [
          ...prefix,
          ...(authStatePath ? ['--state', authStatePath] : []),
          'open',
          url
        ]
      };
    }

    if (REF_ACTIONS.has(action)) {
      const ref = requiredString(args.ref, 'ref', 16);
      if (!/^@e[1-9]\d*$/.test(ref) || !session.latestRefs.has(ref)) {
        throw new McpToolError('STALE_OR_UNKNOWN_REF', 'Locator actions may use only an element ref from the latest returned snapshot.');
      }
      const refMetadata = session.latestRefs.get(ref);
      if ((action === 'fill' || action === 'select') && SENSITIVE_TARGET_PATTERN.test(`${refMetadata.role ?? ''} ${refMetadata.name ?? ''}`)) {
        throw new McpToolError('SENSITIVE_TARGET', 'MCP actions may not enter credentials, tokens, payment data, or one-time codes. Use configured auth state instead.');
      }
      if (action === 'fill' || action === 'select') {
        const value = requiredString(args.value, 'value', MAX_VALUE_LENGTH, { allowEmpty: action === 'fill' });
        assertSafeActionValue(value);
        return { args: [...prefix, action, ref, value], refMetadata };
      }
      if (action === 'expect') {
        const expectation = requiredString(args.expectation, 'expectation', 20);
        if (!['visible', 'enabled', 'checked'].includes(expectation)) {
          throw new McpToolError('INVALID_EXPECTATION', 'expectation must be visible, enabled, or checked.');
        }
        return { args: [...prefix, 'is', expectation, ref, '--json'], refMetadata };
      }
      return { args: [...prefix, action, ref], refMetadata };
    }

    if (action === 'press') {
      const key = requiredString(args.key, 'key', 20);
      if (!['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'Space'].includes(key)) {
        throw new McpToolError('INVALID_KEY', 'key is outside the bounded MCP key allowlist.');
      }
      return { args: [...prefix, 'press', key] };
    }

    throw new McpToolError('INVALID_ACTION', 'Unsupported MCP action.');
  }

  function assertDestructiveActionAllowed(action, args, refMetadata) {
    const isDestructive =
      (['click', 'select', 'check', 'uncheck'].includes(action) &&
        DESTRUCTIVE_NAME_PATTERN.test(`${refMetadata?.role ?? ''} ${refMetadata?.name ?? ''}`)) ||
      (action === 'press' && ['Enter', 'Space'].includes(args.key));
    if (!isDestructive) {
      return;
    }

    const target = action === 'press' ? String(args.key ?? '') : String(refMetadata?.name ?? '');
    const policyKey = normalizePolicyEntry(`${action}:${target}`);
    if (destructiveActionAllowlist.has(policyKey)) return;

    throw new McpToolError(
      'ACTION_BLOCKED_BY_POLICY',
      'This action appears destructive and is not present in the exact machine-policy allowlist.',
      {
        action,
        target: redactSensitiveText(target).slice(0, 160),
        policy: 'deny-by-default; configure MCP_DESTRUCTIVE_ACTION_ALLOWLIST with exact action:accessible-name entries'
      }
    );
  }

  async function captureSnapshot(session) {
    const result = await runBrowserSafely(
      ['--session', session.browserSession, 'snapshot', '-i', '--json'],
      { expectSnapshot: true }
    );
    let parsed;
    try {
      parsed = parseJsonOutput(result.stdout);
    } catch {
      throw new McpToolError('INVALID_SNAPSHOT', 'agent-browser returned an invalid JSON snapshot.');
    }

    const data = parsed?.data ?? parsed;
    const refsObject = data?.refs && typeof data.refs === 'object' && !Array.isArray(data.refs) ? data.refs : {};
    const refs = Object.entries(refsObject)
      .filter(([key]) => /^e[1-9]\d*$/.test(key))
      .slice(0, MAX_RETURNED_REFS)
      .map(([key, metadata]) => {
        const normalized = {
          ref: `@${key}`,
          role: boundedString(metadata?.role, 80, session.redactionValues),
          name: boundedString(metadata?.name, 160, session.redactionValues)
        };
        session.latestRefs.set(normalized.ref, {
          role: String(metadata?.role ?? '').slice(0, 1_000),
          name: String(metadata?.name ?? '').slice(0, 1_000)
        });
        return normalized;
      });

    const snapshotFailure = classifyAgentBrowserResult(result, {
      expectSnapshot: true,
      snapshotElementCount: refs.length
    });
    if (snapshotFailure) {
      session.latestRefs.clear();
      throw browserFailure(snapshotFailure);
    }

    const rawSnapshot = typeof data?.snapshot === 'string' ? data.snapshot : JSON.stringify(data?.snapshot ?? '');
    const redacted = redactSensitiveText(rawSnapshot, session.redactionValues);
    return {
      text: truncate(redacted, MAX_SNAPSHOT_LENGTH),
      truncated: redacted.length > MAX_SNAPSHOT_LENGTH || Object.keys(refsObject).length > MAX_RETURNED_REFS,
      refs
    };
  }

  async function generateTask(args) {
    assertObjectWithKeys(args, ['sessionId', 'write'], ['sessionId']);
    const session = await requireSession(args.sessionId);
    if (args.write !== undefined && typeof args.write !== 'boolean') {
      throw new McpToolError('INVALID_ARGUMENT', 'write must be a boolean.');
    }
    const write = args.write === true;
    const createdAt = now();
    const createdAtIso = createdAt.toISOString();
    const generationInput = buildGenerationInputFromValidatedSpec({
      specPath: session.relativeSpecPath,
      targetTestFile: session.targetTestFile,
      validation: session.validation,
      specSha256: specSha256(session.absoluteSpecPath),
      mode: session.generationMode,
      webRoot
    });
    const taskContent = generationInput.agentTask;
    const providerInput = generationInput.prompt;
    if (Buffer.byteLength(taskContent, 'utf8') > MAX_TASK_BYTES) {
      throw new McpToolError('TASK_TOO_LARGE', 'Generation task exceeds the MCP size limit.');
    }
    if (Buffer.byteLength(providerInput, 'utf8') > MAX_TASK_BYTES) {
      throw new McpToolError('TASK_TOO_LARGE', 'Canonical provider input exceeds the MCP size limit.');
    }
    const manifest = createManifest({
      specPath: session.relativeSpecPath,
      targetTestFile: session.targetTestFile,
      sha256: generationInput.specSha256,
      flowId: session.validation.metadata['Flow ID'],
      specVersion: session.validation.metadata['Spec Version'],
      domArtifactPath: undefined,
      validation: session.validation,
      generationMode: session.generationMode,
      agentTaskSha256: crypto.createHash('sha256').update(taskContent).digest('hex'),
      agentTaskBytes: Buffer.byteLength(taskContent, 'utf8'),
      providerInputPath: 'provider-input.md',
      providerInputSha256: crypto.createHash('sha256').update(providerInput).digest('hex'),
      providerInputBytes: Buffer.byteLength(providerInput, 'utf8'),
      policyVersion: GENERATION_POLICY_VERSION,
      contextFingerprint: generationInput.contextPack.fingerprint,
      generationFingerprint: generationInput.ir.fingerprint,
      createdAt: createdAtIso
    });
    const preview = truncate(redactSensitiveText(taskContent, session.redactionValues), MAX_PREVIEW_LENGTH);

    if (!write) {
      return {
        kind: 'generation-task-preview',
        generatedCode: false,
        wroteFiles: false,
        bytes: Buffer.byteLength(taskContent, 'utf8'),
        preview,
        note: 'This is a generation-task preview; no Playwright code or file was generated.'
      };
    }

    const paths = writeGenerationTask({
      webRoot,
      taskContent,
      providerInput,
      manifest,
      createdAt,
      tokenFactory,
      fileSystem
    });
    return {
      kind: 'generation-task-written',
      generatedCode: false,
      wroteFiles: true,
      taskPath: paths.taskPath,
      providerInputPath: paths.providerInputPath,
      manifestPath: paths.manifestPath,
      bytes: Buffer.byteLength(taskContent, 'utf8'),
      preview,
      note: 'Human task, canonical provider input, and manifest written under .ai-runs; Playwright code was not generated.'
    };
  }

  async function requireSession(sessionIdValue) {
    const sessionId = requiredString(sessionIdValue, 'sessionId', 128);
    const session = sessions.get(sessionId);
    if (!session) {
      throw new McpToolError('INVALID_SESSION', 'Unknown or expired MCP plan session.');
    }
    if (now().getTime() - session.lastUsedAtMs > SESSION_TTL_MS) {
      if (session.browserTouched) {
        await runBrowserSafely(['--session', session.browserSession, 'close'], { tolerateFailure: true });
      }
      sessions.delete(sessionId);
      throw new McpToolError('SESSION_EXPIRED', 'MCP plan session has expired. Create a new validated plan.');
    }
    session.lastUsedAtMs = now().getTime();
    return session;
  }

  async function pruneExpiredSessions() {
    const cutoff = now().getTime() - SESSION_TTL_MS;
    for (const [sessionId, session] of sessions) {
      if (session.lastUsedAtMs >= cutoff) continue;
      if (session.browserTouched) {
        await runBrowserSafely(['--session', session.browserSession, 'close'], { tolerateFailure: true });
      }
      sessions.delete(sessionId);
    }
  }

  async function runBrowserSafely(args, { expectSnapshot = false, tolerateFailure = false } = {}) {
    let result;
    try {
      result = await browserRunner(args, { cwd: webRoot, stdio: 'pipe', expectSnapshot });
    } catch {
      if (tolerateFailure) return undefined;
      throw new McpToolError('AGENT_BROWSER_ERROR', 'agent-browser execution failed before returning a classified result.');
    }
    if (result?.failure || Number(result?.status) !== 0) {
      if (tolerateFailure) return result;
      throw browserFailure(result?.failure);
    }
    return result;
  }
}

function loadAllowedDomains(webRoot) {
  const configPath = path.join(webRoot, 'agent-browser.json');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    throw new McpToolError('DOMAIN_POLICY_MISSING', 'MCP browser actions require a valid agent-browser.json domain policy.');
  }
  const domains = Array.isArray(parsed.allowedDomains)
    ? parsed.allowedDomains.map((value) => String(value).trim().toLowerCase()).filter(Boolean)
    : [];
  if (domains.length === 0 || domains.length > 100) {
    throw new McpToolError('DOMAIN_POLICY_INVALID', 'agent-browser.json must define 1-100 allowedDomains entries.');
  }
  return domains;
}

function resolveAuthStateForRoot(env, webRoot) {
  const configured = env.E2E_AUTH_STATE_PATH?.trim();
  if (!configured) return undefined;
  const absolute = path.isAbsolute(configured) ? configured : path.resolve(webRoot, configured);
  return resolveDiscoveryAuthStatePath({ ...env, E2E_AUTH_STATE_PATH: absolute });
}

function resolveContainedFile(root, candidate, { extension, maxBytes, label }) {
  let rootReal;
  let candidateReal;
  try {
    rootReal = fs.realpathSync(root);
    candidateReal = fs.realpathSync(candidate);
  } catch {
    throw new McpToolError('FILE_NOT_FOUND', `${label} must name an existing repository file.`);
  }
  if (!pathInside(candidateReal, rootReal) || !candidateReal.endsWith(extension)) {
    throw new McpToolError('PATH_OUTSIDE_ROOT', `${label} must remain under ${path.basename(root)}/.`);
  }
  const stats = fs.statSync(candidateReal);
  if (!stats.isFile() || stats.size > maxBytes) {
    throw new McpToolError('FILE_SIZE', `${label} must be a regular file no larger than ${maxBytes} bytes.`);
  }
  return candidateReal;
}

function assertTargetTestFile(value, webRoot) {
  const target = requiredString(value, 'Target Test File', 260);
  if (path.isAbsolute(target) || !target.endsWith('.spec.ts')) {
    throw new McpToolError('INVALID_TARGET_PATH', 'Target Test File must be a relative .spec.ts file under tests/.');
  }
  const resolved = path.resolve(webRoot, target);
  if (!pathInside(resolved, path.join(webRoot, 'tests'))) {
    throw new McpToolError('INVALID_TARGET_PATH', 'Target Test File must remain under tests/.');
  }
  return normalizePath(path.relative(webRoot, resolved));
}

function assertAllowedUrl(value, allowedDomains) {
  const raw = requiredString(value, 'url', MAX_INPUT_LINE);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new McpToolError('INVALID_URL', 'goto requires an absolute HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new McpToolError('INVALID_URL', 'goto accepts only credential-free HTTP(S) URLs.');
  }
  const host = url.hostname.toLowerCase();
  if (!allowedDomains.some((allowed) => hostMatches(host, allowed))) {
    throw new McpToolError('DOMAIN_NOT_ALLOWED', 'goto URL is outside agent-browser.json allowedDomains.');
  }
  for (const [name, parameterValue] of [...url.searchParams.entries(), ...fragmentParameters(url.hash)]) {
    if (SENSITIVE_URL_PARAM_PATTERN.test(name) || looksSecret(parameterValue)) {
      throw new McpToolError('SENSITIVE_URL', 'goto URL contains a credential, token, OTP, or session-like value.');
    }
  }
  if (looksSecret(url.pathname)) {
    throw new McpToolError('SENSITIVE_URL', 'goto URL path contains a secret-like value.');
  }
  return url.toString();
}

function fragmentParameters(hash) {
  const text = String(hash ?? '').replace(/^#/, '');
  const queryIndex = text.indexOf('?');
  const candidate = queryIndex >= 0 ? text.slice(queryIndex + 1) : text.includes('=') ? text : '';
  return candidate ? [...new URLSearchParams(candidate).entries()] : [];
}

function hostMatches(host, allowed) {
  if (allowed.startsWith('*.')) {
    const bare = allowed.slice(2);
    return host === bare || host.endsWith(`.${bare}`);
  }
  return host === allowed;
}

function assertSafeActionValue(value) {
  if (value.includes('\0') || looksSecret(value)) {
    throw new McpToolError('SENSITIVE_VALUE', 'MCP actions may not transmit credential, token, payment, OTP, or session-like values.');
  }
}

function looksSecret(value) {
  const text = String(value ?? '');
  const directMatch = SECRET_TEXT_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
  LABELED_SECRET_PATTERN.lastIndex = 0;
  return directMatch || LABELED_SECRET_PATTERN.test(text);
}

function extractBooleanResult(stdout, expectation) {
  try {
    const parsed = parseJsonOutput(stdout);
    const data = parsed?.data ?? parsed;
    if (typeof data === 'boolean') return data;
    for (const key of [expectation, 'value', 'result']) {
      if (typeof data?.[key] === 'boolean') return data[key];
    }
  } catch {
    // The action succeeded but emitted an unfamiliar shape; report unknown rather than raw output.
  }
  return null;
}

function browserFailure(failure) {
  return new McpToolError('AGENT_BROWSER_ERROR', 'agent-browser returned a classified failure.', {
    kind: failure?.kind ?? 'process-failure',
    fallback: boundedString(failure?.fallback?.nextStep, 300)
  });
}

export function writeGenerationTask({
  webRoot,
  taskContent,
  providerInput,
  manifest,
  createdAt,
  tokenFactory,
  fileSystem = fs
}) {
  const realWebRoot = fileSystem.realpathSync(webRoot);
  const aiRunsRoot = path.join(webRoot, '.ai-runs');
  fileSystem.mkdirSync(aiRunsRoot, { recursive: true, mode: 0o700 });
  if (fileSystem.lstatSync(aiRunsRoot).isSymbolicLink()) {
    throw new McpToolError('UNSAFE_OUTPUT_ROOT', '.ai-runs must not be a symbolic link.');
  }
  const realAiRunsRoot = fileSystem.realpathSync(aiRunsRoot);
  if (!pathInside(realAiRunsRoot, realWebRoot)) {
    throw new McpToolError('UNSAFE_OUTPUT_ROOT', '.ai-runs resolves outside the web workspace.');
  }
  const mcpRoot = path.join(realAiRunsRoot, 'mcp');
  fileSystem.mkdirSync(mcpRoot, { recursive: true, mode: 0o700 });
  if (fileSystem.lstatSync(mcpRoot).isSymbolicLink()) {
    throw new McpToolError('UNSAFE_OUTPUT_ROOT', '.ai-runs/mcp must not be a symbolic link.');
  }
  const flowSlug = slugify(manifest.flowId);
  const timestamp = createdAt.toISOString().replace(/[:.]/g, '-');
  const suffix = tokenFactory('run').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || crypto.randomBytes(8).toString('hex');
  const runDir = path.join(mcpRoot, `${timestamp}-${flowSlug}-${suffix}`);
  const stagingSuffix = tokenFactory('staging').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || crypto.randomBytes(8).toString('hex');
  const stagingDir = path.join(mcpRoot, `.staging-${timestamp}-${stagingSuffix}`);
  let stagingCreated = false;
  try {
    fileSystem.mkdirSync(stagingDir, { recursive: false, mode: 0o700 });
    stagingCreated = true;
    fileSystem.writeFileSync(path.join(stagingDir, 'generation-task.md'), taskContent, { flag: 'wx', mode: 0o600 });
    fileSystem.writeFileSync(path.join(stagingDir, 'provider-input.md'), providerInput, { flag: 'wx', mode: 0o600 });
    fileSystem.writeFileSync(path.join(stagingDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    fileSystem.renameSync(stagingDir, runDir);
    stagingCreated = false;
  } catch {
    if (stagingCreated) {
      fileSystem.rmSync(stagingDir, { recursive: true, force: true });
    }
    throw new McpToolError('TASK_WRITE_FAILED', 'Generation-task artifacts could not be published atomically; no partial run was retained.');
  }
  const taskPath = path.join(runDir, 'generation-task.md');
  const providerInputPath = path.join(runDir, 'provider-input.md');
  const manifestPath = path.join(runDir, 'manifest.json');
  return {
    taskPath: normalizePath(path.relative(realWebRoot, taskPath)),
    providerInputPath: normalizePath(path.relative(realWebRoot, providerInputPath)),
    manifestPath: normalizePath(path.relative(realWebRoot, manifestPath))
  };
}

function boundedPlanStep(step) {
  return {
    step: boundedString(step.step, 20),
    acIds: Array.isArray(step.acIds) ? step.acIds.slice(0, 20).map((value) => boundedString(value, 20)) : [],
    action: redactSensitiveText(boundedString(step.action, 300)),
    target: redactSensitiveText(boundedString(step.target, 300)),
    expectedResult: redactSensitiveText(boundedString(step.expectedResult, 500))
  };
}

function assertActionShape(action, args) {
  const allowedByAction = {
    goto: new Set(['url']),
    click: new Set(['ref']),
    fill: new Set(['ref', 'value']),
    select: new Set(['ref', 'value']),
    check: new Set(['ref']),
    uncheck: new Set(['ref']),
    press: new Set(['key']),
    expect: new Set(['ref', 'expectation'])
  };
  const common = new Set(['sessionId', 'action']);
  const allowed = allowedByAction[action];
  for (const key of Object.keys(args)) {
    if (!common.has(key) && !allowed.has(key)) {
      throw new McpToolError('INVALID_ARGUMENT', `Argument ${boundedString(key, 80)} is not valid for action ${action}.`);
    }
  }
}

function assertObjectWithKeys(value, allowedKeys, requiredKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new McpToolError('INVALID_ARGUMENT', 'Tool arguments must be a JSON object.');
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new McpToolError('INVALID_ARGUMENT', `Unexpected argument: ${boundedString(key, 80)}`);
    }
  }
  for (const key of requiredKeys) {
    if (!(key in value)) {
      throw new McpToolError('INVALID_ARGUMENT', `Missing required argument: ${key}`);
    }
  }
}

function requiredString(value, name, maxLength, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || value.length > maxLength || value.includes('\0') || (!allowEmpty && value.trim() === '')) {
    throw new McpToolError('INVALID_ARGUMENT', `${name} must be a bounded string.`);
  }
  return value;
}

function pathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeUrlForOutput(value) {
  try {
    const url = new URL(String(value));
    return `${url.origin}${url.pathname}`;
  } catch {
    return '(invalid-url)';
  }
}

export function redactSensitiveText(value, exactValues = []) {
  let text = String(value ?? '');
  const replacements = [...exactValues]
    .map((entry) => String(entry))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .slice(0, MAX_REDACTION_VALUES);
  for (const replacement of replacements) {
    text = text.split(replacement).join('***');
  }
  for (const pattern of SECRET_TEXT_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, '***');
  }
  LABELED_SECRET_PATTERN.lastIndex = 0;
  text = text.replace(LABELED_SECRET_PATTERN, '$1=***');
  text = text.replace(/\bvalue\s*=\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, 'value="***"');
  text = text.replace(EMAIL_PATTERN, '***@***');
  text = text.replace(CARD_PATTERN, '[REDACTED-CARD]');
  text = text.replace(PHONE_PATTERN, (candidate) => {
    const digits = candidate.replace(/\D/g, '').length;
    return digits >= 10 && digits <= 15 ? '[REDACTED-PHONE]' : candidate;
  });
  return text.replace(/([?&#](?:access_?token|auth|code|key|otp|password|secret|session|sid|sig|signature|token)=)[^&#\s]+/gi, '$1***');
}

function boundedString(value, maxLength, exactValues = []) {
  return truncate(redactSensitiveText(String(value ?? ''), exactValues), maxLength);
}

function truncate(value, maxLength) {
  const text = String(value ?? '');
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 14))}…[truncated]`;
}

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function loadDestructiveActionAllowlist(value) {
  const entries = Array.isArray(value) ? value : String(value ?? '').split(',');
  const normalized = entries.map(normalizePolicyEntry).filter(Boolean);
  if (normalized.length > 100) {
    throw new McpToolError('DESTRUCTIVE_POLICY_INVALID', 'MCP destructive-action allowlist may contain at most 100 exact entries.');
  }
  for (const entry of normalized) {
    if (!/^(?:click|select|check|uncheck|press):[^:]{1,160}$/.test(entry)) {
      throw new McpToolError(
        'DESTRUCTIVE_POLICY_INVALID',
        'Each MCP destructive-action allowlist entry must use exact action:accessible-name syntax.'
      );
    }
  }
  return new Set(normalized);
}

function normalizePolicyEntry(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function slugify(value) {
  return String(value ?? 'flow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'flow';
}

function defaultToken(label) {
  return `${label}-${crypto.randomBytes(24).toString('base64url')}`;
}
