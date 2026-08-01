# Generation Gates and Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplicated gate work and add trustworthy full-funnel latency/token/quality telemetry.

**Architecture:** Split global and per-pair gate work, add explicit fast/full lanes, persist one sanitized event stream per generation run, and aggregate quality-linked token/latency metrics. Replace the UI global lock with scoped target coordination and state runtime claims honestly in CI.

**Tech Stack:** Node.js ESM, Playwright CLI/JSON reports, TypeScript compiler, JSON/JSONL manifests, Node test runner, GitHub Actions.

## Global Constraints

- Preserve the existing three-repeat, no-fail/no-skip/no-flaky full acceptance verdict.
- Fast acceptance runs exactly one repeat and never substitutes for the final full gate.
- Keep browser/report/evidence paths isolated per run before adding concurrency.
- Do not require production credentials or run paid models in tests/CI.
- Never record prompts, keys, auth state, or complete DOM snapshots.
- Preserve unrelated dirty working-tree changes; use test-first edits and `apply_patch`.

---

### Task 1: Explicit fast and full single-pair gates

**Files:**
- Modify: `packages/web/scripts/ai/generated-test-gate.mjs`
- Modify: `packages/web/package.json`
- Test: `packages/web/scripts/ai/__tests__/generated-test-gate.test.mjs`

**Interfaces:**
- Produces: `buildPlaywrightStage({ repeatEach = 3, maxFailures })`, CLI `--repeat-each 1|3`, and package script `ai:test:gate:fast`.

- [ ] **Step 1: Add failing argument/stage tests**

Assert default args contain `--repeat-each=3`, fast args contain `--repeat-each=1`, both contain `--max-failures=1`, and values other than 1/3 are rejected.

- [ ] **Step 2: Run the test and confirm repeat count is fixed**

Run: `node --test scripts/ai/__tests__/generated-test-gate.test.mjs`

- [ ] **Step 3: Parameterize repeat count and fail-fast behavior**

Keep JSON verdict logic identical. Add `ai:test:gate:fast` as `node scripts/ai/generated-test-gate.mjs --repeat-each 1`.

- [ ] **Step 4: Run focused and self-tests**

Run: `node --test scripts/ai/__tests__/generated-test-gate.test.mjs`
Run: `npm run ai:test:self`.

### Task 2: Batch global gate work

**Files:**
- Create: `packages/web/scripts/ai/lib/generated-gate-runner.mjs`
- Modify: `packages/web/scripts/ai/generated-test-gate.mjs`
- Modify: `packages/web/scripts/ai/gate-all.mjs`
- Modify: `packages/web/scripts/ai/review-generated-test.mjs`
- Test: `packages/web/scripts/ai/__tests__/gate-all.test.mjs`
- Test: `packages/web/scripts/ai/__tests__/generated-test-gate.test.mjs`

**Interfaces:**
- Produces: `runGlobalGeneratedChecks(options)` and `runGeneratedPairChecks(pair, options)`.
- Adds internal child flag: `--global-checks-complete <fingerprint>`.

- [ ] **Step 1: Add a failing process-count test**

Inject command runners for two spec/test pairs and assert directory validation, `test:e2e:list`, and TypeScript compilation each execute once, while pair review/execution execute once per pair.

- [ ] **Step 2: Run the test and confirm current counts are per pair**

Run: `node --test scripts/ai/__tests__/gate-all.test.mjs`

- [ ] **Step 3: Extract reusable global/pair runners**

Perform strict directory validation first, global list/typecheck next, then pair reviews. Only pass the internal fingerprint after all global commands succeed; a child rejects missing/mismatched fingerprints when skipping global work.

- [ ] **Step 4: Review pairs in-process and isolate execution outputs**

Export the existing reviewer function instead of launching nested npm processes. Give every pair unique JSON report/evidence/test-results paths. Keep execution sequential initially; bounded concurrency is added only after isolation tests pass.

- [ ] **Step 5: Add bounded execution concurrency**

Use `AI_GATE_CONCURRENCY` with default 1 and a strict maximum of 4. Never run two executions sharing a target, project auth state, or report directory.

- [ ] **Step 6: Run gate tests, AI self-tests, list, and typecheck**

Run: `node --test scripts/ai/__tests__/gate-all.test.mjs scripts/ai/__tests__/generated-test-gate.test.mjs`
Run: `npm run ai:test:self`
Run: `npm run test:e2e:list`
Run: `npm run typecheck`.

### Task 3: Full-funnel generation run telemetry

**Files:**
- Create: `packages/web/scripts/ai/lib/generation-run.mjs`
- Modify: `packages/web/scripts/ai/lib/ai-client.mjs`
- Modify: `packages/web/scripts/ai/ai-generate.mjs`
- Modify: `packages/web/scripts/ai/verified-generate.mjs`
- Modify: `packages/ui/scripts/fit-runner.mjs`
- Modify: `packages/web/scripts/ai/generated-test-gate.mjs`
- Test: `packages/web/scripts/ai/__tests__/generation-run.test.mjs`
- Test: `packages/web/scripts/ai/__tests__/ai-client.test.mjs`

**Interfaces:**
- Produces: `createGenerationRun`, `recordRunEvent`, `recordRunAttempt`, `finalizeGenerationRun`.
- Event schema: `generation-run-event/v1`; run schema: `generation-run/v1`.

- [ ] **Step 1: Add failing lifecycle/redaction tests**

Assert success and failure attempts persist provider/model/stage, timestamps/durations, disjoint usage, cache/retry status, failure stage/reason, and quality verdicts under one run ID. Assert keys, prompt text, bearer/cookie values, and DOM contents never appear.

- [ ] **Step 2: Run the new test and confirm the module is missing**

Run: `node --test scripts/ai/__tests__/generation-run.test.mjs`

- [ ] **Step 3: Implement private atomic event persistence**

Write under `.ai-runs/generation/<run-id>/events.jsonl` with mode 0600 and directory mode 0700. Validate run IDs, canonicalize allowed event fields, and update a small summary manifest atomically.

- [ ] **Step 4: Attach normalized usage to provider errors**

Construct usage before throwing on truncation/refusal/empty/invalid structured output when the provider supplied it. For HTTP failures with unknown usage, record `null`, not zero. Ensure retry/backoff cancellation uses the active abort signal.

- [ ] **Step 5: Thread run IDs through fit, input assembly, generation, review, gate, and promotion**

Record stage start/end and every provider attempt. Persist accepted/rejected quality fingerprints and repair counts.

- [ ] **Step 6: Run telemetry/client/orchestrator/full tests**

Run: `node --test scripts/ai/__tests__/generation-run.test.mjs scripts/ai/__tests__/ai-client.test.mjs scripts/ai/__tests__/verified-generate.test.mjs`
Run: `npm run ai:test:self`.

### Task 4: Trustworthy reporting and cost buckets

**Files:**
- Modify: `packages/web/scripts/ai/token-usage-report.mjs`
- Modify: `packages/web/docs/ai-testing/TOKEN_ECONOMY.md`
- Modify: `packages/web/package.json`
- Test: `packages/web/scripts/ai/__tests__/token-usage-report.test.mjs`

**Interfaces:**
- Reporter adds: attempts, failedAttempts, failureStages, uncachedInputTokens, p50/p95 provider/end-to-end latency, cacheReadRatio, cacheWriteTokens, firstPassReviewRate, fast/fullGateRate, unknownUsageAttempts.

- [ ] **Step 1: Add failing aggregate/quantile/unknown-cost tests**

Use deterministic rows to assert nearest-rank p50/p95, disjoint token sums, failure counts, cache ratios, and `--require` failure when any paid attempt has unknown usage.

- [ ] **Step 2: Run the focused test and confirm missing fields**

Run: `node --test scripts/ai/__tests__/token-usage-report.test.mjs`

- [ ] **Step 3: Read both legacy manifests and `generation-run/v1` events**

Keep backward compatibility while preferring new full-funnel runs. Never silently merge duplicate legacy/new records for the same run ID.

- [ ] **Step 4: Implement aggregates and correct the documented formula**

Document: `uncached_input × base_input_rate + cache_write × write_rate + cache_read × read_rate + output × output_rate + reasoning × applicable_rate`. State that provider prices are supplied externally with provider/model/date.

- [ ] **Step 5: Run reporter and full tests**

Run: `node --test scripts/ai/__tests__/token-usage-report.test.mjs`
Run: `npm run ai:tokens:report -- --json`
Run: `npm run ai:test:self`.

### Task 5: Scoped UI coordination and honest CI runtime coverage

**Files:**
- Modify: `packages/ui/src/server.mjs`
- Modify: `packages/ui/tests/handlers.test.mjs`
- Modify: `packages/web/scripts/ai/run-generated-ui.mjs`
- Modify: `packages/web/package.json`
- Modify: `.github/workflows/web.yml`
- Modify: `packages/web/docs/ai-testing/TEST_GENERATION_FLOW.md`
- Test: `packages/web/scripts/ai/__tests__/run-generated-ui.test.mjs`
- Test: `packages/ui/tests/server.test.mjs`

**Interfaces:**
- UI produces keyed command coordination by `{ operationClass, targetPath }` with configured caps.
- Adds package script `ai:test:gate:local-generated` for generated pairs supported by the deterministic local fixture.

- [ ] **Step 1: Add failing UI coordination tests**

Assert two writes to the same target conflict/queue, independent targets may run within the cap, and read-only validation is allowed while an unrelated generation runs. Assert cancel targets only the selected command.

- [ ] **Step 2: Add failing local-generated selection tests**

Assert delivered, unauthenticated, local-fixture-supported generated pairs are selected; pending/auth/external pairs are explicitly reported and never counted as executed.

- [ ] **Step 3: Implement keyed coordination and bounded caps**

Replace the singleton with a map keyed by target/operation class. Default provider concurrency is 1 and read-only concurrency is 4; parse strict bounded environment settings.

- [ ] **Step 4: Add the deterministic local generated gate to verification/CI**

Run it after static review. Keep authenticated regression in its existing opt-in job. Rename summaries so static-only paths make no runtime acceptance claim.

- [ ] **Step 5: Run UI, generated-runner, web quality, and workflow checks**

Run: `node --test tests/server.test.mjs tests/handlers.test.mjs` from `packages/ui`.
Run: `node --test scripts/ai/__tests__/run-generated-ui.test.mjs` from `packages/web`.
Run: `npm run ai:test:self` from `packages/web`.
Run: `npm run verify:static` from `packages/web`.

