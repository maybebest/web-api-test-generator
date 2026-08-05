# Healer Policy-Rejection Diagnostics Design

## Problem

The healer's deterministic post-provider policy already produces local
`issueCodes`, but the orchestration layer discards them when it records a rejected
attempt. `recordAttempt()` retains only the attempt number, outcome, and stage
checks; `rejectedAttemptAudit()` likewise writes only the attempt number and
outcome. Public sanitization then deliberately replaces human-readable diagnostic
messages with a generic status.

As a result, a safe fail-closed rejection is visible only as `policy-rejected`.
Operators cannot distinguish an assertion downgrade from changed executable
semantics, a forbidden sleep, a secret-like literal, or another policy rule. The
2026-08-05 PsychicBook rerun demonstrated this defect across three consecutive
healer attempts.

## Goals

- Preserve stable, non-sensitive policy issue codes from policy evaluation through
  per-attempt audit files, `heal-summary.json`, and the public CLI result.
- Guarantee that every policy-rejected attempt exposes at least one safe code.
- Keep candidate source, diffs, raw policy messages, runtime evidence, secrets, DOM
  content, and request data out of rejected-attempt diagnostics.
- Preserve the healer's current fail-closed behavior and verification sequence.
- Add regression coverage that proves the codes survive every intended boundary.

## Non-goals

- Do not retain a policy-rejected candidate or its diff.
- Do not expose raw `policy.issues` through the CLI or audit files.
- Do not loosen any policy rule or make a rejected candidate executable.
- Do not change failure triage, provider prompting, retry count, candidate
  verification, proposal/apply behavior, or PsychicBook tests.
- Do not redesign or version the complete healer audit format.

## Considered approaches

### 1. Safe codes in CLI and audit JSON — selected

Carry allowlisted stable codes through the existing attempt trail and rejected
attempt audit. This fixes operability while keeping the diagnostic surface small
and deterministic.

### 2. Codes only in audit JSON

This would protect the public shape but leave normal CLI users with the same opaque
failure. It does not satisfy the requirement to make the rejection immediately
actionable.

### 3. Codes plus sanitized human-readable messages

This is more descriptive but expands the leak surface and makes the public contract
dependent on mutable prose. It is unnecessary when stable codes can be mapped to
documentation or local policy rules.

## Proposed behavior

A rejected attempt will expose the same additive `issueCodes` field in all three
interfaces:

```json
{
  "attempt": 1,
  "outcome": "policy-rejected",
  "checks": {
    "policy": "rejected"
  },
  "issueCodes": [
    "EXECUTABLE_SEMANTICS_CHANGED"
  ]
}
```

The field appears in:

1. the sanitized public `attemptTrail` returned to the CLI;
2. the `attemptTrail` stored in `heal-summary.json`;
3. `attempt-N.rejected-policy.json`.

Existing fields and status values remain unchanged. `issueCodes` is optional for
non-policy attempt outcomes, making the change additive for existing consumers.
The existing `test-heal-run/v1` and `test-heal-rejected-attempt/v1` schema names
remain valid because no field is removed or reinterpreted.

## Stable code set

Existing codes remain unchanged:

- `TRACEABILITY_HEADER_CHANGED`
- `IMPORTS_CHANGED`
- `TEST_DATA_CHANGED`
- `TEST_TITLE_CHANGED`
- `TEST_OPTIONS_CHANGED`
- `FIXTURE_BINDING_CHANGED`
- `STEP_TITLE_CHANGED`
- `ANNOTATION_CHANGED`
- `ASSERTION_ARGUMENT_CHANGED`
- `ACTION_PAYLOAD_CHANGED`
- `COVERAGE_TOKEN_CHANGED`
- `EXECUTABLE_SEMANTICS_CHANGED`
- `UNRESOLVED_DYNAMIC_REQUEST_MUTATION`
- `COMMENTS_CHANGED`

Rules that currently emit only prose receive stable codes:

- `EMPTY_HEALED_SOURCE`
- `HEALED_SOURCE_TOO_LARGE`
- `SOURCE_PARSE_FAILED`
- `SKIP_FAMILY_INTRODUCED`
- `DYNAMIC_TEST_ACCESS_INTRODUCED`
- `WAIT_FOR_TIMEOUT_INTRODUCED`
- `XPATH_INTRODUCED`
- `NTH_CHILD_INTRODUCED`
- `POSITIONAL_LOCATOR_EXCEPTION_MISSING`
- `ASSERTION_COUNT_REDUCED`
- `ASSERTION_MATCHER_REDUCED`
- `TRY_CATCH_INTRODUCED`
- `GUARDED_ASSERTION_INTRODUCED`
- `SECRET_LIKE_LITERAL`

The audit boundary accepts only codes from this local allowlist, removes duplicates,
and caps the list to the bounded number of policy rules. If a future policy rejection
forgets to assign a code, the boundary emits `POLICY_REJECTED_UNCLASSIFIED` rather
than returning an empty list. That fallback is itself allowlisted and is a signal
that the policy implementation needs a new stable code.

## Components and data flow

### Policy evaluation

`packages/web/scripts/ai/lib/test-heal.mjs` remains the source of truth. Every branch
that appends a policy issue also appends its stable code. Passing candidates continue
to return an empty issue-code list.

### Attempt recording and audit

`packages/web/scripts/ai/heal-test.mjs` will:

- normalize policy codes through a local allowlist helper;
- let `recordAttempt()` accept structured audit metadata for policy failures;
- preserve normalized codes in `auditAttemptTrail()`;
- pass the same codes into `rejectedAttemptAudit()`;
- keep all non-policy attempt records unchanged.

The original source remains the immutable comparison baseline across attempts. A
policy rejection still occurs before the candidate file is materialized, typechecked,
linted, contract-reviewed, or executed.

### Public result

`sanitizePublicResult()` already rebuilds `attemptTrail` through
`auditAttemptTrail()`. Once that boundary safely preserves allowlisted codes, the CLI
receives them automatically without exposing `policy.issues`.

### Provider retry notes

The existing internal path that supplies sanitized policy messages to the next
provider attempt remains unchanged. Those messages are not persisted in public or
audit output.

## Security properties

- Codes are framework-defined constants, not provider-controlled text.
- Unknown strings are discarded at the audit boundary.
- Codes contain no source excerpts, locator values, URLs, credentials, emails,
  payloads, or runtime evidence.
- Rejected candidate source and diff remain absent from disk.
- Public human-readable diagnostics remain generic.
- The original target remains unchanged after policy rejection.

## Error handling

- A policy rejection with known codes records the deduplicated codes in deterministic
  order.
- A policy rejection with no known code records only
  `POLICY_REJECTED_UNCLASSIFIED`.
- Non-policy failures do not gain an `issueCodes` field.
- Policy feedback supplied to a later provider attempt continues to use the existing
  sanitized prose and is not derived from the public audit object.

## Testing strategy

Implementation follows test-driven development.

1. Extend the existing policy-rejection integration test so it initially fails
   because `result.attemptTrail`, `heal-summary.json`, and each
   `attempt-N.rejected-policy.json` lack `issueCodes`.
2. Assert that a `test.skip` candidate produces
   `SKIP_FAMILY_INTRODUCED` in all three interfaces.
3. Assert that rejected audit files contain neither candidate source nor raw policy
   prose.
4. Add focused policy tests for branches that previously lacked codes, including
   empty/invalid source, forbidden sleeps, reduced assertions, guarded assertions,
   and secret-like literals.
5. Add a boundary test proving unknown codes are discarded and the unclassified
   fallback is used.
6. Run the focused healer tests, the complete policy test file, and the repository's
   relevant lint/type checks.

For regression-test credibility, the focused integration test must be observed RED
before production code changes and GREEN afterward.

## Files expected to change

- `packages/web/scripts/ai/lib/test-heal.mjs`
- `packages/web/scripts/ai/heal-test.mjs`
- `packages/web/scripts/ai/__tests__/test-heal.test.mjs`
- `packages/web/scripts/ai/__tests__/test-heal-policy.test.mjs`

No live browser run or stage credentials are required for this framework-level
diagnostic fix.

## Acceptance criteria

- Every `policy-rejected` attempt exposes at least one allowlisted `issueCodes` entry
  in public CLI output, `heal-summary.json`, and its rejected-attempt audit file.
- A known `test.skip` rejection exposes `SKIP_FAMILY_INTRODUCED` consistently.
- Raw issues, candidate source, and secret-like values do not appear in those outputs.
- Non-policy trail entries preserve their existing shape.
- Policy-rejected candidates remain unmaterialized and unexecuted.
- Existing healer and policy test suites pass after the change.
