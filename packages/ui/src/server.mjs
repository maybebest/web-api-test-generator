#!/usr/bin/env node
// @ts-check

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFlowSpec } from '../../web/scripts/ai/lib/spec-parser.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(dirname, '..');
const repoRoot = path.resolve(uiRoot, '..', '..');
const apiRoot = path.join(repoRoot, 'packages', 'api');
const webRoot = path.join(repoRoot, 'packages', 'web');
const publicRoot = path.join(uiRoot, 'public');
// UI_RUNS_DIR lets tests redirect all local state to a temp directory so
// handler tests never touch the real packages/ui/.ui-runs store.
const uiRunsRoot = process.env.UI_RUNS_DIR ? path.resolve(process.env.UI_RUNS_DIR) : path.join(uiRoot, '.ui-runs');
const historyPath = path.join(uiRunsRoot, 'history.json');
const testManagementPath = path.join(uiRunsRoot, 'test-management.json');
const settingsPath = path.join(uiRunsRoot, 'settings.json');
const repositoryTestCaseFiles = ['specs/test-cases.yaml', 'specs/test-cases-skus-2.yaml'];

const host = process.env.UI_HOST || '127.0.0.1';
const port = Number.parseInt(process.env.UI_PORT || process.env.PORT || '4317', 10);
const jsonLimitBytes = 1024 * 1024;
const uploadLimitBytes = 80 * 1024 * 1024;
const commandTimeoutMs = Number.parseInt(process.env.UI_COMMAND_TIMEOUT_MS || '900000', 10);
const SPEC_FIT_SYSTEM_PROMPT = `You convert rough manual QA notes into one strict Markdown flow spec.

Output contract:
- Return exactly one complete Markdown document.
- The document must start with "# Flow:".
- Do not wrap the answer in a code fence.
- Do not add commentary before or after the Markdown.
- Preserve only facts supported by the source notes.
- Use NEEDS_REVIEW for unknown values instead of inventing product behavior.
- Never include real credentials, tokens, cookies, or production secrets.`;

const packageRoots = {
  api: apiRoot,
  web: webRoot
};

// File preview is a read primitive over the package trees, so it is restricted
// to the directories the UI legitimately previews and to safe extensions.
// This keeps secrets (.env, playwright/.auth, .ui-runs/settings.json) unreadable
// even though they live inside a package root.
const previewAllowlist = {
  api: {
    dirs: new Set(['examples', 'tests']),
    extensions: new Set(['.har', '.json', '.md', '.ts'])
  },
  web: {
    dirs: new Set(['specs', 'recordings', 'tests', '.ai-runs']),
    extensions: new Set(['.md', '.json', '.ts'])
  }
};

const uploadKinds = {
  'api-har': {
    packageRoot: apiRoot,
    directory: '.ui-uploads/har',
    extensions: new Set(['.har', '.json', '.md'])
  },
  'web-spec': {
    packageRoot: webRoot,
    directory: '.ui-uploads/specs',
    extensions: new Set(['.md'])
  },
  'web-recording': {
    packageRoot: webRoot,
    directory: '.ui-uploads/recordings',
    extensions: new Set(['.json'])
  }
};

function buildSpecFitPrompt({ source, template }) {
  return `Convert the raw manual QA input into a strict flow spec that follows the template.

Rules:
- Keep all required template sections and table structures.
- Fill Metadata, User Story, Preconditions, Business Rules, Data Cases, Flow Steps, Negative Cases, and Acceptance Criteria from the source when possible.
- Mark missing or uncertain values as NEEDS_REVIEW.
- Set Review Status to ai-draft.
- Set Generation Source to ai-template-fit.
- Keep Target Test File under tests/regression unless the source clearly requires smoke/accessibility/visual.
- If Auth is required, Target Test File must end with .authenticated.spec.ts.
- Use fake deterministic test data only.
- Output Markdown only.

Template:
\`\`\`markdown
${template}
\`\`\`

Raw manual QA input:
\`\`\`text
${sanitizePromptSource(source)}
\`\`\`
`;
}

function sanitizePromptSource(source) {
  return String(source).replace(/`{3,}/g, "'''").trim();
}

let activeCommand = null;

export const uiPaths = Object.freeze({
  repoRoot,
  apiRoot,
  webRoot,
  uiRoot
});

export function createUiServer() {
  return http.createServer((req, res) => {
    route(req, res).catch((error) => {
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      sendJson(res, statusCode, {
        ok: false,
        error: error.message || 'Unexpected server error'
      });
    });
  });
}

export function startUiServer({ listenHost = host, listenPort = port } = {}) {
  assertSafeListenHost(listenHost);
  const server = createUiServer();
  server.listen(listenPort, listenHost, () => {
    console.log(`Test Generator UI listening on http://${listenHost}:${listenPort}`);
  });
  return server;
}

if (isMainModule()) {
  const server = startUiServer();
  installSignalHandlers(server);
}

function installSignalHandlers(server) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      killActiveCommand();
      server.close(() => process.exit(0));
      // Force exit if in-flight connections keep the server open.
      setTimeout(() => process.exit(0), 3000).unref?.();
    });
  }
}

async function route(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);
  assertLocalHost(req);
  assertAllowedStateChangingRequest(req);

  if (req.method === 'GET' && url.pathname === '/api/state') {
    return sendJson(res, 200, await getState());
  }

  if (req.method === 'GET' && url.pathname === '/api/file') {
    return sendJson(res, 200, await readTextFileForPreview(url));
  }

  if (req.method === 'GET' && url.pathname === '/api/test-management') {
    return sendJson(res, 200, { ok: true, data: await readTestManagementState() });
  }

  if (req.method === 'GET' && url.pathname === '/api/settings') {
    return sendJson(res, 200, { ok: true, settings: publicSettings(await readUiSettings()) });
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/ai') {
    return sendJson(res, 200, await handleSaveAiSettings(req));
  }

  if (req.method === 'GET' && url.pathname === '/api/web-spec-template') {
    return sendJson(res, 200, await handleWebSpecTemplate());
  }

  if (req.method === 'POST' && url.pathname === '/api/web-spec-fit') {
    return sendJson(res, 200, await handleFitWebSpec(req));
  }

  if (req.method === 'POST' && url.pathname === '/api/web-spec-file') {
    return sendJson(res, 200, await handleSaveWebSpecFile(req));
  }

  if (req.method === 'POST' && url.pathname === '/api/web-spec-file/delete') {
    return sendJson(res, 200, await handleDeleteWebSpecFile(req));
  }

  if (req.method === 'POST' && url.pathname === '/api/test-management/cases') {
    return sendJson(res, 200, await handleSaveTestCase(req));
  }

  if (req.method === 'POST' && url.pathname === '/api/test-management/suites') {
    return sendJson(res, 200, await handleSaveTestSuite(req));
  }

  if (req.method === 'POST' && url.pathname === '/api/test-management/runs') {
    return sendJson(res, 200, await handleSaveTestRun(req));
  }

  if (req.method === 'POST' && url.pathname === '/api/test-management/run-result') {
    return sendJson(res, 200, await handleSaveRunResult(req));
  }

  if (req.method === 'POST' && url.pathname === '/api/upload') {
    return sendJson(res, 200, await handleUpload(req, url));
  }

  if (req.method === 'POST' && url.pathname === '/api/api-generate') {
    return sendJson(res, 200, await handleApiGenerate(req));
  }

  if (req.method === 'POST' && url.pathname === '/api/api-tests') {
    return sendJson(res, 200, await handleApiTests(req));
  }

  if (req.method === 'POST' && url.pathname === '/api/web-spec-task') {
    return sendJson(res, 200, await handleWebSpecTask(req));
  }

  if (req.method === 'POST' && url.pathname === '/api/web-spec-ai') {
    return sendJson(res, 200, await handleWebSpecAi(req));
  }

  if (req.method === 'POST' && url.pathname === '/api/web-spec-check') {
    return sendJson(res, 200, await handleWebSpecCheck(req));
  }

  if (req.method === 'POST' && url.pathname === '/api/web-recording-task') {
    return sendJson(res, 200, await handleWebRecordingTask(req));
  }

  if (req.method === 'POST' && url.pathname === '/api/web-recording-ai') {
    return sendJson(res, 200, await handleWebRecordingAi(req));
  }

  if (req.method === 'POST' && url.pathname === '/api/web-recording-check') {
    return sendJson(res, 200, await handleWebRecordingCheck(req));
  }

  if (req.method === 'POST' && url.pathname === '/api/web-brain-doctor') {
    return sendJson(res, 200, await runAndRecord('web-brain-doctor', 'packages/web', 'ai:brain:doctor', [], { needsAi: true }));
  }

  if (req.method === 'POST' && url.pathname === '/api/cancel') {
    const cancelled = killActiveCommand();
    return sendJson(res, 200, { ok: true, cancelled });
  }

  return serveStatic(req, res, url);
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

function assertSafeListenHost(listenHost) {
  if (isLoopbackHost(listenHost)) {
    return;
  }

  if (process.env.UI_ALLOW_REMOTE === 'true') {
    return;
  }

  throw new Error(
    `Refusing to bind Test Generator UI to non-loopback host "${listenHost}". ` +
      'Use UI_HOST=127.0.0.1, or set UI_ALLOW_REMOTE=true only for a trusted network.'
  );
}

function assertLocalHost(req) {
  if (process.env.UI_ALLOW_REMOTE === 'true') {
    return;
  }

  // Reject requests whose Host header is not loopback. This defeats DNS
  // rebinding, where a remote page resolves its own hostname to 127.0.0.1 and
  // sends a matching Origin+Host pair that the same-origin check alone accepts.
  const hostname = hostnameFromHostHeader(req.headers.host || '');
  if (!isLoopbackHost(hostname)) {
    throw httpError(403, `Forbidden host: ${req.headers.host}`);
  }
}

function assertAllowedStateChangingRequest(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method || '')) {
    return;
  }

  const origin = req.headers.origin;
  if (!origin) {
    return;
  }

  if (!isAllowedOrigin(origin, req.headers.host || `${host}:${port}`)) {
    throw httpError(403, `Forbidden origin: ${origin}`);
  }
}

function isAllowedOrigin(origin, requestHost) {
  try {
    const parsedOrigin = new URL(origin);
    const requestHostName = hostnameFromHostHeader(requestHost);
    const requestPort = portFromHostHeader(requestHost);

    if (!['http:', 'https:'].includes(parsedOrigin.protocol)) {
      return false;
    }

    return parsedOrigin.hostname === requestHostName && parsedOrigin.port === requestPort;
  } catch {
    return false;
  }
}

function hostnameFromHostHeader(value) {
  if (!value) {
    return '';
  }
  if (value.startsWith('[')) {
    return value.slice(1, value.indexOf(']'));
  }
  return value.split(':')[0];
}

function portFromHostHeader(value) {
  if (!value) {
    return '';
  }
  if (value.startsWith('[')) {
    const suffix = value.slice(value.indexOf(']') + 1);
    return suffix.startsWith(':') ? suffix.slice(1) : '';
  }
  const parts = value.split(':');
  return parts.length > 1 ? parts.at(-1) : '';
}

function isLoopbackHost(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['', 'localhost', '127.0.0.1', '::1', '[::1]'].includes(normalized);
}

async function getState() {
  const [
    apiExamples,
    webSpecs,
    webFlowSpecs,
    webRecordings,
    webSpecTasks,
    apiGeneratedTests,
    webGeneratedTests,
    history,
    testManagement,
    settings
  ] = await Promise.all([
    listPackageFiles(apiRoot, 'examples', new Set(['.har', '.json', '.md'])),
    listPackageFiles(webRoot, 'specs', new Set(['.md', '.yaml', '.yml'])),
    listWebFlowSpecs(),
    listPackageFiles(webRoot, 'recordings', new Set(['.json'])),
    listWebGenerationTasks('spec'),
    listPackageFiles(apiRoot, 'tests/generated', new Set(['.ts'])),
    listWebGeneratedTests(),
    readHistory(),
    readTestManagementState(),
    readUiSettings()
  ]);
  const scopedApiGeneratedTests = apiGeneratedTests.map((file) => ({ ...file, scope: 'api' }));
  const scopedWebGeneratedTests = webGeneratedTests.map((file) => ({ ...file, scope: 'web' }));

  return {
    ok: true,
    repoRoot,
    packages: {
      api: path.relative(repoRoot, apiRoot),
      web: path.relative(repoRoot, webRoot)
    },
    activeCommand: publicActiveCommand(),
    examples: {
      api: apiExamples,
      specs: webSpecs,
      webFlowSpecs,
      recordings: webRecordings,
      webSpecTasks,
      apiGeneratedTests: scopedApiGeneratedTests,
      webGeneratedTests: scopedWebGeneratedTests,
      generatedTests: [...scopedApiGeneratedTests, ...scopedWebGeneratedTests]
    },
    testManagement,
    settings: publicSettings(settings),
    history
  };
}

async function handleSaveAiSettings(req) {
  const body = await readJson(req);
  return withStoreLock(settingsPath, async () => {
    const existing = await readUiSettings();
    const saved = {
      ai: {
        ...existing.ai,
        brain: enumValue(body.brain, new Set(['auto', 'anthropic', 'openai', 'claude-cli', 'codex-cli']), 'AI brain', existing.ai.brain || 'auto'),
        anthropicModel: optionalText(body.anthropicModel) || existing.ai.anthropicModel,
        openaiModel: optionalText(body.openaiModel) || existing.ai.openaiModel,
        timeoutMs: normalizeOptionalPositiveInteger(body.timeoutMs, existing.ai.timeoutMs)
      }
    };

    const anthropicApiKey = optionalText(body.anthropicApiKey);
    const openaiApiKey = optionalText(body.openaiApiKey);
    if (body.clearAnthropicApiKey) {
      saved.ai.anthropicApiKey = '';
    } else {
      saved.ai.anthropicApiKey = anthropicApiKey || existing.ai.anthropicApiKey;
    }

    if (body.clearOpenaiApiKey) {
      saved.ai.openaiApiKey = '';
    } else {
      saved.ai.openaiApiKey = openaiApiKey || existing.ai.openaiApiKey;
    }

    await writeUiSettings(saved);
    return {
      ok: true,
      settings: publicSettings(saved)
    };
  });
}

async function handleWebSpecTemplate() {
  const templatePath = path.join(webRoot, 'specs', '_template.md');
  return {
    ok: true,
    file: toFileRef(webRoot, templatePath),
    content: await fsp.readFile(templatePath, 'utf8')
  };
}

async function handleFitWebSpec(req) {
  const body = await readJson(req);
  const source = requiredText(body.content, 'source spec text');
  const templatePath = path.join(webRoot, 'specs', '_template.md');
  const template = await fsp.readFile(templatePath, 'utf8');
  const prompt = buildSpecFitPrompt({ source, template });
  const env = await aiEnv(process.env, { includeKeys: true });

  // Run the brain in a child process (gated by the same activeCommand lock as
  // generator runs) so a slow/blocking CLI brain never freezes the UI server.
  const requestPath = await writeFitRequest({ prompt, systemPrompt: SPEC_FIT_SYSTEM_PROMPT });
  try {
    const result = await runChildProcess({
      command: process.execPath,
      args: [path.join(uiRoot, 'scripts', 'fit-runner.mjs'), requestPath],
      cwd: repoRoot,
      env,
      meta: { workspace: 'packages/ui', script: 'web-spec-fit' },
      display: 'node scripts/fit-runner.mjs'
    });

    if (!result.ok) {
      const detail = (result.stderr || result.stdout || 'unknown error').trim().slice(0, 500);
      throw httpError(502, `Fit to Template failed: ${detail}`);
    }

    const parsed = parseFitRunnerOutput(result.stdout);
    const content = extractMarkdownSpec(parsed.text);
    assertFlowSpecShape(content);

    return {
      ok: true,
      content,
      brain: {
        kind: parsed.brain?.kind,
        model: parsed.brain?.model ?? null
      },
      usage: parsed.usage ?? null
    };
  } finally {
    await fsp.rm(requestPath, { force: true });
  }
}

async function writeFitRequest(payload) {
  await fsp.mkdir(uiRunsRoot, { recursive: true });
  const requestPath = path.join(uiRunsRoot, `fit-${crypto.randomUUID().slice(0, 8)}.json`);
  await fsp.writeFile(requestPath, JSON.stringify(payload));
  return requestPath;
}

function parseFitRunnerOutput(stdout) {
  const parsed = parseJsonObjectFromStdout(stdout);
  if (!parsed || typeof parsed.text !== 'string') {
    throw httpError(502, 'Fit to Template returned no usable output.');
  }
  return parsed;
}

function assertFlowSpecShape(content) {
  let parsed;
  try {
    parsed = parseFlowSpec(content);
  } catch (error) {
    throw httpError(502, `Fit to Template output is not a valid flow spec: ${error.message}`);
  }
  if (!parsed?.title || !parsed.metadata || !parsed.metadata['Target Test File']) {
    throw httpError(502, 'Fit to Template output is missing required flow-spec sections.');
  }
}

async function handleSaveWebSpecFile(req) {
  const body = await readJson(req);
  const specPath = normalizePackageCliPath(webRoot, body.specPath, { purpose: 'spec file' });
  const absolutePath = path.resolve(webRoot, specPath);
  const specsRoot = path.join(webRoot, 'specs');
  const content = typeof body.content === 'string' ? body.content : '';

  assertInside(absolutePath, specsRoot, 'spec file');
  if (path.extname(absolutePath).toLowerCase() !== '.md') {
    throw httpError(400, 'Spec file must use the .md extension.');
  }
  if (!content.trim()) {
    throw httpError(400, 'Spec content is required.');
  }

  await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
  await fsp.writeFile(absolutePath, content.endsWith('\n') ? content : `${content}\n`);

  return {
    ok: true,
    file: toFileRef(webRoot, absolutePath)
  };
}

async function handleDeleteWebSpecFile(req) {
  const body = await readJson(req);
  const specPath = normalizePackageCliPath(webRoot, body.specPath, { mustExist: true, purpose: 'spec file' });
  const absolutePath = path.resolve(webRoot, specPath);
  const specsRoot = path.join(webRoot, 'specs');

  assertInside(absolutePath, specsRoot, 'spec file');
  if (path.extname(absolutePath).toLowerCase() !== '.md') {
    throw httpError(400, 'Spec file must use the .md extension.');
  }
  if (path.basename(absolutePath) === '_template.md') {
    throw httpError(400, 'Template spec cannot be deleted from the UI.');
  }

  const file = toFileRef(webRoot, absolutePath);
  await fsp.rm(absolutePath);
  return { ok: true, file };
}

async function handleSaveTestCase(req) {
  const body = await readJson(req);
  return withStoreLock(testManagementPath, async () => {
    const store = await readTestManagement();
    const now = new Date().toISOString();
    const existing = body.id ? store.cases.find((testCase) => testCase.id === body.id) : undefined;
    const title = requiredText(body.title, 'test case title');

    const saved = {
      id: existing?.id ?? nextEntityId(store, 'case', 'TC'),
      title,
      area: optionalText(body.area),
      priority: enumValue(body.priority, new Set(['low', 'medium', 'high', 'critical']), 'priority', 'medium'),
      status: enumValue(body.status, new Set(['draft', 'ready', 'deprecated']), 'test case status', 'draft'),
      automation: enumValue(body.automation, new Set(['manual', 'automated', 'candidate']), 'automation status', 'candidate'),
      testPath: optionalSafeRelativePath(body.testPath, 'automation path'),
      specPath: '',
      recordingPath: optionalSafeRelativePath(body.recordingPath, 'recording path'),
      tags: toStringList(body.tags),
      preconditions: optionalText(body.preconditions),
      steps: optionalText(body.steps),
      expectedResult: optionalText(body.expectedResult),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    saved.specPath = normalizeManagedSpecPath(saved, body.specPath || existing?.specPath);
    const specFile = await writeManagedTestCaseSpec(saved);

    if (existing) {
      store.cases = store.cases.map((testCase) => (testCase.id === saved.id ? saved : testCase));
    } else {
      store.cases.push(saved);
    }

    await writeTestManagement(store);
    return { ok: true, data: await mergeTestManagementStore(store), testCase: saved, file: specFile };
  });
}

async function writeManagedTestCaseSpec(testCase) {
  const absolutePath = path.resolve(webRoot, testCase.specPath);
  const specsRoot = path.join(webRoot, 'specs');
  assertInside(absolutePath, specsRoot, 'test case spec');
  await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
  await fsp.writeFile(absolutePath, `${renderManagedTestCaseSpec(testCase).trimEnd()}\n`);
  return toFileRef(webRoot, absolutePath);
}

function normalizeManagedSpecPath(testCase, requestedPath) {
  const rawPath = optionalSafeRelativePath(requestedPath, 'spec path');
  const fallbackPath = `specs/test-management/${testCase.id.toLowerCase()}-${slugifyFileName(testCase.title)}.md`;
  const normalizedPath = rawPath ? normalizePackageCliPath(webRoot, rawPath, { purpose: 'spec path' }) : fallbackPath;
  const absolutePath = path.resolve(webRoot, normalizedPath);
  const specsRoot = path.join(webRoot, 'specs');

  assertInside(absolutePath, specsRoot, 'spec path');
  if (path.extname(absolutePath).toLowerCase() !== '.md') {
    throw httpError(400, 'Spec path must use the .md extension.');
  }
  return path.relative(webRoot, absolutePath);
}

function renderManagedTestCaseSpec(testCase) {
  const slug = slugifyFileName(testCase.title);
  const tags = normalizeSpecTags(testCase.tags);
  const targetTestFile = normalizeManagedTargetTestFile(testCase.testPath, slug);
  const flowSteps = managedFlowSteps(testCase);
  const acceptanceCriteria = managedAcceptanceCriteria(flowSteps, testCase);
  const expectedResult = testCase.expectedResult || 'Expected user-visible result is displayed.';
  const preconditions = testCase.preconditions || 'No special preconditions.';
  const area = testCase.area || 'Product flow';

  return `# Flow: ${testCase.title}

## Metadata

| Field | Value |
|---|---|
| Flow ID | ${testCase.id} |
| Spec Version | 1.0.0 |
| Owner | manual-qa |
| Priority | ${managedPriority(testCase.priority)} |
| Test Type | regression |
| Auth | optional |
| Target Test File | ${targetTestFile} |
| Base Path | / |
| Tags | ${tags.join(' ')} |
| Generation Mode | single |

## User Story

As a user,
I want to complete ${area.toLowerCase()} behavior,
So that ${testCase.title.toLowerCase()}.

## Preconditions

- ${preconditions}

## Out-of-scope

- Visual pixel-perfect validation.
- Third-party service behavior outside this flow.

## Stability Requirements

| Field | Value |
|---|---|
| Parallel Safe | yes |
| Data Isolation | per-test |
| Allowed Retries | 0 |

## Variants

| Locale | Role | Plan |
|---|---|---|
| en-US | guest | standard |

## Includes

- none

## Business Rules

| Rule ID | Rule | Formula | Blocking Behavior |
|---|---|---|---|
| RULE-001 | ${tableCell(`Verify ${testCase.title}`)} | User completes the documented flow steps | User-visible expected result is asserted |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | managed test data | ${tableCell(expectedResult)} | Primary deterministic case |

## Data Cases as JSON

\`\`\`json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "source": "test-management"
    },
    "expected": {
      "result": ${JSON.stringify(expectedResult)}
    },
    "notes": "Primary deterministic case"
  }
]
\`\`\`

## Test Data

| Name | Value | Notes |
|---|---|---|
| source | test-management | Generated from ${testCase.id} |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | No mocked dependency required by this test case | n/a |

## Mocks as JSON

\`\`\`json
[]
\`\`\`

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
${flowSteps.map((step) => `| ${step.number} | ${step.acId} | ${tableCell(step.action)} | ${tableCell(step.target)} | ${tableCell(step.input)} | ${tableCell(step.expected)} | ${tableCell(step.assertion)} |`).join('\n')}

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | Required user action cannot be completed | A clear validation or disabled state is visible |

## Acceptance Criteria

${acceptanceCriteria.map((criterion) => `- ${criterion}`).join('\n')}

## Locator Hints

- Prefer Page Object or Component Object locators using \`this.page.getByTestId(...)\` when a meaningful \`data-testid\` exists and is stable.
- Prefer role/name locators when no stable \`data-testid\` exists.
- Prefer labels for form fields.
- Use placeholder locators only when no label exists.
- Use visible text locators only for stable visible copy.

## Generated Test Requirements

- Must import from fixtures/test.
- Must use test.step.
- Must use Page Objects or Component Objects for all locators.
- Must not create direct \`page.getBy*\` or \`page.locator(...)\` locators in the generated test body.
- Default generation mode is single-test mode; the optional \`Generation Mode\` metadata row overrides it.
- Generate a suite only when the spec declares \`Generation Mode | suite\` or a suite is explicitly requested.
- In single-test mode, must generate exactly one primary requested-scenario test with one primary final assertion step, plus optionally one test per spec \`NEG-###\` case.
- The single-mode primary test must declare a \`covered-ac-ids\` annotation (\`test.info().annotations.push({ type: 'covered-ac-ids', description: 'AC-### ...' })\`) whose set equals the AC ids named in its step titles.
- In the single-mode primary test, every \`test.step\` title must carry at least one \`AC-###\` token.
- Must declare the spec metadata \`Tags\` exactly via the Playwright \`{ tag: [...] }\` option.
- In suite mode, must split broad flows into focused tests that verify one functionality or business outcome.
- Must put \`expect(...)\` only in the final assertion step for each test.
- Must title assertion steps \`Assert AC-###: ...\` or \`Assert NEG-###: ...\`.
- Must include meaningful expect assertions for user-visible behavior.
- In suite mode, must cover every AC ID from this spec with a final assertion step; NEG coverage is required in suite mode and a non-blocking warning in single mode.
- Default generated-test execution target is Chromium only.
- Cross-browser generated-test execution is opt-in.
- Must not use page.waitForTimeout.
- Must not use XPath.
- Must not use test.only.
- Must not silently skip: \`test.skip\`, \`test.fixme\`, and \`test.fail\` are forbidden in all forms, including runtime calls inside test bodies.
- Must not use real credentials.
- Must not commit auth state.

## Notes

- Managed by the local Test Management UI.
- Source test case: ${testCase.id}.
`;
}

function normalizeManagedTargetTestFile(testPath, slug) {
  const normalizedPath = optionalSafeRelativePath(testPath, 'automation path');
  if (!normalizedPath) {
    return `tests/regression/${slug}.spec.ts`;
  }

  const webPrefix = `${path.relative(repoRoot, webRoot)}/`;
  const withoutWebPrefix = normalizedPath.startsWith(webPrefix) ? normalizedPath.slice(webPrefix.length) : normalizedPath;
  if (!withoutWebPrefix.endsWith('.spec.ts')) {
    return `tests/regression/${slug}.spec.ts`;
  }
  return withoutWebPrefix;
}

function managedFlowSteps(testCase) {
  const sourceSteps = testCase.steps
    .split(/\r?\n/)
    .map((step) => step.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  const expectedResult = testCase.expectedResult || 'Expected result is visible.';
  const steps = sourceSteps.length > 0 ? sourceSteps : ['Open the flow entry page', `Complete ${testCase.title}`, expectedResult];

  return steps.map((step, index) => {
    const isLastStep = index === steps.length - 1;
    const number = index + 1;
    return {
      number,
      acId: `AC-${String(number).padStart(3, '0')}`,
      action: step,
      target: index === 0 ? '/' : testCase.area || testCase.title,
      input: 'n/a',
      expected: isLastStep ? expectedResult : `${step} succeeds`,
      assertion: isLastStep ? 'expected result is visible' : 'next flow state is visible'
    };
  });
}

function managedAcceptanceCriteria(flowSteps, testCase) {
  return flowSteps.map((step, index) => {
    if (index === 0) {
      return `${step.acId}: The user can open the flow entry point.`;
    }
    if (index === flowSteps.length - 1) {
      return `${step.acId}: ${testCase.expectedResult || 'The expected result is visible to the user.'}`;
    }
    return `${step.acId}: The user can complete step ${step.number} successfully.`;
  });
}

function managedPriority(priority) {
  return {
    critical: 'P0',
    high: 'P1',
    medium: 'P2',
    low: 'P3'
  }[priority] || 'P2';
}

function normalizeSpecTags(tags) {
  const normalized = new Set(['@manual-managed', '@regression']);
  for (const tag of tags || []) {
    const cleanTag = String(tag).trim();
    if (!cleanTag) {
      continue;
    }
    normalized.add(cleanTag.startsWith('@') ? cleanTag : `@${cleanTag}`);
  }
  return [...normalized];
}

function slugifyFileName(value) {
  return (
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'test-case'
  );
}

function tableCell(value) {
  return String(value || 'n/a')
    .replace(/\r?\n+/g, '<br>')
    .replace(/\|/g, '\\|')
    .trim();
}

async function handleSaveTestSuite(req) {
  const body = await readJson(req);
  return withStoreLock(testManagementPath, async () => {
    const store = await readTestManagement();
    const now = new Date().toISOString();
    const existing = body.id ? store.suites.find((suite) => suite.id === body.id) : undefined;
    const name = requiredText(body.name, 'test suite name');
    const caseIds = normalizeCaseIds(await listKnownTestCases(store), body.caseIds);
    const saved = {
      id: existing?.id ?? nextEntityId(store, 'suite', 'TS'),
      name,
      description: optionalText(body.description),
      caseIds,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    if (existing) {
      store.suites = store.suites.map((suite) => (suite.id === saved.id ? saved : suite));
    } else {
      store.suites.push(saved);
    }

    await writeTestManagement(store);
    return { ok: true, data: await mergeTestManagementStore(store), suite: saved };
  });
}

async function handleSaveTestRun(req) {
  const body = await readJson(req);
  return withStoreLock(testManagementPath, async () => {
    const store = await readTestManagement();
    const now = new Date().toISOString();
    const name = requiredText(body.name, 'test run name');
    const suiteId = optionalText(body.suiteId);
    if (suiteId && !store.suites.some((suite) => suite.id === suiteId)) {
      throw httpError(400, `Unknown test suite: ${suiteId}`);
    }

    const suiteCaseIds = suiteId ? store.suites.find((suite) => suite.id === suiteId)?.caseIds ?? [] : [];
    const caseIds = normalizeCaseIds(await listKnownTestCases(store), toStringList(body.caseIds).length > 0 ? body.caseIds : suiteCaseIds);
    if (caseIds.length === 0) {
      throw httpError(400, 'A test run needs at least one test case.');
    }

    const results = {};
    for (const caseId of caseIds) {
      results[caseId] = {
        status: 'untested',
        comment: '',
        updatedAt: now
      };
    }

    const saved = {
      id: nextEntityId(store, 'run', 'TR'),
      name,
      suiteId,
      caseIds,
      environment: optionalText(body.environment),
      status: 'planned',
      results,
      createdAt: now,
      updatedAt: now,
      startedAt: undefined,
      completedAt: undefined
    };

    store.runs.push(saved);
    await writeTestManagement(store);
    return { ok: true, data: await mergeTestManagementStore(store), run: saved };
  });
}

async function handleSaveRunResult(req) {
  const body = await readJson(req);
  return withStoreLock(testManagementPath, async () => {
    const store = await readTestManagement();
    const now = new Date().toISOString();
    const runId = requiredText(body.runId, 'test run');
    const caseId = requiredText(body.caseId, 'test case');
    const status = enumValue(body.status, new Set(['untested', 'passed', 'failed', 'blocked', 'skipped']), 'run result', 'untested');
    const run = store.runs.find((candidate) => candidate.id === runId);
    if (!run) {
      throw httpError(400, `Unknown test run: ${runId}`);
    }
    if (!run.caseIds.includes(caseId)) {
      throw httpError(400, `Test case ${caseId} is not part of ${runId}.`);
    }

    run.results[caseId] = {
      status,
      comment: optionalText(body.comment),
      updatedAt: now
    };
    run.updatedAt = now;
    run.status = summarizeRunStatus(run);
    if (run.status === 'in-progress' && !run.startedAt) {
      run.startedAt = now;
    }
    if (run.status === 'completed') {
      run.completedAt = now;
      run.startedAt = run.startedAt ?? now;
    } else {
      run.completedAt = undefined;
    }

    await writeTestManagement(store);
    return { ok: true, data: await mergeTestManagementStore(store), run };
  });
}

async function handleUpload(req, url) {
  const kind = url.searchParams.get('kind') || '';
  const config = uploadKinds[kind];
  if (!config) {
    throw httpError(400, `Unsupported upload kind: ${kind}`);
  }

  const contentType = req.headers['content-type'] || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw httpError(415, 'Upload request must use multipart/form-data.');
  }

  const body = await collectBody(req, uploadLimitBytes);
  const parts = parseMultipart(body, contentType);
  const files = [];
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const uploadDir = path.join(config.packageRoot, config.directory, timestamp);
  await fsp.mkdir(uploadDir, { recursive: true });

  for (const part of parts) {
    if (!part.filename) {
      continue;
    }

    const safeName = sanitizeFileName(part.filename);
    const extension = path.extname(safeName).toLowerCase();
    if (!config.extensions.has(extension)) {
      throw httpError(400, `Unsupported file type for ${safeName}.`);
    }

    const targetPath = path.join(uploadDir, `${crypto.randomUUID().slice(0, 8)}-${safeName}`);
    assertInside(targetPath, config.packageRoot, 'upload target');
    await fsp.writeFile(targetPath, part.content);
    files.push(toFileRef(config.packageRoot, targetPath));
  }

  if (files.length === 0) {
    throw httpError(400, 'No upload files were found.');
  }

  return {
    ok: true,
    files
  };
}

async function handleApiGenerate(req) {
  const body = await readJson(req);
  const args = buildApiGenerateArgs(body);
  const result = await runAndRecord('api-generate', 'packages/api', 'generate', args, { needsAi: Boolean(body.ai) });
  const summary = parseJsonObjectFromStdout(result.stdout);

  if (summary && Array.isArray(summary.generatedFiles)) {
    result.summary = summary;
    result.files = summary.generatedFiles.map((filePath) => toFileRef(apiRoot, path.resolve(filePath)));
  }

  return result;
}

async function handleApiTests(req) {
  const body = await readJson(req);
  const scriptByMode = {
    smoke: 'test:api:smoke',
    generated: 'test:api:generated',
    calibrate: 'test:api:calibrate'
  };
  const mode = String(body.mode || 'smoke');
  const script = scriptByMode[mode];
  if (!script) {
    throw httpError(400, `Unsupported API test mode: ${mode}`);
  }

  return runAndRecord(`api-test-${mode}`, 'packages/api', script, []);
}

async function handleWebSpecTask(req) {
  const body = await readJson(req);
  const specPath = normalizePackageCliPath(webRoot, body.specPath, { mustExist: true, purpose: 'spec path' });
  const args = [specPath];
  const target = optionalPackageCliPath(webRoot, body.targetTestFile, { purpose: 'generated test file' });
  const domArtifact = optionalPackageCliPath(webRoot, body.domArtifact, { mustExist: true, purpose: 'DOM artifact' });
  const mode = optionalEnum(body.mode, new Set(['single', 'suite']), 'generation mode');

  if (target) {
    args.push('--target', target);
  }
  if (domArtifact) {
    args.push('--dom-artifact', domArtifact);
  }
  if (mode) {
    args.push('--mode', mode);
  }

  const result = await runAndRecord('web-spec-task', 'packages/web', 'ai:generate-test', args, { needsAi: true });
  const taskPath = parseWebTaskPath(result.stdout, 'Created generation task:');
  if (taskPath) {
    result.metadata = readWebTaskMetadata(taskPath);
    result.files = webTaskFiles(result.metadata);
  }
  return result;
}

async function handleWebSpecAi(req) {
  const body = await readJson(req);
  const target = normalizePackageCliPath(webRoot, body.targetTestFile, { purpose: 'generated test file' });
  const args = [];

  if (body.taskPath) {
    args.push(normalizePackageCliPath(webRoot, body.taskPath, { mustExist: true, purpose: 'generation task' }));
  } else if (body.specPath) {
    args.push('--spec', normalizePackageCliPath(webRoot, body.specPath, { mustExist: true, purpose: 'spec path' }));
  } else {
    throw httpError(400, 'Provide a generation task path or a spec path.');
  }

  args.push('--out', target);
  const result = await runAndRecord('web-spec-ai', 'packages/web', 'ai:brain:generate', args, { needsAi: true });
  result.files = [toFileRef(webRoot, path.resolve(webRoot, target))];
  return result;
}

async function handleWebSpecCheck(req) {
  const body = await readJson(req);
  const action = optionalEnum(body.action, new Set(['review', 'gate', 'drift', 'catalog', 'generated-ui']), 'spec check action') || 'review';
  const scriptByAction = {
    review: 'ai:test:review',
    gate: 'ai:test:gate',
    drift: 'ai:spec:drift',
    catalog: 'ai:spec:catalog',
    'generated-ui': 'ai:test:ui:generated'
  };
  const args = [];

  if (action === 'review' || action === 'gate') {
    args.push('--spec', normalizePackageCliPath(webRoot, body.specPath, { mustExist: true, purpose: 'spec path' }));
    args.push('--test', normalizePackageCliPath(webRoot, body.targetTestFile, { mustExist: true, purpose: 'generated test file' }));
    const mode = optionalEnum(body.mode, new Set(['single', 'suite']), 'generation mode');
    if (mode) {
      args.push('--mode', mode);
    }
  }

  return runAndRecord(`web-spec-${action}`, 'packages/web', scriptByAction[action], args, { needsAi: true });
}

async function handleWebRecordingTask(req) {
  const body = await readJson(req);
  const recordingPath = normalizePackageCliPath(webRoot, body.recordingPath, { mustExist: true, purpose: 'recording path' });
  const args = [recordingPath];
  const target = optionalPackageCliPath(webRoot, body.targetTestFile, { purpose: 'generated test file' });

  if (target) {
    args.push('--target', target);
  }

  const result = await runAndRecord('web-recording-task', 'packages/web', 'ai:recording:generate-test', args, { needsAi: true });
  const taskPath = parseWebTaskPath(result.stdout, 'Recording generation task created:');
  if (taskPath) {
    result.metadata = readWebTaskMetadata(taskPath);
    result.files = webTaskFiles(result.metadata);
  }
  return result;
}

async function handleWebRecordingAi(req) {
  const body = await readJson(req);
  const taskPath = normalizePackageCliPath(webRoot, body.taskPath, { mustExist: true, purpose: 'recording task' });
  const target = normalizePackageCliPath(webRoot, body.targetTestFile, { purpose: 'generated test file' });
  const result = await runAndRecord('web-recording-ai', 'packages/web', 'ai:brain:generate', [taskPath, '--out', target], { needsAi: true });
  result.files = [toFileRef(webRoot, path.resolve(webRoot, target))];
  return result;
}

async function handleWebRecordingCheck(req) {
  const body = await readJson(req);
  const action = optionalEnum(body.action, new Set(['review', 'gate', 'drift']), 'recording check action') || 'review';
  const scriptByAction = {
    review: 'ai:recording:review',
    gate: 'ai:recording:gate',
    drift: 'ai:recording:drift'
  };
  const args = [];

  if (action === 'review' || action === 'gate') {
    args.push('--recording', normalizePackageCliPath(webRoot, body.recordingPath, { mustExist: true, purpose: 'recording path' }));
    args.push('--test', normalizePackageCliPath(webRoot, body.targetTestFile, { mustExist: true, purpose: 'generated test file' }));
  }

  return runAndRecord(`web-recording-${action}`, 'packages/web', scriptByAction[action], args, { needsAi: true });
}

function buildApiGenerateArgs(body) {
  const harInputs = toStringList(body.harInputs);
  if (harInputs.length === 0) {
    throw httpError(400, 'At least one HAR input is required.');
  }

  const args = [];
  for (const harInput of harInputs) {
    args.push('--har', normalizePackageCliPath(apiRoot, harInput, { mustExist: true, purpose: 'HAR input' }));
  }

  args.push('--out', normalizePackageCliPath(apiRoot, body.outDir || 'tests/generated', { purpose: 'output directory' }));

  addOptionalValue(args, '--base-url', body.baseUrl);
  addRepeatedValues(args, '--include', toStringList(body.include));
  addRepeatedValues(args, '--exclude', toStringList(body.exclude));
  addRepeatedValues(args, '--ignore-domain', toStringList(body.ignoredDomains));
  addRepeatedValues(args, '--first-party', toStringList(body.firstPartyDomains));

  const methods = toStringList(body.methods).map((method) => method.toUpperCase());
  validateSubset(methods, new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']), 'HTTP method');
  if (methods.length > 0) {
    args.push('--method', methods.join(','));
  }

  const statuses = toStringList(body.statuses);
  if (statuses.length > 0) {
    for (const status of statuses) {
      if (!/^\d{3}$/.test(status)) {
        throw httpError(400, `Invalid status filter: ${status}`);
      }
    }
    args.push('--status', statuses.join(','));
  }

  const generationModes = toStringList(body.generationModes);
  validateSubset(generationModes, new Set(['smoke', 'extended']), 'generation mode');
  if (generationModes.length > 0) {
    args.push('--generation-mode', generationModes.join(','));
  }

  addEnum(args, '--inference-level', body.inferenceLevel, new Set(['conservative', 'balanced', 'aggressive']), 'inference level');
  addEnum(args, '--inferred-run-mode', body.inferredRunMode, new Set(['mixed', 'all-active', 'replay-only']), 'inferred run mode');
  addEnum(args, '--negative-status-policy', body.negativeStatusPolicy, new Set(['family', 'strict', 'config']), 'negative status policy');
  addEnum(args, '--mutation-policy', body.mutationPolicy, new Set(['guarded', 'all-skipped', 'all-active']), 'mutation policy');

  const configPath = optionalPackageCliPath(apiRoot, body.configPath, { mustExist: true, purpose: 'config file' });
  if (configPath) {
    args.push('--config', configPath);
  }

  const calibrationPath = optionalPackageCliPath(apiRoot, body.calibrationOverridesPath, {
    mustExist: true,
    purpose: 'calibration overrides'
  });
  if (calibrationPath) {
    args.push('--calibration', calibrationPath);
  }

  if (Boolean(body.ai)) {
    args.push('--ai');
  }
  if (Boolean(body.dryRun)) {
    args.push('--dry-run');
  }

  return args;
}

async function runAndRecord(kind, workspace, script, args, { needsAi = false } = {}) {
  const result = await runWorkspaceScript(workspace, script, args, { needsAi });
  await appendHistory({
    id: crypto.randomUUID(),
    kind,
    script,
    ok: result.ok,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    createdAt: new Date().toISOString()
  });
  return {
    ok: result.ok,
    kind,
    script,
    command: result.command,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

async function runWorkspaceScript(workspace, script, args, { needsAi = false } = {}) {
  const env = await aiEnv(process.env, { includeKeys: needsAi });
  const commandArgs = ['--silent', 'run', '-w', workspace, script];
  if (args.length > 0) {
    commandArgs.push('--', ...args);
  }

  return runChildProcess({
    command: 'npm',
    args: commandArgs,
    cwd: repoRoot,
    env,
    meta: { workspace, script },
    display: commandForDisplay(commandArgs)
  });
}

// Single-flight guard. beginActiveCommand does an atomic (no await between)
// check-and-set so two concurrent requests cannot both pass the 409 gate.
function publicActiveCommand() {
  if (!activeCommand) {
    return null;
  }
  return {
    workspace: activeCommand.workspace,
    script: activeCommand.script,
    startedAt: activeCommand.startedAt
  };
}

function beginActiveCommand(meta) {
  if (activeCommand) {
    throw httpError(409, `Another command is running: ${activeCommand.script}`);
  }
  activeCommand = {
    ...meta,
    child: null,
    startedAt: new Date().toISOString()
  };
  return activeCommand;
}

function clearActiveCommand(token) {
  if (activeCommand === token) {
    activeCommand = null;
  }
}

function killProcessTree(child, signal) {
  if (!child || child.exitCode !== null) {
    return;
  }
  try {
    // Negative PID targets the whole detached process group (npm + its
    // grandchildren such as node/playwright), not just the npm wrapper.
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already exited.
    }
  }
}

function killActiveCommand() {
  const token = activeCommand;
  if (!token || !token.child) {
    return false;
  }
  killProcessTree(token.child, 'SIGTERM');
  const child = token.child;
  setTimeout(() => killProcessTree(child, 'SIGKILL'), 2000).unref?.();
  return true;
}

function runChildProcess({ command, args, cwd, env, meta, display }) {
  const token = beginActiveCommand(meta);
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearActiveCommand(token);
      resolve(result);
    };

    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true
      });
    } catch (error) {
      clearActiveCommand(token);
      resolve({
        ok: false,
        command: display,
        exitCode: null,
        durationMs: Date.now() - startedAt,
        stdout: '',
        stderr: error.message
      });
      return;
    }

    token.child = child;

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child, 'SIGTERM');
      setTimeout(() => killProcessTree(child, 'SIGKILL'), 2000).unref?.();
    }, commandTimeoutMs);
    timer.unref?.();

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      finish({
        ok: false,
        command: display,
        exitCode: null,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}${error.message}`
      });
    });

    child.on('close', (exitCode) => {
      finish({
        ok: exitCode === 0 && !timedOut,
        command: display,
        exitCode,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr: timedOut
          ? `${stderr}${stderr ? '\n' : ''}Command timed out after ${commandTimeoutMs}ms and was terminated.`
          : stderr
      });
    });
  });
}

function commandForDisplay(args) {
  return ['npm', ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ');
}

function addOptionalValue(args, flag, value) {
  if (typeof value === 'string' && value.trim()) {
    args.push(flag, value.trim());
  }
}

function addRepeatedValues(args, flag, values) {
  for (const value of values) {
    args.push(flag, value);
  }
}

function addEnum(args, flag, value, allowedValues, label) {
  const normalized = optionalEnum(value, allowedValues, label);
  if (normalized) {
    args.push(flag, normalized);
  }
}

function optionalEnum(value, allowedValues, label) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const normalized = String(value).trim();
  if (!allowedValues.has(normalized)) {
    throw httpError(400, `Unsupported ${label}: ${normalized}`);
  }
  return normalized;
}

function validateSubset(values, allowedValues, label) {
  for (const value of values) {
    if (!allowedValues.has(value)) {
      throw httpError(400, `Unsupported ${label}: ${value}`);
    }
  }
}

function normalizePackageCliPath(packageRoot, value, options = {}) {
  const resolved = resolvePackagePath(packageRoot, value, options);
  return path.relative(packageRoot, resolved) || '.';
}

function optionalPackageCliPath(packageRoot, value, options = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return undefined;
  }
  return normalizePackageCliPath(packageRoot, value, options);
}

function resolvePackagePath(packageRoot, value, { mustExist = false, purpose = 'path' } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw httpError(400, `Missing ${purpose}.`);
  }

  const raw = String(value).trim();
  const packageCandidate = path.resolve(packageRoot, raw);
  const repoCandidate = path.resolve(repoRoot, raw);
  let resolved = path.isAbsolute(raw) ? path.resolve(raw) : packageCandidate;

  if (!path.isAbsolute(raw) && pathInside(repoCandidate, packageRoot)) {
    if (mustExist) {
      resolved = fs.existsSync(repoCandidate) || !fs.existsSync(packageCandidate) ? repoCandidate : packageCandidate;
    } else if (raw.startsWith(path.relative(repoRoot, packageRoot))) {
      resolved = repoCandidate;
    }
  }

  assertInside(resolved, packageRoot, purpose);

  if (mustExist && !fs.existsSync(resolved)) {
    throw httpError(400, `Missing ${purpose}: ${raw}`);
  }

  return resolved;
}

function assertInside(candidate, root, purpose) {
  if (!pathInside(candidate, root)) {
    throw httpError(400, `${purpose} must stay inside ${path.relative(repoRoot, root)}.`);
  }
}

function assertPreviewAllowed(relativePath, allow) {
  const segments = relativePath.split(path.sep).filter(Boolean);
  if (segments.length === 0 || !allow.dirs.has(segments[0])) {
    throw httpError(403, 'Preview is restricted to generator inputs and outputs.');
  }
  if (!allow.extensions.has(path.extname(relativePath).toLowerCase())) {
    throw httpError(403, 'Preview file type is not allowed.');
  }
  // Defense-in-depth: never expose secret-bearing files even inside allowed dirs.
  for (const segment of segments) {
    if (segment === '.auth' || segment.toLowerCase().startsWith('.env')) {
      throw httpError(403, 'Preview of secret files is not allowed.');
    }
  }
}

function pathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function toStringList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function extractMarkdownSpec(text) {
  const source = String(text ?? '').trim();
  const fenced = source.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i);
  let candidate = (fenced?.[1] ?? source).trim();
  const flowIndex = candidate.search(/^#\s*Flow:/im);
  if (flowIndex >= 0) {
    candidate = candidate.slice(flowIndex).trim();
  }

  if (!/^#\s*Flow:/i.test(candidate)) {
    throw new Error('AI response did not return a Markdown spec starting with "# Flow:".');
  }

  return candidate.endsWith('\n') ? candidate : `${candidate}\n`;
}

function parseJsonObjectFromStdout(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }

  const candidates = [];
  candidates.push(trimmed);

  const lastObjectStart = trimmed.lastIndexOf('\n{');
  if (lastObjectStart >= 0) {
    candidates.push(trimmed.slice(lastObjectStart + 1));
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  return undefined;
}

function parseWebTaskPath(stdout, label) {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === label && lines[index + 1]) {
      return lines[index + 1];
    }

    if (lines[index].startsWith(label)) {
      return lines[index].slice(label.length).trim();
    }
  }

  return undefined;
}

function readWebTaskMetadata(taskPath) {
  const taskCliPath = normalizePackageCliPath(webRoot, taskPath, { mustExist: true, purpose: 'generation task' });
  const taskAbsolutePath = path.resolve(webRoot, taskCliPath);
  const taskContent = fs.readFileSync(taskAbsolutePath, 'utf8');
  const manifestAbsolutePath = path.join(path.dirname(taskAbsolutePath), 'manifest.json');
  const normalizedRecordingPath = path.join(path.dirname(taskAbsolutePath), 'normalized-recording.json');
  const targetMatch = taskContent.match(/- Target test file: `([^`]+)`/);
  const specMatch = taskContent.match(/- Spec path: `([^`]+)`/);
  const recordingMatch = taskContent.match(/- Recording path: `([^`]+)`/);

  let manifest;
  if (fs.existsSync(manifestAbsolutePath)) {
    // A corrupt manifest (e.g. from a generator run killed mid-write) must not
    // take down GET /api/state, which reads metadata for every task.
    try {
      manifest = JSON.parse(fs.readFileSync(manifestAbsolutePath, 'utf8'));
    } catch {
      manifest = undefined;
    }
  }

  return {
    taskPath: taskCliPath,
    manifestPath: path.relative(webRoot, manifestAbsolutePath),
    normalizedRecordingPath: fs.existsSync(normalizedRecordingPath) ? path.relative(webRoot, normalizedRecordingPath) : undefined,
    targetTestFile: targetMatch?.[1],
    specPath: specMatch?.[1] || manifest?.specPath,
    recordingPath: recordingMatch?.[1] || manifest?.recordingPath,
    generationMode: manifest?.generationMode,
    flowId: manifest?.flowId,
    recordingTitle: manifest?.recordingTitle,
    createdAt: manifest?.createdAt
  };
}

function webTaskFiles(metadata) {
  return [metadata.taskPath, metadata.manifestPath, metadata.normalizedRecordingPath]
    .filter(Boolean)
    .map((filePath) => toFileRef(webRoot, path.resolve(webRoot, filePath)));
}

function toFileRef(packageRoot, absolutePath) {
  assertInside(absolutePath, packageRoot, 'file');
  return {
    path: path.relative(packageRoot, absolutePath) || '.',
    label: path.relative(repoRoot, absolutePath)
  };
}

async function readTextFileForPreview(url) {
  const scope = url.searchParams.get('scope') || 'api';
  const root = packageRoots[scope];
  const allow = previewAllowlist[scope];
  if (!root || !allow) {
    throw httpError(400, `Unsupported file scope: ${scope}`);
  }

  const requestedPath = url.searchParams.get('path');
  // Enforce the allowlist before touching the filesystem so denied paths always
  // return 403 (never a 400/404 that would leak whether a secret file exists).
  const absolutePath = resolvePackagePath(root, requestedPath, { purpose: 'preview file' });
  assertPreviewAllowed(path.relative(root, absolutePath), allow);

  // Canonicalize and re-validate. The checks above are lexical, but stat/readFile
  // follow symlinks — a symlink inside an allowed directory could otherwise point
  // the allowlist at a secret outside it (.env, playwright/.auth, .ui-runs).
  let realRoot;
  let realPath;
  try {
    realRoot = await fsp.realpath(root);
    realPath = await fsp.realpath(absolutePath);
  } catch {
    throw httpError(404, 'Preview file not found.');
  }
  assertInside(realPath, realRoot, 'preview file');
  assertPreviewAllowed(path.relative(realRoot, realPath), allow);

  const stat = await fsp.stat(realPath);
  if (!stat.isFile()) {
    throw httpError(400, 'Preview path must be a file.');
  }
  if (stat.size > 512 * 1024) {
    throw httpError(413, 'Preview file is larger than 512 KB.');
  }

  return {
    ok: true,
    file: toFileRef(realRoot, realPath),
    content: await fsp.readFile(realPath, 'utf8')
  };
}

async function readJson(req) {
  const body = await collectBody(req, jsonLimitBytes);
  try {
    return body.length ? JSON.parse(body.toString('utf8')) : {};
  } catch (error) {
    throw httpError(400, `Invalid JSON body: ${error.message}`);
  }
}

async function collectBody(req, limitBytes) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > limitBytes) {
      throw httpError(413, 'Request body is too large.');
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) {
    throw httpError(400, 'Multipart boundary is missing.');
  }

  const body = buffer.toString('latin1');
  const delimiter = `--${boundary}`;
  const parts = [];

  for (const rawPart of body.split(delimiter)) {
    if (!rawPart || rawPart === '--\r\n' || rawPart === '--') {
      continue;
    }

    const trimmedPart = rawPart.replace(/^\r\n/, '').replace(/\r\n--$/, '').replace(/\r\n$/, '');
    const headerEnd = trimmedPart.indexOf('\r\n\r\n');
    if (headerEnd < 0) {
      continue;
    }

    const rawHeaders = trimmedPart.slice(0, headerEnd);
    const content = trimmedPart.slice(headerEnd + 4);
    const disposition = rawHeaders.split(/\r\n/).find((line) => line.toLowerCase().startsWith('content-disposition:')) || '';
    const filenameMatch = disposition.match(/filename="([^"]*)"/i);
    const nameMatch = disposition.match(/name="([^"]*)"/i);

    parts.push({
      name: nameMatch?.[1],
      filename: filenameMatch?.[1],
      content: Buffer.from(content, 'latin1')
    });
  }

  return parts;
}

function sanitizeFileName(fileName) {
  const baseName = path.basename(fileName).replace(/[^\w.\-]+/g, '-').replace(/^-+|-+$/g, '');
  return baseName || `upload-${Date.now()}`;
}

async function listPackageFiles(packageRoot, relativeRoot, extensions) {
  const start = path.join(packageRoot, relativeRoot);
  if (!fs.existsSync(start)) {
    return [];
  }

  const results = [];
  await walk(start, 4, async (filePath) => {
    if (extensions.has(path.extname(filePath).toLowerCase())) {
      results.push({
        path: path.relative(packageRoot, filePath),
        label: path.relative(repoRoot, filePath)
      });
    }
  });
  return results.sort((left, right) => left.path.localeCompare(right.path));
}

async function listWebGenerationTasks(kind) {
  const start = path.join(webRoot, '.ai-runs');
  if (!fs.existsSync(start)) {
    return [];
  }

  const tasks = [];
  await walk(start, 3, async (filePath) => {
    if (path.basename(filePath) !== 'generation-task.md') {
      return;
    }

    const metadata = readWebTaskMetadata(path.relative(webRoot, filePath));
    const taskKind = metadata.recordingPath ? 'recording' : 'spec';
    if (kind && taskKind !== kind) {
      return;
    }

    const stat = await fsp.stat(filePath);
    tasks.push({
      ...metadata,
      kind: taskKind,
      path: metadata.taskPath,
      label: path.relative(repoRoot, filePath),
      updatedAt: stat.mtime.toISOString()
    });
  });

  return tasks.sort((left, right) => String(right.createdAt || right.updatedAt).localeCompare(String(left.createdAt || left.updatedAt)));
}

async function listWebGeneratedTests() {
  const files = await listPackageFiles(webRoot, 'tests', new Set(['.ts']));
  const specFiles = files.filter((file) => file.path.endsWith('.spec.ts'));
  const withStats = await Promise.all(
    specFiles.map(async (file) => {
      const stat = await fsp.stat(path.join(webRoot, file.path));
      return {
        ...file,
        updatedAt: stat.mtime.toISOString()
      };
    })
  );

  return withStats.sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.path.localeCompare(right.path)
  );
}

async function listWebFlowSpecs() {
  const specFiles = (await listPackageFiles(webRoot, 'specs', new Set(['.md']))).filter(
    (file) => path.basename(file.path) !== '_template.md'
  );
  const specs = [];

  for (const file of specFiles) {
    const absolutePath = path.join(webRoot, file.path);
    try {
      const content = await fsp.readFile(absolutePath, 'utf8');
      const parsed = parseFlowSpec(content);
      const stat = await fsp.stat(absolutePath);
      specs.push({
        ...file,
        scope: 'web',
        title: parsed.title || titleFromPathServer(file.path),
        flowId: parsed.metadata['Flow ID'] || '',
        targetTestFile: parsed.metadata['Target Test File'] || '',
        generationMode: parsed.metadata['Generation Mode'] || '',
        priority: priorityFromSpec(parsed.metadata.Priority),
        tags: toStringList(parsed.metadata.Tags || ''),
        createdAt: (stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime).toISOString(),
        updatedAt: stat.mtime.toISOString()
      });
    } catch {
      // Leave malformed or draft markdown specs out of the direct generation list.
    }
  }

  return specs.sort(
    (left, right) =>
      Date.parse(right.createdAt || right.updatedAt) - Date.parse(left.createdAt || left.updatedAt) ||
      right.path.localeCompare(left.path)
  );
}

async function walk(directory, depth, onFile) {
  if (depth < 0) {
    return;
  }

  const entries = await fsp.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(entryPath, depth - 1, onFile);
    } else if (entry.isFile()) {
      await onFile(entryPath);
    }
  }
}

// Serializes read-modify-write cycles on a JSON store file so concurrent
// requests (two tabs, a double-click) cannot lose updates or mint duplicate IDs.
const storeLocks = new Map();

function withStoreLock(key, fn) {
  const previous = storeLocks.get(key) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  storeLocks.set(
    key,
    run.then(
      () => {},
      () => {}
    )
  );
  return run;
}

async function writeJsonFileAtomic(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  await fsp.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`);
  await fsp.rename(tmpPath, filePath);
}

// Returns parsed JSON, or undefined when the file is missing. A corrupt file is
// preserved as `${path}.corrupt-<ts>` (never silently overwritten) and treated
// as missing so the store self-heals without destroying recoverable data.
async function readJsonFile(filePath) {
  let raw;
  try {
    raw = await fsp.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }

  try {
    return JSON.parse(raw);
  } catch {
    const backupPath = `${filePath}.corrupt-${Date.now()}`;
    try {
      await fsp.rename(filePath, backupPath);
      console.error(`Corrupt JSON store ${filePath} preserved as ${backupPath}`);
    } catch {
      // Best effort; still fall back to empty rather than crash.
    }
    return undefined;
  }
}

async function readTestManagement() {
  return normalizeTestManagementStore(await readJsonFile(testManagementPath));
}

async function writeTestManagement(store) {
  await writeJsonFileAtomic(testManagementPath, normalizeTestManagementStore(store));
}

async function readTestManagementState() {
  return mergeTestManagementStore(await readTestManagement());
}

async function mergeTestManagementStore(store) {
  const repositoryCases = await listRepositoryTestCases();
  const localCases = store.cases.map((testCase) => ({
    ...testCase,
    source: testCase.source || 'ui',
    readOnly: false
  }));
  const localIds = new Set(localCases.map((testCase) => testCase.id));
  const mergedRepositoryCases = repositoryCases.filter((testCase) => !localIds.has(testCase.id));

  return {
    ...store,
    cases: [...localCases, ...mergedRepositoryCases],
    sourceCounts: {
      localCases: localCases.length,
      repositoryCases: mergedRepositoryCases.length
    }
  };
}

async function listKnownTestCases(store) {
  return (await mergeTestManagementStore(store)).cases;
}

async function listRepositoryTestCases() {
  const yamlCases = await listYamlRepositoryTestCases();
  const seen = new Set();
  return yamlCases.filter((testCase) => {
    if (!testCase.id || seen.has(testCase.id)) {
      return false;
    }
    seen.add(testCase.id);
    return true;
  });
}

async function listYamlRepositoryTestCases() {
  const cases = [];
  for (const sourcePath of repositoryTestCaseFiles) {
    const absolutePath = path.join(webRoot, sourcePath);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }
    const content = await fsp.readFile(absolutePath, 'utf8');
    cases.push(...parseYamlRepositoryTestCases(content, sourcePath));
  }
  return cases;
}

function parseYamlRepositoryTestCases(content, sourcePath) {
  return String(content)
    .split(/\n(?=\s{2}-\s+id:\s*)/)
    .filter((block) => /^\s*-?\s*id:\s*/m.test(block))
    .map((block) => yamlRepositoryCase(block, sourcePath))
    .filter((testCase) => testCase.id && testCase.title);
}

function yamlRepositoryCase(block, sourcePath) {
  const type = yamlScalarField(block, 'type');
  const techniques = yamlInlineListField(block, 'technique');
  const steps = yamlListField(block, 'steps');
  const expected = yamlListField(block, 'expected');

  return {
    id: yamlScalarField(block, 'id'),
    title: yamlScalarField(block, 'title'),
    area: yamlScalarField(block, 'area'),
    priority: priorityFromName(yamlScalarField(block, 'priority')),
    status: 'ready',
    automation: 'manual',
    testPath: '',
    specPath: sourcePath,
    recordingPath: '',
    tags: [type, ...techniques].filter(Boolean),
    preconditions: yamlListField(block, 'preconditions').join('\n'),
    steps: steps.join('\n'),
    expectedResult: expected.join('\n'),
    source: 'repository-yaml',
    sourcePath,
    readOnly: true
  };
}

function yamlScalarField(block, fieldName) {
  const match = String(block).match(new RegExp(`^\\s*(?:-\\s*)?${fieldName}:\\s*(.*?)\\s*$`, 'm'));
  return unquoteYamlScalar(match?.[1] || '');
}

function yamlInlineListField(block, fieldName) {
  const value = yamlScalarField(block, fieldName);
  const inner = value.match(/^\[(.*)\]$/)?.[1];
  if (!inner) {
    return value ? [value] : [];
  }
  return inner.split(',').map((entry) => unquoteYamlScalar(entry)).filter(Boolean);
}

function yamlListField(block, fieldName) {
  const lines = String(block).split(/\r?\n/);
  const startIndex = lines.findIndex((line) => new RegExp(`^\\s{4}${fieldName}:\\s*$`).test(line));
  if (startIndex < 0) {
    return [];
  }

  const values = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s{4}[A-Za-z][\w]*:\s*/.test(line) || /^\s{2}-\s+id:\s*/.test(line)) {
      break;
    }

    const itemMatch = line.match(/^\s*-\s+(.*)$/);
    if (itemMatch) {
      values.push(unquoteYamlScalar(itemMatch[1]));
    } else if (values.length > 0 && line.trim()) {
      values[values.length - 1] = `${values[values.length - 1]} ${line.trim()}`;
    }
  }
  return values;
}

function unquoteYamlScalar(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }
  if ((normalized.startsWith('"') && normalized.endsWith('"')) || (normalized.startsWith("'") && normalized.endsWith("'"))) {
    return normalized.slice(1, -1).replace(/\\"/g, '"').replace(/''/g, "'");
  }
  return normalized;
}

function priorityFromName(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['critical', 'high', 'medium', 'low'].includes(normalized)) {
    return normalized;
  }
  return 'medium';
}

function priorityFromSpec(value) {
  return (
    {
      P0: 'critical',
      P1: 'high',
      P2: 'medium',
      P3: 'low'
    }[String(value || '').trim().toUpperCase()] || priorityFromName(value)
  );
}

function titleFromPathServer(filePath) {
  return path
    .basename(filePath, path.extname(filePath))
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function readUiSettings() {
  return normalizeUiSettings(await readJsonFile(settingsPath));
}

async function writeUiSettings(settings) {
  await writeJsonFileAtomic(settingsPath, normalizeUiSettings(settings));
}

function emptyUiSettings() {
  return {
    ai: {
      brain: 'auto',
      anthropicApiKey: '',
      openaiApiKey: '',
      anthropicModel: '',
      openaiModel: '',
      timeoutMs: ''
    }
  };
}

function normalizeUiSettings(value) {
  const empty = emptyUiSettings();
  if (typeof value !== 'object' || value === null) {
    return empty;
  }

  const ai = typeof value.ai === 'object' && value.ai !== null ? value.ai : {};
  const brain = ['auto', 'anthropic', 'openai', 'claude-cli', 'codex-cli'].includes(ai.brain) ? ai.brain : 'auto';
  return {
    ai: {
      brain,
      anthropicApiKey: optionalText(ai.anthropicApiKey),
      openaiApiKey: optionalText(ai.openaiApiKey),
      anthropicModel: optionalText(ai.anthropicModel),
      openaiModel: optionalText(ai.openaiModel),
      timeoutMs: optionalText(ai.timeoutMs)
    }
  };
}

function publicSettings(settings) {
  const normalized = normalizeUiSettings(settings);
  return {
    ai: {
      brain: normalized.ai.brain,
      anthropicApiKeyConfigured: Boolean(normalized.ai.anthropicApiKey),
      anthropicApiKeyHint: keyHint(normalized.ai.anthropicApiKey),
      openaiApiKeyConfigured: Boolean(normalized.ai.openaiApiKey),
      openaiApiKeyHint: keyHint(normalized.ai.openaiApiKey),
      anthropicModel: normalized.ai.anthropicModel,
      openaiModel: normalized.ai.openaiModel,
      timeoutMs: normalized.ai.timeoutMs
    }
  };
}

function keyHint(value) {
  const normalized = optionalText(value);
  return normalized ? `...${normalized.slice(-4)}` : '';
}

async function aiEnv(baseEnv, { includeKeys = true } = {}) {
  const settings = await readUiSettings();
  const env = { ...baseEnv };
  const ai = settings.ai;

  if (ai.brain && ai.brain !== 'auto') {
    env.AI_BRAIN = ai.brain;
  }
  // API keys are only injected for AI actions. Non-AI child processes (e.g.
  // executing generated test code) must not receive stored key material.
  if (includeKeys && ai.anthropicApiKey) {
    env.ANTHROPIC_API_KEY = ai.anthropicApiKey;
  }
  if (includeKeys && ai.openaiApiKey) {
    env.OPENAI_API_KEY = ai.openaiApiKey;
  }
  if (ai.anthropicModel) {
    env.AI_ANTHROPIC_MODEL = ai.anthropicModel;
  }
  if (ai.openaiModel) {
    env.AI_OPENAI_MODEL = ai.openaiModel;
  }
  if (ai.timeoutMs) {
    env.AI_BRAIN_TIMEOUT_MS = ai.timeoutMs;
  }

  return env;
}

function emptyTestManagementStore() {
  return {
    cases: [],
    suites: [],
    runs: [],
    counters: {
      case: 0,
      suite: 0,
      run: 0
    }
  };
}

function normalizeTestManagementStore(value) {
  const empty = emptyTestManagementStore();
  if (typeof value !== 'object' || value === null) {
    return empty;
  }

  const candidate = value;
  // Validate each item so a hand-edited file (e.g. a run missing `results` or
  // `caseIds`) can't surface later as an opaque 500 TypeError in the handlers.
  const cases = normalizeStoreItems(candidate.cases, normalizeStoredCase);
  const suites = normalizeStoreItems(candidate.suites, normalizeStoredSuite);
  const runs = normalizeStoreItems(candidate.runs, normalizeStoredRun);

  return {
    cases,
    suites,
    runs,
    counters: {
      case: Number.isInteger(candidate.counters?.case) ? candidate.counters.case : inferCounter(cases, 'TC'),
      suite: Number.isInteger(candidate.counters?.suite) ? candidate.counters.suite : inferCounter(suites, 'TS'),
      run: Number.isInteger(candidate.counters?.run) ? candidate.counters.run : inferCounter(runs, 'TR')
    }
  };
}

function normalizeStoreItems(items, normalizeItem) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((item) => (item && typeof item === 'object' ? normalizeItem(item) : null))
    .filter((item) => item && typeof item.id === 'string' && item.id);
}

function normalizeStoredCase(testCase) {
  return { ...testCase, tags: Array.isArray(testCase.tags) ? testCase.tags : [] };
}

function normalizeStoredSuite(suite) {
  return { ...suite, caseIds: Array.isArray(suite.caseIds) ? suite.caseIds : [] };
}

function normalizeStoredRun(run) {
  const caseIds = Array.isArray(run.caseIds) ? run.caseIds.filter((id) => typeof id === 'string') : [];
  const results = run.results && typeof run.results === 'object' ? run.results : {};
  return { ...run, caseIds, results };
}

function inferCounter(items, prefix) {
  if (!Array.isArray(items)) {
    return 0;
  }

  return items.reduce((max, item) => {
    const match = typeof item?.id === 'string' ? item.id.match(new RegExp(`^${prefix}-(\\d+)$`)) : undefined;
    return match ? Math.max(max, Number.parseInt(match[1], 10)) : max;
  }, 0);
}

function nextEntityId(store, counterName, prefix) {
  store.counters[counterName] = (store.counters[counterName] ?? 0) + 1;
  return `${prefix}-${String(store.counters[counterName]).padStart(4, '0')}`;
}

function requiredText(value, label) {
  const normalized = optionalText(value);
  if (!normalized) {
    throw httpError(400, `Missing ${label}.`);
  }
  return normalized;
}

function optionalText(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

function normalizeOptionalPositiveInteger(value, fallback = '') {
  const normalized = optionalText(value);
  if (!normalized) {
    return fallback;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw httpError(400, 'AI timeout must be a positive number of milliseconds.');
  }
  return String(parsed);
}

function enumValue(value, allowedValues, label, fallback) {
  const normalized = optionalText(value) || fallback;
  if (!allowedValues.has(normalized)) {
    throw httpError(400, `Unsupported ${label}: ${normalized}`);
  }
  return normalized;
}

function optionalSafeRelativePath(value, label) {
  const normalized = optionalText(value);
  if (!normalized) {
    return '';
  }

  if (path.isAbsolute(normalized) || normalized.split(/[\\/]/).includes('..')) {
    throw httpError(400, `${label} must be a relative repository path.`);
  }
  return normalized;
}

function normalizeCaseIds(knownCasesOrStore, value) {
  const requestedIds = [...new Set(toStringList(value))];
  const knownCases = Array.isArray(knownCasesOrStore) ? knownCasesOrStore : knownCasesOrStore.cases;
  const knownIds = new Set(knownCases.map((testCase) => testCase.id));
  for (const caseId of requestedIds) {
    if (!knownIds.has(caseId)) {
      throw httpError(400, `Unknown test case: ${caseId}`);
    }
  }
  return requestedIds;
}

function summarizeRunStatus(run) {
  const statuses = run.caseIds.map((caseId) => run.results[caseId]?.status ?? 'untested');
  if (statuses.every((status) => status === 'untested')) {
    return 'planned';
  }
  if (statuses.every((status) => status !== 'untested')) {
    return 'completed';
  }
  return 'in-progress';
}

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const requestedPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const absolutePath = path.resolve(publicRoot, `.${requestedPath}`);
  if (!pathInside(absolutePath, publicRoot)) {
    return sendJson(res, 403, { ok: false, error: 'Forbidden' });
  }

  let stat;
  try {
    stat = await fsp.stat(absolutePath);
  } catch {
    const fallbackPath = path.join(publicRoot, 'index.html');
    return streamFile(req, res, fallbackPath);
  }

  if (stat.isDirectory()) {
    const indexPath = path.join(absolutePath, 'index.html');
    if (!fs.existsSync(indexPath)) {
      return sendJson(res, 404, { ok: false, error: 'Not found' });
    }
    return streamFile(req, res, indexPath);
  }

  return streamFile(req, res, absolutePath);
}

function streamFile(req, res, absolutePath) {
  const contentType = contentTypeFor(absolutePath);
  const stream = fs.createReadStream(absolutePath);

  // Without an error listener a read error (missing file, TOCTOU delete) throws
  // an uncaught exception and kills the whole server process.
  stream.on('error', () => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendJson(res, 404, { ok: false, error: 'Not found' });
  });

  stream.once('open', () => {
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    setSecurityHeaders(res, contentType);
    if (req.method === 'HEAD') {
      stream.destroy();
      res.end();
      return;
    }
    stream.pipe(res);
  });
}

function setSecurityHeaders(res, contentType) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (contentType.startsWith('text/html')) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
        "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    );
  }
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml'
  };
  return types[extension] || 'application/octet-stream';
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function httpError(statusCode, message) {
  /** @type {Error & { statusCode?: number }} */
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function appendHistory(entry) {
  await withStoreLock(historyPath, async () => {
    const history = await readHistory();
    history.unshift(entry);
    await writeJsonFileAtomic(historyPath, history.slice(0, 50));
  });
}

async function readHistory() {
  const parsed = await readJsonFile(historyPath);
  return Array.isArray(parsed) ? parsed : [];
}

export {
  assertPreviewAllowed,
  assertSafeListenHost,
  buildSpecFitPrompt,
  hostnameFromHostHeader,
  isAllowedOrigin,
  isLoopbackHost,
  normalizePackageCliPath,
  normalizeTestManagementStore,
  normalizeUiSettings,
  parseMultipart,
  pathInside,
  publicSettings,
  resolvePackagePath,
  sanitizeFileName,
  sanitizePromptSource,
  summarizeRunStatus
};
