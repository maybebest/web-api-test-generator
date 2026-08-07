# Flow: Large SKU result selection integrity

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-028 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P2 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/sains/large-sku-selection-integrity.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @sku @authenticated @large-result |
| Generation Mode | single |
| Review Status | pending-review |
| Review Sign-off | pending |
| Generation Source | coverage-gap-analysis |
| Generation Status | generated |

## User Story

As an authenticated media planner,
I want a documented large SKU result set to remain selectable and commit without losing rows,
So that catalogue volume does not break the Measurement-to-Hero planning transition.

## Preconditions

- A valid non-production authenticated Playwright storage state is supplied through `E2E_AUTH_STATE_PATH`.
- `PLAYWRIGHT_TEST_BASE_URL` points to the reviewed non-production Pollen environment.
- The account can open the Nectar AI guided planner at `/planning`.
- Advertiser `N360_Unilever_MS`, brand `Unilever | Knorr | MS`, objective `Customer retention`, and product query `knorr` remain available.
- The source-backed qualification floor is 29 product rows: `specs/sains/nectar-ai-knowledge.md` records that the same live query produced 29 selectable Measurement SKUs. A run with fewer than 29 rows fails because its input no longer qualifies as this documented large-result fixture.
- The qualification floor is input data, not a response-time SLO or a statement that 29 is the maximum supported catalogue size.
- The run creates a fresh autosaved Nectar AI conversation owned by the supplied QA account. The captured API has no verified conversation-delete operation; the user explicitly authorized dev mutations for this run.

## Out-of-scope

- A response-time, percentile, Web Vital, CPU, memory, network-size or maximum-volume pass/fail claim. No approved performance SLO or volume ceiling exists in the supplied specs.
- Enabling authenticated performance telemetry: the authenticated project intentionally disables trace, screenshot, video and performance artifact collection to protect auth and potentially private content.
- Proving behaviour above the number of rows returned by the current `knorr` query.
- Catalogue seeding, changing advertiser/brand SKU links, or deleting the autosaved conversation.
- Channel selection, pricing, save, CSV export, booking and downstream persistence.
- Treating this functional-integrity slice as full coverage of canonical `EXT-PERF-001`; an approved dataset/SLO is still required for that performance claim.

## Stability Requirements

| Field | Value |
|---|---|
| Parallel Safe | no |
| Data Isolation | external |
| Allowed Retries | 0 |

## Variants

| Locale | Role | Plan |
|---|---|---|
| en-GB | authenticated media planner | fresh Nectar AI conversation |

## Includes

- none

## Business Rules

| Rule ID | Rule | Formula | Blocking Behavior |
|---|---|---|---|
| RULE-001 | The live result qualifies as the documented large-SKU fixture | `discoveredProductRows >= 29` | Fewer rows fail the fixture precondition; the test must not claim a large-result run |
| RULE-002 | Group-level Select All preserves every discovered product selection | `checkedProductRows === discoveredProductRows` after activating every visible enabled Select All group | Any missing selection is a broken large-result action |
| RULE-003 | Committing the large Measurement selection preserves its cardinality and advances the flow | `summaryMeasurementCount === discoveredProductRows` and the Hero-selection control is visible | A lost row, timeout, disabled commit or broken transition fails the functional-integrity journey |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | advertiser=N360_Unilever_MS; brand=Unilever \| Knorr \| MS; objective=Customer retention; productSearch=knorr; minimumProductRows=29; action=activate every visible enabled Select All group and confirm Measurements | At least 29 product rows render; at least one Select All group is actionable; every discovered product row is checked; after confirmation the summary count equals the discovered count and the Hero-selection step is visible | Maps the automatable functional-integrity slice of source `NEG-008` / canonical `EXT-PERF-001`; contains no timing threshold |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "advertiser": "N360_Unilever_MS",
      "brand": "Unilever | Knorr | MS",
      "objective": "Customer retention",
      "productSearch": "knorr",
      "minimumProductRows": 29,
      "action": "activate every visible enabled Select All group and confirm Measurements"
    },
    "expected": {
      "minimumDiscoveredRows": 29,
      "minimumActionableSelectAllGroups": 1,
      "allDiscoveredRowsChecked": true,
      "summaryCountEqualsDiscoveredRows": true,
      "heroSelectionVisible": true
    },
    "notes": "Functional large-result integrity only; no elapsed-time or performance-SLO assertion."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| advertiser | N360_Unilever_MS | Live-verified dev advertiser |
| brand | Unilever \| Knorr \| MS | Live-verified dev brand |
| objective | Customer retention | Existing deterministic guided-flow objective |
| productSearch | knorr | Source records 29 results; 46 rows were observed during the 2026-07-13 reconnaissance run |
| minimumProductRows | 29 | Source-backed dataset qualification floor, not an SLO |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | The authenticated development environment supplies the live product catalogue | [] |

## Mocks as JSON

```json
[]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Open a fresh guided plan and reach Measurement SKU search | Nectar AI guided planner | advertiser, brand, objective | Measurement search accepts the documented query | Reuse `PlanningPage`; no direct test-body locators |
| 2 | AC-001 | Search the documented catalogue fixture and count product rows | Measurement result groups | knorr | At least 29 product checkboxes are discovered | Compare captured row count with the source-backed floor in the final assertion step |
| 3 | AC-002 | Activate every visible enabled group Select All control and capture checked cardinality | Measurement result groups | all current groups | Every discovered product row is checked | Read checked state through the component object |
| 4 | AC-003 | Confirm the Measurement selection | Measurement Confirm action | selected rows | Summary count is preserved and Hero selection becomes available | Assert summary count and Hero control visibility |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | The live `knorr` result falls below the source-backed 29-row qualification floor | The primary journey fails before making any performance claim because the run no longer exercised the documented large-result fixture |

## Acceptance Criteria

- AC-001: The documented `knorr` query renders at least 29 selectable product rows in a fresh authenticated guided plan.
- AC-002: Activating all visible enabled Select All groups checks every discovered product row without loss.
- AC-003: Confirming the large Measurement selection preserves the discovered cardinality in the summary and reaches the Hero-selection step.

## Locator Hints

- Reuse `PlanningPage` for the live-verified guided advertiser, brand, objective and product-search actions.
- Keep result-row, group Select All, Measurement-confirm, checked-state, summary-count and Hero-control locators/actions in `LargeSkuSelectionComponent`.
- Product rows use the live-verified accessible-name suffix `<product> - <SKU>`; group controls use their accessible `Select All` name.

## Generated Test Requirements

- Must import `test` and `expect` from `fixtures/test`.
- Must use `Generation Mode | single`, emit exactly one primary `DC-001` test, and declare a `covered-ac-ids` annotation containing exactly AC-001, AC-002 and AC-003.
- Every `test.step` title must name at least one covered AC ID; all `expect(...)` calls must be inside the final `Assert AC-003` step.
- Must use `PlanningPage` and `LargeSkuSelectionComponent`; the test body must not create direct locators.
- Must commit the large Measurement result through `LargeSkuSelectionComponent`, whose landing wait is scoped to one Hero control; the shared single-result helper is not strict-safe when dozens of Hero controls render.
- Must discover the live product-row count before selecting and must not hard-code the current 46-row observation as the expected summary count.
- Must fail if fewer than 29 product rows render, no group Select All is actionable, any discovered row remains unchecked, the summary count differs from the discovered count, or the Hero-selection control is not visible.
- Must not collect or persist authenticated performance metrics, URLs, bodies, headers, console text, traces, screenshots or video.
- Must not claim a response-time or full `EXT-PERF-001` result; no source-approved SLO exists.
- Must not use direct route interception, fixed waits, `waitForLoadState('networkidle')`, XPath, `test.only`, `test.skip`, `test.fixme` or `test.fail`.
- Must remain pending-review until the 29-row qualification floor and functional assertions receive human sign-off.

## Notes

- Canonical mapping: source `NEG-008` (`Large SKU result performance`) and extension `EXT-PERF-001`.
- This flow automates the source's functional conditions "no timeout or broken selection" only insofar as the real UI completes within the framework's existing bounded action/test timeouts and retains every selected row. It deliberately adds no elapsed-time assertion.
- Full `EXT-PERF-001` remains blocked on an approved stable large-catalogue fixture, warm/cold conditions, measurement boundary, percentile, sample count and pass threshold.
- The authenticated Playwright project excludes performance collection and credential-bearing browser artifacts; this test does not override that privacy control.
