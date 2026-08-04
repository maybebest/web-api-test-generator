# Event-Sourced AI Runs v2 Design

**Date:** 2026-08-04

**Status:** Approved

## Decision Summary

Replace the current mutable generation and healing run records with a clean
event-sourced v2 implementation. New runs use append-only, hash-chained event
streams as their only source of truth. Mutable manifests become disposable,
deterministically rebuilt projections. Generation, gate linkage, healing,
proposal review, and proposal application use the same event and artifact
infrastructure.

This is a hard cutover. The implementation will not read, write, migrate, or
adapt v1 run artifacts. It will not dual-write v1 and v2. Existing v1 directories
may remain on disk as inert historical data, but v2 commands will ignore them.

The redesign also includes the hardening discovered during the PsychicBook
generation and healing review:

- sticky full-gate quality that a later pass cannot erase;
- a two-phase healer with apply-by-run-ID and no AI call during apply;
- structured, multiline-safe runtime triage;
- sanitized rejected-candidate verdicts;
- separate runtime-forwarding, output-redaction, and source-literal policies;
- exact candidate-byte preservation with normalized final newlines;
- locator provenance and warnings for weak accessible names;
- provider prompt/cache telemetry;
- correct Playwright `repeatEach` aggregation and controlled-failure handling;
- root npm commands for proposal creation and proposal application.

## Problem

The current implementation mixes audit history and mutable summary state.
Generation manifests are updated in place, so a later successful full gate can
replace the visible result of an earlier runtime test failure even though the
event history still contains both attempts. That makes the primary summary
misleading and makes cache decisions dependent on mutation order.

The reviewed runs also exposed several independent weaknesses:

- official Playwright JSON can represent repeated executions in shapes that a
  raw-entry counter rejects even when every requested execution passed;
- a controlled `maxFailures` stop can be mislabeled as an environment failure
  despite a proven target-test failure;
- multiline locator evidence can be classified as a synchronization timeout
  because the current fallback pattern does not span lines;
- rejected generation archives do not consistently persist a structured,
  sanitized verdict linked to the exact candidate and gate run;
- a verified healer proposal cannot be applied later by run ID, forcing review
  and mutation into one invocation or requiring manual copying;
- candidate bytes can differ from the applied file only because of final-newline
  handling;
- one shared set of “secret values” is being asked to serve three different
  security decisions with different false-positive costs;
- telemetry records token counts but not enough prompt/cache information to
  explain provider cost and latency.

Local patches can fix each symptom, but they preserve the central ambiguity:
which file is authoritative when append-only events and a mutable manifest
disagree. V2 removes that ambiguity.

## Goals

- Make the complete generation and healer history replayable from append-only
  events.
- Make projections deterministic and disposable.
- Detect incomplete writes, internal deletion/reordering, edited events, and
  cross-run events before source files or caches are mutated.
- Preserve exact relationships among a source subject, candidate bytes, gate
  evidence, cache decisions, healer proposals, and applied bytes.
- Prevent a proven runtime-test failure from becoming accepted through a later
  passing retry in the same generation run.
- Allow environment failures to be retried without misrepresenting candidate
  quality.
- Make healer proposal creation and proposal application separate commands.
- Apply exactly the archived and reverified candidate without another AI call.
- Keep secrets out of provider input, events, projections, artifacts, diffs, and
  generated source.
- Keep Playwright acceptance deterministic: fixed projects, `workers=1` where
  required, `retries=0`, exact repeat multiplicity, zero skipped tests, and zero
  flaky results.
- Preserve user work by failing on source-contract drift, target-byte drift, or
  concurrent mutation.
- Provide enough stable reason codes and telemetry for tests and later analysis
  without matching human prose.

## Non-Goals

- Reading, migrating, or adapting v1 run records.
- Dual-writing v1 and v2.
- Automatically deleting old v1 directories.
- Cryptographically signing events or providing remote WORM storage. The hash
  chain detects accidental or partial tampering; it does not prove authenticity
  against an attacker who can rewrite the complete stream or remove a complete
  suffix together with every local checkpoint.
- Supporting distributed writers on multiple hosts. V2 guarantees cooperative
  concurrency among local framework processes.
- General multi-file autonomous healing.
- Changing product code, expected product behavior, Markdown specifications, or
  recordings automatically.
- Treating retries, skips, or a pass-after-failure as successful deterministic
  execution.
- Persisting raw authenticated traces, screenshots, videos, cookies, headers, or
  storage state.
- Compacting event streams in the initial v2 release.

## Hard Cutover

The cutover is implemented in phases internally but ships as one behavior change:

1. Introduce the v2 event, artifact, schema, reducer, and projection modules.
2. Move generation, candidate gates, full-gate linkage, and cache decisions to
   v2.
3. Move healing, proposal verification, and apply-by-run-ID to v2.
4. Add the triage, secret, provenance, telemetry, and recovery hardening.
5. Remove v1 readers, writers, manifest mutation branches, compatibility flags,
   and v1-specific tests.
6. Update current documentation and execute the full deterministic and live
   acceptance suite.

There is no runtime switch between implementations. The only active storage root
is:

```text
packages/web/.ai-runs/v2/
```

Existing `packages/web/.ai-runs/generation/` and
`packages/web/.ai-runs/heal/` trees are ignored. The cutover does not delete them;
deletion is a separate, explicitly destructive maintenance action.

## Storage Layout

```text
packages/web/.ai-runs/v2/
  generation/<run-id>/
    events.jsonl
    projection.json
    artifacts/
      <sha256>.<extension>
  heal/<run-id>/
    events.jsonl
    projection.json
    artifacts/
      <sha256>.<extension>
```

Run directories are private (`0700`) and stored files are private (`0600`). A run
ID is a framework-generated UUID and is validated before being used in a path.
All artifact and target paths are resolved beneath their allowed repository
roots, reject traversal, and reject symlinks where the operation could mutate or
disclose data.

`events.jsonl` is the source of truth. `projection.json` is a cache. Artifact
files are immutable content referenced from events; an artifact that is not
referenced by a committed event has no semantic effect.

## Event Envelope

Every line in `events.jsonl` is one `ai-run-event/v2` object:

```json
{
  "schema": "ai-run-event/v2",
  "schemaVersion": 2,
  "streamKind": "generation",
  "runId": "<uuid>",
  "eventId": "<uuid>",
  "sequence": 1,
  "occurredAt": "2026-08-04T12:00:00.000Z",
  "type": "run.started",
  "payload": {},
  "previousEventHash": null,
  "eventHash": "<lowercase sha256>"
}
```

`streamKind` is `generation` or `heal`. Sequence numbers begin at one and are the
only ordering authority. Timestamps are evidence, not ordering inputs.

Each event type has an explicit runtime schema. Unknown fields, unknown event
types, unsupported schema versions, non-finite numbers, `undefined`, and invalid
paths fail closed. The serialized payload is limited to 64 KiB after sanitizing;
larger evidence must be admitted through the artifact store and referenced by
hash.

### Canonical event hashing

The event hash is SHA-256 over canonical UTF-8 JSON of every envelope field
except `eventHash`. Canonical JSON recursively sorts object keys, preserves array
order, and uses standard JSON scalar encoding. The digest is lowercase hex.

The first event has `previousEventHash: null`. Every later event must reference
the exact `eventHash` of the preceding sequence. `runId`, `streamKind`, sequence,
event ID, timestamp, event type, payload, and previous hash are therefore all
covered by the chain.

An event from another run cannot be copied into a stream without invalidating its
hash. Reordering, insertion, editing, and deletion inside the retained chain are
detected before reducers or side effects run. Suffix truncation is detected when
the existing projection/checkpoint names a later head. Proving malicious suffix
removal after all local checkpoints were also rewritten is outside the stated
integrity model.

## Event Store

`event-store-v2` owns all stream I/O. Callers cannot write `events.jsonl`
directly.

For each append it:

1. Acquires an atomic per-run lock directory containing a random owner nonce,
   process ID, host, and acquisition time.
2. Re-reads and validates the complete current stream.
3. Validates the proposed event payload against its event-type schema.
4. Sanitizes and bounds the payload.
5. Assigns the next sequence, previous hash, event ID, and hash.
6. Appends exactly one newline-terminated JSON record.
7. Flushes the file and containing directory before reporting success.
8. Rebuilds and atomically replaces the projection.
9. Releases only the lock whose owner nonce matches the process.

A stale lock may be recovered only when its recorded local process is no longer
alive and the lock exceeds the configured stale threshold. A live or ambiguous
owner causes a bounded `RUN_LOCKED` failure rather than lock stealing.

An unterminated final line is never a committed event. Recovery may quarantine
and truncate only that incomplete tail while holding the lock. Invalid JSON,
schema failure, sequence discontinuity, or hash failure before the final tail is
`EVENT_STREAM_CORRUPT` and is never repaired automatically.

If an event append succeeds but projection replacement fails, the command
reports a projection error but does not roll back the event. The next read
rebuilds the projection from the valid stream.

## Artifact Store

`artifact-store-v2` admits an artifact before the referencing event is appended:

1. Validate its artifact kind and size limit.
2. Sanitize it according to its media type and purpose.
3. Apply source-secret policy where the artifact can contain source.
4. Normalize generated or healed TypeScript candidates to exactly one final LF.
5. Compute SHA-256 over the exact admitted bytes.
6. Write a private temporary file, flush it, and atomically rename it to its
   content-addressed path.
7. Return a typed reference for the event payload.

Original source bytes used for concurrency checks and rollback are captured
exactly and are not newline-normalized. Candidate checks, candidate hashing,
diff generation, archive storage, and eventual application all use the same
normalized candidate bytes.

Artifact references have this minimum shape:

```json
{
  "schema": "ai-run-artifact-ref/v2",
  "kind": "candidate-source",
  "sha256": "<lowercase sha256>",
  "bytes": 2048,
  "mediaType": "text/typescript",
  "relativePath": "artifacts/<sha256>.ts",
  "sanitization": "source-policy-passed"
}
```

An existing path is reused only when its bytes hash to the requested digest.
Hash/path disagreement is corruption. A crash before the referencing event can
leave an orphan artifact; it is ignored and may be removed later by a bounded
garbage collector. Events never reference missing or hash-mismatched artifacts.

A secret-bearing candidate is not archived as source. Its rejection event stores
only safe hashes, policy reason codes, and non-secret metadata.

The healer must safely admit the exact original bytes because they are required
for concurrency checks and rollback. If the original source fails persistence
secret policy, healing stops before provider invocation with a stable
`ORIGINAL_SOURCE_UNSAFE_TO_ARCHIVE` reason; it does not create a proposal that
cannot safely roll back.

## Projections

`generation-reducer` and `heal-reducer` are pure functions over validated event
sequences. They do not read files, clocks, environment variables, or network
state. Replaying the same stream produces byte-for-byte equivalent semantic
state.

`projection.json` contains:

```json
{
  "schema": "ai-run-projection/v2",
  "schemaVersion": 2,
  "streamKind": "generation",
  "runId": "<uuid>",
  "builtFrom": {
    "lastSequence": 12,
    "lastEventHash": "<sha256>"
  },
  "stateHash": "<sha256 of canonical state>",
  "state": {}
}
```

There is no generated-at timestamp because wall-clock projection metadata would
make replay output nondeterministic. Relevant times come from source events.

`builtFrom` detects staleness but is not treated as proof that `state` was not
edited. Every command that can mutate a target, cache, stream lifecycle, or other
active state replays the validated events and compares the canonical reducer
state and `stateHash` with the projection before acting. The shared verified-read
API does the same for authoritative reports. A missing, stale, invalid, or
mismatched projection is rebuilt and atomically replaced. Business logic is not
allowed to update a projection field directly or make a side-effect decision
from an unverified projection.

This initial v2 release deliberately prefers replay correctness over checkpoint
optimization. Signed or externally anchored reducer checkpoints can be designed
later if stream size makes verified replay material.

### Generation projection contract

The generation state contains, at minimum:

- lifecycle status and whether the stream is closed;
- immutable subject, input, policy, and context fingerprints;
- provider attempts with safe usage/cache telemetry;
- candidates keyed by `(runId, candidateId)` with source SHA and artifact refs;
- static review and gate attempts keyed by attempt ID;
- promotion intent/result and current target SHA;
- full-gate attempts in event order;
- aggregate quality, sticky revocation event/reason, and provisional/full
  acceptance state;
- cache promotion/invalidation history and current active reference;
- last safe error and available next actions.

### Healer projection contract

The healer state contains, at minimum:

- lifecycle status and whether the stream is closed;
- subject, exact original SHA, and source-contract fingerprints;
- baseline and structured triage;
- provider attempts with safe usage/cache telemetry;
- candidate ID, candidate SHA, diff, provenance, and artifact refs;
- required checks and their latest attempt IDs;
- proposal readiness and immutable verification fingerprint;
- apply attempts, preconditions, target hashes, rollback state, and terminal
  outcome;
- last safe error and available next actions.

Reducers reject an event that would overwrite immutable subject/candidate facts,
reuse an attempt ID, skip a required transition, or follow `run.closed`.

## Stream Lifecycle

`run.started` is the first event. `run.closed` is genuinely terminal: no domain
events may follow it. Long-lived states therefore do not use `run.closed` merely
because one CLI invocation returned.

- A generation command that provisionally promotes a candidate emits
  `generation.phase_completed` and remains open while awaiting a full gate.
- An environment-blocked full gate leaves the generation stream open for a
  retry of the same candidate.
- A healer proposal emits `proposal.ready` and remains open for later apply,
  rejection, or expiry.
- `run.closed` follows a final generation acceptance/rejection, explicit closure
  of a sticky-revoked stream, or a final healer applied/rejected/expired outcome.
- A sticky-revoked generation stream remains open long enough to record later
  diagnostic full-gate attempts. Those attempts cannot change its quality. It is
  closed only when the workflow explicitly declares that no more diagnostic
  evidence will be attached.
- An operator may append `run.abandoned` and then `run.closed` when an open run
  will never continue.

This distinction prevents an apparent terminal event from being followed by a
later full-gate or proposal-application event.

## Cross-Run Relationships

There are no distributed mutations across run directories. A workflow writes
only its own stream.

- A healer `subject.bound` event may reference the generation run ID and source
  SHA that produced the target.
- Gate attempts linked to a generation candidate are events in that generation
  stream and carry a unique `gateRunId`.
- Reporting builds generation-to-healer relationships from these immutable
  references.

If a referenced stream is missing or does not bind the stated subject hash, the
relationship is invalid. A report may show the streams independently, but no
quality or apply decision may use the broken link.

## Generation Domain Events

The generation stream supports these event families:

| Event | Meaning |
| --- | --- |
| `run.started` | Bind command version and sanitized invocation metadata. |
| `subject.bound` | Bind spec, target, mode, project, policy, and source hashes. |
| `input.assembled` | Record bounded provider-input and context fingerprints. |
| `preflight.completed` | Persist the structured preflight verdict. |
| `preflight.rejected` | Reject before provider invocation. |
| `provider.attempt_started` | Record provider/model, attempt ID, and request fingerprint. |
| `provider.attempt_completed` | Record sanitized usage, duration, cache status, and a safe output artifact or rejection fingerprint. |
| `provider.attempt_failed` | Record a safe error category and retry decision. |
| `provider.attempt_unknown` | Mark an interrupted external call whose outcome is unknowable. |
| `candidate.generated` | Bind candidate ID, exact bytes, and provenance artifacts. |
| `candidate.review_completed` | Record static policy/reviewer result. |
| `gate.started` | Bind candidate SHA and deterministic execution configuration. |
| `gate.completed` | Store the structured sanitized verdict and report reference. |
| `candidate.rejected` | Record final pre-promotion rejection reason codes. |
| `candidate.accepted` | Record promotion-gate acceptance for the exact SHA. |
| `candidate.promotion_started` | Bind original/candidate snapshots before target mutation. |
| `candidate.promoted` | Record atomic target replacement and resulting target SHA. |
| `cache.promoted` | Bind an exact-result cache entry to candidate and quality fingerprints. |
| `cache.invalidated` | Record removal from the active cache index and its reason. |
| `generation.phase_completed` | Mark the generation command result without sealing the stream. |
| `full_gate.started` | Bind a later full-gate attempt to the unchanged subject SHA. |
| `full_gate.completed` | Persist the full-gate verdict used by sticky quality reduction. |
| `run.abandoned` | Explicitly abandon an open stream. |
| `run.closed` | Seal the final state. |

Every side effect has a corresponding event only after the side effect is
verified. Intent events such as `gate.started` and `provider.attempt_started`
allow recovery to distinguish “not attempted” from “outcome unknown.”

Candidate identity is `(runId, candidateId, sourceSha256)`. `candidateId` is a
new UUID for every model/cache candidate admission. Equal bytes in another run
or candidate ID do not inherit quality history.

Candidate promotion follows the same write-ahead discipline as healer apply.
`candidate.promotion_started` is appended before target mutation and includes the
exact original and candidate snapshots. If a crash occurs before
`candidate.promoted`, recovery compares the bound target to those hashes: the
original hash means promotion did not complete, the candidate hash permits
post-promotion verification and event completion, and any third hash is a
concurrent mutation that fails closed.

## Structured Gate Verdict

All generation and healer runtime gates use one `ai-gate-verdict/v2` artifact and
a bounded summary in the event payload. It contains:

- gate kind, stage, gate run ID, and candidate/source SHA;
- selected projects, workers, retries, `repeatEach`, and `maxFailures`;
- command exit code, duration, and report-contract version;
- logical test identities and their execution counts;
- passed, failed, skipped, flaky, interrupted, setup, and top-level failures;
- `outcome`: `passed`, `failed`, or `unknown`;
- `classification`: `passed`, `runtime-environment`, `runtime-test`,
  `static-policy`, or `report-contract`;
- stable reason codes;
- sanitized evidence fingerprints and report artifact references.

Logical identity is project plus canonical file plus suite/title path. Repeat
entries and `results[]` are aggregated under that identity. A required logical
test passes only when it has exactly `repeatEach` retry-zero successful results
and no failed, skipped, flaky, interrupted, missing, duplicate, setup, teardown,
or report-contract failure.

A controlled `maxFailures` termination is `runtime-test` whenever the report
proves the requested target failed. It is `runtime-environment` only when no
target-quality failure is proven and environment/setup evidence explains the
absence of target results.

The deterministic execution policy remains explicit:

- candidate promotion gate: `repeatEach=2`, `retries=0`;
- full generation gate: `repeatEach=3`, `retries=0`;
- healer proposal verification: two serial retry-free executions by default;
- healer apply: repeat the exact proposal verification count, then run one
  post-apply gate against the real target;
- healer verification uses `workers=1`; generation workers/projects are the
  values bound by the generation policy and recorded in every attempt.

Changing these values requires a versioned policy fingerprint and new tests; a
projection cannot reinterpret old v2 evidence under a new repeat policy.

## Generation Quality State Machine

The reducer exposes a state for the exact candidate SHA:

```text
draft
  -> rejected
  -> provisionally-accepted
       -> awaiting-full-gate
            -> fully-accepted
            -> environment-blocked -> awaiting-full-gate
            -> revoked
```

Rules:

1. Static, policy, review, report-contract, or promotion-gate runtime-test
   failures reject the candidate before promotion.
2. Promotion-gate `runtime-environment` leaves quality unknown and permits a
   bounded retry of the same SHA.
3. A promoted candidate is provisional until its full gate passes.
4. A full-gate `runtime-environment` is unknown. It is recorded and the same
   unchanged candidate may be retried in the same stream.
5. A full-gate `runtime-test` transitions the candidate to `revoked`.
6. `revoked` is sticky. Later passing attempts remain visible in
   `fullGateAttempts` but cannot transition that candidate or run back to
   `fully-accepted`.
7. Resetting a proven runtime-test failure requires a new generation run and a
   new candidate identity, even if the new bytes happen to be equal.
8. A full gate may link only when the current spec, target, mode, policy, and
   candidate SHA match `subject.bound` and `candidate.promoted`.

On revocation, the active exact-result cache reference is removed before
`cache.invalidated` is appended. The promoted target is not automatically
reverted by a later independent full-gate command because it may have acquired
legitimate user changes. The command exits nonzero, the projection reports
`revoked`, and a new generation or reviewed healer flow is required.

Revocation is terminal for quality but not immediately terminal for event
collection. Additional full-gate attempts may be appended for diagnostics, and
the stream is sealed only by a later explicit `run.closed`. This is how v2 can
preserve a pass-after-failure without allowing that pass to erase the failure.

The projection exposes the aggregate sticky state and every attempt. It never
collapses history into one overwriteable `fullGatePassed` boolean.

## Existing Generated-Test Contract

V2 changes orchestration and evidence storage, not the meaning of an acceptable
generated Playwright test. The current spec validation, generation-mode,
AC/NEG/tag mapping, source header, selector, fixture, authentication, assertion,
no-skip, no-retry, project, reviewer, drift, and deterministic gate policies
remain enforced. Their versioned fingerprints are recorded in `subject.bound`
and gate events so a policy change cannot reinterpret earlier evidence.

No v2 event or projection can waive a static policy failure. Any deliberate
change to those contracts is a separate design decision with new policy versions
and regression tests.

## Healer Domain Events

The healer stream supports:

| Event | Meaning |
| --- | --- |
| `run.started` | Record healer version and sanitized invocation metadata. |
| `subject.bound` | Bind target, source contract, project, and optional generation run. |
| `source.captured` | Reference exact original bytes and source-contract fingerprints. |
| `baseline.completed` | Record deterministic baseline verdict. |
| `triage.completed` | Record classification, reason codes, and evidence fingerprint. |
| `provider.attempt_started` | Bind model, attempt ID, prompt fingerprint, and context fingerprints. |
| `provider.attempt_completed` | Record usage, duration, cache status, and a safe candidate artifact or rejection fingerprint. |
| `provider.attempt_failed` | Record safe failure and bounded retry decision. |
| `provider.attempt_unknown` | Mark an interrupted provider call. |
| `candidate.generated` | Bind candidate ID, normalized bytes, and diff artifacts. |
| `candidate.check_completed` | Record one policy, typecheck, lint, review, drift, integrity, or runtime result. |
| `candidate.verified` | Assert all required checks passed for the exact candidate SHA. |
| `proposal.ready` | Expose an immutable reviewed proposal without mutating the target. |
| `proposal.apply_started` | Begin one apply attempt with captured preconditions. |
| `proposal.apply_preflight_completed` | Record apply-time integrity and repeated verification. |
| `proposal.applied` | Record verified atomic promotion of exact candidate bytes. |
| `proposal.apply_failed` | Record a safe apply or post-apply failure. |
| `proposal.rolled_back` | Record verified restoration of exact original bytes. |
| `proposal.rollback_blocked` | Record that concurrent mutation made rollback unsafe. |
| `proposal.rejected` | Explicitly reject a proposal without application. |
| `proposal.expired` | Close an obsolete proposal. |
| `run.abandoned` | Explicitly abandon a nonterminal run. |
| `run.closed` | Seal the final state. |

`proposal.ready` is reachable only for repairable runtime evidence and a
candidate that passes every required check. `already-green`, environment,
product/contract, data, auth, network, unclassified, and manual multi-file change
paths record their own final reason and close without a proposal.

## Healer Safety Envelope

The event redesign preserves the existing fail-closed semantic guard. A healer
candidate must preserve exactly:

- Markdown-spec and recording traceability headers;
- imports and fixture callback bindings;
- test, describe, and step titles;
- tags, annotations, AC/NEG coverage, recording step/assertion tokens, and
  `covered-ac-ids`;
- test data, navigation targets, and action payloads;
- assertion matchers, expected operands, count, and control-flow position;
- source-contract, spec, and recording fingerprints.

Allowed differences remain limited to behavior-preserving locator expressions,
approved synchronization primitives, directly related locator-policy comments,
and nonsemantic formatting. Skip/fixme/fail/only, hard waits, XPath, unjustified
positional selectors, swallowed failures, conditional assertions, secret
literals, and expected-behavior changes fail policy.

Source-contract routing is explicit:

- Markdown-spec targets validate the spec, run the generated-test reviewer,
  verify the spec hash, run drift, and execute the selected generated-test gate.
- Recorded targets validate the recording, run the recorded reviewer and drift
  checks, and execute the recorded-test gate.
- Handwritten targets run semantic policy, TypeScript, ESLint, and the bound
  Playwright project under the repository's handwritten-test rules.
- Ambiguous or malformed ownership fails before provider invocation.

Imported Page Object and Component source is context only. If a safe repair
requires changing another file, the run closes as `manual-change-required`; the
healer does not work around the contract in the test and does not promote a
multi-file patch.

## Two-Phase Healer Commands

Proposal creation:

```bash
npm run web:ai:heal -- --test <repository-relative-test-path>
```

Proposal application:

```bash
npm run web:ai:heal:apply -- --run <heal-run-id>
```

Root package scripts delegate explicitly to the web workspace:

```json
{
  "web:ai:heal": "npm run -w packages/web ai:test:heal --",
  "web:ai:heal:apply": "npm run -w packages/web ai:test:heal:apply --"
}
```

The web workspace exposes `ai:test:heal` and `ai:test:heal:apply`. The old
same-invocation `heal --apply` path is removed, and the proposal command rejects
that flag rather than silently interpreting it.

Apply does not accept a source candidate, prompt, model, or replacement target
from the command line. The run ID selects the previously verified proposal.

## Proposal Apply Protocol

`heal:apply` performs these steps:

1. Resolve the run beneath `.ai-runs/v2/heal/` and validate its complete hash
   chain and projection.
2. If the run is already closed as applied and the target has the recorded
   candidate SHA, return that existing successful result. Otherwise require an
   open `proposal.ready` state with no prior terminal application, rejection, or
   expiry.
3. Validate the original, candidate, diff, verdict, and source-contract artifact
   references and hashes.
4. Resolve the bound target as a regular, non-symlink file beneath the allowed
   test root.
5. Require the current target SHA to equal the proposal's exact original SHA and
   require the spec/recording/source-contract fingerprints to remain unchanged.
   Unrelated dirty files do not block apply; changing the bound target does.
6. Re-run policy, integrity, source reviewer, typecheck, lint, drift, and the
   recorded number of serial retry-free runtime verification runs against the
   archived candidate in the isolated verification context.
7. Append `proposal.apply_started` and
   `proposal.apply_preflight_completed` with a unique apply attempt ID.
8. Write the exact archived candidate bytes to a private sibling temporary file,
   flush it, recheck target device/inode/size/mtime/content snapshot, atomically
   replace the target, and flush the parent directory.
9. Require the resulting target SHA to equal the candidate SHA.
10. Run the post-apply gate against the real target.
11. Append `proposal.applied`, then `run.closed`.

No provider or AI transport is initialized by the apply command. Tests enforce
this as an architectural property, not only a mocked call count.

### Apply failure and rollback

If a failure occurs before target replacement, the target remains unchanged and
`proposal.apply_failed` is appended. The proposal may be retried when its
preconditions still hold.

If the post-apply gate fails, rollback is allowed only when the target still
hashes to the candidate SHA. The exact archived original bytes are restored by
the same atomic protocol, verified, and recorded as `proposal.rolled_back`.

After a safe rollback, an environment-only post-apply failure returns the stream
to `proposal-ready` for a bounded retry. A runtime-test, policy, integrity, or
source-contract failure appends `proposal.rejected` and `run.closed` after the
rollback. It cannot be retried as the same reviewed proposal.

If the target changed after application, rollback must not overwrite that newer
work. The stream records `proposal.rollback_blocked`, exits nonzero, and requires
manual resolution. This is a terminal `manual-resolution-required` outcome and
is followed by `run.closed`; any later repair starts a new healer run.

Apply is idempotent:

- `proposal.applied` plus target candidate SHA returns the existing successful
  result;
- `proposal.apply_started` with target candidate SHA but no terminal event enters
  recovery, runs the post-apply gate, and records applied or safely rolls back;
- `proposal.apply_started` with target original SHA records or resumes a failed
  pre-replacement attempt;
- any third target SHA is concurrent mutation and fails closed.

## Runtime Triage

`runtime-triage` consumes structured Playwright report data first:

- failing project and logical test identity;
- failing step and action;
- locator string or semantic locator representation;
- Playwright error class and structured error message;
- sanitized attachment metadata, never raw authenticated artifacts;
- setup, teardown, network, and top-level failures.

Sanitized text is a fallback only. Fallback matching is explicitly multiline
safe and operates on bounded input. Evidence precedence is deterministic:

1. Product/contract assertion, auth, network, data, and setup evidence prevents
   automatic healing.
2. Proven missing/ambiguous locator, strict-mode violation, detached target, or
   locator-bound action failure may be `locator-drift`.
3. Proven actionability/readiness timing without locator absence may be
   `synchronization`.
4. Contradictory or insufficient evidence is `unclassified`.

The result schema contains classification, `repairable`, stable reason codes,
evidence fingerprints, and the structured evidence sources used. Only
`locator-drift` and `synchronization` may invoke the healer provider.

The regression suite includes a multiline click-timeout plus `element(s) not
found` case and requires locator-drift classification rather than generic
actionability timeout.

## Secret Policies

V2 replaces the overloaded shared-secret-value helper with three explicit
policies.

### Runtime forwarding

`runtime-env-policy` defines which named environment variables a deterministic
subprocess may receive. Forwarding is allowlisted per command and does not imply
that the value is safe to persist or place in source.

### Output redaction

`output-redaction-policy` removes configured sensitive environment values,
credential headers, cookies, tokens, passwords, verification codes, storage
state, and secret-like patterns before data can enter provider input, an event,
an artifact, a projection, or user-visible diagnostic output.

The Basic-auth username may be runtime configuration and is still redacted from
saved evidence. Redaction is recursive for structured values and bounded before
regex processing.

### Source-literal rejection

`source-secret-policy` scans generated or healed source for forbidden literal
values and secret-like constructs. Passwords, tokens, verification codes, auth
headers, and sensitive runtime values must be referenced through approved env or
fixture abstractions rather than emitted as literals.

Collision-prone non-secret configuration such as a Basic-auth username is not
automatically a forbidden source literal merely because it is redacted in logs.
This decision is policy-specific and tested.

Every persistence boundary applies the relevant policy. Raw provider responses
that fail source-secret checks are not archived as source.

## Locator Provenance

Generation stores sanitized discovery evidence for each new or changed locator:

- normalized target URL without credentials or sensitive query values;
- DOM/accessibility snapshot fingerprint;
- discovery timestamp from the event;
- locator strategy, role, accessible name, label, placeholder, or test ID;
- observed match count and uniqueness result;
- source range or Page Object member that consumes the locator;
- discovery tool/policy version.

Raw agent-browser refs such as `@e1` are never accepted as Playwright locators.
The framework selector policy still owns final selection.

A one-character accessible name produces a deterministic review warning unless
the referenced, current discovery evidence proves uniqueness. Missing, stale,
hash-mismatched, or wrong-origin provenance does not satisfy that exception.

The sanitized provenance artifact is linked by SHA from `candidate.generated`
and participates in the candidate quality fingerprint.

## Provider and Cache Telemetry

Each provider attempt records safe structured telemetry:

- provider kind and model;
- attempt ID and retry reason;
- duration;
- input, output, and total tokens when reported;
- prompt character count after final prompt assembly;
- prompt schema and prompt fingerprint, never prompt contents;
- provider-cache read status and write status;
- framework exact-result cache hit/miss/write status;
- output byte count and finish reason;
- safe error category for failed or unknown attempts.

An interrupted external call is recorded as `provider.attempt_unknown`. A retry,
when the configured attempt budget allows it, receives a new attempt ID and
explicitly references the unknown attempt. V2 does not pretend that the first
call consumed zero time or cost.

Cache entries bind the complete subject fingerprint, candidate SHA, promotion
quality fingerprint, locator provenance fingerprint, prompt schema, provider
identity, and policy versions. A runtime-test revocation removes the active
reference; historical cache events remain replayable.

## Recovery and Error Handling

All workflows fail closed when audit persistence is unavailable. A command may
not mutate a target or active cache if it cannot first validate and append the
required intent event.

Recovery rules include:

- stale or missing projections are rebuilt from events;
- an incomplete final JSONL record is quarantined and truncated under lock;
- internal stream corruption blocks the run;
- orphan artifacts are ignored and may be garbage-collected;
- an interrupted provider call becomes an unknown attempt, never an inferred
  success;
- an interrupted gate receives a completed unknown/environment verdict only when
  safe structured evidence supports it;
- an interrupted promotion/apply is resolved by comparing exact original,
  candidate, and current target hashes;
- cache promotion and invalidation are idempotent by entry key and candidate SHA;
- a missing or hash-mismatched required artifact blocks replay-dependent side
  effects.

Human-facing errors include run ID, stage, stable reason code, and the safe path
to the projection or verdict. They do not include credential values or raw
provider/browser payloads.

## Testing Strategy

Implementation follows red-green-refactor cycles. Production behavior is not
added before its failing deterministic test.

### Event and artifact infrastructure

- event schema acceptance and rejection;
- canonical JSON stability and known hash vectors;
- sequence and previous-hash validation;
- detection of edited, inserted, internally deleted, reordered, and cross-run
  events, plus suffix truncation when a later local checkpoint exists;
- concurrent append serialization;
- live-lock refusal and stale-lock recovery;
- incomplete-tail recovery and internal-corruption refusal;
- artifact deduplication, hash/path disagreement, and orphan behavior;
- source normalization to one final LF;
- original-byte preservation;
- deterministic projection rebuild and stale-projection replacement.

### Generation reducer and gates

- every valid state transition and every forbidden transition;
- full-gate pass to `fully-accepted`;
- environment failure followed by pass;
- runtime-test failure followed by pass remains `revoked`;
- cache invalidation on revocation;
- subject/source hash mismatch rejection;
- official Playwright JSON `repeatEach` aggregation by logical identity;
- exact repeat count, retry-zero, no-skip, and no-flaky enforcement;
- controlled `maxFailures` with proven target failure is `runtime-test`;
- rejected candidates retain sanitized structured verdicts linked by SHA.

### Healer and apply

- baseline green creates no proposal;
- non-repairable failures never initialize the provider;
- multiline missing-locator evidence is repairable locator drift;
- proposal mode leaves the target byte-for-byte unchanged;
- every required check precedes `proposal.ready`;
- apply resolves only the archived run candidate;
- apply initializes no AI/provider transport;
- changed target or source-contract fingerprint blocks apply;
- candidate hash mismatch and event-chain corruption block apply;
- exact archived bytes, including final LF, are promoted;
- apply recovery is idempotent after each crash boundary;
- post-apply failure restores exact original bytes when safe;
- concurrent post-apply mutation blocks rollback rather than overwriting work.

### Security and telemetry

- runtime forwarding, output redaction, and source-literal rejection have
  independent fixtures and expectations;
- Basic-auth username behavior is policy-specific;
- credentials and verification values are absent from provider input, events,
  projections, artifacts, diffs, and diagnostics;
- secret-bearing provider output is rejected without source archival;
- prompt characters, token usage, cache statuses, duration, and retry reason are
  projected correctly;
- raw prompt and browser evidence are never persisted.

### Repository and end-to-end verification

- focused v2 unit and integration tests;
- the complete updated AI script test suite;
- TypeScript typecheck and ESLint;
- generated/recorded static reviewers and drift checks;
- deterministic local Playwright gates;
- a live external PsychicBook experiment using environment-only credentials:
  generate the account-menu test, pass its full gate, intentionally break its
  locator, create a healer proposal, apply it by run ID, and confirm the repaired
  test passes.

Live credentials and verification values are supplied only at runtime and are
never written to the repository or v2 artifacts.

## Documentation

Update current `packages/web` AI-testing documentation, CLI help, environment
examples, architecture, troubleshooting, and healer/generation prompts to state:

- v2 event streams are authoritative and projections are rebuildable;
- v1 runs are unsupported and ignored;
- provisional generation versus full-gate acceptance;
- sticky revocation after a proven runtime-test failure;
- proposal-only healing and apply-by-run-ID;
- apply performs no AI call and requires unchanged target/source contracts;
- only locator-drift and synchronization failures are repairable;
- exact runtime secret handling and artifact privacy rules;
- locator provenance requirements and warning semantics;
- root and workspace npm commands.

Historical design documents remain historical records. Current operational docs
must not describe v1 behavior as supported.

## Acceptance Criteria

The redesign is complete only when all of the following are true:

1. Generation and healer commands write only `.ai-runs/v2` streams.
2. No production v1 reader, writer, adapter, migration, dual-write, or feature
   switch remains.
3. Deleting a projection and replaying events reproduces the same semantic state.
4. No business status can be changed by editing only a projection.
5. Corrupt event chains or required artifacts are detected before source/cache
   mutation.
6. Every candidate, verdict, promotion, cache decision, proposal, and application
   is linked by exact SHA and run/attempt IDs.
7. A full-gate runtime-test failure remains revoked after any later pass in the
   same generation stream.
8. An environment failure can be retried without being counted as a candidate
   quality failure.
9. Rejected generation attempts retain a sanitized structured verdict.
10. `web:ai:heal` creates a proposal without mutating the target.
11. `web:ai:heal:apply -- --run <id>` applies the exact archived candidate and
    performs no AI call.
12. Target or source-contract drift prevents apply, and unsafe rollback never
    overwrites concurrent work.
13. Multiline missing-locator evidence is not mislabeled as generic
    synchronization timeout.
14. Runtime env forwarding, artifact redaction, and source-secret rejection are
    separate enforced policies.
15. Generated/healed candidate source uses exactly one final LF from verification
    through application.
16. Provider usage includes prompt-character and cache telemetry without prompt
    contents.
17. Root npm commands work without changing directories.
18. The updated deterministic suite and the final live PsychicBook
    generate-break-propose-apply-verify experiment pass.

## Implementation Boundary

This document is one coherent design because generation and healer reliability
depend on the same event, artifact, verdict, security, and recovery contracts.
The implementation plan may divide delivery into substrate, generation, healer,
hardening, cutover, and live-verification phases, but no phase may ship a mixed
v1/v2 production mode.
