# Two-Run Generated-Test Promotion Gate Design

**Date:** 2026-08-02
**Status:** User-approved design
**Scope:** Playwright flow-spec test generation only

## Problem

Verified test generation currently promotes an isolated candidate after one
Playwright execution. A separate full gate runs three repeats later. One passing
execution is too weak for the end-of-generation acceptance boundary: a timing-
sensitive candidate can be written to the target and admitted to the exact-result
cache before the stronger full gate observes it.

## Decision

Verified generation must execute every logical generated test exactly twice in
one Playwright command before promotion:

```text
--repeat-each=2 --retries=0
```

Both executions must pass. The existing full gate remains exactly three repeats.
The recording-generation gate is outside this change.

## Goals

- Promote a generated candidate only after two clean executions of every selected
  test in every selected Playwright project.
- Preserve isolated candidate generation and atomic target replacement.
- Preserve the full three-repeat gate and its subject-bound `--run-id` linkage.
- Prevent old one-repeat acceptance evidence from satisfying the new contract.
- Make the repeat policy explicit in cache fingerprints, telemetry, tests, and
  user-facing documentation.

## Non-Goals

- Do not change the three-repeat full gate.
- Do not change recording generation or recording gate repeat policy.
- Do not add retries, automatic runtime repair, or flaky-test tolerance.
- Do not run two separate Playwright commands.
- Do not change test-generation prompts or model routing.

## Architecture

### Shared policy

Introduce one shared generated-gate policy module with these canonical values:

```js
export const PROMOTION_GATE_REPEAT_EACH = 2;
export const FULL_GATE_REPEAT_EACH = 3;
export const PROMOTION_GATE_POLICY = 'verified-promotion-gate/v3';
export const GENERATED_GATE_REPEAT_VALUES = new Set([2, 3]);
```

The verified generator, single-pair gate, batch gate runner, quality fingerprint,
and tests must consume these values instead of duplicating numeric literals.

The generated-test gate defaults to the full value `3`. Its CLI accepts only `2`
and `3`; one-repeat generated-test acceptance is removed. The existing
`ai:test:gate:fast` compatibility script points to `--repeat-each 2`, while docs
describe it as the promotion/candidate lane. No new public command is required.

### Generation data flow

```text
validated task
  -> model output in isolated sibling candidate
  -> static review
  -> one Playwright command with repeat-each=2 and retries=0
  -> verify exact report multiplicity and two clean results per logical test
  -> recheck immutable candidate and target snapshots
  -> atomic target rename
  -> accepted-cache promotion
```

The same two-repeat gate runs after the single permitted static-repair attempt.
A repaired candidate starts acceptance from zero; a pass from the rejected source
does not count toward it.

### Acceptance invariant

Promotion is allowed only when all of the following are true:

1. Static generated-test review passes.
2. The report identifies the exact requested project and target test.
3. Project configuration records `repeatEach = 2` and `retries = 0`.
4. Every logical target test has exactly two executions.
5. Each execution has expected status `passed`, actual status `passed`, and one
   retry-zero successful result.
6. There are no failed, skipped, flaky, interrupted, duplicate, missing, top-level,
   setup, teardown, configuration, or report-contract failures.
7. Candidate bytes and the pre-generation target snapshot remain unchanged before
   atomic replacement.

One pass followed by a failure, skip, retry, or missing result rejects the whole
candidate. Runtime failures remain non-repairable; only an eligible static-review
failure can invoke the existing single repair attempt.

## Full gate and linkage

The full gate remains:

```text
--repeat-each=3 --retries=0
```

Only this full gate may carry `--run-id`. It continues to snapshot the current
spec and target, verify subject linkage, record `fullGatePassed`, and invalidate an
accepted cache reference only for a proven target-quality rejection.

The promotion quality fingerprint becomes canonical and contains:

```json
{
  "policy": "verified-promotion-gate/v3",
  "repeatEach": 2,
  "sourceSha256": "<candidate hash>",
  "outcome": "accepted",
  "stage": "<gate stage>",
  "reasonCode": "<gate reason>",
  "repairCount": 0
}
```

One helper must create this fingerprint for both verified generation and later
full-gate linkage. Old `verified-fast-gate/v2` one-repeat evidence remains readable
as historical telemetry but cannot satisfy the v3 linkage or promotion contract.
An exact-result cache hit still becomes an isolated candidate and must pass the
new two-repeat gate before replacing a target.

## Telemetry

Keep the existing `fastGatePassed` field for backward-compatible reporting, but
persist these additional quality fields for new runs:

```json
{
  "promotionGatePolicy": "verified-promotion-gate/v3",
  "promotionGateRepeatEach": 2
}
```

Token reporting continues to calculate the existing fast/full quality rates. Its
JSON output must additionally expose promotion-policy/repeat distributions so
one-repeat historical runs are not silently mixed with two-repeat runs when
comparing quality over time.

## Error handling

- A two-repeat rejection never overwrites the target.
- A fresh or cached rejected candidate is archived under the existing private run
  directory and its exact-cache reference is rejected or invalidated.
- Telemetry records the rejected promotion stage and no successful promotion.
- Cache-promotion failure after a successful target rename remains non-fatal and
  does not roll back a verified target.
- An unreadable or incomplete Playwright report fails closed as an environment or
  report-contract failure; it cannot be counted as two successes.

## Testing strategy

Implementation follows test-driven development. Update or add deterministic unit
tests before production changes for these cases:

- verified generation requests `repeatEach = 2` for both original and repaired
  candidates;
- CLI accepts `2` and `3`, rejects `1` and all other values, and defaults to `3`;
- a report with exactly two clean retry-zero passes is accepted;
- one result, three results, a failed second result, a skipped second result, or a
  retry in either result is rejected;
- target promotion and exact-cache promotion occur only after the two-pass verdict;
- v3 fingerprints link to a later full gate and v2 one-repeat fingerprints fail
  closed;
- new telemetry records and reports policy `v3` and repeat count `2`;
- batch full-gate behavior remains `3`, and recording gate behavior remains
  unchanged.

Run the focused gate/generation/telemetry tests, then the complete AI self-test,
golden evaluation, TypeScript typecheck, lint, and static generated-test review.
No paid provider call or external browser execution is required for this change.

## Documentation

Update current operational documentation and CLI help to say:

- generated candidates pass two executions before promotion;
- full acceptance still uses three executions;
- `ai:test:gate:fast` is the two-repeat candidate/promotion lane;
- accepted-only caching occurs after both promotion executions pass.

Historical design and plan documents remain historical; add an amendment only if
they are referenced as current behavior rather than rewriting their original
decisions.
