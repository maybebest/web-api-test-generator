# Generation Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every prompt-to-test path uses a validated, task-specific output contract with bounded DOM/repository context and candidate-safe promotion.

**Architecture:** Add explicit output-contract and generation-input modules, then route UI and CLI calls through them. Assemble compact context before REST calls, generate into a same-directory candidate, run deterministic fast acceptance, and atomically promote only accepted code.

**Tech Stack:** Node.js ESM, JSON Schema structured outputs, Playwright Test, Node test runner, TypeScript compiler API already used by the repository.

## Global Constraints

- Preserve the existing dirty `sains` working tree; never reset, overwrite, or commit unrelated user changes.
- Use `apply_patch` for edits and add a failing regression test before each production change.
- Make no paid provider calls; provider behavior must use injected fake transports.
- Keep the HAR/API generator token-free and out of scope.
- Do not weaken spec validation, locator policy, security rules, static review, or the three-repeat full gate.
- Never persist prompts, secrets, auth state, or complete DOM snapshots in telemetry/cache metadata.

---

### Task 1: Task-specific output contracts

**Files:**
- Create: `packages/web/scripts/ai/lib/output-contracts.mjs`
- Modify: `packages/web/scripts/ai/lib/ai-client.mjs`
- Modify: `packages/ui/scripts/fit-runner.mjs`
- Test: `packages/web/scripts/ai/__tests__/ai-client.test.mjs`
- Test: `packages/ui/tests/server.test.mjs`

**Interfaces:**
- Produces: `OUTPUT_KINDS`, `getOutputContract(kind)`, `decodeStructuredOutput(raw, contract)`, `renderFlowSpecDraft(draft)`, `validateContractOutput(text, contract)`.
- Changes: `runBrain(prompt, { outputKind = OUTPUT_KINDS.playwright, stage = 'test-generation', ... })`.

- [ ] **Step 1: Add a failing provider request-shape test**

```js
const result = await runBrain('rough notes', {
  env: openAiEnv,
  fetchImpl,
  outputKind: 'flow-spec-draft',
  systemPrompt: 'Convert notes into a flow spec.'
});
assert.doesNotMatch(sent.messages[0].content, /TypeScript|Playwright/);
assert.ok(sent.response_format.json_schema.schema.properties.flowTitle);
assert.match(result.text, /^# Flow:/);
```

- [ ] **Step 2: Run the focused test and confirm it fails because the current schema has only `code`**

Run: `node --test scripts/ai/__tests__/ai-client.test.mjs`

- [ ] **Step 3: Implement `output-contracts.mjs`**

Define strict contracts named `playwright-typescript/v1` and `flow-spec-draft/v1`. The flow draft schema contains `flowTitle`, `metadataRows: [{ field, value }]`, and `sections: [{ heading, markdown }]`; its decoder validates arrays/strings and renders one Markdown document without fences. The Playwright decoder preserves the existing fenced-TypeScript compatibility result.

- [ ] **Step 4: Parameterize provider schemas and decoding in `runBrain`**

Replace `CODE_OUTPUT_SCHEMA`, `structuredSystemPrompt`, and `wrapStructuredCode` branching with the selected contract. Include `outputKind` and contract version in cache knobs. For CLI flow fitting, prepend the custom system prompt to stdin; preserve raw task stdin for default Playwright CLI generation.

- [ ] **Step 5: Pass `outputKind: 'flow-spec-draft'` from `fit-runner.mjs` and add a UI regression assertion**

The UI test must verify the runner source/request includes the flow output kind and that a rendered draft passes `extractMarkdownSpec` shape checks.

- [ ] **Step 6: Run focused tests**

Run: `node --test scripts/ai/__tests__/ai-client.test.mjs`
Run: `node --test tests/server.test.mjs tests/handlers.test.mjs` from `packages/ui`.

### Task 2: One validated generation-input builder

**Files:**
- Create: `packages/web/scripts/ai/lib/generation-input.mjs`
- Modify: `packages/web/scripts/ai/create-generation-task.mjs`
- Modify: `packages/web/scripts/ai/ai-generate.mjs`
- Modify: `packages/ui/src/server.mjs`
- Modify: `packages/ui/public/app.js`
- Test: `packages/web/scripts/ai/__tests__/generation-input.test.mjs`
- Test: `packages/ui/tests/handlers.test.mjs`

**Interfaces:**
- Produces: `buildGenerationInput({ specPath, targetTestFile, domArtifactPath, mode }) -> { prompt, validation, generationMode, specSha256, targetTestFile, domArtifactPath }`.
- Consumes: `createTaskContent`, `validateSpecFile`, `resolveGenerationMode`, and reviewed DOM-artifact resolution.

- [ ] **Step 1: Add failing equivalence and invalid-spec tests**

The equivalence test builds input for a temporary valid spec and asserts its prompt includes the exact target, behavioral hash, resolved mode, exact header, and DOM section. The invalid test asserts the builder throws before `runBrain` can be invoked.

- [ ] **Step 2: Run the new test and confirm `generation-input.mjs` is missing**

Run: `node --test scripts/ai/__tests__/generation-input.test.mjs`

- [ ] **Step 3: Export DOM resolution and implement the builder**

Move orchestration—not parsing—out of the CLI entry point. `create-generation-task.mjs` continues to write task/manifest files by consuming the shared builder.

- [ ] **Step 4: Route `ai-generate --spec` through the builder**

When `args.spec` is present, resolve `args.out` first and build the validated prompt. Do not read the raw spec as the provider prompt. Preserve task-file mode for explicit task inputs.

- [ ] **Step 5: Keep the UI endpoint simple but prove saved-spec generation reaches the builder**

Add a handler test asserting the generated command contains `--spec` and `--out`; pair it with the `ai-generate` regression test proving `--spec` is no longer raw. Do not add a second task-building child process.

- [ ] **Step 6: Run focused tests**

Run: `node --test scripts/ai/__tests__/generation-input.test.mjs scripts/ai/__tests__/ai-client.test.mjs`
Run: `node --test tests/handlers.test.mjs` from `packages/ui`.

### Task 3: Bounded DOM and repository context pack

**Files:**
- Create: `packages/web/scripts/ai/lib/generation-context-pack.mjs`
- Modify: `packages/web/scripts/ai/lib/generation-input.mjs`
- Modify: `packages/web/scripts/ai/create-generation-task.mjs`
- Modify: `packages/web/scripts/ai/lib/generation-cache.mjs`
- Test: `packages/web/scripts/ai/__tests__/generation-context-pack.test.mjs`
- Test: `packages/web/scripts/ai/__tests__/rest-prompt.test.mjs`

**Interfaces:**
- Produces: `buildGenerationContextPack({ webRoot, specPath, targetTestFile, domArtifactPath, validation, maxChars = 24000 })` and `renderGenerationContextPack(pack)`.
- Pack fields: `schemaVersion`, `fingerprint`, `dom`, `fixtures`, `pageObjects`, `existingTarget`.

- [ ] **Step 1: Add failing context-pack tests**

Use temporary fixtures to assert that only locator candidates with `matchCount === 1` survive, secret-like fields are omitted, fixture exports/class method signatures are present, existing target contents are bounded, and changing any included source changes the fingerprint.

- [ ] **Step 2: Run the test and confirm the module is missing**

Run: `node --test scripts/ai/__tests__/generation-context-pack.test.mjs`

- [ ] **Step 3: Implement bounded extraction**

Read the already-reviewed DOM artifact, flatten typed candidate locators, retain URL/capture/hash metadata, extract exported fixture identifiers and public class method signatures with deterministic sorting, include the existing target only up to the remaining budget, and hash the canonical JSON representation.

- [ ] **Step 4: Embed context data instead of a path-only instruction**

Change `createTaskContent` so `## DOM and Repository Context` contains `renderGenerationContextPack(pack)`. A path may remain as provenance, but the contract must not claim REST can read it.

- [ ] **Step 5: Add the context fingerprint to cache inputs and task manifests**

The manifest stores only the fingerprint and artifact provenance. The exact-cache key receives the fingerprint explicitly even though prompt content also changes.

- [ ] **Step 6: Run context, prompt, cache, and full AI self-tests**

Run: `node --test scripts/ai/__tests__/generation-context-pack.test.mjs scripts/ai/__tests__/rest-prompt.test.mjs scripts/ai/__tests__/generation-cache.test.mjs`
Run: `npm run ai:test:self` from `packages/web`.

### Task 4: Candidate-safe verified generation

**Files:**
- Create: `packages/web/scripts/ai/verified-generate.mjs`
- Modify: `packages/web/scripts/ai/ai-generate.mjs`
- Modify: `packages/web/package.json`
- Modify: `packages/ui/src/server.mjs`
- Test: `packages/web/scripts/ai/__tests__/verified-generate.test.mjs`
- Test: `packages/ui/tests/handlers.test.mjs`

**Interfaces:**
- Produces: `runVerifiedGeneration({ specPath, targetTestFile, mode, dependencies })`.
- Consumes: `buildGenerationInput`, `runBrain`, `extractCodeBlock`, static review, and the fast gate added by the gates plan.

- [ ] **Step 1: Add failing atomic-promotion tests**

Create a known-good target and injected fake generator/gate. Assert a failed review/gate leaves the target byte-for-byte unchanged and moves diagnostics under `.ai-runs`; assert success atomically renames the candidate over the target.

- [ ] **Step 2: Run the test and confirm the orchestrator is missing**

Run: `node --test scripts/ai/__tests__/verified-generate.test.mjs`

- [ ] **Step 3: Implement same-directory candidate generation**

Use `<base>.candidate-<uuid>.spec.ts` so relative imports and Playwright matching equal the final target. Always clean or archive the candidate in `finally`; never delete the previous target on failure.

- [ ] **Step 4: Run static review and fast acceptance before `rename`**

Inject dependencies in tests. Production uses the existing reviewer and `ai:test:gate:fast`. Persist sanitized stage diagnostics with the generation run identifier.

- [ ] **Step 5: Route the UI Generate endpoint and `--spec` CLI through verified generation**

Keep an explicit `--draft-only` escape hatch for task experimentation; the default saved-spec path is verified. Add `ai:brain:generate:verified` to `packages/web/package.json`.

- [ ] **Step 6: Run focused and package tests**

Run: `node --test scripts/ai/__tests__/verified-generate.test.mjs`
Run: `node --test tests/handlers.test.mjs` from `packages/ui`.
Run: `npm run ai:test:self` from `packages/web`.

