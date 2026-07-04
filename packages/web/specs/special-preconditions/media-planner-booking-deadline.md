# Flow: Media Planner booking deadline validation

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-005 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/media-planner-booking-deadline.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @special-preconditions |
| Review Status | pending-review |
| Generation Source | manual-test-case |
| Generation Status | generated |
| Generation Mode | suite |

## User Story

As a media planner,
I want a channel campaign start date to be checked against the channel-configured booking-deadline lead time,
So that I cannot add a channel whose start date falls earlier than the earliest allowed start, while a channel with no configured booking deadline still accepts any start date.

## Preconditions

- The user has a valid non-production authenticated Playwright storage state.
- `PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.rtd.js-devops.co.uk/`.
- Local storage key `feature-flags` enables `FEATURE_NECTAR_AI`, `FEATURE_NUP`, and `FEATURE_NECTAR_AI_MP`.
- The user can access Media Planner at `/planning`.
- The advertiser `N360_Unilever_MS`, brand `Unilever | Knorr | MS`, objective `Customer retention`, and SKU `2001227` are available.
- The channel `Onsite Display` is pre-configured (read-only) with a booking deadline of 2 days and is the source for the below/at/above-minimum boundary cases.
- A second channel `Offsite Display` is pre-configured (read-only) with no booking deadline (cleared field) and is the source for the no-deadline equivalence case.
- The configured booking-deadline values are read-only and treated as pre-existing; `E2E_MP_ONSITE_DISPLAY_BOOKING_DEADLINE_DAYS` is the source of truth for the `Onsite Display` value when set.
- Campaign end dates are chosen as start date plus 30 days so the separate minimum-campaign-duration validation never interferes with booking-deadline checks.

## Out-of-scope

- Admin configuration changes are out of scope and must remain read-only.
- Changing, raising, lowering, or clearing a channel booking deadline mid-flow is out of scope; configuration is treated as pre-existing.
- Minimum-campaign-duration, store-volume, pricing-model, and managed-service-fee validations are out of scope.
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
| RULE-001 | A channel campaign start date must be at least the channel-configured booking-deadline lead time after today | earliestAllowedStart = today + bookingDeadlineDays; valid when campaignStartDate >= earliestAllowedStart (inclusive lower boundary) | Block adding the channel and show a user-visible rejection naming the channel when campaignStartDate is below the earliest allowed start |
| RULE-002 | A channel with no configured booking deadline imposes no start-date lead time | bookingDeadlineDays is null => earliestAllowedStart is undefined => campaignStartDate is always valid for any value including today | Never block on booking deadline; the channel is always added regardless of how early the start date is |
| RULE-003 | Booking-deadline validation is enforced per channel within a single multi-channel send, not all-or-nothing | for each channel c in send: c is added when c.campaignStartDate >= today + c.bookingDeadlineDays, otherwise c is rejected independently of the other channels | Block only the violating channel(s) and add the compliant channels in the same turn |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | channelName=Onsite Display; boundary=below-minimum; startDate=today+1 day; bookingDeadlineDays=2; endDate=startDate+30; budget=7k | result=blocked; message contains Onsite Display and at least 2 days from today | Group A: requires the pre-configured Onsite Display channel with booking deadline 2. Below-minimum (earliest allowed is today+2) |
| DC-002 | channelName=Onsite Display; boundary=at-minimum; startDate=today+2 days; bookingDeadlineDays=2; endDate=startDate+30; budget=7k | result=allowed; Onsite Display appears in the summary channel list; no booking-deadline rejection | Group A: requires pre-configured Onsite Display. At-minimum confirms the inclusive lower boundary (today+2) |
| DC-003 | channelName=Onsite Display; boundary=above-minimum; startDate=today+3 days; bookingDeadlineDays=2; endDate=startDate+30; budget=7k | result=allowed; Onsite Display appears in the summary channel list; no booking-deadline rejection | Group A: requires pre-configured Onsite Display. Above-minimum positive control |
| DC-004 | channelName=Offsite Display; boundary=no-deadline; startDate=today+0 days; bookingDeadlineDays=null; endDate=startDate+30; budget=7k | result=allowed; Offsite Display appears in the summary channel list; no booking-deadline rejection even for a today start | Group A: requires the pre-configured Offsite Display channel with a cleared booking deadline. Equivalence case for RULE-002 |
| DC-005 | channels=[Onsite Display @ today+1 (violating), Offsite Display @ today+5 (compliant)]; bookingDeadlineDays=2 for Onsite Display, null for Offsite Display; endDate=startDate+30 each; budget=7k | result=mixed; Onsite Display blocked with its named error, Offsite Display added and present in the summary channel list | Group A: requires both pre-configured channels. Per-channel enforcement for RULE-003 |
| DC-006 | flow=plan setup only; advertiser=N360_Unilever_MS; brand=Unilever \| Knorr \| MS; objective=Customer retention; sku=2001227 | result=allowed; assistant requests a channel, a budget and a timeline | Group B: standard guided-flow setup on standard advertiser/brand/SKU, no special channel config required |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "channelName": "Onsite Display",
      "boundary": "below-minimum",
      "startOffsetDays": 1,
      "bookingDeadlineDays": 2,
      "endOffsetExpression": "startOffsetDays + 30",
      "budget": "7k"
    },
    "expected": {
      "result": "blocked",
      "message": "The selected start date does not meet the booking deadline for Onsite Display. Please select a start date at least 2 days from today."
    },
    "notes": "Group A precondition: requires the pre-configured Onsite Display channel with booking deadline 2. below-minimum because the earliest allowed start is today+2. E2E_MP_ONSITE_DISPLAY_BOOKING_DEADLINE_DAYS is the source of truth when set; the default in the dev environment is 2."
  },
  {
    "caseId": "DC-002",
    "inputs": {
      "channelName": "Onsite Display",
      "boundary": "at-minimum",
      "startOffsetDays": 2,
      "bookingDeadlineDays": 2,
      "endOffsetExpression": "startOffsetDays + 30",
      "budget": "7k"
    },
    "expected": {
      "result": "allowed",
      "message": "Onsite Display appears in the summary channel list and no booking-deadline rejection is shown."
    },
    "notes": "Group A precondition: requires the pre-configured Onsite Display channel. at-minimum confirms the inclusive lower boundary today+bookingDeadlineDays is accepted."
  },
  {
    "caseId": "DC-003",
    "inputs": {
      "channelName": "Onsite Display",
      "boundary": "above-minimum",
      "startOffsetDays": 3,
      "bookingDeadlineDays": 2,
      "endOffsetExpression": "startOffsetDays + 30",
      "budget": "7k"
    },
    "expected": {
      "result": "allowed",
      "message": "Onsite Display appears in the summary channel list and no booking-deadline rejection is shown."
    },
    "notes": "Group A precondition: requires the pre-configured Onsite Display channel. above-minimum positive control just inside the allowed region."
  },
  {
    "caseId": "DC-004",
    "inputs": {
      "channelName": "Offsite Display",
      "boundary": "no-deadline",
      "startOffsetDays": 0,
      "bookingDeadlineDays": null,
      "endOffsetExpression": "startOffsetDays + 30",
      "budget": "7k"
    },
    "expected": {
      "result": "allowed",
      "message": "Offsite Display appears in the summary channel list and no booking-deadline rejection is shown even for a today start."
    },
    "notes": "Group A precondition: requires the pre-configured Offsite Display channel with a cleared booking deadline. Equivalence case for RULE-002 (no deadline accepts the most aggressive start, today+0)."
  },
  {
    "caseId": "DC-005",
    "inputs": {
      "channels": [
        { "channelName": "Onsite Display", "startOffsetDays": 1, "bookingDeadlineDays": 2, "role": "violating" },
        { "channelName": "Offsite Display", "startOffsetDays": 5, "bookingDeadlineDays": null, "role": "compliant" }
      ],
      "endOffsetExpression": "startOffsetDays + 30",
      "budget": "7k"
    },
    "expected": {
      "result": "mixed",
      "message": "Onsite Display is blocked with its named booking-deadline error and Offsite Display is added and present in the summary channel list."
    },
    "notes": "Group A precondition: requires both pre-configured channels. Per-channel enforcement for RULE-003; only the violating channel is rejected while the compliant channel is added in the same turn."
  },
  {
    "caseId": "DC-006",
    "inputs": {
      "advertiser": "N360_Unilever_MS",
      "brand": "Unilever | Knorr | MS",
      "objective": "Customer retention",
      "sku": "2001227"
    },
    "expected": {
      "result": "allowed",
      "message": "The assistant requests a channel, a budget and a timeline."
    },
    "notes": "Group B: standard guided-flow setup running on the standard advertiser, brand and SKU with no special channel configuration required."
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
| deadlineChannel | Onsite Display | Group A channel pre-configured with a booking deadline |
| noDeadlineChannel | Offsite Display | Group A channel pre-configured with a cleared (no) booking deadline |
| budget | 7k | Channel request budget |
| onsiteBookingDeadlineDays | 2 | Read-only configured booking-deadline lead time for Onsite Display |
| offsiteBookingDeadlineDays | null | Read-only cleared booking deadline for Offsite Display (no lead time) |
| onsiteBookingDeadlineEnv | E2E_MP_ONSITE_DISPLAY_BOOKING_DEADLINE_DAYS | Optional local override; source of truth for the configured Onsite Display value when set |
| campaignDurationDays | 30 | End date offset from start date to avoid the minimum-duration validation |

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
| 2 | AC-002 | Start objective and budget assistant flow | Nectar AI Assistant | Try now; Help me build a plan based on my objective & budget | Assistant guided planning flow is active | objective and budget flow choice is visible or selected |
| 3 | AC-003 | Complete advertiser, brand, objective and SKU setup | Assistant guided planning controls | N360_Unilever_MS; Unilever \| Knorr \| MS; Customer retention; 2001227; Add hero SKU; Confirm | The assistant records the selection and requests a channel, a budget and a timeline | assistant message requests channel, budget and timeline |
| 4 | AC-004 | Send a deadline-gated channel below the earliest allowed start | Assistant channel request input | Onsite Display, startDate today+1, endDate today+31, budget 7k | The Onsite Display channel is rejected and not added | error names Onsite Display and contains at least 2 days from today |
| 5 | AC-005 | Send the deadline-gated channel at and above the earliest allowed start | Assistant channel request input | Onsite Display, startDate today+2 and today+3, endDate startDate+30, budget 7k | The Onsite Display channel is added with no booking-deadline rejection | Onsite Display is visible in the summary channel list |
| 6 | AC-006 | Send the no-deadline channel with a today start | Assistant channel request input | Offsite Display, startDate today+0, endDate today+30, budget 7k | The Offsite Display channel is added regardless of the early start | Offsite Display is visible in the summary channel list |
| 7 | AC-007 | Send a mixed batch with one violating and one compliant channel | Assistant channel request input | Onsite Display today+1; Offsite Display today+5; budget 7k | Only Onsite Display is blocked while Offsite Display is added | Onsite Display error visible; Offsite Display present in summary |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | DC-001 sends Onsite Display with a start date one day below the earliest allowed start | User is blocked and sees the booking-deadline error naming Onsite Display with at least 2 days from today |
| NEG-002 | DC-005 sends Onsite Display at today+1 in a batch alongside a compliant channel | Onsite Display is rejected and absent from the summary while the compliant channel is added |

## Acceptance Criteria

- AC-001: Media Planner planning page opens with the Nectar AI Assistant entry point visible.
- AC-002: User can start the objective and budget guided assistant flow.
- AC-003: User can complete advertiser, brand, objective and SKU setup and the assistant requests a channel, a budget and a timeline.
- AC-004: The system blocks a below-minimum start date for Onsite Display and shows a rejection naming the channel with at least 2 days from today.
- AC-005: The system allows the at-minimum and above-minimum start dates for Onsite Display with no booking-deadline rejection.
- AC-006: The system allows a today start for Offsite Display because it has no configured booking deadline.
- AC-007: The system enforces the booking deadline per channel, blocking only the violating channel in a mixed batch while adding the compliant channel.

## Locator Hints

- Prefer role/name locators for buttons and links such as Try now and Confirm.
- Prefer labels for any form fields exposed by the guided assistant.
- Prefer exact visible text for assistant option chips such as advertiser, brand, objective, SKU, Add hero SKU, and Confirm.
- Prefer exact visible text fragments (`Onsite Display`, `Offsite Display`, `at least`, `days from today`) when asserting on assistant rejection messages.
- Scope summary-panel channel-list assertions to the active summary panel container.
- Use CSS only with an explicit locator-policy exception comment directly above the locator call.

## Generated Test Requirements

- Must import from fixtures/test.
- Must use test.step.
- Must use Page Objects or Component Objects for all locators.
- Must not create direct `page.getBy*` or `page.locator(...)` locators in generated test bodies.
- This spec declares `Generation Mode | suite`; generate a focused test per acceptance criterion.
- In suite mode, must split broad flows into focused tests and cover every AC ID from this spec with a final assertion step.
- Must put `expect(...)` only in the final assertion step for each test.
- Must title assertion steps `Assert AC-###: ...` or `Assert NEG-###: ...`.
- Must include meaningful expect assertions for user-visible behavior.
- Must assert the salient expected values Onsite Display, at least, days from today.
- Default generated-test execution target is Chromium only.
- Cross-browser generated-test execution is opt-in.
- Must enumerate every Data Cases as JSON case ID: DC-001, DC-002, DC-003, DC-004, DC-005, DC-006.
- Must derive all campaign dates from relative offsets to the current date; must not hardcode calendar dates.
- Must not use page.waitForTimeout.
- Must not use page.waitForLoadState('networkidle').
- Must not use XPath.
- Must not use test.only.
- Must not silently skip.
- Must not use real credentials.
- Must not commit auth state.

## Notes

- This test intentionally avoids admin pages and does not change booking-deadline or channel configuration; the Onsite Display and Offsite Display channels are treated as pre-configured and read-only.
- Read-only media configuration reports `bookingDeadlineDays=2` for Onsite Display and a cleared booking deadline (null) for Offsite Display in the current dev environment.
- The earliest allowed start equals `today + bookingDeadlineDays`; the lower boundary is inclusive, so a start equal to the earliest allowed start passes and a start one day earlier is rejected (worked example: deadline 2, today maps to earliest allowed today+2).
- The expected rejection is asserted through environment-independent fragments (`Onsite Display`, `at least`, `days from today`) plus the configured day count; the concrete day count comes from the configured default (2).
- Set `E2E_MP_ONSITE_DISPLAY_BOOKING_DEADLINE_DAYS` if another non-production environment uses a different configured booking deadline; when set, that override is the source of truth for the expected day count and the derived earliest allowed start.
- Campaign end dates are always start date plus 30 days so booking-deadline assertions are never masked by the separate minimum-campaign-duration validation.
