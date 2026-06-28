# Flow: Media Planner minimum campaign duration validation

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-004 |
| Spec Version | 1.1.1 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/media-planner-minimum-campaign-duration.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @special-preconditions |
| Review Status | human-reviewed |
| Generation Source | manual-test-case |
| Generation Status | pending-generation |

## User Story

As a media planner,
I want channel campaign dates to be checked against the configured minimum campaign duration,
So that I cannot proceed with a media plan that violates channel booking rules.

## Preconditions

- The user has a valid non-production authenticated Playwright storage state.
- `PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.rtd.js-devops.co.uk/`.
- Local storage key `feature-flags` enables `FEATURE_NECTAR_AI`, `FEATURE_NUP`, and `FEATURE_NECTAR_AI_MP`.
- The user can access Media Planner at `/planning`.
- The advertiser `N360_Unilever_MS`, brand `Unilever | Knorr | MS`, objective `Customer retention`, and SKU `2001227` are available.
- The channel `DD Competition page` has a configured booking deadline and minimum campaign duration.
- Campaign start dates are chosen at least 5 days from the current date to avoid the separate booking-deadline validation.

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
| RULE-001 | Validate configured minimum campaign duration for DD Competition page | campaignDurationDays = inclusive calendar days from campaignStartDate through campaignEndDate; valid when campaignDurationDays >= configured minimumCampaignDurationDays for DD Competition page | Block progression and show a user-visible validation error when campaignDurationDays is below the configured minimum duration |

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
| sku | 2001227 | SKU used by the guided flow |
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
| 1 | AC-001 | Open Media Planner planning page | /planning | feature-flags enabled | Nectar AI Assistant entry point is visible | Nectar AI Assistant text is visible |
| 2 | AC-002 | Start objective and budget assistant flow | Nectar AI Assistant | Try now; Help me build a plan based on my objective & budget | Assistant guided planning flow is active | objective and budget flow choice is visible or selected |
| 3 | AC-003 | Complete advertiser, brand, objective, and SKU setup | Assistant guided planning controls | N360_Unilever_MS; Unilever \| Knorr \| MS; Customer retention; 2001227; Add hero SKU; Confirm | The assistant records the selected advertiser, brand, objective, and SKU | selected values are visible |
| 4 | AC-004 | Enter channel request with campaign dates and budget | Assistant channel request input | onsite, DD Competition page, startDate till endDate, the budget is 7k | The assistant calculates campaign duration for DD Competition page from the provided start and end dates | DD Competition page and campaign dates are visible |
| 5 | AC-005 | Review minimum campaign duration validation outcome | Assistant response | DC-001, DC-002, DC-003 | below-minimum duration is blocked with an error containing DD Competition page and must be at least configured days; at-minimum and above-minimum durations do not show the minimum duration error | error message is visible or absent according to the data case |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | DC-001 uses a duration below the configured minimum for DD Competition page | User is blocked and sees the minimum campaign duration error |

## Acceptance Criteria

- AC-001: Media Planner planning page opens with the Nectar AI Assistant entry point visible.
- AC-002: User can start the objective and budget guided assistant flow.
- AC-003: User can complete advertiser, brand, objective, and SKU setup for the plan.
- AC-004: User can enter an onsite DD Competition page channel request with campaign dates and budget.
- AC-005: The system blocks below-minimum duration and shows a DD Competition page minimum campaign duration error, while at-minimum and above-minimum durations do not show that error.

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
- Default generation mode is single-test mode.
- Generate a suite only when the spec declares `Generation Mode | suite` or a suite is explicitly requested.
- In single-test mode, must generate one requested-scenario test with one primary final assertion step.
- In suite mode, must split broad flows into focused tests.
- Must put `expect(...)` only in the final assertion step for each test.
- Must title assertion steps `Assert AC-###: ...` or `Assert NEG-###: ...`.
- Must include meaningful expect assertions for user-visible behavior.
- In suite mode, must cover every AC ID from this spec with a final assertion step.
- Default generated-test execution target is Chromium only.
- Cross-browser generated-test execution is opt-in.
- Must enumerate every Data Cases as JSON case ID.
- Must assert the salient expected values DD Competition page, must be at least, days.
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
- The expected error message is asserted through environment-independent fragments (`DD Competition page`, `must be at least`, `days`); the concrete day count comes from the configured default (21).
- Set `E2E_MP_DD_COMPETITION_PAGE_MIN_DURATION_DAYS` if another non-production environment uses a different configured minimum duration; when set, that override is the source of truth for the expected day count.
