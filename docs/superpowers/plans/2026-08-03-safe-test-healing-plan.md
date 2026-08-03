# Safe Test Healing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI-assisted Playwright healing fail closed, preserve tested behavior and source contracts, default to a non-mutating proposal, and promote only an explicitly approved, clean, fully verified candidate.

**Architecture:** Add small pure modules for failure triage, source-contract routing, and bounded context collection. Keep the existing complete-TypeScript provider transport, then treat its response as untrusted input: compare immutable semantic facts, run the correct generated/recorded/handwritten checks, create a private audit record, and atomically apply only with `--apply`.

**Tech Stack:** Node.js 20 ESM, TypeScript compiler API, Playwright Test 1.59, Node test runner, ESLint 9, existing generated/recorded reviewers and gate helpers.

## Global Constraints

- Healing remains opt-in through `AI_AUTOHEAL_ENABLED=true` and stays outside CI.
- Only `locator-drift` and `synchronization` classifications are repairable.
- Expected values, test data, contracts, titles, tags, annotations, fixtures, and action payloads must never change during healing.
- Proposal-only is the default; target mutation requires `--apply`.
- `--apply` requires a clean target unless `--allow-dirty` is also supplied.
- Verification uses `workers=1`, `retries=0`, and exactly `AI_AUTOHEAL_VERIFY_RUNS` repetitions.
- Recorded tests must pass the recording reviewer and normalized recording-hash check.
- Imported Page Object/Component source is provider context only; automatic multi-file promotion is forbidden.
- Authenticated traces, screenshots, videos, cookies, headers, and storage state are never retained or sent to a provider.
- Existing user changes outside the files named by a task must not be staged, reformatted, or reverted.

---

### Task 1: Deterministic failure triage

**Files:**
- Create: `packages/web/scripts/ai/lib/test-heal-triage.mjs`
- Create: `packages/web/scripts/ai/__tests__/test-heal-triage.test.mjs`

**Interfaces:**
- Consumes: sanitized evidence strings and an optional gate stage.
- Produces: `triageRuntimeFailure({ evidence, stage }) -> { schema, classification, repairable, reasonCodes, evidenceFingerprint }`.

- [ ] **Step 1: Write failing triage tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { triageRuntimeFailure } from '../lib/test-heal-triage.mjs';

test('triage permits a strict locator failure', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-test',
    evidence: ['save flow: locator.click: strict mode violation: getByRole("button", { name: "Save" }) resolved to 2 elements']
  });
  assert.equal(verdict.classification, 'locator-drift');
  assert.equal(verdict.repairable, true);
  assert.deepEqual(verdict.reasonCodes, ['LOCATOR_STRICT_MODE_VIOLATION']);
  assert.match(verdict.evidenceFingerprint, /^[a-f0-9]{64}$/);
});

test('triage rejects assertion, auth, network, and unknown failures', () => {
  for (const evidence of [
    ['Expected string: "Saved"', 'Received string: "Save failed"'],
    ['401 Unauthorized while loading plan'],
    ['request failed: ECONNRESET'],
    ['something unexplained happened']
  ]) {
    const verdict = triageRuntimeFailure({ stage: 'runtime-test', evidence });
    assert.equal(verdict.repairable, false);
  }
});

test('environment stages fail closed before textual triage', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-environment',
    evidence: ['locator.click timed out']
  });
  assert.equal(verdict.classification, 'environment');
  assert.equal(verdict.repairable, false);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
cd packages/web
node --test scripts/ai/__tests__/test-heal-triage.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `test-heal-triage.mjs`.

- [ ] **Step 3: Implement the conservative classifier**

```js
import crypto from 'node:crypto';

export const TEST_HEAL_TRIAGE_SCHEMA = 'test-heal-triage/v1';

const PRODUCT_PATTERNS = [
  /expected(?: string| pattern| value)?\s*:/i,
  /received(?: string| value)?\s*:/i,
  /status(?: code)?\s*(?:was|=|:)/i,
  /response body/i
];
const DATA_PATTERNS = [/fixture.*missing/i, /test data/i, /no such (?:user|plan|record)/i];
const ENVIRONMENT_PATTERNS = [
  /\b(?:401|403)\b|unauthori[sz]ed|forbidden/i,
  /ECONN(?:RESET|REFUSED)|ENOTFOUND|network.*failed/i,
  /browser.*(?:missing|closed)|configuration error/i
];
const LOCATOR_RULES = [
  ['LOCATOR_STRICT_MODE_VIOLATION', /strict mode violation/i],
  ['LOCATOR_NOT_FOUND', /(?:locator|(?:getByRole|getByTestId|getByLabel|getByText)\().*(?:resolved to 0 elements|not found)/i],
  ['LOCATOR_DETACHED', /element (?:is not attached|was detached)/i]
];
const SYNC_RULES = [
  ['ACTIONABILITY_TIMEOUT', /(?:locator\.)?(?:click|fill|check|uncheck|hover|press):.*timeout/i],
  ['ACTIONABILITY_WAIT', /waiting for .* to be (?:visible|enabled|editable|stable)/i]
];

export function triageRuntimeFailure({ evidence = [], stage } = {}) {
  const normalized = evidence.map((item) => String(item ?? '').trim()).filter(Boolean);
  const joined = normalized.join('\n');
  const evidenceFingerprint = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  if (stage === 'runtime-environment') {
    return verdict('environment', false, ['GATE_ENVIRONMENT_FAILURE'], evidenceFingerprint);
  }
  if (PRODUCT_PATTERNS.some((pattern) => pattern.test(joined))) {
    return verdict('product-or-contract', false, ['ASSERTION_OR_RESPONSE_MISMATCH'], evidenceFingerprint);
  }
  if (ENVIRONMENT_PATTERNS.some((pattern) => pattern.test(joined))) {
    return verdict('environment', false, ['AUTH_NETWORK_OR_BROWSER_FAILURE'], evidenceFingerprint);
  }
  if (DATA_PATTERNS.some((pattern) => pattern.test(joined))) {
    return verdict('data', false, ['TEST_DATA_FAILURE'], evidenceFingerprint);
  }
  for (const [reason, pattern] of LOCATOR_RULES) {
    if (pattern.test(joined)) return verdict('locator-drift', true, [reason], evidenceFingerprint);
  }
  for (const [reason, pattern] of SYNC_RULES) {
    if (pattern.test(joined)) return verdict('synchronization', true, [reason], evidenceFingerprint);
  }
  return verdict('unclassified', false, ['UNCLASSIFIED_RUNTIME_FAILURE'], evidenceFingerprint);
}

function verdict(classification, repairable, reasonCodes, evidenceFingerprint) {
  return Object.freeze({
    schema: TEST_HEAL_TRIAGE_SCHEMA,
    classification,
    repairable,
    reasonCodes: Object.freeze([...reasonCodes]),
    evidenceFingerprint
  });
}
```

- [ ] **Step 4: Run the triage tests and verify GREEN**

Run: `node --test scripts/ai/__tests__/test-heal-triage.test.mjs`

Expected: all triage tests pass.

- [ ] **Step 5: Commit the triage unit**

```bash
git add packages/web/scripts/ai/lib/test-heal-triage.mjs packages/web/scripts/ai/__tests__/test-heal-triage.test.mjs
git commit -m "feat(web): classify repairable test failures"
```

---

### Task 2: Immutable semantic facts in the heal policy

**Files:**
- Modify: `packages/web/scripts/ai/lib/test-heal.mjs`
- Create: `packages/web/scripts/ai/__tests__/test-heal-policy.test.mjs`

**Interfaces:**
- Produces: `collectProtectedHealFacts(source) -> frozen plain object`.
- Changes: `verifyHealedSourcePolicy(...)` additionally returns `issueCodes` and rejects any protected-fact drift.
- Preserves: existing `{ passed, issues }` consumers continue to work.

- [ ] **Step 1: Write failing semantic-regression tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyHealedSourcePolicy } from '../lib/test-heal.mjs';

const SOURCE = `/* recording: recordings/save.json title:Save sha256:${'a'.repeat(64)} */
import { test, expect } from '../../fixtures/test';
const payload = { planName: 'Summer' };
test('RSTEP-001 saves', { tag: ['@save'] }, async ({ page }) => {
  await test.step('ASSERT-001 result', async () => {
    await page.getByLabel('Plan name').fill(payload.planName);
    await expect(page.getByTestId('status')).toHaveText('Saved');
  });
});`;

for (const [label, candidate, code] of [
  ['expected value', SOURCE.replace("'Saved'", "'Save failed'"), 'ASSERTION_ARGUMENT_CHANGED'],
  ['test title', SOURCE.replace('RSTEP-001 saves', 'unrelated test'), 'TEST_TITLE_CHANGED'],
  ['recording header', SOURCE.replace(/^\/\* recording:.*\*\/\n/, ''), 'TRACEABILITY_HEADER_CHANGED'],
  ['action payload', SOURCE.replace('fill(payload.planName)', "fill('Other')"), 'ACTION_PAYLOAD_CHANGED'],
  ['tag', SOURCE.replace("'@save'", "'@other'"), 'TEST_OPTIONS_CHANGED']
]) {
  test(`policy rejects changed ${label}`, () => {
    const result = verifyHealedSourcePolicy({ previousSource: SOURCE, healedSource: candidate });
    assert.equal(result.passed, false);
    assert.ok(result.issueCodes.includes(code));
  });
}
```

- [ ] **Step 2: Run the policy tests and verify RED**

Run: `node --test scripts/ai/__tests__/test-heal-policy.test.mjs`

Expected: the assertion-argument and recording-contract cases fail because the current guard returns `passed: true`.

- [ ] **Step 3: Implement protected-fact collection**

Add AST collectors that return stable arrays for:

```js
export function collectProtectedHealFacts(source) {
  const text = String(source ?? '');
  const sourceFile = ts.createSourceFile('heal-facts.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return Object.freeze({
    headers: collectTraceabilityHeaders(text),
    imports: collectImportTexts(sourceFile),
    declarations: collectNonLocatorDataDeclarations(sourceFile),
    testTitles: collectTestTitleFacts(sourceFile),
    testOptions: collectTestOptionFacts(sourceFile),
    fixtureBindings: collectFixtureBindingFacts(sourceFile),
    stepTitles: collectCallStringFacts(sourceFile, 'test.step'),
    annotations: collectAnnotationFacts(sourceFile),
    assertionArguments: collectAssertionArgumentFacts(sourceFile),
    actionPayloads: collectActionPayloadFacts(sourceFile),
    coverageTokens: collectCoverageTokens(sourceFile)
  });
}
```

Implementation rules:

- preserve both `/\* spec: ... \*/` and `/\* recording: ... \*/` exactly;
- use `node.getText(sourceFile)` for imports, non-function test options, callback fixture parameters, annotation pushes, matcher arguments, and action payload arguments;
- exclude locator-chain arguments from protected facts so `getByRole`/`getByTestId` changes remain possible;
- capture `const` object/array/primitive initializers unless their initializer contains a semantic locator or `.locator()` call;
- sort only unordered token multisets; preserve source order for declarations and calls.

Implement the named collectors in the same module with these exact responsibilities:

- `collectTraceabilityHeaders(text)` returns every exact spec/recording header match in source order;
- `collectImportTexts(sourceFile)` returns `ImportDeclaration.getText(sourceFile)` values;
- `collectNonLocatorDataDeclarations(sourceFile)` returns `const` declaration text only when the initializer subtree has no semantic locator call;
- `collectTestTitleFacts(sourceFile)` returns callee path plus literal title for each test/describe declaration;
- `collectTestOptionFacts(sourceFile)` returns every non-function option argument for test/describe declarations;
- `collectFixtureBindingFacts(sourceFile)` returns test callback parameter text in declaration order;
- `collectCallStringFacts(sourceFile, callPath)` returns static string arguments for matching calls;
- `collectAnnotationFacts(sourceFile)` returns exact `test.info().annotations.push(...)` argument text;
- `collectAssertionArgumentFacts(sourceFile)` returns matcher path, modifiers, and matcher argument text while excluding the locator receiver;
- `collectActionPayloadFacts(sourceFile)` returns arguments for `fill`, `type`, `press`, `pressSequentially`, `selectOption`, `setInputFiles`, `goto`, and request mutation methods;
- `collectCoverageTokens(sourceFile)` returns sorted `AC-###`, `NEG-###`, `RSTEP-###`, `ASSERT-###`, and `covered-ac-ids` token multisets from string literals.

Compare each fact family and add stable codes through one helper:

```js
function requireEqualFact(issues, issueCodes, code, label, before, after) {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  issueCodes.push(code);
  issues.push(`Healed source changes protected ${label}.`);
}
```

Use this exact family-to-code mapping: `headers -> TRACEABILITY_HEADER_CHANGED`, `imports -> IMPORTS_CHANGED`, `declarations -> TEST_DATA_CHANGED`, `testTitles -> TEST_TITLE_CHANGED`, `testOptions -> TEST_OPTIONS_CHANGED`, `fixtureBindings -> FIXTURE_BINDING_CHANGED`, `stepTitles -> STEP_TITLE_CHANGED`, `annotations -> ANNOTATION_CHANGED`, `assertionArguments -> ASSERTION_ARGUMENT_CHANGED`, `actionPayloads -> ACTION_PAYLOAD_CHANGED`, and `coverageTokens -> COVERAGE_TOKEN_CHANGED`.

Return `{ passed, issues, issueCodes }` from every branch, including empty and parse-error branches.

- [ ] **Step 4: Run policy tests and the original healer tests**

Run:

```bash
node --test scripts/ai/__tests__/test-heal-policy.test.mjs scripts/ai/__tests__/test-heal.test.mjs
```

Expected: both files pass; a clean locator replacement remains accepted.

- [ ] **Step 5: Commit semantic invariants**

```bash
git add packages/web/scripts/ai/lib/test-heal.mjs packages/web/scripts/ai/__tests__/test-heal-policy.test.mjs packages/web/scripts/ai/__tests__/test-heal.test.mjs
git commit -m "fix(web): preserve test semantics during healing"
```

---

### Task 3: Source-contract routing for spec, recording, and handwritten tests

**Files:**
- Create: `packages/web/scripts/ai/lib/test-heal-contract.mjs`
- Create: `packages/web/scripts/ai/__tests__/test-heal-contract.test.mjs`
- Modify: `packages/web/scripts/ai/heal-test.mjs`

**Interfaces:**
- Produces: `resolveHealContract({ testPath, source, explicitSpecPath, specDir, discoverSpec, webRoot })`.
- Produces: `reviewHealContract({ contract, candidatePath, generatedReviewer, recordedReviewer })`.
- Contract shape: `{ kind: 'spec' | 'recording' | 'handwritten', testPath, specPath?, validation?, recordingPath? }`.

- [ ] **Step 1: Write failing contract-routing tests**

```js
const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-contract-'));
fs.mkdirSync(path.join(webRoot, 'tests', 'regression'), { recursive: true });

test('recording header selects the recorded reviewer', () => {
  const contract = resolveHealContract({
    testPath: 'tests/recorded/save.spec.ts',
    source: `/* recording: recordings/save.json title:Save sha256:${'a'.repeat(64)} */`,
    webRoot,
    discoverSpec: () => null
  });
  assert.equal(contract.kind, 'recording');
  assert.equal(contract.recordingPath, 'recordings/save.json');

  const calls = [];
  const result = reviewHealContract({
    contract,
    candidatePath: 'tests/recorded/.save.candidate.spec.ts',
    recordedReviewer: (input) => (calls.push(input), { passed: true, issues: [] })
  });
  assert.equal(result.passed, true);
  assert.equal(calls.length, 1);
});

test('a regression test without spec header or allowlist entry fails closed', () => {
  assert.throws(() => resolveHealContract({
    testPath: 'tests/regression/unbound.spec.ts',
    source: 'import { test } from "@playwright/test";',
    webRoot,
    discoverSpec: () => null
  }), /no-header allowlist/i);
});
```

Also add an orchestration regression to `test-heal.test.mjs`: a recorded candidate must call a supplied `recordedReviewer`; removing its header must be rejected before runtime verification.

- [ ] **Step 2: Run the contract tests and verify RED**

Run: `node --test scripts/ai/__tests__/test-heal-contract.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement contract resolution**

```js
const RECORDING_HEADER = /\/\*\s*recording:\s+([^\s]+)\s+title:(.*?)\s+sha256:([a-f0-9]{64})\s*\*\//i;

export function resolveHealContract(options) {
  const recording = options.source.match(RECORDING_HEADER);
  const specBinding = resolveExplicitOrDiscoveredSpec(options);
  if (recording && specBinding) throw new Error('Heal target declares both recording and spec contracts.');
  if (recording) {
    assertPortableRepoPath(recording[1], 'Recording path');
    return Object.freeze({
      kind: 'recording',
      testPath: options.testPath,
      recordingPath: recording[1]
    });
  }
  if (specBinding) return Object.freeze({ kind: 'spec', testPath: options.testPath, ...specBinding });
  assertHandwrittenTargetAllowed(options.testPath, options.webRoot);
  return Object.freeze({ kind: 'handwritten', testPath: options.testPath });
}
```

`assertHandwrittenTargetAllowed` reads `tests/.no-header-allowlist`; spec-bound directories require an exact portable-path entry, while setup/helper layouts outside those directories remain handwritten.

Implement `resolveExplicitOrDiscoveredSpec(options)` by reusing the current explicit-spec validation and `discoverSpecForTest` result. Implement `assertPortableRepoPath(value, label)` by rejecting empty, absolute, option-prefixed, `..`-escaping, and non-portable normalized paths. Export neither helper.

`reviewHealContract` delegates to `reviewGeneratedTest` or `reviewRecordedTest`; both reviewers already normalize and verify the source hash, so their result is the scoped drift check. Handwritten contracts return a passing no-op review and rely on policy/typecheck/lint/runtime.

- [ ] **Step 4: Integrate routing into `healSingleTest`**

Replace the nullable `binding` branch with a required `contract`. Run the generated reviewer for `kind === 'spec'`, recorded reviewer for `kind === 'recording'`, and standalone execution for recording/handwritten targets. Keep spec execution through `executeGeneratedPair`.

- [ ] **Step 5: Run contract and orchestration tests**

Run:

```bash
node --test scripts/ai/__tests__/test-heal-contract.test.mjs scripts/ai/__tests__/test-heal.test.mjs
```

Expected: all tests pass, including the recorded-review regression.

- [ ] **Step 6: Commit source-contract routing**

```bash
git add packages/web/scripts/ai/lib/test-heal-contract.mjs packages/web/scripts/ai/__tests__/test-heal-contract.test.mjs packages/web/scripts/ai/heal-test.mjs packages/web/scripts/ai/__tests__/test-heal.test.mjs
git commit -m "fix(web): route healed tests through source contracts"
```

---

### Task 4: Bounded Page Object and DOM context

**Files:**
- Create: `packages/web/scripts/ai/lib/test-heal-context.mjs`
- Create: `packages/web/scripts/ai/__tests__/test-heal-context.test.mjs`
- Modify: `packages/web/scripts/ai/lib/test-heal.mjs`
- Modify: `packages/web/scripts/ai/heal-test.mjs`

**Interfaces:**
- Produces: `collectHealContext({ testPath, source, evidence, webRoot, domSnapshotPath })`.
- Extends: `buildTestHealPrompt(...)` with a `repositoryContext` object.
- Limits: four imported files, 32 KiB per file, 12,000 total context characters, 64 KiB DOM artifact.

- [ ] **Step 1: Write failing context tests**

Create a temporary workspace with:

```text
tests/regression/save.spec.ts
pages/SavePage.ts
.ai-runs/dom-discovery/run/selector-candidates.json
```

Assert that:

- a relative `../../pages/SavePage` import contributes its constructor and locator-bearing method text;
- unrelated `node_modules` and fixture sources are not included;
- a verified DOM artifact under `.ai-runs/dom-discovery` is redacted and included;
- an outside path, symlink, oversized file, or secret-bearing imported source throws;
- evidence containing a stack location under `pages/` sets `manualChangeRequired: true`.

- [ ] **Step 2: Run context tests and verify RED**

Run: `node --test scripts/ai/__tests__/test-heal-context.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement bounded context collection**

Use the TypeScript compiler API to resolve relative imports only. Accept resolved `.ts` files whose real paths remain under the workspace `pages/` or `components/` directory. Read through `readVerifiedFile`, reject secret-bearing source with `containsSecretLikeValue`, and extract:

```js
{
  importedSources: [{ path, sha256, excerpt }],
  domSnapshot: domSnapshotPath ? { path, sha256, content } : undefined,
  manualChangeRequired: evidenceLocations.some((value) => /^(?:pages|components)\//.test(value))
}
```

Derive `evidenceLocations` by matching sanitized stack locations with `/(?:^|\s)((?:pages|components)\/[^:\s]+\.ts):\d+:\d+/g`; normalize separators and deduplicate before computing `manualChangeRequired`.

Extend `extractRuntimeFailureEvidence` to append `error.stack` when present, after known-value and shape redaction and before the existing per-item character limit. This gives context collection source ownership without retaining raw reports.

Extract exported class constructors plus methods containing `getByRole`, `getByTestId`, `getByLabel`, `getByPlaceholder`, `getByText`, or `.locator(`. Truncate deterministically at method boundaries and enforce the aggregate character limit.

Read DOM evidence only through:

```js
readVerifiedFile({
  filePath: domSnapshotPath,
  rootPath: path.join(webRoot, '.ai-runs', 'dom-discovery'),
  maxBytes: 64 * 1024,
  captureBytes: 64 * 1024,
  label: 'Heal DOM snapshot'
});
```

Run `redactKnownSecretValues` and `redactSecretMaterial` before adding DOM text to provider context.

- [ ] **Step 4: Add context to the prompt and orchestration**

Extend `buildTestHealPrompt` and `healTestSource` with `repositoryContext = {}`. Add `--dom-snapshot` to parsing but do not add apply-mode flags yet. `healSingleTest` collects context once after triage and passes it to every attempt.

- [ ] **Step 5: Run context, prompt, and orchestration tests**

Run:

```bash
node --test scripts/ai/__tests__/test-heal-context.test.mjs scripts/ai/__tests__/test-heal.test.mjs
```

Expected: all tests pass; prompt JSON contains bounded context and no secret fixture values.

- [ ] **Step 6: Commit context collection**

```bash
git add packages/web/scripts/ai/lib/test-heal-context.mjs packages/web/scripts/ai/__tests__/test-heal-context.test.mjs packages/web/scripts/ai/lib/test-heal.mjs packages/web/scripts/ai/heal-test.mjs packages/web/scripts/ai/__tests__/test-heal.test.mjs
git commit -m "feat(web): add bounded evidence to test healing"
```

---

### Task 5: Proposal-first orchestration, clean-target protection, and audit records

**Files:**
- Modify: `packages/web/scripts/ai/heal-test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/test-heal.test.mjs`

**Interfaces:**
- Adds CLI flags: `--apply`, `--allow-dirty`, and `--dom-snapshot .ai-runs/dom-discovery/run/selector-candidates.json`.
- Extends `healSingleTest({ apply = false, allowDirty = false, domSnapshotPath, ... })`.
- Adds injectable orchestration hooks `resolveContract`, `reviewContract`, `lint`, and `targetDirty` so unit tests exercise behavior without Git, ESLint, or browser subprocesses.
- Adds terminal statuses: `not-repairable`, `proposal-ready`, `manual-change-required`, `dirty-target`.

- [ ] **Step 1: Write failing orchestration tests**

Add separate tests proving:

```js
const { webRoot, target, targetPath } = makeHealWorkspace();
const healedSource = CLEAN_SOURCE.replace(
  "getByRole('button', { name: 'Save' })",
  "getByTestId('save-button')"
);
const baseOptions = {
  testPath: target,
  env: { AI_AUTOHEAL_ENABLED: 'true' },
  webRoot,
  log: () => {},
  resolveContract: () => ({ kind: 'handwritten', testPath: target }),
  reviewContract: () => ({ passed: true, issues: [] }),
  typecheck: PASSING_TYPECHECK,
  lint: () => ({ passed: true, issues: [] }),
  targetDirty: () => false
};

test('non-repairable failures never invoke the provider', async () => {
  let calls = 0;
  const { run } = executionSequence([FAILED_EXECUTION]);
  const result = await healSingleTest({
    ...baseOptions,
    executeStandalone: run,
    collectEvidence: () => ['Expected string: "Saved" Received string: "Save failed"'],
    heal: async () => (calls += 1, { code: CLEAN_SOURCE })
  });
  assert.equal(result.status, 'not-repairable');
  assert.equal(calls, 0);
});

test('verified healing is proposal-only by default', async () => {
  const { run } = executionSequence([FAILED_EXECUTION, PASSED_EXECUTION]);
  const result = await healSingleTest({
    ...baseOptions,
    apply: false,
    executeStandalone: run,
    collectEvidence: () => ['locator.click: Timeout 30000ms exceeded while waiting for getByRole("button")'],
    heal: async () => ({ code: healedSource, result: { brain: { kind: 'openai', model: 'model-x' } } })
  });
  assert.equal(result.status, 'proposal-ready');
  assert.equal(fs.readFileSync(targetPath, 'utf8'), CLEAN_SOURCE);
  assert.equal(fs.existsSync(path.join(result.archiveDir, 'candidate.diff')), true);
});

test('--apply rejects a dirty target without --allow-dirty', async () => {
  const result = await healSingleTest({
    ...baseOptions,
    apply: true,
    allowDirty: false,
    targetDirty: () => true
  });
  assert.equal(result.status, 'dirty-target');
});
```

Also assert `parseArgs(['--allow-dirty', '--test', 'x'])` throws because `--allow-dirty` requires `--apply`.

- [ ] **Step 2: Run orchestration tests and verify RED**

Run: `node --test scripts/ai/__tests__/test-heal.test.mjs`

Expected: failures for missing proposal, triage, dirty-target, and CLI behavior.

- [ ] **Step 3: Integrate triage before provider invocation**

After baseline evidence extraction:

```js
const triage = triageRuntimeFailure({ evidence, stage: execution.stage });
archive.write('evidence.json', `${JSON.stringify({ schema: 'test-heal-evidence/v1', evidence, triage }, null, 2)}\n`);
if (!triage.repairable) {
  return finish({ status: 'not-repairable', attemptsUsed: 0, issues: triage.reasonCodes, triage });
}
```

Do not substitute fake evidence when none is available; empty evidence must classify as `unclassified`.

- [ ] **Step 4: Add clean-target and full snapshot checks**

Capture `{ dev, ino, size, mtimeMs, ctimeMs, sha256 }` at start. Implement:

```js
export function gitTargetDirty(target, webRoot = process.cwd()) {
  const result = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all', '--', target], {
    cwd: webRoot,
    encoding: 'utf8',
    shell: false
  });
  if (result.status !== 0) throw new Error('Could not determine heal target Git status.');
  return result.stdout.trim().length > 0;
}
```

Check dirty state before provider work when `apply === true`. Re-capture the complete target snapshot before promotion; any changed field aborts with `aborted-concurrent-edit`.

- [ ] **Step 5: Implement private proposal/audit output**

Use `ensureVerifiedDirectory` for `.ai-runs/heal/{run-id}`. Write files with `0600`. Produce a bounded unified diff using:

```js
spawnSync('git', [
  'diff', '--no-index', '--no-ext-diff', '--unified=3', '--',
  archiveOriginalPath, candidateAbsolute
], { cwd: webRoot, encoding: 'utf8', maxBuffer: 1024 * 1024, shell: false });
```

Exit status `1` means a valid diff; `0` means no change; all other statuses reject the attempt. Store provider kind/model and usage only from structured `healed.result` fields. Never store prompt text or raw browser artifacts.

If verification passes:

- return `manual-change-required` when context says the owner is under `pages/` or `components/`;
- return `proposal-ready` and remove the live candidate when `apply === false`;
- atomically rename only when `apply === true` and every snapshot remains unchanged.

- [ ] **Step 6: Update CLI success handling and help**

Treat `already-green`, `proposal-ready`, and `healed` as zero-exit statuses. Print the proposal diff/archive path without claiming the target was modified.

- [ ] **Step 7: Run orchestration tests and verify GREEN**

Run: `node --test scripts/ai/__tests__/test-heal.test.mjs`

Expected: all orchestration tests pass and temporary target files remain unchanged in proposal mode.

- [ ] **Step 8: Commit proposal-first orchestration**

```bash
git add packages/web/scripts/ai/heal-test.mjs packages/web/scripts/ai/__tests__/test-heal.test.mjs
git commit -m "feat(web): make test healing proposal first"
```

---

### Task 6: Full candidate checks and serial verification

**Files:**
- Modify: `packages/web/scripts/ai/heal-test.mjs`
- Modify: `packages/web/scripts/ai/generated-test-gate.mjs`
- Modify: `packages/web/scripts/ai/lib/generated-gate-runner.mjs`
- Modify: `packages/web/scripts/ai/__tests__/test-heal.test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/generated-test-gate-hardening.test.mjs`

**Interfaces:**
- Adds optional `workers` to `buildPlaywrightStage(...)` and `executeGeneratedPair(...)` options.
- Adds `lintCandidate({ candidatePath, webRoot, env, commandRunner })`.
- Requires semantic policy → typecheck → ESLint → source reviewer/drift → serial runtime verification, in that order.

- [ ] **Step 1: Write failing gate tests**

Add tests asserting:

```js
const stage = buildPlaywrightStage({
  packageManager: 'npm',
  testPath: 'tests/regression/x.spec.ts',
  project: 'chromium',
  jsonReportPath: '.ai-runs/x.json',
  repeatEach: 2,
  workers: 1
});
assert.ok(stage.args.includes('--workers=1'));
```

Add healer tests where `lintCandidate` returns `{ passed: false, issues: ['eslint failed'] }`; assert no reviewer/runtime call occurs and the attempt is recorded as `lint-rejected`.

- [ ] **Step 2: Run gate tests and verify RED**

Run:

```bash
node --test scripts/ai/__tests__/generated-test-gate-hardening.test.mjs scripts/ai/__tests__/test-heal.test.mjs
```

Expected: missing `--workers=1` and lint-stage assertions fail.

- [ ] **Step 3: Add the worker option to shared gate construction**

Validate `workers` as a positive safe integer when supplied and append its concrete numeric value to the Playwright arguments. Pass `options.workers` through `executeGeneratedPair`. The healer always calls spec execution with `{ workers: 1 }`; standalone execution keeps its existing explicit `--workers=1`.

- [ ] **Step 4: Implement ESLint candidate checking**

Build an ESLint stage using the detected package manager:

```js
const [command, args] = packageManager === 'pnpm'
  ? ['pnpm', ['exec', 'eslint', candidatePath, '--max-warnings=0']]
  : packageManager === 'yarn'
    ? ['yarn', ['eslint', candidatePath, '--max-warnings=0']]
    : ['npx', ['eslint', candidatePath, '--max-warnings=0']];
```

Run it with `buildGateEnvironment(env, { profile: 'static' })`. A nonzero or abnormal exit returns a bounded generic issue and prevents review/execution.

- [ ] **Step 5: Enforce the complete candidate order**

Within every attempt run:

1. `verifyHealedSourcePolicy`;
2. `typecheckCandidate`;
3. `lintCandidate`;
4. `reviewHealContract`;
5. runtime verification with `workers=1`, `retries=0`, and `repeatEach`.

Feed only bounded sanitized issues into the next provider attempt.

- [ ] **Step 6: Run focused gate tests and verify GREEN**

Run:

```bash
node --test scripts/ai/__tests__/generated-test-gate-hardening.test.mjs scripts/ai/__tests__/test-heal.test.mjs scripts/ai/__tests__/test-heal-contract.test.mjs
```

Expected: all tests pass.

- [ ] **Step 7: Commit complete candidate checks**

```bash
git add packages/web/scripts/ai/heal-test.mjs packages/web/scripts/ai/generated-test-gate.mjs packages/web/scripts/ai/lib/generated-gate-runner.mjs packages/web/scripts/ai/__tests__/test-heal.test.mjs packages/web/scripts/ai/__tests__/generated-test-gate-hardening.test.mjs
git commit -m "fix(web): fully gate healed candidates"
```

---

### Task 7: Documentation and configuration contract

**Files:**
- Modify: `packages/web/ai/prompts/04-heal-locator.md`
- Modify: `packages/web/docs/ai-testing/ARCHITECTURE.md`
- Modify: `packages/web/docs/ai-testing/TROUBLESHOOTING.md`
- Modify: `packages/web/.env.example`
- Modify: `packages/web/AGENTS.md`

**Interfaces:**
- Documents the exact CLI and status behavior implemented in Tasks 1–6.

- [ ] **Step 1: Add a failing documentation contract test**

Add assertions to `test-heal.test.mjs` against exported `helpText()` so help must contain:

```js
for (const required of [
  '--apply', '--allow-dirty', '--dom-snapshot', 'proposal-ready',
  'locator-drift', 'synchronization', 'recorded reviewer'
]) assert.match(helpText(), new RegExp(required.replaceAll('-', '\\-'), 'i'));
```

Run `node --test scripts/ai/__tests__/test-heal.test.mjs` and confirm RED because help text is not exported and lacks the new contract.

- [ ] **Step 2: Export and update CLI help**

Rename `printHelp` content construction to `export function helpText()` and keep `printHelp()` as `console.log(helpText())`.

- [ ] **Step 3: Update operator documentation**

Document these exact examples:

```bash
# Safe default: verified proposal, target unchanged
AI_AUTOHEAL_ENABLED=true npm run ai:test:heal -- --test tests/recorded/checkout-confirmation.spec.ts

# Explicit promotion of a clean target
AI_AUTOHEAL_ENABLED=true npm run ai:test:heal -- --test tests/recorded/checkout-confirmation.spec.ts --apply

# Explicitly accept an already-dirty starting target
AI_AUTOHEAL_ENABLED=true npm run ai:test:heal -- --test tests/recorded/checkout-confirmation.spec.ts --apply --allow-dirty
```

State that intentional functionality changes must update the Markdown spec/version/AC/data cases first; product, auth, network, data, assertion-mismatch, and unclassified failures are not repairable.

Add `AI_AUTOHEAL_DOM_CONTEXT_MAX_BYTES=65536` to `.env.example` only if Task 4 implements it as a configurable bounded integer; otherwise document the fixed 64 KiB limit and add no unused variable.

- [ ] **Step 4: Run documentation contract and diff checks**

Run:

```bash
node --test scripts/ai/__tests__/test-heal.test.mjs
git diff --check
```

Expected: tests pass and no whitespace errors.

- [ ] **Step 5: Commit documentation**

```bash
git add packages/web/ai/prompts/04-heal-locator.md packages/web/docs/ai-testing/ARCHITECTURE.md packages/web/docs/ai-testing/TROUBLESHOOTING.md packages/web/.env.example packages/web/AGENTS.md packages/web/scripts/ai/heal-test.mjs packages/web/scripts/ai/__tests__/test-heal.test.mjs
git commit -m "docs(web): document safe test healing"
```

---

### Task 8: Full verification and focused review

**Files:**
- Modify only files required to fix failures introduced by Tasks 1–7.

**Interfaces:**
- Produces fresh verification evidence; does not broaden feature scope.

- [ ] **Step 1: Run all healer tests**

```bash
cd packages/web
node --test \
  scripts/ai/__tests__/test-heal-triage.test.mjs \
  scripts/ai/__tests__/test-heal-policy.test.mjs \
  scripts/ai/__tests__/test-heal-contract.test.mjs \
  scripts/ai/__tests__/test-heal-context.test.mjs \
  scripts/ai/__tests__/test-heal.test.mjs
```

Expected: zero failed, skipped, cancelled, or todo tests.

- [ ] **Step 2: Run the complete AI self-test suite**

```bash
npm run ai:test:self
```

Expected: exit 0 with zero failed tests.

- [ ] **Step 3: Run static verification**

```bash
npm run typecheck
npm run lint
npm run ai:spec:drift
npm run ai:recording:drift
```

Expected: every command exits 0.

- [ ] **Step 4: Run deterministic local browser gates**

```bash
npm run test:e2e:local
npm run ai:test:gate:local-generated
npm run ai:recording:gate:all
```

Expected: every command exits 0 with no skipped or flaky outcomes. Do not run authenticated external regression unless its required environment is explicitly configured.

- [ ] **Step 5: Inspect final diff and repository state**

```bash
git diff --check
git status --short
git diff -- packages/web/scripts/ai packages/web/ai/prompts/04-heal-locator.md packages/web/docs/ai-testing packages/web/.env.example packages/web/AGENTS.md
```

Confirm only planned files changed and unrelated pre-existing user changes remain untouched.

- [ ] **Step 6: Request focused code review**

Use `superpowers:requesting-code-review` against the approved design and this plan. Resolve every correctness or safety finding through a new RED/GREEN cycle.

- [ ] **Step 7: Re-run affected verification after review fixes**

Repeat the exact focused tests, `ai:test:self`, typecheck, lint, drift, and local browser gates affected by review changes. Report actual command output, not inferred status.

- [ ] **Step 8: Commit any review fixes**

Stage only review-fix files that are present in the final `git diff --name-only`; do not stage unrelated pre-existing changes. If review produced no file changes, skip this commit. Otherwise use the same exact path list already committed by Tasks 1–7 and create:

```bash
git commit -m "fix(web): address safe healing review"
```
