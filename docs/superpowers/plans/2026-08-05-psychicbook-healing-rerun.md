# PsychicBook Generation and Healing Rerun Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the requested PsychicBook Playwright test from a reviewed spec, establish a live baseline, introduce exactly one broken `Get Started` locator, run proposal-only healer with the advisory policy change, restore only an accepted one-line proposal, and publish evidence-based feedback.

**Architecture:** Work only in the isolated `codex/healer-policy-soft-fail` worktree. The Markdown spec is the behavioral contract, the generated test owns an inline Page Object so the healer can repair the single file, runtime credentials enter only through the process environment, and all browser evidence remains ignored/local. The experiment records generator, gate, product, and healer outcomes separately and never turns a failed external run into a claimed success.

**Tech Stack:** Node.js, TypeScript, Playwright Test, repository AI generation/review/gate/healer scripts, Markdown audit report.

## Global Constraints

- Worktree: `/Users/maybebest/Documents/web-api-test-generator/.worktrees/healer-policy-soft-fail`; do not modify the heavily dirty primary checkout.
- Target origin must equal `https://user.stage.psychicbook.net`.
- Runtime-only values: `PLAYWRIGHT_TEST_BASE_URL`, `E2E_HTTP_BASIC_USERNAME`, `E2E_HTTP_BASIC_PASSWORD`, `PSYCHICBOOK_E2E_EMAIL`.
- Never print, persist, commit, or copy HTTP Basic values, the runtime email, cookies, authorization data, request payloads, storage state, raw trace contents, screenshots, or videos into specs, tests, prompts, diffs, or reports.
- The deterministic stage verification code is the reviewed literal `1234`.
- The target is deleted before generation when present. In this isolated worktree it was confirmed absent at planning time.
- Use one Chromium worker, zero retries, and no hard waits.
- The controlled break changes only `Get Started` to `Get Started BROKEN` in the inline Page Object.
- Run healer in proposal-only mode. Do not pass `--apply` or `--allow-dirty`.
- Accept a healer proposal only when its bounded diff restores that one locator and changes nothing else.
- Policy warnings may continue; secret preflight, typecheck, lint, generated review, runtime verification, target integrity, and diff checks remain hard gates.
- Do not commit `.ai-runs`, Playwright reports, `test-results`, credentials, or authentication state.

---

### Task 1: Recreate reviewed inputs in the isolated worktree

**Files:**
- Create: `packages/web/specs/psychicbook-healing-experiment.md`
- Create: `packages/web/data/psychicbook.ts`
- Confirm absent before generation: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`

**Interfaces:**
- Consumes: the approved design at `docs/superpowers/specs/2026-08-05-psychicbook-healing-rerun-design.md`.
- Produces: a strict `pending-generation` flow contract and `requirePsychicBookEmail(): string`.

- [ ] **Step 1: Verify the isolated target is absent and the primary checkout is untouched**

Run read-only checks for all three paths. If the isolated target is present, delete only that exact target with `apply_patch`; do not delete the primary checkout's user-owned copy.

- [ ] **Step 2: Create the runtime-only email helper**

```ts
export function requirePsychicBookEmail(): string {
  const email = process.env.PSYCHICBOOK_E2E_EMAIL?.trim();

  if (!email) {
    throw new Error('Missing required runtime configuration: PSYCHICBOOK_E2E_EMAIL');
  }

  return email;
}
```

- [ ] **Step 3: Materialize the reviewed flow contract**

Create a strict single-mode spec with:

- `Flow ID = FLOW-PSY-HEAL-001`, `Spec Version = 1.0.0`, `Auth = none`;
- `Target Test File = tests/regression/psychicbook-healing-experiment.spec.ts`;
- tags `@generated @regression @psychicbook @healing-experiment`;
- `Generation Status = pending-generation`, `Parallel Safe = no`, `Allowed Retries = 0`;
- one `DC-001` positive returning-user case;
- steps and ACs covering `/`, `Get Started`, runtime email, `Continue`, `Have a verification code instead?`, four digits of `1234`, and final visible account menu button;
- locator hints requiring an inline `PsychicBookHealingExperimentPage`, `page.getByRole('link', { name: 'Get Started' })`, semantic form locators, the approved raw-CSS exception for anonymous digit inputs, and `banner` → exact button `T` for the final control;
- generated requirements requiring the framework fixture, exact tags, serial single test, `test.step`, AC annotation, `requirePsychicBookEmail()`, final-step-only assertion, and no direct test-body locator, XPath, hard wait, skip, focused test, or auth state.

Use the complete already-reviewed contract from the primary checkout only as read-only source material; do not copy its generated target or prior report.

- [ ] **Step 4: Validate the spec while the target is absent**

Run:

```bash
npm run ai:spec:validate -- specs/psychicbook-healing-experiment.md --strict
```

Expected: exit `0`; `pending-generation` is valid because the target is absent.

- [ ] **Step 5: Validate runtime prerequisites without printing values**

Require `npx`, Chromium, all four environment names, and the reviewed URL origin. Print only boolean presence/origin checks. Stop before browser launch if any check fails.

---

### Task 2: Generate the test from scratch and evaluate the candidate

**Files:**
- Create: a timestamped `generation-task.md` below `packages/web/.ai-runs/`
- Create: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Modify: `packages/web/specs/psychicbook-healing-experiment.md` (`pending-generation` → `generated` only after a target exists)

**Interfaces:**
- Consumes: the strict spec and helper from Task 1.
- Produces: a fresh AI-generated target plus static and live gate evidence.

- [ ] **Step 1: Record the selected brain without exposing credentials**

```bash
npm run ai:brain:doctor
```

Record only brain kind/model/source class, never key material.

- [ ] **Step 2: Create a fresh manifest-bound generation task**

```bash
npm run ai:generate-test -- specs/psychicbook-healing-experiment.md --target tests/regression/psychicbook-healing-experiment.spec.ts
```

Capture the new task path. Confirm it binds the expected spec, version, hash, single mode, AC set, and target.

- [ ] **Step 3: Invoke the configured AI brain once with cache reuse disabled where supported**

```bash
PSY_GENERATION_TASK="$(find .ai-runs -type f -name generation-task.md -print0 | xargs -0 ls -t | head -n 1)"
test -n "$PSY_GENERATION_TASK"
AI_RESULT_CACHE_ENABLED=false npm run ai:brain:generate -- "$PSY_GENERATION_TASK" --out tests/regression/psychicbook-healing-experiment.spec.ts
```

Expected: one complete TypeScript file, no previous target reuse. If generation fails, retain the bounded error, allow at most two further fresh provider attempts, and report every attempt separately.

- [ ] **Step 4: Move the spec lifecycle to generated and run static acceptance**

Change only `Generation Status | pending-generation` to `generated`, then run:

```bash
npm run ai:spec:validate -- specs/psychicbook-healing-experiment.md --strict
npm run ai:test:review -- --spec specs/psychicbook-healing-experiment.md --test tests/regression/psychicbook-healing-experiment.spec.ts
npm run typecheck
npx eslint tests/regression/psychicbook-healing-experiment.spec.ts data/psychicbook.ts --max-warnings=0
```

Do not silently add unrelated lint configuration. If the isolated branch lacks a usable ESLint config, record that as framework/environment feedback and preserve the other static results.

- [ ] **Step 5: Run the full live generated-test gate**

With the four runtime variables already present in the process:

```bash
npm run ai:test:gate -- --spec specs/psychicbook-healing-experiment.md --test tests/regression/psychicbook-healing-experiment.spec.ts --repeat-each 3
```

Expected for GREEN: 3 expected, 0 unexpected, 0 skipped, 0 flaky. A registration/API or product failure is retained as external evidence and is not relabeled.

---

### Task 3: Establish the unchanged baseline and controlled RED

**Files:**
- Modify temporarily: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Retain locally: bounded Playwright failure artifacts under ignored paths.

**Interfaces:**
- Consumes: a statically accepted generated target.
- Produces: pre-break digest, baseline result, broken digest, and causal locator-failure evidence.

- [ ] **Step 1: Record the generated source digest and unchanged baseline**

Compute SHA-256 without printing source. If Task 2's full gate did not establish a usable baseline, run once:

```bash
npx playwright test tests/regression/psychicbook-healing-experiment.spec.ts --project=chromium --workers=1 --retries=0 --repeat-each=1
```

Record exact pass/fail category. Do not call a product/environment failure GREEN.

- [ ] **Step 2: Break exactly one locator with `apply_patch`**

```diff
-    this.getStartedLink = page.getByRole('link', { name: 'Get Started' });
+    this.getStartedLink = page.getByRole('link', { name: 'Get Started BROKEN' });
```

Assert a zero-context diff contains exactly those two semantic lines and compute the broken digest.

- [ ] **Step 3: Run the broken target once**

```bash
npx playwright test tests/regression/psychicbook-healing-experiment.spec.ts --project=chromium --workers=1 --retries=0 --repeat-each=1
```

Expected controlled RED: nonzero exit at `PsychicBookHealingExperimentPage.start()` while waiting for `Get Started BROKEN`, before email submission and registration APIs. If it fails elsewhere, do not count it as the controlled RED.

- [ ] **Step 4: Inspect only bounded safe evidence**

Record step name, failure class, missing accessible name, and whether the real `Get Started` near-match was visible. Do not copy raw trace, screenshot, request bodies, headers, cookies, or identity.

---

### Task 4: Run proposal-only healer and evaluate advisory policy behavior

**Files:**
- Create: a fresh timestamped archive below `packages/web/.ai-runs/heal/`
- Keep broken until proposal acceptance: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`

**Interfaces:**
- Consumes: the controlled RED and fixed advisory-policy healer.
- Produces: terminal status, policy code list, candidate/diff when later gates pass, and target-mutation proof.

- [ ] **Step 1: Run healer without apply**

```bash
AI_AUTOHEAL_ENABLED=true AI_RESULT_CACHE_ENABLED=false node scripts/ai/heal-test.mjs \
  --test tests/regression/psychicbook-healing-experiment.spec.ts \
  --spec specs/psychicbook-healing-experiment.md \
  --project chromium \
  --max-attempts 3 \
  --verify-runs 2
```

Expected acceptable statuses: `proposal-ready` or `proposal-ready-with-policy-warnings`. A policy warning alone must not cause `policy-rejected`/`exhausted`; all later hard gates still may reject.

- [ ] **Step 2: Audit the run without exposing raw provider output**

Inspect `heal-summary.json`, warning audits, candidate digest, and candidate diff. Record:

- triage kind and safe reason code;
- attempt count and outcomes;
- normalized policy codes;
- typecheck/lint/review/runtime/integrity/diff results;
- requested and completed verification runs;
- terminal status and process exit;
- target digest before and after proposal-only execution.

- [ ] **Step 3: Accept only an exact one-line restoration**

Require the proposal diff to restore `Get Started BROKEN` to `Get Started` and change no other executable, assertion, metadata, data, or comment. Require archived candidate digest to match the proposed candidate. Reject broader proposals even if runtime passes.

- [ ] **Step 4: Restore through the controller**

Because this experiment is proposal-only, apply the accepted one-line restoration with `apply_patch`. If no acceptable proposal exists, restore the same one line only as authorized cleanup and label it manual cleanup, not healer success.

---

### Task 5: Final verification and feedback report

**Files:**
- Create: `packages/web/docs/ai-testing/psychicbook-healing-feedback-2026-08-05.md`
- Preserve uncommitted experiment inputs/target and ignored runtime artifacts.

**Interfaces:**
- Consumes: generation, baseline, RED, healer, and final gate evidence.
- Produces: restored test plus a secret-free comparison report.

- [ ] **Step 1: Prove only the intentional break was restored**

Compare restored digest to pre-break digest and inspect the exact test diff. They must match byte-for-byte unless a separately documented generator artifact change occurred before the pre-break snapshot.

- [ ] **Step 2: Run fresh static checks**

```bash
npm run ai:test:review -- --spec specs/psychicbook-healing-experiment.md --test tests/regression/psychicbook-healing-experiment.spec.ts
npm run typecheck
npx eslint tests/regression/psychicbook-healing-experiment.spec.ts data/psychicbook.ts --max-warnings=0
npm run ai:spec:drift
```

- [ ] **Step 3: Run the final three-repeat live gate**

```bash
npm run ai:test:gate -- --spec specs/psychicbook-healing-experiment.md --test tests/regression/psychicbook-healing-experiment.spec.ts --repeat-each 3
```

Final GREEN requires exit `0`, three passes, zero failures/skips/retries/flaky outcomes. Report the real result if the stage diverges.

- [ ] **Step 4: Write the comparison report**

Include artifact paths, brain/cache behavior, generation/static/live outcomes, baseline, controlled RED, healer status and policy codes, candidate diff summary, verification counts, proposal-only mutation proof, final gate counts, comparison with the earlier 2026-08-04/2026-08-05 evidence, what worked, and prioritized reproducible framework/product improvements. Exclude all live values and raw browser material.

- [ ] **Step 5: Final repository audit**

Confirm the primary checkout is unchanged by this run, the isolated worktree contains only intended source/report additions, no sensitive runtime artifacts are staged, `git diff --check` passes, and every completion claim is backed by a fresh command output.
