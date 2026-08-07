# Test Generation Throughput and Cost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent avoidable model work, give CLI generation the same cost controls as REST, reduce fit output, make cache reuse safe, and batch verification without weakening quality gates.

**Architecture:** Add a deterministic preflight in front of verified generation, move provider-independent prompt/cache orchestration around every transport, render flow-spec Markdown from a semantic draft, separate immutable cache identity from mutable target preconditions, and group compatible Playwright executions. Thread one run identifier through UI fit, generation, and full acceptance.

**Tech Stack:** Node.js ESM, Node test runner, TypeScript compiler API, Playwright CLI/JSON reporter, JSON Schema, SHA-256 fingerprints.

## Global Constraints

- Preserve every existing generated-test policy and the one-repeat fast gate plus three-repeat full gate.
- Work in the current dirty `sains` checkout and do not create commits that could absorb unrelated changes.
- Do not run paid providers, authenticated tests, or browser tests.
- Use test-first changes: each production behavior starts with a focused failing Node test.
- Use `apply_patch` for repository edits.
- Never report character savings as measured token savings.
- Never persist prompts, credentials, auth state, DOM bodies, or provider response bodies.

---

### Task 1: Pre-provider readiness and composite UI ownership

**Files:**
- Create: `packages/web/scripts/ai/lib/generation-preflight.mjs`
- Modify: `packages/web/scripts/ai/verified-generate.mjs`
- Modify: `packages/web/scripts/ai/generated-test-gate.mjs`
- Modify: `packages/ui/src/server.mjs`
- Test: `packages/web/scripts/ai/__tests__/generation-preflight.test.mjs`
- Test: `packages/web/scripts/ai/__tests__/verified-generate.test.mjs`
- Test: `packages/ui/tests/server.test.mjs`

**Interfaces:**
- Produces: `checkGenerationReadiness({ validation, env, webRoot, browserExecutableExists })` returning `{ passed, projects, diagnostics }`.
- Changes: `projectPlanForSpec(metadata, options)` reads `options.env` instead of ambient environment.
- Changes: UI coordinator tokens may reserve both `provider` and `browser` operation classes.

- [ ] **Step 1: Add failing readiness tests**

  Add controlled tests proving an auth-required spec with a missing Chromium executable, missing reusable state, or incomplete login configuration returns a deterministic failure, while a complete configuration passes without launching a browser.

- [ ] **Step 2: Run the readiness tests and verify the expected failures**

  Run: `node --test scripts/ai/__tests__/generation-preflight.test.mjs scripts/ai/__tests__/verified-generate.test.mjs`

- [ ] **Step 3: Implement explicit-env project planning and readiness**

  Resolve the selected project from the validated input and sanitized resolved environment. Check executable paths as regular executable files. For `E2E_AUTH_REUSE_STATE=true`, require the configured state path to be a regular non-symlink file. Otherwise require login credentials plus either the success selector or success URL regex.

- [ ] **Step 4: Call readiness before generation**

  Record a `preflight` stage and abort before `generate(...)` when readiness fails. Preserve the existing target and record zero provider attempts.

- [ ] **Step 5: Reserve provider and browser capacity in the UI**

  Extend command coordination to accept an exact operation-class set. Verified generation reserves `provider` and `browser`; ordinary generation-independent browser actions reserve only `browser`.

- [ ] **Step 6: Run focused tests**

  Run: `node --test scripts/ai/__tests__/generation-preflight.test.mjs scripts/ai/__tests__/verified-generate.test.mjs`
  Run from `packages/ui`: `node --test tests/server.test.mjs`

### Task 2: Codex CLI structured output, usage, and exact-cache parity

**Files:**
- Modify: `packages/web/scripts/ai/lib/ai-client.mjs`
- Modify: `packages/web/scripts/ai/lib/generation-cache.mjs`
- Modify: `packages/web/.env.example`
- Modify: `packages/web/scripts/ai/ai-doctor.mjs`
- Test: `packages/web/scripts/ai/__tests__/ai-client.test.mjs`
- Test: `packages/web/scripts/ai/__tests__/generation-cache.test.mjs`

**Interfaces:**
- Produces: `decodeCodexJsonlOutput(text, outputContract)` with normalized `{ text, usage }`.
- Changes: provider-independent exact-cache and single-flight orchestration surrounds REST and CLI transports.
- Adds: `AI_CODEX_CLI_MODEL`; explicit values are passed through `--model` and included in cache identity.

- [ ] **Step 1: Add failing CLI JSONL and parity tests**

  Use literal JSONL fixtures containing a final assistant message and optional usage. Assert malformed/missing final messages fail, usage is normalized when present, and absent usage remains null. Assert two identical CLI calls use one transport and an accepted CLI entry is reusable.

- [ ] **Step 2: Run the tests and verify CLI bypasses the common path**

  Run: `node --test scripts/ai/__tests__/ai-client.test.mjs scripts/ai/__tests__/generation-cache.test.mjs`

- [ ] **Step 3: Refactor common prompt and cache orchestration**

  Compute effective system/prompt, contract, cache key, cache lookup, single-flight, validation, and candidate creation before dispatching the selected transport. Keep result-cache promotion controlled by verified generation.

- [ ] **Step 4: Add isolated Codex JSONL/schema invocation**

  Write the selected output contract schema into the disposable CLI workspace before making it read-only. Invoke Codex with `--json`, `--output-schema`, and optional `--model`; decode only the final response event and normalize usage without logging response text.

- [ ] **Step 5: Document and diagnose CLI identity**

  Report the explicit model or isolated CLI default identity without printing credentials. Invalidate cache identity when CLI version or explicit model changes.

- [ ] **Step 6: Run focused tests**

  Run: `node --test scripts/ai/__tests__/ai-client.test.mjs scripts/ai/__tests__/generation-cache.test.mjs`

### Task 3: Semantic flow-draft IR and deterministic Markdown rendering

**Files:**
- Modify: `packages/web/scripts/ai/lib/output-contracts.mjs`
- Modify: `packages/ui/src/server.mjs`
- Modify: `packages/ui/scripts/lib/fit-generation-run.mjs`
- Test: `packages/web/scripts/ai/__tests__/ai-client.test.mjs`
- Test: `packages/ui/tests/server.test.mjs`
- Test: `packages/ui/tests/handlers.test.mjs`

**Interfaces:**
- Produces: `FLOW_SPEC_DRAFT_SCHEMA` as a semantic schema and `renderFlowSpecDraft(draft)` as the only Markdown formatter.
- Changes: `buildSpecFitPrompt({ source })` no longer receives or embeds `_template.md`.

- [ ] **Step 1: Add failing semantic-render tests**

  Construct one literal semantic draft and assert exact Metadata, Stability, Variants, Business Rules, Data Cases, canonical JSON cases, Test Data, Mocks, Flow Steps, Negative Cases, Acceptance Criteria, and required default sections. Assert the same case values appear once in the model response object and are projected twice only by the renderer.

- [ ] **Step 2: Add a failing fit-prompt size/shape test**

  Assert the prompt contains the rough source and schema version but not the full template or example case values from `_template.md`.

- [ ] **Step 3: Run focused tests and verify failures**

  Run from `packages/web`: `node --test scripts/ai/__tests__/ai-client.test.mjs`
  Run from `packages/ui`: `node --test tests/server.test.mjs tests/handlers.test.mjs`

- [ ] **Step 4: Implement semantic schema and renderer**

  Use strict arrays of named fields rather than free-form Markdown. Render all tables and JSON fences deterministically, escape cells, enforce canonical section order, and use `NEEDS_REVIEW` for missing values.

- [ ] **Step 5: Remove template bytes from provider input**

  Keep the template endpoint for humans, but build fit requests from concise rules, semantic schema identity, and the rough source only.

- [ ] **Step 6: Run focused tests**

  Run from `packages/web`: `node --test scripts/ai/__tests__/ai-client.test.mjs`
  Run from `packages/ui`: `node --test tests/server.test.mjs tests/handlers.test.mjs`

### Task 4: Safe cache preconditions and relevant bounded context

**Files:**
- Modify: `packages/web/scripts/ai/lib/generation-context-pack.mjs`
- Modify: `packages/web/scripts/ai/lib/generation-cache.mjs`
- Modify: `packages/web/scripts/ai/lib/ai-client.mjs`
- Modify: `packages/web/scripts/ai/verified-generate.mjs`
- Modify: `packages/web/scripts/ai/lib/generation-run.mjs`
- Test: `packages/web/scripts/ai/__tests__/generation-context-pack.test.mjs`
- Test: `packages/web/scripts/ai/__tests__/generation-cache.test.mjs`
- Test: `packages/web/scripts/ai/__tests__/verified-generate.test.mjs`
- Test: `packages/web/scripts/ai/__tests__/generation-run.test.mjs`

**Interfaces:**
- Context adds `existingTarget.sha256`, AST-derived imports/helpers, and page-object constructor signatures.
- Cache entries add `inputTargetSha256` and `outputSha256`; reads receive `currentTargetSha256`.
- Accepted cache hits return a removable `cacheReference`.

- [ ] **Step 1: Add failing target-precondition and invalidation tests**

  Assert reuse when current target equals the cached input or output hash, a miss for any unrelated target hash, and deletion/quarantine when a cache hit later fails a fast or linked full gate.

- [ ] **Step 2: Add failing context relevance tests**

  Use temporary TypeScript targets/page objects to assert imports, helper signatures, full target hash, constructor signatures, and relevant methods survive the 3,500-character budget while an unrelated class with arbitrary public methods is excluded.

- [ ] **Step 3: Run focused tests and verify failures**

  Run: `node --test scripts/ai/__tests__/generation-context-pack.test.mjs scripts/ai/__tests__/generation-cache.test.mjs scripts/ai/__tests__/verified-generate.test.mjs scripts/ai/__tests__/generation-run.test.mjs`

- [ ] **Step 4: Implement target-aware cache reads and invalidation**

  Keep mutable target hashes out of immutable key material. Persist both precondition hashes, return cache identity on hits, and remove/quarantine entries on later rejection. Link full-gate rejection to the originating cache reference without storing provider response bodies in telemetry.

- [ ] **Step 5: Implement AST-derived context quotas**

  Replace raw target-prefix capture with imports and top-level helper/type signatures. Include constructors. Require a positive class/file relevance score and reserve target, DOM, fixture, and page-object budgets before final serialization.

- [ ] **Step 6: Run focused tests**

  Run: `node --test scripts/ai/__tests__/generation-context-pack.test.mjs scripts/ai/__tests__/generation-cache.test.mjs scripts/ai/__tests__/verified-generate.test.mjs scripts/ai/__tests__/generation-run.test.mjs`

### Task 5: Batched execution and quality-linked stage telemetry

**Files:**
- Modify: `packages/web/scripts/ai/lib/generated-gate-runner.mjs`
- Modify: `packages/web/scripts/ai/generated-test-gate.mjs`
- Modify: `packages/web/scripts/ai/gate-all.mjs`
- Modify: `packages/web/scripts/ai/token-usage-report.mjs`
- Modify: `packages/web/scripts/ai/verified-generate.mjs`
- Modify: `packages/ui/src/server.mjs`
- Modify: `packages/ui/public/app.js`
- Test: `packages/web/scripts/ai/__tests__/gate-all.test.mjs`
- Test: `packages/web/scripts/ai/__tests__/generated-test-gate.test.mjs`
- Test: `packages/web/scripts/ai/__tests__/token-usage-report.test.mjs`
- Test: `packages/ui/tests/handlers.test.mjs`

**Interfaces:**
- Produces: grouped pair execution by `{ project, environment profile, repeatEach }` with per-target report verification.
- Reporter rows retain `stage` and `subjectFingerprint` and expose `byStage` summaries.
- Verified CLI prints `Generation run ID: <id>`; UI generation returns it and a subsequent full gate passes `--run-id`.

- [ ] **Step 1: Add failing no-global-work review-only tests**

  Assert `--review-only` performs directory validation and in-process review but invokes neither Playwright listing nor TypeScript compilation.

- [ ] **Step 2: Add failing grouped execution tests**

  For two compatible pairs, assert one Playwright command is executed with both target paths, repeat count remains three, and each target receives an independent JSON verdict. Assert incompatible projects remain separate groups.

- [ ] **Step 3: Add failing telemetry/UI linkage tests**

  Assert rows preserve stage/subject identity, reports aggregate by stage, generation responses expose run ID, and full UI gate requests pass that exact ID.

- [ ] **Step 4: Run focused tests and verify failures**

  Run from `packages/web`: `node --test scripts/ai/__tests__/gate-all.test.mjs scripts/ai/__tests__/generated-test-gate.test.mjs scripts/ai/__tests__/token-usage-report.test.mjs`
  Run from `packages/ui`: `node --test tests/handlers.test.mjs`

- [ ] **Step 5: Implement review-only and grouped execution**

  Skip global commands only for explicit review-only. Group runtime paths by project/environment/repeat, use one unique report directory per group, and verify every requested path from the shared JSON report.

- [ ] **Step 6: Implement stage/subject reporting and UI run linkage**

  Preserve stage/subject on ingestion, add deterministic per-stage aggregates, return run IDs without prompt/response data, and pass them only to the three-repeat full gate.

- [ ] **Step 7: Run focused tests**

  Run from `packages/web`: `node --test scripts/ai/__tests__/gate-all.test.mjs scripts/ai/__tests__/generated-test-gate.test.mjs scripts/ai/__tests__/token-usage-report.test.mjs`
  Run from `packages/ui`: `node --test tests/handlers.test.mjs`

### Task 6: Full deterministic verification and documentation

**Files:**
- Modify: `packages/web/docs/ai-testing/TOKEN_ECONOMY.md`
- Modify: `packages/web/docs/ai-testing/TEST_GENERATION_FLOW.md`
- Modify: `packages/web/.env.example`

**Interfaces:**
- Documents the final preflight, CLI identity/usage limits, semantic fit, cache preconditions, batch gate, and run-link behavior.

- [ ] **Step 1: Update documentation from verified behavior**

  Document only settings and behavior demonstrated by focused tests. State that CLI usage remains unknown when the installed CLI emits no usage event.

- [ ] **Step 2: Run full deterministic web verification**

  Run from `packages/web`: `npm run ai:test:self`
  Run from `packages/web`: `npm run ai:test:review:all`
  Run from `packages/web`: `npm run test:e2e:list`
  Run from `packages/web`: `npm run typecheck`

- [ ] **Step 3: Run full deterministic UI verification**

  Run from `packages/ui`: `npm test`

- [ ] **Step 4: Re-measure prompt/context/report baselines**

  Compare canonical character counts and fit request shape without calling a provider. Run `npm run ai:tokens:report -- --json` and report unknown/empty empirical usage honestly.
