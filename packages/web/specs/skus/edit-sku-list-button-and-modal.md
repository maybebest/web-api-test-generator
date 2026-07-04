# Flow: Edit SKU list button visibility and modal

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-SKU-EDIT |
| Spec Version | 2.0.0 |
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
So that Hero/Measurement SKU selections behave deterministically (4 of the 15 documented cases are automated end-to-end today; the rest are enumerated under Pending Automation).

## Preconditions

- A valid non-production authenticated Playwright storage state (`playwright/.auth/user.json`).
- `PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.pollen.js-devops.co.uk/`.
- A plan with at least one channel and a known SKU selection is available.
- The channel SKU selection can be seeded via the implemented dataManager.setPlanHeroSkus (planningAI_updateState SET_SKUS).

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
| RULE-001 | Hero SKUs are a subset of the selected SKU set | heroCount = \|isHero:true\|; measurementCount = \|selected\| | A SKU listed as both Hero and Measurement stays Hero |
| RULE-002 | Summary counters recompute from the seeded session state | counter text = "<n> SKUs"; an empty counter renders "To be defined" | A counter that does not reflect the seeded state is a defect |
| RULE-003 | SKU edit controls render only when a selection exists | visible(editControl) == selection.length > 0 | An edit control on an empty selection (or a missing one on a non-empty selection) is a defect |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | hero=[]; measurement=[7096764, 7304367] (pool: persil) | Measurement counter shows 2 SKUs | TC-EDIT-002 (E2E/Critical) |
| DC-002 | hero=[]; measurement=[7096764, 7304367] (pool: persil) | Measurement counter shows 2 SKUs | TC-EDIT-004 (E2E/High) |
| DC-003 | hero=[7096764, 7304367]; measurement=[7096764, 7304367] (pool: persil) | Hero counter shows 2 SKUs | TC-EDIT-014 (E2E/Medium) |
| DC-004 | hero=[7096764, 7304367]; measurement=[] (pool: persil) | Hero counter shows 2 SKUs | TC-EDIT-015 (E2E/Medium) |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
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
    "caseId": "DC-002",
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
    "caseId": "DC-003",
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
    "caseId": "DC-004",
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
| dataManager | fixtures/test-data-manager.ts | API helpers to seed session/SKU preconditions |
| skuPool | specs/skus/.sku-pools.json | Real catalogue SKU ids the seeds use (live-probed) |
| salientCopy | SKUs, To be defined | Salient strings the generated tests must assert |

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
| 1 | AC-001 | Enter the Nectar AI planner | /planning -> Try now | n/a | The guided objective-and-budget flow is reachable | guided flow control is visible |
| 2 | AC-002 | Open a seeded planning session directly | dataManager.ensurePlanningSession; /planning/nectar-ai/<sessionId> | live planningAI session | The seeded session hydrates to its summary panel | summary panel is visible |
| 3 | AC-003 | Verify the Hero counter against a known seed | Summary panel Hero row | two Hero SKUs from the real catalogue pool | The Hero SKUs counter equals the seeded Hero count | Hero counter shows the seeded count |
| 4 | AC-004 | Verify the per-case seeded counters | Summary panel Hero/Measurement rows | case SKU sets (real catalogue ids) | The Hero/Measurement counter equals the case expected value; an empty counter renders To be defined | counters match the data case |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | Clear the session SKU selection via API and open the session | The "open modal Measurement SKUs" edit control is absent for an empty selection |

## Acceptance Criteria

- AC-001: The guided objective-and-budget flow is reachable
- AC-002: The seeded session hydrates to its summary panel
- AC-003: The Hero SKUs counter equals the seeded Hero count
- AC-004: The Hero/Measurement counter equals the case expected value; an empty counter renders To be defined

## Locator Hints

- Prefer role/name and data-testid locators owned by PlanningPage / NectarFlow page objects.
- Use exact visible text for counter copy (e.g. "SKUs") and summary panel values.
- Use CSS only with an explicit `// locator-policy:exception <reason>` comment directly above the locator call.

## Generated Test Requirements

- Must import from fixtures/test and use Page Objects / Component Objects for all locators.
- Generation Mode is suite: generate one focused test per Data Case (DC-###), each enumerating its DC id in the title.
- Across the suite, every AC id (AC-001, AC-002, AC-003, AC-004) must be covered by at least one test.
- Seed preconditions via the `dataManager` fixture (fixtures/test-data-manager.ts); do not configure data through the admin UI.
- Put `expect(...)` only in the final assertion step of each test; title it `Assert AC-###: ...`.
- Must assert the salient expected values "SKUs", "To be defined".
- Must not use page.waitForTimeout, networkidle, XPath, test.only, or any form of skip; must not use real credentials or commit auth state.

## Notes

- This suite targets the live Pollen development environment; `Parallel Safe` is `no` and `Data Isolation` is `external`.
- E2E-only policy: every Data Case row above maps to an emitted, executable end-to-end test (API seed of REAL catalogue SKUs -> direct seeded-session navigation -> live UI assertion). Source cases that cannot be verified end-to-end today are enumerated under Pending Automation with their blockers — no weak panel-smoke or guaranteed-red placeholder tests are generated for them.
- Source: specs/test-cases-skus-2.yaml (area: Edit SKU list button visibility and modal); every row keeps its source case id for traceability.
- Locators were live-audited (2026-07-02/03) against the dev environment; the seed/hydrate/assert pipeline is live-proven.

## Pending Automation (no test emitted)

These 11 source cases are E2E-specified but cannot be verified end-to-end today. They are intentionally NOT generated — the framework ships only executable E2E tests.

| Source Case | Blocker |
|---|---|
| TC-EDIT-001 — "Edit SKU list" button visible under the Measurement SKU table | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-EDIT-003 — Confirming Measurement modal edits reflects changes immediately in the table and counts | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-EDIT-005 — "Edit SKU list" button visible under the Hero SKU table and opens the Hero edit modal | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-EDIT-006 — Confirming Hero modal edits reflects changes immediately; auto-add grows Measurement count | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-EDIT-007 — Cancelling the Hero edit modal leaves Hero and Measurement tables unchanged | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-EDIT-008 — "Edit SKU list" button visible under the single-prompt summary table and opens its modal | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-EDIT-009 — Confirming edits in the single-prompt summary modal reflects changes immediately in the summary table | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-EDIT-010 — Cancelling the single-prompt summary modal leaves the summary table unchanged | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-EDIT-011 — "Edit SKU list" buttons are not present before any SKUs are selected | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-EDIT-012 — Summary-table "Edit SKU list" button appears only in single-prompt flow, not in multi-turn flow | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-EDIT-013 — Each table's "Edit SKU list" button opens only its own modal (modal-to-table correctness) | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
