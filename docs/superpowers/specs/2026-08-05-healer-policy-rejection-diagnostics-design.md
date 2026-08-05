# Healer Policy-Warning Diagnostics and Soft-Fail Design

## Problem

The healer's deterministic post-provider policy detects unsafe or out-of-contract
candidate changes, but its orchestration layer currently discards the locally
computed `issueCodes`. Operators see only `policy-rejected`, so they cannot tell
which rule fired.

The same policy is also a hard gate: any violation consumes an attempt before
typecheck, lint, contract review, or live verification. For the current framework
experiment, the user has explicitly chosen to make policy evaluation diagnostic
rather than blocking in both proposal-only and `--apply` modes.

This is an intentional safety trade-off. The policy still evaluates every candidate
and reports stable codes, but the remaining gates decide whether the candidate can
be proposed or applied.

## Goals

- Preserve stable, non-sensitive policy issue codes through audit artifacts,
  programmatic results, and CLI output.
- Change policy violations from hard rejection to visible warnings in every mode.
- Continue typecheck, lint, contract review, live verification, diff, and integrity
  checks after a policy warning.
- Distinguish clean and warning-bearing proposal/apply outcomes with explicit
  statuses and CLI messages.
- Apply a fully verified warning-bearing candidate when `--apply` is present, then
  return exit code `1` so CI or a calling script cannot treat it as a clean heal.
- Keep candidate secret preflight and every non-policy safety gate unchanged.

## Non-goals

- Do not delete or bypass policy evaluation.
- Do not hide policy warnings or collapse them into a generic message.
- Do not expose raw `policy.issues`, candidate source excerpts, runtime evidence,
  secrets, DOM content, URLs, credentials, emails, or request payloads in warning
  diagnostics.
- Do not bypass typecheck, lint, generated/recorded contract review, consecutive live
  verification, target/candidate integrity, or atomic promotion safeguards.
- Do not change failure triage, provider selection, retry budgets, or PsychicBook
  tests as part of this framework fix.

## Considered approaches

### 1. Policy warning in proposal-only and apply modes — selected

Policy always evaluates and reports codes, but never stops the candidate by itself.
All remaining gates still run. A warning-bearing proposal is successful but clearly
labelled; a warning-bearing apply mutates the target only after full verification and
then exits non-zero.

### 2. Policy warning only in proposal-only mode

This preserves automatic-apply safety but does not meet the updated requirement that
policy rejection also be a soft failure under `--apply`.

### 3. Remove policy evaluation entirely

This reduces code but destroys the evidence needed to improve the framework and
makes clean and policy-violating candidates indistinguishable. It is rejected.

## Outcome matrix

| Mode | Policy | Remaining gates | Target | Status | CLI exit |
|---|---|---|---|---|---:|
| proposal-only | passed | passed | unchanged | `proposal-ready` | `0` |
| proposal-only | warning | passed | unchanged | `proposal-ready-with-policy-warnings` | `0` |
| `--apply` | passed | passed | replaced atomically | `healed` | `0` |
| `--apply` | warning | passed | replaced atomically | `healed-with-policy-warnings` | `1` |
| either | passed or warning | any later gate fails | unchanged | existing later-gate failure status | `1` |

The warning-bearing apply deliberately changes the file before returning a non-zero
exit. The backup, candidate, diff, summary, and warning codes give the operator the
information needed to review or restore it. A subsequent run against the now-green
target is a separate execution and does not erase the original archive.

## Policy evaluation and stable codes

`packages/web/scripts/ai/lib/test-heal.mjs` remains the policy source of truth. Every
policy issue has a stable framework-defined code. Existing codes remain unchanged:

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

The audit boundary accepts only codes from a local allowlist, removes duplicates,
and preserves deterministic order. If a future policy warning has no known code, it
records `POLICY_WARNING_UNCLASSIFIED` rather than exposing arbitrary text or an empty
diagnostic.

## Candidate flow

### 1. Non-bypassable candidate safety preflight

Before policy evaluation, the existing `sourceSafetyIssue()` check remains a hard
failure. A candidate containing a known secret value or secret-like material never
reaches policy bypass, materialization, verification, proposal, or apply.

### 2. Advisory policy evaluation

The healer compares the candidate to the immutable original source on every attempt.

- Passed policy: `checks.policy = "passed"` and no warning codes.
- Failed policy: `checks.policy = "warning"` and normalized
  `policyIssueCodes` are attached to the attempt.

The failed-policy branch no longer archives `rejected-policy`, records
`policy-rejected`, supplies rejection notes to the next attempt, or executes
`continue`. Instead it writes a bounded `attempt-N.policy-warning.json` containing
only attempt number, warning outcome, and allowlisted codes, then enters the normal
candidate pipeline.

### 3. Existing verification gates

The candidate must still pass, in order:

1. safe bound-file materialization;
2. TypeScript typecheck;
3. ESLint;
4. generated or recorded contract review when the target has such a contract;
5. exact consecutive live verification with one worker and zero retries;
6. candidate integrity checks;
7. non-empty diff generation.

If a later gate fails, its existing outcome remains the attempt outcome. The attempt
also retains `checks.policy = "warning"` and the warning codes so operators can see
both facts. No proposal is archived and no target is changed.

### 4. Proposal-only completion

When all remaining gates pass and `apply === false`:

- clean policy produces existing `proposal-ready`;
- policy warning produces `proposal-ready-with-policy-warnings`;
- candidate and diff are archived for manual review;
- target bytes remain unchanged;
- CLI prints the warning codes and exits `0`.

### 5. Apply completion

When all remaining gates pass and `apply === true`, existing dirty-target,
concurrency, candidate integrity, backup, permission, and atomic rename safeguards
remain mandatory.

- clean policy produces existing `healed` and exit `0`;
- policy warning still promotes the verified bytes, produces
  `healed-with-policy-warnings`, prints warning codes, and exits `1`.

`--allow-dirty` continues to mean only that an already-dirty target may be the
starting snapshot. It does not bypass concurrent-edit or integrity checks.

## Audit and public data

Warning codes appear consistently in:

1. the sanitized public attempt trail returned by `healSingleTest()`;
2. `heal-summary.json`;
3. `attempt-N.policy-warning.json`;
4. the final warning-bearing result as `policyIssueCodes`;
5. bounded CLI lines such as `Policy attempt 1: ASSERTION_COUNT_REDUCED`.

The attempt trail keeps its actual downstream outcome, for example:

```json
{
  "attempt": 1,
  "outcome": "proposal-ready-with-policy-warnings",
  "checks": {
    "policy": "warning",
    "typecheck": "passed",
    "lint": "passed",
    "review": "passed",
    "runtime": "passed"
  },
  "policyIssueCodes": [
    "EXECUTABLE_SEMANTICS_CHANGED"
  ]
}
```

Non-warning attempts do not gain `policyIssueCodes`. Raw issue messages remain
internal and are not serialized or printed.

## CLI behavior

The CLI adds explicit branches:

- `PROPOSAL READY WITH POLICY WARNINGS ...` for
  `proposal-ready-with-policy-warnings`;
- `HEALED WITH POLICY WARNINGS ...` for `healed-with-policy-warnings`.

Both branches print only attempt numbers and allowlisted warning codes. The first is
a successful proposal result. The second is deliberately excluded from the set of
clean successful statuses so aggregate CLI exit calculation returns `1` even though
the target was promoted.

## Security trade-off

The user explicitly accepts that policy is no longer an enforcement boundary. In
particular, a handwritten target has no generated/recorded static contract reviewer.
A candidate that removes or weakens an assertion could therefore pass typecheck,
lint, and runtime, then be applied with `--apply`. The warning status, non-zero exit,
backup, diff, and issue codes make that event visible but do not prevent it.

Generated and recorded targets retain their independent reviewers, which may still
hard-reject changes such as skipped tests, lost traceability, invalid selectors, or
contract drift. Those are separate gates and are not softened by this design.

## Testing strategy

Implementation follows test-driven development.

1. Add focused policy tests proving every issue has a stable allowlisted code.
2. Prove proposal-only plus a policy violation and green remaining gates returns
   `proposal-ready-with-policy-warnings`, archives candidate/diff/codes, and leaves
   the target unchanged.
3. Prove `--apply` plus the same warning and green remaining gates atomically changes
   the target, retains a backup, returns `healed-with-policy-warnings`, and yields CLI
   exit `1`.
4. Prove a clean `--apply` remains `healed` with exit `0`.
5. Prove a policy warning followed by typecheck, lint, review, or runtime failure does
   not create a proposal or mutate the target.
6. Prove secret-bearing candidates remain hard failures before policy bypass.
7. Prove public result, summary, warning audit, and CLI contain only allowlisted codes
   and never raw policy messages or rejected source excerpts.
8. Run focused healer tests, the complete policy tests, ESLint, TypeScript checks,
   and the framework self-test suite.

## Files expected to change

- `packages/web/scripts/ai/lib/test-heal.mjs`
- `packages/web/scripts/ai/heal-test.mjs`
- `packages/web/scripts/ai/__tests__/test-heal-policy.test.mjs`
- `packages/web/scripts/ai/__tests__/test-heal.test.mjs`
- `docs/superpowers/plans/2026-08-05-healer-policy-rejection-diagnostics.md`

No live stage credentials or PsychicBook browser execution are required for this
framework-level behavior change.

## Acceptance criteria

- No candidate is stopped solely because `verifyHealedSourcePolicy()` returns
  `passed: false`.
- Every policy warning exposes at least one allowlisted stable code.
- Proposal-only warning candidates must pass all remaining gates, archive a proposal,
  preserve the target, and return `proposal-ready-with-policy-warnings` with exit `0`.
- Apply warning candidates must pass all remaining gates, preserve a backup, promote
  atomically, and return `healed-with-policy-warnings` with exit `1`.
- Clean proposal/apply statuses and exits remain unchanged.
- Later hard-gate failures never create a proposal or mutate the target.
- Secret-bearing candidates remain blocked before policy evaluation can be softened.
- Raw issues and candidate excerpts do not appear in warning diagnostics.
