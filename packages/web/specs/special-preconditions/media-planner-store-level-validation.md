# Flow: Media Planner store-level minimum and maximum store validation

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-006 |
| Spec Version | 1.2.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/media-planner-store-level-validation.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @special-preconditions |
| Review Status | pending-review |
| Review Sign-off | pending |
| Generation Source | manual-test-case |
| Generation Status | generated |
| Generation Mode | suite |

## User Story

As a media planner,
I want the number of stores I request for a channel to be checked against that channel's configured minimum and maximum store volume,
So that I cannot proceed with a store count that falls below the minimum or above the maximum, while any count is accepted when the channel has no store-volume bounds configured.

## Preconditions

- The user has a valid non-production authenticated Playwright storage state.
- `PLAYWRIGHT_TEST_BASE_URL` points to an explicitly configured non-production Pollen environment.
- Local storage key `feature-flags` enables `FEATURE_NECTAR_AI`, `FEATURE_NUP`, and `FEATURE_NECTAR_AI_MP`.
- The user can access Media Planner at `/planning`.
- The advertiser `N360_Unilever_MS`, brand `Unilever | Knorr | MS`, objective `Customer retention`, and product search `knorr` are available.
- Group A cases require exact read-only channels supplied by `E2E_MP_COST_PER_STORE_CHANNEL`, `E2E_MP_COST_PER_UNIT_CHANNEL`, `E2E_MP_BASE_RATE_CHANNEL`, and `E2E_MP_UNBOUNDED_CHANNEL`. Generic pricing-model labels are not safe channel-name defaults.
- The first three channels must have their named pricing model and store-volume MIN/MAX matching `E2E_MP_STORE_VOLUME_MIN` / `E2E_MP_STORE_VOLUME_MAX` or the documented dev expectations 50/300.
- Group A also requires a store-taking channel pre-configured with both store-volume bounds cleared (no min and no max), to prove the unbounded path.
- The configured store-volume bounds are treated as read-only and are sourced from env-override variables (see Test Data); when an env-override is unset the dev-environment default (MIN=50, MAX=300) is the source of truth.
- Group B (standard) cases run against the pure store-range predicate and message-builder with no channel pre-configuration and no admin access.
- A read-only preflight verifies each exact channel, pricing model, and bound before UI sends; missing/mismatched data fails before a conversation.
- Campaign dates use one per-case calendar anchor, today+14 through today+44 (31 inclusive days). Every UI row starts a fresh unsaved conversation and fails if the date rolls over before assertion.

## Out-of-scope

- Admin configuration changes are out of scope and must remain read-only.
- Channel-management administration (creating channels, editing pricing model, editing store volume) is out of scope; channel rules are treated as pre-configured.
- Blocking products that are not physically listed in enough stores (future backlog per NUP-17415 Katy Cook comment) is out of scope; only the user-entered store count is validated here.
- Final booking submission is out of scope; the test validates planning-flow validation only.
- Production credentials and production user data are out of scope.
- Negative, fractional, non-numeric, or unsafe-integer store input is owned by form/input validation; this flow's predicate receives a validated non-negative integer.

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
| RULE-004 | Store-volume enforcement is independent of the active store-driven pricing model | for Cost per store, Cost per unit, and Base rate with a supplied store number, RULE-001 applies identically | Block: channel not added when supplied stores are outside the configured range; Fixed-cost applicability remains pending product clarification |
| RULE-005 | A store-taking channel with neither bound configured accepts any validated non-negative integer count | configuredMin is null AND configuredMax is null => valid | Allow: channel is added and no store-range error is shown |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | pricingModel=Cost per store; min=50; max=300; boundary=below-minimum; stores=49; start=today+14; end=today+44; budget=£25000 | result=blocked; channel not added; message contains "between 50 and 300" and the channel name | Group A: needs a pre-configured Cost-per-store channel (MIN=50/MAX=300). min-1 lower-boundary reject |
| DC-002 | pricingModel=Cost per store; min=50; max=300; boundary=at-minimum; stores=50; start=today+14; end=today+44 | result=allowed; channel added; no store-range error | Group A: pre-configured Cost-per-store channel. Inclusive-lower-bound proof |
| DC-003 | pricingModel=Cost per store; min=50; max=300; boundary=above-minimum; equivalence=in-range midpoint; stores=175; start=today+14; end=today+44 | result=allowed; channel added; no applicable store-range error | Group A midpoint representative above the minimum; it does not claim to execute min+1 |
| DC-004 | pricingModel=Cost per store; min=50; max=300; boundary=at-maximum; stores=300; start=today+14; end=today+44 | result=allowed; channel added; no applicable store-range error | Inclusive upper-bound proof; it does not claim to execute max-1 |
| DC-005 | pricingModel=Cost per store; min=50; max=300; boundary=above-maximum; stores=301; start=today+14; end=today+44 | result=blocked; channel not added; message contains "between 50 and 300" and the channel name | Group A: pre-configured Cost-per-store channel. max+1 upper-boundary reject |
| DC-006 | pricingModel=Cost per unit; min=50; max=300; boundary=above-maximum; stores=301; start=today+14; end=today+44 | result=blocked; channel not added; message contains "between 50 and 300" and the channel name | Group A: pre-configured Cost-per-unit channel. Enforcement independent of pricing model |
| DC-007 | pricingModel=Cost per unit; min=50; max=300; boundary=at-minimum; stores=50; start=today+14; end=today+44 | result=allowed; channel added; no store-range error | Group A: pre-configured Cost-per-unit channel. Inclusive boundary for Cost-per-unit |
| DC-008 | pricingModel=Base rate; min=50; max=300; boundary=below-minimum; stores=49; storeNumberSupplied=true; start=today+14; end=today+44 | result=blocked; channel not added; message contains "between 50 and 300" and the channel name | Group A: pre-configured Base-rate channel. Range applies because a store number is supplied |
| DC-009 | pricingModel=Base rate; min=50; max=300; boundary=at-maximum; stores=300; storeNumberSupplied=true; start=today+14; end=today+44 | result=allowed; channel added; no store-range error | Group A: pre-configured Base-rate channel with explicit store count |
| DC-011 | min=unset; max=unset; stores=1; start=today+14; end=today+44 | result=allowed; channel added; no store-range error | Group A: needs channel with both bounds cleared. Unbounded accepts a very low count |
| DC-012 | min=unset; max=unset; stores=100000; start=today+14; end=today+44 | result=allowed; channel added; no store-range error | Group A: channel with both bounds cleared. Unbounded accepts a very high count |
| DC-013 | predicate isStoreCountValid; rows=(49,50,300)->false,(50,50,300)->true,(300,50,300)->true,(301,50,300)->false,(49,50,unset)->false,(100000,50,unset)->true,(1,unset,300)->true,(301,unset,300)->false,(1,unset,unset)->true,(0,50,300)->false | predicate returns the expected boolean for every row; min and max are inclusive; unset bound disables that side | Group B: pure predicate, no browser, no config. Anchors all E2E boundary expectations |
| DC-014 | message builder storeRangeRejection(name="In-store Radio", min=50, max=300) | returns exactly "Please enter a number of stores between 50 and 300 for In-store Radio." with trailing period and configured bounds (not the entered value) | Group B: pure message-builder, no browser. Single source of truth for the verbatim error wording |

## Data Cases as JSON

```json
[
  { "caseId": "DC-001", "inputs": { "pricingModel": "Cost per store", "min": 50, "max": 300, "boundary": "below-minimum", "stores": 49, "startOffsetDays": 14, "endOffsetDays": 44, "budget": "£25000", "storeNumberSupplied": true }, "expected": { "result": "blocked", "channelAdded": false, "defaultMessageContains": ["between 50 and 300", "for"], "comparison": "message uses effective configured bounds and exact channel name" }, "notes": "Group A default worked example. Bounds are derived from E2E_MP_STORE_VOLUME_MIN/E2E_MP_STORE_VOLUME_MAX when set and verified live before send." },
  { "caseId": "DC-002", "inputs": { "pricingModel": "Cost per store", "min": 50, "max": 300, "boundary": "at-minimum", "stores": 50, "startOffsetDays": 14, "endOffsetDays": 44, "storeNumberSupplied": true }, "expected": { "result": "allowed", "channelAdded": true, "storeRangeErrorShown": false }, "notes": "Group A: pre-configured Cost-per-store channel. Inclusive-lower-bound proof; at-minimum is accepted." },
  { "caseId": "DC-003", "inputs": { "pricingModel": "Cost per store", "min": 50, "max": 300, "boundary": "above-minimum", "equivalence": "in-range-midpoint", "stores": 175, "startOffsetDays": 14, "endOffsetDays": 44, "storeNumberSupplied": true }, "expected": { "result": "allowed", "channelAdded": true, "storeRangeErrorShown": false }, "notes": "Group A midpoint representative above the minimum; does not claim to execute min+1." },
  { "caseId": "DC-004", "inputs": { "pricingModel": "Cost per store", "min": 50, "max": 300, "boundary": "at-maximum", "stores": 300, "startOffsetDays": 14, "endOffsetDays": 44, "storeNumberSupplied": true }, "expected": { "result": "allowed", "channelAdded": true, "storeRangeErrorShown": false }, "notes": "Group A inclusive-upper-bound proof; does not claim to execute max-1." },
  { "caseId": "DC-005", "inputs": { "pricingModel": "Cost per store", "min": 50, "max": 300, "boundary": "above-maximum", "stores": 301, "startOffsetDays": 14, "endOffsetDays": 44, "storeNumberSupplied": true }, "expected": { "result": "blocked", "channelAdded": false, "defaultMessageContains": ["between 50 and 300", "for"], "comparison": "message uses effective configured bounds and exact channel name" }, "notes": "Group A default worked example; max+1 upper-boundary reject." },
  { "caseId": "DC-006", "inputs": { "pricingModel": "Cost per unit", "min": 50, "max": 300, "boundary": "above-maximum", "stores": 301, "startOffsetDays": 14, "endOffsetDays": 44, "storeNumberSupplied": true }, "expected": { "result": "blocked", "channelAdded": false, "defaultMessageContains": ["between 50 and 300", "for"], "comparison": "message uses effective configured bounds and exact channel name" }, "notes": "Group A default worked example; pricing-model-independent enforcement." },
  { "caseId": "DC-007", "inputs": { "pricingModel": "Cost per unit", "min": 50, "max": 300, "boundary": "at-minimum", "stores": 50, "startOffsetDays": 14, "endOffsetDays": 44, "storeNumberSupplied": true }, "expected": { "result": "allowed", "channelAdded": true, "storeRangeErrorShown": false }, "notes": "Group A: pre-configured Cost-per-unit channel. Inclusive boundary accepted for Cost-per-unit." },
  { "caseId": "DC-008", "inputs": { "pricingModel": "Base rate", "min": 50, "max": 300, "boundary": "below-minimum", "stores": 49, "storeNumberSupplied": true, "startOffsetDays": 14, "endOffsetDays": 44 }, "expected": { "result": "blocked", "channelAdded": false, "defaultMessageContains": ["between 50 and 300", "for"], "comparison": "message uses effective configured bounds and exact channel name" }, "notes": "Group A default worked example; Base rate enforces the range when a store number is supplied." },
  { "caseId": "DC-009", "inputs": { "pricingModel": "Base rate", "min": 50, "max": 300, "boundary": "at-maximum", "stores": 300, "storeNumberSupplied": true, "startOffsetDays": 14, "endOffsetDays": 44 }, "expected": { "result": "allowed", "channelAdded": true, "storeRangeErrorShown": false }, "notes": "Group A: pre-configured Base-rate channel with an explicit store count at the inclusive upper bound." },
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
| productSearch | knorr | Live-resolvable product search; select one result |
| costPerStoreChannel | E2E_MP_COST_PER_STORE_CHANNEL | Required exact Cost-per-store channel name |
| costPerUnitChannel | E2E_MP_COST_PER_UNIT_CHANNEL | Required exact Cost-per-unit channel name |
| baseRateChannel | E2E_MP_BASE_RATE_CHANNEL | Required exact Base-rate channel name |
| unboundedChannel | E2E_MP_UNBOUNDED_CHANNEL | Required exact store-taking channel with both bounds null |
| storeVolumeMin | 50 | Read-only configured minimum store volume for the bounded channels |
| storeVolumeMax | 300 | Read-only configured maximum store volume for the bounded channels |
| storeVolumeMinEnv | E2E_MP_STORE_VOLUME_MIN | Optional expected-value override; live preflight must confirm it |
| storeVolumeMaxEnv | E2E_MP_STORE_VOLUME_MAX | Optional expected-value override; live preflight must confirm it |
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
| 3 | AC-003 | Complete advertiser, brand, objective, and SKU setup | Assistant guided planning controls | N360_Unilever_MS; Unilever \| Knorr \| MS; Customer retention; knorr; select one; Confirm | The assistant reaches the channel request state | channel/budget/timeline prompt visible |
| 4 | AC-004 | Send a channel request with a store count, campaign dates, and budget | Assistant channel request input | pre-configured channel; stores per data case; start today+14 till end today+44; budget £25000 | The assistant evaluates the store count against the channel-configured min/max | channel name and store count are visible in the conversation |
| 5 | AC-005, AC-006 | Review bounded outcomes in independent fresh plans | Assistant response and summary | DC-001..DC-009 excluding unbounded cases | out-of-range counts are absent with the configured error; at-minimum, midpoint, and at-maximum are present without that channel's error | channel-specific response in assistant region and summary presence/absence |
| 6 | AC-007 | Send a store count to a channel that has no min/max configured | Assistant channel request input and summary panel | DC-011, DC-012; stores=1 and stores=100000 on the unbounded channel | Channel is added for any count and no store-range error is shown | summary contains the channel; no store-range error in the reply |
| 7 | AC-008 | Evaluate the store-range predicate and message-builder offline | Pure store-range predicate and message-builder | DC-013, DC-014 | predicate returns the expected boolean for every boundary row; builder returns the exact verbatim error string | predicate equals expected per row; builder string equals the verbatim template |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | DC-001: Cost-per-store receives min-1 | Channel is absent and the assistant-region error names the exact channel and configured bounds |
| NEG-002 | DC-005: Cost-per-store receives max+1 | Channel is absent and the assistant-region error names the exact channel and configured bounds |
| NEG-003 | DC-006/DC-008: Cost-per-unit and Base-rate receive one supplied out-of-range count each | Each channel is absent with its own configured error, proving enforcement is pricing-model independent for store-driven models |

## Acceptance Criteria

- AC-001: Media Planner planning page opens with the Nectar AI Assistant entry point visible.
- AC-002: User can start the objective and budget guided assistant flow.
- AC-003: User can complete advertiser, brand, objective, and SKU setup for the plan.
- AC-004: User can send a channel request with a store count, campaign dates, and budget.
- AC-005: The system blocks a below-minimum and an above-maximum store count with the "between [min] and [max] for [Channel Name]" error and does not add the channel.
- AC-006: The system accepts at-minimum, in-range midpoint, and at-maximum counts with no applicable store-range error across Cost per store, Cost per unit, and Base rate.
- AC-007: A channel with no minimum and no maximum store volume configured accepts any store count, including a very low and a very high value, with no store-range error.
- AC-008: The store-range predicate and verbatim error message-builder behave correctly at every boundary offline (inclusive min/max, unset bound disables that side, exact wording).

## Locator Hints

- Prefer role/name locators for buttons and links such as Try now, Add hero SKU, and Confirm.
- Prefer labels for any form fields exposed by the guided assistant.
- Prefer exact visible text for assistant option chips such as advertiser, brand, objective, and SKU values.
- Read the latest assistant reply and the summary-panel channel list by their accessible roles/text; assert the channel name is present (added) or absent (rejected).
- Scope rejection copy to the accessible assistant conversation region; matching hidden or stale page text is insufficient.
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
- Must assert the exact channel name, dynamically configured bounds, and channel presence/absence. `between 50 and 300` is only the documented default/message-builder case.
- Must source the configured min/max from `E2E_MP_STORE_VOLUME_MIN` / `E2E_MP_STORE_VOLUME_MAX` when set and fall back to the dev defaults (50, 300), and must NOT change Channel Management configuration.
- Must use an assistant-reply expect-timeout of `aiReplyTimeoutMs` (75000) rather than fixed sleeps.
- Default generated-test execution target is Chromium only.
- Cross-browser generated-test execution is opt-in.
- Must enumerate DC-001 through DC-009 and DC-011 through DC-014; DC-010 is pending clarification and must not be emitted.
- Required Group A channel-name env values must be non-empty and distinct; fail before page setup rather than using generic pricing-model labels as fallbacks.
- Must not use page.waitForTimeout.
- Must not use page.waitForLoadState('networkidle').
- Must not use XPath.
- Must not use test.only.
- Must not silently skip.
- Must not use real credentials.
- Must not commit auth state.

## Notes

- This test intentionally avoids admin pages and does not change channel store-volume, pricing-model, booking-deadline, or duration configuration; all channel rules are pre-configured and read-only.
- E2E errors are built from the exact channel and live-verified effective bounds. `between 50 and 300` is the documented default and remains the explicit DC-014 offline builder example.
- Boundary coverage executes min-1 (49), min (50), one midpoint (175), max (300), and max+1 (301). It does not falsely claim to execute min+1 or max-1.
- Group A cases DC-001..DC-009/DC-011/DC-012 require exact pre-configured channels; Group B DC-013/DC-014 run offline.
- The verbatim message token order is "between [min] and [max] for [Channel Name]."; verify the live app matches this order. The [min]/[max] rendering for only-min and only-max channels is a known open question and is intentionally folded out of the bounded-channel E2E assertions.
- Set `E2E_MP_STORE_VOLUME_MIN` / `E2E_MP_STORE_VOLUME_MAX` if another non-production environment uses different configured bounds; when set, those overrides are the source of truth for the expected store-range numbers.

## Pending Automation (no test emitted)

| Source Case | Blocker | Exit Criteria |
|---|---|---|
| DC-010 — Fixed-cost channel with supplied out-of-range stores | Product sources conflict on whether Fixed cost consumes or ignores store input; accepting either outcome would make the test non-diagnostic | Product owner resolves the contract; one exact non-production fixture is identified; expected summary/error behavior is singular |
| One-sided min-only/max-only UI wording | Rendering template for a missing bound is undocumented | Exact user-visible copy and fixture for each one-sided configuration are approved |

Human review must confirm exact channel identities/pricing models, live bounds, unbounded semantics, dynamic error wording, and the fixed-cost product decision before signoff.
