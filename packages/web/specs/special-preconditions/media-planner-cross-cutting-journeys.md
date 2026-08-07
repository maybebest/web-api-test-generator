# Flow: Media Planner cross-cutting validation journeys

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-010 |
| Spec Version | 1.1.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/media-planner-cross-cutting-journeys.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @special-preconditions |
| Review Status | pending-review |
| Review Sign-off | pending |
| Generation Source | manual-test-case |
| Generation Status | generated |
| Generation Mode | suite |

## User Story

As a media planner,
I want a full media plan to enforce every channel rule together — booking deadline, minimum campaign duration, and store-volume range — while the summary panel recomputes totals and dates after each add and delete,
So that I can build a valid multi-channel plan in which only rule-violating channels are rejected and the summary always reflects exactly the channels that remain.

## Preconditions

- The user has a valid non-production authenticated Playwright storage state.
- `PLAYWRIGHT_TEST_BASE_URL` points to an explicitly configured non-production Pollen environment.
- Local storage key `feature-flags` enables `FEATURE_NECTAR_AI`, `FEATURE_NUP`, and `FEATURE_NECTAR_AI_MP`.
- The user can access Media Planner at `/planning`.
- The advertiser `N360_Unilever_MS`, brand `Unilever | Knorr | MS`, objective `Customer retention`, and product search `knorr` are available.
- One channel exists per user group, pre-configured and READ-ONLY: onsite `Onsite Display`, offsite `Offsite Display`, at-home `Direct Mail`, in-store `In-store Radio`.
- Each group channel requires a pre-configured booking deadline of 2 days and a pre-configured minimum campaign duration of 20 days (group A).
- The at-home `Direct Mail` and in-store `In-store Radio` channels require a pre-configured store-volume band of min 50 / max 200 stores that the test store counts must satisfy (group A).
- Before any UI case, a read-only preflight loads the exact channels and verifies their live rule values against `E2E_MP_CHANNEL_BOOKING_DEADLINE_DAYS`, `E2E_MP_CHANNEL_MIN_DURATION_DAYS`, `E2E_MP_CHANNEL_MIN_STORES`, and `E2E_MP_CHANNEL_MAX_STORES`; when unset the documented dev expectations are 2, 20, 50, and 200. A mismatch fails before sending a plan rather than silently treating an env value as live configuration.
- Campaign start dates are chosen at least 14 days from the current date so the booking-deadline gate passes unless a case is deliberately probing it.
- A fresh planning conversation is reachable with the summary panel visible and empty at the start.
- Every UI case uses its own unsaved conversation, captures one calendar-date anchor, performs calendar arithmetic, and fails if the date rolls over before the final assertion.

## Out-of-scope

- Admin configuration changes are out of scope and must remain read-only.
- Channel Management administration of booking deadline, minimum duration, store-volume band, pricing model, and managed-service fee is out of scope; all such values are pre-configured and read-only.
- Final booking submission is out of scope; the test validates planning-flow rules, summary recompute, and read-only fixture consistency only.
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
| RULE-001 | Validate the configured booking deadline before adding a channel | startOffsetDays = elapsed calendar-date difference from today to campaignStartDate; valid when startOffsetDays >= configured bookingDeadlineDays (default 2) | Block adding the channel and show a booking-deadline error naming the channel and configured lead time; other valid channels in the same plan are unaffected |
| RULE-002 | Validate the configured minimum campaign duration before adding a channel | campaignDurationDays = calendarDate(end) - calendarDate(start) + 1; valid when campaignDurationDays >= configured minimumDurationDays (default 20) | Block adding the channel and show a minimum-duration error naming the channel and configured minimum days; other valid channels are unaffected |
| RULE-003 | Validate the configured store-volume range for store-based channels | valid when configured minStores <= stores <= configured maxStores (default band 50 to 200) | Block adding the channel and prompt the planner to correct the number of stores; other valid channels are unaffected |
| RULE-004 | Fail closed when the expected fixture contract differs from read-only live configuration | preflightLiveRule(channel) == expectedRuleFromEnvOrDocumentedDefault for deadline, duration, and store bounds | Stop before any live plan mutation and report the exact channel/field mismatch; this read-only suite does not claim to prove cache invalidation after an admin change |
| RULE-005 | Recompute summary totals and campaign date span after every add and delete | totalBudget = sum(budget of present channels); campaignStart = min(start of present channels); campaignEnd = max(end of present channels); empty when no channels remain | Summary must never display a removed channel's budget or dates; an empty plan shows empty total, start, and end |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | Happy path; one valid channel per group; each start=today+14, end=today+44; budgets 50k/40k/30k/25k; at-home stores=100, in-store stores=100 within the 50-200 band | result=allowed; all 4 added; summary total = arithmetic sum of the 4 budgets; start=today+14; end=today+44; no gate error | Group A; live preflight must confirm all four configurations; total compared to computed sum, not a literal oracle |
| DC-002 | Booking deadline boundary triad on Onsite Display; below=today+1, at=today+2, above=today+3; each duration is 31 inclusive days | below blocked with named 2-day error; at and above allowed | Group A; the duration gate remains satisfied while deadline behavior is isolated |
| DC-003 | Minimum-duration boundary triad on Offsite Display; start=today+14; below end=today+32 (19 inclusive days), at end=today+33 (20), above end=today+34 (21) | below blocked with named 20-day error; at and above allowed | Group A; start=today+14 satisfies the configured booking deadline while duration behavior is isolated |
| DC-004 | Store-volume boundary triad on In-store Radio; start=today+14, end=today+44; stores=49 / 50 / 201 | 49 and 201 blocked with the configured 50-200 correction; 50 allowed | Group A; below-minimum, inclusive-minimum, and above-maximum boundaries |
| DC-005 | Mixed plan: onsite start=today+1 (deadline violator), offsite today+14..today+32 (19-day duration violator), in-store stores=201, at-home stores=100 budget 30k | only at-home added; summary total 30k; three violators absent; each rejection identifies only its own gate | Group A; verifies per-channel independent rejection after preflight |
| DC-006 | Configuration preflight: read exact channels and compare deadline=2, inclusive duration=20, store band=50-200 (or env overrides) | all expected fields match before UI sends; any missing channel, invalid range, or mismatch fails with the exact field named | Read-only safety contract; does not claim post-admin-change cache invalidation |
| DC-007 | In separate fresh conversations: onsite today+1..today+30 fails deadline with a valid 30-day duration; offsite today+5..today+23 passes deadline but fails at 19 inclusive days | each latest reply cites only its failing gate; the other gate error is absent from that reply | Group A; separation prevents the first error from contaminating the second assertion |
| DC-008 | Summary integrity across interleaved adds and deletes: add A onsite (today+10..today+40, 50k), add B offsite (today+14..today+50, 40k), delete B, add C at-home (today+20..today+45, 30k), add D in-store (today+12..today+48, 25k), delete A | running totals 50k/90k/50k/80k/105k/55k; after final delete start=today+12, end=today+48, channels=[Direct Mail, In-store Radio]; no stale A or B values | Group A; needs channels with known dates/budgets across groups; recompute computed in-test |
| DC-009 | Empty-plan recompute: add one channel then delete it as the last remaining channel | after the final delete the summary total, campaign start, and campaign end are all empty; no deleted-channel values remain | Group A; needs at least one pre-configured channel; verifies RULE-005 empty state |
| DC-010 | Oracle-unit cross-channel total with no browser: Travel Money Cost-per-store £300 x 250 stores plus budget-led 50k and 40k; then remove Travel Money | grand total = roundToPence(calculateTravelMoneyScreensCost(...) + 50000 + 40000) = 165000; after removal total = 90000 | Group B; runs against `automation/src/cost-oracle.ts`, no login or channel configuration |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "channels": [
        {"group": "onsite", "name": "Onsite Display", "startOffsetDays": 14, "endOffsetDays": 44, "budget": 50000},
        {"group": "offsite", "name": "Offsite Display", "startOffsetDays": 14, "endOffsetDays": 44, "budget": 40000},
        {"group": "athome", "name": "Direct Mail", "startOffsetDays": 14, "endOffsetDays": 44, "budget": 30000, "stores": 100},
        {"group": "instore", "name": "In-store Radio", "startOffsetDays": 14, "endOffsetDays": 44, "budget": 25000, "stores": 100}
      ]
    },
    "expected": {
      "result": "allowed",
      "channelsAdded": ["Onsite Display", "Offsite Display", "Direct Mail", "In-store Radio"],
      "totalBudget": 145000,
      "campaignStartOffsetDays": 14,
      "campaignEndOffsetDays": 44,
      "message": "No validation error is shown for any of the four channels."
    },
    "notes": "Group A. Needs four pre-configured channels (deadline 2, duration 20, valid store band). Total compared to the arithmetic sum of present budgets, never a literal UI string."
  },
  {
    "caseId": "DC-002",
    "inputs": {
      "channelName": "Onsite Display",
      "gate": "bookingDeadline",
      "cases": [
        {"boundary": "below-minimum", "startOffsetDays": 1, "endOffsetDays": 31, "budget": 50000},
        {"boundary": "at-minimum", "startOffsetDays": 2, "endOffsetDays": 32, "budget": 50000},
        {"boundary": "above-minimum", "startOffsetDays": 3, "endOffsetDays": 33, "budget": 50000}
      ]
    },
    "expected": {
      "belowMinimum": {"result": "blocked", "message": "The selected start date does not meet the booking deadline for Onsite Display. Please select a start date at least 2 days from today."},
      "atMinimum": {"result": "allowed"},
      "aboveMinimum": {"result": "allowed"}
    },
    "notes": "Group A. Onsite has both rules; each 31-day inclusive duration clears minimum 20 while the start offsets isolate deadline behavior."
  },
  {
    "caseId": "DC-003",
    "inputs": {
      "channelName": "Offsite Display",
      "gate": "minimumDuration",
      "startOffsetDays": 14,
      "cases": [
        {"boundary": "below-minimum", "endOffsetDays": 32, "durationDays": 19, "budget": 40000},
        {"boundary": "at-minimum", "endOffsetDays": 33, "durationDays": 20, "budget": 40000},
        {"boundary": "above-minimum", "endOffsetDays": 34, "durationDays": 21, "budget": 40000}
      ]
    },
    "expected": {
      "belowMinimum": {"result": "blocked", "message": "The campaign duration for Offsite Display must be at least 20 days."},
      "atMinimum": {"result": "allowed"},
      "aboveMinimum": {"result": "allowed"}
    },
    "notes": "Group A. Offsite has both rules; start today+14 clears deadline 2. End offsets use inclusive duration: end = start + duration - 1."
  },
  {
    "caseId": "DC-004",
    "inputs": {
      "channelName": "In-store Radio",
      "gate": "storeVolume",
      "startOffsetDays": 14,
      "endOffsetDays": 44,
      "cases": [
        {"boundary": "below-minimum", "stores": 49, "budget": 25000},
        {"boundary": "at-minimum", "stores": 50, "budget": 25000},
        {"boundary": "above-minimum", "stores": 201, "budget": 25000}
      ]
    },
    "expected": {
      "belowMinimum": {"result": "blocked", "message": "Channel not added; the assistant prompts to correct the number of stores."},
      "atMinimum": {"result": "allowed"},
      "aboveMinimum": {"result": "blocked", "message": "Channel not added; the assistant prompts to correct the number of stores."}
    },
    "notes": "Group A. In-store Radio uses min 50 / max 200 from the verified fixture contract; 201 is the above-maximum row."
  },
  {
    "caseId": "DC-005",
    "inputs": {
      "channels": [
        {"group": "onsite", "name": "Onsite Display", "startOffsetDays": 1, "endOffsetDays": 31, "budget": 50000, "violates": "bookingDeadline"},
        {"group": "offsite", "name": "Offsite Display", "startOffsetDays": 14, "endOffsetDays": 32, "durationDays": 19, "budget": 40000, "violates": "minimumDuration"},
        {"group": "instore", "name": "In-store Radio", "startOffsetDays": 14, "endOffsetDays": 44, "stores": 201, "budget": 25000, "violates": "storeVolume"},
        {"group": "athome", "name": "Direct Mail", "startOffsetDays": 14, "endOffsetDays": 44, "stores": 100, "budget": 30000, "violates": "none"}
      ]
    },
    "expected": {
      "result": "partial",
      "channelsAdded": ["Direct Mail"],
      "channelsRejected": ["Onsite Display", "Offsite Display", "In-store Radio"],
      "totalBudget": 30000,
      "message": "Each violator cites only its own gate error; Direct Mail is added and is the only summary entry."
    },
    "notes": "Group A. Needs all four channels pre-configured. Each rejection must NOT match the other gates' messages; only the valid control reaches the summary."
  },
  {
    "caseId": "DC-006",
    "inputs": {
      "operation": "read-only-channel-configuration-preflight",
      "channels": ["Onsite Display", "Offsite Display", "Direct Mail", "In-store Radio"],
      "expectedSources": ["E2E_MP_CHANNEL_BOOKING_DEADLINE_DAYS", "E2E_MP_CHANNEL_MIN_DURATION_DAYS", "E2E_MP_CHANNEL_MIN_STORES", "E2E_MP_CHANNEL_MAX_STORES"],
      "documentedDefaults": {"bookingDeadlineDays": 2, "minimumDurationDays": 20, "minStores": 50, "maxStores": 200}
    },
    "expected": {
      "result": "match",
      "failClosedOnMismatch": true,
      "requiredInvariants": ["deadline is a non-negative integer", "duration is an integer >= 2", "0 <= minStores <= maxStores"]
    },
    "notes": "Group A read-only safety preflight. It proves fixture consistency only; cache invalidation after an admin change remains out of scope."
  },
  {
    "caseId": "DC-007",
    "inputs": {
      "separateFreshConversations": true,
      "channels": [
        {"name": "Onsite Display", "startOffsetDays": 1, "endOffsetDays": 30, "durationDays": 30, "budget": 50000, "expectGate": "bookingDeadline", "notGate": "minimumDuration"},
        {"name": "Offsite Display", "startOffsetDays": 5, "endOffsetDays": 23, "durationDays": 19, "budget": 40000, "expectGate": "minimumDuration", "notGate": "bookingDeadline"}
      ]
    },
    "expected": {
      "onsite": {"result": "blocked", "firesGate": "bookingDeadline", "absentGate": "minimumDuration"},
      "offsite": {"result": "blocked", "firesGate": "minimumDuration", "absentGate": "bookingDeadline"}
    },
    "notes": "Group A. Execute each row in a separate fresh conversation and scope absence checks to its latest reply."
  },
  {
    "caseId": "DC-008",
    "inputs": {
      "sequence": [
        {"op": "add", "name": "Onsite Display", "startOffsetDays": 10, "endOffsetDays": 40, "budget": 50000},
        {"op": "add", "name": "Offsite Display", "startOffsetDays": 14, "endOffsetDays": 50, "budget": 40000},
        {"op": "delete", "name": "Offsite Display"},
        {"op": "add", "name": "Direct Mail", "startOffsetDays": 20, "endOffsetDays": 45, "stores": 100, "budget": 30000},
        {"op": "add", "name": "In-store Radio", "startOffsetDays": 12, "endOffsetDays": 48, "stores": 100, "budget": 25000},
        {"op": "delete", "name": "Onsite Display"}
      ]
    },
    "expected": {
      "runningTotals": [50000, 90000, 50000, 80000, 105000, 55000],
      "finalTotalBudget": 55000,
      "finalStartOffsetDays": 12,
      "finalEndOffsetDays": 48,
      "finalChannels": ["Direct Mail", "In-store Radio"]
    },
    "notes": "Group A. Needs channels with known dates/budgets across groups. Each total is the running sum of present budgets; start=min, end=max of present set, computed in-test. No stale Onsite or Offsite values remain."
  },
  {
    "caseId": "DC-009",
    "inputs": {
      "sequence": [
        {"op": "add", "name": "Direct Mail", "startOffsetDays": 14, "endOffsetDays": 44, "stores": 100, "budget": 30000},
        {"op": "delete", "name": "Direct Mail"}
      ]
    },
    "expected": {
      "finalTotalBudget": "empty",
      "finalStart": "empty",
      "finalEnd": "empty",
      "finalChannels": []
    },
    "notes": "Group A. Needs at least one pre-configured channel. Verifies RULE-005 empty state: deleting the last channel clears total, start, and end with no residual values."
  },
  {
    "caseId": "DC-010",
    "inputs": {
      "browserless": true,
      "channels": [
        {"model": "TravelMoneyCostPerStore", "costPerStoreStandard": 300, "stores": 250, "mediaServiceType": "Self-serve"},
        {"model": "budgetLed", "name": "onsite", "budget": 50000},
        {"model": "budgetLed", "name": "offsite", "budget": 40000}
      ],
      "mutation": {"op": "remove", "model": "TravelMoneyCostPerStore"}
    },
    "expected": {
      "grandTotalExpression": "roundToPence(calculateTravelMoneyScreensCost(costPerStoreInput) + 50000 + 40000)",
      "grandTotal": 165000,
      "afterRemovalTotal": 90000,
      "tolerance": 0.005
    },
    "notes": "Group B. Standard run against automation/src/cost-oracle.ts with no login or pre-configured channel."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| advertiser | N360_Unilever_MS | Non-production advertiser |
| brand | Unilever \| Knorr \| MS | Non-production brand |
| objective | Customer retention | Media Planner objective |
| productSearch | knorr | Live-resolvable product search; select one result |
| onsiteChannel | Onsite Display | Onsite group channel, pre-configured deadline 2 / duration 20 (read-only) |
| offsiteChannel | Offsite Display | Offsite group channel, pre-configured deadline 2 / duration 20 (read-only) |
| atHomeChannel | Direct Mail | At-home channel, pre-configured store band 50-200 (read-only) |
| inStoreChannel | In-store Radio | In-store channel, pre-configured store band 50-200 (read-only) |
| onsiteChannelEnv | E2E_MP_ONSITE_CHANNEL | Optional exact channel-name override |
| offsiteChannelEnv | E2E_MP_OFFSITE_CHANNEL | Optional exact channel-name override |
| atHomeChannelEnv | E2E_MP_ATHOME_CHANNEL | Optional exact channel-name override |
| inStoreChannelEnv | E2E_MP_INSTORE_CHANNEL | Optional exact channel-name override |
| bookingDeadlineDays | 2 | Read-only configured booking deadline applied across group channels |
| minimumDurationDays | 20 | Read-only configured minimum campaign duration applied across group channels |
| minStores | 50 | Read-only configured minimum store volume for store-based channels |
| maxStores | 200 | Read-only configured maximum store volume for store-based channels |
| bookingDeadlineEnv | E2E_MP_CHANNEL_BOOKING_DEADLINE_DAYS | Optional expected-value override; live preflight must confirm it |
| minimumDurationEnv | E2E_MP_CHANNEL_MIN_DURATION_DAYS | Optional expected-value override; live preflight must confirm it |
| minStoresEnv | E2E_MP_CHANNEL_MIN_STORES | Optional expected-value override; live preflight must confirm it |
| maxStoresEnv | E2E_MP_CHANNEL_MAX_STORES | Optional expected-value override; live preflight must confirm it |
| standardStartOffsetDays | 14 | Default start offset keeping the deadline gate satisfied for non-deadline cases |
| oracleModule | automation/src/cost-oracle.ts | Group B oracle source for browserless cross-channel total (DC-010) |

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
| 2 | AC-002 | Start the objective and budget guided assistant flow | Nectar AI Assistant | create plan in minutes / Help me build a plan based on my objective & budget | Assistant guided planning flow is active | objective and budget flow choice is visible or selected |
| 3 | AC-003 | Complete advertiser, brand, objective, and SKU setup | Assistant guided planning controls | N360_Unilever_MS; Unilever \| Knorr \| MS; Customer retention; knorr; select one product; Confirm | Assistant records the selections and requests a channel + budget + timeline | selected values and the channel request prompt are visible |
| 4 | AC-004 | Add one valid channel per group and read the summary | Assistant channel request input and summary panel | DC-001 four valid channels start=today+14 end=today+44 | All four channels added; summary total equals the computed sum; start=today+14; end=today+44 | summary lists all four channels and computed total matches |
| 5 | AC-005 | Send the booking-deadline and minimum-duration boundary triads | Assistant channel request input | DC-002, DC-003 below/at/above boundary sends | below-minimum sends are blocked with the gate error; at-minimum and above-minimum sends are allowed | error visible for below-minimum, absent for at/above-minimum |
| 6 | AC-006 | Send the store-volume boundary cases | Assistant channel request input | DC-004 stores 49 / 50 / 201 | 49 and 201 blocked with a correct-the-stores prompt; 50 and in-band allowed | correction prompt visible for out-of-band, channel added for in-band |
| 7 | AC-007 | Send a mixed plan and a cross-field independence pair | Assistant channel request input | DC-005, DC-007 | only valid channels added; each violator cites only its own gate; summary excludes violators | rejected channels absent and each error matches only its gate |
| 8 | AC-008 | Run the read-only fixture preflight before UI sends | channel-management data client | DC-006 exact channels and expected rule fields | live values match env overrides/documented defaults and satisfy invariants | fail closed with channel and field on missing/mismatched data |
| 9 | AC-009 | Run interleaved adds and deletes including emptying the plan | Assistant channel request input and summary panel | DC-008, DC-009 add/delete sequence | running totals match; final start=today+12 end=today+48 channels=[Direct Mail, In-store Radio]; empty plan clears total/start/end | summary recompute matches in-test computation, empty state clears fields |
| 10 | AC-010 | Compute the cross-channel total with the oracle, no browser | automation/src/cost-oracle.ts | DC-010 Travel Money + two budget-led values, then remove Travel Money | grand total=165000; after removal=90000 | oracle and arithmetic recompute match within tolerance |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | DC-002 below-minimum: Onsite Display start one day inside the configured booking deadline | Channel not added; booking-deadline error names Onsite Display and the configured at-least days |
| NEG-002 | DC-003 below-minimum: Offsite Display duration one day under the configured minimum | Channel not added; minimum-duration error names Offsite Display and at least 20 days |
| NEG-003 | DC-004 out-of-band: In-store Radio stores below the configured minimum or above the configured maximum | Channel not added; assistant prompts to correct the number of stores |
| NEG-004 | DC-005 mixed plan: the deadline, duration, and store violators sent alongside a valid channel | Each violator is rejected with only its own gate error while the valid channel is added |
| NEG-005 | DC-007 cross-field: a channel failing one gate while passing the other | Only the failing gate's error appears; the non-failing gate's error is absent |
| NEG-006 | DC-006 preflight finds a missing channel, invalid range, or live value different from the expected override/default | Fail before a planning conversation and name the exact channel and field; do not continue with stale assumptions |

## Acceptance Criteria

- AC-001: Media Planner planning page opens with the Nectar AI Assistant entry point visible.
- AC-002: User can start the objective and budget guided assistant flow.
- AC-003: User can complete advertiser, brand, objective, and SKU setup and reach the channel-request state.
- AC-004: A plan with one valid channel per group is fully accepted and the summary total, start, and end match the computed values.
- AC-005: Booking-deadline and minimum-duration boundary triads block below-minimum sends and allow at-minimum and above-minimum sends with the correct gate error.
- AC-006: Store-volume out-of-band sends are blocked with a correct-the-stores prompt while in-band sends are accepted.
- AC-007: In a mixed plan only the rule-violating channels are rejected, each citing only its own gate, while valid channels are added.
- AC-008: Read-only live configuration matches the expected fixture contract and valid numeric invariants before any UI send; mismatches fail closed with actionable context.
- AC-009: The summary panel recomputes total, start, and end correctly after each add and delete and clears all fields when the plan becomes empty.
- AC-010: The cross-channel summary total equals the oracle-computed sum and recomputes correctly after a channel is removed.

## Locator Hints

- Prefer role/name locators for buttons and links such as the planning entry point and Confirm.
- Prefer labels for any form fields exposed by the guided assistant.
- Prefer exact visible text for assistant option chips such as advertiser, brand, objective, SKU, Add hero SKU, and Confirm, and for channel names Onsite Display, Offsite Display, Direct Mail, In-store Radio.
- Scope per-group reads to the active `test-tab-{group}` tabpanel (onsite/offsite/athome/instore) since all tabpanels remain mounted; read the summary via its panel role/name.
- Scope gate-specific positive/negative text assertions to the latest assistant reply for that send; accumulated chat history is not evidence that only one gate fired.
- Use CSS only with an explicit locator-policy exception comment directly above the locator call.

## Generated Test Requirements

- Must import from fixtures/test.
- Must use test.step.
- Must use Page Objects or Component Objects for all locators.
- Must not create direct `page.getBy*` or `page.locator(...)` locators in generated test bodies.
- This spec declares `Generation Mode | suite`; split the broad flow into focused tests (happy path, boundary triads, mixed/independent rejection, configuration preflight, add/delete recompute, oracle-unit).
- Must put `expect(...)` only in the final assertion step for each test.
- Must title assertion steps `Assert AC-###: ...` or `Assert NEG-###: ...`.
- Must include meaningful expect assertions for user-visible behavior.
- In suite mode, must cover every AC ID from this spec with a final assertion step.
- Must compare summary totals and date spans against values computed in-test (arithmetic sum, min start, max end, or the cost-oracle re-implementation), never against a hardcoded UI string.
- Must build gate error assertions from environment-independent fragments and the configured day/store counts sourced from the env-override variables.
- Default generated-test execution target is Chromium only.
- Cross-browser generated-test execution is opt-in.
- Must enumerate every Data Cases as JSON case ID (DC-001 through DC-010).
- Must calculate inclusive durations as `end - start + 1`, use calendar-date arithmetic from one per-case anchor, and fail on date rollover.
- DC-006 must query read-only live configuration and compare every required field; env values alone are not proof of server configuration.
- DC-010 must import `calculateTravelMoneyScreensCost` and `roundToPence` from `automation/src/cost-oracle.ts` and must not request a browser/page fixture.
- Must assert the salient expected values Onsite Display, Offsite Display, Direct Mail, In-store Radio, must be at least, days, booking deadline.
- Must not use page.waitForTimeout.
- Must not use page.waitForLoadState('networkidle').
- Must not use XPath.
- Must not use test.only.
- Must not silently skip.
- Must not use real credentials.
- Must not commit auth state.

## Notes

- This test intentionally avoids admin pages and does not change booking-deadline, minimum-duration, store-volume, pricing-model, or managed-service configuration; all channel rules are treated as pre-configured and read-only.
- Read-only media configuration reports `bookingDeadlineDays=2`, `minCampaignDurationDays=20`, and store band `50-200` for the group channels in the current dev environment; these defaults apply when the env-override variables are unset.
- Gate error messages are asserted through environment-independent fragments (`Onsite Display`, `must be at least`, `days`, `booking deadline`); concrete day and store counts come from the env-override variables `E2E_MP_CHANNEL_BOOKING_DEADLINE_DAYS`, `E2E_MP_CHANNEL_MIN_DURATION_DAYS`, `E2E_MP_CHANNEL_MIN_STORES`, and `E2E_MP_CHANNEL_MAX_STORES`.
- DC-006 is a fail-closed fixture-consistency preflight. Proving application cache invalidation would require a separately authorized configuration change and restore and is not claimed here.
- Assistant turns are slow (roughly 30-60s); generated tests should poll for each new assistant message with a generous expect-timeout rather than fixed sleeps, and mark the longest add/delete sequences as slow.
- DC-010 is a Group B browserless oracle-unit case against `automation/src/cost-oracle.ts` with tolerance 0.005 and no login.
- Human review must confirm the four exact channel identities/configurations, inclusive date convention, per-gate error identity, partial-success semantics, and every summary empty-state field before signoff.
