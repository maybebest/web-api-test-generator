# PsychicBook Second Post-Fix Rerun Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete and freshly regenerate the PsychicBook Playwright target, run a causal locator-healing experiment against the real stage, and publish a separate evidence-backed rerun-2 report.

**Architecture:** Work only in the existing linked worktree. Treat generator declaration, filesystem mutation, static acceptance, baseline product behavior, controlled RED, healer proposal, and final gate as independent receipts. Runtime identity remains process-only, and framework code changes require a focused RED regression.

**Tech Stack:** Node.js, TypeScript, Playwright Test, repository AI generator/gate/healer scripts, Git worktree, Markdown audit artifacts.

## Global Constraints

- Worktree: `/Users/maybebest/Documents/web-api-test-generator/.worktrees/healer-policy-soft-fail`.
- Branch: `codex/healer-policy-soft-fail`; primary checkout is read-only.
- Design: `docs/superpowers/specs/2026-08-06-psychicbook-second-post-fix-rerun-design.md`.
- Runtime values stay only in `PLAYWRIGHT_TEST_BASE_URL`, `E2E_HTTP_BASIC_USERNAME`, `E2E_HTTP_BASIC_PASSWORD`, and `PSYCHICBOOK_E2E_EMAIL`.
- Never print or persist runtime values, cookies, authorization data, request bodies, browser media, traces, or raw reports.
- The reviewed verification value is `1234`.
- Controlled RED changes only `Get Started` to `Get Started BROKEN`.
- Healer is proposal-only: no `--apply` and no `--allow-dirty`.
- Chromium uses one worker and zero retries.
- Candidate acceptance requires only the locator repair and unchanged terminal newline.
- Report path: `packages/web/docs/ai-testing/psychicbook-healing-feedback-2026-08-06-rerun-2.md`.
- Do not commit `.ai-runs` or browser artifacts.

---

### Task 1: Verify baseline and reset the generated target

**Files:**
- Modify: `packages/web/specs/psychicbook-healing-experiment.md`
- Delete: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Preserve: `packages/web/data/psychicbook.ts`

**Interfaces:**
- Consumes: committed post-fix framework and reviewed flow spec.
- Produces: clean framework receipt, primary status digest, absent target, and strict pending-generation spec.

- [ ] **Step 1: Verify isolation and record primary status without paths**

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

Expected: 403 self-tests and TypeScript exit `0`.

- [ ] **Step 3: Delete the exact target and change lifecycle**

Use `apply_patch` to delete
`packages/web/tests/regression/psychicbook-healing-experiment.spec.ts` and change:

```diff
-| Generation Status | generated |
+| Generation Status | pending-generation |
```

- [ ] **Step 4: Validate and commit the reset**

```bash
node scripts/ai/validate-flow-spec.mjs specs/psychicbook-healing-experiment.md --strict
git add specs/psychicbook-healing-experiment.md tests/regression/psychicbook-healing-experiment.spec.ts
git commit -m "test(web): reset PsychicBook target for second rerun"
```

### Task 2: Create and evaluate a fresh generation

**Files:**
- Create: newly timestamped `packages/web/.ai-runs/**/generation-task.md` (ignored)
- Create: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Modify: `packages/web/specs/psychicbook-healing-experiment.md`

**Interfaces:**
- Consumes: absent target and strict pending spec.
- Produces: wrapper receipt, mutation receipt, one statically accepted evaluated target, and generated lifecycle.

- [ ] **Step 1: Verify provider and create the task**

```bash
npm run ai:brain:doctor
npm run ai:generate-test -- specs/psychicbook-healing-experiment.md --target tests/regression/psychicbook-healing-experiment.spec.ts
export PSY_SECOND_GENERATION_TASK="$(find .ai-runs -type f -name generation-task.md -print0 | xargs -0 ls -t | head -n 1)"
test -n "$PSY_SECOND_GENERATION_TASK"
test ! -e tests/regression/psychicbook-healing-experiment.spec.ts
```

- [ ] **Step 2: Invoke generator once with cache disabled**

```bash
AI_BRAIN_TIMEOUT_MS=300000 AI_RESULT_CACHE_ENABLED=false npm run ai:brain:generate -- \
  "$PSY_SECOND_GENERATION_TASK" \
  --out tests/regression/psychicbook-healing-experiment.spec.ts
```

Record wrapper exit independently from target existence and SHA-256. A nonzero exit
plus target creation is diagnostic mutation, not generator success.

- [ ] **Step 3: Materialize one safe candidate and return lifecycle to generated**

For a complete side-effect candidate, exact-value scan it, preserve a copy below the
new ignored generation run, delete the unexpected target with `apply_patch`, and add
the same bytes through `apply_patch`. Change:

```diff
-| Generation Status | pending-generation |
+| Generation Status | generated |
```

- [ ] **Step 4: Run static acceptance and commit**

```bash
node scripts/ai/validate-flow-spec.mjs specs/psychicbook-healing-experiment.md --strict
node scripts/ai/review-generated-test.mjs --spec specs/psychicbook-healing-experiment.md --test tests/regression/psychicbook-healing-experiment.spec.ts --mode single
npm run typecheck
npx eslint tests/regression/psychicbook-healing-experiment.spec.ts data/psychicbook.ts --max-warnings=0
git add specs/psychicbook-healing-experiment.md tests/regression/psychicbook-healing-experiment.spec.ts
git commit -m "test(web): regenerate PsychicBook target for second rerun"
```

### Task 3: Run baseline, causal RED, and proposal-only healer

**Files:**
- Temporarily modify: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Create: fresh ignored healer audit.

**Interfaces:**
- Consumes: fresh statically accepted target and process-only runtime values.
- Produces: baseline counts, causal broken digest, healer status/gates/diff, and proposal-only mutation proof.

- [ ] **Step 1: Run unchanged three-repeat baseline**

```bash
CI=1 ALLURE_ENABLED=false node scripts/ai/generated-test-gate.mjs \
  --spec specs/psychicbook-healing-experiment.md \
  --test tests/regression/psychicbook-healing-experiment.spec.ts \
  --mode single --repeat-each 3
```

- [ ] **Step 2: Record pre-break bytes and apply one-line RED**

```bash
shasum -a 256 tests/regression/psychicbook-healing-experiment.spec.ts
tail -c 1 tests/regression/psychicbook-healing-experiment.spec.ts | od -An -t x1
```

Use `apply_patch` for exactly:

```diff
-    this.getStartedLink = page.getByRole('link', { name: 'Get Started' });
+    this.getStartedLink = page.getByRole('link', { name: 'Get Started BROKEN' });
```

- [ ] **Step 3: Prove causal failure**

```bash
CI=1 ALLURE_ENABLED=false npx playwright test tests/regression/psychicbook-healing-experiment.spec.ts \
  --project=chromium --workers=1 --retries=0 --repeat-each=1
```

Expected: timeout at `Get Started BROKEN` before email submission and a visible
near-match `Get Started` in bounded context.

- [ ] **Step 4: Run healer proposal-only**

```bash
AI_BRAIN_TIMEOUT_MS=300000 AI_AUTOHEAL_ENABLED=true AI_RESULT_CACHE_ENABLED=false \
ALLURE_ENABLED=false CI=1 node scripts/ai/heal-test.mjs \
  --test tests/regression/psychicbook-healing-experiment.spec.ts \
  --spec specs/psychicbook-healing-experiment.md \
  --project chromium --max-attempts 3 --verify-runs 2
```

- [ ] **Step 5: Audit exactness and restore through controller**

Require unchanged broken target SHA, all hard checks passed, 2/2 candidate runs, only
the locator-line diff, final byte `0a`, and candidate SHA equal to the pre-break SHA.
Restore only `Get Started BROKEN` to `Get Started` with `apply_patch`.

If a new framework-owned failure occurs, invoke `superpowers:systematic-debugging`,
write a focused failing test, and implement only the root-cause fix before repeating
this task.

### Task 4: Final verification, scrub, and rerun-2 report

**Files:**
- Create: `packages/web/docs/ai-testing/psychicbook-healing-feedback-2026-08-06-rerun-2.md`
- Preserve: exact restored generated target.

**Interfaces:**
- Consumes: generator, baseline, RED, healer, and final-gate receipts.
- Produces: committed secret-free report and clean isolated worktree.

- [ ] **Step 1: Run final static/framework checks**

```bash
node scripts/ai/validate-flow-spec.mjs specs/psychicbook-healing-experiment.md --strict
node scripts/ai/review-generated-test.mjs --spec specs/psychicbook-healing-experiment.md --test tests/regression/psychicbook-healing-experiment.spec.ts --mode single
npm run typecheck
npx eslint tests/regression/psychicbook-healing-experiment.spec.ts data/psychicbook.ts --max-warnings=0
node scripts/ai/check-spec-drift.mjs
npm run ai:test:self
```

- [ ] **Step 2: Run final three-repeat live gate**

```bash
CI=1 ALLURE_ENABLED=false node scripts/ai/generated-test-gate.mjs \
  --spec specs/psychicbook-healing-experiment.md \
  --test tests/regression/psychicbook-healing-experiment.spec.ts \
  --mode single --repeat-each 3
```

Report exact pass/fail/skip counts without retrying to obtain GREEN.

- [ ] **Step 3: Write and scrub the report**

Write the report with fresh run IDs, wrapper/mutation distinction, static results,
baseline counts, causal RED, healer triage/gates/exactness/mutation proof, final counts,
and only reproduced improvements. Scan owned tracked files and retained ignored audits
for the exact runtime password/email values without printing them. Delete every exact
`gate-*`, `test-results`, `playwright-report`, and `allure-results` directory.

- [ ] **Step 4: Verify integrity and commit**

```bash
git diff --check
git status --short
git -C /Users/maybebest/Documents/web-api-test-generator status --porcelain=v1 -z | shasum -a 256
git -C /Users/maybebest/Documents/web-api-test-generator status --porcelain=v1 | wc -l
git add packages/web/docs/ai-testing/psychicbook-healing-feedback-2026-08-06-rerun-2.md
git commit -m "test(web): report second PsychicBook post-fix rerun"
```

- [ ] **Step 5: Verify before completion**

Invoke `superpowers:verification-before-completion`, rerun the full framework suite
and static checks from the committed tree, and keep the live gate result separate from
framework health.
