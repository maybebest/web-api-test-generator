# Flow: Media Planner store-level minimum and maximum store validation

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-006 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/media-planner-store-level-validation.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @special-preconditions |
| Review Status | pending-review |
| Generation Source | manual-test-case |
| Generation Status | pending-generation |
| Generation Mode | suite |

## User Story

As a media planner,
I want the number of stores I request for a channel to be checked against that channel's configured minimum and maximum store volume,
So that I cannot proceed with a store count that falls below the minimum or above the maximum, while any count is accepted when the channel has no store-volume bounds configured.

## Preconditions

- The user has a valid non-production authenticated Playwright storage state.
- `PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.rtd.js-devops.co.uk/`.
- Local storage key `feature-flags` enables `FEATURE_NECTAR_AI`, `FEATURE_NUP`, and `FEATURE_NECTAR_AI_MP`.
- The user can access Media Planner at `/planning`.
- The advertiser `N360_Unilever_MS`, brand `Unilever | Knorr | MS`, objective `Customer retention`, and SKU `2001227` are available.
- Group A (special precondition) cases require channels pre-configured and read-only with a known store-volume range and pricing model: a `Cost per store` in-store channel, a `Cost per unit` in-store channel, a `Base rate` in-store channel, and a `Fixed cost` in-store channel, each pre-configured with store volume MIN=50, MAX=300.
- Group A also requires a store-taking channel pre-configured with both store-volume bounds cleared (no min and no max), to prove the unbounded path.
- The configured store-volume bounds are treated as read-only and are sourced from env-override variables (see Test Data); when an env-override is unset the dev-environment default (MIN=50, MAX=300) is the source of truth.
- Group B (standard) cases run against the pure store-range predicate and message-builder with no channel pre-configuration and no admin access.
- Campaign start dates are chosen at least 14 days from the current date (endDate at +44 days, a 30-day duration) so the separate booking-deadline and minimum-duration validations do not interfere with store-range validation.

## Out-of-scope

- Admin configuration changes are out of scope and must remain read-only.
- Channel-management administration (creating channels, editing pricing model, editing store volume) is out of scope; channel rules are treated as pre-configured.
- Blocking products that are not physically listed in enough stores (future backlog per NUP-17415 Katy Cook comment) is out of scope; only the user-entered store count is validated here.
- Final booking submission is out of scope; the test validates planning-flow validation only.
- Production credentials and production user data are out of scope.

## Stability Requirements

| Field | Value |
|---|---|
| Parallel Safe | no |
| Data Isolation | external |
| Allowed Retries | 0 |

## Variants

| Locale | Role | Plan |
|---|---|---|
| en-GB | media planner | N360_Unilever_MS |

## Includes

- none

## Business Rules

| Rule ID | Rule | Formula | Blocking Behavior |
|---|---|---|---|
| RULE-001 | The requested store count must be within the channel-configured store-volume range, inclusive of both ends | valid when (configuredMin is unset OR stores >= configuredMin) AND (configuredMax is unset OR stores <= configuredMax) | Block: channel is not added and the assistant returns "Please enter a number of stores between [min] and [max] for [Channel Name]." asking the planner to correct the number of stores |
| RULE-002 | A store count below the configured minimum is rejected (minimum is inclusive) | blocked when configuredMin is set AND stores < configuredMin; at-minimum value stores == configuredMin is allowed | Block: channel not added; assistant shows the store-range error citing the configured min and max |
| RULE-003 | A store count above the configured maximum is rejected (maximum is inclusive) | blocked when configuredMax is set AND stores > configuredMax; at-maximum value stores == configuredMax is allowed | Block: channel not added; assistant shows the store-range error citing the configured min and max |
| RULE-004 | Store-volume enforcement is independent of the channel pricing model whenever a store number is supplied | for pricing models Cost per store, Cost per unit, and Base rate (and Fixed cost where it consumes a store input), the same min/max range in RULE-001 applies to the supplied store count | Block: channel not added when the supplied store count is out of range, regardless of pricing model |
| RULE-005 | A channel with no minimum and no maximum store volume configured accepts any store count | when configuredMin is unset AND configuredMax is unset, any stores >= 0 is valid | Allow: channel is added for any count; no store-range error is shown |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | pricingModel=Cost per store; min=50; max=300; boundary=below-minimum; stores=49; start=today+14; end=today+44; budget=£25000 | result=blocked; channel not added; message contains "between 50 and 300" and the channel name | Group A: needs a pre-configured Cost-per-store channel (MIN=50/MAX=300). min-1 lower-boundary reject |
| DC-002 | pricingModel=Cost per store; min=50; max=300; boundary=at-minimum; stores=50; start=today+14; end=today+44 | result=allowed; channel added; no store-range error | Group A: pre-configured Cost-per-store channel. Inclusive-lower-bound proof |
| DC-003 | pricingModel=Cost per store; min=50; max=300; boundary=above-minimum; stores=175; start=today+14; end=today+44 | result=allowed; channel added; no store-range error | Group A: pre-configured Cost-per-store channel. In-range equivalence representative (covers min+1 and mid-range) |
| DC-004 | pricingModel=Cost per store; min=50; max=300; boundary=at-maximum; stores=300; start=today+14; end=today+44 | result=allowed; channel added; no store-range error | Group A: pre-configured Cost-per-store channel. Inclusive-upper-bound proof (covers max-1 too) |
| DC-005 | pricingModel=Cost per store; min=50; max=300; boundary=above-maximum; stores=301; start=today+14; end=today+44 | result=blocked; channel not added; message contains "between 50 and 300" and the channel name | Group A: pre-configured Cost-per-store channel. max+1 upper-boundary reject |
| DC-006 | pricingModel=Cost per unit; min=50; max=300; boundary=above-maximum; stores=301; start=today+14; end=today+44 | result=blocked; channel not added; message contains "between 50 and 300" and the channel name | Group A: pre-configured Cost-per-unit channel. Enforcement independent of pricing model |
| DC-007 | pricingModel=Cost per unit; min=50; max=300; boundary=at-minimum; stores=50; start=today+14; end=today+44 | result=allowed; channel added; no store-range error | Group A: pre-configured Cost-per-unit channel. Inclusive boundary for Cost-per-unit |
| DC-008 | pricingModel=Base rate; min=50; max=300; boundary=below-minimum; stores=49; storeNumberSupplied=true; start=today+14; end=today+44 | result=blocked; channel not added; message contains "between 50 and 300" and the channel name | Group A: pre-configured Base-rate channel. Range applies because a store number is supplied |
| DC-009 | pricingModel=Base rate; min=50; max=300; boundary=at-maximum; stores=300; storeNumberSupplied=true; start=today+14; end=today+44 | result=allowed; channel added; no store-range error | Group A: pre-configured Base-rate channel with explicit store count |
| DC-010 | pricingModel=Fixed cost; min=50; max=300; boundary=above-maximum; stores=301; storeNumberSupplied=true; start=today+14; end=today+44 | result=blocked when Fixed cost consumes the store input; channel not added; message contains "between 50 and 300"; documented-alternate result=allowed if Fixed cost ignores the store input | Group A: pre-configured Fixed-cost channel. Open question recorded; assert one of the two documented outcomes |
| DC-011 | min=unset; max=unset; stores=1; start=today+14; end=today+44 | result=allowed; channel added; no store-range error | Group A: needs channel with both bounds cleared. Unbounded accepts a very low count |
| DC-012 | min=unset; max=unset; stores=100000; start=today+14; end=today+44 | result=allowed; channel added; no store-range error | Group A: channel with both bounds cleared. Unbounded accepts a very high count |
| DC-013 | predicate isStoreCountValid; rows=(49,50,300)->false,(50,50,300)->true,(300,50,300)->true,(301,50,300)->false,(49,50,unset)->false,(100000,50,unset)->true,(1,unset,300)->true,(301,unset,300)->false,(1,unset,unset)->true,(0,50,300)->false | predicate returns the expected boolean for every row; min and max are inclusive; unset bound disables that side | Group B: pure predicate, no browser, no config. Anchors all E2E boundary expectations |
| DC-014 | message builder storeRangeRejection(name="In-store Radio", min=50, max=300) | returns exactly "Please enter a number of stores between 50 and 300 for In-store Radio." with trailing period and configured bounds (not the entered value) | Group B: pure message-builder, no browser. Single source of truth for the verbatim error wording |

## Data Cases as JSON

```json
[
  { "caseId": "DC-001", "inputs": { "pricingModel": "Cost per store", "min": 50, "max": 300, "boundary": "below-minimum", "stores": 49, "startOffsetDays": 14, "endOffsetDays": 44, "budget": "£25000", "storeNumberSupplied": true }, "expected": { "result": "blocked", "channelAdded": false, "messageContains": ["between 50 and 300", "for"] }, "notes": "Group A: requires a pre-configured Cost-per-store in-store channel with store volume MIN=50/MAX=300. min-1 lower-boundary reject. Bounds sourced from E2E_MP_STORE_VOLUME_MIN/E2E_MP_STORE_VOLUME_MAX when set." },
  { "caseId": "DC-002", "inputs": { "pricingModel": "Cost per store", "min": 50, "max": 300, "boundary": "at-minimum", "stores": 50, "startOffsetDays": 14, "endOffsetDays": 44, "storeNumberSupplied": true }, "expected": { "result": "allowed", "channelAdded": true, "storeRangeErrorShown": false }, "notes": "Group A: pre-configured Cost-per-store channel. Inclusive-lower-bound proof; at-minimum is accepted." },
  { "caseId": "DC-003", "inputs": { "pricingModel": "Cost per store", "min": 50, "max": 300, "boundary": "above-minimum", "stores": 175, "startOffsetDays": 14, "endOffsetDays": 44, "storeNumberSupplied": true }, "expected": { "result": "allowed", "channelAdded": true, "storeRangeErrorShown": false }, "notes": "Group A: pre-configured Cost-per-store channel. In-range equivalence representative; covers min+1 and mid-range." },
  { "caseId": "DC-004", "inputs": { "pricingModel": "Cost per store", "min": 50, "max": 300, "boundary": "at-maximum", "stores": 300, "startOffsetDays": 14, "endOffsetDays": 44, "storeNumberSupplied": true }, "expected": { "result": "allowed", "channelAdded": true, "storeRangeErrorShown": false }, "notes": "Group A: pre-configured Cost-per-store channel. Inclusive-upper-bound proof; max-1 is covered by the same equivalence class." },
  { "caseId": "DC-005", "inputs": { "pricingModel": "Cost per store", "min": 50, "max": 300, "boundary": "above-maximum", "stores": 301, "startOffsetDays": 14, "endOffsetDays": 44, "storeNumberSupplied": true }, "expected": { "result": "blocked", "channelAdded": false, "messageContains": ["between 50 and 300", "for"] }, "notes": "Group A: pre-configured Cost-per-store channel. max+1 upper-boundary reject." },
  { "caseId": "DC-006", "inputs": { "pricingModel": "Cost per unit", "min": 50, "max": 300, "boundary": "above-maximum", "stores": 301, "startOffsetDays": 14, "endOffsetDays": 44, "storeNumberSupplied": true }, "expected": { "result": "blocked", "channelAdded": false, "messageContains": ["between 50 and 300", "for"] }, "notes": "Group A: pre-configured Cost-per-unit channel. Confirms store-volume enforcement is independent of the Cost-per-unit pricing model." },
  { "caseId": "DC-007", "inputs": { "pricingModel": "Cost per unit", "min": 50, "max": 300, "boundary": "at-minimum", "stores": 50, "startOffsetDays": 14, "endOffsetDays": 44, "storeNumberSupplied": true }, "expected": { "result": "allowed", "channelAdded": true, "storeRangeErrorShown": false }, "notes": "Group A: pre-configured Cost-per-unit channel. Inclusive boundary accepted for Cost-per-unit." },
  { "caseId": "DC-008", "inputs": { "pricingModel": "Base rate", "min": 50, "max": 300, "boundary": "below-minimum", "stores": 49, "storeNumberSupplied": true, "startOffsetDays": 14, "endOffsetDays": 44 }, "expected": { "result": "blocked", "channelAdded": false, "messageContains": ["between 50 and 300", "for"] }, "notes": "Group A: pre-configured Base-rate channel. Base rate enforces min/max only when a store number is supplied; this case supplies one so the range applies." },
  { "caseId": "DC-009", "inputs": { "pricingModel": "Base rate", "min": 50, "max": 300, "boundary": "at-maximum", "stores": 300, "storeNumberSupplied": true, "startOffsetDays": 14, "endOffsetDays": 44 }, "expected": { "result": "allowed", "channelAdded": true, "storeRangeErrorShown": false }, "notes": "Group A: pre-configured Base-rate channel with an explicit store count at the inclusive upper bound." },
  { "caseId": "DC-010", "inputs": { "pricingModel": "Fixed cost", "min": 50, "max": 300, "boundary": "above-maximum", "stores": 301, "storeNumberSupplied": true, "startOffsetDays": 14, "endOffsetDays": 44 }, "expected": { "result": "blocked", "channelAdded": false, "messageContains": ["between 50 and 300", "for"], "documentedAlternate": { "result": "allowed", "reason": "Fixed cost ignores the supplied store input and auto-populates budget" } }, "notes": "Group A: pre-configured Fixed-cost channel. Open question between NUP-19132 (Fixed cost has min/max set) and the pricing PDF (Fixed cost is budget-auto-populated). Assert one of the two documented outcomes and record which occurred; do not hard-fail the alternate." },
  { "caseId": "DC-011", "inputs": { "min": null, "max": null, "stores": 1, "startOffsetDays": 14, "endOffsetDays": 44 }, "expected": { "result": "allowed", "channelAdded": true, "storeRangeErrorShown": false }, "notes": "Group A: requires a store-taking channel with both store-volume bounds cleared. Proves no range is enforced when none is configured; 1 is deliberately below any prior bound." },
  { "caseId": "DC-012", "inputs": { "min": null, "max": null, "stores": 100000, "startOffsetDays": 14, "endOffsetDays": 44 }, "expected": { "result": "allowed", "channelAdded": true, "storeRangeErrorShown": false }, "notes": "Group A: channel with both bounds cleared. Unbounded upper extreme accepted." },
  { "caseId": "DC-013", "inputs": { "predicate": "isStoreCountValid", "rows": [ { "stores": 49, "min": 50, "max": 300, "valid": false }, { "stores": 50, "min": 50, "max": 300, "valid": true }, { "stores": 300, "min": 50, "max": 300, "valid": true }, { "stores": 301, "min": 50, "max": 300, "valid": false }, { "stores": 49, "min": 50, "max": null, "valid": false }, { "stores": 100000, "min": 50, "max": null, "valid": true }, { "stores": 1, "min": null, "max": 300, "valid": true }, { "stores": 301, "min": null, "max": 300, "valid": false }, { "stores": 1, "min": null, "max": null, "valid": true }, { "stores": 0, "min": 50, "max": 300, "valid": false } ] }, "expected": { "result": "allowed", "predicateMatchesEveryRow": true }, "notes": "Group B: pure predicate, no browser, no config. min and max are inclusive; an unset bound disables that side. Anchors all E2E boundary expectations." },
  { "caseId": "DC-014", "inputs": { "builder": "storeRangeRejection", "name": "In-store Radio", "min": 50, "max": 300 }, "expected": { "result": "allowed", "exactString": "Please enter a number of stores between 50 and 300 for In-store Radio." }, "notes": "Group B: pure message-builder, no browser. Numbers reflect configured bounds (not the entered value); channel name byte-exact; trailing period present. Single source of truth for the verbatim error wording." }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| advertiser | N360_Unilever_MS | Non-production advertiser |
| brand | Unilever \| Knorr \| MS | Non-production brand |
| objective | Customer retention | Media Planner objective |
| sku | 2001227 | SKU used by the guided flow |
| costPerStoreChannel | Cost-per-store in-store channel | Pre-configured channel, store volume MIN=50/MAX=300 (read-only) |
| costPerUnitChannel | Cost-per-unit in-store channel | Pre-configured channel, store volume MIN=50/MAX=300 (read-only) |
| baseRateChannel | Base-rate in-store channel | Pre-configured channel, store volume MIN=50/MAX=300 (read-only) |
| fixedCostChannel | Fixed-cost in-store channel | Pre-configured channel, store volume MIN=50/MAX=300 (read-only); store-input applicability is an open question |
| unboundedChannel | Store-taking channel with both bounds cleared | Pre-configured channel with no min and no max store volume (read-only) |
| storeVolumeMin | 50 | Read-only configured minimum store volume for the bounded channels |
| storeVolumeMax | 300 | Read-only configured maximum store volume for the bounded channels |
| storeVolumeMinEnv | E2E_MP_STORE_VOLUME_MIN | Optional local override; source of truth for the configured minimum when set |
| storeVolumeMaxEnv | E2E_MP_STORE_VOLUME_MAX | Optional local override; source of truth for the configured maximum when set |
| budget | £25000 | Channel request budget used for the guided flow |
| startOffsetDays | 14 | Campaign start at today+14 to clear the booking deadline |
| endOffsetDays | 44 | Campaign end at today+44 (30-day duration) to clear the minimum-duration rule |
| storeRangeRejectionTemplate | Please enter a number of stores between [min] and [max] for [Channel Name]. | Read-only verbatim error template (NUP-17415); [min]/[max] are the configured bounds |
| aiReplyTimeoutMs | 75000 | Expect-timeout when polling for the assistant reply |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | Live dev environment validates the configured channel rule | [] |

## Mocks as JSON

```json
[]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Open Media Planner planning page | /planning | feature-flags enabled | Nectar AI Assistant entry point is visible | Nectar AI Assistant text is visible |
| 2 | AC-002 | Start the objective and budget assistant flow | Nectar AI Assistant | Try now; Help me build a plan based on my objective & budget | Assistant guided planning flow is active | objective and budget flow choice is visible or selected |
| 3 | AC-003 | Complete advertiser, brand, objective, and SKU setup | Assistant guided planning controls | N360_Unilever_MS; Unilever \| Knorr \| MS; Customer retention; 2001227; Add hero SKU; Confirm | The assistant records the selected advertiser, brand, objective, and SKU | selected values are visible |
| 4 | AC-004 | Send a channel request with a store count, campaign dates, and budget | Assistant channel request input | pre-configured channel; stores per data case; start today+14 till end today+44; budget £25000 | The assistant evaluates the store count against the channel-configured min/max | channel name and store count are visible in the conversation |
| 5 | AC-005, AC-006 | Review store-range validation outcome for below-minimum, at-minimum, above-minimum, at-maximum, and above-maximum store counts | Assistant response and summary panel | DC-001, DC-002, DC-003, DC-004, DC-005, DC-006, DC-007, DC-008, DC-009, DC-010 | below-minimum and above-maximum counts are blocked with the "between 50 and 300" error and the channel is not added; at-minimum, above-minimum, and at-maximum counts are added with no store-range error | error message present or absent and summary contains/omits the channel per the data case |
| 6 | AC-007 | Send a store count to a channel that has no min/max configured | Assistant channel request input and summary panel | DC-011, DC-012; stores=1 and stores=100000 on the unbounded channel | Channel is added for any count and no store-range error is shown | summary contains the channel; no store-range error in the reply |
| 7 | AC-008 | Evaluate the store-range predicate and message-builder offline | Pure store-range predicate and message-builder | DC-013, DC-014 | predicate returns the expected boolean for every boundary row; builder returns the exact verbatim error string | predicate equals expected per row; builder string equals the verbatim template |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | DC-001: a Cost-per-store channel receives a below-minimum count (49 vs min 50) | Channel is not added; assistant shows "Please enter a number of stores between 50 and 300 for [Channel Name]." asking to correct the number of stores |
| NEG-002 | DC-005: a Cost-per-store channel receives an above-maximum count (301 vs max 300) | Channel is not added; assistant shows the "between 50 and 300" store-range error |
| NEG-003 | DC-006: a Cost-per-unit channel receives an above-maximum count (301), confirming enforcement is independent of pricing model | Channel is not added; store-range error shown |
| NEG-004 | DC-008: a Base-rate channel receives a below-minimum count (49) with a store number supplied | Channel is not added; store-range error shown because the store number is provided |
| NEG-005 | DC-010: a Fixed-cost channel receives an above-maximum count (301) and consumes the store input | Channel is not added; store-range error shown (documented-alternate: store input ignored and channel added, recorded as an open question) |

## Acceptance Criteria

- AC-001: Media Planner planning page opens with the Nectar AI Assistant entry point visible.
- AC-002: User can start the objective and budget guided assistant flow.
- AC-003: User can complete advertiser, brand, objective, and SKU setup for the plan.
- AC-004: User can send a channel request with a store count, campaign dates, and budget.
- AC-005: The system blocks a below-minimum and an above-maximum store count with the "between [min] and [max] for [Channel Name]" error and does not add the channel.
- AC-006: The system accepts at-minimum, above-minimum, and at-maximum store counts with no store-range error, across the store-driven pricing models (Cost per store, Cost per unit, Base rate, and Fixed cost where applicable).
- AC-007: A channel with no minimum and no maximum store volume configured accepts any store count, including a very low and a very high value, with no store-range error.
- AC-008: The store-range predicate and verbatim error message-builder behave correctly at every boundary offline (inclusive min/max, unset bound disables that side, exact wording).

## Locator Hints

- Prefer role/name locators for buttons and links such as Try now, Add hero SKU, and Confirm.
- Prefer labels for any form fields exposed by the guided assistant.
- Prefer exact visible text for assistant option chips such as advertiser, brand, objective, and SKU values.
- Read the latest assistant reply and the summary-panel channel list by their accessible roles/text; assert the channel name is present (added) or absent (rejected).
- Use CSS only with an explicit locator-policy exception comment directly above the locator call.

## Generated Test Requirements

- Must import from fixtures/test.
- Must use test.step.
- Must use Page Objects or Component Objects for all locators.
- Must not create direct `page.getBy*` or `page.locator(...)` locators in generated test bodies.
- This spec declares `Generation Mode | suite`; split the flow into focused tests (one per representative boundary/equivalence/negative class and one per pure-unit case).
- In suite mode, must cover every AC ID from this spec with a final assertion step.
- Must put `expect(...)` only in the final assertion step for each test.
- Must title assertion steps `Assert AC-###: ...` or `Assert NEG-###: ...`.
- Must include meaningful expect assertions for user-visible behavior.
- Must assert the salient expected values: the channel name, the verbatim phrase "between 50 and 300", and the channel being present or absent in the summary panel.
- Must source the configured min/max from `E2E_MP_STORE_VOLUME_MIN` / `E2E_MP_STORE_VOLUME_MAX` when set and fall back to the dev defaults (50, 300), and must NOT change Channel Management configuration.
- Must use an assistant-reply expect-timeout of `aiReplyTimeoutMs` (75000) rather than fixed sleeps.
- For DC-010 (Fixed cost) must assert one of the two documented outcomes and annotate `test.info()` with the open question rather than hard-failing the alternate path.
- Default generated-test execution target is Chromium only.
- Cross-browser generated-test execution is opt-in.
- Must enumerate every Data Cases as JSON case ID.
- Must not use page.waitForTimeout.
- Must not use page.waitForLoadState('networkidle').
- Must not use XPath.
- Must not use test.only.
- Must not silently skip.
- Must not use real credentials.
- Must not commit auth state.

## Notes

- This test intentionally avoids admin pages and does not change channel store-volume, pricing-model, booking-deadline, or duration configuration; all channel rules are pre-configured and read-only.
- The expected error is asserted through environment-independent fragments (the channel name, "between 50 and 300", "for"); the concrete bounds come from the configured defaults (MIN=50, MAX=300) or the env overrides.
- Boundary coverage uses below-minimum (49), at-minimum (50), above-minimum (175, representing min+1 and mid-range), at-maximum (300, representing max-1 and the inclusive upper bound), and above-maximum (301) so the 49/50/51 and 299/300/301 brackets are both proven.
- Group A cases (DC-001 through DC-012) require a pre-configured channel/store-volume/pricing-model; Group B cases (DC-013, DC-014) run offline against the pure predicate and message-builder.
- The verbatim message token order is "between [min] and [max] for [Channel Name]."; verify the live app matches this order. The [min]/[max] rendering for only-min and only-max channels is a known open question and is intentionally folded out of the bounded-channel E2E assertions.
- Set `E2E_MP_STORE_VOLUME_MIN` / `E2E_MP_STORE_VOLUME_MAX` if another non-production environment uses different configured bounds; when set, those overrides are the source of truth for the expected store-range numbers.
