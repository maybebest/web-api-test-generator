# Event-Sourced AI Runs v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mutable generation/healer run manifests with one hard-cutover, append-only event-sourced v2 implementation, then prove it against the exact failure modes observed in the real PsychicBook generator and healer runs.

**Architecture:** A shared v2 event store writes hash-chained JSONL streams and deterministic projections; a shared artifact store binds sanitized content-addressed evidence. Generation and healer reducers own their domain state, while Playwright verdicts, secret policies, runtime triage, locator provenance, and atomic source replacement remain focused modules consumed by both workflows.

**Tech Stack:** Node.js 20+ ESM, built-in `node:crypto`/`node:fs`, `node:test`, TypeScript compiler API, Playwright Test 1.59.1, existing repository reviewers/gates, npm workspaces.

**Approved design:** `docs/superpowers/specs/2026-08-04-event-sourced-ai-runs-v2-design.md`. Its event lists, state transitions, security boundary, and acceptance criteria are normative when a task below says “design events” or “required checks.”

## Global Constraints

- Implement only `ai-run-event/v2`; remove v1 readers, writers, adapters, migrations, dual-write branches, and runtime feature switches.
- Write new run data only below `packages/web/.ai-runs/v2/{generation,heal}/RUN_ID/`.
- Do not delete old `.ai-runs/generation/` or `.ai-runs/heal/` data automatically; v2 ignores it.
- Do not add a runtime dependency. Runtime schemas, canonical JSON, locking, hashing, and projection replay use Node.js built-ins.
- Treat `events.jsonl` as the only source of truth. No target/cache mutation may depend on an unverified `projection.json`.
- Event payloads are sanitized before hashing/persistence and are at most 64 KiB; larger evidence is a bounded content-addressed artifact.
- Candidate promotion gate stays `repeatEach=2`, full generation gate stays `repeatEach=3`, and all acceptance uses `retries=0`.
- Healer proposal verification defaults to two serial runs with `workers=1`, `retries=0`; apply repeats the proposal's recorded count and then runs a post-apply gate.
- A proven full-gate `runtime-test` is sticky for `(runId, candidateId, sourceSha256)`; a later pass is recorded but cannot restore acceptance.
- `runtime-environment` remains unknown quality and may be retried for the unchanged candidate.
- `web:ai:heal` is proposal-only. `web:ai:heal:apply -- --run RUN_ID` applies archived bytes and must not initialize AI/provider transport.
- Preserve the existing safe-healing semantic guard: assertions, expected operands, titles, tags, annotations, imports, fixtures, data, actions, source headers, AC/NEG/recording tokens, and source-contract fingerprints are immutable.
- Keep runtime credential and identity values, verification codes, cookies, auth headers, storage state, raw prompts, and raw authenticated browser artifacts out of provider input, events, projections, diffs, and stored artifacts. Generated source uses approved env/fixture abstractions; source-literal policy does not automatically treat a collision-prone Basic-auth username as forbidden merely because output policy redacts it.
- Use runtime environment variables for the PsychicBook URL, HTTP Basic values, returning-user email, and verification code; never place their values in commands, plan output, source, or Git history.
- Preserve unrelated dirty-worktree changes. Stage and commit only the files named by the current task.
- Run unprefixed `node`, `npx`, and `npm run ai:*`/web test commands from `packages/web`. Run every `git` command and any root `web:*` npm command from the repository root.
- Before implementation, use `superpowers:using-git-worktrees`. The reviewed working tree contains uncommitted gate/env fixes, so do not seed the worktree from `HEAD` alone: first obtain user permission for a safe snapshot/commit or establish an equivalent isolated copy of the exact reviewed state without discarding or staging unrelated work.
- Follow red-green-refactor for every behavior change. A test must fail for the expected missing/wrong behavior before production code is changed.

---

## Evidence Basis from Real Runs

This plan is grounded in these reviewed artifacts, not a hypothetical redesign:

- Accepted generation run `76874107-5899-4ead-9e66-fdd483eb6522` followed six rejected/environment/runtime attempts and consumed seven provider calls.
- The reviewed generation calls used 115,749 input tokens and 9,696 output tokens (125,445 total) over 229,350 ms, which makes prompt/cache telemetry an operational requirement.
- The reviewed run whose ID begins `b2b0` produced two genuine Playwright passes, but the then-current `repeatEach` report verifier rejected the official JSON shape.
- The first linked full gate for the accepted candidate contained two passes and one target timeout while the stage UI returned a registration error; a later two-pass history overwrote the mutable manifest's visible failure.
- A controlled `maxFailures=1` report was categorized as environment despite a proven target failure.
- Healer run `1785791607692-71571-35906863-326f-49b3-82da-5b4ef9925aec` produced `proposal-ready`, passed all checks, used two verification runs, and consumed 16,384 provider tokens.
- The multiline evidence `locator.click timeout` plus `element(s) not found` was classified as `synchronization/ACTIONABILITY_TIMEOUT` because the fallback locator regex did not cross newlines.
- The archived healer candidate and applied target differed only by the final LF.
- The reviewed proposal had no supported later apply-by-run-ID path; only same-invocation `--apply` existed.
- The accepted generated account-settings locator used a one-character accessible name, but its discovery uniqueness evidence was not linked to the generated candidate.

Each observation has a named regression test in the tasks below.

## File Structure

### Shared v2 substrate

- Create `packages/web/scripts/ai/lib/ai-run-canonical.mjs` — canonical JSON, SHA-256 helpers, event envelope creation/validation.
- Create `packages/web/scripts/ai/lib/ai-run-artifact-store.mjs` — bounded sanitization, candidate LF normalization, content-addressed artifact I/O.
- Create `packages/web/scripts/ai/lib/ai-run-store.mjs` — run directories, append locks, JSONL writes, verified replay, projection replacement, tail recovery.
- Create `packages/web/scripts/ai/lib/generation-run-v2.mjs` — generation event schemas, reducer, projection contract, generation store factory.
- Create `packages/web/scripts/ai/lib/heal-run-v2.mjs` — healer event schemas, reducer, projection contract, healer store factory.

### Shared policies and evidence

- Create `packages/web/scripts/ai/lib/runtime-env-policy.mjs` — subprocess environment forwarding only.
- Create `packages/web/scripts/ai/lib/output-redaction-policy.mjs` — recursive persistence/provider redaction only.
- Create `packages/web/scripts/ai/lib/source-secret-policy.mjs` — source-literal admission only.
- Create `packages/web/scripts/ai/lib/playwright-report-verdict.mjs` — official JSON report normalization and logical-test aggregation.
- Create `packages/web/scripts/ai/lib/ai-gate-verdict.mjs` — `ai-gate-verdict/v2` construction, sanitization, and artifact summary.
- Create `packages/web/scripts/ai/lib/runtime-triage.mjs` — structured-first, multiline-safe healer triage.
- Create `packages/web/scripts/ai/lib/locator-provenance.mjs` — discovery fingerprinting and source-locator evidence matching.
- Create `packages/web/scripts/ai/lib/atomic-target-update.mjs` — snapshot-checked promotion and rollback used by generation/apply.

### Workflow boundaries

- Modify `packages/web/scripts/ai/verified-generate.mjs` — emit generation v2 events/artifacts and perform write-ahead promotion.
- Modify `packages/web/scripts/ai/generated-test-gate.mjs` — use v2 verdicts and append full-gate attempts to generation streams.
- Modify `packages/web/scripts/ai/lib/generated-gate-runner.mjs` — consume the extracted report/verdict APIs.
- Modify `packages/web/scripts/ai/gate-all.mjs` — pass v2 run linkage without manifest mutation.
- Modify `packages/web/scripts/ai/lib/generation-cache.mjs` — v4-only cache binding and event-driven invalidation.
- Create `packages/web/scripts/ai/lib/heal-verification.mjs` — baseline/candidate checks shared by proposal and apply.
- Create `packages/web/scripts/ai/lib/heal-proposal.mjs` — proposal-only healer orchestration.
- Create `packages/web/scripts/ai/lib/heal-proposal-apply.mjs` — apply-by-run-ID, recovery, post-gate, rollback.
- Reduce `packages/web/scripts/ai/heal-test.mjs` to a proposal CLI.
- Create `packages/web/scripts/ai/apply-heal-proposal.mjs` as the apply CLI.
- Rewrite `packages/web/scripts/ai/token-usage-report.mjs` to read only verified v2 generation/heal streams.

### Hard-cutover deletions

- Delete `packages/web/scripts/ai/lib/generation-run.mjs`.
- Delete `packages/web/scripts/ai/lib/generation-quality.mjs`.
- Delete `packages/web/scripts/ai/lib/generated-gate-verdict.mjs`.
- Delete `packages/web/scripts/ai/lib/test-heal-triage.mjs`.
- Delete `packages/web/scripts/ai/lib/gate-environment.mjs` after all imports move to `runtime-env-policy.mjs`.
- Remove v1/legacy branches from `packages/web/scripts/ai/ai-generate.mjs`, `packages/web/scripts/ai/lib/ai-client.mjs`, and `packages/web/scripts/ai/token-usage-report.mjs`.

---

### Task 1: Canonical v2 Event Envelope

**Files:**
- Create: `packages/web/scripts/ai/lib/ai-run-canonical.mjs`
- Create: `packages/web/scripts/ai/__tests__/ai-run-canonical.test.mjs`

**Interfaces:**
- Produces: `AI_RUN_EVENT_SCHEMA`, `AI_RUN_SCHEMA_VERSION`, `AI_RUN_STREAM_KINDS`, `canonicalJson(value)`, `sha256Hex(bytes)`, `createAiRunEvent(input)`, `validateAiRunEvent(event, expected)`.
- Consumes: Node `crypto`; no repository module dependency.
- Private implementation contract: `validateEventBody(body)` validates the unhashed envelope before `createAiRunEvent` hashes it; it is not exported.

- [ ] **Step 1: Write failing known-vector and validation tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalJson,
  createAiRunEvent,
  validateAiRunEvent
} from '../lib/ai-run-canonical.mjs';

test('canonical JSON recursively sorts object keys and preserves array order', () => {
  assert.equal(canonicalJson({ z: 1, a: { d: 4, b: 2 }, list: [3, 1] }),
    '{"a":{"b":2,"d":4},"list":[3,1],"z":1}');
});

test('event hash covers run, sequence, payload, and previous hash', () => {
  const event = createAiRunEvent({
    streamKind: 'generation',
    runId: '11111111-1111-4111-8111-111111111111',
    eventId: '22222222-2222-4222-8222-222222222222',
    sequence: 1,
    occurredAt: '2026-08-04T12:00:00.000Z',
    type: 'run.started',
    payload: { commandVersion: 'v2' },
    previousEventHash: null
  });
  assert.equal(event.eventHash, 'b26ca560a0fca6070e24105b2794ccfa5261ae9274f4b165845fd6de99b77d6d');
  assert.deepEqual(validateAiRunEvent(event, {
    streamKind: 'generation', runId: event.runId, sequence: 1, previousEventHash: null
  }), event);
  assert.throws(() => validateAiRunEvent({ ...event, payload: { commandVersion: 'edited' } }, {
    streamKind: 'generation', runId: event.runId, sequence: 1, previousEventHash: null
  }), /hash/i);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run from `packages/web`:

```bash
node --test scripts/ai/__tests__/ai-run-canonical.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `ai-run-canonical.mjs`.

- [ ] **Step 3: Implement canonical serialization and event validation**

Use these exact public constants and envelope fields:

```js
export const AI_RUN_EVENT_SCHEMA = 'ai-run-event/v2';
export const AI_RUN_SCHEMA_VERSION = 2;
export const AI_RUN_STREAM_KINDS = new Set(['generation', 'heal']);
export const MAX_EVENT_PAYLOAD_BYTES = 64 * 1024;

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function createAiRunEvent(input) {
  const body = Object.freeze({
    schema: AI_RUN_EVENT_SCHEMA,
    schemaVersion: AI_RUN_SCHEMA_VERSION,
    streamKind: input.streamKind,
    runId: input.runId,
    eventId: input.eventId,
    sequence: input.sequence,
    occurredAt: input.occurredAt,
    type: input.type,
    payload: input.payload,
    previousEventHash: input.previousEventHash
  });
  validateEventBody(body);
  return Object.freeze({ ...body, eventHash: sha256Hex(Buffer.from(canonicalJson(body), 'utf8')) });
}
```

Reject unknown envelope keys, non-UUID run/event IDs, sequence below one, invalid ISO timestamps, unsupported stream kinds, invalid event names, `undefined`, cycles, non-finite numbers, and payloads above 64 KiB.

- [ ] **Step 4: Run focused tests and add mutation vectors**

Add cases for reordered/deleted internal events, cross-run event reuse, wrong previous hash, unsupported schema, oversized payload, cyclic objects, and `NaN`. Re-run the focused command; expected PASS with zero failures.

- [ ] **Step 5: Commit the isolated component**

```bash
git add packages/web/scripts/ai/lib/ai-run-canonical.mjs packages/web/scripts/ai/__tests__/ai-run-canonical.test.mjs
git commit -m "feat(web): add canonical AI run events"
```

---

### Task 2: Content-Addressed Artifact Store and Exact Candidate Bytes

**Files:**
- Create: `packages/web/scripts/ai/lib/ai-run-artifact-store.mjs`
- Create: `packages/web/scripts/ai/__tests__/ai-run-artifact-store.test.mjs`

**Interfaces:**
- Consumes: `sha256Hex` from Task 1 and injected `admit({ kind, mediaType, bytes })` policy.
- Produces: `normalizeCandidateSource(value)`, `createAiRunArtifactStore({ runDirectory, admit })` with `write(input)` and `read(reference)`.
- Private implementation contract: `writeArtifact({ runDirectory, admit, input })` and `readArtifact({ runDirectory, reference })` enforce the fixed kind map, bounds, path checks, hashes, and exact bytes; they are not exported.

- [ ] **Step 1: Write failing normalization, dedupe, and rejection tests**

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAiRunArtifactStore } from '../lib/ai-run-artifact-store.mjs';
import { sha256Hex } from '../lib/ai-run-canonical.mjs';

function testArtifactStore(t, { rejectKind } = {}) {
  const runDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-artifacts-'));
  fs.mkdirSync(path.join(runDirectory, 'artifacts'), { mode: 0o700 });
  t.after(() => fs.rmSync(runDirectory, { recursive: true, force: true }));
  const store = createAiRunArtifactStore({
    runDirectory,
    admit: ({ kind, bytes }) => {
      if (kind === rejectKind) throw new Error('SOURCE_POLICY_REJECTED');
      return { bytes, sanitization: 'test-policy-passed' };
    }
  });
  return Object.assign(store, { runDirectory });
}

test('candidate source is admitted with exactly one final LF and applied bytes stay identical', (t) => {
  const store = testArtifactStore(t);
  const ref = store.write({
    kind: 'candidate-source', mediaType: 'text/typescript', bytes: Buffer.from('const x = 1;\n\n')
  });
  assert.deepEqual(store.read(ref), Buffer.from('const x = 1;\n'));
  assert.equal(ref.sha256, sha256Hex(Buffer.from('const x = 1;\n')));
});

test('original source remains byte exact and unsafe source is not written', (t) => {
  const store = testArtifactStore(t, { rejectKind: 'candidate-source' });
  assert.throws(() => store.write({
    kind: 'candidate-source', mediaType: 'text/typescript', bytes: Buffer.from('unsafe')
  }), /SOURCE_POLICY_REJECTED/);
  assert.deepEqual(fs.readdirSync(path.join(store.runDirectory, 'artifacts')), []);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
node --test scripts/ai/__tests__/ai-run-artifact-store.test.mjs
```

Expected: FAIL because the artifact-store module does not exist.

- [ ] **Step 3: Implement trusted-kind limits and atomic writes**

Use fixed limits: source/diff 2 MiB, locator provenance 4 MiB, gate report 32 MiB, and all other admitted JSON/text artifacts 1 MiB. Extension comes from a kind-to-extension map, never directly from provider input. `write()` must sanitize/admit before hashing, write a `0600` temporary file, `fsync`, rename to `artifacts/SHA256.EXTENSION`, and verify an existing content-addressed file before reuse.

```js
export function normalizeCandidateSource(value) {
  return Buffer.from(String(value).replace(/(?:\r?\n)*$/, '') + '\n', 'utf8');
}

export function createAiRunArtifactStore({ runDirectory, admit }) {
  return Object.freeze({
    runDirectory,
    write: (input) => writeArtifact({ runDirectory, admit, input }),
    read: (reference) => readArtifact({ runDirectory, reference })
  });
}
```

- [ ] **Step 4: Add corruption and orphan cases, then run GREEN**

Test hash/path disagreement, symlink refusal, traversal refusal, missing artifact, oversized artifact, original-source byte preservation, candidate CRLF/final-LF normalization, and an unreferenced orphan that has no store state. Expected: all focused tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/scripts/ai/lib/ai-run-artifact-store.mjs packages/web/scripts/ai/__tests__/ai-run-artifact-store.test.mjs
git commit -m "feat(web): add AI run artifact store"
```

---

### Task 3: Append-Only Event Store and Verified Projection Replay

**Files:**
- Create: `packages/web/scripts/ai/lib/ai-run-store.mjs`
- Create: `packages/web/scripts/ai/__tests__/ai-run-store.test.mjs`

**Interfaces:**
- Consumes: Task 1 envelope APIs; injected `validatePayload(type, payload)`, `redactPayload(payload)`, and `reduce(events)`.
- Produces: `createAiRunStore(options)` with `create({ runId, startedPayload })`, `append({ runId, type, payload })`, `loadVerified(runId)`, and `rebuildProjection(runId)`.
- Produces stable integrity error `EVENT_STREAM_TRUNCATED` when the existing local projection head is ahead of the retained committed stream.
- Private implementation contract: `normalizeStoreOptions(options)`, `createRun(context, input)`, `appendRunEvent(context, input)`, `loadVerifiedRun(context, runId)`, and `rebuildRunProjection(context, runId)` back the public store methods and are not exported.

- [ ] **Step 1: Write failing create/append/replay tests**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAiRunStore } from '../lib/ai-run-store.mjs';

test('create, append, and replay use events as truth', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-run-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runId = '11111111-1111-4111-8111-111111111111';
  const store = createAiRunStore({
    root,
    streamKind: 'generation',
    validatePayload: () => undefined,
    redactPayload: (value) => value,
    reduce: (events) => ({ types: events.map((event) => event.type) }),
    now: () => new Date('2026-08-04T12:00:00.000Z'),
    randomId: (() => {
      let nextId = 1;
      return () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
    })()
  });

  store.create({ runId, startedPayload: { commandVersion: 'v2' } });
  store.append({ runId, type: 'subject.bound', payload: { target: 'tests/example.spec.ts' } });
  const loaded = store.loadVerified(runId);
  assert.deepEqual(loaded.events.map((event) => event.sequence), [1, 2]);
  assert.deepEqual(loaded.state.types, ['run.started', 'subject.bound']);
});
```

Add a test that edits only `projection.json.state` while preserving `builtFrom`; `loadVerified()` must replay events, detect the state-hash mismatch, and replace the projection.

Add the inverse checkpoint test: after a valid three-event stream/projection, remove the final committed event while leaving `projection.builtFrom` at sequence three. `loadVerified()` must report `EVENT_STREAM_TRUNCATED` and must not rebuild the projection or authorize a side effect.

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
node --test scripts/ai/__tests__/ai-run-store.test.mjs
```

Expected: FAIL because `createAiRunStore` is unavailable.

- [ ] **Step 3: Implement secure run creation and per-run append locking**

`create()` creates `ROOT/STREAM_KIND/RUN_ID/events.jsonl`, `projection.json`, and `artifacts/` with `0700/0600` permissions and rejects existing/symlinked paths. `append()` creates `.append.lock/owner.json` atomically, validates the full stream, redacts then validates the payload, appends one newline-terminated event, flushes file/directory, rebuilds the canonical projection, and removes only its nonce-matching lock.

```js
export function createAiRunStore(options) {
  const context = normalizeStoreOptions(options);
  return Object.freeze({
    create: (input) => createRun(context, input),
    append: (input) => appendRunEvent(context, input),
    loadVerified: (runId) => loadVerifiedRun(context, runId),
    rebuildProjection: (runId) => rebuildRunProjection(context, runId)
  });
}
```

- [ ] **Step 4: Implement deterministic projection bytes**

Projection must contain `schema: ai-run-projection/v2`, schema version, kind, run ID, `builtFrom.lastSequence`, `builtFrom.lastEventHash`, `stateHash`, and reducer `state`. `stateHash` is SHA-256 of canonical state. Do not include a generated-at timestamp.

- [ ] **Step 5: Run focused tests and verify GREEN**

Add cases for payload redaction before hash, 64 KiB enforcement, unknown event rejection, event after `run.closed`, projection behind a valid longer stream (safe rebuild), projection ahead of a truncated stream (fail closed), missing projection, and unverified projection refusal before a simulated side effect. Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/scripts/ai/lib/ai-run-store.mjs packages/web/scripts/ai/__tests__/ai-run-store.test.mjs
git commit -m "feat(web): add verified AI run event store"
```

---

### Task 4: Crash Recovery, Lock Recovery, and Concurrent Writers

**Files:**
- Modify: `packages/web/scripts/ai/lib/ai-run-store.mjs`
- Create: `packages/web/scripts/ai/__tests__/ai-run-recovery.test.mjs`
- Create: `packages/web/scripts/ai/__tests__/fixtures/ai-run-append-worker.mjs`

**Interfaces:**
- Extends: Task 3 `createAiRunStore` with `recover(runId)` and `garbageCollectOrphans(runId, { olderThanMs })`.
- Produces: stable errors `RUN_LOCKED`, `EVENT_STREAM_CORRUPT`, `EVENT_TAIL_RECOVERED`, and `ARTIFACT_ORPHAN_REMOVED`.

- [ ] **Step 1: Write failing partial-tail and stale-lock tests**

Create the shared fixture directory once from `packages/web`:

```bash
mkdir -p scripts/ai/__tests__/fixtures
```

Create a valid two-event stream, append an unterminated third JSON fragment, and require `recover()` to quarantine only that fragment and preserve the two committed events. Create a same-host live lock and require `RUN_LOCKED`; create an expired lock with a dead PID and require recovery.

- [ ] **Step 2: Write a failing concurrent-writer test**

Spawn four instances of `ai-run-append-worker.mjs`, each appending five uniquely identified domain events. After all children exit zero, require exactly 21 events (`run.started` plus 20), contiguous sequences, and a valid hash chain.

- [ ] **Step 3: Run recovery tests and confirm RED**

```bash
node --test scripts/ai/__tests__/ai-run-recovery.test.mjs
```

Expected: FAIL because recovery and stale-lock behavior are not implemented.

- [ ] **Step 4: Implement bounded recovery**

Only a final non-newline-terminated fragment may be quarantined/truncated automatically. Invalid committed JSON, schema mismatch, internal sequence gaps, wrong hashes, and ambiguous foreign-host locks throw without rewriting. Orphan GC removes only hash-named files not referenced by any event, older than the threshold, beneath that run's `artifacts/` directory.

- [ ] **Step 5: Run Task 3 and Task 4 tests**

```bash
node --test scripts/ai/__tests__/ai-run-canonical.test.mjs scripts/ai/__tests__/ai-run-artifact-store.test.mjs scripts/ai/__tests__/ai-run-store.test.mjs scripts/ai/__tests__/ai-run-recovery.test.mjs
```

Expected: PASS with zero failures and no orphan worker processes.

- [ ] **Step 6: Commit**

```bash
git add packages/web/scripts/ai/lib/ai-run-store.mjs packages/web/scripts/ai/__tests__/ai-run-recovery.test.mjs packages/web/scripts/ai/__tests__/fixtures/ai-run-append-worker.mjs
git commit -m "feat(web): recover interrupted AI run writes"
```

---

### Task 5: Generation Event Schemas and Sticky Quality Reducer

**Files:**
- Create: `packages/web/scripts/ai/lib/generation-run-v2.mjs`
- Rewrite: `packages/web/scripts/ai/__tests__/generation-run.test.mjs:1-1097`
- Create: `packages/web/scripts/ai/__tests__/fixtures/generation-run-v2-events.mjs`

**Interfaces:**
- Consumes: `createAiRunStore` and v2 event envelope.
- Produces: `GENERATION_EVENT_TYPES`, `validateGenerationPayload(type, payload)`, `reduceGenerationEvents(events)`, `createGenerationRunStore(options)`.
- Test fixture produces: `generationHistory(fullGatePayloads)` and `fullGateCompleted(payload)`; both build complete valid envelope sequences with Task 1 `createAiRunEvent`.

- [ ] **Step 1: Replace the mutable-manifest assertion with the reviewed sticky regression**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { reduceGenerationEvents } from '../lib/generation-run-v2.mjs';
import { fullGateCompleted, generationHistory } from './fixtures/generation-run-v2-events.mjs';

test('runtime-test then pass remains revoked while preserving both full-gate attempts', () => {
  const events = generationHistory([
    fullGateCompleted({ gateRunId: '33333333-3333-4333-8333-333333333333', classification: 'runtime-test', outcome: 'failed' }),
    fullGateCompleted({ gateRunId: '44444444-4444-4444-8444-444444444444', classification: 'passed', outcome: 'passed' })
  ]);
  const state = reduceGenerationEvents(events);
  assert.equal(state.quality.aggregate, 'revoked');
  assert.equal(state.quality.stickyFailure.gateRunId, '33333333-3333-4333-8333-333333333333');
  assert.deepEqual(state.fullGateAttempts.map((attempt) => attempt.outcome), ['failed', 'passed']);
});
```

This replaces the current v1 test that demonstrates the bug by expecting `manifest.quality.fullGatePassed === true` after `[false, true]`.

- [ ] **Step 2: Add failing environment-retry and transition tests**

Require environment → pass to become `fully-accepted`; runtime-test → pass to stay revoked; equal bytes in a new run/candidate ID to start fresh; changed subject SHA to reject linkage; duplicate attempt/candidate IDs to fail; any event after `run.closed` to fail.

- [ ] **Step 3: Run the generation-run test and confirm RED**

```bash
node --test scripts/ai/__tests__/generation-run.test.mjs
```

Expected: FAIL because `generation-run-v2.mjs` does not exist and the old mutable-manifest API no longer satisfies the test.

- [ ] **Step 4: Implement exact generation event validation**

Support the design event names: `run.started`, `subject.bound`, `input.assembled`, preflight/provider/candidate/review/gate/promotion/cache events, `generation.phase_completed`, `full_gate.started`, `full_gate.completed`, `run.abandoned`, and `run.closed`. Validate artifact refs, SHA-256 values, UUID IDs, repeat policy, reason-code labels, project arrays, and immutable subject fields.

```js
export function createGenerationRunStore({ webRoot, now, randomId, redactionPolicy }) {
  return createAiRunStore({
    root: path.join(webRoot, '.ai-runs', 'v2'),
    streamKind: 'generation',
    validatePayload: validateGenerationPayload,
    redactPayload: redactionPolicy,
    reduce: reduceGenerationEvents,
    now,
    randomId
  });
}
```

- [ ] **Step 5: Implement the generation projection contract**

Project immutable subject/input fingerprints, provider attempts, candidates keyed by candidate ID, gate attempts, promotion intent/result, cache history, full-gate history, aggregate quality, sticky failure, lifecycle, and next actions. `runtime-test` is sticky. `runtime-environment` never becomes candidate failure. A revoked stream remains open for diagnostic attempts until explicit closure.

- [ ] **Step 6: Run focused substrate and reducer tests**

```bash
node --test scripts/ai/__tests__/ai-run-*.test.mjs scripts/ai/__tests__/generation-run.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web/scripts/ai/lib/generation-run-v2.mjs packages/web/scripts/ai/__tests__/generation-run.test.mjs packages/web/scripts/ai/__tests__/fixtures/generation-run-v2-events.mjs
git commit -m "feat(web): reduce generation v2 events"
```

---

### Task 6: Healer Event Schemas and Proposal/Apply Reducer

**Files:**
- Create: `packages/web/scripts/ai/lib/heal-run-v2.mjs`
- Create: `packages/web/scripts/ai/__tests__/heal-run-v2.test.mjs`
- Create: `packages/web/scripts/ai/__tests__/fixtures/heal-run-v2-events.mjs`

**Interfaces:**
- Consumes: shared event store/artifact refs.
- Produces: `HEAL_EVENT_TYPES`, `validateHealPayload(type, payload)`, `reduceHealEvents(events)`, `createHealRunStore(options)`.
- Test fixture produces: `proposalReadyEvents()` and `appliedEvents()` as complete valid v2 envelope sequences with exact original/candidate/check fingerprints.

- [ ] **Step 1: Write failing proposal lifecycle tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { reduceHealEvents } from '../lib/heal-run-v2.mjs';
import { appliedEvents, proposalReadyEvents } from './fixtures/heal-run-v2-events.mjs';

test('proposal-ready remains open and applied closes only after exact apply evidence', () => {
  const ready = reduceHealEvents(proposalReadyEvents());
  assert.equal(ready.status, 'proposal-ready');
  assert.equal(ready.closed, false);
  const applied = reduceHealEvents(appliedEvents());
  assert.equal(applied.status, 'applied');
  assert.equal(applied.closed, true);
  assert.equal(applied.proposal.appliedSha256, applied.candidate.sha256);
});
```

Add failed-preflight retry, environment post-gate rollback to proposal-ready, runtime-test rollback to rejected/closed, rollback-blocked to manual-resolution-required/closed, duplicate apply ID, and event-after-close cases.

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
node --test scripts/ai/__tests__/heal-run-v2.test.mjs
```

Expected: FAIL because the healer reducer is missing.

- [ ] **Step 3: Implement healer event validation and reduction**

Support all design events from `run.started` through `proposal.ready`, apply intent/preflight/applied/failure/rollback/rejection/expiry, abandonment, and closure. Require `candidate.verified` to prove every recorded policy/typecheck/lint/review/drift/integrity/diff/runtime check before `proposal.ready`.

- [ ] **Step 4: Enforce immutable proposal identity**

Candidate identity is `(runId, candidateId, candidateSha256)`. `proposal.ready` binds original SHA, candidate SHA, source-contract fingerprint, check fingerprint, verification count, and artifact refs. Later events may reference these values but never replace them.

- [ ] **Step 5: Run focused tests and commit**

```bash
node --test scripts/ai/__tests__/ai-run-*.test.mjs scripts/ai/__tests__/heal-run-v2.test.mjs
git add packages/web/scripts/ai/lib/heal-run-v2.mjs packages/web/scripts/ai/__tests__/heal-run-v2.test.mjs packages/web/scripts/ai/__tests__/fixtures/heal-run-v2-events.mjs
git commit -m "feat(web): reduce healer v2 events"
```

---

### Task 7: Split Runtime Forwarding, Output Redaction, and Source-Literal Policy

**Files:**
- Create: `packages/web/scripts/ai/lib/runtime-env-policy.mjs`
- Create: `packages/web/scripts/ai/lib/output-redaction-policy.mjs`
- Create: `packages/web/scripts/ai/lib/source-secret-policy.mjs`
- Create: `packages/web/scripts/ai/__tests__/ai-secret-policies.test.mjs`
- Modify: `packages/web/scripts/ai/lib/secret-safety.mjs:1-89`
- Delete: `packages/web/scripts/ai/lib/gate-environment.mjs`
- Modify: `packages/web/scripts/ai/evals/golden-eval.mjs`
- Modify: `packages/web/scripts/ai/generated-test-gate.mjs`
- Modify: `packages/web/scripts/ai/heal-test.mjs`
- Modify: `packages/web/scripts/ai/lib/generated-gate-runner.mjs`
- Modify: `packages/web/scripts/ai/lib/generation-context-pack.mjs`
- Modify: `packages/web/scripts/ai/lib/generation-ir.mjs`
- Modify: `packages/web/scripts/ai/lib/generation-repair.mjs`
- Modify: `packages/web/scripts/ai/lib/test-heal-context.mjs`
- Modify: `packages/web/scripts/ai/lib/test-heal.mjs`
- Modify: `packages/web/scripts/ai/recording-gate-all.mjs`
- Modify: `packages/web/scripts/ai/recording-test-gate.mjs`
- Modify: `packages/web/scripts/ai/review-generated-test.mjs`
- Modify: `packages/web/scripts/ai/run-local-playwright.mjs`
- Modify: `packages/web/scripts/ai/verified-generate.mjs`
- Modify: `packages/web/scripts/ai/__tests__/generated-test-gate.test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/test-heal-context.test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/verified-generate.test.mjs`

**Interfaces:**
- Produces: `buildRuntimeEnvironment(source, { profile })`, `collectRedactionValues(source)`, `redactForPersistence(value, { source })`, `evaluateSourceLiterals(source, { environment })`.
- Preserves: low-level entropy/shape helpers in `secret-safety.mjs` without environment policy.
- Private implementation contract: `RUNTIME_ENV_NAMES_BY_PROFILE` is a closed profile map; `sourceForbiddenValues(environment)` derives forbidden non-empty values without returning them; `scanSource(source, forbiddenValues)` returns stable reason codes and never embeds matched bytes.

- [ ] **Step 1: Write failing policy-separation tests**

Require the Basic-auth username to be forwarded for external runtime and redacted from persisted output, but not automatically rejected as a source literal. Require Basic password, returning-user email, and verification code to be forwarded only to the permitted external runtime and rejected/redacted everywhere else. Require `PSYCHICBOOK_E2E_EMAIL` in the external runtime allowlist.

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
node --test scripts/ai/__tests__/ai-secret-policies.test.mjs
```

Expected: FAIL because the three policy modules do not exist.

- [ ] **Step 3: Implement the three non-overlapping APIs**

```js
export function buildRuntimeEnvironment(source, { profile }) {
  const names = RUNTIME_ENV_NAMES_BY_PROFILE.get(profile);
  if (!names) throw new Error(`Unknown runtime environment profile: ${profile}`);
  return Object.fromEntries([...names].filter((name) => source[name] !== undefined).map((name) => [name, source[name]]));
}

export function evaluateSourceLiterals(source, { environment }) {
  const forbiddenValues = sourceForbiddenValues(environment);
  const reasonCodes = scanSource(String(source), forbiddenValues);
  return Object.freeze({ passed: reasonCodes.length === 0, reasonCodes: Object.freeze(reasonCodes) });
}
```

Redaction recursively processes strings, arrays, and plain objects; bounds input before regex work; and never returns raw rejected material in an error.

- [ ] **Step 4: Prove the PsychicBook runtime-only source contract without committing live artifacts**

In `ai-secret-policies.test.mjs`, construct a synthetic safe helper that reads `PSYCHICBOOK_VERIFICATION_CODE`, requires exactly four ASCII digits, and contains no runtime value. Test it against a fake environment value and test an unsafe source string containing that fake value. Do not edit or stage the existing untracked PsychicBook specs/tests in this framework commit; Task 17 prepares those live experiment artifacts in place and deliberately leaves them uncommitted.

```ts
export function requirePsychicBookVerificationCode(): string {
  const code = process.env.PSYCHICBOOK_VERIFICATION_CODE?.trim();
  if (!code || !/^[0-9]{4}$/.test(code)) {
    throw new Error('Missing or invalid runtime configuration: PSYCHICBOOK_VERIFICATION_CODE');
  }
  return code;
}
```

- [ ] **Step 5: Update existing policy consumers and tests**

Replace every `buildGateEnvironment` import in the named generation, healer, recording, local-runner, and gate consumers with `buildRuntimeEnvironment`. Replace every `knownSecretEnvValues` use in the named context/IR/repair/review consumers with `collectRedactionValues`. Route source admission through `evaluateSourceLiterals`, update the three named test files, and delete `gate-environment.mjs` once `rg` proves it has no importer.

- [ ] **Step 6: Run security and consumer tests**

```bash
node --test scripts/ai/__tests__/ai-secret-policies.test.mjs scripts/ai/__tests__/test-heal-context.test.mjs scripts/ai/__tests__/generated-test-gate.test.mjs
node --test scripts/ai/__tests__/verified-generate.test.mjs scripts/ai/__tests__/test-heal.test.mjs
rg -n "buildGateEnvironment|knownSecretEnvValues|gate-environment" scripts/ai --glob '*.mjs'
```

Expected: all tests PASS and the final `rg` returns no production/test import or call site.

- [ ] **Step 7: Commit**

Stage only the three policy modules, their tests, the explicitly named consumers, and the obsolete environment module deletion. Do not stage the untracked PsychicBook experiment files.

```bash
git add packages/web/scripts/ai/lib/runtime-env-policy.mjs packages/web/scripts/ai/lib/output-redaction-policy.mjs packages/web/scripts/ai/lib/source-secret-policy.mjs packages/web/scripts/ai/lib/secret-safety.mjs packages/web/scripts/ai/evals/golden-eval.mjs packages/web/scripts/ai/generated-test-gate.mjs packages/web/scripts/ai/heal-test.mjs packages/web/scripts/ai/lib/generated-gate-runner.mjs packages/web/scripts/ai/lib/generation-context-pack.mjs packages/web/scripts/ai/lib/generation-ir.mjs packages/web/scripts/ai/lib/generation-repair.mjs packages/web/scripts/ai/lib/test-heal-context.mjs packages/web/scripts/ai/lib/test-heal.mjs packages/web/scripts/ai/recording-gate-all.mjs packages/web/scripts/ai/recording-test-gate.mjs packages/web/scripts/ai/review-generated-test.mjs packages/web/scripts/ai/run-local-playwright.mjs packages/web/scripts/ai/verified-generate.mjs packages/web/scripts/ai/__tests__/ai-secret-policies.test.mjs packages/web/scripts/ai/__tests__/generated-test-gate.test.mjs packages/web/scripts/ai/__tests__/test-heal-context.test.mjs packages/web/scripts/ai/__tests__/verified-generate.test.mjs
git rm packages/web/scripts/ai/lib/gate-environment.mjs
git commit -m "refactor(web): separate AI secret policies"
```

---

### Task 8: Official Playwright Report Normalization and Shared Gate Verdict v2

**Files:**
- Create: `packages/web/scripts/ai/lib/playwright-report-verdict.mjs`
- Create: `packages/web/scripts/ai/lib/ai-gate-verdict.mjs`
- Create: `packages/web/scripts/ai/__tests__/ai-gate-verdict.test.mjs`
- Create: `packages/web/scripts/ai/__tests__/fixtures/reviewed-runs/repeat-each-two-pass.json`
- Create: `packages/web/scripts/ai/__tests__/fixtures/reviewed-runs/controlled-max-failure.json`
- Modify: `packages/web/scripts/ai/generated-test-gate.mjs:560-920`
- Modify: `packages/web/scripts/ai/lib/generated-gate-runner.mjs:1-624`
- Modify: `packages/web/scripts/ai/__tests__/generated-test-gate.test.mjs:1-984`

**Interfaces:**
- Produces: `verifyPlaywrightJsonReports(report, targets, policy)`, `verifyPlaywrightJsonReport(report, target, policy)`, `createGateVerdict(input)`, `sanitizeGateVerdict(verdict)`.
- Replaces: `generated-gate-verdict/v1` with `ai-gate-verdict/v2`.

- [ ] **Step 1: Create sanitized fixtures from the reviewed report shapes**

Create the reviewed-run fixture directory from `packages/web`:

```bash
mkdir -p scripts/ai/__tests__/fixtures/reviewed-runs
```

The two-pass fixture contains one logical spec with two official test executions, each `expectedStatus=passed`, one retry-zero passing result, matching project ID/name, and report stats `expected=2`. The controlled-failure fixture contains one target unexpected result, `maxFailures=1`, and only the official early-stop top-level error.

- [ ] **Step 2: Write failing real-run regressions**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createGateVerdict } from '../lib/ai-gate-verdict.mjs';
import { verifyPlaywrightJsonReport } from '../lib/playwright-report-verdict.mjs';

const TARGET = 'tests/regression/psychicbook-healing-experiment.spec.ts';
const GATE_RUN_ID = '33333333-3333-4333-8333-333333333333';
const reviewedFixture = (name) => JSON.parse(fs.readFileSync(
  new URL(`./fixtures/reviewed-runs/${name}`, import.meta.url),
  'utf8'
));

test('official repeatEach shape from reviewed run proves two logical passes', () => {
  const verdict = verifyPlaywrightJsonReport(reviewedFixture('repeat-each-two-pass.json'), TARGET, {
    project: 'chromium', repeatEach: 2, retries: 0
  });
  assert.equal(verdict.passed, true);
  assert.equal(verdict.logicalTests[0].executions.length, 2);
});

test('controlled maxFailures target failure is runtime-test, not environment', () => {
  const reportVerdict = verifyPlaywrightJsonReport(reviewedFixture('controlled-max-failure.json'), TARGET, {
    project: 'chromium', repeatEach: 3, retries: 0
  });
  const verdict = createGateVerdict({ stage: 'runtime', reportVerdict, exitCode: 1, gateRunId: GATE_RUN_ID });
  assert.equal(verdict.classification, 'runtime-test');
});
```

- [ ] **Step 3: Run focused tests and confirm the intended RED**

```bash
node --test scripts/ai/__tests__/ai-gate-verdict.test.mjs scripts/ai/__tests__/generated-test-gate.test.mjs
```

Expected: new test fails because the extracted modules/v2 schema do not exist. Preserve any currently passing uncommitted official-report characterization rather than replacing it with a weaker synthetic assertion.

- [ ] **Step 4: Extract report traversal without behavior loss**

Move report-envelope, project, logical identity, stats reconciliation, repeat aggregation, retry-zero, skip/flaky, controlled max-failure, and path matching logic into `playwright-report-verdict.mjs`. Logical identity is canonical target + suite/title path + line/column; repeat executions aggregate beneath it.

- [ ] **Step 5: Implement `ai-gate-verdict/v2`**

Verdict contains gate kind/stage/run ID, source SHA, project policy, exit/duration, logical tests, counts, `outcome`, `classification`, stable reason codes, sanitized diagnostics, and report artifact ref. It never includes raw errors, headers, or environment values.

- [ ] **Step 6: Switch gate runner and CLI to shared APIs**

Update imports and delete duplicate verifier/verdict logic from `generated-test-gate.mjs`. Do not leave a v1 writer/re-export.

- [ ] **Step 7: Run gate tests and commit**

```bash
node --test scripts/ai/__tests__/ai-gate-verdict.test.mjs scripts/ai/__tests__/generated-test-gate.test.mjs scripts/ai/__tests__/generated-test-gate-hardening.test.mjs scripts/ai/__tests__/gate-all.test.mjs
git add packages/web/scripts/ai/lib/playwright-report-verdict.mjs packages/web/scripts/ai/lib/ai-gate-verdict.mjs packages/web/scripts/ai/generated-test-gate.mjs packages/web/scripts/ai/lib/generated-gate-runner.mjs packages/web/scripts/ai/__tests__/ai-gate-verdict.test.mjs packages/web/scripts/ai/__tests__/generated-test-gate.test.mjs packages/web/scripts/ai/__tests__/fixtures/reviewed-runs
git commit -m "refactor(web): normalize Playwright gate verdicts"
```

---

### Task 9: Structured-First Multiline Runtime Triage

**Files:**
- Create: `packages/web/scripts/ai/lib/runtime-triage.mjs`
- Rewrite: `packages/web/scripts/ai/__tests__/test-heal-triage.test.mjs:1-35`
- Create: `packages/web/scripts/ai/__tests__/fixtures/reviewed-runs/multiline-locator-timeout.txt`
- Modify: `packages/web/scripts/ai/lib/test-heal.mjs:99-265`
- Modify: `packages/web/scripts/ai/heal-test.mjs:20-40`

**Interfaces:**
- Consumes: `ai-gate-verdict/v2`, bounded sanitized fallback evidence.
- Produces: `triageRuntimeFailure({ gateVerdict, evidence })` with schema `runtime-triage/v2`, classification, repairable, reason codes, evidence sources, fingerprint.

- [ ] **Step 1: Add the exact multiline regression and structured precedence tests**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { triageRuntimeFailure } from '../lib/runtime-triage.mjs';

test('multiline click timeout with element not found is locator drift', () => {
  const evidence = fs.readFileSync(
    new URL('./fixtures/reviewed-runs/multiline-locator-timeout.txt', import.meta.url),
    'utf8'
  );
  const verdict = triageRuntimeFailure({ evidence: [evidence] });
  assert.equal(verdict.classification, 'locator-drift');
  assert.deepEqual(verdict.reasonCodes, ['LOCATOR_NOT_FOUND']);
});
```

Add structured assertion mismatch overriding a generic timeout, auth/network/data/setup fail-closed cases, strict-mode/detached locator cases, synchronization-only actionability, contradiction, and unknown cases.

- [ ] **Step 2: Run triage tests and confirm RED**

```bash
node --test scripts/ai/__tests__/test-heal-triage.test.mjs
```

Expected: the reviewed multiline case fails under the current regex and reports `ACTIONABILITY_TIMEOUT`.

- [ ] **Step 3: Implement structured precedence and multiline-safe fallback**

Use report error/step/action/locator evidence first. For fallback, match bounded joined text with patterns that explicitly span line breaks (`[\s\S]` or `s` flag). Product/assertion, auth/network, data, and setup evidence prevents repair before locator/sync classification. Contradiction is unclassified.

- [ ] **Step 4: Update evidence extraction to preserve safe structure**

`extractRuntimeFailureEvidence` must return structured error metadata plus bounded redacted strings; do not flatten away locator/action boundaries before triage.

- [ ] **Step 5: Run healer triage/context tests and commit**

```bash
node --test scripts/ai/__tests__/test-heal-triage.test.mjs scripts/ai/__tests__/test-heal-context.test.mjs scripts/ai/__tests__/test-heal.test.mjs
git add packages/web/scripts/ai/lib/runtime-triage.mjs packages/web/scripts/ai/lib/test-heal.mjs packages/web/scripts/ai/heal-test.mjs packages/web/scripts/ai/__tests__/test-heal-triage.test.mjs packages/web/scripts/ai/__tests__/fixtures/reviewed-runs/multiline-locator-timeout.txt
git commit -m "fix(web): triage multiline locator failures"
```

---

### Task 10: Locator Provenance and One-Character Accessible-Name Warning

**Files:**
- Create: `packages/web/scripts/ai/lib/locator-provenance.mjs`
- Create: `packages/web/scripts/ai/__tests__/locator-provenance.test.mjs`
- Modify: `packages/web/scripts/ai/dom-discover.mjs:90-190`
- Modify: `packages/web/scripts/ai/review-dom-discovery.mjs:20-160`
- Modify: `packages/web/scripts/ai/review-generated-test.mjs:100-160`
- Modify: `packages/web/scripts/ai/lib/generation-context.mjs`

**Interfaces:**
- Produces: `fingerprintDomDiscovery(artifact)`, `buildLocatorProvenance({ artifact, candidateSource, sourcePath })`, `reviewLocatorProvenance({ provenance, candidateSource, expectedSpec })`.
- Consumes: reviewed DOM discovery schema, live Playwright match counts, candidate AST/source locations.

- [ ] **Step 1: Write failing provenance and weak-name warning tests**

Require URL-without-credentials, spec hash, captured time, DOM fingerprint, locator strategy/value, match count, uniqueness, discovery policy, and candidate source range. A role locator whose accessible name is `T` without current unique evidence must warn; the same locator with matching unique provenance must not warn. Stale/wrong-origin/hash-mismatched provenance must not suppress the warning.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
node --test scripts/ai/__tests__/locator-provenance.test.mjs
```

Expected: FAIL because provenance matching does not exist.

- [ ] **Step 3: Implement canonical provenance**

Normalize URL origin/path while removing credentials and sensitive query values. Hash the sanitized reviewed discovery projection, not the raw agent-browser output. Match only typed locator calls; never evaluate locator strings or accept agent refs.

- [ ] **Step 4: Integrate discovery and generated review**

Add the discovery fingerprint/policy version to `selector-candidates.json`; validate it in review; let generated review accept an optional provenance artifact and emit a stable `LOCATOR_ACCESSIBLE_NAME_TOO_SHORT` warning unless matching unique evidence exists.

- [ ] **Step 5: Run discovery/reviewer tests and commit**

```bash
node --test scripts/ai/__tests__/locator-provenance.test.mjs scripts/ai/__tests__/agent-browser-hardening.test.mjs scripts/ai/__tests__/review-generated-test.test.mjs
git add packages/web/scripts/ai/lib/locator-provenance.mjs packages/web/scripts/ai/dom-discover.mjs packages/web/scripts/ai/review-dom-discovery.mjs packages/web/scripts/ai/review-generated-test.mjs packages/web/scripts/ai/lib/generation-context.mjs packages/web/scripts/ai/__tests__/locator-provenance.test.mjs
git commit -m "feat(web): bind generated locators to discovery evidence"
```

---

### Task 11: Snapshot-Checked Atomic Promotion and Rollback

**Files:**
- Create: `packages/web/scripts/ai/lib/atomic-target-update.mjs`
- Create: `packages/web/scripts/ai/__tests__/atomic-target-update.test.mjs`

**Interfaces:**
- Produces: `captureTargetSnapshot({ targetPath, allowedRoot })`, `replaceTargetIfUnchanged({ targetPath, expected, replacementBytes, mode, operationId })`, `rollbackTargetIfUnchanged({ targetPath, expectedCandidate, originalBytes, mode, operationId })`.
- Consumes: exact candidate/original bytes from artifact store.

- [ ] **Step 1: Write failing atomic replacement tests**

Test exact replacement, preserved mode, SHA result, target byte/stat drift before rename, symlink/path escape refusal, replacement-byte mutation, parent-directory replacement, and final-LF identity.

- [ ] **Step 2: Write failing safe rollback tests**

Rollback succeeds only when target still equals candidate snapshot. A third-party edit after candidate promotion must produce `ROLLBACK_BLOCKED` and preserve that edit.

- [ ] **Step 3: Run focused tests and confirm RED**

```bash
node --test scripts/ai/__tests__/atomic-target-update.test.mjs
```

Expected: FAIL because the atomic update module does not exist.

- [ ] **Step 4: Implement descriptor-bound snapshot and rename protocol**

Read regular-file bytes through `O_NOFOLLOW`, bind dev/inode/size/mtime/ctime/SHA, write and fsync a private sibling temp, recheck expected snapshot immediately before rename, rename, fsync parent, then verify result SHA. On failure, remove only the operation-owned temp.

- [ ] **Step 5: Run focused tests and commit**

```bash
node --test scripts/ai/__tests__/atomic-target-update.test.mjs
git add packages/web/scripts/ai/lib/atomic-target-update.mjs packages/web/scripts/ai/__tests__/atomic-target-update.test.mjs
git commit -m "feat(web): add snapshot checked target updates"
```

---

### Task 12: Build the v2 Verified-Generation Orchestrator Behind a Direct API

**Files:**
- Create: `packages/web/scripts/ai/lib/verified-generation-v2.mjs`
- Modify: `packages/web/scripts/ai/lib/ai-client.mjs:647-810`
- Create: `packages/web/scripts/ai/__tests__/verified-generation-v2.test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/ai-client.test.mjs`

**Interfaces:**
- Consumes: generation store, artifact store, secret policies, gate v2, provenance, atomic update.
- Produces: `runVerifiedGenerationV2(options)` returning `{ runId, candidateId, sourceSha256, status: 'awaiting-full-gate', projectionPath }`.
- Does not yet switch the public CLI; Task 13 atomically cuts the generator CLI, full-gate linker, and cache to v2 so no user-facing command is left half-migrated.

- [ ] **Step 1: Write failing v2 orchestration tests**

Require the exact event order for input/preflight/provider/candidate/review/gate/promotion/cache/phase completion, exact artifact refs, no `manifest.json`, and status `awaiting-full-gate`. Require rejected generation to preserve candidate plus sanitized gate verdict. Require secret-bearing output to persist only hash/reason codes.

- [ ] **Step 2: Add provider telemetry assertions based on the reviewed high-cost run**

Every provider attempt must project `promptChars`, duration, input/output/total tokens, provider prompt-cache status, result-cache status, retry reason, and unknown-attempt linkage. Raw prompt/output text must not appear in events/projection.

- [ ] **Step 3: Run focused generation tests and confirm RED**

```bash
node --test scripts/ai/__tests__/verified-generation-v2.test.mjs scripts/ai/__tests__/ai-client.test.mjs
```

Expected: FAIL because `verified-generation-v2.mjs` does not exist.

- [ ] **Step 4: Replace telemetry wrappers with domain events**

Create the generation run before provider work, append `subject.bound` and `input.assembled`, convert each `onAttempt` callback into provider events, admit candidate/provenance/verdict artifacts, and append stable rejection events for every early exit. Audit persistence failure is fatal before target/cache mutation.

- [ ] **Step 5: Use write-ahead candidate promotion**

After the two-repeat gate passes, append `candidate.accepted` and `candidate.promotion_started` with exact original/candidate snapshots. Promote through `replaceTargetIfUnchanged`, append `candidate.promoted`, then perform cache promotion and append its event. Append `generation.phase_completed`; do not close before full gate.

- [ ] **Step 6: Remove standalone/legacy generation usage manifests**

`ai-client.mjs` returns structured provider usage to the direct v2 orchestrator. Keep the currently active CLI unchanged in this task; Task 13 removes fallback `generation-usage/v1` writes during the atomic command cutover.

- [ ] **Step 7: Run focused generation/gate/cache tests**

```bash
node --test scripts/ai/__tests__/ai-client.test.mjs scripts/ai/__tests__/verified-generation-v2.test.mjs scripts/ai/__tests__/generation-run.test.mjs scripts/ai/__tests__/ai-gate-verdict.test.mjs
```

Expected: PASS. The direct v2 API writes no manifest; the unchanged public CLI remains covered by its existing tests until Task 13.

- [ ] **Step 8: Commit**

```bash
git add packages/web/scripts/ai/lib/verified-generation-v2.mjs packages/web/scripts/ai/lib/ai-client.mjs packages/web/scripts/ai/__tests__/verified-generation-v2.test.mjs packages/web/scripts/ai/__tests__/ai-client.test.mjs
git commit -m "feat(web): build verified generation v2 orchestrator"
```

---

### Task 13: Full-Gate Linkage, Sticky Revocation, and v4 Cache

**Files:**
- Rewrite: `packages/web/scripts/ai/verified-generate.mjs:1-1083`
- Modify: `packages/web/scripts/ai/ai-generate.mjs`
- Modify: `packages/web/scripts/ai/generated-test-gate.mjs:1-1196`
- Modify: `packages/web/scripts/ai/gate-all.mjs:1-326`
- Modify: `packages/web/scripts/ai/lib/generation-cache.mjs:1-604`
- Modify: `packages/web/scripts/ai/__tests__/generated-test-gate.test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/gate-all.test.mjs`
- Rewrite: `packages/web/scripts/ai/__tests__/generation-cache.test.mjs:1-538`
- Rewrite: `packages/web/scripts/ai/__tests__/verified-generate.test.mjs:1-934`

**Interfaces:**
- Consumes: `createGenerationRunStore`, `ai-gate-verdict/v2`, candidate/subject fingerprints.
- Consumes: Task 12 `runVerifiedGenerationV2`.
- Produces: public `runVerifiedGeneration(options)`, a CLI output line prefixed `GENERATION_RUN_ID=`, `appendFullGateOutcome({ runId, verdict, sourceSha256, subject })`, and v4-only cache references.

- [ ] **Step 1: Write the fail-then-pass sticky integration test**

Create an awaiting-full-gate stream, append a runtime-test failure, then a passing diagnostic attempt. Require projection aggregate `revoked`, both attempt IDs retained, first failure retained, and active cache absent.

- [ ] **Step 2: Write environment retry and subject-drift tests**

Environment then pass becomes fully accepted and closes. Changed target/spec/policy/candidate SHA rejects linkage without changing projection/cache. `repeatEach` other than 3 cannot be linked as full-gate evidence.

- [ ] **Step 3: Run focused tests and confirm RED**

```bash
node --test scripts/ai/__tests__/generated-test-gate.test.mjs scripts/ai/__tests__/generation-cache.test.mjs scripts/ai/__tests__/gate-all.test.mjs
```

Expected: fail because the public generator/linker still uses the v1 manifest and the cache still accepts v3 entries.

- [ ] **Step 4: Append full-gate events instead of mutating manifests**

`finishCli` appends `full_gate.started` before execution and `full_gate.completed` after a sanitized verdict. On pass append `run.closed` only when the reducer aggregate becomes `fully-accepted`; a pass after sticky revocation remains open diagnostic evidence. On environment leave open. On runtime-test append cache invalidation and leave the revoked stream open for diagnostic attempts or explicit abandonment/closure. Never update another summary file directly.

- [ ] **Step 5: Atomically switch the public generator CLI**

Make `verified-generate.mjs` a thin validation/printing wrapper around `runVerifiedGenerationV2`, preserve `runVerifiedGeneration(options)` as the public test API, and keep `formatGenerationRunIdLine(runId)`. Remove standalone `generation-usage/v1` writes from `ai-generate.mjs`; the v2 orchestrator is now the only generation-run telemetry writer.

- [ ] **Step 6: Cut cache to v4-only entries**

Set cache schema/key/candidate/reference versions to v4-family values. Bind subject, candidate ID/SHA, promotion quality, provenance, prompt/provider, and policy fingerprints. Ignore/reject old cache files; do not migrate them. Cache invalidation is idempotent and event-recorded after active-reference removal.

- [ ] **Step 7: Run focused and batch gate tests**

```bash
node --test scripts/ai/__tests__/generation-run.test.mjs scripts/ai/__tests__/generation-cache.test.mjs scripts/ai/__tests__/generated-test-gate.test.mjs scripts/ai/__tests__/gate-all.test.mjs scripts/ai/__tests__/verified-generation-v2.test.mjs scripts/ai/__tests__/verified-generate.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/web/scripts/ai/verified-generate.mjs packages/web/scripts/ai/ai-generate.mjs packages/web/scripts/ai/generated-test-gate.mjs packages/web/scripts/ai/gate-all.mjs packages/web/scripts/ai/lib/generation-cache.mjs packages/web/scripts/ai/__tests__/verified-generate.test.mjs packages/web/scripts/ai/__tests__/generated-test-gate.test.mjs packages/web/scripts/ai/__tests__/gate-all.test.mjs packages/web/scripts/ai/__tests__/generation-cache.test.mjs
git commit -m "refactor(web): cut generation and full gate to v2"
```

---

### Task 14: Proposal-Only Healer on v2

**Files:**
- Create: `packages/web/scripts/ai/lib/heal-verification.mjs`
- Create: `packages/web/scripts/ai/lib/heal-proposal.mjs`
- Rewrite: `packages/web/scripts/ai/heal-test.mjs:1-1479`
- Rewrite: `packages/web/scripts/ai/__tests__/test-heal.test.mjs:1-2141`
- Modify: `packages/web/scripts/ai/__tests__/test-heal-contract.test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/test-heal-policy.test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/test-heal-context.test.mjs`

**Interfaces:**
- Produces: `createHealProposal({ testPath, specPath, sourceGenerationRunId, ...options })` and thin CLI `parseArgs`/`helpText`; CLI accepts optional `--generation-run RUN_ID`.
- Consumes: heal store, artifact store, verification module, structured triage, security policies, existing AST semantic guard/provider prompt.
- Private implementation contract: `prepareHealRun(options)` resolves and verifies the subject and optional generation link; `closeAlreadyGreen(context, baseline)` records the terminal no-op result; `createVerifiedProposal(context, baseline)` owns provider/check/proposal events. These helpers are not exported.

- [ ] **Step 1: Write failing proposal-only event tests**

Require baseline-green to close without provider/proposal, environment/nonrepairable to close without provider, repairable locator drift to record provider/check events and return `proposal-ready`, and target bytes to remain unchanged in every proposal outcome.

When `sourceGenerationRunId` is provided, require the referenced generation stream to be valid, fully accepted, and bound to the same target/spec. Bind its promoted candidate SHA as `generationSourceSha256`, while the healer independently binds the exact current (possibly deliberately broken) target as `originalSourceSha256`. A wrong generation ID, corrupt stream, subject mismatch, or generation-candidate SHA mismatch fails with `GENERATION_SUBJECT_LINK_INVALID` before any provider call or proposal event.

- [ ] **Step 2: Require exact proposal artifacts and final LF**

Assert original artifact equals original bytes, candidate artifact ends in exactly one LF, diff compares those exact artifacts, `proposal.ready` binds all SHA values/check fingerprints, and reading candidate artifact yields the exact future apply bytes.

- [ ] **Step 3: Reject old same-run mutation flags**

`parseArgs(['--apply'])` and `parseArgs(['--allow-dirty'])` must throw an unknown/removed-mode error. Remove `healed` from successful proposal statuses.

- [ ] **Step 4: Run healer tests and confirm RED**

```bash
node --test scripts/ai/__tests__/test-heal.test.mjs scripts/ai/__tests__/test-heal-triage.test.mjs scripts/ai/__tests__/test-heal-context.test.mjs scripts/ai/__tests__/test-heal-contract.test.mjs scripts/ai/__tests__/test-heal-policy.test.mjs
```

Expected: fail because the current CLI can mutate with `--apply` and writes `heal-summary.json` v1.

- [ ] **Step 5: Extract verification and proposal orchestration**

Move standalone/generated execution, evidence extraction, typecheck, lint, reviewer/drift routing, and candidate diff into `heal-verification.mjs`. `prepareHealRun` loads the optional generation stream through `createGenerationRunStore().loadVerified`, validates its subject and accepted promoted-candidate binding, and records the immutable `{ generationRunId, generationSourceSha256 }` lineage separately from the healer's current `originalSourceSha256`. `createHealProposal` appends domain events, stores artifacts, invokes AI only after repairable triage, and ends open at `proposal.ready`.

```js
export async function createHealProposal(options) {
  const context = await prepareHealRun(options);
  const baseline = await context.verification.runBaseline();
  return baseline.passed
    ? closeAlreadyGreen(context, baseline)
    : createVerifiedProposal(context, baseline);
}
```

- [ ] **Step 6: Preserve source-contract safety**

Keep spec/recording/handwritten routing and all AST invariants. Page Object/Component ownership ends `manual-change-required`; no second file is changed or archived as a patch.

- [ ] **Step 7: Add healer prompt/cache telemetry**

Record `promptChars`, provider-cache status, result-cache status, input/output/total tokens, duration, attempt ID, and retry reason. Do not store prompt/provider response text.

- [ ] **Step 8: Run focused healer tests and commit**

```bash
node --test scripts/ai/__tests__/heal-run-v2.test.mjs scripts/ai/__tests__/test-heal*.test.mjs
git add packages/web/scripts/ai/lib/heal-verification.mjs packages/web/scripts/ai/lib/heal-proposal.mjs packages/web/scripts/ai/heal-test.mjs packages/web/scripts/ai/__tests__/test-heal.test.mjs packages/web/scripts/ai/__tests__/test-heal-contract.test.mjs packages/web/scripts/ai/__tests__/test-heal-policy.test.mjs packages/web/scripts/ai/__tests__/test-heal-context.test.mjs
git commit -m "refactor(web): make healer proposal only"
```

---

### Task 15: Apply Reviewed Healer Proposal by Run ID

**Files:**
- Create: `packages/web/scripts/ai/lib/heal-proposal-apply.mjs`
- Create: `packages/web/scripts/ai/apply-heal-proposal.mjs`
- Create: `packages/web/scripts/ai/__tests__/heal-proposal-apply.test.mjs`

**Interfaces:**
- Produces: `applyHealProposal({ runId, webRoot, env, verification })`, CLI `parseApplyArgs(argv)`.
- Consumes: verified heal stream/projection, original/candidate artifacts, atomic target update, verification module.

- [ ] **Step 1: Write failing no-AI and exact-byte tests**

In the test, traverse relative static imports from `apply-heal-proposal.mjs` and `heal-proposal-apply.mjs` with the repository's TypeScript parser and fail if the dependency graph reaches `ai-client.mjs`, `agent-browser`, `heal-proposal.mjs`, or another provider transport. Inject a `verification` object whose `provider` getter throws if accessed. Apply a ready proposal with provider environment variables unset and require target bytes to equal the archived candidate exactly, including final LF; require `proposal.applied` and `run.closed`.

- [ ] **Step 2: Write failing precondition and idempotency tests**

Cover event-chain corruption, missing/hash-mismatched artifact, changed target SHA, changed source-contract fingerprint, rejected/expired proposal, already-applied target success, and already-applied wrong target failure.

- [ ] **Step 3: Write crash-boundary and rollback tests**

Inject crashes after apply intent, after temp write, after target rename, and after post-gate. Recovery compares original/candidate/current SHA. Environment post-gate failure safely rolls back and returns proposal-ready; runtime-test rolls back and rejects; third-party post-apply edit produces rollback-blocked and remains untouched.

- [ ] **Step 4: Run focused tests and confirm RED**

```bash
node --test scripts/ai/__tests__/heal-proposal-apply.test.mjs
```

Expected: FAIL because apply-by-run-ID does not exist.

- [ ] **Step 5: Implement apply preflight and repeated verification**

Load/replay the stream; idempotently return prior success before open-state checks; validate every artifact/fingerprint; require current target SHA equals original; re-run policy/type/lint/review/drift/integrity and the proposal's verification count against archived bytes; append apply intent/preflight.

- [ ] **Step 6: Implement atomic apply, post-gate, and safe rollback**

Use `replaceTargetIfUnchanged`; verify candidate SHA; run the real-target gate; append applied/closed on success. On post-gate failure, call `rollbackTargetIfUnchanged`; append rollback and either return proposal-ready for environment or reject/close for quality/policy failure. Never overwrite a third SHA.

- [ ] **Step 7: Implement thin CLI**

```text
Usage: node scripts/ai/apply-heal-proposal.mjs --run RUN_ID
```

Reject `--test`, `--candidate`, `--prompt`, `--model`, `--apply`, and `--allow-dirty`. Print run ID, target, final status, and safe projection path only.

- [ ] **Step 8: Run apply/healer tests and commit**

```bash
node --test scripts/ai/__tests__/heal-proposal-apply.test.mjs scripts/ai/__tests__/heal-run-v2.test.mjs scripts/ai/__tests__/test-heal.test.mjs
git add packages/web/scripts/ai/lib/heal-proposal-apply.mjs packages/web/scripts/ai/apply-heal-proposal.mjs packages/web/scripts/ai/__tests__/heal-proposal-apply.test.mjs
git commit -m "feat(web): apply healer proposals by run id"
```

---

### Task 16: v2-Only Usage Reporting and Hard Cutover

**Files:**
- Rewrite: `packages/web/scripts/ai/token-usage-report.mjs:1-766`
- Rewrite: `packages/web/scripts/ai/__tests__/token-usage-report.test.mjs:1-844`
- Delete: `packages/web/scripts/ai/lib/generation-run.mjs`
- Delete: `packages/web/scripts/ai/lib/generation-quality.mjs`
- Delete: `packages/web/scripts/ai/lib/generated-gate-verdict.mjs`
- Delete: `packages/web/scripts/ai/lib/test-heal-triage.mjs`
- Modify: `packages/web/package.json`
- Modify: `package.json`
- Modify: `packages/web/.gitignore`
- Modify: `packages/web/.env.example`
- Modify: `packages/web/AGENTS.md`
- Modify: `packages/web/ai/prompts/04-heal-locator.md`
- Modify: `packages/web/ai/policies/test-quality-gate.md`
- Modify: `packages/web/docs/ai-testing/ARCHITECTURE.md`
- Modify: `packages/web/docs/ai-testing/QUICKSTART.md`
- Modify: `packages/web/docs/ai-testing/README.md`
- Modify: `packages/web/docs/ai-testing/SETUP.md`
- Modify: `packages/web/docs/ai-testing/START_HERE.md`
- Modify: `packages/web/docs/ai-testing/TEST_GENERATION_FLOW.md`
- Modify: `packages/web/docs/ai-testing/TROUBLESHOOTING.md`
- Modify: `packages/web/docs/ai-testing/TOKEN_ECONOMY.md`

**Interfaces:**
- Produces: `readAiRunUsage(root)`, `summarizeAiRunUsage(input)`, v2-only CLI reporting for generation and heal.
- Adds root commands: `web:ai:heal`, `web:ai:heal:apply`.

- [ ] **Step 1: Replace v1 reporting fixtures with verified v2 streams**

Tests must cover generation/heal provider usage, prompt chars, cache read/write status, retries/unknown attempts, provisional/accepted/revoked quality, corrupt event stream, invalid artifact, and incomplete open run. Assert no scan of `manifest.json` and no `legacy-manifest` source category.

- [ ] **Step 2: Run reporting tests and confirm RED**

```bash
node --test scripts/ai/__tests__/token-usage-report.test.mjs
```

Expected: fail because the current reporter scans v1/legacy manifests.

- [ ] **Step 3: Rewrite reporter around verified v2 replay**

Scan only `.ai-runs/v2/generation/*/events.jsonl` and `.ai-runs/v2/heal/*/events.jsonl`, load through the domain stores, aggregate provider attempts and quality from reducer state, and report invalid streams separately without trusting projections.

- [ ] **Step 4: Add npm commands**

In `packages/web/package.json`:

```json
"ai:test:heal": "node scripts/ai/heal-test.mjs",
"ai:test:heal:apply": "node scripts/ai/apply-heal-proposal.mjs"
```

In root `package.json`:

```json
"web:ai:heal": "npm run -w packages/web ai:test:heal --",
"web:ai:heal:apply": "npm run -w packages/web ai:test:heal:apply --"
```

- [ ] **Step 5: Remove v1 modules and references**

```bash
rg -n "generation-run/v1|generation-run-event/v1|generated-gate-verdict/v1|test-heal-triage/v1|test-heal-run/v1|generation-usage/v1|legacy-manifest|fullGatePassed|heal --apply|--allow-dirty" packages/web/scripts/ai packages/web/docs package.json packages/web/package.json
```

Expected after edits: no production/runtime v1 reference. Historical docs under `docs/superpowers/specs/` and `docs/superpowers/plans/` are allowed to describe previous behavior.

- [ ] **Step 6: Update current operational documentation**

Document authoritative events, disposable projections, v1 unsupported/ignored, provisional vs full acceptance, sticky revocation, proposal/apply commands, no-AI apply, runtime-only verification code, security policies, provenance warning, recovery, and safe artifact paths.

- [ ] **Step 7: Run reporting/help/package tests**

```bash
node --test scripts/ai/__tests__/token-usage-report.test.mjs scripts/ai/__tests__/test-heal.test.mjs scripts/ai/__tests__/heal-proposal-apply.test.mjs
npm run ai:test:heal -- --help
npm run ai:test:heal:apply -- --help
```

Expected: all tests PASS; both help commands exit zero; proposal help contains no same-run apply flag.

- [ ] **Step 8: Commit hard cutover**

Stage only the v2 reporter/tests, named deletions, package files, and current operational docs.

```bash
git add packages/web/scripts/ai/token-usage-report.mjs packages/web/scripts/ai/__tests__/token-usage-report.test.mjs packages/web/package.json package.json packages/web/.gitignore packages/web/.env.example packages/web/AGENTS.md packages/web/ai/prompts/04-heal-locator.md packages/web/ai/policies/test-quality-gate.md
git add packages/web/docs/ai-testing/ARCHITECTURE.md packages/web/docs/ai-testing/QUICKSTART.md packages/web/docs/ai-testing/README.md packages/web/docs/ai-testing/SETUP.md packages/web/docs/ai-testing/START_HERE.md packages/web/docs/ai-testing/TEST_GENERATION_FLOW.md packages/web/docs/ai-testing/TROUBLESHOOTING.md packages/web/docs/ai-testing/TOKEN_ECONOMY.md
git rm packages/web/scripts/ai/lib/generation-run.mjs packages/web/scripts/ai/lib/generation-quality.mjs packages/web/scripts/ai/lib/generated-gate-verdict.mjs packages/web/scripts/ai/lib/test-heal-triage.mjs
git commit -m "refactor(web): cut AI runs over to v2"
```

---

### Task 17: Full Deterministic Verification and Real PsychicBook Experiment

**Files:**
- Verify: all files changed in Tasks 1-16.
- Exercise without committing run artifacts: `packages/web/data/psychicbook.ts`, `packages/web/specs/psychicbook-account-menu.md`, `packages/web/specs/psychicbook-healing-experiment.md`, `packages/web/tests/regression/psychicbook-account-menu.spec.ts`, `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`, `packages/web/.ai-runs/v2/`.

**Interfaces:**
- Consumes: completed v2 generator, full gate, proposal healer, apply command, environment-only stage configuration.
- Produces: fresh deterministic suite evidence plus one real generate → full gate → deliberate locator break → proposal → apply → final gate history.

- [ ] **Step 1: Run the complete AI unit/integration suite**

```bash
npm run ai:test:self
```

Expected: zero failed tests. Record the exact pass/fail count from this run.

- [ ] **Step 2: Run static repository verification**

```bash
npm run typecheck
npm run lint
npm run ai:eval
npm run ai:spec:validate -- --dir specs --strict
npm run ai:spec:drift
npm run ai:recording:validate -- --dir recordings
npm run ai:recording:drift
```

Expected: every command exits zero.

- [ ] **Step 3: Run deterministic local Playwright gates**

```bash
npm run test:e2e:local
npm run ai:test:gate:local-generated
npm run ai:recording:gate:all
```

Expected: all local projects pass with no failed, skipped, or flaky acceptance result.

- [ ] **Step 4: Confirm runtime-only PsychicBook configuration without printing values**

First use `apply_patch` to make the existing untracked PsychicBook helper read and validate `PSYCHICBOOK_VERIFICATION_CODE`, update both untracked specs/tests to reference the helper/environment key rather than a literal value, and restamp generated headers after spec changes. Preserve every unrelated byte in those user-owned experiment files, leave them uncommitted, and confirm none is staged.

Then require these names to be present in the process environment: `PLAYWRIGHT_TEST_BASE_URL`, `E2E_HTTP_BASIC_USERNAME`, `E2E_HTTP_BASIC_PASSWORD`, `PSYCHICBOOK_E2E_EMAIL`, and `PSYCHICBOOK_VERIFICATION_CODE`. Validate only presence/format and ensure the URL origin is the reviewed non-production PsychicBook host. Do not echo values. Run the source-secret policy over both PsychicBook specs/tests and require zero literal-value findings before any provider call.

- [ ] **Step 5: Generate the isolated PsychicBook test through v2**

```bash
npm run ai:brain:generate -- --spec specs/psychicbook-healing-experiment.md --out tests/regression/psychicbook-healing-experiment.spec.ts
```

Expected: accepted two-repeat promotion, printed v2 generation run ID, `generation.phase_completed`, status `awaiting-full-gate`, no `manifest.json`, and no credential/identity/code value in run artifacts.

Assign the exact printed non-secret ID to the task-specific shell variable `AI_V2_GENERATION_RUN_ID` in the execution shell and require it to match the v2 run-ID format before continuing.

- [ ] **Step 6: Link a real three-repeat full gate**

```bash
test -n "$AI_V2_GENERATION_RUN_ID"
npm run ai:test:gate -- --spec specs/psychicbook-healing-experiment.md --test tests/regression/psychicbook-healing-experiment.spec.ts --run-id "$AI_V2_GENERATION_RUN_ID"
```

Expected: three clean executions, `full_gate.completed` classified passed, projection `fully-accepted`, then `run.closed`.

- [ ] **Step 7: Deliberately break exactly the Get Started locator**

Use `apply_patch` to change only `name: 'Get Started'` to `name: 'Get Started BROKEN'` in the isolated inline Page Object. Save the pre-break source SHA. Do not change assertions, steps, tags, data, helpers, or source header.

- [ ] **Step 8: Prove the controlled target is RED**

```bash
npx playwright test tests/regression/psychicbook-healing-experiment.spec.ts --project=chromium --workers=1 --retries=0 --repeat-each=1
```

Expected: nonzero exit with a missing Get Started locator; no auth, network, data, product assertion, or environment failure.

- [ ] **Step 9: Create the real healer proposal**

```bash
npm run ai:test:heal -- --test tests/regression/psychicbook-healing-experiment.spec.ts --spec specs/psychicbook-healing-experiment.md --generation-run "$AI_V2_GENERATION_RUN_ID" --project chromium --max-attempts 3 --verify-runs 2
```

Expected: baseline classified `locator-drift`, provider called only after triage, two clean candidate runs, status `proposal-ready`, broken target SHA unchanged, and printed heal run ID.

Assign the exact printed non-secret ID to the task-specific shell variable `AI_V2_HEAL_RUN_ID` in the execution shell and require it to match the v2 run-ID format before continuing.

- [ ] **Step 10: Audit and apply the exact reviewed proposal**

Inspect the verified projection and candidate diff. Require the semantic diff to restore only the Get Started locator and require candidate artifact SHA to equal `proposal.ready.candidateSha256`.

```bash
test -n "$AI_V2_HEAL_RUN_ID"
npm run ai:test:heal:apply -- --run "$AI_V2_HEAL_RUN_ID"
```

Expected: no provider initialization, repeated verification, exact archived bytes applied, post-apply gate passed, and terminal `proposal.applied`/`run.closed`.

- [ ] **Step 11: Run fresh final review, drift, and full gate**

```bash
npm run ai:test:review -- --spec specs/psychicbook-healing-experiment.md --test tests/regression/psychicbook-healing-experiment.spec.ts
npm run ai:spec:drift
npm run ai:test:gate -- --spec specs/psychicbook-healing-experiment.md --test tests/regression/psychicbook-healing-experiment.spec.ts
```

Expected: all exit zero; full gate shows three clean retry-zero results.

- [ ] **Step 12: Verify audit/security/integrity invariants**

Replay both v2 streams after deleting copies of their projections, compare semantic states, verify both hash chains and every artifact SHA, scan events/projections/artifacts/diffs for the runtime secret values without printing matches, and require zero leaks. Confirm the applied target bytes equal the archived candidate and the original intentional break no longer exists.

- [ ] **Step 13: Run the v2 usage report**

```bash
npm run ai:tokens:report -- --json
```

Expected: generation and healer attempts include token, duration, prompt-character, and cache telemetry; full-gate quality is not flattened; no v1/legacy row appears.

- [ ] **Step 14: Finish only after fresh verification evidence**

Run `git status --short`, inspect every changed path, and confirm no `.ai-runs/v2` artifact is staged. If any framework file changed while fixing verification, rerun the smallest failing test and the complete relevant suite, then commit that focused fix. Report exact commands, counts, v2 run IDs, sticky/replay/integrity results, and the deliberate omission of credential values.

---

## Final Review Checklist

- [ ] `rg` finds no production v1 schema/reader/writer/adapter/migration branch.
- [ ] Every target/cache mutation has a preceding verified intent event.
- [ ] Every authoritative decision replays and validates events rather than trusting projection bytes.
- [ ] Runtime-test fail → pass remains sticky-revoked in deterministic regression coverage.
- [ ] Official repeatEach and controlled max-failure fixtures reproduce the reviewed real-run shapes.
- [ ] Multiline missing-locator evidence classifies locator drift.
- [ ] Proposal and apply are separate processes; apply imports no AI transport.
- [ ] Candidate verification/archive/application bytes are identical with one final LF.
- [ ] Runtime forwarding, output redaction, and source-literal policies have independent tests.
- [ ] Locator provenance controls the one-character accessible-name warning.
- [ ] Provider attempts expose prompt/cache telemetry without raw prompts.
- [ ] Full deterministic suite and live PsychicBook experiment have fresh evidence.
