# Flow: Edit SKU list controls and modal identity

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-SKU-EDIT |
| Spec Version | 2.3.1 |
| Owner | aqa-team@example.com |
| Priority | P2 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/nectar-edit-sku-list.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @nectar-sku @edit-sku-list-button-and-modal |
| Generation Mode | suite |
| Review Status | pending-review |
| Review Sign-off | pending |
| Generation Source | remediated-existing-suite |
| Generation Status | generated |

## User Story

As a media planner,
I want the Measurement and Hero edit controls to open the correct SKU editor,
So that I can inspect or cancel an edit without changing the confirmed SKU selection.

## Preconditions

- A valid non-production authenticated Playwright storage state (`playwright/.auth/user.json`).
- `PLAYWRIGHT_TEST_BASE_URL` points to an explicitly configured non-production Pollen environment.
- The guided planner can reach a confirmed SKU summary through `buildToSkusConfirmed`.
- The confirmed flow contains at least one Measurement SKU and one Hero SKU.
- Each case starts a fresh, unsaved conversation. No case confirms an editor mutation, so no catalogue or saved-plan cleanup is required.

## Out-of-scope

- Confirming a changed SKU selection is not claimed by this suite; the cancellation cases make one tentative removal and then discard it.
- Per-channel Hero persistence and catalogue deletion synchronization are covered by separate pending flows.
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
| en-GB | media planner | guided Nectar AI plan |

## Includes

- none

## Business Rules

| Rule ID | Rule | Formula | Blocking Behavior |
|---|---|---|---|
| RULE-001 | The Measurement edit control opens the Measurement editor | measurement control => modal contains "Edit Measurement SKUs" | Opening the Hero editor from this control is a defect |
| RULE-002 | The Hero edit control opens the Hero editor | hero control => modal contains "Hero" and not "Edit Measurement SKUs" | Opening the Measurement editor from this control is a defect |
| RULE-003 | Cancelling either editor discards a tentative removal | tentative remove then cancel => modal hidden AND exact selected rows restored AND corresponding summary count unchanged | Any committed selection or count mutation on cancel is a defect |
| RULE-004 | Each edit control and dialog is keyboard operable and has an accessible identity | edit control has an accessible name; activation moves focus into a role=dialog with an accessible name identifying Measurement or Hero; Cancel closes it and returns focus to the invoking control | A keyboard trap, unnamed control/dialog, or lost focus after cancellation is an accessibility defect |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | confirmed SKU summary; click Measurement edit | Measurement modal is visible with selected-SKU rows | source TC-ESL-002 |
| DC-002 | confirmed SKU summary; click Hero edit | Hero modal is visible | source TC-ESL-007 |
| DC-003 | open Measurement, cancel, then open Hero | Each control opens its distinct editor | source TC-ESL-020 |
| DC-004 | open Measurement editor; capture selection; tentatively remove one row; click Cancel | Modal closes and the exact Measurement selection and summary count stay unchanged | source TC-ESL-005; AC-003 |
| DC-005 | open Hero editor; capture selection; tentatively remove one row; click Cancel | Modal closes and the exact Hero selection and summary count stay unchanged | source TC-ESL-011; AC-003 |
| DC-006 | open Measurement editor | At least one selected row has a remove control | source TC-ESL-004 |
| DC-007 | focus each edit control; activate with keyboard; cancel with the labelled Cancel button | The requested editor is a named dialog, focus moves inside it, and focus returns to the invoking control after cancellation | Keyboard/focus accessibility contract; AC-004 |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": { "control": "Measurement edit", "sourceCaseId": "TC-ESL-002" },
    "expected": { "modalCopy": "Edit Measurement SKUs", "selectedRowsVisible": true },
    "notes": "Proves the Measurement control and current-selection structure"
  },
  {
    "caseId": "DC-002",
    "inputs": { "control": "Hero edit", "sourceCaseId": "TC-ESL-007" },
    "expected": { "modalCopy": "Hero", "visible": true },
    "notes": "Proves the Hero control opens an editor"
  },
  {
    "caseId": "DC-003",
    "inputs": { "controls": ["Measurement edit", "Hero edit"], "sourceCaseId": "TC-ESL-020" },
    "expected": { "distinctModalIdentity": true },
    "notes": "Guards against the two controls being wired to the same editor"
  },
  {
    "caseId": "DC-004",
    "inputs": { "control": "Measurement edit", "tentativeAction": "remove first selected row", "action": "Cancel", "sourceCaseId": "TC-ESL-005" },
    "expected": { "modalHidden": true, "exactSelectionRestored": true, "summaryCountUnchanged": true },
    "notes": "AC-003 Measurement row"
  },
  {
    "caseId": "DC-005",
    "inputs": { "control": "Hero edit", "tentativeAction": "remove first selected row", "action": "Cancel", "sourceCaseId": "TC-ESL-011" },
    "expected": { "modalHidden": true, "exactSelectionRestored": true, "summaryCountUnchanged": true },
    "notes": "AC-003 Hero row"
  },
  {
    "caseId": "DC-006",
    "inputs": { "control": "Measurement edit", "sourceCaseId": "TC-ESL-004" },
    "expected": { "selectedRowVisible": true, "removeControlVisible": true },
    "notes": "Structural affordance only; this case does not click remove or confirm"
  },
  {
    "caseId": "DC-007",
    "inputs": { "controls": ["Measurement edit", "Hero edit"], "activation": "keyboard", "closeAction": "Cancel" },
    "expected": { "controlAccessibleName": true, "namedDialog": true, "focusMovesInside": true, "focusReturnsToInvoker": true },
    "notes": "Run once per editor; proves keyboard activation, dialog identity, and focus restoration without committing a change"
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| plannerBuilder | buildToSkusConfirmed | Uses the existing guided-flow helper |
| modalPageObject | PlanningPage.editSkuModal | Owns the modal locator |
| salientCopy | Edit Measurement SKUs, Hero | Copy asserted by the suite |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | Live non-production guided planner | [] |

## Mocks as JSON

```json
[]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Open the Measurement editor | Measurement edit control | confirmed SKU summary | The control opens the visible Measurement editor; it exposes selected rows and remove controls | assert Measurement modal copy and selected-row test ids |
| 2 | AC-001 | Open the Hero editor | Hero edit control | confirmed SKU summary | The control opens the visible Hero editor with its expected identity | assert Hero modal copy |
| 3 | AC-002 | Open both editors in sequence | Measurement then Hero edit controls | cancel between opens | The controls resolve to distinct modal identities | capture the Measurement identity and assert the Hero editor does not reuse it |
| 4 | AC-003 | Tentatively remove one selected row and cancel, once per editor | Measurement and Hero dialogs | DC-004, DC-005 | Reopening shows the exact original selection and the corresponding summary count is unchanged | modal hidden; summary count unchanged; exact selected-row snapshot restored |
| 5 | AC-004 | Activate and cancel each editor using the keyboard | Measurement and Hero edit controls/dialogs | DC-007 | The control and dialog are named, focus enters the dialog, and focus returns to the invoking control | accessible name; role=dialog accessible name; focused descendant; invoking control focused after Cancel |
| 6 | NEG-001 | Open both controls independently and reject crossed/shared identities | Measurement and Hero edit controls/dialogs | DC-003 | Measurement never resolves to Hero identity and Hero never resolves to Measurement identity | exact dialog role/name per invoking control; other identity absent |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | DC-003 regression: both edit controls open the Measurement editor, both open the Hero editor, or either opens an editor with the other control's identity | The dedicated negative test fails unless Measurement resolves only to the Measurement dialog and Hero resolves only to the Hero dialog |

## Acceptance Criteria

- AC-001: Each Measurement or Hero edit control opens the requested editor with its expected identity; the Measurement editor exposes current selected rows and remove controls
- AC-002: Opening both controls in sequence demonstrates distinct Measurement and Hero modal identities
- AC-003: Cancelling a tentative removal in either editor restores the exact committed selection and leaves its summary count unchanged.
- AC-004: Both editor controls are keyboard operable; each opens a named dialog, moves focus inside it, and restores focus to its invoking control on cancellation.

## Locator Hints

- Use `PlanningPage.openMeasurementEditModal`, `PlanningPage.openHeroEditModal`, and `PlanningPage.editSkuModal`.
- Use the modal-owned `selectedSku-*` and `remove-selectedSku-*` test IDs for row structure.
- Scope dialog identity and focus assertions through `PlanningPage.editSkuModal`, backed by `getByRole('dialog', { name: /Measurement|Hero/i })`; do not infer dialog identity from arbitrary page text.
- Keep locators in `PlanningPage`; do not add raw selectors in the test.

## Generated Test Requirements

- Import `test` and `expect` from `fixtures/test`.
- Keep one focused test per Data Case and dedicated final assertion steps for every AC and NEG ID; NEG-001 may reuse DC-003 setup but must be a dedicated negative test.
- Run serially because the guided non-production session is external shared state.
- Must enumerate DC-001 through DC-007 and test both Measurement and Hero rows of DC-007.
- Must not use `page.waitForTimeout`, XPath, `test.only`, or any form of skip/fixme/fail.

## Notes

- This suite remaps the pre-existing live `nectar-edit-sku-list` modal coverage to FLOW-SKU-EDIT; the generic SKU counter generator is intentionally prevented from overwriting it.
- Cancel persistence is proved after a real tentative row removal, then by reopening the editor and comparing the exact selected-row snapshot plus the summary count.

## Pending Automation

- Confirming an added or removed Measurement SKU and proving persistence needs a reversible live-data contract.
- Confirming Hero assign/unassign and proving cross-table indicator recompute remains outside this suite.
- Empty-selection edit-control absence needs a deterministic way to reach an empty confirmed summary.
- Human review must confirm the exact accessible dialog names and whether Cancel is required to restore focus to the invoking edit control; these are not signed off while `Review Status` is `pending-review`.
