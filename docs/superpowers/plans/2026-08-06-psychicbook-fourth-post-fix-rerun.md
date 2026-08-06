# PsychicBook Fourth Post-Fix Rerun Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freshly regenerate the PsychicBook Playwright target, execute a causal locator-healing experiment against the real stage, and publish an independent rerun-4 report.

**Architecture:** Work only in the existing linked worktree. Record generator declarations, filesystem mutations, static acceptance, baseline behavior, controlled RED, healer proposal, and final behavior as separate receipts. Runtime identities stay process-only; framework changes require a reproduced defect and focused RED regression.

**Tech Stack:** Node.js 22, TypeScript, Playwright Test, repository AI generator/gate/healer scripts, Git worktree, Markdown audit artifacts.

## Global Constraints

- Worktree: `/Users/maybebest/Documents/web-api-test-generator/.worktrees/healer-policy-soft-fail`.
- Branch: `codex/healer-policy-soft-fail`; the primary checkout is read-only.
- Design: `docs/superpowers/specs/2026-08-06-psychicbook-fourth-post-fix-rerun-design.md`.
- Runtime values stay only in `PLAYWRIGHT_TEST_BASE_URL`, `E2E_HTTP_BASIC_USERNAME`, `E2E_HTTP_BASIC_PASSWORD`, and `PSYCHICBOOK_E2E_EMAIL`.
- Never print or persist runtime identities, cookies, authorization data, request bodies, browser media, traces, or raw reports.
- The reviewed verification value is `1234`.
- Controlled RED changes only `Get Started` to `Get Started BROKEN`.
- Healer stays proposal-only: no `--apply` and no `--allow-dirty`.
- Chromium uses one worker and zero retries.
- Candidate acceptance requires the one locator repair and unchanged terminal newline.
- Report: `packages/web/docs/ai-testing/psychicbook-healing-feedback-2026-08-06-rerun-4.md`.
- Do not commit `.ai-runs` or browser artifacts.

---

### Task 1: Prove isolation and reset the generated target

**Files:**
- Modify: `packages/web/specs/psychicbook-healing-experiment.md`
- Delete: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Preserve: `packages/web/data/psychicbook.ts`

**Interfaces:**
- Consumes: the committed post-fix framework and reviewed flow spec.
- Produces: baseline receipts, an absent target, and a strict pending-generation spec.

- [ ] **Step 1: Record worktree and primary-checkout receipts**

```bash
git rev-parse --git-dir
git rev-parse --git-common-dir
git branch --show-current
git status --short
git -C /Users/maybebest/Documents/web-api-test-generator status --porcelain=v1 -z | shasum -a 256
git -C /Users/maybebest/Documents/web-api-test-generator status --porcelain=v1 | wc -l
```

- [ ] **Step 2: Run the framework baseline**

```bash
cd packages/web
npm run ai:test:self
npm run typecheck
```

Expected: every framework self-test passes and TypeScript exits `0`.

- [ ] **Step 3: Delete the exact target and reset lifecycle with `apply_patch`**

```diff
-| Generation Status | generated |
+| Generation Status | pending-generation |
```

Delete only `tests/regression/psychicbook-healing-experiment.spec.ts`.

- [ ] **Step 4: Strictly validate and commit the reset**

```bash
node scripts/ai/validate-flow-spec.mjs specs/psychicbook-healing-experiment.md --strict
git add specs/psychicbook-healing-experiment.md tests/regression/psychicbook-healing-experiment.spec.ts
git commit -m "test(web): reset PsychicBook target for fourth rerun"
```

### Task 2: Create and evaluate one fresh generation

**Files:**
- Create: one timestamped ignored `.ai-runs/**/generation-task.md`
- Create: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Modify: `packages/web/specs/psychicbook-healing-experiment.md`

**Interfaces:**
- Consumes: absent target and strict pending spec.
- Produces: wrapper receipt, mutation receipt, one accepted evaluated target, and generated lifecycle.

- [ ] **Step 1: Select the provider and create a fresh task**

```bash
npm run ai:brain:doctor
npm run ai:generate-test -- specs/psychicbook-healing-experiment.md --target tests/regression/psychicbook-healing-experiment.spec.ts
PSY_FOURTH_GENERATION_TASK="$(find .ai-runs -type f -name generation-task.md -print0 | xargs -0 ls -t | head -n 1)"
test -n "$PSY_FOURTH_GENERATION_TASK"
test ! -e tests/regression/psychicbook-healing-experiment.spec.ts
test -z "$(find .ai-runs -maxdepth 1 -type d -name 'gate-*' -print -quit)"
test ! -e test-results
test ! -e playwright-report
test ! -e allure-results
```

Record the newest manifest-bound `generation-task.md`; assert the target is still absent.

- [ ] **Step 2: Invoke the configured brain once without result-cache reuse**

```bash
AI_BRAIN_TIMEOUT_MS=300000 AI_RESULT_CACHE_ENABLED=false npm run ai:brain:generate -- \
  "$PSY_FOURTH_GENERATION_TASK" \
  --out tests/regression/psychicbook-healing-experiment.spec.ts
```

The controller substitutes the exact task path captured in Step 1. Record the wrapper
exit independently from target/spec existence and SHA-256. A nonzero exit plus any
workspace mutation remains a failed generator transaction. After the terminal exit,
inspect the target, lifecycle row, newly created `.ai-runs/gate-*`, `test-results`,
`playwright-report`, and `allure-results` before cleaning any transient provider
artifact.

- [ ] **Step 3: Quarantine any complete side-effect candidate and restore controller ownership**

Exact-scan the candidate and changed spec for runtime values. If the wrapper failed,
archive only the safe source under that ignored run, reverse unexpected mutations with
`apply_patch`, then materialize the same safe source deliberately and set:

```diff
-| Generation Status | pending-generation |
+| Generation Status | generated |
```

- [ ] **Step 4: Run static acceptance**

```bash
node scripts/ai/validate-flow-spec.mjs specs/psychicbook-healing-experiment.md --strict
node scripts/ai/review-generated-test.mjs --spec specs/psychicbook-healing-experiment.md --test tests/regression/psychicbook-healing-experiment.spec.ts --mode single
npm run typecheck
npx eslint tests/regression/psychicbook-healing-experiment.spec.ts data/psychicbook.ts --max-warnings=0
```

- [ ] **Step 5: Commit the accepted evaluated target**

```bash
git add specs/psychicbook-healing-experiment.md tests/regression/psychicbook-healing-experiment.spec.ts
git commit -m "test(web): regenerate PsychicBook target for fourth rerun"
```

### Task 3: Establish GREEN, controlled RED, and healer proposal

**Files:**
- Temporarily modify: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Create: one fresh ignored healer audit.

**Interfaces:**
- Consumes: fresh statically accepted target and process-only runtime values.
- Produces: three-repeat baseline counts, causal RED evidence, healer gates/diff, and mutation proof.

- [ ] **Step 1: Run the unchanged three-repeat generated gate**

```bash
CI=1 ALLURE_ENABLED=false node scripts/ai/generated-test-gate.mjs \
  --spec specs/psychicbook-healing-experiment.md \
  --test tests/regression/psychicbook-healing-experiment.spec.ts \
  --mode single --repeat-each 3
```

- [ ] **Step 2: Record exact bytes and apply the one-line RED with `apply_patch`**

```diff
-    this.getStartedLink = page.getByRole('link', { name: 'Get Started' });
+    this.getStartedLink = page.getByRole('link', { name: 'Get Started BROKEN' });
```

Record pre/post SHA-256 and terminal byte; no other line may change.

- [ ] **Step 3: Prove the failure is causal**

```bash
CI=1 ALLURE_ENABLED=false npx playwright test tests/regression/psychicbook-healing-experiment.spec.ts \
  --project=chromium --workers=1 --retries=0 --repeat-each=1
```

Expected: failure at `Get Started BROKEN` before runtime email submission, with the
real `Get Started` control shown only as a bounded safe near-match.

- [ ] **Step 4: Run healer proposal-only**

```bash
AI_BRAIN_TIMEOUT_MS=300000 AI_AUTOHEAL_ENABLED=true AI_RESULT_CACHE_ENABLED=false \
ALLURE_ENABLED=false CI=1 node scripts/ai/heal-test.mjs \
  --test tests/regression/psychicbook-healing-experiment.spec.ts \
  --spec specs/psychicbook-healing-experiment.md \
  --project chromium --max-attempts 3 --verify-runs 2
```

- [ ] **Step 5: Audit candidate exactness before restoration**

Require: the broken target SHA is unchanged, all healer hard checks passed, candidate
verification completed 2/2, diff changes only the broken name, terminal byte is `0a`,
and candidate SHA equals the pre-break SHA.

- [ ] **Step 6: Restore only the accepted locator line with `apply_patch`**

If a framework-owned failure is reproduced, stop this task, invoke
`superpowers:systematic-debugging`, add a focused failing regression, and make only the
root-cause fix before repeating healer verification.

### Task 4: Verify, scrub, and publish rerun-4

**Files:**
- Create: `packages/web/docs/ai-testing/psychicbook-healing-feedback-2026-08-06-rerun-4.md`
- Preserve: exact restored generated target.

**Interfaces:**
- Consumes: all fresh run receipts.
- Produces: a committed secret-free report and clean worktree.

- [ ] **Step 1: Run final static and framework checks**

```bash
node scripts/ai/validate-flow-spec.mjs specs/psychicbook-healing-experiment.md --strict
node scripts/ai/review-generated-test.mjs --spec specs/psychicbook-healing-experiment.md --test tests/regression/psychicbook-healing-experiment.spec.ts --mode single
npm run typecheck
npx eslint tests/regression/psychicbook-healing-experiment.spec.ts data/psychicbook.ts --max-warnings=0
node scripts/ai/check-spec-drift.mjs
npm run ai:test:self
```

- [ ] **Step 2: Run the final three-repeat live gate once**

Use the Task 3 gate command. Report exact passed, failed, skipped, and flaky counts;
never retry merely to obtain GREEN.

- [ ] **Step 3: Write and scrub the report**

Include fresh run IDs, wrapper/mutation distinction, static receipts, baseline counts,
causal RED, healer triage/gates/exactness, final counts, and only reproduced problems.
Exact-scan owned source/audits for runtime values without printing them. Delete every
exact `gate-*`, `test-results`, `playwright-report`, and `allure-results` directory.

- [ ] **Step 4: Commit the report and verify repository integrity**

```bash
git diff --check
git -C /Users/maybebest/Documents/web-api-test-generator status --porcelain=v1 -z | shasum -a 256
git -C /Users/maybebest/Documents/web-api-test-generator status --porcelain=v1 | wc -l
git add packages/web/docs/ai-testing/psychicbook-healing-feedback-2026-08-06-rerun-4.md
git commit -m "test(web): report fourth PsychicBook post-fix rerun"
```

- [ ] **Step 5: Invoke verification-before-completion**

Re-run the full framework self-suite and static checks from the committed tree. Keep
the final live-stage result separate from framework health and leave the branch
unmerged if any required live gate is not green.
