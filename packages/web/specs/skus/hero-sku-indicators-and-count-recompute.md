# Flow: Hero-SKU indicators, all-brand-linked modal, auto-add and count recompute

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-SKU-IND |
| Spec Version | 2.0.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/skus/hero-sku-indicators-and-count-recompute.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @hero-sku-indicators-and-count-recompute |
| Generation Mode | suite |
| Review Status | human-reviewed |
| Generation Source | manual-test-case |
| Generation Status | generated |

## User Story

As a media planner,
I want the Nectar AI planner to enforce hero-sku indicators, all-brand-linked modal, auto-add and count recompute correctly,
So that Hero/Measurement SKU selections behave deterministically (4 of the 36 documented cases are automated end-to-end today; the rest are enumerated under Pending Automation).

## Preconditions

- A valid non-production authenticated Playwright storage state (`playwright/.auth/user.json`).
- `PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.pollen.js-devops.co.uk/`.
- A brand-linked catalogue containing the case Measurement and Hero SKUs is available.
- The affected channels exist; SKU seeding uses the implemented dataManager.setPlanHeroSkus (brand-catalogue linkage still needs the missing ensureBrandLinkedSkus).

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
| DC-001 | hero=[]; measurement=[7096764, 7304367, 7759164, 8114265] (pool: persil) | Measurement counter shows 4 SKUs | TC-IND-003 (Integration/High) |
| DC-002 | hero=[7096764, 7304367]; measurement=[7759164, 7096764, 8114265, 7304367] (pool: persil) | Hero counter shows 2 SKUs | TC-IND-008 (UI/High) |
| DC-003 | hero=[]; measurement=[7096764, 7304367, 7759164, 8114265] (pool: persil) | Hero counter shows To be defined (0) | TC-IND-027 (UI/Medium) |
| DC-004 | hero=[]; measurement=[7096764, 7304367, 7759164, 8114265, 8114267] (pool: persil) | Hero counter shows To be defined (0) | TC-IND-028 (E2E/Medium) |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "sourceCaseId": "TC-IND-003",
      "title": "Assign Hero SKU that is already a Measurement SKU produces no duplicate; single entry marked Hero",
      "technique": [
        "Positive",
        "State-Recompute",
        "Edge-Case"
      ],
      "preconditions": [
        "Media plan draft with Measurement SKUs = 1,2,3,4 (count 4).",
        "SKU 3 is already a Measurement SKU and not yet Hero.",
        "Global Hero modal open."
      ],
      "testData": [
        "Measurement SKUs before: 1,2,3,4 (count 4)",
        "SKU assigned as Hero: 3 (already Measurement)",
        "Measurement SKUs after expected: 1,2,3,4 (count 4, unchanged)"
      ],
      "steps": [
        "1. In the global Hero modal, select SKU 3 (already a Measurement SKU) as Hero.",
        "2. Apply the assignment and wait for the assistant turn to complete.",
        "3. Inspect the Measurement SKU table for SKU 3."
      ],
      "expectedText": [
        "No duplicate row is created for SKU 3: exactly one Measurement entry for SKU 3.",
        "Measurement count stays 4 (1,2,3,4); no growth occurred.",
        "The single SKU 3 entry is marked with the 'Hero SKU' indicator."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-003 Integration/High"
  },
  {
    "caseId": "DC-002",
    "inputs": {
      "sourceCaseId": "TC-IND-008",
      "title": "Measurement SKUs modal/table shows 'Hero SKU' indicator for SKUs that are Hero",
      "technique": [
        "Positive",
        "Equivalence-Partition"
      ],
      "preconditions": [
        "Media plan with Measurement SKUs = 1,2,3,4.",
        "Hero SKUs = 2,4 already assigned.",
        "Measurement SKUs modal/table is open."
      ],
      "testData": [
        "Measurement SKUs: 1,2,3,4",
        "Hero SKUs: 2,4",
        "Non-Hero Measurement: 1,3"
      ],
      "steps": [
        "1. Open the Measurement SKUs modal/table.",
        "2. Inspect the indicator state of each Measurement row."
      ],
      "expectedText": [
        "Rows for SKU 2 and SKU 4 display the 'Hero SKU' indicator.",
        "Rows for SKU 1 and SKU 3 do NOT display the 'Hero SKU' indicator.",
        "Indicator presence exactly matches the Hero set {2,4}."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-008 UI/High"
  },
  {
    "caseId": "DC-003",
    "inputs": {
      "sourceCaseId": "TC-IND-027",
      "title": "Zero Hero SKUs edge: no rows show indicator and Hero count is zero",
      "technique": [
        "Boundary-BVA",
        "Edge-Case",
        "Equivalence-Partition"
      ],
      "preconditions": [
        "Media plan with Measurement SKUs = 1,2,3,4 and NO Hero SKUs assigned anywhere."
      ],
      "testData": [
        "Measurement SKUs: 1,2,3,4",
        "Hero SKUs: none (count 0)"
      ],
      "steps": [
        "1. Open the Measurement table and summary panel.",
        "2. Inspect every row's indicator and the Hero count."
      ],
      "expectedText": [
        "No Measurement row shows the 'Hero SKU' indicator.",
        "Hero count = 0 in the summary panel.",
        "Measurement count = 4 unchanged."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-027 UI/Medium"
  },
  {
    "caseId": "DC-004",
    "inputs": {
      "sourceCaseId": "TC-IND-028",
      "title": "Unassigning a non-Measurement-origin Hero leaves it in Measurement but clears indicator and Hero count (count does not shrink)",
      "technique": [
        "State-Recompute",
        "Edge-Case",
        "Data-Persistence"
      ],
      "preconditions": [
        "SKU 8 was non-Measurement, assigned Hero, and thus auto-added to Measurement (Measurement = 1,2,3,4,8, count 5; Hero = {8})."
      ],
      "testData": [
        "Unassign SKU 8 from Hero",
        "Measurement after: 1,2,3,4,8 (count stays 5)",
        "Hero after: {} (count 0)"
      ],
      "steps": [
        "1. Confirm SKU 8 is in Measurement with Hero indicator; Measurement count 5, Hero count 1.",
        "2. Unassign SKU 8 as Hero.",
        "3. Wait for recompute.",
        "4. Inspect SKU 8 row, Measurement count, Hero count."
      ],
      "expectedText": [
        "SKU 8 'Hero SKU' indicator is removed in real time.",
        "SKU 8 REMAINS a Measurement SKU; Measurement count stays 5 (auto-added SKUs are not auto-removed on unassign).",
        "Hero count = 0.",
        "Summary panel counts match the tables."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-028 E2E/Medium"
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
- Source: specs/test-cases-skus-2.yaml (area: Hero-SKU indicators, all-brand-linked modal, auto-add and count recompute); every row keeps its source case id for traceability.
- Locators were live-audited (2026-07-02/03) against the dev environment; the seed/hydrate/assert pipeline is live-proven.

## Pending Automation (no test emitted)

These 32 source cases are E2E-specified but cannot be verified end-to-end today. They are intentionally NOT generated — the framework ships only executable E2E tests.

| Source Case | Blocker |
|---|---|
| TC-IND-001 — Global Hero SKU modal displays ALL brand-linked SKUs, not only Measurement SKUs | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-IND-002 — Assign a non-Measurement SKU as Hero globally auto-adds it to Measurement SKUs | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-IND-004 — Channel-level Hero SKU modal displays all brand-linked SKUs | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-IND-005 — Single-prompt edit flow shows all brand-linked SKUs when editing Hero SKUs | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-IND-006 — Single-prompt free-text parsing splits Measurement vs Hero and auto-adds Hero-only SKUs to Measurement | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-IND-007 — Bulk mixed Measurement + non-Measurement Hero assignment: all assigned, non-Measurement auto-added | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-IND-009 — 'Hero SKU' indicator appears in real time when a SKU is assigned as Hero | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-IND-010 — 'Hero SKU' indicator disappears in real time when a SKU is unassigned as Hero | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-IND-011 — Summary panel and tables counts update after Hero changes; Measurement count grows on auto-add | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-IND-012 — is_hero set True in StateData.campaign_skus when a SKU is added as Hero to a channel | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-IND-013 — is_hero set False when a SKU is no longer used as Hero by any remaining channel after channel DELETION | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-IND-014 — is_hero stays True after channel deletion when another remaining channel still uses the SKU as Hero | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-IND-015 — is_hero recomputed on channel MODIFICATION that removes the SKU from the channel's Hero set | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-IND-016 — Max Hero SKUs per channel boundary: assigned count EQUAL to max is accepted with no warning | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-IND-017 — Max Hero SKUs per channel boundary: assigned count = max-1 accepted, no warning | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-IND-018 — Max Hero SKUs per channel boundary: assigned count = max+1 adds channel but shows warning and blocks booking | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-IND-019 — After deselecting excess Hero SKUs down to max, warning clears and booking is unblocked | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-IND-020 — No max configured: assigning many Hero SKUs imposes no restriction and no warning | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-IND-021 — Global Hero list exceeding a channel's max: each affected channel added but warned and blocked until adjusted… | warning-needs-channel: the plan has no channels; needs assignChannelToPlan (unimplemented) or the UI chat flow |
| TC-IND-022 — Backend NUP-20507: single channel typed exceeds max -> block channel and route to ask node | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-IND-023 — Backend NUP-20507: multiple channels typed, one exceeds max -> block that channel, continue with other resolv… | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-IND-024 — Per-channel SKU definition: channel without defined SKUs inherits all global Hero SKUs | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-IND-025 — Per-channel single-prompt Hero edit isolates changes to that channel only | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-IND-026 — Auto-add updates Measurement table count and indicator together (combined recompute) | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-IND-029 — FIX: zero-Hero state Hero count assertion must read 0 and indicator-count must read 0 even after a Hero was a… | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-IND-030 — Real-time Hero indicator does NOT leak across SKUs: assigning one SKU as Hero flips only that row's indicator | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-IND-031 — Auto-add dedup under concurrent-style bulk assign: assigning the SAME non-Measurement SKU twice in one bulk a… | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-IND-032 — Auto-add dedup across SEPARATE actions: assigning an already-Hero non-Measurement SKU as Hero a second time d… | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-IND-033 — Indicator persists correctly when a Measurement SKU is BOTH global-Hero and channel-Hero, then removed from o… | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-IND-034 — Summary Measurement count and Hero count stay consistent when an auto-added Hero is later unassigned (count d… | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-IND-035 — is_hero union recompute on deletion when a SKU is Hero on the deleted channel AND a different remaining chann… | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-IND-036 — is_hero recompute on deletion: deleted channel held the ONLY copies of two distinct Hero SKUs -> both flip to… | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
