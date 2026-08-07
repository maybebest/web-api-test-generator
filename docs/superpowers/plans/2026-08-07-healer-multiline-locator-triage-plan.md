# Healer Multiline Locator Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make real multiline Playwright locator-not-found failures repairable without weakening non-repairable product/environment gates, then use the healer repeatedly until both PsychicBook dev tests are applied and independently stable.

**Architecture:** Keep triage as a small ordered rule set. Environment and data evidence remain fail-closed, a bounded multiline locator rule runs before broad assertion-value matching, and all other healer gates remain unchanged. Live work uses an ignored fixed-target launcher and branches only on sanitized healer status/reason data.

**Tech Stack:** Node.js 22, JavaScript ES modules, Node test runner, TypeScript, Playwright Test 1.59.1, existing single-file healer.

## Global Constraints

- Keep genuine product, response, assertion-value, authentication, network, browser, test-data, and environment failures non-repairable.
- Preserve `test-heal-triage/v1`, existing reason codes, and public healer statuses.
- Recognize only bounded concrete locator-not-found evidence; a bare `Expected:` line must never become repairable.
- Do not weaken typecheck, ESLint, generated-test review, healer policy reporting, runtime, integrity, dirty-target, concurrent-edit, or atomic-apply gates.
- Do not edit canonical `packages/web/tests/**` or `packages/web/pages/PsychicBookLoginPage.ts`.
- Do not manually edit either PsychicBook dev locator; only healer `--apply` may modify the two copied targets.
- Run live work only against `https://user.dev.psychicbook.net/`, one worker, zero retries, maximum three healer attempts, and three candidate verification runs.
- Read private values from the original checkout `.env` files without printing, copying, archiving, or committing them.
- Do not add a general Playwright error parser, multi-file healing, automatic shared Page Object edits, unlimited retries, or policy bypasses.
- If a later live run exposes a different deterministic framework defect, keep targets unchanged, record sanitized evidence, and start the next root-cause/design/TDD cycle rather than guessing.

---

### Task 1: Classify multiline Playwright locator-not-found evidence safely

**Files:**
- Modify: `packages/web/scripts/ai/lib/test-heal-triage.mjs`
- Modify: `packages/web/scripts/ai/__tests__/test-heal-triage.test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/test-heal.test.mjs`

**Interfaces:**
- Consumes: `triageRuntimeFailure({ evidence: string[], stage: string })` and `healSingleTest()`.
- Produces: the unchanged triage verdict shape with `classification: 'locator-drift'`, `repairable: true`, and `reasonCodes: ['LOCATOR_NOT_FOUND']` for the real multiline missing-locator form.

- [ ] **Step 1: Add the failing unit regression**

Append to `test-heal-triage.test.mjs`:

~~~js
test('triage permits a multiline Playwright visibility locator-not-found failure', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-test',
    evidence: [
      `expect(locator).toBeVisible() failed

Locator: getByRole('banner').getByRole('button', { name: 'T', exact: true })
Expected: visible
Error: element(s) not found`
    ]
  });
  assert.equal(verdict.classification, 'locator-drift');
  assert.equal(verdict.repairable, true);
  assert.deepEqual(verdict.reasonCodes, ['LOCATOR_NOT_FOUND']);
});

test('triage keeps assertion-value mismatches non-repairable', () => {
  const verdict = triageRuntimeFailure({
    stage: 'runtime-test',
    evidence: ['Expected string: "Saved"', 'Received string: "Save failed"']
  });
  assert.equal(verdict.classification, 'product-or-contract');
  assert.equal(verdict.repairable, false);
  assert.deepEqual(verdict.reasonCodes, ['ASSERTION_OR_RESPONSE_MISMATCH']);
});
~~~

- [ ] **Step 2: Add the failing healer-level regression**

Append near the existing non-repairable/provider tests in `test-heal.test.mjs`:

~~~js
test('multiline visibility locator-not-found evidence reaches the provider', async () => {
  const { webRoot, target } = makeHealWorkspace();
  const healedSource = CLEAN_SOURCE.replace(
    "getByRole('button', { name: 'Save' })",
    "getByTestId('save-button')"
  );
  const { run } = executionSequence([FAILED_EXECUTION, PASSED_EXECUTION]);
  let providerCalls = 0;
  const result = await healSingleTest({
    testPath: target,
    env: { AI_AUTOHEAL_ENABLED: 'true' },
    webRoot,
    apply: false,
    log: () => {},
    resolveContract: () => ({ kind: 'handwritten', testPath: target }),
    reviewContract: () => ({ passed: true, issues: [] }),
    typecheck: PASSING_TYPECHECK,
    lint: PASSING_LINT,
    targetDirty: () => false,
    executeStandalone: run,
    collectEvidence: () => [
      `expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: 'Save' })
Expected: visible
Error: element(s) not found`
    ],
    heal: async () => {
      providerCalls += 1;
      return { code: healedSource };
    }
  });
  assert.equal(result.status, 'proposal-ready');
  assert.equal(result.triage.classification, 'locator-drift');
  assert.equal(providerCalls, 1);
});
~~~

- [ ] **Step 3: Run the new tests and confirm the exact red state**

~~~bash
cd packages/web
node --test \
  --test-name-pattern='multiline Playwright visibility locator-not-found|assertion-value mismatches|multiline visibility locator-not-found evidence' \
  scripts/ai/__tests__/test-heal-triage.test.mjs \
  scripts/ai/__tests__/test-heal.test.mjs
~~~

Expected: the assertion-value test passes; both multiline tests fail because the verdict is `product-or-contract`, `repairable: false`, and providerCalls is zero.

- [ ] **Step 4: Implement the bounded rule and safe ordering**

Replace `LOCATOR_RULES` with:

~~~js
const LOCATOR_RULES = [
  ['LOCATOR_STRICT_MODE_VIOLATION', /strict mode violation/i],
  [
    'LOCATOR_NOT_FOUND',
    /(?:\bLocator:\s*[^\r\n]+[\s\S]{0,1600}?\bError:\s*element\(s\) not found\b|(?:locator|(?:getByRole|getByTestId|getByLabel|getByText)\()[\s\S]{0,1600}?(?:resolved to 0 elements|not found))/i
  ],
  ['LOCATOR_DETACHED', /element (?:is not attached|was detached)/i]
];
~~~

Use this exact decision order inside `triageRuntimeFailure()` after the existing `runtime-environment` branch:

~~~js
  if (ENVIRONMENT_PATTERNS.some((pattern) => pattern.test(joined))) {
    return verdict('environment', false, ['AUTH_NETWORK_OR_BROWSER_FAILURE'], evidenceFingerprint);
  }
  if (DATA_PATTERNS.some((pattern) => pattern.test(joined))) {
    return verdict('data', false, ['TEST_DATA_FAILURE'], evidenceFingerprint);
  }
  for (const [reason, pattern] of LOCATOR_RULES) {
    if (pattern.test(joined)) return verdict('locator-drift', true, [reason], evidenceFingerprint);
  }
  if (PRODUCT_PATTERNS.some((pattern) => pattern.test(joined))) {
    return verdict('product-or-contract', false, ['ASSERTION_OR_RESPONSE_MISMATCH'], evidenceFingerprint);
  }
  for (const [reason, pattern] of SYNC_RULES) {
    if (pattern.test(joined)) return verdict('synchronization', true, [reason], evidenceFingerprint);
  }
~~~

- [ ] **Step 5: Run focused green verification**

~~~bash
node --test \
  scripts/ai/__tests__/test-heal-triage.test.mjs \
  scripts/ai/__tests__/test-heal-contract.test.mjs \
  scripts/ai/__tests__/test-heal-policy.test.mjs \
  scripts/ai/__tests__/test-heal-context.test.mjs \
  scripts/ai/__tests__/test-heal.test.mjs
~~~

Expected: all tests pass with no warnings; existing product/auth/network/data/environment and synchronization cases remain green.

- [ ] **Step 6: Commit the isolated triage fix**

~~~bash
git add \
  packages/web/scripts/ai/lib/test-heal-triage.mjs \
  packages/web/scripts/ai/__tests__/test-heal-triage.test.mjs \
  packages/web/scripts/ai/__tests__/test-heal.test.mjs
git commit -m "fix(web): classify multiline locator drift"
~~~

---

### Task 2: Run the real healer loop on both PsychicBook dev targets

**Files:**
- Create ignored runtime helper: `packages/web/.ai-runs/heal-experiment/psychicbook-live-launcher.cjs`
- Modify through healer apply only: `packages/web/tests-dev/regression/psychicbook-account-menu.spec.ts`
- Modify through healer apply only: `packages/web/tests-dev/regression/psychicbook-healing-experiment.spec.ts`
- Preserve: `packages/web/tests/**`
- Preserve: `packages/web/pages/PsychicBookLoginPage.ts`

**Interfaces:**
- Consumes: the Task 1 triage verdict, private original-checkout env files, healer CLI, and exact two-root routing.
- Produces: two healer-applied dev specs whose summaries record `verifyRuns: 3`, followed by independent `repeat-each=3` passes.

- [ ] **Step 1: Create the fixed-target ignored launcher**

Use `apply_patch` to create `packages/web/.ai-runs/heal-experiment/psychicbook-live-launcher.cjs` with this complete content:

~~~js
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');

const allowedTargets = new Set([
  'tests-dev/regression/psychicbook-account-menu.spec.ts',
  'tests-dev/regression/psychicbook-healing-experiment.spec.ts'
]);

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const target = option('--target');
const mode = option('--mode');
const repeatEach = option('--repeat-each', '1');
if (!allowedTargets.has(target) || !new Set(['baseline', 'heal']).has(mode)) process.exit(64);
if (!new Set(['1', '3']).has(repeatEach)) process.exit(64);

const checkoutRoot = '/Users/maybebest/Documents/web-api-test-generator';
const webRoot = path.resolve(__dirname, '../..');
const rootValues = dotenv.parse(fs.readFileSync(path.join(checkoutRoot, '.env')));
const webValues = dotenv.parse(fs.readFileSync(path.join(checkoutRoot, 'packages/web/.env')));
const env = {
  ...webValues,
  ...process.env,
  PLAYWRIGHT_TEST_BASE_URL: 'https://user.dev.psychicbook.net/',
  PLAYWRIGHT_TEST_SUITE_ROOT: 'tests-dev',
  E2E_AUTH_ENABLED: 'true',
  E2E_AUTH_REUSE_STATE: 'false',
  E2E_USER_EMAIL: rootValues.ADMIN_EMAIL,
  E2E_HTTP_BASIC_USERNAME: rootValues.WEB_BASIC_AUTH_USER,
  E2E_HTTP_BASIC_PASSWORD: rootValues.WEB_BASIC_AUTH_PASSWORD,
  AI_AUTOHEAL_ENABLED: 'true',
  ALLURE_ENABLED: 'false'
};

let args;
if (mode === 'baseline') {
  const requireFromWeb = createRequire(path.join(webRoot, 'package.json'));
  args = [
    requireFromWeb.resolve('@playwright/test/cli'),
    'test', target,
    '--project=chromium',
    '--workers=1',
    '--retries=0',
    '--repeat-each=' + repeatEach
  ];
} else {
  args = [
    'scripts/ai/heal-test.mjs',
    '--test', target,
    '--max-attempts', '3',
    '--verify-runs', '3',
    '--apply'
  ];
}

const result = spawnSync(process.execPath, args, {
  cwd: webRoot,
  env,
  stdio: 'inherit',
  timeout: mode === 'heal' ? 900_000 : 240_000
});
if (result.error?.code === 'ETIMEDOUT') process.exit(124);
process.exit(result.status ?? 1);
~~~

Expected: the helper contains no secret values and rejects every target/mode/repeat value outside the fixed allowlists.

- [ ] **Step 2: Apply healer to account-menu**

~~~bash
node packages/web/.ai-runs/heal-experiment/psychicbook-live-launcher.cjs \
  --target tests-dev/regression/psychicbook-account-menu.spec.ts \
  --mode heal \
  --repeat-each 1
~~~

Expected successful path: healer invokes a provider, candidate policy/static checks pass or report only warning-soft policy findings, three candidate runs pass, and apply replaces only the dev target.

- [ ] **Step 3: Apply healer to healing-experiment**

~~~bash
node packages/web/.ai-runs/heal-experiment/psychicbook-live-launcher.cjs \
  --target tests-dev/regression/psychicbook-healing-experiment.spec.ts \
  --mode heal \
  --repeat-each 1
~~~

Expected successful path: the second dev target is atomically replaced only after three candidate runs pass.

- [ ] **Step 4: Inspect sanitized outcomes and enforce the outer-loop decision table**

Print only these summary fields from the two newest `heal-summary.json` files: `target`, `status`, `attemptsUsed`, `verifyRuns`, `triage.classification`, `triage.repairable`, `triage.reasonCodes`, `attemptTrail[].attempt`, `attemptTrail[].outcome`, `attemptTrail[].checks`, and `attemptTrail[].policyIssueCodes`.

Use these exact decisions:

- `healed` or applied warning-soft result with `verifyRuns: 3`: continue;
- `environment-failure`: prove the external/sandbox cause, keep the target unchanged, and rerun the same command once after correcting only the environment;
- `not-repairable`, `manual-change-required`, `brain-error`, exhausted attempts, or a hard static/runtime/integrity failure: keep the target unchanged, append the sanitized evidence to the report, return `BLOCKED` for this task, and start the next root-cause/design/TDD cycle before another live attempt;
- never edit a locator manually and never convert a hard gate into a warning to make the run green.

- [ ] **Step 5: Prove canonical isolation and inspect exact dev diffs**

~~~bash
git diff --exit-code -- packages/web/tests packages/web/pages/PsychicBookLoginPage.ts
git diff -- packages/web/tests-dev/regression/psychicbook-account-menu.spec.ts
git diff -- packages/web/tests-dev/regression/psychicbook-healing-experiment.spec.ts
~~~

Expected: canonical command exits zero; only locator/synchronization code in the two dev targets differs from their committed pre-heal state.

- [ ] **Step 6: Independently repeat each healed target three times**

~~~bash
node packages/web/.ai-runs/heal-experiment/psychicbook-live-launcher.cjs \
  --target tests-dev/regression/psychicbook-account-menu.spec.ts \
  --mode baseline \
  --repeat-each 3

node packages/web/.ai-runs/heal-experiment/psychicbook-live-launcher.cjs \
  --target tests-dev/regression/psychicbook-healing-experiment.spec.ts \
  --mode baseline \
  --repeat-each 3
~~~

Expected: 3/3 pass for each target with zero failures, retries, flaky results, or skips.

- [ ] **Step 7: Re-run generated-test reviewers**

~~~bash
cd packages/web
PLAYWRIGHT_TEST_SUITE_ROOT=tests-dev node scripts/ai/review-generated-test.mjs \
  --spec specs/psychicbook-account-menu.md \
  --test tests-dev/regression/psychicbook-account-menu.spec.ts
PLAYWRIGHT_TEST_SUITE_ROOT=tests-dev node scripts/ai/review-generated-test.mjs \
  --spec specs/psychicbook-healing-experiment.md \
  --test tests-dev/regression/psychicbook-healing-experiment.spec.ts
~~~

Expected: both reviews pass; documented non-blocking coverage warnings may remain warnings.

- [ ] **Step 8: Commit only healer-applied targets**

~~~bash
git add \
  packages/web/tests-dev/regression/psychicbook-account-menu.spec.ts \
  packages/web/tests-dev/regression/psychicbook-healing-experiment.spec.ts
git commit -m "test(web): heal PsychicBook dev locators"
~~~

---

### Task 3: Run full regression, security, and isolation verification

**Files:**
- Verify all files changed by Tasks 1-2.
- Do not add `.ai-runs`, `test-results`, reports, screenshots, videos, traces, auth state, or private env files to Git.

**Interfaces:**
- Consumes: the triage fix and two independently stable healer-applied targets.
- Produces: final evidence that canonical/default behavior, framework tests, security scans, and dev execution are green.

- [ ] **Step 1: Run focused and static checks**

~~~bash
npm run -w packages/web typecheck
npm run -w packages/web lint
node --test \
  packages/web/scripts/ai/__tests__/test-suite-root.test.mjs \
  packages/web/scripts/ai/__tests__/test-heal-triage.test.mjs \
  packages/web/scripts/ai/__tests__/test-heal-contract.test.mjs \
  packages/web/scripts/ai/__tests__/test-heal-policy.test.mjs \
  packages/web/scripts/ai/__tests__/test-heal-context.test.mjs \
  packages/web/scripts/ai/__tests__/test-heal.test.mjs
~~~

- [ ] **Step 2: Run complete web framework checks**

~~~bash
npm run -w packages/web ai:test:self
npm run -w packages/web ai:spec:validate
npm run -w packages/web ai:spec:drift
npm run -w packages/web ai:eval
~~~

Expected: self-tests and golden evaluation pass; all current specs validate; canonical drift remains green.

- [ ] **Step 3: Prove default local execution ignores tests-dev**

~~~bash
npm run -w packages/web test:e2e:local
~~~

Expected: only canonical `packages/web/tests` local specs execute once; no `tests-dev` path is collected.

- [ ] **Step 4: Run repository and security checks**

~~~bash
npm test
npm run api:secrets
npm audit --audit-level=high
gitleaks detect --source . --config .gitleaks.toml --redact --verbose --exit-code 1
git diff --check
git status --short
~~~

Expected: all tests pass, the API backstop and repo-wide gitleaks scan are clean, npm reports zero high vulnerabilities, runtime artifacts remain ignored, and the worktree contains no unintended changes. If `gitleaks` is unavailable, report this step blocked and do not claim completion until the pinned scanner is made available and the same command passes.

- [ ] **Step 5: Verify canonical isolation and branch history**

~~~bash
git diff --exit-code fed1426 -- packages/web/tests packages/web/pages/PsychicBookLoginPage.ts
git log --oneline --decorate -10
~~~

Expected: canonical tests and shared PsychicBook Page Object are byte-for-byte unchanged since the mirror commit; history shows separate triage and healed-target commits.

- [ ] **Step 6: Commit only deterministic corrections from final verification**

If final verification required a deterministic correction, stage only its exact files, rerun the focused covering checks, and commit:

~~~bash
git commit -m "test(web): complete PsychicBook healer verification"
~~~

If no correction was required, create no empty commit.
