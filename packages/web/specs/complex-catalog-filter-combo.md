# Flow: Complex catalog combined filters, multi-select materials, and pagination reset on sort

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-CX-CATALOG-002 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | smoke |
| Auth | none |
| Target Test File | tests/smoke/complex-catalog-filter-combo.spec.ts |
| Base Path | /complex/catalog |
| Tags | @generated @smoke @local-fixture @complex-catalog |
| Generation Mode | single |
| Generation Source | manual |
| Generation Status | pending-generation |

## User Story

As a catalog visitor on the deterministic local fixture,
I want to combine a category checkbox with a multi-select materials filter and see table sorting reset my pagination,
So that compound filter state and the sort-resets-page rule prove testable end to end.

## Preconditions

- The local fixture server is started automatically by the Playwright `webServer` configuration (`node local-fixture/server.mjs`).
- The flow runs in the `local-chromium` project, whose `baseURL` is the local fixture origin `http://127.0.0.1:3000`.
- No authentication and no external network access are required.

## Out-of-scope

- The quick-view modal, basket badge, tabs, accordion, and combobox widgets (covered by FLOW-CX-CATALOG-001 or intentionally untested here).
- Row-order assertions after sorting; only the `aria-sort` state and the pagination reset are asserted.
- Toast message content (toasts auto-dismiss after 1200 ms and are timing-sensitive).

## Stability Requirements

| Field | Value |
|---|---|
| Parallel Safe | yes |
| Data Isolation | per-test |
| Allowed Retries | 0 |

## Variants

| Locale | Role | Plan |
|---|---|---|
| en-US | guest | standard |

## Includes

- none

## Business Rules

| Rule ID | Rule | Formula | Blocking Behavior |
|---|---|---|---|
| RULE-001 | The filter status counts one active unit per checked category checkbox and per selected materials option. | 1 category + 2 materials + Apply => status text "Filters applied: 3 active" | A wrong active count blocks the combined filter flow. |
| RULE-002 | Pagination reports the current page of 24 products at 10 rows per page. | click page 2 => indicator "Page 2 of 3" | A wrong page indicator blocks the pagination flow. |
| RULE-003 | Sorting any column resets pagination to page 1. | click Stock sort on page 2 => indicator "Page 1 of 3" AND page-1 button aria-current="page" | A stale page after sorting fails the final business assertion. |
| RULE-004 | Sorting the product table by Stock marks the Stock column header with `aria-sort`. | click Stock header => th[aria-sort=ascending] | Missing aria-sort state blocks the sort flow. |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | category checkbox `Kitchen`, materials `Oak` + `Ceramic`, target page `2`, sort column `Stock` | Filter status shows 3 active filters, page 2 is reported, and the Stock sort resets the indicator to page 1 | Positive path over seeded catalog data |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "categoryFilter": "Kitchen",
      "materials": ["Oak", "Ceramic"],
      "targetPage": "2",
      "sortColumn": "Stock"
    },
    "expected": {
      "filterStatusText": "Filters applied: 3 active",
      "pageIndicatorAfterPage2": "Page 2 of 3",
      "stockHeaderAriaSort": "ascending",
      "pageIndicatorAfterSort": "Page 1 of 3"
    },
    "notes": "All catalog data is seeded server-side; the sort handler always resets the page to 1."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| categoryFilter | Kitchen | Visible label of the category checkbox |
| materialsOptionA | Oak | Option label in the materials multi-select (testid `filter-materials`) |
| materialsOptionB | Ceramic | Option label in the materials multi-select |
| filterStatusTestId | filter-status | Live filter status line |
| pageIndicatorTestId | page-indicator | Pagination status line |
| sortStockTestId | sort-stock | Stock column sort button |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | Fully local deterministic fixture | [] |

## Mocks as JSON

```json
[]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Open the complex catalog page | `/complex/catalog` | none | The filter status reads `Filters applied: 0 active` | The status line is testid `filter-status` (role `status`) |
| 2 | AC-002 | Check the Kitchen category, select two materials, and activate Apply | Filters sidebar | checkbox `Kitchen`; multi-select options `Oak` and `Ceramic` | Filter status reads `Filters applied: 3 active` | The materials control is a native multiple select (testid `filter-materials`); Apply's accessible name is `Apply catalog filters` |
| 3 | AC-003 | Go to page 2 of the product table | Pagination control `2` | none | The page indicator reads `Page 2 of 3` | Page buttons carry testids `page-1`..`page-3`; the indicator is testid `page-indicator` |
| 4 | AC-004 | Sort the product table by Stock | Stock column header button | none | The Stock header carries `aria-sort="ascending"` | Use testid `sort-stock` (a CSS `::after` arrow mutates the accessible name to `Stock ↑` once sorted) |
| 5 | AC-005 | Inspect the pagination state after sorting | Page indicator and page buttons | none | The indicator reads `Page 1 of 3` because sorting resets pagination | Final assertion only: testid `page-indicator` has text `Page 1 of 3` |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | Sorting while on page 2 leaves the table on page 2 | The indicator would still read `Page 2 of 3` after the Stock sort, failing the final assertion. |

## Acceptance Criteria

- AC-001: The catalog page opens with the filter status reading `Filters applied: 0 active`.
- AC-002: Checking the Kitchen category plus selecting the Oak and Ceramic materials and applying updates the status to `Filters applied: 3 active`.
- AC-003: Selecting pagination page 2 updates the page indicator to `Page 2 of 3`.
- AC-004: Activating the Stock column sort marks the Stock header with `aria-sort="ascending"`.
- AC-005: After the sort, the pagination indicator resets to `Page 1 of 3`.

## Locator Hints

- Keep all locators in an inline Page Object class inside the generated file; the test body must not create direct Playwright locators.
- The category checkboxes are label-wrapped inputs; use `getByRole('checkbox', { name: 'Kitchen' })`.
- The materials filter is a native `<select multiple>` with testid `filter-materials`; select both options in one `selectOption(['Oak', 'Ceramic'])` call by label.
- The Apply button's accessible name is `Apply catalog filters` (aria-label), not its visible text `Apply`.
- Use testids `filter-status`, `page-indicator`, `page-2`, and `page-1` where they exist.
- Sort header buttons carry testids `sort-product`, `sort-sku`, `sort-category`, `sort-price`, `sort-stock`, `sort-rating`, `sort-updated`. Activate the Stock sort via `getByTestId('sort-stock')` — never a role/name locator: a CSS `::after` arrow mutates the button's accessible name from `Stock` to `Stock ↑` as soon as `aria-sort` is set.
- Assert the sort state via the `aria-sort` attribute on the Stock column header, not row order.

## Generated Test Requirements

- Must import `test` and `expect` from `../../fixtures/test`.
- Must keep the flow Page Object inline in the generated file and must not import or modify another Page Object.
- Must generate exactly one primary test and no optional `NEG-001` test.
- Must declare the exact metadata tags through the Playwright `{ tag: [...] }` option.
- Must use `test.step`, and every step title must carry at least one `AC-###` token.
- Must declare a `covered-ac-ids` annotation whose set equals AC-001 through AC-005.
- Must place `expect(...)` only in the final assertion step.
- Must title that final step `Assert AC-005: page indicator shows Page 1 of 3` and assert only the page indicator text.
- Must not use hard waits, XPath, focused tests, skipped tests, or direct Playwright locators in the generated test body.

## Notes

- This flow is a control-complement to FLOW-CX-CATALOG-001: it deliberately exercises the widgets that flow leaves out-of-scope (multi-select, category checkbox combination, sort-driven pagination reset) and leaves the modal/basket path out-of-scope here.
- The Apply handler only updates the status counter; it does not filter the grid, so no row-count assertions belong in this flow.
