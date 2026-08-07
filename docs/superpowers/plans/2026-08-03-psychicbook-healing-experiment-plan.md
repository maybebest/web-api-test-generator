# PsychicBook Generated-Test Healing Experiment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate, execute, deliberately break, heal, and re-verify one isolated PsychicBook Playwright test through the repository's real generation and proposal-only healing workflow.

**Architecture:** A new spec owns one untracked single-mode generated target whose Page Object is inline so the single-file healer can repair a locator. Live identity and HTTP Basic values enter only through process environment variables; generation and healer audit artifacts remain under `packages/web/.ai-runs/`. The healer creates and verifies a proposal without mutating the broken test; the controller promotes only an exact, reviewed locator-only candidate.

**Tech Stack:** Node.js, TypeScript, Playwright Test, repository AI generation scripts, repository safe test healer.

## Global Constraints

- Target only `https://user.stage.psychicbook.net/`; production execution is forbidden.
- Keep HTTP Basic credentials and the returning-user email out of specs, generated source, prompts, Git history, and the final public summary.
- Use the deterministic verification value `1234` from the requested stage contract.
- Do not modify `specs/psychicbook-account-menu.md`, `tests/regression/psychicbook-account-menu.spec.ts`, `pages/PsychicBookLoginPage.ts`, or `data/psychicbook.ts`.
- Do not invoke healer `--apply` or `--allow-dirty`; the known promotion race remains out of scope.
- Accept healing only for the deliberate Get Started accessible-name locator drift; reject any assertion, step, data, metadata, retry, or runtime-configuration change.
- Leave experiment artifacts uncommitted for inspection.

---

### Task 1: Create the isolated generated-test contract

**Files:**
- Create: `packages/web/specs/psychicbook-healing-experiment.md`
- Create through the generator: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`

**Interfaces:**
- Consumes: runtime variables `PLAYWRIGHT_TEST_BASE_URL`, `E2E_HTTP_BASIC_USERNAME`, `E2E_HTTP_BASIC_PASSWORD`, and `PSYCHICBOOK_E2E_EMAIL`.
- Produces: a valid single-mode flow spec targeting `tests/regression/psychicbook-healing-experiment.spec.ts` and one manifest-bound generation run.

- [ ] **Step 1: Write the isolated flow spec from `specs/_template.md`**

  Define `FLOW-PSY-HEAL-001`, version `1.0.0`, `Auth | none`, `Generation Mode | single`, `Generation Status | pending-generation`, exact tags `@generated @regression @psychicbook @healing-experiment`, and AC-001 through AC-004 for landing, email/code authentication, and the visible account-settings control.

- [ ] **Step 2: Validate the spec before generation**

  Run: `npm run ai:spec:validate -- specs/psychicbook-healing-experiment.md`

  Expected: the validator accepts exactly one spec with no unresolved marker or policy error.

- [ ] **Step 3: Create the deterministic generation task**

  Run: `npm run ai:generate-test -- specs/psychicbook-healing-experiment.md`

  Expected: a new manifest-bound task below `.ai-runs/` names the isolated target and contains no live credential or email value.

- [ ] **Step 4: Generate the Playwright source through the configured AI brain**

  Use the exact `generation-task.md` path emitted by Step 3 as the positional argument to `npm run ai:brain:generate --`, followed by `--out tests/regression/psychicbook-healing-experiment.spec.ts`.

  Expected source shape: one primary test, all locators inside an inline `PsychicBookHealingExperimentPage`, runtime email access through the reviewed `requirePsychicBookEmail()` helper, verification code `1234`, and only the final account-settings visibility assertion.

- [ ] **Step 5: Mark the now-implemented isolated spec as generated and restamp the binding if required**

  Change only `Generation Status | pending-generation` to `Generation Status | generated`, then use `npm run ai:spec:stamp -- --spec specs/psychicbook-healing-experiment.md --test tests/regression/psychicbook-healing-experiment.spec.ts` if the generator did not already bind the final spec hash.

- [ ] **Step 6: Review generated source and secret boundaries**

  Run: `npm run ai:test:review -- --spec specs/psychicbook-healing-experiment.md --test tests/regression/psychicbook-healing-experiment.spec.ts`

  Run: `npm run typecheck`

  Run: `npx eslint tests/regression/psychicbook-healing-experiment.spec.ts --max-warnings=0`

  Expected: all commands exit 0, and a literal scan finds none of the live HTTP Basic or email values in the new spec, test, or generation run.

### Task 2: Establish the live GREEN baseline

**Files:**
- Verify: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Inspect: `packages/web/.ai-runs/` generated-gate artifacts

**Interfaces:**
- Consumes: the generated target and process-only stage configuration.
- Produces: a fresh gate report with at least one pass and zero failed, skipped, or flaky tests.

- [ ] **Step 1: Run the isolated full generated-test gate with retries disabled by contract**

  Run the gate with the four runtime variables present only in the command environment:

  `npm run ai:test:gate -- --spec specs/psychicbook-healing-experiment.md --test tests/regression/psychicbook-healing-experiment.spec.ts`

  Expected: three consecutive Chromium executions pass and the final assertion sees the account-settings control.

- [ ] **Step 2: Inspect the JSON verdict and preserve the generated source digest**

  Confirm the report counts are `passed >= 1`, `failed = 0`, `skipped = 0`, and `flaky = 0`; calculate SHA-256 for the generated target before deliberate breakage.

### Task 3: Create and classify one controlled RED

**Files:**
- Modify: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`

**Interfaces:**
- Consumes: the baseline-green inline Page Object.
- Produces: one locator-only source diff and a runtime failure classified as `locator-drift`.

- [ ] **Step 1: Break exactly the Get Started accessible-name locator**

  Replace only the inline Page Object expression `getByRole('link', { name: 'Get Started' })` with `getByRole('link', { name: 'Get Started BROKEN' })`; do not alter actions, assertions, steps, metadata, or data.

- [ ] **Step 2: Prove the isolated target is RED**

  Run: `npx playwright test tests/regression/psychicbook-healing-experiment.spec.ts --project=chromium --workers=1 --retries=0 --repeat-each=1`

  Expected: non-zero exit at the broken Get Started locator, with no HTTP Basic, network, email, code, or assertion failure.

- [ ] **Step 3: Verify the controlled diff**

  Compare the broken source to the saved baseline and confirm the only semantic change is the accessible-name string.

### Task 4: Produce and promote a verified healer proposal

**Files:**
- Inspect: `packages/web/.ai-runs/heal/<run-id>/`
- Modify after review: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`

**Interfaces:**
- Consumes: the controlled locator-drift failure.
- Produces: `proposal-ready`, an archived verified candidate, and an exact locator-only promotion.

- [ ] **Step 1: Run the healer in proposal-only mode**

  Run with `AI_AUTOHEAL_ENABLED=true` and the same process-only stage variables:

  `npm run ai:test:heal -- --test tests/regression/psychicbook-healing-experiment.spec.ts --spec specs/psychicbook-healing-experiment.md --project chromium --max-attempts 3 --verify-runs 2`

  Expected: baseline failure classified as `locator-drift`; final status `proposal-ready`; broken target digest unchanged.

- [ ] **Step 2: Audit the archived candidate**

  Verify the candidate SHA-256 against `heal-summary.json`, inspect the attempt audit, and reject the candidate unless its exact diff only restores a matching Get Started locator.

- [ ] **Step 3: Promote the verified candidate without healer `--apply`**

  Use the controller's file edit operation to replace only the broken locator expression with the archived candidate expression. Recalculate the target digest and retain the before/broken/healed comparison.

### Task 5: Run fresh final verification

**Files:**
- Verify: `packages/web/specs/psychicbook-healing-experiment.md`
- Verify: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Inspect: generation and healer run directories below `packages/web/.ai-runs/`

**Interfaces:**
- Consumes: the promoted healed target.
- Produces: static, type, lint, drift, and live runtime evidence for the final handoff.

- [ ] **Step 1: Re-run static checks on the actual target**

  Run: `npm run ai:test:review -- --spec specs/psychicbook-healing-experiment.md --test tests/regression/psychicbook-healing-experiment.spec.ts`

  Run: `npm run typecheck`

  Run: `npx eslint tests/regression/psychicbook-healing-experiment.spec.ts --max-warnings=0`

  Run: `npm run ai:spec:drift`

  Expected: all commands exit 0.

- [ ] **Step 2: Re-run the full live generated-test gate**

  Run with the same process-only stage variables:

  `npm run ai:test:gate -- --spec specs/psychicbook-healing-experiment.md --test tests/regression/psychicbook-healing-experiment.spec.ts`

  Expected: fresh report with at least one pass and zero failed, skipped, or flaky results.

- [ ] **Step 3: Check isolation and prepare the evidence summary**

  Confirm the four pre-existing PsychicBook files and unrelated dirty-worktree files have not changed during the experiment. Report the new spec/test paths, generation run, healer archive, initial GREEN, controlled RED classification, proposal status and locator-only diff, final GREEN, and the deliberate omission of healer `--apply`.
