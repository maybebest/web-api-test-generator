# Flow: Channel-level Hero edit, per-channel SKU definition and deletion sync

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-SKU-CHAN |
| Spec Version | 2.0.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/skus/channel-level-hero-edit-and-deletion-sync.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @channel-level-hero-edit-and-deletion-sync |
| Generation Mode | suite |
| Review Status | human-reviewed |
| Generation Source | manual-test-case |
| Generation Status | generated |

## User Story

As a media planner,
I want the Nectar AI planner to enforce channel-level hero edit, per-channel sku definition and deletion sync correctly,
So that Hero/Measurement SKU selections behave deterministically (7 of the 30 documented cases are automated end-to-end today; the rest are enumerated under Pending Automation).

## Preconditions

- A valid non-production authenticated Playwright storage state (`playwright/.auth/user.json`).
- `PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.pollen.js-devops.co.uk/`.
- A plan with at least two channels and per-channel Hero selections is available.
- Per-channel Hero edit/delete is exercised via the UI; seeding uses the implemented dataManager.setPlanHeroSkus (deletion-sync catalogue arrange still needs the missing unlinkSkuFromBrand).

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
| DC-001 | hero=[7096764, 7304367, 7759164]; measurement=[] (pool: persil) | Hero counter shows 3 SKUs | TC-CHAN-001 (E2E/Critical) |
| DC-002 | hero=[7096764, 7304367]; measurement=[] (pool: persil) | Hero counter shows 2 SKUs | TC-CHAN-002 (UI/High) |
| DC-003 | hero=[7096764, 7304367, 7759164]; measurement=[] (pool: persil) | Hero counter shows 3 SKUs | TC-CHAN-004 (Integration/High) |
| DC-004 | hero=[7096764, 7304367]; measurement=[] (pool: persil) | Hero counter shows 2 SKUs | TC-CHAN-005 (E2E/High) |
| DC-005 | hero=[7096764, 7304367]; measurement=[] (pool: persil) | Hero counter shows 2 SKUs | TC-CHAN-007 (Integration/Critical) |
| DC-006 | hero=[7096764, 7304367]; measurement=[] (pool: persil) | Hero counter shows 2 SKUs | TC-CHAN-008 (Integration/High) |
| DC-007 | hero=[7096764, 7304367]; measurement=[] (pool: persil) | Hero counter shows 2 SKUs | TC-CHAN-028 (E2E/High) |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "sourceCaseId": "TC-CHAN-001",
      "title": "Edit Hero SKUs for a specific channel via channel modal — changes isolated to that channel only",
      "technique": [
        "Positive",
        "State-Recompute",
        "Cross-Field"
      ],
      "preconditions": [
        "Logged into Nectar AI Media Planner with a brand selected",
        "A media plan exists in chat with global Hero SKUs assigned (e.g. {1001,1002,1003}) which pre-populate every selected channel",
        "At least two channels selected: offSite (Meta) and onSite"
      ],
      "testData": [
        "Global Hero SKUs: 1001,1002,1003",
        "Channels: offSite (Meta), onSite",
        "Edit on offSite only: remove 1003, add 1004"
      ],
      "steps": [
        "1. Open the offSite (Meta) channel edit modal from the summary panel",
        "2. Confirm the Hero SKU selection is pre-populated with the global Hero list {1001,1002,1003}",
        "3. Deselect 1003 and select 1004 within the offSite modal",
        "4. Save/confirm the offSite modal",
        "5. Open the onSite channel edit modal and inspect its Hero selection"
      ],
      "expectedText": [
        "offSite modal opens pre-populated with global Hero SKUs {1001,1002,1003}",
        "After save, offSite channel Hero SKUs = {1001,1002,1004}",
        "onSite channel Hero SKUs remain the original global set {1001,1002,1003} — the offSite edit did NOT affect onSite",
        "Summary panel reflects per-channel Hero counts independently"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-001 E2E/Critical"
  },
  {
    "caseId": "DC-002",
    "inputs": {
      "sourceCaseId": "TC-CHAN-002",
      "title": "Channel modal Hero selection is pre-populated with the current global Hero list on open",
      "technique": [
        "Positive",
        "Data-Persistence"
      ],
      "preconditions": [
        "Media plan with global Hero SKUs {2001,2002} assigned",
        "Channel offSite (Meta) selected, no per-channel edit yet"
      ],
      "testData": [
        "Global Hero SKUs: 2001,2002",
        "Channel: offSite (Meta)"
      ],
      "steps": [
        "1. Open the offSite (Meta) channel edit modal",
        "2. Inspect the pre-selected Hero SKUs in the modal"
      ],
      "expectedText": [
        "Modal shows Hero SKUs {2001,2002} pre-selected (mirrors the global Hero list)",
        "No additional or missing SKUs versus the global Hero list"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-002 UI/High"
  },
  {
    "caseId": "DC-003",
    "inputs": {
      "sourceCaseId": "TC-CHAN-004",
      "title": "No SKUs defined for a channel — all global Hero SKUs are assigned to that channel",
      "technique": [
        "Positive",
        "Equivalence-Partition"
      ],
      "preconditions": [
        "Media plan with global Hero SKUs {3001,3002,3003} assigned"
      ],
      "testData": [
        "Global Hero SKUs: 3001,3002,3003",
        "Prompt: \"offSite: Meta, 40k, 20-25/03/2026\" (no skus clause)"
      ],
      "steps": [
        "1. Send a channel prompt with NO skus clause: offSite: Meta, 40k, 20-25/03/2026",
        "2. Wait for resolver + SKU-processing node",
        "3. Inspect the offSite (Meta) channel's assigned SKUs"
      ],
      "expectedText": [
        "The SKU-processing node detects no user-defined SKUs for the channel",
        "All global Hero SKUs {3001,3002,3003} are assigned to the offSite channel"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-004 Integration/High"
  },
  {
    "caseId": "DC-004",
    "inputs": {
      "sourceCaseId": "TC-CHAN-005",
      "title": "Define SKUs for one channel but not another in the same flow — mixed per-channel assignment",
      "technique": [
        "Decision-Table",
        "Cross-Field",
        "Edge-Case"
      ],
      "preconditions": [
        "Media plan with global Hero SKUs {4001,4002} assigned"
      ],
      "testData": [
        "Global Hero SKUs: 4001,4002",
        "Channel A prompt: offSite: Meta, 40k, 20-25/03/2026, skus 9001, 9002",
        "Channel B prompt: onSite, 30k, 20-25/03/2026 (no skus clause)"
      ],
      "steps": [
        "1. Define channel A with explicit SKUs: offSite: Meta, 40k, 20-25/03/2026, skus 9001, 9002",
        "2. Define channel B with no skus clause: onSite, 30k, 20-25/03/2026",
        "3. Wait for processing",
        "4. Inspect SKUs assigned to channel A and channel B"
      ],
      "expectedText": [
        "Channel A (offSite/Meta) assigned SKUs = {9001,9002} (user-defined only)",
        "Channel B (onSite) assigned SKUs = global Hero set {4001,4002} (defaulted because none defined)",
        "The two channels are assigned independently per the SKU-processing node logic"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-005 E2E/High"
  },
  {
    "caseId": "DC-005",
    "inputs": {
      "sourceCaseId": "TC-CHAN-007",
      "title": "Deleting a channel whose Hero SKU is not used by any other channel sets is_hero=False and drops unique Hero count",
      "technique": [
        "State-Recompute",
        "Edge-Case",
        "Data-Persistence"
      ],
      "preconditions": [
        "Two channels: offSite (Meta) with Hero {6001,6002}; onSite with Hero {6001}",
        "SKU 6002 is Hero ONLY on offSite (unique); SKU 6001 is Hero on both (shared)",
        "StateData.campaign_skus: 6001 is_hero=True, 6002 is_hero=True"
      ],
      "testData": [
        "offSite Hero: 6001,6002",
        "onSite Hero: 6001",
        "Unique Hero SKU on offSite only: 6002",
        "Delete channel: offSite (Meta)"
      ],
      "steps": [
        "1. Capture the current unique Hero count across channels = |{6001,6002}| = 2",
        "2. Delete the offSite (Meta) channel",
        "3. Allow the StateData update method to run on deletion",
        "4. Inspect StateData.campaign_skus is_hero flags for 6001 and 6002 and the unique Hero count"
      ],
      "expectedText": [
        "6002 no longer used as Hero by any remaining channel → StateData.campaign_skus[6002].is_hero == False",
        "6001 still Hero on onSite → StateData.campaign_skus[6001].is_hero remains True",
        "Unique Hero SKU count drops from 2 to 1 ({6001})"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-007 Integration/Critical"
  },
  {
    "caseId": "DC-006",
    "inputs": {
      "sourceCaseId": "TC-CHAN-008",
      "title": "Deleting a channel whose Hero SKUs are all shared with other channels — is_hero flags unchanged",
      "technique": [
        "State-Recompute",
        "Edge-Case"
      ],
      "preconditions": [
        "Two channels: offSite (Meta) Hero {7001,7002}; onSite Hero {7001,7002}",
        "All Hero SKUs shared between both channels"
      ],
      "testData": [
        "offSite Hero: 7001,7002",
        "onSite Hero: 7001,7002",
        "Delete channel: offSite (Meta)"
      ],
      "steps": [
        "1. Capture unique Hero count = |{7001,7002}| = 2",
        "2. Delete offSite (Meta)",
        "3. Allow update method to run",
        "4. Inspect is_hero flags for 7001 and 7002 and the unique Hero count"
      ],
      "expectedText": [
        "7001 and 7002 still used as Hero by onSite → both retain is_hero == True",
        "Unique Hero SKU count stays at 2",
        "No SKU flipped to is_hero=False because none became orphaned"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-008 Integration/High"
  },
  {
    "caseId": "DC-007",
    "inputs": {
      "sourceCaseId": "TC-CHAN-028",
      "title": "Per-channel SKU definition: channel that explicitly defines SKUs does NOT inherit global Hero, and a sibling undefined channel DOES (single mixed prompt)",
      "technique": [
        "Decision-Table",
        "Cross-Field",
        "State-Recompute"
      ],
      "preconditions": [
        "Global Hero SKUs = 5,6 assigned.",
        "A single chat message defines two channels: one with a skus clause, one without."
      ],
      "testData": [
        "Global Hero: 5,6",
        "Prompt: 'offSite: Meta, 40k, 20-25/03/2026, skus 12345, 234235; onSite, 30k, 20-25/03/2026'",
        "Meta defines skus 12345,234235; onSite defines no skus"
      ],
      "steps": [
        "1. Send the single mixed prompt defining Meta (with skus) and onSite (without).",
        "2. Wait for the resolver + SKU-processing nodes (30-60s).",
        "3. Inspect assigned SKUs for each channel."
      ],
      "expectedText": [
        "offSite Meta assigned SKUs = exactly {12345, 234235} (its defined set); global Hero 5,6 are NOT force-added to Meta.",
        "onSite assigned SKUs = global Hero set {5,6} (inherited because no skus clause).",
        "Assignment is independent per channel within the same prompt."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-028 E2E/High"
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
- Source: specs/test-cases-skus-2.yaml (area: Channel-level Hero edit, per-channel SKU definition and deletion sync); every row keeps its source case id for traceability.
- Locators were live-audited (2026-07-02/03) against the dev environment; the seed/hydrate/assert pipeline is live-proven.

## Pending Automation (no test emitted)

These 23 source cases are E2E-specified but cannot be verified end-to-end today. They are intentionally NOT generated — the framework ships only executable E2E tests.

| Source Case | Blocker |
|---|---|
| TC-CHAN-003 — Per-channel SKU definition in chat single prompt assigns the defined SKUs to that channel | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-CHAN-006 — Adding a SKU as Hero to a channel sets is_hero=True in StateData.campaign_skus | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-CHAN-009 — Modifying a channel to remove a Hero SKU re-syncs is_hero across remaining channels | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-CHAN-010 — Assign exactly max Hero SKUs to a channel (count == max) — channel added, no warning, booking allowed | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-CHAN-011 — Assign max-1 Hero SKUs to a channel (count < max) — channel added, no warning | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-CHAN-012 — Assign max+1 Hero SKUs to a channel (count > max) — channel added with all SKUs, warning shown, booking block… | warning-needs-channel: the plan has no channels; needs assignChannelToPlan (unimplemented) or the UI chat flow |
| TC-CHAN-013 — Resolve over-max by deselecting excess via modal — warning clears and booking unblocks | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-CHAN-014 — No max configured for a channel — assigning many Hero SKUs imposes no restriction | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-CHAN-015 — Global Hero list exceeds a channel's max (global-then-select-channels) — affected channel added with warning,… | warning-needs-channel: the plan has no channels; needs assignChannelToPlan (unimplemented) or the UI chat flow |
| TC-CHAN-016 — Backend: single typed channel exceeds maxHeroSkus on activation — block channel, go to ask node | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-CHAN-017 — Backend: one of multiple typed channels exceeds maxHeroSkus — block that channel, continue with other resolve… | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-CHAN-018 — Backend: channel below minHeroSkus on activation is blocked and user informed | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-CHAN-019 — Hero SKU indicator appears next to Hero SKUs in the Measurement SKUs modal/table | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-CHAN-020 — Hero SKU indicator updates in real time on assign/unassign | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-CHAN-021 — Auto-add non-Measurement Hero increments Measurement count; summary and tables reflect updated counts | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-CHAN-022 — Single-prompt parsing: Hero SKUs not already Measurement are auto-added to Measurement | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-CHAN-023 — Channel-level Hero modal displays all brand-linked SKUs (not only Measurement SKUs) | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-CHAN-024 — Assigning a non-Measurement SKU as channel Hero auto-adds it to Measurement and sets is_hero=True | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-CHAN-025 — Edit Hero on one channel does not change is_hero for a SKU still Hero on another channel | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-CHAN-026 — Per-channel defined SKUs that are non-Measurement are auto-added to Measurement (single-prompt channel defini… | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-CHAN-027 — Delete the only channel using a Hero SKU — is_hero=False and unique Hero count reaches zero | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-CHAN-029 — Channel modal Hero edit: deselecting ALL Hero SKUs for a channel that has minHeroSkus configured surfaces the… | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-CHAN-030 — Single-channel block vs multi-channel continue: side-by-side decision-table confirming routing differs only b… | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
