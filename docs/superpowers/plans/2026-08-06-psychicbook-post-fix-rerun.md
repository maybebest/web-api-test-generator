# PsychicBook Post-Fix Generation and Healing Rerun Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete and freshly regenerate the PsychicBook Playwright target on the current post-fix framework, run a real live baseline, introduce one causal locator failure, evaluate proposal-only healer behavior, and publish evidence-backed feedback without inventing defects.

**Architecture:** Execute only in the existing `codex/healer-policy-soft-fail` linked worktree. The Markdown flow spec is the immutable behavioral contract except for its generation lifecycle field; runtime identity stays in a long-lived process environment; generator, static gate, product journey, controlled RED, healer, and final gate outcomes are recorded separately. A newly observed framework failure is fixed only after a focused RED regression test identifies the exact code boundary.

**Tech Stack:** Node.js, TypeScript, Playwright Test, repository AI generation/review/gate/healer scripts, Git worktree, Markdown audit artifacts.

## Global Constraints

- Worktree: `/Users/maybebest/Documents/web-api-test-generator/.worktrees/healer-policy-soft-fail`.
- Branch: `codex/healer-policy-soft-fail`; primary checkout is read-only.
- Design: `docs/superpowers/specs/2026-08-06-psychicbook-post-fix-rerun-design.md`.
- Target origin must equal the reviewed PsychicBook stage origin.
- Runtime-only variables: `PLAYWRIGHT_TEST_BASE_URL`, `E2E_HTTP_BASIC_USERNAME`, `E2E_HTTP_BASIC_PASSWORD`, `PSYCHICBOOK_E2E_EMAIL`.
- Never print or persist runtime values, authorization material, cookies, request bodies, storage state, screenshots, videos, traces, or raw browser reports.
- The reviewed deterministic verification value is `1234`.
- Delete the existing target before creating the fresh generation task.
- Use Chromium, one worker, and zero retries for controlled runs.
- Controlled RED changes only `Get Started` to `Get Started BROKEN`.
- Healer remains proposal-only: no `--apply` and no `--allow-dirty`.
- Accept only a candidate whose bytes differ solely at the intentional locator line; EOF newline removal is not acceptable.
- Policy warnings are advisory, but source safety, typecheck, lint, generated review, runtime verification, integrity, and diff checks remain hard gates.
- Do not commit `.ai-runs`, browser reports, `test-results`, runtime configuration, or authentication state.
- When a new framework failure is reproduced, stop at a safe target state, invoke `superpowers:systematic-debugging`, name the actual implementation/test files from the failing stack, and use `superpowers:test-driven-development` before editing production code.

---

### Task 1: Establish a clean post-fix baseline and reset generation inputs

**Files:**
- Modify: `packages/web/specs/psychicbook-healing-experiment.md`
- Delete: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Preserve: `packages/web/data/psychicbook.ts`

**Interfaces:**
- Consumes: the committed post-fix framework and approved 2026-08-06 design.
- Produces: clean framework evidence, primary-checkout status digest, absent target, and strict `pending-generation` spec.

- [ ] **Step 1: Verify linked-worktree isolation and clean branch state**

Run:

```bash
git rev-parse --git-dir
git rev-parse --git-common-dir
git branch --show-current
git status --short
```

Expected: linked worktree, branch `codex/healer-policy-soft-fail`, no source changes.

- [ ] **Step 2: Capture read-only primary-checkout status evidence**

Run a null-delimited status count and SHA-256 digest without printing dirty paths:

```bash
git -C /Users/maybebest/Documents/web-api-test-generator status --porcelain=v1 -z | shasum -a 256
git -C /Users/maybebest/Documents/web-api-test-generator status --porcelain=v1 | wc -l
```

Record count and digest for the final unchanged-state comparison.

- [ ] **Step 3: Verify the current framework baseline**

Run:

```bash
cd packages/web
npm run ai:test:self
npm run typecheck
```

Expected: full framework self-suite and TypeScript exit `0`. A failure here predates the fresh experiment and must be classified before proceeding.

- [ ] **Step 4: Delete only the isolated target**

Use `apply_patch` to delete:

`packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`

Confirm the primary checkout copy, if any, was not changed.

- [ ] **Step 5: Move the spec lifecycle to pending generation**

Use `apply_patch` for exactly:

```diff
-| Generation Status | generated |
+| Generation Status | pending-generation |
```

- [ ] **Step 6: Validate the absent-target contract**

Run from `packages/web`:

```bash
node scripts/ai/validate-flow-spec.mjs specs/psychicbook-healing-experiment.md --strict
```

Expected: exit `0`; target absent and pending lifecycle consistent.

- [ ] **Step 7: Verify runtime prerequisites without values**

Require `npx`, installed Chromium, presence of all four runtime variable names, and exact reviewed URL origin. Emit only booleans and the parsed origin. Stop before browser launch on any mismatch.

- [ ] **Step 8: Commit the lifecycle reset**

```bash
git add packages/web/specs/psychicbook-healing-experiment.md packages/web/tests/regression/psychicbook-healing-experiment.spec.ts
git commit -m "test(web): reset PsychicBook target for fresh generation"
```

---

### Task 2: Create and execute a fresh manifest-bound generation run

**Files:**
- Create: the newly timestamped `packages/web/.ai-runs/**/generation-task.md` (ignored)
- Create: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Modify: `packages/web/specs/psychicbook-healing-experiment.md`

**Interfaces:**
- Consumes: strict pending spec and runtime helper.
- Produces: declared generator result, mutation evidence, fresh target or safely classified diagnostic candidate, and static acceptance evidence.

- [ ] **Step 1: Verify the selected AI brain**

```bash
npm run ai:brain:doctor
```

Record only brain kind, executable source class, and availability; never key material.

- [ ] **Step 2: Create a fresh generation task**

```bash
npm run ai:generate-test -- specs/psychicbook-healing-experiment.md --target tests/regression/psychicbook-healing-experiment.spec.ts
```

Record the newly created task path and verify its target, single mode, spec version, AC list, and spec digest.

Resolve that exact new task into the current shell without guessing a run directory:

```bash
export PSY_FRESH_GENERATION_TASK="$(find .ai-runs -type f -name generation-task.md -print0 | xargs -0 ls -t | head -n 1)"
test -n "$PSY_FRESH_GENERATION_TASK"
```

- [ ] **Step 3: Snapshot target absence immediately before provider invocation**

```bash
test ! -e tests/regression/psychicbook-healing-experiment.spec.ts
```

- [ ] **Step 4: Invoke the brain with cache reuse disabled**

Run the exact fresh task with a five-minute provider budget:

```bash
AI_BRAIN_TIMEOUT_MS=300000 AI_RESULT_CACHE_ENABLED=false npm run ai:brain:generate -- \
  "$PSY_FRESH_GENERATION_TASK" \
  --out tests/regression/psychicbook-healing-experiment.spec.ts
```

Capture exit status and bounded stdout/stderr. Independently record whether the target now exists and its SHA-256.

- [ ] **Step 5: Enforce the generator output/mutation contract**

Classify one of these exact outcomes:

- wrapper exit `0` plus target present: declared generation candidate;
- wrapper nonzero plus target absent: clean generation failure;
- wrapper nonzero plus target present: unexpected workspace mutation and diagnostic candidate only.

For unexpected mutation, preserve a source copy under the fresh ignored run, delete the target with `apply_patch`, and do not call the generator successful. Retry only when the failure mode differs or the first attempt timed out before a complete response; stop after the second identical output-contract failure.

- [ ] **Step 6: Materialize one statically reviewable target**

Use the declared candidate when generation succeeds. When only a complete diagnostic candidate exists, materialize those exact bytes back at the target solely for static/live/healer evaluation and record the deviation in the report.

- [ ] **Step 7: Move lifecycle back to generated**

Use `apply_patch` for exactly:

```diff
-| Generation Status | pending-generation |
+| Generation Status | generated |
```

- [ ] **Step 8: Run static acceptance**

```bash
node scripts/ai/validate-flow-spec.mjs specs/psychicbook-healing-experiment.md --strict
node scripts/ai/review-generated-test.mjs \
  --spec specs/psychicbook-healing-experiment.md \
  --test tests/regression/psychicbook-healing-experiment.spec.ts \
  --mode single
npm run typecheck
npx eslint tests/regression/psychicbook-healing-experiment.spec.ts data/psychicbook.ts --max-warnings=0
```

Expected: hard checks exit `0`; reviewer warnings are recorded separately.

- [ ] **Step 9: Commit the fresh target and lifecycle**

```bash
git add packages/web/specs/psychicbook-healing-experiment.md \
  packages/web/tests/regression/psychicbook-healing-experiment.spec.ts
git commit -m "test(web): regenerate PsychicBook healing target"
```

---

### Task 3: Establish current live behavior and causal controlled RED

**Files:**
- Temporarily modify: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Create: ignored Playwright artifacts, deleted after safe classification.

**Interfaces:**
- Consumes: fresh statically accepted target and process-only runtime values.
- Produces: pre-break digest, baseline counts, broken digest, and early locator-failure evidence.

- [ ] **Step 1: Run the unchanged three-repeat generated gate**

```bash
CI=1 node scripts/ai/generated-test-gate.mjs \
  --spec specs/psychicbook-healing-experiment.md \
  --test tests/regression/psychicbook-healing-experiment.spec.ts \
  --mode single \
  --repeat-each 3
```

Record actual pass/fail/skip/flaky counts and safe UI/product evidence. Do not call a partial pass GREEN.

- [ ] **Step 2: Record exact pre-break target digest and newline state**

```bash
shasum -a 256 tests/regression/psychicbook-healing-experiment.spec.ts
tail -c 1 tests/regression/psychicbook-healing-experiment.spec.ts | od -An -t x1
```

- [ ] **Step 3: Apply exactly one locator break**

Use `apply_patch` for:

```diff
-    this.getStartedLink = page.getByRole('link', { name: 'Get Started' });
+    this.getStartedLink = page.getByRole('link', { name: 'Get Started BROKEN' });
```

Verify a zero-context diff and compute the broken digest.

- [ ] **Step 4: Run the broken target once**

```bash
npx playwright test tests/regression/psychicbook-healing-experiment.spec.ts \
  --project=chromium --workers=1 --retries=0 --repeat-each=1
```

Expected: timeout at the broken accessible name before email submission. If the earliest failure differs, restore the line and do not continue to healer until a valid controlled RED exists.

- [ ] **Step 5: Extract bounded safe RED evidence and delete browser media**

Retain only step name, action class, missing accessible name, near-match presence, and timing. Delete the exact `test-results`/report directories after recording safe facts.

---

### Task 4: Run proposal-only healer and audit exactness

**Files:**
- Create: the newly timestamped `packages/web/.ai-runs/heal/**/` directory (ignored)
- Keep broken during evaluation: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`

**Interfaces:**
- Consumes: causal controlled RED.
- Produces: healer terminal status, safe attempt trail, candidate diff/digest when available, verification count, and mutation proof.

- [ ] **Step 1: Snapshot the broken target digest**

Record SHA-256 immediately before healer.

- [ ] **Step 2: Run healer without apply**

```bash
AI_BRAIN_TIMEOUT_MS=300000 \
AI_AUTOHEAL_ENABLED=true \
AI_RESULT_CACHE_ENABLED=false \
node scripts/ai/heal-test.mjs \
  --test tests/regression/psychicbook-healing-experiment.spec.ts \
  --spec specs/psychicbook-healing-experiment.md \
  --project chromium \
  --max-attempts 3 \
  --verify-runs 2
```

- [ ] **Step 3: Prove proposal-only mutation safety**

Recompute target SHA-256. It must equal the pre-healer broken digest regardless of healer status.

- [ ] **Step 4: Audit only safe healer artifacts**

Read `heal-summary.json`, policy-warning audit names, provider kind, attempt trail, candidate digest, and bounded diff. Do not output raw evidence, provider prompt, browser media, or runtime values.

- [ ] **Step 5: Evaluate exact candidate acceptance**

Accept only when:

- terminal status is `proposal-ready` or `proposal-ready-with-policy-warnings`;
- source safety, typecheck, lint, review, runtime, integrity, and diff checks passed;
- two consecutive candidate runs completed successfully;
- diff changes only `Get Started BROKEN` to `Get Started`;
- candidate retains the final newline and changes no other byte.

- [ ] **Step 6: Restore the target through the controller**

Use `apply_patch` to restore the single locator line. If Step 5 passed, label it accepted-proposal restoration. Otherwise label it authorized manual cleanup. Verify the restored digest equals the pre-break digest.

- [ ] **Step 7: Handle a newly reproduced framework defect**

If healer fails before its intended gate for a framework-owned reason, preserve the broken target and safe audit path, invoke `superpowers:systematic-debugging`, reproduce with a focused local fixture, then create a scoped test-first fix commit before rerunning Task 4. Do not change framework code for external registration, auth/data, or stage availability failures.

---

### Task 5: Final verification and 2026-08-06 feedback

**Files:**
- Create: `packages/web/docs/ai-testing/psychicbook-healing-feedback-2026-08-06.md`
- Preserve: exact restored generated target and all committed framework changes.

**Interfaces:**
- Consumes: fresh generator, baseline, RED, healer, and final-gate evidence.
- Produces: secret-free report, clean intended commits, and explicit remaining-risk assessment.

- [ ] **Step 1: Run fresh static and framework verification**

```bash
node scripts/ai/validate-flow-spec.mjs specs/psychicbook-healing-experiment.md --strict
node scripts/ai/review-generated-test.mjs \
  --spec specs/psychicbook-healing-experiment.md \
  --test tests/regression/psychicbook-healing-experiment.spec.ts \
  --mode single
npm run typecheck
npx eslint tests/regression/psychicbook-healing-experiment.spec.ts data/psychicbook.ts --max-warnings=0
node scripts/ai/check-spec-drift.mjs
npm run ai:test:self
```

- [ ] **Step 2: Run the final full live gate**

```bash
CI=1 node scripts/ai/generated-test-gate.mjs \
  --spec specs/psychicbook-healing-experiment.md \
  --test tests/regression/psychicbook-healing-experiment.spec.ts \
  --mode single \
  --repeat-each 3
```

Report exact counts. A failure remains a failure even if healer verification passed earlier.

- [ ] **Step 3: Write the new feedback report**

Include fresh run IDs, declared generator outcome versus filesystem mutation, static results, baseline counts, causal RED, healer triage/status/gates/diff exactness/mutation proof, final counts, comparison with 2026-08-05, reproduced and not-reproduced risks, and prioritized actions only where evidence supports them.

- [ ] **Step 4: Scrub sensitive runtime artifacts**

Check tracked source/report files and retained ignored generation/healer archives for exact runtime password/email values without printing them. Delete all exact browser gate, `test-results`, and report directories that may contain runtime identity.

- [ ] **Step 5: Verify repository integrity**

```bash
git diff --check
git status --short
git -C /Users/maybebest/Documents/web-api-test-generator status --porcelain=v1 -z | shasum -a 256
git -C /Users/maybebest/Documents/web-api-test-generator status --porcelain=v1 | wc -l
```

Primary count/digest must equal Task 1. Only intended isolated-worktree files may remain.

- [ ] **Step 6: Commit the report and final experiment state**

```bash
git add packages/web/docs/ai-testing/psychicbook-healing-feedback-2026-08-06.md \
  packages/web/tests/regression/psychicbook-healing-experiment.spec.ts \
  packages/web/specs/psychicbook-healing-experiment.md
git commit -m "test(web): report PsychicBook post-fix healer rerun"
```

- [ ] **Step 7: Apply verification-before-completion**

Invoke `superpowers:verification-before-completion`, rerun the complete self-suite and static checks from the final committed tree, and report the live gate separately from framework health.
