# Healer Scoped-Role Evidence Design

**Date:** 2026-08-07  
**Status:** Approved for planning  
**Scope:** Safe locator evidence for one-level semantic role scoping; no automatic DOM capture

## Problem

The PsychicBook dev account-menu test reached the healer after the multiline locator-triage fix. All three provider candidates cleared typecheck, lint, and static review, then failed runtime; the second candidate continued with the framework's existing warning-soft policy result:

1. a looser `Account settings` accessible-name matcher;
2. an invented `data-testid="account-settings"`;
3. a `Settings`/`Account settings` accessible-name matcher.

The provider guessed because its repository context contained neither an imported Page Object nor a supplied failure-state DOM artifact. Live Playwright inspection established the missing ground truth:

- the authenticated top-menu control is one `button` inside the `banner`;
- the control has no accessible name, `aria-label`, title, or stable test id;
- an unrelated `Accept` button exists outside the banner, so an unscoped role-only locator is not unique;
- `banner -> button` resolves to exactly one element.

The current discovery contract supports only flat `page.getBy*` candidates. It cannot represent the live-audited one-level locator `page.getByRole('banner').getByRole('button')`. Increasing attempts or changing prompt wording would only produce more guesses.

## Goals

- Represent one semantic container role followed by one descendant control role as structured locator evidence.
- Require live `locator.count() === 1` before that evidence may reach the healer.
- Allow a role-only descendant only when it exactly matches supplied live-audited evidence.
- Surface an unnamed descendant as warning-soft: `--apply` may promote a fully verified file, while the CLI/CI exit remains nonzero with a stable warning code.
- Use the existing explicit `--dom-snapshot` input and all existing typecheck, lint, review, runtime, integrity, dirty-target, concurrent-edit, and atomic-apply gates.
- Heal only the two copied `tests-dev` targets; canonical tests and the shared Page Object remain unchanged.

## Non-Goals

- No automatic DOM capture in fixtures, reporters, or every healer run.
- No general DOM-tree parser, arbitrary locator-chain language, CSS, XPath, positional selectors, or multi-file healing.
- No increase to attempt budgets or runtime retries.
- No automatic product accessibility fix and no claim that an unnamed button is ideal application markup.
- No change to assertions, business expectations, verification code, user data, or flow contracts.

## Chosen Approach

Extend the existing selector-evidence path with one structured candidate type, `scopedRole`. An operator-supplied ignored artifact captures the authenticated failure state and is passed through the existing `--dom-snapshot` flag.

The framework change remains bounded to evidence validation, locator reconstruction, candidate-use policy, and tests. The live PsychicBook capture helper remains ignored experiment infrastructure and is not committed.

Automatic failure-state capture was rejected because it would add page-lifecycle hooks, artifact retention, authentication handling, and secret-scrubbing logic to every healer run. Additional provider attempts were rejected because they cannot create missing DOM facts. Requiring an application accessibility change remains a recommended product follow-up, but it cannot complete this framework experiment.

## Evidence Model

A scoped candidate adds structured scope and target identities to the existing candidate record:

```json
{
  "type": "scopedRole",
  "locator": "page.getByRole(\"banner\").getByRole(\"button\")",
  "scope": {
    "role": "banner",
    "accessibleName": null
  },
  "target": {
    "role": "button",
    "accessibleName": null
  },
  "preferred": true,
  "snapshotMatchCount": 1,
  "snapshotUnique": true,
  "matchCount": 1,
  "unique": true,
  "matchEvidence": "playwright-live",
  "warningCodes": ["SCOPED_ROLE_TARGET_UNNAMED"]
}
```

Rules:

- The chain contains exactly two `getByRole` calls: one scope and one target.
- Scope roles are limited to `banner`, `navigation`, `main`, `complementary`, `region`, and `dialog`; target roles come from the existing safe-role allowlist.
- Names are static strings or `null`; regular expressions, executable expressions, extra options, and additional chain calls are rejected.
- `locator` is deterministically rendered from `scope` and `target`. A supplied string that differs byte-for-byte from the normalized rendering is rejected.
- The candidate is retained only when both snapshot and live counts equal one.
- An unnamed target receives `SCOPED_ROLE_TARGET_UNNAMED`; a named target receives no such warning.
- Existing flat candidate records remain unchanged and backward compatible.

## Failure-State Artifact

For this experiment, an ignored fixed-flow helper will:

1. read the existing private environment files without printing or copying values;
2. run only the approved PsychicBook dev login journey;
3. capture the post-verification accessibility state through agent-browser connected to the same Playwright-controlled browser session;
4. build candidates through framework selector-policy functions;
5. reconstruct and audit the scoped candidate on the same live Playwright page;
6. write a mode-0600 artifact below `.ai-runs/dom-discovery/`;
7. run the existing DOM artifact reviewer before the artifact can be passed to the healer.

The artifact preserves truthful provenance: agent-browser supplies the accessibility snapshot and framework Playwright supplies the live uniqueness count. It stores no credentials, cookies, headers, storage state, trace, video, screenshot, or free-form page data. The existing 64 KiB healer-context limit and secret-structure checks remain in force.

The helper is deliberately fixed to the dev host and the two approved targets. It is experiment-only and is never committed.

## Healer Data Flow

1. Baseline Playwright execution produces concrete locator-not-found evidence.
2. Triage returns `locator-drift` / `LOCATOR_NOT_FOUND`.
3. `collectHealContext()` validates and projects the supplied scoped-role artifact.
4. The provider receives the original test, failure evidence, and the one live-audited scoped candidate.
5. A dedicated healer evidence gate parses newly introduced role-only scoped chains from TypeScript AST. This narrow provenance gate is separate from the existing warning-soft semantic policy.
6. A chain absent from repository evidence is hard-rejected with reason `UNVERIFIED_SCOPED_ROLE_LOCATOR` before runtime; the attempt records `locator-evidence-rejected` and may continue within the existing attempt budget.
7. An exact audited unnamed chain receives policy warning code `SCOPED_ROLE_TARGET_UNNAMED` and continues.
8. Typecheck, lint, generated review, and three serial zero-retry Playwright runs must pass.
9. `--apply` atomically promotes only the verified dev target.
10. A successful apply with `SCOPED_ROLE_TARGET_UNNAMED` reports `healed` plus the warning and exits nonzero, matching the existing warning-soft apply contract.

No public terminal status is added. The existing `policyIssueCodes` mechanism carries `SCOPED_ROLE_TARGET_UNNAMED`; the private attempt audit carries the hard provenance reason without exposing raw locator text.

## Error Handling

- Malformed structured scope/target data, unsupported roles, dynamic names, locator-string mismatch, forbidden selector syntax, or sensitive artifact structure fails before provider invocation.
- A preferred scoped locator with any live count other than one fails artifact review.
- An unaudited role-only scoped locator is rejected by the dedicated evidence gate and is never run or applied; this does not change the existing warning-soft behavior of ordinary policy findings.
- Missing `--dom-snapshot` preserves current behavior; the framework does not search for stale artifacts.
- Environment, authentication, network, product, data, assertion-value, integrity, and concurrency failures preserve their existing fail-closed behavior.
- An exhausted healer leaves the original target unchanged and starts no second target until the cause is reviewed.

## Testing

Deterministic coverage will prove:

- structured scoped-role rendering and live reconstruction;
- exact-one live count acceptance and zero/many rejection;
- rejection of extra chain levels, unsupported roles, dynamic values, mismatched locator strings, forbidden syntax, and sensitive fields;
- backward compatibility for existing flat artifacts and prompts;
- provider context includes only the projected scoped candidate;
- unaudited role-only scoped candidates are rejected before runtime;
- an audited named target passes without the unnamed warning;
- an audited unnamed target reaches runtime with `SCOPED_ROLE_TARGET_UNNAMED`;
- successful `--apply` promotes the target but returns warning failure;
- canonical test and Page Object isolation remains exact.

Live acceptance requires, for both PsychicBook dev targets:

- healer `--apply --max-attempts 3 --verify-runs 3` safely promotes only the target;
- the summary records three verification runs and the expected warning code when the unnamed control is used;
- independent `--repeat-each=3`, one-worker, zero-retry execution passes 3/3;
- both generated-test reviewers pass;
- canonical tests and `pages/PsychicBookLoginPage.ts` remain byte-for-byte unchanged.

## Product Feedback

The dev account button lacks an accessible name and stable test id. The scoped-role evidence is a bounded testing fallback, not a substitute for application accessibility. The final report will recommend adding a meaningful accessible name or stable test id; once the product supplies one, the higher-priority flat locator should replace the warning-soft fallback.
