# PsychicBook Account Menu Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the archived PsychicBook note with a strict flow spec and generate one Playwright test that signs in through email verification and verifies the account-settings control in the top navigation, while recording the exact AI token telemetry for this generation.

**Architecture:** The Markdown spec is the behavioral contract, `PsychicBookLoginPage` owns all staging locators and actions, and the AI generator produces only the spec-bound Playwright test. Basic-auth credentials and email remain runtime environment variables; the user-confirmed non-secret deterministic verification code is committed as test data. Because the required live account data is not configured locally, generation uses the validated task plus the explicit draft-only AI path, followed by static review rather than making a false live-execution claim.

**Tech Stack:** TypeScript 5.9, Playwright Test 1.59, Node.js AI generation scripts, Codex CLI generation brain.

## Global Constraints

- Delete only `packages/web/docs/ai-testing/psychicbook-find-your-match-flow.md`; preserve all unrelated dirty-tree changes.
- Use `PLAYWRIGHT_TEST_BASE_URL`, `E2E_HTTP_BASIC_USERNAME`, `E2E_HTTP_BASIC_PASSWORD`, and `PSYCHICBOOK_E2E_EMAIL` at runtime; never commit their values or modify `.env`. Use the deterministic verification code `1234` directly as user-approved non-secret test data.
- Generate exactly one primary test in `single` mode and assert the account-settings control only in the final assertion step.
- Disable exact-result caching for this invocation so telemetry represents a new provider/CLI call.
- Do not run the live staging flow while its email and Basic Auth environment are absent.
- Run strict spec validation, target static review, drift validation, and TypeScript type checking after generation.

---

### Task 1: Replace the archived note with a strict spec

**Files:**
- Delete: `packages/web/docs/ai-testing/psychicbook-find-your-match-flow.md`
- Create: `packages/web/specs/psychicbook-account-menu.md`

**Interfaces:**
- Consumes: the user's eight-step journey and the repository's `specs/_template.md` contract.
- Produces: `FLOW-PSY-001`, targeting `tests/regression/psychicbook-account-menu.spec.ts` in single mode with `Auth | none`.

- [ ] **Step 1: Remove the archived design note**

Delete only `packages/web/docs/ai-testing/psychicbook-find-your-match-flow.md`.

- [ ] **Step 2: Write the strict flow contract**

Create `packages/web/specs/psychicbook-account-menu.md` with all required template sections, these acceptance criteria, and no `NEEDS_REVIEW` markers:

```text
AC-001 Open the PsychicBook landing page through environment-provided HTTP Basic authentication.
AC-002 Get Started opens email entry and Continue accepts PSYCHICBOOK_E2E_EMAIL.
AC-003 The user switches to verification-code entry and submits 1234.
AC-004 The authenticated top menu exposes a visible account-settings control.
```

Set `Generation Status | pending-generation`, `Data Isolation | external`, `Parallel Safe | no`, `Allowed Retries | 0`, and `Mocks as JSON` to `[]`.

- [ ] **Step 3: Verify strict validation**

Run:

```bash
cd packages/web
npm run ai:spec:validate -- specs/psychicbook-account-menu.md --strict
```

Expected: one valid spec and no unresolved placeholders; a missing target is permitted because status is `pending-generation`.

### Task 2: Add the locator-owning Page Object

**Files:**
- Create: `packages/web/pages/PsychicBookLoginPage.ts`

**Interfaces:**
- Consumes: a Playwright `Page` and caller-provided email/code strings.
- Produces: `gotoLanding()`, `start()`, `submitEmail(email)`, `chooseVerificationCode()`, `submitVerificationCode(code)`, and `accountSettingsControl()`.

- [ ] **Step 1: Add the minimal Page Object**

Use semantic locators for Get Started, Email, Continue, the verification-code alternative, and Account settings. Keep the documented CSS fallback restricted to the four anonymous one-character numeric inputs, with a locator-policy exception comment.

- [ ] **Step 2: Verify compilation before generation**

Run:

```bash
cd packages/web
npm run typecheck
```

Expected: TypeScript exits successfully.

### Task 3: Generate the test and capture isolated token usage

**Files:**
- Create: `packages/web/tests/regression/psychicbook-account-menu.spec.ts`
- Modify: `packages/web/specs/psychicbook-account-menu.md` (`Generation Status` only)
- Generated telemetry: `packages/web/.ai-runs/<new-flow-run>/manifest.json`

**Interfaces:**
- Consumes: the validated spec and `PsychicBookLoginPage` public methods.
- Produces: one spec-hash-bound generated test plus a token report scoped to its new task run.

- [ ] **Step 1: Build a fresh bounded generation task**

Run:

```bash
cd packages/web
npm run ai:generate-test -- specs/psychicbook-account-menu.md
```

Record the printed new task directory and use its `generation-task.md`; do not reuse an earlier task.

- [ ] **Step 2: Make one uncached AI generation call**

Run with `AI_RESULT_CACHE=false` and the raw path's mandatory `--draft-only` flag:

```bash
cd packages/web
AI_RESULT_CACHE=false npm run ai:brain:generate:raw -- \
  .ai-runs/<new-flow-run>/generation-task.md \
  --out tests/regression/psychicbook-account-menu.spec.ts \
  --draft-only
```

Expected: the selected brain writes a plausible TypeScript candidate and updates only the new task manifest's generation telemetry.

- [ ] **Step 3: Mark the now-present target as generated**

Change only the metadata row to `Generation Status | generated`, then rebuild the task if the behavioral spec hash changes (metadata-only status does not change the behavioral hash).

- [ ] **Step 4: Extract exact per-call usage**

Read the new task's `manifest.json` and run:

```bash
cd packages/web
npm run ai:tokens:report -- --dir .ai-runs/<new-flow-run> --json
```

Report input, cached input, cache writes, uncached input, output, reasoning, total tokens, latency, provider/model, and whether any field is unknown. Do not aggregate older runs.

- [ ] **Step 5: Run non-live acceptance checks**

Run:

```bash
cd packages/web
npm run ai:spec:validate -- specs/psychicbook-account-menu.md --strict
npm run ai:test:review -- --spec specs/psychicbook-account-menu.md --test tests/regression/psychicbook-account-menu.spec.ts
npm run ai:spec:drift
npm run typecheck
```

Expected: all four commands exit successfully. Do not claim browser execution; the live staging gate remains for a later run after the user configures the required runtime environment.
