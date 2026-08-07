# Two-Run Generated-Test Promotion Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require exactly two clean Playwright executions before a generated test is promoted, while preserving the separate three-repeat full gate and exposing the new acceptance policy in quality evidence and telemetry.

**Architecture:** Centralize generated-gate repeat constants, run the isolated generated candidate once with `--repeat-each=2 --retries=0`, verify exact report multiplicity before atomic promotion, and create the promotion fingerprint through one shared helper used by generation and later full-gate linkage. Keep the existing `fastGatePassed` compatibility field while adding explicit promotion-policy metadata.

**Tech Stack:** Node.js ESM, `node:test`, Playwright Test CLI and JSON reporter, SHA-256 fingerprints, JSON run manifests.

## Global Constraints

- Work in the current dirty `sains` checkout; preserve unrelated changes and do not create commits.
- Use test-driven development: add or update focused tests, observe the intended failure, then change production code.
- Use `apply_patch` for repository edits.
- Do not call paid model providers, authenticated applications, or external browsers.
- Do not change the recording-generation gate, which retains its existing one/three-repeat policy.
- Keep the full generated-test gate at exactly three repeats and keep `--run-id` restricted to that lane.
- Keep candidate isolation, target snapshot checks, atomic rename, and accepted-cache ordering unchanged.
- Commit steps are intentionally omitted because the user requested implementation in the current dirty branch without commits.

---

### Task 1: Centralize and enforce the two/three-repeat generated-gate contract

**Files:**
- Create: `packages/web/scripts/ai/lib/generated-gate-policy.mjs`
- Modify: `packages/web/scripts/ai/generated-test-gate.mjs`
- Modify: `packages/web/scripts/ai/lib/generated-gate-runner.mjs`
- Modify: `packages/web/package.json`
- Test: `packages/web/scripts/ai/__tests__/generated-test-gate.test.mjs`
- Test: `packages/web/scripts/ai/__tests__/gate-all.test.mjs`

**Interfaces:**
- Export `PROMOTION_GATE_REPEAT_EACH = 2`.
- Export `FULL_GATE_REPEAT_EACH = 3`.
- Export `PROMOTION_GATE_POLICY = 'verified-promotion-gate/v3'`.
- Export `GENERATED_GATE_REPEAT_VALUES = new Set([2, 3])`.
- `parseArgs()` defaults to `3`, accepts only `2` and `3`, rejects `1`, and permits `--run-id` only with `3`.
- `buildPlaywrightStage()` accepts only `2` and `3` and always emits `--retries=0`.

- [x] **Step 1: Replace one-repeat expectations with failing two-repeat policy tests**

  Assert the CLI and stage builder accept `2` and `3`, reject `1` and other values, default to `3`, and keep `--run-id` full-gate-only. Assert the compatibility package script invokes `--repeat-each 2`.

- [x] **Step 2: Add failing report-contract tests for exact two-run evidence**

  Build a Playwright JSON fixture whose selected project has `repeatEach: 2`, `retries: 0`, and exactly two retry-zero passed executions for each logical target test. Assert it passes. Assert one execution, three executions, a failed or skipped second execution, a retry, and missing execution evidence each fail closed.

- [x] **Step 3: Run the focused tests and observe the old one-repeat policy fail**

  Run from `packages/web`:
  `node --test scripts/ai/__tests__/generated-test-gate.test.mjs scripts/ai/__tests__/gate-all.test.mjs`

  Expected before implementation: assertions fail because generated-test parsing/stage construction still admits `1`, rejects `2`, and the compatibility script still uses one repeat.

- [x] **Step 4: Implement the shared generated-gate policy**

  Import the constants in the single-pair gate and batch runner. Replace duplicated defaults and allowlists without touching recording-gate code. Preserve the full batch runner's default of `3`.

- [x] **Step 5: Point the compatibility candidate-lane script to two repeats**

  Change only `ai:test:gate:fast` to `--repeat-each 2`; leave `ai:recording:gate:fast` unchanged.

- [x] **Step 6: Run the focused tests to green**

  Run from `packages/web`:
  `node --test scripts/ai/__tests__/generated-test-gate.test.mjs scripts/ai/__tests__/gate-all.test.mjs`

### Task 2: Require the two-run gate during verified generation and canonicalize quality evidence

**Files:**
- Create: `packages/web/scripts/ai/lib/generation-quality.mjs`
- Modify: `packages/web/scripts/ai/verified-generate.mjs`
- Modify: `packages/web/scripts/ai/lib/generation-run.mjs`
- Test: `packages/web/scripts/ai/__tests__/verified-generate.test.mjs`
- Test: `packages/web/scripts/ai/__tests__/generation-run.test.mjs`

**Interfaces:**
- Export `generationQualityFingerprint({ sourceSha256, outcome, stage, reasonCode, repairCount })` from the shared helper.
- Export an accepted-fingerprint helper if it removes duplicated accepted-outcome arguments from full-gate linkage.
- Fingerprint payload uses policy `verified-promotion-gate/v3` and repeat count `2`.
- Normalized run quality includes nullable `promotionGatePolicy` and `promotionGateRepeatEach` in addition to existing compatibility fields.

- [x] **Step 1: Add failing verified-generation tests**

  Assert both the initial candidate path and the post-static-repair candidate path call the generated gate with `repeatEach: 2`. Assert no target or exact-cache promotion occurs after either of the two executions is rejected. Assert successful manifests keep `fastGatePassed: true` and add policy `verified-promotion-gate/v3` plus repeat count `2`.

- [x] **Step 2: Add failing canonical-fingerprint and full-link tests**

  Assert verified generation and `linkFullGateOutcome()` derive the same accepted fingerprint through the shared helper. Assert v3 evidence links successfully and historical `verified-fast-gate/v2` one-repeat evidence is readable but cannot satisfy current linkage.

- [x] **Step 3: Run the focused tests and observe the old one-repeat/v2 behavior fail**

  Run from `packages/web`:
  `node --test scripts/ai/__tests__/verified-generate.test.mjs scripts/ai/__tests__/generation-run.test.mjs scripts/ai/__tests__/generated-test-gate.test.mjs`

- [x] **Step 4: Implement the canonical fingerprint helper and quality normalization**

  Move fingerprint construction out of both `verified-generate.mjs` and `generation-run.mjs`. Include the v3 policy and repeat count in the hashed payload. Normalize the new quality fields without invalidating historical manifests that omit them.

- [x] **Step 5: Switch both verified candidate gates to two repeats**

  Use `PROMOTION_GATE_REPEAT_EACH` for the initial generated source and for the one permitted repaired source. Preserve the existing static-only repair boundary, immutable candidate check, target snapshot check, atomic rename, and cache-promotion sequence.

- [x] **Step 6: Persist promotion metadata on success and rejection**

  Record the explicit policy and repeat count on new generation outcomes so accepted and rejected v3 attempts are distinguishable from historical v2 attempts.

- [x] **Step 7: Run the focused tests to green**

  Run from `packages/web`:
  `node --test scripts/ai/__tests__/verified-generate.test.mjs scripts/ai/__tests__/generation-run.test.mjs scripts/ai/__tests__/generated-test-gate.test.mjs`

### Task 3: Expose promotion policy and repeat distributions in token telemetry

**Files:**
- Modify: `packages/web/scripts/ai/token-usage-report.mjs`
- Test: `packages/web/scripts/ai/__tests__/token-usage-report.test.mjs`

**Interfaces:**
- Per-run report quality includes nullable `promotionGatePolicy` and `promotionGateRepeatEach`.
- Summary JSON includes `promotionGatePolicyDistribution` and `promotionGateRepeatEachDistribution` maps that omit missing historical values.
- Human-readable output labels the promotion policy/repeat distribution without treating it as model-token usage.

- [x] **Step 1: Add failing report-shape and aggregation tests**

  Create mixed historical v2 and new v3 manifest fixtures. Assert new per-run metadata is retained, absent legacy metadata stays null, and only present policy/repeat values are counted in the two distributions.

- [x] **Step 2: Run the focused telemetry test and observe missing fields**

  Run from `packages/web`:
  `node --test scripts/ai/__tests__/token-usage-report.test.mjs`

- [x] **Step 3: Implement defensive extraction and aggregation**

  Accept only non-empty policy strings and positive integer repeat counts. Add deterministic count maps to summary JSON and concise human output. Leave the existing token buckets and fast/full quality-rate formulas unchanged.

- [x] **Step 4: Run the focused telemetry test to green**

  Run from `packages/web`:
  `node --test scripts/ai/__tests__/token-usage-report.test.mjs`

### Task 4: Update operational documentation and verify the complete change

**Files:**
- Modify: `packages/web/docs/ai-testing/TEST_GENERATION_FLOW.md`
- Modify: `packages/web/docs/ai-testing/TOKEN_ECONOMY.md`
- Modify only when current-behavior references require it: `packages/web/docs/ai-testing/QUICKSTART.md`
- Modify only when current-behavior references require it: `packages/web/docs/ai-testing/README.md`
- Modify only when current-behavior references require it: `packages/web/docs/ai-testing/START_HERE.md`

- [x] **Step 1: Find current one-repeat generated-test claims**

  Run:
  `rg -n "one[- ]repeat|repeat-each[ =]1|fast gate|fast-gate|ai:test:gate:fast|three repeats|repeat-each[ =]3" packages/web/docs/ai-testing packages/web/README_MANUAL_QA.md packages/web/README.md`

  Do not rewrite archival design/plan documents and do not change recording-gate statements.

- [x] **Step 2: Document the current two-stage acceptance contract**

  State that an isolated candidate is promoted and accepted into exact-result cache only after one Playwright command proves two clean retry-zero executions. State that the separate full gate still proves three clean executions and that the compatibility `ai:test:gate:fast` command is the two-repeat candidate/promotion lane.

- [x] **Step 3: Run all focused tests together**

  Run from `packages/web`:
  `node --test scripts/ai/__tests__/generated-test-gate.test.mjs scripts/ai/__tests__/gate-all.test.mjs scripts/ai/__tests__/verified-generate.test.mjs scripts/ai/__tests__/generation-run.test.mjs scripts/ai/__tests__/token-usage-report.test.mjs`

- [x] **Step 4: Run complete non-paid verification**

  Run from `packages/web`:

  - `npm run ai:test:self`
  - `npm run ai:eval`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run ai:test:review:all`

  Do not run authenticated or provider-backed generation. Record any unrelated pre-existing failure separately with exact evidence.

- [x] **Step 5: Audit the final diff for scope and policy drift**

  Confirm generated-test policy has no remaining v2/one-repeat production path, the full gate still uses three, the recording gate is unchanged, and only the intended files differ for this feature. Run:

  - `rg -n "verified-fast-gate/v2|repeatEach: 1|--repeat-each 1" packages/web/scripts/ai/verified-generate.mjs packages/web/scripts/ai/generated-test-gate.mjs packages/web/scripts/ai/lib/generation-run.mjs packages/web/scripts/ai/lib/generated-gate-runner.mjs packages/web/package.json`
  - `rg -n "PROMOTION_GATE_REPEAT_EACH|FULL_GATE_REPEAT_EACH|PROMOTION_GATE_POLICY|promotionGateRepeatEach" packages/web/scripts/ai packages/web/docs/ai-testing packages/web/package.json`
