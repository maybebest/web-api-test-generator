# Flow: Nectar AI summary panel reflects the guided selections

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-021 |
| Spec Version | 1.1.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/nectar-summary-reflection.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated |
| Review Status | pending-review |
| Review Sign-off | pending |
| Generation Source | manual-test-case |
| Generation Status | generated |
| Generation Mode | single |

## User Story

As a media planner,
I want the Nectar AI summary panel to reflect each selection I make (advertiser, brand, objective, Measurement SKUs),
So that I can trust the summary as an accurate running record of the plan I am building.

## Preconditions

- The user has a valid non-production authenticated Playwright storage state (`playwright/.auth/user.json`).
- `PLAYWRIGHT_TEST_BASE_URL` points to an explicitly configured non-production Pollen environment.
- Local storage key `feature-flags` enables `FEATURE_NECTAR_AI`, `FEATURE_NUP`, and `FEATURE_NECTAR_AI_MP`.
- The user can access the Planning page at `/planning`.
- The advertiser `N360_Unilever_MS`, brand `Unilever | Knorr | MS`, and objective `Customer retention` are available.
- The product search term `knorr` returns at least one selectable product/SKU.
- Each case starts a fresh, unsaved planning conversation whose summary contains none of this spec's fixture values.

## Out-of-scope

- Admin and channel configuration changes are out of scope and must remain read-only.
- Channel, budget, pricing, save and export behaviours are out of scope (covered by other specs).
- Editing selections from the summary is out of scope (covered by the edit-SKU and channel specs).
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
| RULE-001 | The summary panel reflects the confirmed advertiser and brand | summaryAdvertiser == selected advertiser AND summaryBrands == selected brand | Test failure: an omitted, stale, or mislabelled advertiser/brand makes the summary untrustworthy |
| RULE-002 | The summary panel reflects the entered objective | summaryObjective contains the entered objective text | Test failure: an omitted or stale objective makes the summary untrustworthy |
| RULE-003 | The summary panel reflects the confirmed Measurement SKU count | summaryMeasurementCount shows the number of confirmed Measurement SKUs (rendered as "N SKU" or "N SKUs") | Test failure: a stale or incorrect count makes the summary untrustworthy |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | advertiser=N360_Unilever_MS; brand=Unilever \| Knorr \| MS; objective=Customer retention; productSearch=knorr | After the guided sequence completes, the summary simultaneously shows the confirmed advertiser, brand, objective, and one Measurement SKU | Single deterministic final-reflection case; it does not claim exact intermediate render timing |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "advertiser": "N360_Unilever_MS",
      "brand": "Unilever | Knorr | MS",
      "objective": "Customer retention",
      "productSearch": "knorr"
    },
    "expected": {
      "advertiser": "N360_Unilever_MS",
      "brand": "Unilever | Knorr | MS",
      "objective": "Customer retention",
      "measurementCountPattern": "(?<!\\d)1 SKUs?"
    },
    "notes": "The single-mode test asserts all four values together after the final confirmation; intermediate render timing is not claimed."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| advertiser | N360_Unilever_MS | Non-production advertiser |
| brand | Unilever \| Knorr \| MS | Non-production brand |
| objective | Customer retention | Media Planner objective |
| productSearch | knorr | Product search term (live-proven; the first result is selected as the single Measurement SKU) |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | Live dev environment renders the summary panel | [] |

## Mocks as JSON

```json
[]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Launch the guided planner and select advertiser and brand | /planning | advertiser; brand; Confirm | The summary panel shows the confirmed advertiser and brand | summaryAdvertiser and summaryBrands contain the selected values |
| 2 | AC-002 | Enter the campaign objective | Assistant chat | objective | The summary panel shows the objective | summaryObjective contains the objective text |
| 3 | AC-003 | Search products and confirm one Measurement SKU | Assistant chat and product search | productSearch; select one; Confirm | The summary panel shows the Measurement SKU count | summaryMeasurementCount reflects the confirmed selection |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | Start a fresh conversation but do not confirm advertiser, brand, objective, or SKU selections | The summary contains none of the fixture advertiser, brand, or objective values and does not report one confirmed Measurement SKU |

## Acceptance Criteria

- AC-001: In the completed guided state, the summary reflects the confirmed advertiser and brand.
- AC-002: In the completed guided state, the summary reflects the entered objective.
- AC-003: In the completed guided state, the summary reflects one confirmed Measurement SKU.

## Locator Hints

- Use `PlanningPage.summaryAdvertiser()` (`plan-advertiser`), `PlanningPage.summaryBrands()` (`plan-brands`), `PlanningPage.summaryObjective()` (`plan-objective`) and `PlanningPage.summaryMeasurementCount()` (`plan-measurement-skus`) — all live-CONFIRMED testids.
- The measurement counter row concatenates its children without whitespace, so assert the count with `toContainText(new RegExp('(?<!\\d)1 SKUs?'))`, never `toHaveText`.
- Use exact visible text for the advertiser/brand/objective option chips during setup.

## Generated Test Requirements

- Must import from fixtures/test.
- Must use test.step.
- Must use Page Objects or Component Objects for all locators.
- Must not create direct `page.getBy*` or `page.locator(...)` locators in generated test bodies.
- This spec declares `Generation Mode | single`; emit exactly one primary DC-001 test covering AC-001 through AC-003 in one final assertion step, plus the optional NEG-001 test.
- Must put `expect(...)` only in the final assertion step for each test.
- Must title the final assertion step `Assert AC-###: ...` or `Assert NEG-###: ...`.
- Must include meaningful expect assertions for user-visible behavior.
- Must enumerate the `Data Cases as JSON` case id DC-001 in a test title.
- Must assert the salient expected values: N360_Unilever_MS, Unilever | Knorr | MS, Customer retention.
- The NEG-001 assertion must check all fixture values and the one-SKU count, not only the advertiser.
- Default generated-test execution target is Chromium only.
- Cross-browser generated-test execution is opt-in.
- Must not use page.waitForTimeout.
- Must not use page.waitForLoadState('networkidle').
- Must not use XPath.
- Must not use test.only.
- Must not silently skip (`test.skip`/`test.fixme`/`test.fail` in any form).
- Must not use real credentials.
- Must not commit auth state.
- Must not set `test.use({ storageState: <literal> })`; the `.authenticated.spec.ts` suffix routes the test to the `chromium-auth` project.

## Notes

- This flow targets the live Pollen development environment; `Parallel Safe` is `no` and `Data Isolation` is `external`.
- The summary panel is read-only in this flow; no plan is saved and no channel is added.
- Assistant turns stream for 30-60s+, so each build step budgets the assistant-reply timeout via the Page Object.
- Human review must confirm the summary labels/test IDs, singular/plural SKU copy, and whether a fresh conversation can ever hydrate prior unsaved selections; until then `Review Status` remains `pending-review`.
