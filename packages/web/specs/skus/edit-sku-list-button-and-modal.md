# Flow: Edit SKU list button visibility and modal

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-SKU-EDIT |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P2 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/skus/edit-sku-list-button-and-modal.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @edit-sku-list-button-and-modal |
| Generation Mode | suite |
| Review Status | human-reviewed |
| Generation Source | manual-test-case |
| Generation Status | generated |

## User Story

As a media planner,
I want the Nectar AI planner to enforce edit sku list button visibility and modal correctly,
So that Hero/Measurement SKU selections and channel limits behave deterministically across the 15 documented cases.

## Preconditions

- A valid non-production authenticated Playwright storage state (`playwright/.auth/user.json`).
- `PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.pollen.js-devops.co.uk/`.
- A plan with at least one channel and a known SKU selection is available.
- The channel SKU selection can be seeded (see Missing test-data functions: setPlanHeroSkus).

## Out-of-scope

- Admin and channel configuration changes beyond the seeded preconditions are out of scope.
- Booking-deadline and minimum campaign-duration validation are out of scope (other specs).
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
| RULE-001 | The "Edit SKU list" button is visible only when a channel has an editable SKU selection | visible(editSkuList) == channel.hasEditableSkus | Showing the button with nothing to edit, or hiding it when SKUs exist, is a defect |
| RULE-002 | Opening "Edit SKU list" shows the current selection with accurate counts | modal.selectedCount == channel.selectedSkuCount | A modal whose count disagrees with the channel is a defect |
| RULE-003 | Cancelling the modal leaves the channel selection unchanged | cancel => channel.skus unchanged | A cancel that mutates the selection is a defect |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | Measurement SKUs = {12345, 234235} | The Measurement SKU table is displayed listing SKUs 12345 and 234235.; An 'Edit SKU list' button is visible directly under the Measurement SKU table.; The butt… | TC-EDIT-001 (UI/Critical) |
| DC-002 | Measurement SKUs = {12345, 234235} | A modal opens scoped to editing the Measurement SKU list (the Measurement edit modal), NOT the Hero modal.; The modal lists the current Measurement SKUs {12345… | TC-EDIT-002 (E2E/Critical) |
| DC-003 | Start Measurement = {12345, 234235}; add SKU 99999 -> end {12345, 234235, 99999} | The modal closes on confirm.; The Measurement SKU table now lists {12345, 234235, 99999} (change reflected immediately, no extra assistant turn required).; The… | TC-EDIT-003 (E2E/Critical) |
| DC-004 | Measurement = {12345, 234235}; attempt to add 99999 then cancel | The modal closes without applying changes.; The Measurement SKU table still lists exactly {12345, 234235}; 99999 is NOT added.; The summary Measurement count i… | TC-EDIT-004 (E2E/High) |
| DC-005 | Measurement SKUs = {1,2,3,4}; Hero SKUs = {3,5,6} | The 'Edit SKU list' button is visible and enabled directly under the Hero SKU table.; Clicking it opens the Hero edit modal (scoped to Hero SKUs), NOT the Meas… | TC-EDIT-005 (E2E/Critical) |
| DC-006 | Add Hero SKU 7 (a non-Measurement, brand-linked SKU) -> Hero = {3,5,6,7}; Measurement auto-grows to {1,2,3,4,5,6,7} | Modal closes on confirm.; The Hero SKU table now lists {3,5,6,7} immediately.; Per the AUTO-ADD rule, non-Measurement Hero SKU 7 is auto-added to Measurement; … | TC-EDIT-006 (E2E/High) |
| DC-007 | Attempt to add Hero SKU 7 then cancel | Modal closes without applying changes.; Hero SKU table still lists exactly {3,5,6}; SKU 7 is NOT added.; Measurement table is unchanged at {1,2,3,4} (no auto-a… | TC-EDIT-007 (E2E/High) |
| DC-008 | Prompt '1, 2, 3, 4 and hero skus 3, 5, 6' -> Measurement = {1,2,3,4,5,6}, Hero = {3,5,6} | The single-prompt summary table renders showing Measurement SKUs {1,2,3,4,5,6} and Hero SKUs {3,5,6}.; An 'Edit SKU list' button is visible and enabled under t… | TC-EDIT-008 (E2E/Critical) |
| DC-009 | Add Hero SKU 7 (non-Measurement) -> Hero = {3,5,6,7}; Measurement auto-grows to include 7 | Modal closes on confirm.; The summary table updates immediately: Hero SKUs now {3,5,6,7}.; Non-Measurement Hero 7 is auto-added to Measurement; Measurement set… | TC-EDIT-009 (E2E/High) |
| DC-010 | Attempt to add Hero SKU 7 then cancel | Modal closes without applying changes.; Summary table unchanged: Measurement = {1,2,3,4,5,6}, Hero = {3,5,6}.; No auto-add of 7; counts unchanged (Hero=3, Meas… | TC-EDIT-010 (E2E/Medium) |
| DC-011 | No SKUs selected | No Measurement SKU table, Hero SKU table, or summary table is rendered.; No 'Edit SKU list' button is visible anywhere (the button is bound to the presence of … | TC-EDIT-011 (UI/High) |
| DC-012 | Flow A single prompt: '1, 2, 3, 4 and hero skus 3, 5, 6'; Flow B multi-turn: first 'skus 1,2,3,4', then later 'hero skus 3,5,6' | Flow A: a single-prompt summary table is rendered WITH an 'Edit SKU list' button under it.; Flow B: no single-prompt summary table is rendered, so the summary-… | TC-EDIT-012 (E2E/High) |
| DC-013 | Measurement = {1,2,3,4}; Hero = {3,5,6} | Measurement-table button opens the Measurement edit modal (lists Measurement SKUs {1,2,3,4}).; Hero-table button opens the Hero edit modal (lists Hero SKUs {3,… | TC-EDIT-013 (Integration/High) |
| DC-014 | Via Hero modal: assign SKU 4 as Hero (4 already in Measurement) -> Hero = {3,4} | Modal closes on confirm.; SKU 4 in the Measurement table now shows the 'Hero SKU' indicator, updated in real time without a chat turn.; SKU 4 remains a single … | TC-EDIT-014 (E2E/Medium) |
| DC-015 | Via Hero modal: unassign SKU 3 from Hero -> Hero = {5,6} | Modal closes on confirm.; The 'Hero SKU' indicator on SKU 3 in the Measurement table is removed in real time.; Hero count decreases to 2; SKU 3 remains a Measu… | TC-EDIT-015 (E2E/Medium) |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "sourceCaseId": "TC-EDIT-001",
      "title": "\"Edit SKU list\" button visible under the Measurement SKU table",
      "technique": [
        "Positive"
      ],
      "preconditions": [
        "User authenticated in Nectar AI Media Planner chat",
        "A media plan in progress with at least one Measurement SKU resolved and the Measurement SKU table rendered"
      ],
      "testData": [
        "Measurement SKUs = {12345, 234235}"
      ],
      "steps": [
        "1. Send a chat prompt that resolves a media plan containing Measurement SKUs (e.g. 'skus 12345, 234235').",
        "2. Wait for the assistant turn to complete (30-60s) and the Measurement SKU table to render.",
        "3. Locate the area directly below the Measurement SKU table."
      ],
      "expectedText": [
        "The Measurement SKU table is displayed listing SKUs 12345 and 234235.",
        "An 'Edit SKU list' button is visible directly under the Measurement SKU table.",
        "The button is enabled and clickable."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-EDIT-001 UI/Critical"
  },
  {
    "caseId": "DC-002",
    "inputs": {
      "sourceCaseId": "TC-EDIT-002",
      "title": "Measurement-table \"Edit SKU list\" button opens the Measurement edit modal",
      "technique": [
        "Positive"
      ],
      "preconditions": [
        "Media plan in progress with Measurement SKU table rendered (per EDIT-001)"
      ],
      "testData": [
        "Measurement SKUs = {12345, 234235}"
      ],
      "steps": [
        "1. With the Measurement SKU table rendered, click the 'Edit SKU list' button beneath it.",
        "2. Observe the modal that opens."
      ],
      "expectedText": [
        "A modal opens scoped to editing the Measurement SKU list (the Measurement edit modal), NOT the Hero modal.",
        "The modal lists the current Measurement SKUs {12345, 234235} as editable/selectable entries.",
        "The modal exposes confirm and cancel controls."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-EDIT-002 E2E/Critical"
  },
  {
    "caseId": "DC-003",
    "inputs": {
      "sourceCaseId": "TC-EDIT-003",
      "title": "Confirming Measurement modal edits reflects changes immediately in the table and counts",
      "technique": [
        "Positive",
        "State-Recompute",
        "Data-Persistence"
      ],
      "preconditions": [
        "Measurement edit modal open (per EDIT-002) with Measurement SKUs {12345, 234235}"
      ],
      "testData": [
        "Start Measurement = {12345, 234235}; add SKU 99999 -> end {12345, 234235, 99999}"
      ],
      "steps": [
        "1. In the open Measurement edit modal, add SKU 99999 to the selection.",
        "2. Click the confirm/save control in the modal.",
        "3. Observe the Measurement SKU table and the summary panel Measurement count."
      ],
      "expectedText": [
        "The modal closes on confirm.",
        "The Measurement SKU table now lists {12345, 234235, 99999} (change reflected immediately, no extra assistant turn required).",
        "The Measurement SKU count in the summary panel updates to 3."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-EDIT-003 E2E/Critical"
  },
  {
    "caseId": "DC-004",
    "inputs": {
      "sourceCaseId": "TC-EDIT-004",
      "title": "Cancelling the Measurement edit modal leaves the table unchanged",
      "technique": [
        "Negative",
        "State-Recompute"
      ],
      "preconditions": [
        "Measurement edit modal open (per EDIT-002) with Measurement SKUs {12345, 234235}"
      ],
      "testData": [
        "Measurement = {12345, 234235}; attempt to add 99999 then cancel"
      ],
      "steps": [
        "1. In the open Measurement edit modal, add SKU 99999 to the selection (do not confirm).",
        "2. Click the cancel control (or dismiss the modal).",
        "3. Observe the Measurement SKU table and summary count."
      ],
      "expectedText": [
        "The modal closes without applying changes.",
        "The Measurement SKU table still lists exactly {12345, 234235}; 99999 is NOT added.",
        "The summary Measurement count is unchanged (= 2)."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-EDIT-004 E2E/High"
  },
  {
    "caseId": "DC-005",
    "inputs": {
      "sourceCaseId": "TC-EDIT-005",
      "title": "\"Edit SKU list\" button visible under the Hero SKU table and opens the Hero edit modal",
      "technique": [
        "Positive"
      ],
      "preconditions": [
        "Media plan in progress with at least one Hero SKU assigned and the Hero SKU table rendered"
      ],
      "testData": [
        "Measurement SKUs = {1,2,3,4}; Hero SKUs = {3,5,6}"
      ],
      "steps": [
        "1. Send a prompt establishing Measurement and Hero SKUs (e.g. '1, 2, 3, 4 and hero skus 3, 5, 6').",
        "2. Wait for the assistant turn to complete and the Hero SKU table to render.",
        "3. Verify an 'Edit SKU list' button is visible directly under the Hero SKU table.",
        "4. Click the Hero-table 'Edit SKU list' button.",
        "5. Observe the modal that opens."
      ],
      "expectedText": [
        "The 'Edit SKU list' button is visible and enabled directly under the Hero SKU table.",
        "Clicking it opens the Hero edit modal (scoped to Hero SKUs), NOT the Measurement modal.",
        "The Hero edit modal lists current Hero SKUs {3,5,6} and offers confirm/cancel controls."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-EDIT-005 E2E/Critical"
  },
  {
    "caseId": "DC-006",
    "inputs": {
      "sourceCaseId": "TC-EDIT-006",
      "title": "Confirming Hero modal edits reflects changes immediately; auto-add grows Measurement count",
      "technique": [
        "Positive",
        "State-Recompute",
        "Cross-Field"
      ],
      "preconditions": [
        "Hero edit modal open (per EDIT-005); Measurement = {1,2,3,4}, Hero = {3,5,6}"
      ],
      "testData": [
        "Add Hero SKU 7 (a non-Measurement, brand-linked SKU) -> Hero = {3,5,6,7}; Measurement auto-grows to {1,2,3,4,5,6,7}"
      ],
      "steps": [
        "1. In the open Hero edit modal, assign SKU 7 (a brand-linked SKU not currently in Measurement) as Hero.",
        "2. Click confirm/save.",
        "3. Observe the Hero SKU table, the Measurement SKU table, and the summary counts."
      ],
      "expectedText": [
        "Modal closes on confirm.",
        "The Hero SKU table now lists {3,5,6,7} immediately.",
        "Per the AUTO-ADD rule, non-Measurement Hero SKU 7 is auto-added to Measurement; the Measurement table/count grows to include 7 (Measurement count = 7).",
        "Summary panel reflects updated Hero count (4) and Measurement count (7)."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-EDIT-006 E2E/High"
  },
  {
    "caseId": "DC-007",
    "inputs": {
      "sourceCaseId": "TC-EDIT-007",
      "title": "Cancelling the Hero edit modal leaves Hero and Measurement tables unchanged",
      "technique": [
        "Negative",
        "State-Recompute"
      ],
      "preconditions": [
        "Hero edit modal open (per EDIT-005); Measurement = {1,2,3,4}, Hero = {3,5,6}"
      ],
      "testData": [
        "Attempt to add Hero SKU 7 then cancel"
      ],
      "steps": [
        "1. In the open Hero edit modal, assign SKU 7 as Hero (do not confirm).",
        "2. Click cancel / dismiss the modal.",
        "3. Observe the Hero and Measurement tables and summary counts."
      ],
      "expectedText": [
        "Modal closes without applying changes.",
        "Hero SKU table still lists exactly {3,5,6}; SKU 7 is NOT added.",
        "Measurement table is unchanged at {1,2,3,4} (no auto-add of 7 since the Hero change was discarded).",
        "Summary counts unchanged: Hero=3, Measurement=4."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-EDIT-007 E2E/High"
  },
  {
    "caseId": "DC-008",
    "inputs": {
      "sourceCaseId": "TC-EDIT-008",
      "title": "\"Edit SKU list\" button visible under the single-prompt summary table and opens its modal",
      "technique": [
        "Positive"
      ],
      "preconditions": [
        "Single-prompt flow used: Measurement + Hero SKUs supplied in one chat prompt and a summary table is rendered"
      ],
      "testData": [
        "Prompt '1, 2, 3, 4 and hero skus 3, 5, 6' -> Measurement = {1,2,3,4,5,6}, Hero = {3,5,6}"
      ],
      "steps": [
        "1. Send a single prompt combining Measurement and Hero SKUs (e.g. '1, 2, 3, 4 and hero skus 3, 5, 6').",
        "2. Wait for the assistant turn to complete and the single-prompt summary table to render.",
        "3. Verify an 'Edit SKU list' button is visible directly under the summary table.",
        "4. Click the summary-table 'Edit SKU list' button and observe the modal."
      ],
      "expectedText": [
        "The single-prompt summary table renders showing Measurement SKUs {1,2,3,4,5,6} and Hero SKUs {3,5,6}.",
        "An 'Edit SKU list' button is visible and enabled under the summary table.",
        "Clicking it opens the edit modal for the summary-flow SKUs (confirm/cancel controls present)."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-EDIT-008 E2E/Critical"
  },
  {
    "caseId": "DC-009",
    "inputs": {
      "sourceCaseId": "TC-EDIT-009",
      "title": "Confirming edits in the single-prompt summary modal reflects changes immediately in the summary table",
      "technique": [
        "Positive",
        "State-Recompute",
        "Data-Persistence"
      ],
      "preconditions": [
        "Single-prompt summary edit modal open (per EDIT-008); Measurement = {1,2,3,4,5,6}, Hero = {3,5,6}"
      ],
      "testData": [
        "Add Hero SKU 7 (non-Measurement) -> Hero = {3,5,6,7}; Measurement auto-grows to include 7"
      ],
      "steps": [
        "1. In the open summary edit modal, assign SKU 7 as Hero.",
        "2. Click confirm/save.",
        "3. Observe the single-prompt summary table and counts."
      ],
      "expectedText": [
        "Modal closes on confirm.",
        "The summary table updates immediately: Hero SKUs now {3,5,6,7}.",
        "Non-Measurement Hero 7 is auto-added to Measurement; Measurement set/count grows to include 7 (count = 7).",
        "Counts in the summary reflect Hero=4, Measurement=7."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-EDIT-009 E2E/High"
  },
  {
    "caseId": "DC-010",
    "inputs": {
      "sourceCaseId": "TC-EDIT-010",
      "title": "Cancelling the single-prompt summary modal leaves the summary table unchanged",
      "technique": [
        "Negative",
        "State-Recompute"
      ],
      "preconditions": [
        "Single-prompt summary edit modal open (per EDIT-008); Measurement = {1,2,3,4,5,6}, Hero = {3,5,6}"
      ],
      "testData": [
        "Attempt to add Hero SKU 7 then cancel"
      ],
      "steps": [
        "1. In the open summary edit modal, assign SKU 7 as Hero (do not confirm).",
        "2. Click cancel / dismiss.",
        "3. Observe the summary table and counts."
      ],
      "expectedText": [
        "Modal closes without applying changes.",
        "Summary table unchanged: Measurement = {1,2,3,4,5,6}, Hero = {3,5,6}.",
        "No auto-add of 7; counts unchanged (Hero=3, Measurement=6)."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-EDIT-010 E2E/Medium"
  },
  {
    "caseId": "DC-011",
    "inputs": {
      "sourceCaseId": "TC-EDIT-011",
      "title": "\"Edit SKU list\" buttons are not present before any SKUs are selected",
      "technique": [
        "Edge-Case",
        "Negative"
      ],
      "preconditions": [
        "Fresh Nectar AI chat session with no media plan started and no SKUs resolved (no Measurement/Hero/summary tables rendered)"
      ],
      "testData": [
        "No SKUs selected"
      ],
      "steps": [
        "1. Open a new Nectar AI chat without sending any SKU-defining prompt.",
        "2. Inspect the chat surface for any Measurement, Hero, or summary SKU table and any 'Edit SKU list' button."
      ],
      "expectedText": [
        "No Measurement SKU table, Hero SKU table, or summary table is rendered.",
        "No 'Edit SKU list' button is visible anywhere (the button is bound to the presence of its table)."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-EDIT-011 UI/High"
  },
  {
    "caseId": "DC-012",
    "inputs": {
      "sourceCaseId": "TC-EDIT-012",
      "title": "Summary-table \"Edit SKU list\" button appears only in single-prompt flow, not in multi-turn flow",
      "technique": [
        "Decision-Table",
        "Negative",
        "Edge-Case"
      ],
      "preconditions": [
        "Two comparable plans: (A) built via single-prompt combined input; (B) built via multi-turn where Measurement and Hero are defined in separate turns"
      ],
      "testData": [
        "Flow A single prompt: '1, 2, 3, 4 and hero skus 3, 5, 6'",
        "Flow B multi-turn: first 'skus 1,2,3,4', then later 'hero skus 3,5,6'"
      ],
      "steps": [
        "1. Build plan A via the single combined prompt; confirm a summary table renders.",
        "2. Verify the summary table has an 'Edit SKU list' button under it.",
        "3. In a separate session, build plan B across multiple turns (Measurement first, Hero later) producing separate Measurement and Hero tables (no single-prompt summary table).",
        "4. Inspect plan B for a summary table and its 'Edit SKU list' button."
      ],
      "expectedText": [
        "Flow A: a single-prompt summary table is rendered WITH an 'Edit SKU list' button under it.",
        "Flow B: no single-prompt summary table is rendered, so the summary-table 'Edit SKU list' button is absent; the Measurement-table and Hero-table 'Edit SKU list' buttons remain available per their tables.",
        "The summary-table button is exclusive to the single-prompt flow."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-EDIT-012 E2E/High"
  },
  {
    "caseId": "DC-013",
    "inputs": {
      "sourceCaseId": "TC-EDIT-013",
      "title": "Each table's \"Edit SKU list\" button opens only its own modal (modal-to-table correctness)",
      "technique": [
        "Decision-Table",
        "Cross-Field"
      ],
      "preconditions": [
        "A multi-turn plan rendering BOTH a Measurement SKU table and a Hero SKU table simultaneously"
      ],
      "testData": [
        "Measurement = {1,2,3,4}; Hero = {3,5,6}"
      ],
      "steps": [
        "1. Build a plan that renders both Measurement and Hero tables.",
        "2. Click the Measurement-table 'Edit SKU list' button; record which modal opens; close it.",
        "3. Click the Hero-table 'Edit SKU list' button; record which modal opens; close it."
      ],
      "expectedText": [
        "Measurement-table button opens the Measurement edit modal (lists Measurement SKUs {1,2,3,4}).",
        "Hero-table button opens the Hero edit modal (lists Hero SKUs {3,5,6}).",
        "Neither button cross-opens the other table's modal."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-EDIT-013 Integration/High"
  },
  {
    "caseId": "DC-014",
    "inputs": {
      "sourceCaseId": "TC-EDIT-014",
      "title": "Editing Hero via the Hero modal updates the \"Hero SKU\" indicator in the Measurement table in real time",
      "technique": [
        "State-Recompute",
        "Cross-Field"
      ],
      "preconditions": [
        "Plan rendering both Measurement and Hero tables; Measurement = {1,2,3,4}, Hero = {3}"
      ],
      "testData": [
        "Via Hero modal: assign SKU 4 as Hero (4 already in Measurement) -> Hero = {3,4}"
      ],
      "steps": [
        "1. Open the Hero edit modal via its table's 'Edit SKU list' button.",
        "2. Assign SKU 4 (already a Measurement SKU) as Hero and confirm.",
        "3. Observe the 'Hero SKU' indicator next to SKU 4 in the Measurement SKU table."
      ],
      "expectedText": [
        "Modal closes on confirm.",
        "SKU 4 in the Measurement table now shows the 'Hero SKU' indicator, updated in real time without a chat turn.",
        "SKU 4 remains a single Measurement entry (no duplicate) now marked Hero; Hero count = 2."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-EDIT-014 E2E/Medium"
  },
  {
    "caseId": "DC-015",
    "inputs": {
      "sourceCaseId": "TC-EDIT-015",
      "title": "Unassigning a Hero SKU via the Hero modal removes its \"Hero SKU\" indicator and is_hero in real time",
      "technique": [
        "State-Recompute",
        "Cross-Field",
        "Data-Persistence"
      ],
      "preconditions": [
        "Plan with Measurement = {1,2,3,4}, Hero = {3,5,6}; both tables and indicators rendered"
      ],
      "testData": [
        "Via Hero modal: unassign SKU 3 from Hero -> Hero = {5,6}"
      ],
      "steps": [
        "1. Open the Hero edit modal via its 'Edit SKU list' button.",
        "2. Unassign SKU 3 from Hero and confirm.",
        "3. Observe the Measurement table indicator for SKU 3 and the Hero count."
      ],
      "expectedText": [
        "Modal closes on confirm.",
        "The 'Hero SKU' indicator on SKU 3 in the Measurement table is removed in real time.",
        "Hero count decreases to 2; SKU 3 remains a Measurement SKU (still listed) but no longer marked Hero.",
        "is_hero flag for SKU 3 is set False once it is no longer used as Hero by any channel (per NUP-19140 sync)."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-EDIT-015 E2E/Medium"
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| advertiser | N360_Unilever_MS | Non-production advertiser (data/media-planner.ts) |
| brand | Unilever \| Knorr \| MS | Non-production brand |
| dataManager | fixtures/test-data-manager.ts | API helpers to seed channel/SKU preconditions |
| salientCopy | Edit SKU list | Salient strings the generated tests must assert |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | Live Pollen development environment drives the guided Nectar AI flow end to end | [] |

## Mocks as JSON

```json
[]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Launch the Nectar AI guided planner | /planning | Help me build a plan based on my objective & budget | The guided flow is active | guided flow control is visible |
| 2 | AC-002 | Seed a channel with the case SKU selection via API | dataManager.setPlanHeroSkus | plan; channel; case SKUs | The channel has the case-defined SKU selection | precondition helper resolves without error |
| 3 | AC-003 | Select advertiser and brand | Guided planner controls | advertiser; brand; Confirm | Advertiser and brand are shown on the summary panel | advertiser and brand visible on summary |
| 4 | AC-004 | Inspect the channel for the "Edit SKU list" button | Summary panel channel row | channel | The button visibility matches the channel SKU state | button visibility matches the case |
| 5 | AC-005 | Open the "Edit SKU list" modal when present | Channel row; Edit SKU list | Edit SKU list | The modal shows the current selection and counts | modal is visible with accurate counts |
| 6 | AC-006 | Verify modal counts and cancel behaviour | Edit SKU modal | Cancel | The modal selected count equals the channel selection and cancelling leaves it unchanged | counts and cancel behaviour match the case |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | A channel with no editable SKUs is inspected for the "Edit SKU list" button | The button is not shown |
| NEG-002 | The "Edit SKU list" modal is cancelled after toggling a SKU | The channel SKU selection is unchanged |

## Acceptance Criteria

- AC-001: The guided flow is active
- AC-002: The channel has the case-defined SKU selection
- AC-003: Advertiser and brand are shown on the summary panel
- AC-004: The button visibility matches the channel SKU state
- AC-005: The modal shows the current selection and counts
- AC-006: The modal selected count equals the channel selection and cancelling leaves it unchanged

## Locator Hints

- Prefer role/name and data-testid locators owned by PlanningPage / NectarFlow page objects.
- Use exact visible text for warning copy (e.g. "Edit SKU list") and summary panel values.
- Use CSS only with an explicit `// locator-policy:exception <reason>` comment directly above the locator call.

## Generated Test Requirements

- Must import from fixtures/test and use Page Objects / Component Objects for all locators.
- Generation Mode is suite: generate one focused test per Data Case (DC-###), each enumerating its DC id in the title.
- Across the suite, every AC id (AC-001, AC-002, AC-003, AC-004, AC-005, AC-006) must be covered by at least one test.
- Seed preconditions via the `dataManager` fixture (fixtures/test-data-manager.ts); do not configure data through the admin UI.
- Put `expect(...)` only in the final assertion step of each test; title it `Assert AC-###: ...`.
- Must assert the salient expected values "Edit SKU list".
- Must not use page.waitForTimeout, networkidle, XPath, test.only, or any form of skip; must not use real credentials or commit auth state.

## Notes

- This suite targets the live Pollen development environment; `Parallel Safe` is `no` and `Data Isolation` is `external`.
- The 15 Data Cases are transformed from specs/test-cases-skus-2.yaml (area: Edit SKU list button visibility and modal); each carries its source case id in notes for traceability.
- Several cases depend on test-data management helpers that are not yet implemented (see fixtures/test-data-manager.ts `MISSING_TEST_DATA_FUNCTIONS`); those tests will fail loudly until the helpers are wired.
- AUTHORING CAVEAT: authored without a live DOM-discovery snapshot. Run `npm run ai:dom:discover` against `/planning` and heal locators before treating generated tests as green.
