# Healer Multiline Locator Triage Design

## Goal

Allow the existing single-file healer to recognize the real Playwright
`expect(locator).toBeVisible()` missing-element failure shape as repairable
locator drift, then continue evidence-driven healer iterations until both
copied PsychicBook dev tests are repaired and independently verified.

The change must not make genuine assertion, product, authentication, network,
test-data, or environment failures repairable.

## Observed Failure and Root Cause

Both copied PsychicBook tests complete the email-verification flow on
`https://user.dev.psychicbook.net/` and fail only at AC-004. Their Playwright
errors contain this structure:

```text
expect(locator).toBeVisible() failed
Locator: <semantic locator>
Expected: visible
Error: element(s) not found
```

The current triage returns `product-or-contract` with
`ASSERTION_OR_RESPONSE_MISMATCH`, so healer stops with `attemptsUsed: 0` and
never invokes its AI provider.

Two conditions cause the misclassification:

1. the broad product pattern matching `Expected:` runs before locator rules;
2. the existing `LOCATOR_NOT_FOUND` expression cannot span the line breaks
   between `Locator:` and `element(s) not found`.

This was reproduced for both real tests and independently with the triage
function. Removing `Expected:` makes the multiline evidence unclassified;
flattening it still lets the earlier product rule win.

## Approaches Considered

### Recommended: narrow multiline locator rule with safe precedence

Recognize the concrete Playwright locator-not-found shape across line breaks
and evaluate repairable locator rules only after environment and data guards,
but before broad product assertion patterns.

This is the smallest change that repairs the known classification defect while
preserving fail-closed behavior for higher-confidence external failures.

### Rejected: negative exceptions inside product patterns

Teaching every broad product regex to exclude locator messages would distribute
the same contextual rule across multiple expressions. It is harder to reason
about and likely to regress when Playwright changes wording.

### Rejected: a new structured Playwright error parser

A structured classifier could be useful later, but it would add a new parsing
layer for one verified message shape. That is unnecessary complexity for this
experiment.

## Triage Design

`runtime-environment` remains an immediate non-repairable environment verdict.
For runtime-test evidence, classification order becomes:

1. authentication, network, browser, and configuration failures;
2. missing or invalid test data;
3. narrowly recognized locator failures, including the multiline
   `Locator: ... Error: element(s) not found` form;
4. product, response, and assertion-value mismatches;
5. synchronization failures;
6. unclassified, non-repairable fallback.

The locator rule keeps the existing `LOCATOR_NOT_FOUND` reason code. It does
not classify a bare `Expected:` line, a text/value mismatch, an HTTP status or
response-body mismatch, or an authentication/network failure as repairable.

The triage schema and public healer statuses do not change.

## Testing

Focused tests must prove:

- a realistic multiline `toBeVisible()` missing-locator error is
  `locator-drift`, repairable, and reports `LOCATOR_NOT_FOUND`;
- the same evidence can pass the healer baseline gate and invoke the provider;
- `Expected string` / `Received string` remains product-or-contract and never
  invokes the provider;
- authentication, network, data, environment-stage, strict-mode, detached,
  and synchronization behavior remains unchanged;
- the complete healer focused surface remains green.

After the focused fix, both real copied PsychicBook targets are run again with
`--apply`, `--max-attempts 3`, and `--verify-runs 3`.

## Evidence-Driven Outer Loop

No locator is edited manually. Each outer iteration follows the same rule:

1. run healer on the still-red copied target;
2. inspect only sanitized summary/status/reason fields and bounded evidence;
3. if a deterministic framework defect blocks a valid repair, reproduce it in
   the smallest automated test;
4. implement one root-cause fix and run its focused and regression suites;
5. re-run healer on both copied targets.

The loop finishes only when both healer-applied targets pass three consecutive
candidate verification runs and then pass an independent three-repeat run.
It may stop earlier only for a genuine external/environment blocker or a
product/contract ambiguity that cannot be resolved without new user authority.

Every iteration preserves these gates:

- single-file candidate ownership;
- canonical spec/recording/allowlist binding;
- typecheck, ESLint, generated-test review, and healer policy reporting;
- integrity, dirty-target, concurrent-edit, and atomic-apply checks;
- no weakening or removal of assertions;
- no edits to canonical `packages/web/tests/**` or the shared PsychicBook Page
  Object;
- no secrets or credential-bearing browser artifacts committed to Git.

## Scope and YAGNI Boundary

The first implementation changes only triage classification and its automated
tests. DOM harvesting, a general Playwright error parser, multi-file healing,
automatic Page Object edits, unlimited retries, and policy bypasses are out of
scope.

If a later real healer iteration exposes another deterministic defect, its fix
must remain separately evidenced and minimal rather than being anticipated in
this first change.
