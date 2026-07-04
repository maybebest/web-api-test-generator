# Flow: Media Planner cross-cutting validation journeys

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-010 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/media-planner-cross-cutting-journeys.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @special-preconditions |
| Review Status | pending-review |
| Generation Source | manual-test-case |
| Generation Status | generated |
| Generation Mode | suite |

## User Story

As a media planner,
I want a full media plan to enforce every channel rule together — booking deadline, minimum campaign duration, and store-volume range — while the summary panel recomputes totals and dates after each add and delete,
So that I can build a valid multi-channel plan in which only rule-violating channels are rejected and the summary always reflects exactly the channels that remain.

## Preconditions

- The user has a valid non-production authenticated Playwright storage state.
- `PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.rtd.js-devops.co.uk/`.
- Local storage key `feature-flags` enables `FEATURE_NECTAR_AI`, `FEATURE_NUP`, and `FEATURE_NECTAR_AI_MP`.
- The user can access Media Planner at `/planning`.
- The advertiser `N360_Unilever_MS`, brand `Unilever | Knorr | MS`, objective `Customer retention`, and SKU `2001227` are available.
- One channel exists per user group, pre-configured and READ-ONLY: onsite `Onsite Display`, offsite `Offsite Display`, at-home `Direct Mail`, in-store `In-store Radio`.
- Each group channel requires a pre-configured booking deadline of 2 days and a pre-configured minimum campaign duration of 20 days (group A).
- The at-home `Direct Mail` and in-store `In-store Radio` channels require a pre-configured store-volume band of min 50 / max 200 stores that the test store counts must satisfy (group A).
- The configured values are read-only and treated as the source of truth via env-override variables `E2E_MP_CHANNEL_BOOKING_DEADLINE_DAYS`, `E2E_MP_CHANNEL_MIN_DURATION_DAYS`, `E2E_MP_CHANNEL_MIN_STORES`, and `E2E_MP_CHANNEL_MAX_STORES`; when unset the dev defaults (2, 20, 50, 200) apply.
- Campaign start dates are chosen at least 14 days from the current date so the booking-deadline gate passes unless a case is deliberately probing it.
- A fresh planning conversation is reachable with the summary panel visible and empty at the start.

## Out-of-scope

- Admin configuration changes are out of scope and must remain read-only.
- Channel Management administration of booking deadline, minimum duration, store-volume band, pricing model, and managed-service fee is out of scope; all such values are pre-configured and read-only.
- Final booking submission is out of scope; the test validates planning-flow validation, summary recompute, and latest-configuration reads only.
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
| RULE-001 | Validate the configured booking deadline before adding a channel | startOffsetDays = inclusive calendar days from today to campaignStartDate; valid when startOffsetDays >= configured bookingDeadlineDays (default 2) | Block adding the channel and show a booking-deadline error naming the channel and the configured minimum days; other valid channels in the same plan are unaffected |
| RULE-002 | Validate the configured minimum campaign duration before adding a channel | campaignDurationDays = inclusive calendar days from campaignStartDate through campaignEndDate; valid when campaignDurationDays >= configured minimumDurationDays (default 20) | Block adding the channel and show a minimum-duration error naming the channel and the configured minimum days; other valid channels are unaffected |
| RULE-003 | Validate the configured store-volume range for store-based channels | valid when configured minStores <= stores <= configured maxStores (default band 50 to 200) | Block adding the channel and prompt the planner to correct the number of stores; other valid channels are unaffected |
| RULE-004 | Enforce the latest read-only configuration on each fresh conversation | effectiveRule = configuredValue read fresh at conversation start; a value configured before the conversation must be the one enforced, not a cached earlier value | Apply the freshly read configured value to RULE-001, RULE-002, and RULE-003; a send compliant under an older value but not the current one is blocked |
| RULE-005 | Recompute summary totals and campaign date span after every add and delete | totalBudget = sum(budget of present channels); campaignStart = min(start of present channels); campaignEnd = max(end of present channels); empty when no channels remain | Summary must never display a removed channel's budget or dates; an empty plan shows empty total, start, and end |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | Happy path; one valid channel per group; each start=today+14, end=today+44; budgets 50k/40k/30k/25k; at-home stores=100, in-store stores=250 within band | result=allowed; all 4 added; summary total = arithmetic sum of the 4 budgets; start=today+14; end=today+44; no error | Group A; needs all four pre-configured channels with deadline 2, duration 20, valid store band; total compared to computed sum not a literal |
| DC-002 | Booking deadline boundary triad on Onsite Display; boundary=below-minimum start=today+1; boundary=at-minimum start=today+2; boundary=above-minimum start=today+3; duration gate cleared | below-minimum blocked with booking-deadline error naming Onsite Display and at least 2 days; at-minimum and above-minimum allowed | Group A; needs Onsite Display pre-configured with booking deadline 2 and min-duration absent |
| DC-003 | Minimum-duration boundary triad on Offsite Display; start=today+14; boundary=below-minimum end=today+33 (19 days); boundary=at-minimum end=today+34 (20 days); boundary=above-minimum end=today+35 (21 days); deadline gate cleared | below-minimum blocked with duration error naming Offsite Display and at least 20 days; at-minimum and above-minimum allowed | Group A; needs Offsite Display pre-configured with min-duration 20 and booking deadline absent |
| DC-004 | Store-volume boundary triad on In-store Radio; start=today+14, end=today+44; boundary=below-minimum stores=49; boundary=at-minimum stores=50; boundary=above-minimum stores=201 above max | below-minimum (49) and above-max (201) blocked with a correct-the-stores prompt; at-minimum (50) and an in-band value allowed | Group A; needs In-store Radio pre-configured with store band min 50 / max 200 |
| DC-005 | Mixed plan: onsite start=today+1 (deadline violator), offsite end=today+32 from today+14 (18-day duration violator), in-store stores=201 (store violator), at-home valid stores=100 budget 30k | only the at-home valid channel added; summary total = at-home budget; the three violators absent; each violator shows only its own gate error | Group A; needs all four channels pre-configured; verifies per-channel independent rejection |
| DC-006 | Latest-configuration enforcement: configured booking deadline read fresh in a new conversation; start=today+(deadline-1) blocked, start=today+deadline allowed | send below the freshly read configured deadline is blocked citing the configured number of days; send at the configured deadline is allowed | Group A; configured booking deadline is read-only via E2E_MP_CHANNEL_BOOKING_DEADLINE_DAYS and read fresh per conversation |
| DC-007 | Cross-field independence: onsite start=today+1 deadline-fail but 30-day duration ok rejects on deadline only; offsite start=today+5 deadline-ok but 19-day duration rejects on duration only | each channel cites only its failing gate; the non-failing gate error is absent | Group A; needs onsite and offsite pre-configured with both deadline 2 and duration 20 |
| DC-008 | Summary integrity across interleaved adds and deletes: add A onsite (today+10..today+40, 50k), add B offsite (today+14..today+50, 40k), delete B, add C at-home (today+20..today+45, 30k), add D in-store (today+12..today+48, 25k), delete A | running totals 50k/90k/50k/80k/105k/55k; after final delete start=today+12, end=today+48, channels=[Direct Mail, In-store Radio]; no stale A or B values | Group A; needs channels with known dates/budgets across groups; recompute computed in-test |
| DC-009 | Empty-plan recompute: add one channel then delete it as the last remaining channel | after the final delete the summary total, campaign start, and campaign end are all empty; no deleted-channel values remain | Group A; needs at least one pre-configured channel; verifies RULE-005 empty state |
| DC-010 | Oracle-unit cross-channel total with no browser: PosCostPerStore stores=250 plus budget-led onsite 50k plus budget-led offsite 40k; then remove the Pos channel | grand total = roundToPence(posCost + 50000 + 40000); after removing the Pos channel total = 90000 | Group B; standard run on cost-oracle.ts exports, no login, no pre-configured channel |

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
        {"group": "instore", "name": "In-store Radio", "startOffsetDays": 14, "endOffsetDays": 44, "budget": 25000, "stores": 250}
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
    "notes": "Group A. Needs Onsite Display pre-configured with booking deadline 2 and min-duration absent. Configured days come from E2E_MP_CHANNEL_BOOKING_DEADLINE_DAYS (default 2)."
  },
  {
    "caseId": "DC-003",
    "inputs": {
      "channelName": "Offsite Display",
      "gate": "minimumDuration",
      "startOffsetDays": 14,
      "cases": [
        {"boundary": "below-minimum", "endOffsetDays": 33, "durationDays": 19, "budget": 40000},
        {"boundary": "at-minimum", "endOffsetDays": 34, "durationDays": 20, "budget": 40000},
        {"boundary": "above-minimum", "endOffsetDays": 35, "durationDays": 21, "budget": 40000}
      ]
    },
    "expected": {
      "belowMinimum": {"result": "blocked", "message": "The campaign duration for Offsite Display must be at least 20 days."},
      "atMinimum": {"result": "allowed"},
      "aboveMinimum": {"result": "allowed"}
    },
    "notes": "Group A. Needs Offsite Display pre-configured with min-duration 20 and booking deadline absent. Start kept at today+14 to keep the deadline gate satisfied. Configured days from E2E_MP_CHANNEL_MIN_DURATION_DAYS (default 20)."
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
    "notes": "Group A. Needs In-store Radio pre-configured with store band min 50 / max 200 from E2E_MP_CHANNEL_MIN_STORES and E2E_MP_CHANNEL_MAX_STORES. above-minimum here means above the configured maximum; exact correction wording captured live."
  },
  {
    "caseId": "DC-005",
    "inputs": {
      "channels": [
        {"group": "onsite", "name": "Onsite Display", "startOffsetDays": 1, "endOffsetDays": 31, "budget": 50000, "violates": "bookingDeadline"},
        {"group": "offsite", "name": "Offsite Display", "startOffsetDays": 14, "endOffsetDays": 32, "durationDays": 18, "budget": 40000, "violates": "minimumDuration"},
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
      "channelName": "Onsite Display",
      "gate": "bookingDeadline",
      "configuredDeadlineSource": "E2E_MP_CHANNEL_BOOKING_DEADLINE_DAYS",
      "freshConversation": true,
      "cases": [
        {"label": "below-configured", "startOffsetDays": "configuredDeadlineDays - 1", "endOffsetDays": "start + 30", "budget": 50000},
        {"label": "at-configured", "startOffsetDays": "configuredDeadlineDays", "endOffsetDays": "start + 30", "budget": 50000}
      ]
    },
    "expected": {
      "belowConfigured": {"result": "blocked", "message": "Booking-deadline error naming Onsite Display and the configured number of days."},
      "atConfigured": {"result": "allowed"}
    },
    "notes": "Group A. The configured booking deadline is read-only and read fresh at conversation start; the asserted day count comes from E2E_MP_CHANNEL_BOOKING_DEADLINE_DAYS (default 2). Proves RULE-004 latest-config enforcement without changing admin config."
  },
  {
    "caseId": "DC-007",
    "inputs": {
      "channels": [
        {"name": "Onsite Display", "startOffsetDays": 1, "endOffsetDays": 31, "durationDays": 30, "budget": 50000, "expectGate": "bookingDeadline", "notGate": "minimumDuration"},
        {"name": "Offsite Display", "startOffsetDays": 5, "endOffsetDays": 24, "durationDays": 19, "budget": 40000, "expectGate": "minimumDuration", "notGate": "bookingDeadline"}
      ]
    },
    "expected": {
      "onsite": {"result": "blocked", "firesGate": "bookingDeadline", "absentGate": "minimumDuration"},
      "offsite": {"result": "blocked", "firesGate": "minimumDuration", "absentGate": "bookingDeadline"}
    },
    "notes": "Group A. Needs onsite and offsite pre-configured with both deadline 2 and duration 20. Confirms the two gates are independent and only the failing one is reported."
  },
  {
    "caseId": "DC-008",
    "inputs": {
      "sequence": [
        {"op": "add", "name": "Onsite Display", "startOffsetDays": 10, "endOffsetDays": 40, "budget": 50000},
        {"op": "add", "name": "Offsite Display", "startOffsetDays": 14, "endOffsetDays": 50, "budget": 40000},
        {"op": "delete", "name": "Offsite Display"},
        {"op": "add", "name": "Direct Mail", "startOffsetDays": 20, "endOffsetDays": 45, "stores": 100, "budget": 30000},
        {"op": "add", "name": "In-store Radio", "startOffsetDays": 12, "endOffsetDays": 48, "stores": 250, "budget": 25000},
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
        {"model": "PosCostPerStore", "stores": 250},
        {"model": "budgetLed", "name": "onsite", "budget": 50000},
        {"model": "budgetLed", "name": "offsite", "budget": 40000}
      ],
      "mutation": {"op": "remove", "model": "PosCostPerStore"}
    },
    "expected": {
      "grandTotalExpression": "roundToPence(calculatePosCost(posInput) + 50000 + 40000)",
      "afterRemovalTotal": 90000,
      "tolerance": 0.005
    },
    "notes": "Group B. Standard run against cost-oracle.ts exports with no login and no pre-configured channel. Validates deletion-recompute arithmetic independently of the slow E2E path."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| advertiser | N360_Unilever_MS | Non-production advertiser |
| brand | Unilever \| Knorr \| MS | Non-production brand |
| objective | Customer retention | Media Planner objective |
| sku | 2001227 | SKU used by the guided flow |
| onsiteChannel | Onsite Display | Onsite group channel, pre-configured deadline 2 / duration 20 (read-only) |
| offsiteChannel | Offsite Display | Offsite group channel, pre-configured deadline 2 / duration 20 (read-only) |
| atHomeChannel | Direct Mail | At-home channel, pre-configured store band 50-200 (read-only) |
| inStoreChannel | In-store Radio | In-store channel, pre-configured store band 50-200 (read-only) |
| bookingDeadlineDays | 2 | Read-only configured booking deadline applied across group channels |
| minimumDurationDays | 20 | Read-only configured minimum campaign duration applied across group channels |
| minStores | 50 | Read-only configured minimum store volume for store-based channels |
| maxStores | 200 | Read-only configured maximum store volume for store-based channels |
| bookingDeadlineEnv | E2E_MP_CHANNEL_BOOKING_DEADLINE_DAYS | Optional local override; source of truth for configured booking deadline |
| minimumDurationEnv | E2E_MP_CHANNEL_MIN_DURATION_DAYS | Optional local override; source of truth for configured minimum duration |
| minStoresEnv | E2E_MP_CHANNEL_MIN_STORES | Optional local override; source of truth for configured minimum store volume |
| maxStoresEnv | E2E_MP_CHANNEL_MAX_STORES | Optional local override; source of truth for configured maximum store volume |
| standardStartOffsetDays | 14 | Default start offset keeping the deadline gate satisfied for non-deadline cases |
| oracleModule | src/cost-oracle.ts | Group B oracle source for browserless cross-channel total (DC-010) |

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
| 3 | AC-003 | Complete advertiser, brand, objective, and SKU setup | Assistant guided planning controls | N360_Unilever_MS; Unilever \| Knorr \| MS; Customer retention; 2001227; Add hero SKU; Confirm | Assistant records the selections and requests a channel + budget + timeline | selected values and the channel request prompt are visible |
| 4 | AC-004 | Add one valid channel per group and read the summary | Assistant channel request input and summary panel | DC-001 four valid channels start=today+14 end=today+44 | All four channels added; summary total equals the computed sum; start=today+14; end=today+44 | summary lists all four channels and computed total matches |
| 5 | AC-005 | Send the booking-deadline and minimum-duration boundary triads | Assistant channel request input | DC-002, DC-003 below/at/above boundary sends | below-minimum sends are blocked with the gate error; at-minimum and above-minimum sends are allowed | error visible for below-minimum, absent for at/above-minimum |
| 6 | AC-006 | Send the store-volume boundary cases | Assistant channel request input | DC-004 stores 49 / 50 / 201 | 49 and 201 blocked with a correct-the-stores prompt; 50 and in-band allowed | correction prompt visible for out-of-band, channel added for in-band |
| 7 | AC-007 | Send a mixed plan and a cross-field independence pair | Assistant channel request input | DC-005, DC-007 | only valid channels added; each violator cites only its own gate; summary excludes violators | rejected channels absent and each error matches only its gate |
| 8 | AC-008 | Enforce latest read-only configuration in a fresh conversation | Assistant in a new conversation | DC-006 below/at configured deadline | below the freshly read configured deadline is blocked citing the configured days; at the configured deadline is allowed | error cites the configured day count read fresh |
| 9 | AC-009 | Run interleaved adds and deletes including emptying the plan | Assistant channel request input and summary panel | DC-008, DC-009 add/delete sequence | running totals match; final start=today+12 end=today+48 channels=[Direct Mail, In-store Radio]; empty plan clears total/start/end | summary recompute matches in-test computation, empty state clears fields |
| 10 | AC-010 | Compute the cross-channel total with the oracle, no browser | src/cost-oracle.ts | DC-010 Pos + budget-led channels then remove Pos | grand total = roundToPence(posCost + 50000 + 40000); after removal total = 90000 | oracle total matches and recompute equals 90000 within tolerance |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | DC-002 below-minimum: Onsite Display start one day inside the configured booking deadline | Channel not added; booking-deadline error names Onsite Display and the configured at-least days |
| NEG-002 | DC-003 below-minimum: Offsite Display duration one day under the configured minimum | Channel not added; minimum-duration error names Offsite Display and at least 20 days |
| NEG-003 | DC-004 out-of-band: In-store Radio stores below the configured minimum or above the configured maximum | Channel not added; assistant prompts to correct the number of stores |
| NEG-004 | DC-005 mixed plan: the deadline, duration, and store violators sent alongside a valid channel | Each violator is rejected with only its own gate error while the valid channel is added |
| NEG-005 | DC-007 cross-field: a channel failing one gate while passing the other | Only the failing gate's error appears; the non-failing gate's error is absent |
| NEG-006 | DC-006 latest-config: a send compliant under an older deadline but below the freshly read configured deadline | Channel not added; error cites the current configured day count, proving the latest config is enforced |

## Acceptance Criteria

- AC-001: Media Planner planning page opens with the Nectar AI Assistant entry point visible.
- AC-002: User can start the objective and budget guided assistant flow.
- AC-003: User can complete advertiser, brand, objective, and SKU setup and reach the channel-request state.
- AC-004: A plan with one valid channel per group is fully accepted and the summary total, start, and end match the computed values.
- AC-005: Booking-deadline and minimum-duration boundary triads block below-minimum sends and allow at-minimum and above-minimum sends with the correct gate error.
- AC-006: Store-volume out-of-band sends are blocked with a correct-the-stores prompt while in-band sends are accepted.
- AC-007: In a mixed plan only the rule-violating channels are rejected, each citing only its own gate, while valid channels are added.
- AC-008: The freshly read read-only configuration is enforced on a new conversation, blocking a send below the current configured value and allowing one at it.
- AC-009: The summary panel recomputes total, start, and end correctly after each add and delete and clears all fields when the plan becomes empty.
- AC-010: The cross-channel summary total equals the oracle-computed sum and recomputes correctly after a channel is removed.

## Locator Hints

- Prefer role/name locators for buttons and links such as the planning entry point and Confirm.
- Prefer labels for any form fields exposed by the guided assistant.
- Prefer exact visible text for assistant option chips such as advertiser, brand, objective, SKU, Add hero SKU, and Confirm, and for channel names Onsite Display, Offsite Display, Direct Mail, In-store Radio.
- Scope per-group reads to the active `test-tab-{group}` tabpanel (onsite/offsite/athome/instore) since all tabpanels remain mounted; read the summary via its panel role/name.
- Use CSS only with an explicit locator-policy exception comment directly above the locator call.

## Generated Test Requirements

- Must import from fixtures/test.
- Must use test.step.
- Must use Page Objects or Component Objects for all locators.
- Must not create direct `page.getBy*` or `page.locator(...)` locators in generated test bodies.
- This spec declares `Generation Mode | suite`; split the broad flow into focused tests, one cohesive journey per test (happy path, boundary triads, mixed/independent rejection, latest-config, add/delete recompute, oracle-unit).
- Must put `expect(...)` only in the final assertion step for each test.
- Must title assertion steps `Assert AC-###: ...` or `Assert NEG-###: ...`.
- Must include meaningful expect assertions for user-visible behavior.
- In suite mode, must cover every AC ID from this spec with a final assertion step.
- Must compare summary totals and date spans against values computed in-test (arithmetic sum, min start, max end, or the cost-oracle re-implementation), never against a hardcoded UI string.
- Must build gate error assertions from environment-independent fragments and the configured day/store counts sourced from the env-override variables.
- Default generated-test execution target is Chromium only.
- Cross-browser generated-test execution is opt-in.
- Must enumerate every Data Cases as JSON case ID (DC-001 through DC-010).
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
- The latest-configuration case (DC-006) proves RULE-004 by reading the configured value fresh in a new conversation rather than mutating any admin config; the assertion uses the configured value as the source of truth.
- Assistant turns are slow (roughly 30-60s); generated tests should poll for each new assistant message with a generous expect-timeout rather than fixed sleeps, and mark the longest add/delete sequences as slow.
- DC-010 is a Group B browserless oracle-unit case; it runs against `src/cost-oracle.ts` exports with floating tolerance 0.005 and no login, validating the deletion-recompute arithmetic independently of the E2E path.
- Inclusive/exclusive day counting at the boundary edges (today+2 deadline, 20-day duration spans) should be confirmed against the live UI; if a boundary send behaves unexpectedly, capture the actual outcome and treat the counting convention as an open question.
