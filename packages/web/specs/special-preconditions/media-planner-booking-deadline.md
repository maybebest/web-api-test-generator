# Flow: Media Planner booking deadline validation

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-005 |
| Spec Version | 1.1.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/media-planner-booking-deadline.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @special-preconditions |
| Review Status | pending-review |
| Review Sign-off | pending |
| Generation Source | manual-test-case |
| Generation Status | generated |
| Generation Mode | suite |

## User Story

As a media planner,
I want a channel campaign start date to be checked against the channel-configured booking-deadline lead time,
So that I cannot add a channel whose start date falls earlier than the earliest allowed start, while a channel with no configured booking deadline still accepts any start date.

## Preconditions

- The user has a valid non-production authenticated Playwright storage state.
- `PLAYWRIGHT_TEST_BASE_URL` points to an explicitly configured non-production Pollen environment.
- Local storage key `feature-flags` enables `FEATURE_NECTAR_AI`, `FEATURE_NUP`, and `FEATURE_NECTAR_AI_MP`.
- The user can access Media Planner at `/planning`.
- The advertiser `N360_Unilever_MS`, brand `Unilever | Knorr | MS`, objective `Customer retention`, and product search `knorr` are available.
- The channel `Onsite Display` is pre-configured (read-only) with a booking deadline of 2 days and is the source for the below/at/above-minimum boundary cases.
- A second channel `Offsite Display` is pre-configured (read-only) with no booking deadline (cleared field) and is the source for the no-deadline equivalence case.
- The configured booking-deadline values are read-only and treated as pre-existing; `E2E_MP_ONSITE_DISPLAY_BOOKING_DEADLINE_DAYS` is the source of truth for the `Onsite Display` value when set.
- The effective Onsite deadline is a finite integer >= 1; invalid configuration fails before a live conversation. The Offsite channel's live booking deadline is confirmed to be unset before DC-004/DC-005.
- Campaign end dates are chosen as start date plus 30 days so the separate minimum-campaign-duration validation never interferes with booking-deadline checks.
- Each boundary row starts a fresh, unsaved conversation. `today` is captured once per row using calendar-date arithmetic; the row fails if the date changes before its final assertion.

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
| RULE-001 | A channel campaign start date must be at least the channel-configured booking-deadline lead time after today | elapsedCalendarDays = campaignStartDate - today; earliestAllowedStart = today + bookingDeadlineDays; valid when elapsedCalendarDays >= bookingDeadlineDays (inclusive lower boundary) | Block adding the channel and show a user-visible rejection naming the channel and configured lead time when campaignStartDate is below the earliest allowed start |
| RULE-002 | A channel with no configured booking deadline imposes no booking lead time | bookingDeadlineDays is null => earliestAllowedStart is undefined | Do not show a booking-deadline rejection for an otherwise valid date, including today; other date/duration rules still apply |
| RULE-003 | Booking-deadline validation is enforced per channel within a single multi-channel send, not all-or-nothing | for each channel c in send: c is added when c.campaignStartDate >= today + c.bookingDeadlineDays, otherwise c is rejected independently of the other channels | Block only the violating channel(s) and add the compliant channels in the same turn |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | channelName=Onsite Display; boundary=below-minimum; startDate=today+(configuredDeadline-1); endDate=startDate+30; budget=7k | result=blocked; message contains Onsite Display, at least, configuredDeadline, and days from today; channel absent | Default worked example: configuredDeadline=2 gives today+1. The configured value is authoritative |
| DC-002 | channelName=Onsite Display; boundary=at-minimum; startDate=today+configuredDeadline; endDate=startDate+30; budget=7k | result=allowed; Onsite Display appears in the summary channel list; no applicable booking-deadline rejection | Inclusive lower-bound proof using the configured value; default is today+2 |
| DC-003 | channelName=Onsite Display; boundary=above-minimum; startDate=today+(configuredDeadline+1); endDate=startDate+30; budget=7k | result=allowed; Onsite Display appears in the summary channel list; no applicable booking-deadline rejection | Positive control using the configured value; default is today+3 |
| DC-004 | channelName=Offsite Display; boundary=no-deadline; startDate=today+0 days; bookingDeadlineDays=null; endDate=startDate+30; budget=7k | result=allowed; Offsite Display appears in the summary channel list; no booking-deadline rejection even for a today start | Group A: requires the pre-configured Offsite Display channel with a cleared booking deadline. Equivalence case for RULE-002 |
| DC-005 | one user turn contains Onsite Display @ today+(configuredDeadline-1) and Offsite Display @ today+(configuredDeadline+3); endDate=startDate+30 each; budget=7k each | result=mixed; Onsite Display blocked and absent with its named error; Offsite Display added and present | Group A: requires both live configurations to match their declared states; per-channel enforcement for RULE-003 |
| DC-006 | flow=plan setup only; advertiser=N360_Unilever_MS; brand=Unilever \| Knorr \| MS; objective=Customer retention; productSearch=knorr | result=allowed; assistant requests a channel, a budget and a timeline | Group B: standard guided-flow setup, no special channel config required |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "channelName": "Onsite Display",
      "boundary": "below-minimum",
      "startOffsetExpression": "configuredBookingDeadlineDays - 1",
      "defaultStartOffsetDays": 1,
      "bookingDeadlineSource": "E2E_MP_ONSITE_DISPLAY_BOOKING_DEADLINE_DAYS",
      "defaultBookingDeadlineDays": 2,
      "endOffsetExpression": "startOffsetDays + 30",
      "budget": "7k"
    },
    "expected": {
      "result": "blocked",
      "messagePattern": "Onsite Display ... at least {configuredBookingDeadlineDays} days from today",
      "channelAdded": false
    },
    "notes": "Group A precondition: requires an effective configured deadline >= 1. E2E_MP_ONSITE_DISPLAY_BOOKING_DEADLINE_DAYS is authoritative when set; 2 is only the dev worked-example default."
  },
  {
    "caseId": "DC-002",
    "inputs": {
      "channelName": "Onsite Display",
      "boundary": "at-minimum",
      "startOffsetExpression": "configuredBookingDeadlineDays",
      "defaultStartOffsetDays": 2,
      "bookingDeadlineSource": "E2E_MP_ONSITE_DISPLAY_BOOKING_DEADLINE_DAYS",
      "defaultBookingDeadlineDays": 2,
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
      "startOffsetExpression": "configuredBookingDeadlineDays + 1",
      "defaultStartOffsetDays": 3,
      "bookingDeadlineSource": "E2E_MP_ONSITE_DISPLAY_BOOKING_DEADLINE_DAYS",
      "defaultBookingDeadlineDays": 2,
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
        { "channelName": "Onsite Display", "startOffsetExpression": "configuredBookingDeadlineDays - 1", "role": "violating" },
        { "channelName": "Offsite Display", "startOffsetExpression": "configuredBookingDeadlineDays + 3", "bookingDeadlineDays": null, "role": "compliant" }
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
      "productSearch": "knorr"
    },
    "expected": {
      "result": "allowed",
      "message": "The assistant requests a channel, a budget and a timeline."
    },
    "notes": "Group B: standard guided-flow setup running on the documented advertiser, brand and product search with no special channel configuration required."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| advertiser | N360_Unilever_MS | Non-production advertiser |
| brand | Unilever \| Knorr \| MS | Non-production brand |
| objective | Customer retention | Media Planner objective |
| productSearch | knorr | Search term; select one live-resolvable product rather than relying on the unlinked source SKU 2001227 |
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
| 3 | AC-003 | Complete advertiser, brand, objective and SKU setup | Assistant guided planning controls | N360_Unilever_MS; Unilever \| Knorr \| MS; Customer retention; knorr; select one product; Confirm | The assistant records the selection and requests a channel, a budget and a timeline | assistant message requests channel, budget and timeline |
| 4 | AC-004 | In a fresh plan, send the deadline-gated channel one day below the configured boundary | Assistant channel request input | Onsite Display, startDate today+(configuredDeadline-1), endDate startDate+30, budget 7k | Onsite Display is rejected and absent | one contiguous error names the channel and configured lead time; summary row count 0 |
| 5 | AC-005 | In separate fresh plans, send the channel at and one day above the configured boundary | Assistant channel request input | Onsite Display, startDate today+configuredDeadline / today+(configuredDeadline+1) | Onsite Display is added with no applicable rejection | summary row visible; applicable configured error absent |
| 6 | AC-006 | Send the no-deadline channel with a today start | Assistant channel request input | Offsite Display, startDate today+0, endDate today+30, budget 7k | The Offsite Display channel is added regardless of the early start | Offsite Display is visible in the summary channel list |
| 7 | AC-007 | In one user turn, send one violating and one compliant channel | Assistant channel request input | DC-005 configured-relative offsets | Only Onsite Display is blocked while Offsite Display is added | Onsite named error; Onsite absent; Offsite present |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | DC-001 sends Onsite Display one day below the effective configured boundary | User is blocked; Onsite Display is absent; one error names the channel and effective configured lead time |
| NEG-002 | DC-005 sends Onsite Display one day below the configured boundary in the same turn as compliant Offsite Display | Onsite Display is rejected and absent while Offsite Display is added |

## Acceptance Criteria

- AC-001: Media Planner planning page opens with the Nectar AI Assistant entry point visible.
- AC-002: User can start the objective and budget guided assistant flow.
- AC-003: User can complete advertiser, brand, objective and SKU setup and the assistant requests a channel, a budget and a timeline.
- AC-004: The system blocks a start one day below the effective Onsite deadline, omits the channel from the summary, and shows one rejection naming the channel and configured lead time.
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
- Must parse the configured deadline as an integer >= 1, derive all Onsite boundary offsets from it, and fail before page setup on invalid configuration.
- Must capture one calendar-date anchor per case and fail if the date rolls over before the final assertion; do not add days as fixed 24-hour millisecond intervals.
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
- The expected rejection is asserted as one contiguous channel-specific message containing `Onsite Display`, `at least`, the effective configured day count, and `days from today`; 2 is only the default worked example.
- Set `E2E_MP_ONSITE_DISPLAY_BOOKING_DEADLINE_DAYS` if another non-production environment uses a different configured booking deadline; when set, that override is the source of truth for the expected day count and the derived earliest allowed start.
- Campaign end dates are always start date plus 30 days so booking-deadline assertions are never masked by the separate minimum-campaign-duration validation.
- Human review must verify the live Onsite/Offsite channel configuration, inclusive boundary convention, mixed-send partial-success behavior, and exact error token order before signoff.
