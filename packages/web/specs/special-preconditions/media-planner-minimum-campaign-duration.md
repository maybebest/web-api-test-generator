# Flow: Media Planner minimum campaign duration validation

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-004 |
| Spec Version | 1.3.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/media-planner-minimum-campaign-duration.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @special-preconditions |
| Generation Mode | suite |
| Review Status | pending-review |
| Review Sign-off | pending |
| Generation Source | manual-test-case |
| Generation Status | generated |

## User Story

As a media planner,
I want channel campaign dates to be checked against the configured minimum campaign duration,
So that I cannot proceed with a media plan that violates channel booking rules.

## Preconditions

- The user has a valid non-production authenticated Playwright storage state.
- `PLAYWRIGHT_TEST_BASE_URL` points to an explicitly configured non-production Pollen environment.
- Local storage key `feature-flags` enables `FEATURE_NECTAR_AI`, `FEATURE_NUP`, and `FEATURE_NECTAR_AI_MP`.
- The user can access Media Planner at `/planning`.
- The advertiser `N360_Unilever_MS`, brand `Unilever | Knorr | MS`, objective `Customer retention`, and product search `knorr` are available.
- The channel `DD Competition page` has a configured booking deadline and minimum campaign duration.
- `E2E_MP_DD_COMPETITION_PAGE_MIN_DURATION_DAYS`, when set, is the expected live minimum; otherwise the documented dev default is 21. The effective value must be a finite integer >= 2 and match the read-only channel configuration before UI cases run.
- Campaign start dates are chosen 75 calendar days from the current date to avoid the separate booking-deadline validation. Each case captures one calendar-date anchor and fails if the date rolls over before its assertion.
- Every UI boundary row starts a separate fresh, unsaved planning conversation.

## Out-of-scope

- Admin configuration changes are out of scope and must remain read-only.
- Booking-deadline administration is out of scope.
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
| RULE-001 | Validate configured minimum campaign duration for DD Competition page | campaignDurationDays = calendarDate(end) - calendarDate(start) + 1; endDate = startDate + durationDays - 1; valid when campaignDurationDays >= configured minimumCampaignDurationDays | Block adding the channel, keep it absent from the summary, and show one user-visible error naming the channel, configured minimum, and days |
| RULE-002 | Configured minimum must permit a positive below-boundary case | minimumCampaignDurationDays is an integer >= 2 | Fail before live setup when the environment override is missing this invariant |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | channelName=DD Competition page; boundary=below-minimum; startDate=today+75 days; durationDays=configuredMinimumDurationDays-1; budget=7k | result=blocked; message contains DD Competition page and must be at least the configured minimum number of days | Primary negative validation case |
| DC-002 | channelName=DD Competition page; boundary=at-minimum; startDate=today+75 days; durationDays=configuredMinimumDurationDays; budget=7k | result=allowed; no minimum campaign duration error is shown for DD Competition page | Boundary control case |
| DC-003 | channelName=DD Competition page; boundary=above-minimum; startDate=today+75 days; durationDays=configuredMinimumDurationDays+1; budget=7k | result=allowed; no minimum campaign duration error is shown for DD Competition page | Positive control case |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "channelName": "DD Competition page",
      "boundary": "below-minimum",
      "startOffsetDays": 75,
      "durationExpression": "configuredMinimumDurationDays - 1",
      "endOffsetExpression": "startOffsetDays + durationDays - 1",
      "budget": "7k"
    },
    "expected": {
      "result": "blocked",
      "message": "The campaign duration for DD Competition page must be at least the configured minimum number of days."
    },
    "notes": "Campaign start date remains beyond the read-only configured 5-day booking deadline. The configured minimum defaults to 21 in the dev environment; E2E_MP_DD_COMPETITION_PAGE_MIN_DURATION_DAYS is the source of truth when it is set."
  },
  {
    "caseId": "DC-002",
    "inputs": {
      "channelName": "DD Competition page",
      "boundary": "at-minimum",
      "startOffsetDays": 75,
      "durationExpression": "configuredMinimumDurationDays",
      "endOffsetExpression": "startOffsetDays + durationDays - 1",
      "budget": "7k"
    },
    "expected": {
      "result": "allowed",
      "message": "No minimum campaign duration error is shown for DD Competition page."
    },
    "notes": "Boundary case confirms the configured minimum duration is accepted."
  },
  {
    "caseId": "DC-003",
    "inputs": {
      "channelName": "DD Competition page",
      "boundary": "above-minimum",
      "startOffsetDays": 75,
      "durationExpression": "configuredMinimumDurationDays + 1",
      "endOffsetExpression": "startOffsetDays + durationDays - 1",
      "budget": "7k"
    },
    "expected": {
      "result": "allowed",
      "message": "No minimum campaign duration error is shown for DD Competition page."
    },
    "notes": "Positive control confirms durations above the minimum remain valid."
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
| channel | DD Competition page | Channel with configured duration validation |
| budget | 7k | Channel request budget |
| bookingDeadlineDays | 5 | Read-only configured booking-deadline rule to avoid in this scenario |
| minimumDurationDays | 21 | Read-only configured minimum campaign duration for DD Competition page |
| minimumDurationEnv | E2E_MP_DD_COMPETITION_PAGE_MIN_DURATION_DAYS | Optional local override for the configured minimum duration |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | Live development environment validates the configured channel rule | [] |

## Mocks as JSON

```json
[]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Build a fresh guided plan and send DC-001 | Assistant channel request | inclusive duration = configured minimum minus one day; end=start+duration-1 | The channel is absent and one contiguous error names DD Competition page and the configured minimum days | assert contiguous error regex and zero channel rows |
| 2 | AC-002 | Build a fresh guided plan and send DC-002 | Assistant channel request | configured minimum days | The channel is present and no minimum-duration error is shown | assert channel visible and error absent |
| 3 | AC-002 | Build a separate fresh guided plan and send DC-003 | Assistant channel request | configured minimum plus one day | The channel is present and no minimum-duration error is shown | assert channel visible and error absent |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | Environment override is `1`, making minimum-minus-one a non-positive duration | Configuration fails deterministically before any live plan is created |

## Acceptance Criteria

- AC-001: A below-minimum duration is blocked with one contiguous error naming the channel, configured minimum, and days, and the channel is not added.
- AC-002: At-minimum and above-minimum durations are each accepted in their own fresh plan with no minimum-duration error.

## Locator Hints

- Prefer role/name locators for buttons and links.
- Prefer labels for any form fields exposed by the guided assistant.
- Prefer exact visible text for assistant option chips such as advertiser, brand, objective, SKU, Add hero SKU, and Confirm.
- Use CSS only with an explicit locator-policy exception comment directly above the locator call.

## Generated Test Requirements

- Must import from fixtures/test.
- Must use test.step.
- Must use Page Objects or Component Objects for all locators.
- Must not create direct `page.getBy*` or `page.locator(...)` locators in generated test bodies.
- This spec declares `Generation Mode | suite`; emit one fresh-plan test per UI boundary row plus one offline invalid-configuration test.
- Must put `expect(...)` only in the final assertion step for each test.
- Must title assertion steps `Assert AC-###: ...` or `Assert NEG-###: ...`.
- Must include meaningful expect assertions for user-visible behavior.
- In suite mode, must cover every AC ID from this spec with a final assertion step.
- Default generated-test execution target is Chromium only.
- Cross-browser generated-test execution is opt-in.
- Must enumerate every Data Cases as JSON case ID.
- Must assert the salient expected values DD Competition page, must be at least, days.
- Must compute end dates as `start + inclusiveDuration - 1` with calendar-date arithmetic, never fixed 24-hour millisecond addition.
- Must verify the effective configured minimum is an integer >= 2 and matches the read-only channel configuration before any UI boundary send.
- Must not use page.waitForTimeout.
- Must not use page.waitForLoadState('networkidle').
- Must not use XPath.
- Must not use test.only.
- Must not silently skip.
- Must not use real credentials.
- Must not commit auth state.

## Notes

- This test intentionally avoids admin pages and does not change booking-deadline or channel configuration.
- Read-only media configuration reports `bookingDeadlineDays=5` and `minCampaignDurationDays=21` for DD Competition page in the current dev environment.
- The expected error is asserted as one contiguous regex containing `DD Competition page`, `must be at least`, the configured number, and `days`.
- Set `E2E_MP_DD_COMPETITION_PAGE_MIN_DURATION_DAYS` if another non-production environment uses a different configured minimum duration; when set, that override is the source of truth for the expected day count.
- Human review must verify the live configured minimum, inclusive day-count convention, channel-specific error token order, and acceptance at exactly the configured duration before signoff.
