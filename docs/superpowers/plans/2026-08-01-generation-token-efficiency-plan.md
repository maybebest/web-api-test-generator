# Generation Token-Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce paid tokens-to-green with canonical generation IR, safe cache behavior, and stage-aware routing while preserving executed correctness.

**Architecture:** Compile validated specs/recordings into compact versioned dynamic payloads and keep the complete policy in a stable output contract. Make provider caching opt-in, make exact caching acceptance-aware and single-flight, and expose independent fit/generation routing without silently changing models.

**Tech Stack:** Node.js ESM, existing Markdown parser/validators, JSON Schema, SHA-256 content fingerprints, Node test runner.

## Global Constraints

- Preserve the existing dirty `sains` working tree and all generated-test policy semantics.
- Use measured character/token fields honestly; never label character savings as token savings.
- Do not hard-code current provider prices or perform paid online evaluations.
- Existing model defaults remain unchanged until an explicit evaluated configuration selects alternatives.
- Provider prompt caching defaults off; exact-cache hits must represent accepted output.
- Use test-first changes and `apply_patch`; do not commit unrelated existing modifications.

---

### Task 1: Canonical generation IR and stable policy

**Files:**
- Create: `packages/web/scripts/ai/lib/generation-ir.mjs`
- Create: `packages/web/scripts/ai/lib/generation-policy.mjs`
- Modify: `packages/web/scripts/ai/lib/generation-input.mjs`
- Modify: `packages/web/scripts/ai/lib/rest-prompt.mjs`
- Modify: `packages/web/scripts/ai/lib/ai-client.mjs`
- Test: `packages/web/scripts/ai/__tests__/generation-ir.test.mjs`
- Test: `packages/web/scripts/ai/__tests__/rest-prompt.test.mjs`

**Interfaces:**
- Produces: `compileGenerationIr(validation, options)`, `renderGenerationIr(ir)`, `GENERATION_POLICY_VERSION`, `PLAYWRIGHT_GENERATION_POLICY`.

- [ ] **Step 1: Add failing semantic and corpus-size tests**

Assert IR retains target/hash/mode, story, preconditions, variants, business rules, canonical JSON data cases, mocks, steps, negatives, acceptance criteria, and locator hints. Assert the human Data Cases table is omitted when valid JSON cases exist. Across the 25 valid checked-in specs, require at least 25% fewer characters than the current compacted corpus and print measured totals on failure.

- [ ] **Step 2: Run the new tests and confirm missing exports**

Run: `node --test scripts/ai/__tests__/generation-ir.test.mjs`

- [ ] **Step 3: Implement canonical IR from parsed validation data**

Use existing parsed arrays/sections; never reparse with ad-hoc regex when a parser field exists. Canonicalize object key order and minify JSON. Preserve values byte-for-byte except existing secret/context sanitization rules that operate only on known governance fields.

- [ ] **Step 4: Move complete stable policy into one versioned module**

Include every mandatory rule currently spread across `create-generation-task.mjs` and the REST system prompt. Add a test mapping required policy phrases to the stable contract so compaction cannot silently remove them.

- [ ] **Step 5: Make REST generation consume policy plus IR/context directly**

`compactRestGenerationTask` becomes a compatibility adapter for old task files; new `buildGenerationInput` supplies the canonical prompt without regex slicing. Preserve raw agentic tasks for explicit CLI-agent workflows only.

- [ ] **Step 6: Run IR, prompt, client, reviewer, and full self-tests**

Run: `node --test scripts/ai/__tests__/generation-ir.test.mjs scripts/ai/__tests__/rest-prompt.test.mjs scripts/ai/__tests__/ai-client.test.mjs`
Run: `npm run ai:test:self` from `packages/web`.

### Task 2: Recording prompt compaction and deterministic scaffolding

**Files:**
- Create: `packages/web/scripts/ai/lib/recording-generation-ir.mjs`
- Modify: `packages/web/scripts/ai/create-recording-generation-task.mjs`
- Modify: `packages/web/scripts/ai/lib/rest-prompt.mjs`
- Test: `packages/web/scripts/ai/__tests__/recording-generation-ir.test.mjs`

**Interfaces:**
- Produces: `compileRecordingGenerationIr(normalizedRecording)` and `renderRecordingGenerationIr(ir)`.

- [ ] **Step 1: Add a failing checkout-recording size/semantic test**

Require the compact payload to retain target, exact header, every `RSTEP`/`ASSERT` identifier, normalized action/assertion data, and policy version while using at most 65% of the current task characters.

- [ ] **Step 2: Run the test and confirm the module is missing**

Run: `node --test scripts/ai/__tests__/recording-generation-ir.test.mjs`

- [ ] **Step 3: Implement recording IR and deterministic header/data scaffolding**

Minify normalized recording JSON and omit duplicated narrative lists/commands. Keep generated header, tags/annotations, and normalized constants deterministic rather than asking the model to rediscover them.

- [ ] **Step 4: Route REST recording prompts through the IR**

Keep CLI agent tasks readable, but ensure REST no longer fails open to the full 9k-character playbook.

- [ ] **Step 5: Run recording validation/review/self-tests**

Run: `node --test scripts/ai/__tests__/recording-generation-ir.test.mjs scripts/ai/__tests__/rest-prompt.test.mjs`
Run: `npm run ai:recording:validate -- --dir recordings`
Run: `npm run ai:test:self`.

### Task 3: Safe provider and exact cache behavior

**Files:**
- Modify: `packages/web/scripts/ai/lib/ai-client.mjs`
- Modify: `packages/web/scripts/ai/lib/generation-cache.mjs`
- Modify: `packages/web/scripts/ai/verified-generate.mjs`
- Modify: `packages/web/.env.example`
- Test: `packages/web/scripts/ai/__tests__/ai-client.test.mjs`
- Test: `packages/web/scripts/ai/__tests__/generation-cache.test.mjs`
- Test: `packages/web/scripts/ai/__tests__/verified-generate.test.mjs`

**Interfaces:**
- Produces: `promoteGenerationCache(candidate, { qualityFingerprint })`, `rejectGenerationCache(candidate, reason)`.
- Changes: `runBrain` returns an unverified `cacheCandidate` after a provider miss; accepted cache reads require `validationStatus === 'accepted'`.

- [ ] **Step 1: Add failing default/cache-state/key tests**

Assert provider caching is absent unless `AI_PROMPT_CACHE=true`; syntax-only entries are not returned; accepted entries are returned; `OPENAI_VERBOSITY`, output contract, policy/context fingerprints, and every output-affecting setting change the key.

- [ ] **Step 2: Add a failing concurrent identical-miss test**

Start two `runBrain` calls with the same key and an injected delayed transport; assert the transport executes exactly once and both callers receive the same result.

- [ ] **Step 3: Implement opt-in provider caching and explicit stable-prefix support**

For GPT-5.6, when enabled, use `prompt_cache_options.mode: 'explicit'` and a breakpoint only on a cacheable stable content block. For Anthropic, place `cache_control` on the stable system block rather than the top-level changing request. If the stable prefix is below the provider minimum, skip caching and report that decision.

- [ ] **Step 4: Implement accepted/unverified cache states and single-flight**

Write unverified candidates privately, read accepted entries by default, promote only after verified generation succeeds, and quarantine rejected candidates. Use an in-process `Map<cacheKey, Promise>` with cleanup in `finally`.

- [ ] **Step 5: Document settings and run focused/full tests**

Run: `node --test scripts/ai/__tests__/ai-client.test.mjs scripts/ai/__tests__/generation-cache.test.mjs scripts/ai/__tests__/verified-generate.test.mjs`
Run: `npm run ai:test:self`.

### Task 4: Stage-aware routing and output guardrails

**Files:**
- Modify: `packages/web/scripts/ai/lib/ai-client.mjs`
- Modify: `packages/web/scripts/ai/ai-doctor.mjs`
- Modify: `packages/ui/scripts/fit-runner.mjs`
- Modify: `packages/web/.env.example`
- Modify: `packages/web/docs/ai-testing/TOKEN_ECONOMY.md`
- Test: `packages/web/scripts/ai/__tests__/ai-client.test.mjs`

**Interfaces:**
- Changes: `selectBrain(env, { stage = 'test-generation' })` reads stage-prefixed overrides before global values.
- Stage names: `spec-fit`, `test-generation`, `recording-generation`, `repair`.

- [ ] **Step 1: Add failing stage-selection tests**

Assert `AI_SPEC_FIT_BRAIN`/model overrides affect only fit, global defaults remain unchanged, and an absent stage override preserves current selection order. Assert stage-specific max-token settings are honored.

- [ ] **Step 2: Run focused tests and confirm stage is ignored**

Run: `node --test scripts/ai/__tests__/ai-client.test.mjs`

- [ ] **Step 3: Implement stage-aware resolution without automatic model changes**

Normalize stage names to uppercase env prefixes. Pass `stage: 'spec-fit'` from the fit runner and corresponding stages from flow/recording generation. Report effective stage settings in `ai-doctor` without printing keys.

- [ ] **Step 4: Add optional deterministic escalation configuration**

Expose a stronger repair route only to `verified-generate` after a recorded static failure. Limit it to one repair attempt and include reviewer diagnostics plus previous source, not the full original playbook twice. Default escalation remains disabled.

- [ ] **Step 5: Run client, doctor, fit, and full tests**

Run: `node --test scripts/ai/__tests__/ai-client.test.mjs`
Run: `node --test tests/server.test.mjs tests/handlers.test.mjs` from `packages/ui`.
Run: `npm run ai:test:self` from `packages/web`.

