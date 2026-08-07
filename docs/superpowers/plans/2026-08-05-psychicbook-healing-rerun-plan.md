# PsychicBook Generation and Healing Rerun Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete and freshly regenerate the PsychicBook Playwright test through the repository framework, prove a controlled `Get Started BROKEN` failure, evaluate proposal-only healing, restore the target, and publish reproducible feedback.

**Architecture:** The existing Markdown flow remains the behavioral contract while the generated test is removed and recreated through a fresh manifest-bound, cache-disabled generation run. Runtime identity and HTTP Basic values exist only in the execution environment. Generation, controlled RED, healer, and final three-repeat gate evidence remain under `packages/web/.ai-runs/`; a new report compares the rerun with the earlier experiment without modifying framework implementation.

**Tech Stack:** Node.js 20+, TypeScript 5.9, Playwright Test 1.59, repository AI generation scripts, repository safe test healer, Markdown evidence report.

## Global Constraints

- Target only `https://user.stage.psychicbook.net/`; production execution is forbidden.
- Keep the HTTP Basic values and returning-user email out of specs, generated source, generation inputs, Git history, terminal summaries, and the feedback report.
- Supply live values only through `PLAYWRIGHT_TEST_BASE_URL`, `E2E_HTTP_BASIC_USERNAME`, `E2E_HTTP_BASIC_PASSWORD`, and `PSYCHICBOOK_E2E_EMAIL` in one dedicated execution shell.
- Use verification code `1234` as the reviewed deterministic stage contract.
- Preserve earlier reports and `.ai-runs` evidence, plus all unrelated dirty-worktree changes.
- Do not invoke healer `--apply` or `--allow-dirty`.
- Accept a healing proposal only when it restores `Get Started BROKEN` to `Get Started` and changes nothing else.
- Do not implement framework fixes during this experiment.
- Do not commit specs, generated tests, reports, `.ai-runs`, traces, screenshots, videos, or authentication state produced by the experiment.
- Report the observed outcome exactly. A product, data, authentication, network, or environment failure is not GREEN.

---

### Task 1: Establish the rerun boundary and remove the old target

**Files:**
- Modify: `packages/web/specs/psychicbook-healing-experiment.md`
- Delete before regeneration: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Preserve: `packages/web/docs/ai-testing/psychicbook-healing-feedback-2026-08-04.md`
- Preserve: `packages/web/.ai-runs/`

**Interfaces:**
- Consumes: approved design `docs/superpowers/specs/2026-08-05-psychicbook-healing-rerun-design.md` and the existing `FLOW-PSY-HEAL-001` contract.
- Produces: a valid `pending-generation` flow contract with no existing target and recorded pre-rerun fingerprints.

- [ ] **Step 1: Capture the starting state without exposing runtime values**

  Run from the repository root:

  ```bash
  git status --short -- packages/web/specs/psychicbook-healing-experiment.md packages/web/tests/regression/psychicbook-healing-experiment.spec.ts packages/web/docs/ai-testing/psychicbook-healing-feedback-2026-08-04.md
  shasum -a 256 packages/web/specs/psychicbook-healing-experiment.md packages/web/tests/regression/psychicbook-healing-experiment.spec.ts
  ```

  Expected: the spec and test are both present and untracked; the earlier feedback report remains unchanged. Record both SHA-256 values in working notes without copying file contents or live values.

- [ ] **Step 2: Remove the existing generated target and open the generation lifecycle**

  Use `apply_patch` to delete `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`. In the flow spec, replace exactly:

  ```markdown
  | Generation Status | generated |
  ```

  with:

  ```markdown
  | Generation Status | pending-generation |
  ```

  Do not alter metadata, flow steps, locator hints, business rules, data cases, or acceptance criteria.

- [ ] **Step 3: Prove the regeneration precondition**

  Run from `packages/web`:

  ```bash
  test ! -e tests/regression/psychicbook-healing-experiment.spec.ts
  npm run ai:spec:validate -- specs/psychicbook-healing-experiment.md
  ```

  Expected: the target is absent and the spec validator exits 0 with `Generation Status = pending-generation`.

### Task 2: Create a fresh manifest-bound generation and candidate

**Files:**
- Create through framework: `packages/web/.ai-runs/2026-08-05T*-flow-psy-heal-001/generation-task.md`
- Create through framework: sibling `provider-input.md` and `manifest.json`
- Create or preserve as rejected candidate: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Modify after a candidate exists: `packages/web/specs/psychicbook-healing-experiment.md`

**Interfaces:**
- Consumes: valid pending-generation spec and process-only stage configuration.
- Produces: a new generation run with `resultCacheStatus = disabled`, plus either a promoted generated target or an archived statically reviewed rejected candidate.

- [ ] **Step 1: Confirm the configured AI brain without printing key material**

  Run from `packages/web`:

  ```bash
  npm run ai:brain:doctor -- --require
  ```

  Expected: the doctor identifies an available brain and configuration sources without revealing any key values.

- [ ] **Step 2: Create a new deterministic generation task**

  Run:

  ```bash
  npm run ai:generate-test -- specs/psychicbook-healing-experiment.md
  ```

  Expected: output starts with `Created generation task:` and prints one new `.ai-runs/2026-08-05T*-flow-psy-heal-001/generation-task.md` path. Use that exact emitted path for the next step. Inspect its sibling manifest and confirm `specPath`, `targetTestFile`, `generationMode`, `specSha256`, and provider-input digest are populated.

- [ ] **Step 3: Invoke verified generation with exact-result reuse disabled**

  In the same dedicated shell that contains the four approved runtime variables, run with the exact generation-task path emitted in Step 2:

  ```bash
  AI_RESULT_CACHE=false npm run ai:brain:generate -- .ai-runs/2026-08-05T*-flow-psy-heal-001/generation-task.md --out tests/regression/psychicbook-healing-experiment.spec.ts
  ```

  Resolve the timestamped path to the single newly emitted task before execution; do not pass a shell glob when more than one match exists.

  Expected accepted path: verified generation records `resultCacheStatus = disabled`, passes deterministic review and the two-repeat promotion gate, promotes the target, and prints its generation run id.

  Expected rejected path: verified generation archives the candidate, prints `Rejected candidate preserved at:`, records the exact failure stage and reason, and leaves the target absent. Preserve that result as feedback; do not retry generation merely to hide the rejection.

- [ ] **Step 4: Materialize only a statically valid runtime-rejected candidate when necessary**

  Skip this step when verified generation promoted the target.

  When the candidate was rejected only by live stage execution, inspect its generation manifest and archived source. Require completed static review, TypeScript, listing, and lint evidence. Use `apply_patch` to create `tests/regression/psychicbook-healing-experiment.spec.ts` from the exact archived candidate bytes. Do not materialize a source rejected for malformed output, static policy, type, lint, secret safety, or integrity.

  Expected: the diagnostic target is byte-identical to the archived candidate, and the report will identify it as a materialized runtime-rejected candidate rather than an accepted generated target.

- [ ] **Step 5: Close the spec lifecycle and bind the actual source**

  After a promoted or approved diagnostic target exists, use `apply_patch` to change exactly:

  ```markdown
  | Generation Status | pending-generation |
  ```

  back to:

  ```markdown
  | Generation Status | generated |
  ```

  Then run:

  ```bash
  npm run ai:spec:stamp -- tests/regression/psychicbook-healing-experiment.spec.ts
  npm run ai:test:review -- --spec specs/psychicbook-healing-experiment.md --test tests/regression/psychicbook-healing-experiment.spec.ts --mode single
  npm run typecheck
  npx eslint tests/regression/psychicbook-healing-experiment.spec.ts --max-warnings=0
  ```

  Expected: all static commands exit 0; the target has one primary test, the inline `PsychicBookHealingExperimentPage`, runtime email helper usage, code `1234`, and only the final account-control assertion.

### Task 3: Observe the unchanged live baseline

**Files:**
- Verify: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Inspect: the fresh generation run and gate directories below `packages/web/.ai-runs/`

**Interfaces:**
- Consumes: statically accepted target and the dedicated process-only stage environment.
- Produces: a three-repeat baseline verdict, or a precisely classified external failure with bounded evidence.

- [ ] **Step 1: Run the full generated-test gate**

  Run from `packages/web` in the dedicated runtime shell:

  ```bash
  npm run ai:test:gate -- --spec specs/psychicbook-healing-experiment.md --test tests/regression/psychicbook-healing-experiment.spec.ts --mode single --repeat-each 3
  ```

  Expected GREEN: three Chromium repeats pass with retries disabled and zero failed, skipped, or flaky results.

  If the gate fails: retain the JSON/HTML/test-results directory, record the gate reason code, and inspect bounded UI/network evidence. Classify the failure as generator/test, product/backend, test data, authentication, network, or environment. Do not call it GREEN.

- [ ] **Step 2: Decide whether the controlled RED remains valid**

  Continue only when the unchanged source passed all static checks and the intentional Get Started locator will execute before any observed product/backend failure. Stop if HTTP Basic, initial navigation, DNS, TLS, or persistent stage unavailability prevents reaching Get Started.

  Record the target SHA-256 before deliberate breakage:

  ```bash
  shasum -a 256 tests/regression/psychicbook-healing-experiment.spec.ts
  ```

### Task 4: Create and prove the controlled `Get Started BROKEN` RED

**Files:**
- Modify: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Inspect: the isolated Playwright failure under `packages/web/test-results/` and configured report output

**Interfaces:**
- Consumes: the unchanged inline Page Object.
- Produces: exactly one locator-string source change and a runtime failure at that locator before registration API work.

- [ ] **Step 1: Break exactly one semantic locator**

  Use `apply_patch` to replace only:

  ```ts
  this.getStartedLink = page.getByRole('link', { name: 'Get Started' });
  ```

  with:

  ```ts
  this.getStartedLink = page.getByRole('link', { name: 'Get Started BROKEN' });
  ```

  If the fresh generator formats the assignment over multiple lines, change only the accessible-name string literal and preserve all surrounding source.

- [ ] **Step 2: Verify the source delta before browser execution**

  Run:

  ```bash
  rg -n "Get Started(?: BROKEN)?" tests/regression/psychicbook-healing-experiment.spec.ts
  shasum -a 256 tests/regression/psychicbook-healing-experiment.spec.ts
  ```

  Expected: exactly one executable locator contains `Get Started BROKEN`; flow steps, runtime helpers, assertion, metadata, retries, and waits are unchanged.

- [ ] **Step 3: Prove the controlled target is RED**

  Run in the dedicated runtime shell:

  ```bash
  npx playwright test tests/regression/psychicbook-healing-experiment.spec.ts --project=chromium --workers=1 --retries=0 --repeat-each=1
  ```

  Expected: non-zero exit caused by timeout/actionability at the `Get Started BROKEN` link locator. Confirm the failure occurs before email submission and before `/profile/user/web/registration/init` or `/profile/user/web/registration/code` requests.

  If it fails elsewhere, the controlled RED is invalid; preserve evidence and diagnose before invoking healer.

### Task 5: Run proposal-only healing and audit the candidate

**Files:**
- Inspect: `packages/web/.ai-runs/heal/` newest run directory
- Inspect: `heal-summary.json`, `evidence.json`, `candidate.ts`, and `candidate.diff`
- Modify after acceptance: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`

**Interfaces:**
- Consumes: valid controlled RED and its broken-target SHA-256.
- Produces: healer status, triage classification, immutable broken target, and optionally an exact locator-only verified proposal.

- [ ] **Step 1: Run healer without mutation privileges**

  In the same dedicated runtime shell, run:

  ```bash
  AI_AUTOHEAL_ENABLED=true AI_RESULT_CACHE=false npm run ai:test:heal -- --test tests/regression/psychicbook-healing-experiment.spec.ts --spec specs/psychicbook-healing-experiment.md --project chromium --max-attempts 3 --verify-runs 2
  ```

  Expected successful proposal path: healer reproduces the failure, reports its actual triage category and reason, verifies a candidate in two consecutive retry-free Chromium runs, prints `PROPOSAL READY`, and leaves the broken target unchanged.

  Record any different terminal status exactly: `already-green`, `not-repairable`, `manual-change-required`, `env-failure`, `still-failing`, policy rejection, or public `HEAL_ERROR`.

- [ ] **Step 2: Prove proposal-only did not mutate the target**

  Run:

  ```bash
  shasum -a 256 tests/regression/psychicbook-healing-experiment.spec.ts
  ```

  Expected: digest equals the broken-target digest from Task 4. If it differs, stop promotion and record a healer safety failure.

- [ ] **Step 3: Audit the newest healer archive**

  Read the exact archive path printed by healer. Verify:

  - `heal-summary.json` reports the same target and terminal status;
  - candidate SHA-256 matches the summary;
  - `candidate.diff` contains one semantic change only;
  - the change is `Get Started BROKEN` to `Get Started`;
  - assertion, code `1234`, runtime email helper, actions, metadata, waits, retries, and skip behavior are unchanged.

  Reject and retain any broader proposal. Do not run `--apply` or `--allow-dirty`.

- [ ] **Step 4: Promote only the reviewed locator repair**

  When the proposal passes Step 3, use `apply_patch` to replace only `Get Started BROKEN` with `Get Started` in the actual target. Do not copy the entire candidate over the file.

  Expected: the restored target digest matches the pre-break digest when the generator's original locator was exactly `Get Started`; otherwise the only text delta from the broken file is the reviewed accessible-name restoration.

### Task 6: Run fresh final verification

**Files:**
- Verify: `packages/web/specs/psychicbook-healing-experiment.md`
- Verify: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Inspect: final gate artifacts below `packages/web/.ai-runs/`

**Interfaces:**
- Consumes: actual restored target, not the archived healer candidate.
- Produces: fresh static, drift, and three-repeat live evidence for the final report.

- [ ] **Step 1: Re-run every static acceptance check on the actual target**

  Run from `packages/web`:

  ```bash
  npm run ai:test:review -- --spec specs/psychicbook-healing-experiment.md --test tests/regression/psychicbook-healing-experiment.spec.ts --mode single
  npm run typecheck
  npx eslint tests/regression/psychicbook-healing-experiment.spec.ts --max-warnings=0
  npm run ai:spec:drift
  ```

  Expected: each command exits 0. If repository-wide spec drift reports an unrelated pre-existing issue, separate it from the exact PsychicBook binding result and report both.

- [ ] **Step 2: Run the full final live gate**

  Run in the dedicated runtime shell:

  ```bash
  npm run ai:test:gate -- --spec specs/psychicbook-healing-experiment.md --test tests/regression/psychicbook-healing-experiment.spec.ts --mode single --repeat-each 3
  ```

  Final GREEN requires all three Chromium repeats to pass with retries disabled and zero failed, skipped, retried, or flaky tests. Preserve the exact report when any repeat fails and classify the failure without weakening the test.

- [ ] **Step 3: Verify final isolation**

  Run from the repository root:

  ```bash
  git status --short -- packages/web/specs/psychicbook-healing-experiment.md packages/web/tests/regression/psychicbook-healing-experiment.spec.ts packages/web/docs/ai-testing/psychicbook-healing-feedback-2026-08-04.md packages/web/pages/PsychicBookLoginPage.ts packages/web/data/psychicbook.ts
  shasum -a 256 packages/web/tests/regression/psychicbook-healing-experiment.spec.ts
  ```

  Expected: the earlier report, shared Page Object, and data helper were not changed; unrelated dirty-worktree entries are preserved.

### Task 7: Publish comparative framework feedback

**Files:**
- Create: `packages/web/docs/ai-testing/psychicbook-healing-feedback-2026-08-05.md`
- Inspect: `packages/web/docs/ai-testing/psychicbook-healing-feedback-2026-08-04.md`
- Inspect: fresh generation, baseline, RED, healer, and final-gate artifacts

**Interfaces:**
- Consumes: all fresh run ids, manifests, verdicts, diffs, and bounded failure evidence.
- Produces: one secret-free, reproducible comparison report and a concise user handoff.

- [ ] **Step 1: Write the report with observed evidence only**

  Use `apply_patch` to create the report with these exact sections:

  ```markdown
  # PsychicBook generation and healer rerun feedback — 2026-08-05

  ## Scope
  ## Fresh artifacts
  ## Fresh generation result
  ## Baseline result
  ## Controlled RED
  ## Healer result
  ## Final verification
  ## Comparison with 2026-08-04
  ## What worked well
  ## Improvement candidates
  ## Conclusion
  ```

  Include actual run paths, statuses, repeat counts, classification/reason codes, the one-line candidate diff summary, and product/network evidence needed to reproduce findings. Do not include runtime email, HTTP Basic values, cookies, authorization headers, storage state, or screenshots.

- [ ] **Step 2: Rank improvement candidates by evidence and ownership**

  Separate framework findings from PsychicBook product/backend findings. Each improvement entry must state severity, observed evidence, expected framework behavior, and a reproducible next check. Specifically compare generator fail-closed behavior, healer classification, proposal-only mutation safety, healer verification count, final gate repeat count, and usefulness of public diagnostics with the 2026-08-04 result.

- [ ] **Step 3: Run the completion audit**

  Re-run the exact static checks from Task 6 and the final three-repeat gate only if the target changed after Task 6. Review `git diff --check`, `git status`, report content, run manifests, and candidate diff. Confirm no framework source file was modified and no live value appears in the spec, generated target, generation inputs, or feedback report.

  Expected handoff: exact generation and healer paths; honest baseline, RED, proposal, and final statuses; comparison report path; preserved earlier evidence; and explicit confirmation that healer `--apply` was not exercised.
