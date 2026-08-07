# Flow: Media Planner channel deletion budget recompute

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-008 |
| Spec Version | 2.1.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/media-planner-channel-deletion-recompute.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @special-preconditions |
| Review Status | pending-review |
| Review Sign-off | pending |
| Generation Source | manual-test-case |
| Generation Status | verified |
| Generation Mode | suite |

## User Story

As a media planner,
I want the plan summary Total Budget to recompute whenever I delete a channel,
So that the displayed total always reflects only the channels that remain.

## Preconditions

- The user has a valid non-production authenticated Playwright storage state.
- `PLAYWRIGHT_TEST_BASE_URL` points to an explicitly configured non-production Pollen environment.
- Local storage key `feature-flags` enables `FEATURE_NECTAR_AI`, `FEATURE_NUP`, and `FEATURE_NECTAR_AI_MP` (set by the Page Object on navigation).
- The user can access Media Planner at `/planning`.
- The advertiser `N360_Unilever_MS`, brand `Unilever | Knorr | MS`, objective `Customer retention`, and product search term `knorr` resolve in the guided assistant.
- A fresh Nectar AI conversation is started for each test so the plan contains exactly the test's channels.
- Two onsite channels resolve by exact name in the dev environment: `Homepage Sponsored Product` and `SmartShop Handset Home Page (DEMO)`. Both accept a `Self-Serve` request with a runtime calendar window from today+45 through today+75. Override the names via `E2E_MP_RECOMPUTE_CHANNEL_A` / `E2E_MP_RECOMPUTE_CHANNEL_B`.
- Each case captures one calendar-date anchor, derives dates with calendar arithmetic, and fails if the date rolls over before the final assertion.

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
| RULE-001 | The accessibly labelled summary Total Budget equals the sum of the budgets of channels currently in the plan | totalBudgetMinorUnits = sum(channel.budgetMinorUnits for channel in plan); render with en-GB GBP grouping | An unnamed, stale, or arithmetically incorrect Total Budget is a failure |
| RULE-002 | A successful channel deletion removes only its row and recomputes Total Budget | totalBudgetAfter = totalBudgetBefore - deletedChannelBudget; target absent; every survivor present | A stale total, removed survivor, or still-present target is a failure |

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
      "channelA": { "name": "Homepage Sponsored Product", "budgetPounds": 15000 },
      "channelB": { "name": "SmartShop Handset Home Page (DEMO)", "budgetPounds": 10000 },
      "startOffsetDays": 45,
      "endOffsetDays": 75
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
| budgetA | 15000 | channelA request budget; renders as £15,000 |
| budgetB | 10000 | channelB request budget; renders as £10,000 |
| combinedTotal | 25000 | Arithmetic sum; renders as £25,000 |
| startOffsetDays | 45 | Runtime calendar offset, safely beyond known booking deadlines |
| endOffsetDays | 75 | Runtime calendar offset; 31 inclusive calendar days after start |
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
| 3 | AC-003 | Add channelA and channelB and read the summary | Assistant channel request input | exact env-resolved names; £15,000 and £10,000; today+45 through today+75 | Both channel rows are visible and the labelled Total Budget equals the formatted arithmetic sum £25,000 | both rows; accessible Total Budget label; computed/formatted total |
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
- Must compute the combined and remaining totals from numeric request budgets before formatting; do not use the displayed pre-delete total as the oracle for both assertions.
- Must derive dates from one per-test calendar anchor; do not hardcode dates or add offsets as fixed 24-hour millisecond intervals.
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
- Campaign dates are runtime-relative (today+45 through today+75) so the suite does not rot and unrelated booking-deadline/duration validations do not interfere.
- Human review must confirm both default channels remain resolvable, the labelled Total Budget formatting, the `£--` empty state, and successful-delete semantics before signoff.
