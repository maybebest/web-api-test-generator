# Flow: Media Planner channel deletion budget recompute

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-008 |
| Spec Version | 2.0.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/media-planner-channel-deletion-recompute.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @special-preconditions |
| Review Status | pending-review |
| Generation Source | manual-test-case |
| Generation Status | verified |
| Generation Mode | suite |

## User Story

As a media planner,
I want the plan summary Total Budget to recompute whenever I delete a channel,
So that the displayed total always reflects only the channels that remain.

## Preconditions

- The user has a valid non-production authenticated Playwright storage state.
- `PLAYWRIGHT_TEST_BASE_URL` points to the dev Pollen host `https://www.dev.pollen.js-devops.co.uk/`.
- Local storage key `feature-flags` enables `FEATURE_NECTAR_AI`, `FEATURE_NUP`, and `FEATURE_NECTAR_AI_MP` (set by the Page Object on navigation).
- The user can access Media Planner at `/planning`.
- The advertiser `N360_Unilever_MS`, brand `Unilever | Knorr | MS`, objective `Customer retention`, and product search term `knorr` resolve in the guided assistant.
- A fresh Nectar AI conversation is started for each test so the plan contains exactly the test's channels.
- Two onsite channels resolve by name in the dev environment: `Homepage Sponsored Product` and `SmartShop Handset Home Page (DEMO)`. Both accept a `Self-Serve` onsite request with a 30-day window starting `15/08/2026`. Override the channel names via `E2E_MP_RECOMPUTE_CHANNEL_A` / `E2E_MP_RECOMPUTE_CHANNEL_B` for other environments.

## Out-of-scope

- Admin configuration changes are out of scope and must remain read-only.
- The assistant's fuzzy channel matching is non-deterministic for vague descriptions; tests name channels exactly and select the named match, so disambiguation order is not asserted.
- Final booking submission is out of scope; the test validates planning-flow summary recompute only.
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
| RULE-001 | The summary Total Budget equals the sum of the budgets of the channels currently in the plan | totalBudget = sum(channel.budget for channel in plan) | A Total Budget that does not equal the sum of present channels is a failure |
| RULE-002 | Deleting a channel removes its row and recomputes Total Budget to the remaining channels' combined budget | totalBudgetAfter = totalBudgetBefore - deletedChannel.budget; deleted row no longer present | A stale or unchanged total, or a still-present deleted row, is a failure |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | add channelA `Homepage Sponsored Product` £15,000 and channelB `SmartShop Handset Home Page (DEMO)` £10,000, then delete channels by name | both rows visible with Total Budget `£25,000`; after deleting channelA `£10,000`; after deleting both `£--` | Single recompute scenario exercised by AC-003, AC-004 and NEG-001 |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "channelA": { "name": "Homepage Sponsored Product", "budget": "£15,000" },
      "channelB": { "name": "SmartShop Handset Home Page (DEMO)", "budget": "£10,000" }
    },
    "expected": {
      "combinedTotal": "£25,000",
      "afterDeletingChannelA": "£10,000",
      "afterDeletingAll": "£--"
    }
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| advertiser | N360_Unilever_MS | Non-production advertiser (assistant search value) |
| brand | Unilever \| Knorr \| MS | Non-production brand checkbox label |
| objective | Customer retention | Media Planner objective |
| productSearch | knorr | Measurement/hero SKU search term |
| channelA | Homepage Sponsored Product | First onsite channel; £15,000 |
| channelB | SmartShop Handset Home Page (DEMO) | Second onsite channel; £10,000 |
| budgetA | £15,000 | channelA budget as rendered in the summary |
| budgetB | £10,000 | channelB budget as rendered in the summary |
| combinedTotal | £25,000 | Total Budget with both channels present |
| aiReplyTimeoutMs | 60000 | Polling budget for each assistant turn |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | Live dev environment computes the summary total | [] |

## Mocks as JSON

```json
[]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Open Media Planner planning page | /planning | feature-flags enabled | Nectar AI Assistant entry point is visible | Nectar AI Assistant entry point visible |
| 2 | AC-002 | Start the objective and budget flow and complete advertiser, brand, objective, SKU setup | Nectar AI Assistant | Try now; Help me build a plan based on my objective & budget; N360_Unilever_MS; Unilever \| Knorr \| MS; Customer retention; knorr; Add hero SKU; Confirm | The assistant requests a channel, budget and timeline | assistant requests a channel |
| 3 | AC-003 | Add channelA and channelB and read the summary | Assistant channel request input | Homepage Sponsored Product £15,000; SmartShop Handset Home Page (DEMO) £10,000 | Both channel rows are visible and Total Budget shows £25,000 | both rows visible; total £25,000 |
| 4 | AC-004 | Delete channelA from the two-channel plan | Summary channel delete control | delete Homepage Sponsored Product | channelA row removed; channelB remains; Total Budget recomputes to £10,000 | recomputed total £10,000; channelA gone |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | From the two-channel plan, delete every channel so none remain | Summary Total Budget returns to the empty-state value `£--` and no channel rows remain |

## Acceptance Criteria

- AC-001: Media Planner planning page opens with the Nectar AI Assistant entry point visible.
- AC-002: User can start the objective and budget guided assistant flow and complete advertiser, brand, objective and SKU setup so the assistant requests a channel, budget and timeline.
- AC-003: Adding the two named channels shows both rows in the summary and the Total Budget equals their combined budget of £25,000.
- AC-004: Deleting channelA removes its row, leaves channelB, and recomputes the Total Budget to £10,000.

## Locator Hints

- Prefer role/name locators for buttons such as Try now and Confirm.
- Prefer exact visible text for assistant option chips such as advertiser, brand, objective, Add hero SKU, and Confirm.
- Prefer the summary panel's Total Budget value and channel rows for the recompute assertions.
- The per-channel delete control opens a confirm modal whose affirmative button is labelled Delete.
- Use CSS only with an explicit locator-policy exception comment directly above the locator call.

## Generated Test Requirements

- Must import from fixtures/test.
- Must use test.step.
- Must use Page Objects or Component Objects for all locators.
- Must not create direct `page.getBy*` or `page.locator(...)` locators in generated test bodies.
- This spec declares `Generation Mode | suite`; split the flow into focused tests, one per acceptance criterion.
- In suite mode, must split broad flows into focused tests and cover every AC ID with a final assertion step.
- Must put `expect(...)` only in the final assertion step for each test.
- Must title assertion steps `Assert AC-###: ...`.
- Must include meaningful expect assertions for user-visible behavior.
- Long guided-flow tests must be marked `test.slow` or set an explicit longer timeout.
- Default generated-test execution target is Chromium only.
- Cross-browser generated-test execution is opt-in.
- Must enumerate every Data Cases as JSON case ID: DC-001.
- Must assert the salient values `£25,000`, `£10,000` and the empty-state `£--` from the summary Total Budget.
- Must not use page.waitForTimeout.
- Must not use page.waitForLoadState('networkidle').
- Must not use XPath.
- Must not use test.only.
- Must not silently skip.
- Must not use real credentials.
- Must not commit auth state.

## Notes

- This test avoids admin pages and does not change Channel Management or channel configuration.
- The two channels are named exactly so the assistant resolves each to a specific channel; the summary then renders one row per channel with its own budget, and the Media Total Budget is their sum.
- Budgets are entered as whole pounds (£15000, £10000) and render as £15,000 / £10,000 / £25,000 in the summary.
- Campaign dates are kept well in the future (15/08/2026 + 30 days) so unrelated date validations do not interfere.
