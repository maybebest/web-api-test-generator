# Flow: Complex catalog filtering, sorting, and quick-view modal purchase

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-CX-CATALOG-001 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | smoke |
| Auth | none |
| Target Test File | tests/smoke/complex-catalog-filter-sort-modal.spec.ts |
| Base Path | /complex/catalog |
| Tags | @generated @smoke @local-fixture @complex-catalog |
| Generation Mode | single |
| Generation Source | manual |
| Generation Status | pending-generation |

## User Story

As a catalog visitor on the deterministic local fixture,
I want to filter the catalog, sort the product table, page through results, and buy from the quick-view modal,
So that the dense catalog page proves the core browsing widgets work end to end.

## Preconditions

- The local fixture server is started automatically by the Playwright `webServer` configuration (`node local-fixture/server.mjs`).
- The flow runs in the `local-chromium` project, whose `baseURL` is the local fixture origin `http://127.0.0.1:3000`.
- No authentication and no external network access are required.

## Out-of-scope

- The tabs, accordion, combobox autocomplete, multi-select, and breadcrumb widgets on the same page; this flow covers filter apply, table sort, pagination, and the quick-view modal only.
- Toast message content (toasts auto-dismiss after 1200 ms and are timing-sensitive).
- Visual styling of the sticky header and product cards.

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
| RULE-001 | Applying sidebar filters updates the visible filter status with the active filter count. | check 1 category + Apply => status text "Filters applied: 1 active" | A stale status count blocks the filter flow. |
| RULE-002 | Sorting the product table by Price marks the Price column header with `aria-sort`. | click Price header => th[aria-sort=ascending] | Missing aria-sort state blocks the sort flow. |
| RULE-003 | Pagination shows 10 rows per page across 24 products and reports the current page. | click page 2 => indicator "Page 2 of 3" | A wrong page indicator blocks the pagination flow. |
| RULE-004 | Adding a product to the basket from the quick-view modal increments the sticky-header basket badge. | modal Add to cart => basket badge "1" | A stale basket badge fails the final business assertion. |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | category filter `Lighting`, sort column `Price`, target page `2`, quick-view product `Aurora Lamp` | Filter status shows 1 active filter, Price sorts ascending, page 2 is reported, and the basket badge shows `1` after the modal purchase | Positive path over seeded catalog data |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "categoryFilter": "Lighting",
      "sortColumn": "Price",
      "targetPage": "2",
      "quickViewProduct": "Aurora Lamp"
    },
    "expected": {
      "filterStatusText": "Filters applied: 1 active",
      "priceHeaderAriaSort": "ascending",
      "pageIndicatorText": "Page 2 of 3",
      "basketBadgeText": "1"
    },
    "notes": "All catalog data is seeded server-side; results are deterministic."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| categoryFilter | Lighting | Visible label of the category checkbox |
| quickViewProduct | Aurora Lamp | Product name on the first featured card (testid `quickview-1`) |
| basketBadgeTestId | basket-count | Sticky-header basket badge |
| pageIndicatorTestId | page-indicator | Pagination status line |

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
| 1 | AC-001 | Open the complex catalog page | `/complex/catalog` | none | The catalog page renders its level-one heading | The sticky header duplicates the H1 text, so scope the heading to role `heading` level 1 |
| 2 | AC-002 | Check the Lighting category filter and activate Apply | Filters sidebar | checkbox `Lighting` | Filter status reads `Filters applied: 1 active` | Apply button accessible name is `Apply catalog filters` (aria-label differs from visible text `Apply`) |
| 3 | AC-003 | Sort the product table by Price | Price column header button | none | The Price header carries `aria-sort="ascending"` | Sort buttons have no test ids; use role `button` name `Price` inside the table |
| 4 | AC-004 | Go to page 2 of the product table | Pagination control `2` | none | The page indicator reads `Page 2 of 3` | Page buttons carry testids `page-1`..`page-3`; the indicator is testid `page-indicator` |
| 5 | AC-005 | Open the quick view for the first featured product | Quick view button on the `Aurora Lamp` featured card | none | The modal dialog opens showing the product name | Use testid `quickview-1`; the dialog is role `dialog` with an accessible name from its heading |
| 6 | AC-006 | Add the product to the basket from the modal | Modal `Add to cart` button | none | The modal closes and the basket badge increments | Scope `Add to cart` to the dialog: 17 identical `Add to cart` buttons exist page-wide (strict-mode trap) |
| 7 | AC-006 | Inspect the sticky-header basket badge | Basket badge | none | The badge shows `1` | Final assertion only: testid `basket-count` has text `1` |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | The modal Add to cart action fails to update the basket badge | The badge does not show `1` and the flow fails its final assertion. |

## Acceptance Criteria

- AC-001: The catalog page opens and shows its level-one heading `Complex catalog`.
- AC-002: Applying the Lighting category filter updates the filter status to `Filters applied: 1 active`.
- AC-003: Activating the Price column sort marks the Price header with `aria-sort="ascending"`.
- AC-004: Selecting pagination page 2 updates the page indicator to `Page 2 of 3`.
- AC-005: The quick-view modal opens from the featured `Aurora Lamp` card and names the product.
- AC-006: Adding to the basket from the modal closes it and the sticky-header basket badge shows `1`.

## Locator Hints

- Keep all locators in an inline Page Object class inside the generated file; the test body must not create direct Playwright locators.
- The page contains strict-mode traps: the H1 text `Complex catalog` also appears in the sticky header and breadcrumb, `Aurora Lamp` appears on four elements, and `Add to cart` appears on 17 buttons. Always scope by role, landmark, or container testid.
- Featured-section card controls carry testids (`quickview-1`, `addcart-1`); clearance-section cards deliberately have none.
- The Apply button's accessible name is `Apply catalog filters` (aria-label), not its visible text `Apply`.
- Use testids `page-indicator`, `page-2`, `basket-count`, and `modal-close` where they exist; use role/name for the sort header buttons and the filter checkbox.
- Assert the sort state via the `aria-sort` attribute on the `Price` column header, not row order.

## Generated Test Requirements

- Must import `test` and `expect` from `../../fixtures/test`.
- Must keep the flow Page Object inline in the generated file and must not import or modify another Page Object.
- Must generate exactly one primary test and no optional `NEG-001` test.
- Must declare the exact metadata tags through the Playwright `{ tag: [...] }` option.
- Must use `test.step`, and every step title must carry at least one `AC-###` token.
- Must declare a `covered-ac-ids` annotation whose set equals AC-001 through AC-006.
- Must place `expect(...)` only in the final assertion step.
- Must title that final step `Assert AC-006: basket badge shows 1` and assert only the basket badge text.
- Must not use hard waits, XPath, focused tests, skipped tests, or direct Playwright locators in the generated test body.

## Notes

- The catalog page is a DOM-complexity stress fixture: 474 nodes, maximum element depth 18, and deliberate duplicate-text traps.
- Toast notifications auto-dismiss after 1200 ms; the flow intentionally asserts the persistent basket badge instead.
