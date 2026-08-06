# Framework Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce healer and experiment maintenance complexity while preserving every externally requested verification and policy-warning behavior.

**Architecture:** Keep the existing linear healer and hard gates. Model policy warnings as metadata on the existing accepted statuses, replace independent execution booleans with one purpose, reuse generic user runtime configuration, and consolidate repeated process artifacts.

**Tech Stack:** Node.js 20+, ECMAScript modules, TypeScript 5.9, Playwright Test 1.59, Node test runner, ESLint 9 flat config.

## Global Constraints

- Proposal-only warning results exit zero and do not mutate the target.
- `--apply` warning results atomically mutate the target and exit non-zero.
- Typecheck, lint, contract review, runtime, diff, integrity, and concurrent-edit checks remain hard.
- No fixed waits, retries, selector weakening, or live secrets are introduced.
- No generic pipeline, state-machine library, or class hierarchy is added.
- Existing generated-test and spec contracts remain valid.

---

### Task 1: Orthogonal policy-warning results

**Files:**
- Modify: `packages/web/scripts/ai/heal-test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/test-heal.test.mjs`
- Create: `packages/web/scripts/ai/__tests__/heal-test-cli.test.mjs`

**Interfaces:**
- `healSingleTest()` continues returning `proposal-ready` or `healed` for accepted candidates.
- Warning-bearing accepted results add `policyIssueCodes: string[]`.
- `renderHealResults()` derives exit status from `status`, `policyIssueCodes`, and whether the accepted result was applied.

- [ ] **Step 1: Write failing CLI tests for orthogonal warning metadata**

Move the policy CLI cases into `heal-test-cli.test.mjs` and assert:

```js
assert.equal(warningProposal.status, 'proposal-ready');
assert.equal(renderHealResults([warningProposal]).exitCode, 0);
assert.equal(warningApply.status, 'healed');
assert.equal(renderHealResults([warningApply]).exitCode, 1);
```

- [ ] **Step 2: Run the focused tests and confirm the old warning statuses fail the new contract**

Run: `node --test scripts/ai/__tests__/heal-test-cli.test.mjs scripts/ai/__tests__/test-heal.test.mjs`

Expected: FAIL because current results use `proposal-ready-with-policy-warnings` and `healed-with-policy-warnings`.

- [ ] **Step 3: Implement the minimal status simplification**

Return the existing accepted status and attach sanitized `policyIssueCodes`. Render only result-level accepted warnings. Remove `stdoutLines`/`stderrLines`, per-attempt warning files, and warning-status help text. Keep warning codes in `heal-summary.json` through `attemptTrail`.

- [ ] **Step 4: Run focused policy and healer tests**

Run: `node --test scripts/ai/__tests__/heal-test-cli.test.mjs scripts/ai/__tests__/test-heal-policy.test.mjs scripts/ai/__tests__/test-heal.test.mjs`

Expected: PASS.

### Task 2: Explicit Playwright execution purpose

**Files:**
- Modify: `packages/web/scripts/ai/generated-test-gate.mjs`
- Modify: `packages/web/scripts/ai/lib/generated-gate-runner.mjs`
- Modify: `packages/web/scripts/ai/heal-test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/generated-test-gate-hardening.test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/test-heal.test.mjs`

**Interfaces:**
- `buildPlaywrightStage({ purpose })` accepts `gate`, `diagnostic`, or `healer-candidate`.
- `executeGeneratedPair(..., { purpose })` forwards the purpose.
- Omitted purpose remains `gate`.

- [ ] **Step 1: Replace boolean-oriented tests with purpose-oriented failing tests**

Assert diagnostic permits only repeat 1 without max failures, healer-candidate permits policy repeat counts without max failures, and gate retains max failures for one target.

- [ ] **Step 2: Run the generated-gate hardening tests and confirm failure**

Run: `node --test scripts/ai/__tests__/generated-test-gate-hardening.test.mjs`

Expected: FAIL because `purpose` is not implemented.

- [ ] **Step 3: Implement the three-value execution purpose**

Validate the purpose centrally in `buildPlaywrightStage`. Remove `diagnostic` and `failFast` from the gate runner and healer call chain.

- [ ] **Step 4: Run generated-gate and healer tests**

Run: `node --test scripts/ai/__tests__/generated-test-gate-hardening.test.mjs scripts/ai/__tests__/generated-test-gate.test.mjs scripts/ai/__tests__/test-heal.test.mjs`

Expected: PASS.

### Task 3: Generic runtime email and deterministic ESLint dependencies

**Files:**
- Modify: `packages/web/data/users.ts`
- Delete: `packages/web/data/psychicbook.ts`
- Modify: `packages/web/scripts/ai/lib/gate-environment.mjs`
- Rename: `packages/web/scripts/ai/__tests__/gate-environment-psychicbook.test.mjs` to `packages/web/scripts/ai/__tests__/gate-environment.test.mjs`
- Modify: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Modify: `packages/web/specs/psychicbook-healing-experiment.md`
- Modify: `packages/web/package.json`
- Modify: `package-lock.json`

**Interfaces:**
- `requireStandardUserEmail(): string` reads trimmed `E2E_USER_EMAIL` and throws when absent.
- The external gate forwards `E2E_USER_EMAIL` and `E2E_HTTP_BASIC_USERNAME`; static gates strip both.

- [ ] **Step 1: Write failing generic environment and data-helper tests**

Assert the existing standard email is external-only, remains a known secret, and the required helper rejects a missing value.

- [ ] **Step 2: Run focused tests and typecheck to confirm the missing helper/current PsychicBook variable contract fails**

Run: `node --test scripts/ai/__tests__/gate-environment.test.mjs && npm run typecheck`

Expected: FAIL before implementation.

- [ ] **Step 3: Replace PsychicBook-specific runtime plumbing**

Add `requireStandardUserEmail`, update the generated test/spec and traceability hash, remove `PSYCHICBOOK_E2E_EMAIL` from the gate and delete the dedicated module.

- [ ] **Step 4: Declare and lock ESLint dependencies**

Add exact versions for `@eslint/js`, `eslint`, `eslint-plugin-playwright`, `globals`, and `typescript-eslint` to the web dev dependencies and regenerate the root lockfile with `npm install --package-lock-only`.

- [ ] **Step 5: Verify generic runtime configuration and lint**

Run: `node --test scripts/ai/__tests__/gate-environment.test.mjs && npm run typecheck && npx --no-install eslint tests/regression/psychicbook-healing-experiment.spec.ts --max-warnings=0`

Expected: PASS.

### Task 4: Focus the healer boundaries

**Files:**
- Modify: `packages/web/scripts/ai/heal-test.mjs`
- Modify: `packages/web/scripts/ai/lib/test-heal.mjs`
- Modify: `packages/web/scripts/ai/__tests__/test-heal.test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/test-heal-policy.test.mjs`

**Interfaces:**
- `candidateSourceSafetyIssue()` owns all candidate scanner composition.
- Accepted result construction uses one helper and does not create new public statuses.
- `healSingleTest` remains the only public orchestration entry point.

- [ ] **Step 1: Add characterization tests for candidate secret scanning and accepted results**

Retain the realistic traceability SHA, contiguous-prefix token, regex token, known low-entropy secret, and clean locator candidate cases.

- [ ] **Step 2: Run characterization tests before refactoring**

Run: `node --test scripts/ai/__tests__/test-heal-policy.test.mjs scripts/ai/__tests__/test-heal.test.mjs`

Expected: PASS, establishing behavior.

- [ ] **Step 3: Extract only cohesive boundaries**

Move repeated accepted-result assembly and candidate scanner composition into small functions. Keep file-binding, snapshots, and atomic promotion explicit in the orchestration function; do not create a generic stage engine.

- [ ] **Step 4: Re-run characterization tests**

Run: `node --test scripts/ai/__tests__/test-heal-policy.test.mjs scripts/ai/__tests__/test-heal.test.mjs`

Expected: PASS with unchanged behavior.

### Task 5: Consolidate experiment artifacts

**Files:**
- Create: `packages/web/docs/ai-testing/psychicbook-healing-feedback-2026-08-05-06.md`
- Delete: five existing `packages/web/docs/ai-testing/psychicbook-healing-feedback-*.md` reports
- Delete: superseded PsychicBook rerun plans in `docs/superpowers/plans/`
- Delete: superseded PsychicBook rerun designs in `docs/superpowers/specs/`
- Modify: `packages/web/specs/psychicbook-healing-experiment.md`
- Modify: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`

**Interfaces:**
- The consolidated report preserves every unique defect, fix, run result, and unresolved issue.
- The flow spec remains valid under `validate-flow-spec.mjs` and matches the generated-test traceability header.

- [ ] **Step 1: Build the consolidated report from the five source reports**

Use a run matrix plus deduplicated implemented/unresolved sections. Preserve exact result counts and external registration outcomes.

- [ ] **Step 2: Remove repeated plan/design/report files**

Keep this simplification design and implementation plan as the sole current process documents for the cleanup.

- [ ] **Step 3: Remove implementation-shaped repetition from the experiment spec/test**

Keep repository-required sections, but remove exact class/local-variable directives and unused test data fields. Stamp the updated spec hash into the generated test.

- [ ] **Step 4: Validate spec, drift, review, and TypeScript**

Run: `npm run ai:spec:validate -- specs/psychicbook-healing-experiment.md && npm run ai:spec:drift && npm run ai:test:review -- --spec specs/psychicbook-healing-experiment.md --test tests/regression/psychicbook-healing-experiment.spec.ts && npm run typecheck`

Expected: PASS.

### Task 6: Full verification

**Files:**
- Verify all changed files.

**Interfaces:**
- No new interface; this task proves the branch-wide result.

- [ ] **Step 1: Run the complete self-suite**

Run: `npm run ai:test:self`

Expected: all tests pass with zero skipped or failed tests.

- [ ] **Step 2: Run static verification**

Run: `npm run typecheck && npx --no-install eslint tests/regression/psychicbook-healing-experiment.spec.ts --max-warnings=0`

Expected: PASS.

- [ ] **Step 3: Inspect repository integrity**

Run: `git diff --check && git status --short && git diff --stat sains...HEAD`

Expected: no whitespace errors, only intended files changed, and substantially fewer process-document lines than before cleanup.

- [ ] **Step 4: Commit the verified cleanup**

Commit message: `refactor(web): simplify healer experiment framework`
