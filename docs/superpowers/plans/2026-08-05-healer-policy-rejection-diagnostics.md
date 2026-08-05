# Healer Policy-Warning Soft-Fail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn healer policy rejection into an audited warning in proposal-only and apply modes, while preserving safe reason codes, every remaining verification gate, atomic apply, and the user-required warning exit semantics.

**Architecture:** `test-heal.mjs` owns a closed registry of stable warning codes and a normalizer. `heal-test.mjs` evaluates policy on every candidate but records failures as warnings and continues through typecheck, lint, contract review, runtime verification, integrity, and diff gates. Clean and warning-bearing proposal/apply paths have distinct statuses; warning-bearing apply promotes the verified file and then returns a non-clean status so the CLI exits `1`.

**Tech Stack:** Node.js ESM, `node:test`, TypeScript AST analysis, JSON audit archives, ESLint, TypeScript project checks.

## Global Constraints

- Follow `docs/superpowers/specs/2026-08-05-healer-policy-rejection-diagnostics-design.md` at commit `58d6a17` or later.
- Execute in an isolated Git worktree created with `superpowers:using-git-worktrees`; the current checkout has unrelated dirty work.
- Use TDD for each behavior: write the focused assertion, observe the intended RED, implement the minimum production change, then observe GREEN.
- Policy evaluation remains mandatory, but `passed: false` must never be the sole reason a candidate stops.
- Candidate secret preflight, safe file binding, typecheck, lint, contract review, consecutive live verification, integrity, diff, dirty-target, concurrency, backup, and atomic rename safeguards remain hard gates.
- Do not persist or print raw `policy.issues`, provider text, source excerpts, runtime evidence, URLs, credentials, emails, DOM content, or request payloads as warning diagnostics.
- Only locally allowlisted stable codes may cross public/audit/CLI boundaries.
- Proposal-only warning result: `proposal-ready-with-policy-warnings`, target unchanged, CLI exit `0`.
- Apply warning result: `healed-with-policy-warnings`, target replaced atomically after all hard gates, CLI exit `1`.
- Clean `proposal-ready` and `healed` behavior remains unchanged.
- Do not change PsychicBook specs/tests or require live stage credentials for this framework-level change.

---

### Task 1: Give every policy issue a stable allowlisted warning code

**Files:**
- Modify: `packages/web/scripts/ai/lib/test-heal.mjs:12-24,1063-1200`
- Test: `packages/web/scripts/ai/__tests__/test-heal-policy.test.mjs:1-430`

**Interfaces:**
- Consumes: existing `verifyHealedSourcePolicy({ previousSource, healedSource })` returning `{ passed, issues, issueCodes }`.
- Produces: `HEAL_POLICY_ISSUE_CODES: readonly string[]`; `normalizeHealPolicyIssueCodes(value, { requireAtLeastOne?: boolean }): string[]`; at least one stable code for every failed policy result.

- [ ] **Step 1: Add a failing table test for prose-only policy branches**

Use a namespace import so the later normalizer can be tested without an ESM missing-export load error:

```js
import * as testHeal from '../lib/test-heal.mjs';

const { MAX_HEAL_SOURCE_BYTES, verifyHealedSourcePolicy } = testHeal;
```

Add this focused test:

```js
test('policy assigns stable codes to every previously prose-only warning', () => {
  const sourceWithTwoMatchers = SOURCE.replace(
    "    await expect(page.getByTestId('status')).toHaveText('Saved');",
    "    await expect(page.getByTestId('status')).toHaveText('Saved');\n"
      + "    await expect(page.getByTestId('status')).toBeVisible();"
  );
  const cases = [
    ['empty source', SOURCE, '', 'EMPTY_HEALED_SOURCE'],
    ['oversized source', SOURCE, ' '.repeat(MAX_HEAL_SOURCE_BYTES + 1), 'HEALED_SOURCE_TOO_LARGE'],
    ['parse failure', SOURCE, 'import {', 'SOURCE_PARSE_FAILED'],
    ['skip family', SOURCE, SOURCE.replace("test('RSTEP-001 saves'", "test.skip('RSTEP-001 saves'"), 'SKIP_FAMILY_INTRODUCED'],
    ['dynamic test access', SOURCE, SOURCE.replace("test('RSTEP-001 saves'", "test['skip']('RSTEP-001 saves'"), 'DYNAMIC_TEST_ACCESS_INTRODUCED'],
    ['hard sleep', SOURCE, SOURCE.replace(
      "    await page.getByLabel('Plan name').fill(payload.planName);",
      "    await page.waitForTimeout(100);\n    await page.getByLabel('Plan name').fill(payload.planName);"
    ), 'WAIT_FOR_TIMEOUT_INTRODUCED'],
    ['XPath', SOURCE, SOURCE.replace("page.getByLabel('Plan name')", "page.locator('xpath=//input')"), 'XPATH_INTRODUCED'],
    ['nth-child', SOURCE, SOURCE.replace("page.getByLabel('Plan name')", "page.locator('input:nth-child(1)')"), 'NTH_CHILD_INTRODUCED'],
    ['positional pick', SOURCE, SOURCE.replace("page.getByLabel('Plan name')", "page.getByLabel('Plan name').first()"), 'POSITIONAL_LOCATOR_EXCEPTION_MISSING'],
    ['assertion removal', SOURCE, SOURCE.replace("    await expect(page.getByTestId('status')).toHaveText('Saved');\n", ''), 'ASSERTION_COUNT_REDUCED'],
    ['matcher reduction', sourceWithTwoMatchers, sourceWithTwoMatchers.replace("    await expect(page.getByTestId('status')).toHaveText('Saved');\n", ''), 'ASSERTION_MATCHER_REDUCED'],
    ['try/catch', SOURCE, SOURCE.replace(
      "    await expect(page.getByTestId('status')).toHaveText('Saved');",
      "    try {\n      await expect(page.getByTestId('status')).toHaveText('Saved');\n    } catch {}"
    ), 'TRY_CATCH_INTRODUCED'],
    ['guarded assertion', SOURCE, SOURCE.replace(
      "    await expect(page.getByTestId('status')).toHaveText('Saved');",
      "    if (await page.getByTestId('status').isVisible()) {\n"
        + "      await expect(page.getByTestId('status')).toHaveText('Saved');\n    }"
    ), 'GUARDED_ASSERTION_INTRODUCED'],
    ['secret-like literal', SOURCE, `${SOURCE}\nconst leaked = 'sk_live_1234567890abcdefghijklmnop';\n`, 'SECRET_LIKE_LITERAL']
  ];

  for (const [label, previousSource, healedSource, expectedCode] of cases) {
    const result = verifyHealedSourcePolicy({ previousSource, healedSource });
    assert.equal(result.passed, false, label);
    assert.ok(result.issueCodes.includes(expectedCode), `${label}: ${expectedCode}`);
  }
});
```

- [ ] **Step 2: Run the focused test and verify RED**

From `packages/web` run:

```bash
node --test --test-name-pattern="policy assigns stable codes" scripts/ai/__tests__/test-heal-policy.test.mjs
```

Expected: assertion failure because the first prose-only branch has no expected code. It must not fail from syntax or import setup.

- [ ] **Step 3: Add the exact closed code registry**

Near existing exported healer constants add:

```js
export const HEAL_POLICY_ISSUE_CODES = Object.freeze([
  'TRACEABILITY_HEADER_CHANGED',
  'IMPORTS_CHANGED',
  'TEST_DATA_CHANGED',
  'TEST_TITLE_CHANGED',
  'TEST_OPTIONS_CHANGED',
  'FIXTURE_BINDING_CHANGED',
  'STEP_TITLE_CHANGED',
  'ANNOTATION_CHANGED',
  'ASSERTION_ARGUMENT_CHANGED',
  'ACTION_PAYLOAD_CHANGED',
  'COVERAGE_TOKEN_CHANGED',
  'EXECUTABLE_SEMANTICS_CHANGED',
  'UNRESOLVED_DYNAMIC_REQUEST_MUTATION',
  'COMMENTS_CHANGED',
  'EMPTY_HEALED_SOURCE',
  'HEALED_SOURCE_TOO_LARGE',
  'SOURCE_PARSE_FAILED',
  'SKIP_FAMILY_INTRODUCED',
  'DYNAMIC_TEST_ACCESS_INTRODUCED',
  'WAIT_FOR_TIMEOUT_INTRODUCED',
  'XPATH_INTRODUCED',
  'NTH_CHILD_INTRODUCED',
  'POSITIONAL_LOCATOR_EXCEPTION_MISSING',
  'ASSERTION_COUNT_REDUCED',
  'ASSERTION_MATCHER_REDUCED',
  'TRY_CATCH_INTRODUCED',
  'GUARDED_ASSERTION_INTRODUCED',
  'SECRET_LIKE_LITERAL',
  'POLICY_WARNING_UNCLASSIFIED'
]);

const HEAL_POLICY_ISSUE_CODE_SET = new Set(HEAL_POLICY_ISSUE_CODES);
```

- [ ] **Step 4: Assign one code beside every issue without changing policy conditions**

Inside `verifyHealedSourcePolicy()` add local helpers:

```js
const addIssue = (code, message) => {
  issueCodes.push(code);
  issues.push(message);
};
const reject = (code, message) => ({
  passed: false,
  issues: [message],
  issueCodes: [code]
});
```

Use `reject()` for empty, oversized, and parse-failed early returns. Replace each remaining prose-only `issues.push(...)` with `addIssue(<EXACT_CODE>, ...)`. Preserve existing messages, AST conditions, `requireEqualFact()` codes, and existing executable/comment codes byte-for-byte except for the added code bookkeeping.

- [ ] **Step 5: Run the focused code-coverage test and verify GREEN**

```bash
node --test --test-name-pattern="policy assigns stable codes" scripts/ai/__tests__/test-heal-policy.test.mjs
```

Expected: PASS with zero failures.

- [ ] **Step 6: Add a failing test for allowlist normalization and fallback**

```js
test('policy warning normalization keeps only allowlisted unique codes and supplies a safe fallback', () => {
  assert.equal(typeof testHeal.normalizeHealPolicyIssueCodes, 'function');
  assert.deepEqual(
    testHeal.normalizeHealPolicyIssueCodes([
      'SKIP_FAMILY_INTRODUCED',
      'provider supplied detail',
      'SKIP_FAMILY_INTRODUCED',
      'WAIT_FOR_TIMEOUT_INTRODUCED'
    ]),
    ['SKIP_FAMILY_INTRODUCED', 'WAIT_FOR_TIMEOUT_INTRODUCED']
  );
  assert.deepEqual(
    testHeal.normalizeHealPolicyIssueCodes(['provider supplied detail'], { requireAtLeastOne: true }),
    ['POLICY_WARNING_UNCLASSIFIED']
  );
  assert.deepEqual(testHeal.normalizeHealPolicyIssueCodes(undefined), []);
});
```

- [ ] **Step 7: Run the normalizer test and verify RED**

```bash
node --test --test-name-pattern="policy warning normalization" scripts/ai/__tests__/test-heal-policy.test.mjs
```

Expected: assertion failure because `normalizeHealPolicyIssueCodes` does not exist.

- [ ] **Step 8: Implement the minimal normalizer**

```js
export function normalizeHealPolicyIssueCodes(value, { requireAtLeastOne = false } = {}) {
  const normalized = [];
  for (const code of Array.isArray(value) ? value : []) {
    if (!HEAL_POLICY_ISSUE_CODE_SET.has(code) || normalized.includes(code)) continue;
    normalized.push(code);
  }
  if (normalized.length === 0 && requireAtLeastOne) {
    return ['POLICY_WARNING_UNCLASSIFIED'];
  }
  return normalized;
}
```

Unknown strings must be discarded even when they match the visual style of a code.

- [ ] **Step 9: Verify Task 1 and commit**

```bash
node --test scripts/ai/__tests__/test-heal-policy.test.mjs
git diff --check
git diff -- packages/web/scripts/ai/lib/test-heal.mjs packages/web/scripts/ai/__tests__/test-heal-policy.test.mjs
git add packages/web/scripts/ai/lib/test-heal.mjs packages/web/scripts/ai/__tests__/test-heal-policy.test.mjs
git commit -m "fix(web): classify healer policy warnings"
```

Expected: policy tests pass and the commit contains only the two Task 1 files.

---

### Task 2: Continue proposal-only candidates after policy warnings

**Files:**
- Modify: `packages/web/scripts/ai/heal-test.mjs:34-52,681-745,931-1165`
- Test: `packages/web/scripts/ai/__tests__/test-heal.test.mjs:1548-1580`

**Interfaces:**
- Consumes: `normalizeHealPolicyIssueCodes(value, { requireAtLeastOne })` from Task 1 and `policy.issueCodes` from policy evaluation.
- Produces: `checks.policy = "warning"`; `policyIssueCodes` on warning-bearing attempt records; `attempt-N.policy-warning.json`; proposal status `proposal-ready-with-policy-warnings`.

- [ ] **Step 1: Replace the old hard-rejection test with a failing proposal-warning test**

Rename the existing test to `healSingleTest verifies and archives a proposal after a policy warning`. Use a candidate that removes the assertion and a verification sequence with a failing baseline followed by a passing candidate:

```js
const warningSource = CLEAN_SOURCE.replace(
  "  await expect(page.getByTestId('status')).toHaveText('Saved');\n",
  ''
);
const { run, calls } = executionSequence([FAILED_EXECUTION, PASSED_EXECUTION]);
```

Keep handwritten contract, passing typecheck/lint, and `apply: false`. Assert:

```js
assert.equal(result.status, 'proposal-ready-with-policy-warnings');
assert.equal(result.attemptsUsed, 1);
assert.deepEqual(result.policyIssueCodes, [
  'ASSERTION_ARGUMENT_CHANGED',
  'EXECUTABLE_SEMANTICS_CHANGED',
  'ASSERTION_COUNT_REDUCED',
  'ASSERTION_MATCHER_REDUCED'
]);
assert.equal(calls.length, 2);
assert.equal(fs.readFileSync(targetPath, 'utf8'), CLEAN_SOURCE);
assert.equal(fs.readFileSync(result.candidatePath, 'utf8'), warningSource);
assert.equal(fs.existsSync(result.diffPath), true);
```

Do not make the test depend on raw policy prose. Keep the exact code order above
identical across the result, trail, summary, and warning audit.

Read `heal-summary.json` and `attempt-1.policy-warning.json`, then assert the same codes are present. Assert the trail entry is:

```js
{
  attempt: 1,
  outcome: 'proposal-ready-with-policy-warnings',
  checks: {
    policy: 'warning',
    typecheck: 'passed',
    lint: 'passed',
    review: 'passed',
    runtime: 'passed',
    candidateIntegrity: 'passed',
    diff: 'passed'
  },
  policyIssueCodes: result.policyIssueCodes
}
```

Assert serialized summary/warning audit does not match `/must not|flow works|expect\(|getByTestId/`; candidate source is allowed only in the fully verified `candidate.ts` proposal.

- [ ] **Step 2: Run the focused proposal test and verify RED**

```bash
node --test --test-name-pattern="archives a proposal after a policy warning" scripts/ai/__tests__/test-heal.test.mjs
```

Expected: current code returns `exhausted`, performs no candidate verification, and creates no proposal.

- [ ] **Step 3: Add warning-only audit helpers**

Import `normalizeHealPolicyIssueCodes`. Replace `auditAttemptTrail()` with logic that includes `policyIssueCodes` only when the normalized list is non-empty:

```js
function auditAttemptTrail(attemptTrail) {
  return attemptTrail.slice(-MAX_AUTOHEAL_MAX_ATTEMPTS).map((entry) => {
    const policyWarning = entry.checks?.policy === 'warning'
      || (Array.isArray(entry.policyIssueCodes) && entry.policyIssueCodes.length > 0);
    const policyIssueCodes = normalizeHealPolicyIssueCodes(entry.policyIssueCodes, {
      requireAtLeastOne: policyWarning
    });
    return {
      attempt: entry.attempt,
      outcome: entry.outcome,
      ...(entry.checks ? { checks: { ...entry.checks } } : {}),
      ...(policyIssueCodes.length > 0 ? { policyIssueCodes } : {})
    };
  });
}
```

Add a dedicated serializer:

```js
function policyWarningAudit(attempt, issueCodes) {
  return `${JSON.stringify({
    schema: 'test-heal-policy-warning/v1',
    attempt,
    outcome: 'policy-warning',
    policyIssueCodes: normalizeHealPolicyIssueCodes(issueCodes, { requireAtLeastOne: true })
  }, null, 2)}\n`;
}
```

Do not repurpose `rejectedAttemptAudit()` because the candidate is no longer rejected.

Update `sanitizePublicResult()` so a top-level warning list is normalized again at
the public boundary:

```js
if (Object.hasOwn(result, 'policyIssueCodes')) {
  sanitized.policyIssueCodes = normalizeHealPolicyIssueCodes(result.policyIssueCodes, {
    requireAtLeastOne: true
  });
}
```

- [ ] **Step 4: Convert the hard policy branch into advisory flow**

At the top of each attempt declare `let policyIssueCodes = [];`. Make `recordAttempt()` automatically attach its current normalized list:

```js
const recordAttempt = (outcome) => {
  attemptTrail.push({
    attempt,
    outcome,
    ...(Object.keys(checks).length > 0 ? { checks: { ...checks } } : {}),
    ...(policyIssueCodes.length > 0 ? { policyIssueCodes: [...policyIssueCodes] } : {})
  });
};
```

Replace the rejection/continue block with:

```js
const policy = verifyHealedSourcePolicy({ previousSource: originalSource, healedSource: healed.code });
policyIssueCodes = policy.passed
  ? []
  : normalizeHealPolicyIssueCodes(policy.issueCodes, { requireAtLeastOne: true });
checks.policy = policy.passed ? 'passed' : 'warning';
if (!policy.passed) {
  archive.write(`attempt-${attempt}.policy-warning.json`, policyWarningAudit(attempt, policyIssueCodes));
  log(`[heal] ${target}: attempt ${attempt} continues with policy warnings: ${policyIssueCodes.join(', ')}.`);
}
```

There must be no `continue`, no `policy-rejected` record, no `rejected-policy` file, and no policy prose assigned to `notes` at this boundary.

- [ ] **Step 5: Add the warning-bearing proposal result**

In the verified `!apply` branch choose status and attempt outcome from the warning list:

```js
const proposalStatus = policyIssueCodes.length > 0
  ? 'proposal-ready-with-policy-warnings'
  : 'proposal-ready';
recordAttempt(proposalStatus);
return finish({
  status: proposalStatus,
  attemptsUsed: attempt,
  candidateSha256: candidateSha,
  candidatePath: candidateArchivePath,
  diffPath,
  ...(policyIssueCodes.length > 0 ? { policyIssueCodes } : {})
});
```

Add `proposal-ready-with-policy-warnings` to `isSuccessfulHealStatus()` so proposal-only warning completion exits `0`.

- [ ] **Step 6: Run the focused proposal test and verify GREEN**

```bash
node --test --test-name-pattern="archives a proposal after a policy warning" scripts/ai/__tests__/test-heal.test.mjs
```

Expected: PASS; target unchanged, proposal archived, warning codes identical in result/trail/summary/warning audit.

- [ ] **Step 7: Add and verify a table of later hard-gate regressions**

Add one test that exercises typecheck, lint, contract review, and runtime after the
same assertion-removing policy warning:

```js
test('policy warnings never bypass later hard gates', async () => {
  const warningSource = CLEAN_SOURCE.replace(
    "  await expect(page.getByTestId('status')).toHaveText('Saved');\n",
    ''
  );
  const cases = [
    {
      label: 'typecheck',
      executions: [FAILED_EXECUTION],
      expectedOutcome: 'typecheck-rejected',
      overrides: { typecheck: () => ({ passed: false, issues: ['typecheck rejected'] }) }
    },
    {
      label: 'lint',
      executions: [FAILED_EXECUTION],
      expectedOutcome: 'lint-rejected',
      overrides: { lint: () => ({ passed: false, issues: ['lint rejected'] }) }
    },
    {
      label: 'review',
      executions: [FAILED_EXECUTION],
      expectedOutcome: 'static-review-rejected',
      overrides: { reviewContract: () => ({ passed: false, issues: ['review rejected'] }) }
    },
    {
      label: 'runtime',
      executions: [FAILED_EXECUTION, FAILED_EXECUTION],
      expectedOutcome: 'still-failing',
      overrides: {}
    }
  ];

  for (const gateCase of cases) {
    const { webRoot, target, targetPath } = makeHealWorkspace();
    const { run } = executionSequence(gateCase.executions);
    const result = await healSingleTest({
      testPath: target,
      env: { AI_AUTOHEAL_ENABLED: 'true' },
      webRoot,
      maxAttempts: 1,
      log: () => {},
      resolveContract: () => ({ kind: 'handwritten', testPath: target }),
      reviewContract: () => ({ passed: true, issues: [] }),
      typecheck: PASSING_TYPECHECK,
      lint: PASSING_LINT,
      executeStandalone: run,
      heal: async () => ({ code: warningSource }),
      ...gateCase.overrides
    });

    assert.equal(result.status, 'exhausted', gateCase.label);
    assert.equal(fs.readFileSync(targetPath, 'utf8'), CLEAN_SOURCE, gateCase.label);
    assert.equal(fs.existsSync(path.join(result.archiveDir, 'candidate.ts')), false, gateCase.label);
    assert.equal(fs.existsSync(path.join(result.archiveDir, 'candidate.diff')), false, gateCase.label);
    assert.equal(result.attemptTrail[0].outcome, gateCase.expectedOutcome, gateCase.label);
    assert.equal(result.attemptTrail[0].checks.policy, 'warning', gateCase.label);
    assert.ok(result.attemptTrail[0].policyIssueCodes.includes('ASSERTION_COUNT_REDUCED'), gateCase.label);
  }
});
```

Run RED before implementation if this test is added before Steps 3-5; after implementation run:

```bash
node --test --test-name-pattern="policy warnings never bypass later hard gates" scripts/ai/__tests__/test-heal.test.mjs
```

Expected: PASS and no target mutation/proposal.

- [ ] **Step 8: Re-run secret preflight coverage**

```bash
node --test --test-name-pattern="known low-entropy secrets in candidate source" scripts/ai/__tests__/test-heal.test.mjs
```

Expected: PASS; the candidate remains a hard `brain-error`, no policy-warning file is created, no later provider call occurs, and the target is unchanged.

- [ ] **Step 9: Verify Task 2 and commit**

```bash
node --test --test-name-pattern="policy warning|proposal-only by default|known low-entropy secrets" scripts/ai/__tests__/test-heal.test.mjs
git diff --check
git diff -- packages/web/scripts/ai/heal-test.mjs packages/web/scripts/ai/__tests__/test-heal.test.mjs
git add packages/web/scripts/ai/heal-test.mjs packages/web/scripts/ai/__tests__/test-heal.test.mjs
git commit -m "feat(web): continue proposal healing with policy warnings"
```

Expected: focused tests pass and the Task 2 commit contains only the orchestrator and its test file.

---

### Task 3: Apply warning-bearing candidates and signal CI failure

**Files:**
- Modify: `packages/web/scripts/ai/heal-test.mjs:780-795,1140-1280,1330-1485`
- Test: `packages/web/scripts/ai/__tests__/test-heal.test.mjs:800-900,1455-1490,1580-1660`

**Interfaces:**
- Consumes: warning-bearing attempt state and normalized codes from Tasks 1-2.
- Produces: `healed-with-policy-warnings`; atomic promotion with backup; `formatPolicyWarningDiagnostics(attemptTrail): string[]`; explicit CLI warning branches; exit `1` for applied warning status.

- [ ] **Step 1: Add a failing apply integration test**

Use `makeHealWorkspace()`, the assertion-removing warning source from Task 2, and:

```js
const { run, calls } = executionSequence([FAILED_EXECUTION, PASSED_EXECUTION]);
const result = await healSingleTest({
  testPath: target,
  env: { AI_AUTOHEAL_ENABLED: 'true' },
  webRoot,
  maxAttempts: 1,
  apply: true,
  log: () => {},
  resolveContract: () => ({ kind: 'handwritten', testPath: target }),
  reviewContract: () => ({ passed: true, issues: [] }),
  typecheck: PASSING_TYPECHECK,
  lint: PASSING_LINT,
  targetDirty: () => false,
  executeStandalone: run,
  heal: async () => ({ code: warningSource })
});
```

Assert:

```js
assert.equal(result.status, 'healed-with-policy-warnings');
assert.equal(calls.length, 2);
assert.equal(fs.readFileSync(targetPath, 'utf8'), warningSource);
assert.equal(fs.readFileSync(result.backupPath, 'utf8'), CLEAN_SOURCE);
assert.equal(fs.readFileSync(result.candidatePath, 'utf8'), warningSource);
assert.equal(fs.existsSync(result.diffPath), true);
assert.ok(result.policyIssueCodes.includes('ASSERTION_COUNT_REDUCED'));
assert.equal(result.attemptTrail[0].outcome, 'healed-with-policy-warnings');
assert.equal(result.attemptTrail[0].checks.policy, 'warning');
```

- [ ] **Step 2: Run the apply test and verify RED**

```bash
node --test --test-name-pattern="applies a verified candidate with policy warnings" scripts/ai/__tests__/test-heal.test.mjs
```

Expected: FAIL because the current apply branch returns `healed`, or because advisory flow/status has not yet been connected to apply. The target/status assertion must demonstrate the missing warning behavior.

- [ ] **Step 3: Add warning-bearing apply status without weakening atomic safeguards**

After the existing atomic rename and bound-file checks, choose the result status:

```js
const healedStatus = policyIssueCodes.length > 0
  ? 'healed-with-policy-warnings'
  : 'healed';
recordAttempt(healedStatus);
const healedResult = {
  status: healedStatus,
  attemptsUsed: attempt,
  candidateSha256: candidateSha,
  candidatePath: candidateArchivePath,
  diffPath,
  backupPath: archiveOriginalPath,
  ...(policyIssueCodes.length > 0 ? { policyIssueCodes } : {})
};
```

Do not move this selection before dirty-target, snapshot, integrity, promotion-source, or atomic rename checks. Preserve the warning status in the audit-write fallback returned after promotion.

- [ ] **Step 4: Run the apply test and verify GREEN**

```bash
node --test --test-name-pattern="applies a verified candidate with policy warnings" scripts/ai/__tests__/test-heal.test.mjs
```

Expected: PASS with target bytes equal to the warning candidate and backup bytes equal to the original.

- [ ] **Step 5: Add failing CLI/status tests**

Use a namespace import for `heal-test.mjs` exports and add:

```js
test('CLI status policy treats warning proposal as success and warning apply as failure', () => {
  assert.equal(isSuccessfulHealStatus('proposal-ready-with-policy-warnings'), true);
  assert.equal(isSuccessfulHealStatus('healed-with-policy-warnings'), false);
  assert.equal(isSuccessfulHealStatus('proposal-ready'), true);
  assert.equal(isSuccessfulHealStatus('healed'), true);
});

test('CLI policy warning diagnostics expose only allowlisted attempt codes', () => {
  assert.equal(typeof healCli.formatPolicyWarningDiagnostics, 'function');
  assert.deepEqual(healCli.formatPolicyWarningDiagnostics([
    {
      attempt: 1,
      outcome: 'healed-with-policy-warnings',
      policyIssueCodes: [
        'ASSERTION_COUNT_REDUCED',
        'raw provider detail',
        'ASSERTION_COUNT_REDUCED'
      ],
      rawIssue: 'source excerpt'
    },
    { attempt: 2, outcome: 'healed', policyIssueCodes: ['WAIT_FOR_TIMEOUT_INTRODUCED'] },
    { attempt: 3, outcome: 'typecheck-rejected', policyIssueCodes: ['unknown-only'] }
  ]), [
    'Policy attempt 1: ASSERTION_COUNT_REDUCED',
    'Policy attempt 3: POLICY_WARNING_UNCLASSIFIED'
  ]);
});
```

Update the existing help test to require both new status names and the sentence that an applied warning result exits non-zero.

- [ ] **Step 6: Run the CLI/status tests and verify RED**

```bash
node --test --test-name-pattern="CLI status policy|CLI policy warning diagnostics|CLI help" scripts/ai/__tests__/test-heal.test.mjs
```

Expected: FAIL because the status policy, formatter, CLI branches, and help text do not yet support warning-bearing outcomes.

- [ ] **Step 7: Implement bounded warning formatting and CLI branches**

Export:

```js
export function formatPolicyWarningDiagnostics(attemptTrail) {
  return auditAttemptTrail(Array.isArray(attemptTrail) ? attemptTrail : [])
    .filter((entry) => entry.policyIssueCodes?.length > 0)
    .map((entry) => `Policy attempt ${entry.attempt}: ${entry.policyIssueCodes.join(', ')}`);
}
```

Update `isSuccessfulHealStatus()` to include
`proposal-ready-with-policy-warnings` but deliberately exclude
`healed-with-policy-warnings`. This makes the existing aggregate `allGreen` logic
return process exit `1` after the warning-bearing apply.

Add explicit CLI branches before the generic failure branch:

```js
} else if (result.status === 'proposal-ready-with-policy-warnings') {
  console.log(`PROPOSAL READY WITH POLICY WARNINGS ${result.target}${suffix} (target unchanged). Diff: ${result.diffPath}. Archive: ${result.archiveDir}`);
} else if (result.status === 'healed-with-policy-warnings') {
  console.error(`HEALED WITH POLICY WARNINGS ${result.target}${suffix}. Backup: ${result.backupPath}`);
```

After the status line, render:

```js
for (const line of formatPolicyWarningDiagnostics(result.attemptTrail)) {
  console.error(`- ${line}`);
}
```

Ensure warning diagnostics are printed exactly once. Update `helpText()` to document both statuses and the non-zero exit after a warning-bearing apply.

- [ ] **Step 8: Run focused Task 3 tests and clean-path regression tests**

```bash
node --test --test-name-pattern="applies a verified candidate with policy warnings|CLI status policy|CLI policy warning diagnostics|CLI help|proposal-only by default|heals on a later attempt" scripts/ai/__tests__/test-heal.test.mjs
```

Expected: all selected tests pass. Clean proposal remains `proposal-ready`; clean apply remains `healed`; warning apply changes the target but is not a clean-success status.

- [ ] **Step 9: Run complete framework verification**

From `packages/web`:

```bash
node --test scripts/ai/__tests__/test-heal-policy.test.mjs
node --test scripts/ai/__tests__/test-heal.test.mjs
npx eslint scripts/ai/heal-test.mjs scripts/ai/lib/test-heal.mjs scripts/ai/__tests__/test-heal.test.mjs scripts/ai/__tests__/test-heal-policy.test.mjs --max-warnings=0
npm run typecheck
npm run ai:test:self
git diff --check
```

Expected: every command exits `0`. If `ai:test:self` exposes a genuinely unrelated pre-existing failure, record its exact test/output and separately preserve the successful focused commands; do not claim the full suite passed.

- [ ] **Step 10: Perform the final security and requirements audit**

```bash
git diff -- packages/web/scripts/ai/heal-test.mjs packages/web/scripts/ai/lib/test-heal.mjs packages/web/scripts/ai/__tests__/test-heal.test.mjs packages/web/scripts/ai/__tests__/test-heal-policy.test.mjs
rg -n 'policy\.issues|healed\.code|policy-warning|policy-rejected|rejected-policy' packages/web/scripts/ai/heal-test.mjs
```

Confirm from the diff and tests:

- policy issues become warning codes and never raw public/audit prose;
- candidate secret preflight remains before policy evaluation;
- a warning alone never executes `continue`;
- downstream hard-gate failures retain warning codes but do not archive a proposal;
- clean and warning proposal/apply statuses match the outcome matrix;
- warning apply occurs only after all original atomic promotion checks;
- warning apply is excluded from clean-success exit calculation;
- no PsychicBook or unrelated framework file changed.

- [ ] **Step 11: Commit Task 3 and request review**

```bash
git add packages/web/scripts/ai/heal-test.mjs packages/web/scripts/ai/__tests__/test-heal.test.mjs
git commit -m "feat(web): apply verified heals with policy warnings"
git status --short
```

Expected: Task 3 commit contains only the orchestrator and its tests; isolated worktree is clean. Request an independent code review before integration.
