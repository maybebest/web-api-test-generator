# Flow: Hero-SKU indicators, all-brand-linked modal, auto-add and count recompute

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-SKU-IND |
| Spec Version | 1.0.0 |
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
So that Hero/Measurement SKU selections and channel limits behave deterministically across the 36 documented cases.

## Preconditions

- A valid non-production authenticated Playwright storage state (`playwright/.auth/user.json`).
- `PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.pollen.js-devops.co.uk/`.
- A brand-linked catalogue containing the case Measurement and Hero SKUs is available.
- The affected channels exist (see Missing test-data functions: ensureBrandLinkedSkus, setPlanHeroSkus).

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
| RULE-001 | Selecting a Hero SKU updates the Hero and Measurement counts deterministically | heroCount and measurementCount on the summary recompute after each apply | A count that does not recompute after a change is a defect |
| RULE-002 | An all-brand-linked Hero SKU auto-adds across every affected channel and each recomputes independently | for each selectedChannel: channel.hero += brandLinkedHero; each count recomputes | A channel that does not reflect an auto-added Hero SKU is a defect |
| RULE-003 | A Hero indicator is shown only for SKUs that are flagged Hero (not Measurement-only) | indicator(sku) == sku.isHero | Showing the Hero indicator on a Measurement-only SKU is a defect |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | Measurement SKUs: 1,2,3,4; Brand-linked SKUs (full set): 1,2,3,4,5,6,7,8; Non-Measurement brand-linked SKUs: 5,6,7,8 | The modal lists every brand-linked SKU: 1,2,3,4,5,6,7,8 (8 selectable entries).; Non-Measurement brand-linked SKUs 5,6,7,8 are present and selectable (the moda… | TC-IND-001 (UI/Critical) |
| DC-002 | Measurement SKUs before: 1,2,3,4 (count 4); SKU assigned as Hero: 7 (non-Measurement, brand-linked); Measurement SKUs after expected: 1,2,3,4,7 (count 5) | SKU 7 is now a Hero SKU.; SKU 7 is auto-added to the Measurement SKU set: Measurement SKUs = 1,2,3,4,7, Measurement count = 5.; SKU 7 row in the Measurement ta… | TC-IND-002 (E2E/Critical) |
| DC-003 | Measurement SKUs before: 1,2,3,4 (count 4); SKU assigned as Hero: 3 (already Measurement); Measurement SKUs after expected: 1,2,3,4 (count 4, unchanged) | No duplicate row is created for SKU 3: exactly one Measurement entry for SKU 3.; Measurement count stays 4 (1,2,3,4); no growth occurred.; The single SKU 3 ent… | TC-IND-003 (Integration/High) |
| DC-004 | Channel: offSite Meta; Measurement SKUs: 1,2,3,4; Brand-linked SKUs: 1,2,3,4,5,6,7,8 | The channel modal lists all brand-linked SKUs 1..8 (8 entries).; Non-Measurement brand-linked SKUs 5,6,7,8 are present and selectable.; The channel modal is NO… | TC-IND-004 (UI/Critical) |
| DC-005 | Single-prompt summary present; Measurement SKUs: 1,2,3,4; Brand-linked SKUs: 1..8 | The edit modal in the single-prompt flow lists all brand-linked SKUs 1..8.; Non-Measurement SKUs 5,6,7,8 are selectable here too.; Not restricted to Measuremen… | TC-IND-005 (UI/High) |
| DC-006 | Prompt free text: '1, 2, 3, 4 and hero skus 3, 5, 6'; Expected Measurement SKUs: 1,2,3,4,5,6 (count 6); Expected Hero SKUs: 3,5,6 (count 3) | Measurement SKUs = {1,2,3,4,5,6}, count 6 (Hero-only SKUs 5,6 auto-added to Measurement).; Hero SKUs = {3,5,6}, count 3.; SKU 3 appears once (already Measureme… | TC-IND-006 (E2E/Critical) |
| DC-007 | Bulk Hero selection: 2,3 (Measurement) + 6,7 (non-Measurement); Measurement before: 1,2,3,4 (count 4); Measurement after expected: 1,2,3,4,6,7 (count 6); Hero … | All four SKUs 2,3,6,7 are assigned as Hero (Hero count 4).; Non-Measurement SKUs 6,7 auto-added to Measurement; Measurement = 1,2,3,4,6,7, count 6.; Already-Me… | TC-IND-007 (E2E/Critical) |
| DC-008 | Measurement SKUs: 1,2,3,4; Hero SKUs: 2,4; Non-Hero Measurement: 1,3 | Rows for SKU 2 and SKU 4 display the 'Hero SKU' indicator.; Rows for SKU 1 and SKU 3 do NOT display the 'Hero SKU' indicator.; Indicator presence exactly match… | TC-IND-008 (UI/High) |
| DC-009 | Target SKU: 1; Hero before: {} (1 not hero); Hero after assign: {1} | SKU 1's 'Hero SKU' indicator appears in real time after assignment (no manual refresh required).; Other rows are unaffected. | TC-IND-009 (UI/Critical) |
| DC-010 | Target SKU: 2; Hero before: {2}; Hero after unassign: {} | SKU 2's 'Hero SKU' indicator is removed in real time after unassignment.; SKU 2 remains a Measurement SKU (still listed); only the Hero indicator is cleared.; … | TC-IND-010 (UI/Critical) |
| DC-011 | Step A assign Measurement SKU 2 as Hero -> Hero count 0->1, Measurement stays 4; Step B assign non-Measurement SKU 8 as Hero -> Hero count 1->2, Measurement 4-… | After step 2: Hero count = 1, Measurement count = 4 (no growth, SKU 2 already Measurement).; After step 3: Hero count = 2, Measurement count = 5 (grew because … | TC-IND-011 (E2E/Critical) |
| DC-012 | SKU added as Hero to channel: 5; is_hero before: False; is_hero after expected: True | StateData.campaign_skus[5].is_hero == True after the channel modification.; The update method runs on channel modification and flags SKU 5 as hero. | TC-IND-012 (Integration/High) |
| DC-013 | SKU under test: 5; Channels: A=offSite Meta (hero 5), B=offSite Display (no hero 5); is_hero before delete: True; is_hero after deleting A: False | StateData.campaign_skus[5].is_hero == False after deleting Channel A (no remaining channel uses it as Hero).; campaign_skus hero flags equal the union of Hero … | TC-IND-013 (Integration/Critical) |
| DC-014 | SKU under test: 5; Channels using 5 as Hero: A and B; is_hero before delete: True; is_hero after deleting A: True (B still uses it) | StateData.campaign_skus[5].is_hero == True after deleting Channel A, because Channel B still uses SKU 5 as Hero.; Hero flags equal the union across remaining c… | TC-IND-014 (Integration/High) |
| DC-015 | SKU under test: 5; is_hero before modify: True; is_hero after modify (deselect 5 in channel modal): False | StateData.campaign_skus[5].is_hero == False after modification (no channel uses it as Hero anymore).; The update method runs on channel modification, not only … | TC-IND-015 (Integration/High) |
| DC-016 | Channel: offSite Meta, maxHeroSkus = 3 (assumed/parameterized); Hero assigned: 1,2,3 (count = max = 3) | Channel added to the summary panel with all 3 selected SKUs.; NO warning shown (count == max is within limit).; Booking/saving is NOT blocked by this channel. | TC-IND-016 (E2E/High) |
| DC-017 | maxHeroSkus = 3; Hero assigned: 1,2 (count = max-1 = 2) | Channel added with 2 SKUs.; No 'Media limit' warning.; Booking not blocked. | TC-IND-017 (E2E/Medium) |
| DC-018 | maxHeroSkus = 3; Hero assigned: 1,2,3,4 (count = max+1 = 4); Verbatim warning expected: 'Media limit: 3 Hero SKUs. Edit SKUs' | Channel IS still added to the summary panel WITH all 4 selected SKUs.; A warning is shown with EXACT text: 'Media limit: 3 Hero SKUs. Edit SKUs'.; The user is … | TC-IND-018 (E2E/Critical) |
| DC-019 | maxHeroSkus = 3; Deselect SKU 4 -> remaining Hero 1,2,3 (count = 3 = max) | The 'Media limit: 3 Hero SKUs. Edit SKUs' warning is removed.; Channel now shows 3 Hero SKUs.; Booking/saving is unblocked (control enabled). | TC-IND-019 (E2E/Critical) |
| DC-020 | Channel: offSite Display, maxHeroSkus = unset; Hero assigned: 1,2,3,4,5,6 (count 6) | Channel added with all 6 SKUs.; NO 'Media limit' warning shown (no max means no restriction).; Booking/saving NOT blocked by this channel. | TC-IND-020 (E2E/High) |
| DC-021 | Global Hero SKUs: 1,2,3,4 (count 4); Per-channel max: 3 for both channels; Verbatim warning expected per channel: 'Media limit: 3 Hero SKUs. Edit SKUs' | Each affected channel (Meta and Display) is still added with the 4 Hero SKUs.; Each shows the warning 'Media limit: 3 Hero SKUs. Edit SKUs' indicating the max … | TC-IND-021 (E2E/Critical) |
| DC-022 | Single channel typed: offSite Meta with Hero 1,2,3,4; maxHeroSkus = 3 | Adding the channel is BLOCKED (max exceeded after activation).; The user is informed of the limit.; Because only ONE channel was typed, the flow goes to the as… | TC-IND-022 (Integration/High) |
| DC-023 | Channels typed: offSite Meta (Hero 1,2,3,4 -> exceeds), offSite Display (Hero 1,2 -> within); maxHeroSkus = 3 each | offSite Meta (exceeds max) is BLOCKED from being added; user informed.; Because MORE than one channel was typed, the flow CONTINUES with the other resolver nod… | TC-IND-023 (Integration/High) |
| DC-024 | Global Hero SKUs: 5,6; Channel offSite Meta prompt: 'offSite: Meta, 40k, 20-25/03/2026, skus 12345, 234235' (defines its own SKUs); Channel offSite Display pro… | offSite Meta uses its explicitly defined SKUs (12345, 234235).; offSite Display, which had NO SKUs defined, is assigned ALL global Hero SKUs (5,6). | TC-IND-024 (E2E/High) |
| DC-025 | Edit offSite Meta: add Hero SKU 7; offSite Display Hero unchanged: 1,2 | offSite Meta Hero set = 1,2,7.; offSite Display Hero set remains 1,2 (unaffected; change isolated to Meta).; StateData.campaign_skus[7].is_hero == True (now us… | TC-IND-025 (Integration/Medium) |
| DC-026 | Assign non-Measurement SKU 8 as Hero; Measurement after: 1,2,3,4,8 (count 5); Hero after: {8} (count 1) | A new Measurement row for SKU 8 appears, carrying the 'Hero SKU' indicator.; Measurement count = 5; Hero count = 1.; Summary panel and table counts agree (both… | TC-IND-026 (E2E/High) |
| DC-027 | Measurement SKUs: 1,2,3,4; Hero SKUs: none (count 0) | No Measurement row shows the 'Hero SKU' indicator.; Hero count = 0 in the summary panel.; Measurement count = 4 unchanged. | TC-IND-027 (UI/Medium) |
| DC-028 | Unassign SKU 8 from Hero; Measurement after: 1,2,3,4,8 (count stays 5); Hero after: {} (count 0) | SKU 8 'Hero SKU' indicator is removed in real time.; SKU 8 REMAINS a Measurement SKU; Measurement count stays 5 (auto-added SKUs are not auto-removed on unassi… | TC-IND-028 (E2E/Medium) |
| DC-029 | Sequence: assign SKU 2 Hero (Hero count 1) -> unassign SKU 2 (Hero count 0); Expected end Hero count: 0; expected indicator-bearing rows: 0 | Hero count returns to 0 (not stuck at 1).; Zero Measurement rows show the 'Hero SKU' indicator.; Measurement count unchanged at 4 (SKU 2 still a Measurement SK… | TC-IND-029 (E2E/Medium) |
| DC-030 | Assign SKU 2 as Hero; Hero before: {}; Hero after: {2}; rows 1,3,4 must remain non-Hero | SKU 2 row gains the 'Hero SKU' indicator in real time.; SKUs 1, 3, 4 rows remain WITHOUT the indicator (no spurious leakage).; Hero count == 1. | TC-IND-030 (UI/Medium) |
| DC-031 | Bulk Hero selection includes SKU 7 listed/selected twice (e.g. via repeated toggle then apply); Measurement before: 1,2,3,4 (count 4); Measurement after expect… | SKU 7 is auto-added to Measurement exactly once (single row), not duplicated.; Measurement count == 5 (grew by exactly 1).; SKU 7 row carries the 'Hero SKU' in… | TC-IND-031 (Integration/Medium) |
| DC-032 | Re-assign SKU 8 as Hero (it is already Hero and already Measurement); Measurement after expected: 1,2,3,4,8 (count stays 5); Hero after expected: {8} (unchange… | No duplicate Measurement row for SKU 8 (exactly one row).; Measurement count stays 5; Hero count stays 1.; SKU 8 remains Hero-flagged; no state churn. | TC-IND-032 (Integration/Medium) |
| DC-033 | Remove SKU 2 from the GLOBAL Hero list but it remains Hero on offSite Meta channel | SKU 2 'Hero SKU' indicator REMAINS visible because it is still Hero on at least one channel (union still includes it).; is_hero for SKU 2 stays True.; Indicato… | TC-IND-033 (E2E/Medium) |
| DC-034 | Step A: assign non-Measurement 7 as Hero -> Measurement 1,2,3,4,7 (count 5), Hero {7} (1); Step B: unassign 7 -> Measurement stays 1,2,3,4,7 (count 5), Hero {}… | After A: Measurement 5, Hero 1.; After B: Measurement STAYS 5 (auto-added 7 not auto-removed), Hero 0.; After C: Measurement 6 (8 newly auto-added on top of re… | TC-IND-034 (E2E/Medium) |
| DC-035 | A Hero: 5,6; B Hero: 6; C Hero: 5; Delete A; is_hero after: 5 -> True (C uses it), 6 -> True (B uses it) | is_hero for SKU 5 stays True (channel C still uses it as Hero).; is_hero for SKU 6 stays True (channel B still uses it as Hero).; Neither indicator clears; Her… | TC-IND-035 (Integration/High) |
| DC-036 | A Hero: 5,6; B Hero: none of 5,6; Delete A; is_hero after: 5 -> False, 6 -> False (no remaining channel uses either) | is_hero for BOTH 5 and 6 == False after deletion (neither used by any remaining channel).; Unique Hero count across remaining channels == 0.; Both Measurement … | TC-IND-036 (Integration/High) |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "sourceCaseId": "TC-IND-001",
      "title": "Global Hero SKU modal displays ALL brand-linked SKUs, not only Measurement SKUs",
      "technique": [
        "Positive",
        "Equivalence-Partition"
      ],
      "preconditions": [
        "A media plan draft exists with a defined set of Measurement SKUs (e.g. 1,2,3,4).",
        "The brand is linked to a strictly larger catalogue of SKUs (e.g. brand-linked = 1,2,3,4,5,6,7,8 where 5,6,7,8 are NOT Measurement SKUs).",
        "User is in the Nectar AI chat with a global Hero SKU assignment modal reachable."
      ],
      "testData": [
        "Measurement SKUs: 1,2,3,4",
        "Brand-linked SKUs (full set): 1,2,3,4,5,6,7,8",
        "Non-Measurement brand-linked SKUs: 5,6,7,8"
      ],
      "steps": [
        "1. Open the global Hero SKU assignment modal.",
        "2. Inspect the full list of selectable SKUs offered for Hero assignment.",
        "3. Compare the offered list against the Measurement SKU set and against the brand-linked catalogue."
      ],
      "expectedText": [
        "The modal lists every brand-linked SKU: 1,2,3,4,5,6,7,8 (8 selectable entries).",
        "Non-Measurement brand-linked SKUs 5,6,7,8 are present and selectable (the modal is NOT restricted to Measurement SKUs 1,2,3,4).",
        "No brand-linked SKU is omitted; no non-brand-linked SKU appears."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-001 UI/Critical"
  },
  {
    "caseId": "DC-002",
    "inputs": {
      "sourceCaseId": "TC-IND-002",
      "title": "Assign a non-Measurement SKU as Hero globally auto-adds it to Measurement SKUs",
      "technique": [
        "Positive",
        "State-Recompute",
        "Cross-Field"
      ],
      "preconditions": [
        "Media plan draft with Measurement SKUs = 1,2,3,4 (count 4).",
        "Brand-linked catalogue includes non-Measurement SKU 7.",
        "Global Hero modal open."
      ],
      "testData": [
        "Measurement SKUs before: 1,2,3,4 (count 4)",
        "SKU assigned as Hero: 7 (non-Measurement, brand-linked)",
        "Measurement SKUs after expected: 1,2,3,4,7 (count 5)"
      ],
      "steps": [
        "1. In the global Hero modal, select SKU 7 (which is brand-linked but not a Measurement SKU) as a Hero SKU.",
        "2. Confirm/apply the Hero assignment.",
        "3. Wait for the assistant turn to complete (allow 30-60s).",
        "4. Inspect the Measurement SKU table/list."
      ],
      "expectedText": [
        "SKU 7 is now a Hero SKU.",
        "SKU 7 is auto-added to the Measurement SKU set: Measurement SKUs = 1,2,3,4,7, Measurement count = 5.",
        "SKU 7 row in the Measurement table carries the 'Hero SKU' indicator."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-002 E2E/Critical"
  },
  {
    "caseId": "DC-003",
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
    "caseId": "DC-004",
    "inputs": {
      "sourceCaseId": "TC-IND-004",
      "title": "Channel-level Hero SKU modal displays all brand-linked SKUs",
      "technique": [
        "Positive",
        "Equivalence-Partition"
      ],
      "preconditions": [
        "Media plan with at least one selected channel (e.g. offSite: Meta).",
        "Measurement SKUs = 1,2,3,4; brand-linked catalogue = 1..8.",
        "Channel edit modal for the channel is reachable."
      ],
      "testData": [
        "Channel: offSite Meta",
        "Measurement SKUs: 1,2,3,4",
        "Brand-linked SKUs: 1,2,3,4,5,6,7,8"
      ],
      "steps": [
        "1. Open the channel edit (Hero) modal for the offSite Meta channel.",
        "2. Inspect the selectable SKU list offered for Hero assignment within that channel.",
        "3. Compare to the brand-linked catalogue and the Measurement subset."
      ],
      "expectedText": [
        "The channel modal lists all brand-linked SKUs 1..8 (8 entries).",
        "Non-Measurement brand-linked SKUs 5,6,7,8 are present and selectable.",
        "The channel modal is NOT limited to Measurement SKUs only."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-004 UI/Critical"
  },
  {
    "caseId": "DC-005",
    "inputs": {
      "sourceCaseId": "TC-IND-005",
      "title": "Single-prompt edit flow shows all brand-linked SKUs when editing Hero SKUs",
      "technique": [
        "Positive",
        "Equivalence-Partition"
      ],
      "preconditions": [
        "A plan was created via single-prompt flow (one chat message defining channels/SKUs).",
        "Measurement SKUs = 1,2,3,4; brand-linked = 1..8.",
        "The single-prompt summary exposes a Hero SKU edit modal."
      ],
      "testData": [
        "Single-prompt summary present",
        "Measurement SKUs: 1,2,3,4",
        "Brand-linked SKUs: 1..8"
      ],
      "steps": [
        "1. From the single-prompt summary, open the Hero SKU edit modal.",
        "2. Inspect the selectable SKU list.",
        "3. Compare against the brand-linked catalogue."
      ],
      "expectedText": [
        "The edit modal in the single-prompt flow lists all brand-linked SKUs 1..8.",
        "Non-Measurement SKUs 5,6,7,8 are selectable here too.",
        "Not restricted to Measurement SKUs."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-005 UI/High"
  },
  {
    "caseId": "DC-006",
    "inputs": {
      "sourceCaseId": "TC-IND-006",
      "title": "Single-prompt free-text parsing splits Measurement vs Hero and auto-adds Hero-only SKUs to Measurement",
      "technique": [
        "Positive",
        "Cross-Field",
        "State-Recompute"
      ],
      "preconditions": [
        "User is in the Nectar AI chat, no plan yet.",
        "Brand-linked catalogue includes SKUs 1..6."
      ],
      "testData": [
        "Prompt free text: '1, 2, 3, 4 and hero skus 3, 5, 6'",
        "Expected Measurement SKUs: 1,2,3,4,5,6 (count 6)",
        "Expected Hero SKUs: 3,5,6 (count 3)"
      ],
      "steps": [
        "1. Send the single prompt '1, 2, 3, 4 and hero skus 3, 5, 6' into the chat.",
        "2. Wait for the assistant turn to complete (30-60s).",
        "3. Inspect the parsed Measurement SKU set, Hero SKU set, and indicators."
      ],
      "expectedText": [
        "Measurement SKUs = {1,2,3,4,5,6}, count 6 (Hero-only SKUs 5,6 auto-added to Measurement).",
        "Hero SKUs = {3,5,6}, count 3.",
        "SKU 3 appears once (already Measurement, now Hero); SKUs 5,6 each appear once in Measurement marked Hero; no duplicates.",
        "Rows 3,5,6 show the 'Hero SKU' indicator; rows 1,2,4 do not."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-006 E2E/Critical"
  },
  {
    "caseId": "DC-007",
    "inputs": {
      "sourceCaseId": "TC-IND-007",
      "title": "Bulk mixed Measurement + non-Measurement Hero assignment: all assigned, non-Measurement auto-added",
      "technique": [
        "Positive",
        "State-Recompute",
        "Equivalence-Partition"
      ],
      "preconditions": [
        "Media plan draft with Measurement SKUs = 1,2,3,4 (count 4).",
        "Brand-linked catalogue = 1..8.",
        "Hero modal (global) supports multi-select bulk assignment."
      ],
      "testData": [
        "Bulk Hero selection: 2,3 (Measurement) + 6,7 (non-Measurement)",
        "Measurement before: 1,2,3,4 (count 4)",
        "Measurement after expected: 1,2,3,4,6,7 (count 6)",
        "Hero after expected: 2,3,6,7 (count 4)"
      ],
      "steps": [
        "1. In the Hero modal, multi-select SKUs 2,3,6,7 in a single bulk action.",
        "2. Apply and wait for the assistant turn to complete.",
        "3. Inspect Measurement table, Hero set, and counts."
      ],
      "expectedText": [
        "All four SKUs 2,3,6,7 are assigned as Hero (Hero count 4).",
        "Non-Measurement SKUs 6,7 auto-added to Measurement; Measurement = 1,2,3,4,6,7, count 6.",
        "Already-Measurement SKUs 2,3 are not duplicated; each single entry now marked Hero.",
        "Rows 2,3,6,7 show 'Hero SKU' indicator."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-007 E2E/Critical"
  },
  {
    "caseId": "DC-008",
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
    "caseId": "DC-009",
    "inputs": {
      "sourceCaseId": "TC-IND-009",
      "title": "'Hero SKU' indicator appears in real time when a SKU is assigned as Hero",
      "technique": [
        "State-Recompute",
        "Edge-Case"
      ],
      "preconditions": [
        "Measurement modal/table open showing SKUs 1,2,3,4.",
        "SKU 1 is currently NOT a Hero SKU."
      ],
      "testData": [
        "Target SKU: 1",
        "Hero before: {} (1 not hero)",
        "Hero after assign: {1}"
      ],
      "steps": [
        "1. With the Measurement table visible, confirm SKU 1 shows no Hero indicator.",
        "2. Assign SKU 1 as a Hero SKU via the Hero modal.",
        "3. Without manual page reload, observe SKU 1's row in the Measurement table after the action settles."
      ],
      "expectedText": [
        "SKU 1's 'Hero SKU' indicator appears in real time after assignment (no manual refresh required).",
        "Other rows are unaffected."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-009 UI/Critical"
  },
  {
    "caseId": "DC-010",
    "inputs": {
      "sourceCaseId": "TC-IND-010",
      "title": "'Hero SKU' indicator disappears in real time when a SKU is unassigned as Hero",
      "technique": [
        "State-Recompute",
        "Edge-Case"
      ],
      "preconditions": [
        "Measurement modal/table open showing SKUs 1,2,3,4.",
        "SKU 2 is currently a Hero SKU (indicator visible)."
      ],
      "testData": [
        "Target SKU: 2",
        "Hero before: {2}",
        "Hero after unassign: {}"
      ],
      "steps": [
        "1. Confirm SKU 2 shows the 'Hero SKU' indicator.",
        "2. Unassign SKU 2 as Hero via the Hero modal.",
        "3. Observe SKU 2's row in the Measurement table after the action settles (no manual reload)."
      ],
      "expectedText": [
        "SKU 2's 'Hero SKU' indicator is removed in real time after unassignment.",
        "SKU 2 remains a Measurement SKU (still listed); only the Hero indicator is cleared.",
        "Other rows unaffected."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-010 UI/Critical"
  },
  {
    "caseId": "DC-011",
    "inputs": {
      "sourceCaseId": "TC-IND-011",
      "title": "Summary panel and tables counts update after Hero changes; Measurement count grows on auto-add",
      "technique": [
        "State-Recompute",
        "Data-Persistence",
        "Cross-Field"
      ],
      "preconditions": [
        "Media plan with Measurement SKUs = 1,2,3,4 (count 4), Hero SKUs = {} (count 0).",
        "Summary panel visible showing both counts.",
        "Brand-linked catalogue includes non-Measurement SKU 8."
      ],
      "testData": [
        "Step A assign Measurement SKU 2 as Hero -> Hero count 0->1, Measurement stays 4",
        "Step B assign non-Measurement SKU 8 as Hero -> Hero count 1->2, Measurement 4->5",
        "Measurement after: 1,2,3,4,8"
      ],
      "steps": [
        "1. Record summary counts: Measurement = 4, Hero = 0.",
        "2. Assign SKU 2 (already Measurement) as Hero; wait for turn to complete; record counts.",
        "3. Assign SKU 8 (non-Measurement) as Hero; wait for turn to complete; record counts.",
        "4. Compare summary panel counts with the Measurement and Hero tables."
      ],
      "expectedText": [
        "After step 2: Hero count = 1, Measurement count = 4 (no growth, SKU 2 already Measurement).",
        "After step 3: Hero count = 2, Measurement count = 5 (grew because SKU 8 auto-added).",
        "Summary panel counts match the table counts exactly at every step.",
        "Measurement = 1,2,3,4,8 with SKUs 2 and 8 marked Hero."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-011 E2E/Critical"
  },
  {
    "caseId": "DC-012",
    "inputs": {
      "sourceCaseId": "TC-IND-012",
      "title": "is_hero set True in StateData.campaign_skus when a SKU is added as Hero to a channel",
      "technique": [
        "State-Recompute",
        "Data-Persistence"
      ],
      "preconditions": [
        "StateData.campaign_skus contains SKU 5 with is_hero = False.",
        "A selected channel (offSite Meta) exists whose channel edit modal can add Hero SKUs.",
        "Access to StateData (via API/backend assertion hook) is available."
      ],
      "testData": [
        "SKU added as Hero to channel: 5",
        "is_hero before: False",
        "is_hero after expected: True"
      ],
      "steps": [
        "1. Confirm StateData.campaign_skus[5].is_hero == False.",
        "2. In the offSite Meta channel modal, add SKU 5 as a Hero SKU and apply.",
        "3. Wait for the channel modification to process.",
        "4. Re-read StateData.campaign_skus[5].is_hero."
      ],
      "expectedText": [
        "StateData.campaign_skus[5].is_hero == True after the channel modification.",
        "The update method runs on channel modification and flags SKU 5 as hero."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-012 Integration/High"
  },
  {
    "caseId": "DC-013",
    "inputs": {
      "sourceCaseId": "TC-IND-013",
      "title": "is_hero set False when a SKU is no longer used as Hero by any remaining channel after channel DELETION",
      "technique": [
        "State-Recompute",
        "Data-Persistence",
        "Edge-Case"
      ],
      "preconditions": [
        "Two channels exist: Channel A (offSite Meta) with Hero SKU 5; Channel B (offSite Display) with NO Hero use of SKU 5.",
        "StateData.campaign_skus[5].is_hero == True (because Channel A uses it as Hero).",
        "No other channel uses SKU 5 as Hero."
      ],
      "testData": [
        "SKU under test: 5",
        "Channels: A=offSite Meta (hero 5), B=offSite Display (no hero 5)",
        "is_hero before delete: True",
        "is_hero after deleting A: False"
      ],
      "steps": [
        "1. Confirm StateData.campaign_skus[5].is_hero == True.",
        "2. Delete Channel A (the only channel using SKU 5 as Hero).",
        "3. Wait for the deletion to process (update method runs).",
        "4. Re-read StateData.campaign_skus[5].is_hero and inspect remaining Hero union."
      ],
      "expectedText": [
        "StateData.campaign_skus[5].is_hero == False after deleting Channel A (no remaining channel uses it as Hero).",
        "campaign_skus hero flags equal the union of Hero SKUs across remaining channels.",
        "Measurement table SKU 5 row no longer shows the 'Hero SKU' indicator (if 5 was not Hero elsewhere)."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-013 Integration/Critical"
  },
  {
    "caseId": "DC-014",
    "inputs": {
      "sourceCaseId": "TC-IND-014",
      "title": "is_hero stays True after channel deletion when another remaining channel still uses the SKU as Hero",
      "technique": [
        "State-Recompute",
        "Decision-Table",
        "Data-Persistence"
      ],
      "preconditions": [
        "Channel A (offSite Meta) uses SKU 5 as Hero; Channel B (offSite Display) ALSO uses SKU 5 as Hero.",
        "StateData.campaign_skus[5].is_hero == True."
      ],
      "testData": [
        "SKU under test: 5",
        "Channels using 5 as Hero: A and B",
        "is_hero before delete: True",
        "is_hero after deleting A: True (B still uses it)"
      ],
      "steps": [
        "1. Confirm both Channel A and Channel B use SKU 5 as Hero; is_hero == True.",
        "2. Delete Channel A.",
        "3. Wait for deletion to process.",
        "4. Re-read StateData.campaign_skus[5].is_hero."
      ],
      "expectedText": [
        "StateData.campaign_skus[5].is_hero == True after deleting Channel A, because Channel B still uses SKU 5 as Hero.",
        "Hero flags equal the union across remaining channels (which still includes SKU 5)."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-014 Integration/High"
  },
  {
    "caseId": "DC-015",
    "inputs": {
      "sourceCaseId": "TC-IND-015",
      "title": "is_hero recomputed on channel MODIFICATION that removes the SKU from the channel's Hero set",
      "technique": [
        "State-Recompute",
        "Data-Persistence"
      ],
      "preconditions": [
        "Single channel (offSite Meta) uses SKU 5 as Hero.",
        "StateData.campaign_skus[5].is_hero == True.",
        "No other channel uses SKU 5 as Hero."
      ],
      "testData": [
        "SKU under test: 5",
        "is_hero before modify: True",
        "is_hero after modify (deselect 5 in channel modal): False"
      ],
      "steps": [
        "1. Confirm is_hero == True for SKU 5.",
        "2. Open the offSite Meta channel modal and DESELECT SKU 5 from Hero (modification, not deletion).",
        "3. Apply and wait for the modification to process.",
        "4. Re-read StateData.campaign_skus[5].is_hero."
      ],
      "expectedText": [
        "StateData.campaign_skus[5].is_hero == False after modification (no channel uses it as Hero anymore).",
        "The update method runs on channel modification, not only deletion.",
        "SKU 5 remains a Measurement SKU; only is_hero is cleared."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-015 Integration/High"
  },
  {
    "caseId": "DC-016",
    "inputs": {
      "sourceCaseId": "TC-IND-016",
      "title": "Max Hero SKUs per channel boundary: assigned count EQUAL to max is accepted with no warning",
      "technique": [
        "Boundary-BVA",
        "Positive"
      ],
      "preconditions": [
        "Channel offSite Meta configured with maxHeroSkus = 3 (ASSUMPTION: max=3 per spec example; parameterize via channel config).",
        "Brand-linked catalogue >= SKUs 1,2,3."
      ],
      "testData": [
        "Channel: offSite Meta, maxHeroSkus = 3 (assumed/parameterized)",
        "Hero assigned: 1,2,3 (count = max = 3)"
      ],
      "steps": [
        "1. Assign exactly 3 Hero SKUs (1,2,3) to offSite Meta.",
        "2. Apply and wait for processing.",
        "3. Inspect the summary panel for the channel and any warning."
      ],
      "expectedText": [
        "Channel added to the summary panel with all 3 selected SKUs.",
        "NO warning shown (count == max is within limit).",
        "Booking/saving is NOT blocked by this channel."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-016 E2E/High"
  },
  {
    "caseId": "DC-017",
    "inputs": {
      "sourceCaseId": "TC-IND-017",
      "title": "Max Hero SKUs per channel boundary: assigned count = max-1 accepted, no warning",
      "technique": [
        "Boundary-BVA",
        "Positive"
      ],
      "preconditions": [
        "Channel offSite Meta configured with maxHeroSkus = 3 (assumed/parameterized)."
      ],
      "testData": [
        "maxHeroSkus = 3",
        "Hero assigned: 1,2 (count = max-1 = 2)"
      ],
      "steps": [
        "1. Assign 2 Hero SKUs (1,2) to offSite Meta.",
        "2. Apply and wait.",
        "3. Inspect summary panel and warnings."
      ],
      "expectedText": [
        "Channel added with 2 SKUs.",
        "No 'Media limit' warning.",
        "Booking not blocked."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-017 E2E/Medium"
  },
  {
    "caseId": "DC-018",
    "inputs": {
      "sourceCaseId": "TC-IND-018",
      "title": "Max Hero SKUs per channel boundary: assigned count = max+1 adds channel but shows warning and blocks booking",
      "technique": [
        "Boundary-BVA",
        "Negative",
        "Error-Message"
      ],
      "preconditions": [
        "Channel offSite Meta configured with maxHeroSkus = 3 (assumed/parameterized).",
        "Brand-linked catalogue >= SKUs 1,2,3,4."
      ],
      "testData": [
        "maxHeroSkus = 3",
        "Hero assigned: 1,2,3,4 (count = max+1 = 4)",
        "Verbatim warning expected: 'Media limit: 3 Hero SKUs. Edit SKUs'"
      ],
      "steps": [
        "1. Assign 4 Hero SKUs (1,2,3,4) to offSite Meta (exceeds max of 3).",
        "2. Apply and wait for processing.",
        "3. Inspect the summary panel: channel presence, SKU list, warning text, and booking/save control state.",
        "4. Attempt to book/save the plan."
      ],
      "expectedText": [
        "Channel IS still added to the summary panel WITH all 4 selected SKUs.",
        "A warning is shown with EXACT text: 'Media limit: 3 Hero SKUs. Edit SKUs'.",
        "The user is BLOCKED from booking/saving the plan (book/save control disabled or rejected) until the selection meets the max.",
        "An edit/deselect modal is reachable from the warning to remove the excess."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-018 E2E/Critical"
  },
  {
    "caseId": "DC-019",
    "inputs": {
      "sourceCaseId": "TC-IND-019",
      "title": "After deselecting excess Hero SKUs down to max, warning clears and booking is unblocked",
      "technique": [
        "State-Recompute",
        "Positive",
        "Error-Message"
      ],
      "preconditions": [
        "From IND-018 end state: offSite Meta has 4 Hero SKUs (1,2,3,4), warning shown, booking blocked, maxHeroSkus = 3."
      ],
      "testData": [
        "maxHeroSkus = 3",
        "Deselect SKU 4 -> remaining Hero 1,2,3 (count = 3 = max)"
      ],
      "steps": [
        "1. Open the deselect/edit modal from the warning.",
        "2. Deselect SKU 4 so the channel has 3 Hero SKUs (1,2,3).",
        "3. Apply and wait for recompute.",
        "4. Inspect warning and booking control."
      ],
      "expectedText": [
        "The 'Media limit: 3 Hero SKUs. Edit SKUs' warning is removed.",
        "Channel now shows 3 Hero SKUs.",
        "Booking/saving is unblocked (control enabled)."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-019 E2E/Critical"
  },
  {
    "caseId": "DC-020",
    "inputs": {
      "sourceCaseId": "TC-IND-020",
      "title": "No max configured: assigning many Hero SKUs imposes no restriction and no warning",
      "technique": [
        "Equivalence-Partition",
        "Positive",
        "Decision-Table"
      ],
      "preconditions": [
        "Channel offSite Display has NO maxHeroSkus configured (max unset/null)."
      ],
      "testData": [
        "Channel: offSite Display, maxHeroSkus = unset",
        "Hero assigned: 1,2,3,4,5,6 (count 6)"
      ],
      "steps": [
        "1. Assign 6 Hero SKUs to offSite Display (which has no max configured).",
        "2. Apply and wait.",
        "3. Inspect summary panel, warning, and booking control."
      ],
      "expectedText": [
        "Channel added with all 6 SKUs.",
        "NO 'Media limit' warning shown (no max means no restriction).",
        "Booking/saving NOT blocked by this channel."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-020 E2E/High"
  },
  {
    "caseId": "DC-021",
    "inputs": {
      "sourceCaseId": "TC-IND-021",
      "title": "Global Hero list exceeding a channel's max: each affected channel added but warned and blocked until adjusted per channel",
      "technique": [
        "Decision-Table",
        "Error-Message",
        "State-Recompute",
        "Negative"
      ],
      "preconditions": [
        "Global Hero list = 1,2,3,4 (4 Hero SKUs) assigned BEFORE selecting channels.",
        "Channel offSite Meta configured maxHeroSkus = 3; Channel offSite Display configured maxHeroSkus = 3.",
        "Global Hero pre-populates every selected channel."
      ],
      "testData": [
        "Global Hero SKUs: 1,2,3,4 (count 4)",
        "Per-channel max: 3 for both channels",
        "Verbatim warning expected per channel: 'Media limit: 3 Hero SKUs. Edit SKUs'"
      ],
      "steps": [
        "1. Assign global Hero SKUs 1,2,3,4.",
        "2. Select channels offSite Meta and offSite Display (each gets the 4 global Hero SKUs).",
        "3. Wait for processing.",
        "4. Inspect each channel in the summary panel for warning and the booking control.",
        "5. Attempt to book."
      ],
      "expectedText": [
        "Each affected channel (Meta and Display) is still added with the 4 Hero SKUs.",
        "Each shows the warning 'Media limit: 3 Hero SKUs. Edit SKUs' indicating the max and that the selection exceeds it.",
        "Booking is BLOCKED until adjusted per channel.",
        "Adjustment must be done per channel (deselecting excess within each channel modal)."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-021 E2E/Critical"
  },
  {
    "caseId": "DC-022",
    "inputs": {
      "sourceCaseId": "TC-IND-022",
      "title": "Backend NUP-20507: single channel typed exceeds max -> block channel and route to ask node",
      "technique": [
        "Decision-Table",
        "Negative",
        "Error-Message"
      ],
      "preconditions": [
        "User types ONE channel in chat whose Hero selection exceeds its maxHeroSkus.",
        "Channel offSite Meta maxHeroSkus = 3; user specifies 4 Hero SKUs for it.",
        "Backend min/max check runs after channel activation."
      ],
      "testData": [
        "Single channel typed: offSite Meta with Hero 1,2,3,4",
        "maxHeroSkus = 3"
      ],
      "steps": [
        "1. Send a single-channel prompt assigning 4 Hero SKUs to offSite Meta.",
        "2. Wait for the assistant/backend turn (30-60s).",
        "3. Inspect whether the channel was added and where the flow routed."
      ],
      "expectedText": [
        "Adding the channel is BLOCKED (max exceeded after activation).",
        "The user is informed of the limit.",
        "Because only ONE channel was typed, the flow goes to the ask node (prompts the user to adjust)."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-022 Integration/High"
  },
  {
    "caseId": "DC-023",
    "inputs": {
      "sourceCaseId": "TC-IND-023",
      "title": "Backend NUP-20507: multiple channels typed, one exceeds max -> block that channel, continue with other resolver nodes",
      "technique": [
        "Decision-Table",
        "Negative"
      ],
      "preconditions": [
        "User types MORE than one channel in chat.",
        "offSite Meta maxHeroSkus = 3 with 4 Hero SKUs (exceeds); offSite Display maxHeroSkus = 3 with 2 Hero SKUs (within).",
        "Backend min/max check runs after channel activation."
      ],
      "testData": [
        "Channels typed: offSite Meta (Hero 1,2,3,4 -> exceeds), offSite Display (Hero 1,2 -> within)",
        "maxHeroSkus = 3 each"
      ],
      "steps": [
        "1. Send a multi-channel prompt: Meta with 4 Hero SKUs and Display with 2 Hero SKUs.",
        "2. Wait for backend processing.",
        "3. Inspect which channels were added and the flow continuation."
      ],
      "expectedText": [
        "offSite Meta (exceeds max) is BLOCKED from being added; user informed.",
        "Because MORE than one channel was typed, the flow CONTINUES with the other resolver nodes (offSite Display proceeds).",
        "offSite Display is added with its 2 Hero SKUs."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-023 Integration/High"
  },
  {
    "caseId": "DC-024",
    "inputs": {
      "sourceCaseId": "TC-IND-024",
      "title": "Per-channel SKU definition: channel without defined SKUs inherits all global Hero SKUs",
      "technique": [
        "Positive",
        "Cross-Field",
        "State-Recompute"
      ],
      "preconditions": [
        "Global Hero SKUs = 5,6 assigned.",
        "User defines two channels in chat; one specifies its own SKUs, the other does not."
      ],
      "testData": [
        "Global Hero SKUs: 5,6",
        "Channel offSite Meta prompt: 'offSite: Meta, 40k, 20-25/03/2026, skus 12345, 234235' (defines its own SKUs)",
        "Channel offSite Display prompt: no SKUs defined"
      ],
      "steps": [
        "1. Send a prompt defining offSite Meta with explicit SKUs 12345,234235 and offSite Display with no SKUs.",
        "2. Wait for processing.",
        "3. Inspect SKU assignment for each channel."
      ],
      "expectedText": [
        "offSite Meta uses its explicitly defined SKUs (12345, 234235).",
        "offSite Display, which had NO SKUs defined, is assigned ALL global Hero SKUs (5,6)."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-024 E2E/High"
  },
  {
    "caseId": "DC-025",
    "inputs": {
      "sourceCaseId": "TC-IND-025",
      "title": "Per-channel single-prompt Hero edit isolates changes to that channel only",
      "technique": [
        "State-Recompute",
        "Cross-Field"
      ],
      "preconditions": [
        "Two channels exist: offSite Meta (Hero 1,2) and offSite Display (Hero 1,2).",
        "Channel edit modal available per channel."
      ],
      "testData": [
        "Edit offSite Meta: add Hero SKU 7",
        "offSite Display Hero unchanged: 1,2"
      ],
      "steps": [
        "1. Open offSite Meta channel modal and add Hero SKU 7.",
        "2. Apply and wait.",
        "3. Inspect Hero sets of both channels and the global/union state."
      ],
      "expectedText": [
        "offSite Meta Hero set = 1,2,7.",
        "offSite Display Hero set remains 1,2 (unaffected; change isolated to Meta).",
        "StateData.campaign_skus[7].is_hero == True (now used by Meta)."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-025 Integration/Medium"
  },
  {
    "caseId": "DC-026",
    "inputs": {
      "sourceCaseId": "TC-IND-026",
      "title": "Auto-add updates Measurement table count and indicator together (combined recompute)",
      "technique": [
        "State-Recompute",
        "Cross-Field",
        "Data-Persistence"
      ],
      "preconditions": [
        "Measurement SKUs = 1,2,3,4 (count 4); Hero = {}.",
        "Measurement table and summary panel both visible.",
        "Brand-linked SKU 8 is non-Measurement."
      ],
      "testData": [
        "Assign non-Measurement SKU 8 as Hero",
        "Measurement after: 1,2,3,4,8 (count 5)",
        "Hero after: {8} (count 1)"
      ],
      "steps": [
        "1. Record Measurement count = 4, Hero count = 0; note SKU 8 absent from Measurement table.",
        "2. Assign SKU 8 as Hero (global).",
        "3. Wait for processing.",
        "4. Inspect Measurement table (new row + indicator), Measurement count, Hero count, summary panel."
      ],
      "expectedText": [
        "A new Measurement row for SKU 8 appears, carrying the 'Hero SKU' indicator.",
        "Measurement count = 5; Hero count = 1.",
        "Summary panel and table counts agree (both reflect Measurement 5, Hero 1).",
        "All three effects (row added, indicator shown, counts recomputed) occur from the single auto-add action."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-026 E2E/High"
  },
  {
    "caseId": "DC-027",
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
    "caseId": "DC-028",
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
  },
  {
    "caseId": "DC-029",
    "inputs": {
      "sourceCaseId": "TC-IND-029",
      "title": "FIX: zero-Hero state Hero count assertion must read 0 and indicator-count must read 0 even after a Hero was assigned then fully unassigned",
      "technique": [
        "State-Recompute",
        "Boundary-BVA",
        "Edge-Case"
      ],
      "preconditions": [
        "Media plan with Measurement SKUs = 1,2,3,4.",
        "SKU 2 was assigned Hero then unassigned (returning to zero Hero)."
      ],
      "testData": [
        "Sequence: assign SKU 2 Hero (Hero count 1) -> unassign SKU 2 (Hero count 0)",
        "Expected end Hero count: 0; expected indicator-bearing rows: 0"
      ],
      "steps": [
        "1. Assign SKU 2 as Hero; confirm Hero count == 1 and SKU 2 indicator on.",
        "2. Unassign SKU 2 as Hero.",
        "3. Inspect the Hero count in the summary panel AND the number of rows showing the 'Hero SKU' indicator."
      ],
      "expectedText": [
        "Hero count returns to 0 (not stuck at 1).",
        "Zero Measurement rows show the 'Hero SKU' indicator.",
        "Measurement count unchanged at 4 (SKU 2 still a Measurement SKU)."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-029 E2E/Medium"
  },
  {
    "caseId": "DC-030",
    "inputs": {
      "sourceCaseId": "TC-IND-030",
      "title": "Real-time Hero indicator does NOT leak across SKUs: assigning one SKU as Hero flips only that row's indicator",
      "technique": [
        "State-Recompute",
        "Edge-Case",
        "Equivalence-Partition"
      ],
      "preconditions": [
        "Measurement modal/table open showing SKUs 1,2,3,4; none currently Hero.",
        "No page reload between actions."
      ],
      "testData": [
        "Assign SKU 2 as Hero",
        "Hero before: {}",
        "Hero after: {2}; rows 1,3,4 must remain non-Hero"
      ],
      "steps": [
        "1. Confirm no row shows the 'Hero SKU' indicator.",
        "2. Assign SKU 2 as Hero via the Hero modal.",
        "3. Without reload, observe ALL four rows' indicator state after the action settles."
      ],
      "expectedText": [
        "SKU 2 row gains the 'Hero SKU' indicator in real time.",
        "SKUs 1, 3, 4 rows remain WITHOUT the indicator (no spurious leakage).",
        "Hero count == 1."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-030 UI/Medium"
  },
  {
    "caseId": "DC-031",
    "inputs": {
      "sourceCaseId": "TC-IND-031",
      "title": "Auto-add dedup under concurrent-style bulk assign: assigning the SAME non-Measurement SKU twice in one bulk action yields a single Measurement row",
      "technique": [
        "Edge-Case",
        "Negative",
        "State-Recompute"
      ],
      "preconditions": [
        "Media plan with Measurement SKUs = 1,2,3,4 (count 4).",
        "Brand-linked non-Measurement SKU 7 available.",
        "Hero modal supports multi-select."
      ],
      "testData": [
        "Bulk Hero selection includes SKU 7 listed/selected twice (e.g. via repeated toggle then apply)",
        "Measurement before: 1,2,3,4 (count 4)",
        "Measurement after expected: 1,2,3,4,7 (count 5, SKU 7 exactly once)"
      ],
      "steps": [
        "1. In the Hero modal, select non-Measurement SKU 7 (ensure the underlying selection set references 7 once even if toggled multiple times).",
        "2. Apply the bulk assignment.",
        "3. Inspect the Measurement table for SKU 7 row count and the Measurement total."
      ],
      "expectedText": [
        "SKU 7 is auto-added to Measurement exactly once (single row), not duplicated.",
        "Measurement count == 5 (grew by exactly 1).",
        "SKU 7 row carries the 'Hero SKU' indicator."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-031 Integration/Medium"
  },
  {
    "caseId": "DC-032",
    "inputs": {
      "sourceCaseId": "TC-IND-032",
      "title": "Auto-add dedup across SEPARATE actions: assigning an already-Hero non-Measurement SKU as Hero a second time does not re-add or duplicate it",
      "technique": [
        "Edge-Case",
        "Negative",
        "Data-Persistence"
      ],
      "preconditions": [
        "SKU 8 was non-Measurement, already assigned Hero and auto-added (Measurement = 1,2,3,4,8 count 5; Hero = {8}).",
        "Hero modal open again."
      ],
      "testData": [
        "Re-assign SKU 8 as Hero (it is already Hero and already Measurement)",
        "Measurement after expected: 1,2,3,4,8 (count stays 5)",
        "Hero after expected: {8} (unchanged)"
      ],
      "steps": [
        "1. Confirm SKU 8 is already Measurement (Hero-flagged), count 5.",
        "2. In the Hero modal, select SKU 8 as Hero again and apply.",
        "3. Inspect Measurement rows for SKU 8 and the counts."
      ],
      "expectedText": [
        "No duplicate Measurement row for SKU 8 (exactly one row).",
        "Measurement count stays 5; Hero count stays 1.",
        "SKU 8 remains Hero-flagged; no state churn."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-032 Integration/Medium"
  },
  {
    "caseId": "DC-033",
    "inputs": {
      "sourceCaseId": "TC-IND-033",
      "title": "Indicator persists correctly when a Measurement SKU is BOTH global-Hero and channel-Hero, then removed from only one scope",
      "technique": [
        "State-Recompute",
        "Cross-Field",
        "Edge-Case"
      ],
      "preconditions": [
        "SKU 2 is a Measurement SKU.",
        "SKU 2 is Hero globally AND is Hero on channel offSite Meta (union includes it from two sources).",
        "Measurement table indicator on SKU 2 visible."
      ],
      "testData": [
        "Remove SKU 2 from the GLOBAL Hero list but it remains Hero on offSite Meta channel"
      ],
      "steps": [
        "1. Confirm SKU 2 shows the 'Hero SKU' indicator.",
        "2. Remove SKU 2 from the global Hero assignment only (leave the channel-level Hero on offSite Meta intact).",
        "3. Observe the Measurement table indicator for SKU 2 and is_hero (if backend exposed)."
      ],
      "expectedText": [
        "SKU 2 'Hero SKU' indicator REMAINS visible because it is still Hero on at least one channel (union still includes it).",
        "is_hero for SKU 2 stays True.",
        "Indicator only clears once SKU 2 is no longer Hero in ANY scope."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-033 E2E/Medium"
  },
  {
    "caseId": "DC-034",
    "inputs": {
      "sourceCaseId": "TC-IND-034",
      "title": "Summary Measurement count and Hero count stay consistent when an auto-added Hero is later unassigned (count does not shrink) then a different non-Measurement Hero is added",
      "technique": [
        "State-Recompute",
        "Data-Persistence",
        "Cross-Field"
      ],
      "preconditions": [
        "Measurement SKUs = 1,2,3,4 (count 4); Hero = {}.",
        "Brand-linked non-Measurement SKUs 7 and 8 available.",
        "Summary panel visible."
      ],
      "testData": [
        "Step A: assign non-Measurement 7 as Hero -> Measurement 1,2,3,4,7 (count 5), Hero {7} (1)",
        "Step B: unassign 7 -> Measurement stays 1,2,3,4,7 (count 5), Hero {} (0)",
        "Step C: assign non-Measurement 8 as Hero -> Measurement 1,2,3,4,7,8 (count 6), Hero {8} (1)"
      ],
      "steps": [
        "1. Assign SKU 7 (non-Measurement) as Hero; record counts.",
        "2. Unassign SKU 7; record counts.",
        "3. Assign SKU 8 (non-Measurement) as Hero; record counts.",
        "4. Compare summary panel counts against table counts at each step."
      ],
      "expectedText": [
        "After A: Measurement 5, Hero 1.",
        "After B: Measurement STAYS 5 (auto-added 7 not auto-removed), Hero 0.",
        "After C: Measurement 6 (8 newly auto-added on top of retained 7), Hero 1.",
        "Summary and table counts agree at every step."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-034 E2E/Medium"
  },
  {
    "caseId": "DC-035",
    "inputs": {
      "sourceCaseId": "TC-IND-035",
      "title": "is_hero union recompute on deletion when a SKU is Hero on the deleted channel AND a different remaining channel: flag stays True, indicator stays",
      "technique": [
        "State-Recompute",
        "Decision-Table",
        "Data-Persistence"
      ],
      "preconditions": [
        "Three channels: A (offSite Meta) Hero {5,6}; B (offSite Display) Hero {6}; C (onSite) Hero {5}.",
        "StateData.campaign_skus: 5 is_hero True, 6 is_hero True.",
        "Delete channel A."
      ],
      "testData": [
        "A Hero: 5,6; B Hero: 6; C Hero: 5",
        "Delete A",
        "is_hero after: 5 -> True (C uses it), 6 -> True (B uses it)"
      ],
      "steps": [
        "1. Confirm is_hero True for both 5 and 6.",
        "2. Delete channel A.",
        "3. Wait for the update method.",
        "4. Re-read is_hero for 5 and 6 and inspect indicators."
      ],
      "expectedText": [
        "is_hero for SKU 5 stays True (channel C still uses it as Hero).",
        "is_hero for SKU 6 stays True (channel B still uses it as Hero).",
        "Neither indicator clears; Hero union across remaining channels {B,C} = {5,6}."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-035 Integration/High"
  },
  {
    "caseId": "DC-036",
    "inputs": {
      "sourceCaseId": "TC-IND-036",
      "title": "is_hero recompute on deletion: deleted channel held the ONLY copies of two distinct Hero SKUs -> both flip to False in one operation",
      "technique": [
        "State-Recompute",
        "Edge-Case",
        "Data-Persistence"
      ],
      "preconditions": [
        "Two channels: A (offSite Meta) Hero {5,6}; B (offSite Display) Hero {} (no Hero of 5 or 6).",
        "StateData.campaign_skus: 5 is_hero True, 6 is_hero True.",
        "Delete channel A."
      ],
      "testData": [
        "A Hero: 5,6; B Hero: none of 5,6",
        "Delete A",
        "is_hero after: 5 -> False, 6 -> False (no remaining channel uses either)"
      ],
      "steps": [
        "1. Confirm is_hero True for 5 and 6.",
        "2. Delete channel A.",
        "3. Wait for the update method.",
        "4. Re-read is_hero for 5 and 6 and unique Hero count."
      ],
      "expectedText": [
        "is_hero for BOTH 5 and 6 == False after deletion (neither used by any remaining channel).",
        "Unique Hero count across remaining channels == 0.",
        "Both Measurement rows lose the 'Hero SKU' indicator; SKUs 5,6 remain Measurement SKUs."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-IND-036 Integration/High"
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| advertiser | N360_Unilever_MS | Non-production advertiser (data/media-planner.ts) |
| brand | Unilever \| Knorr \| MS | Non-production brand |
| dataManager | fixtures/test-data-manager.ts | API helpers to seed channel/SKU preconditions |
| salientCopy | Hero, Measurement | Salient strings the generated tests must assert |

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
| 2 | AC-002 | Seed brand-linked SKUs and channels via API | dataManager.ensureBrandLinkedSkus | brand; case SKUs | The brand catalogue contains the case SKUs | precondition helper resolves without error |
| 3 | AC-003 | Select advertiser and brand | Guided planner controls | advertiser; brand; Confirm | Advertiser and brand are shown on the summary panel | advertiser and brand visible on summary |
| 4 | AC-004 | Select Measurement and Hero SKUs | Assistant chat and product search | productSearch; select Measurement SKUs; promote Hero SKUs; Confirm | Hero and Measurement SKUs are applied | Hero and Measurement controls reflect the selection |
| 5 | AC-005 | Apply the case's selection across the affected channels | Assistant chat / channel modal | case SKUs; affected channels; Apply | Each affected channel reflects the auto-added Hero SKUs | each channel row updates |
| 6 | AC-006 | Verify indicators and recomputed counts | Summary panel counts and indicators | n/a | The Hero/Measurement counts equal the expected values and Hero indicators appear only on Hero SKUs | counts and indicators match the case |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | A Measurement-only SKU is inspected for a Hero indicator | No Hero indicator is shown for a Measurement-only SKU |
| NEG-002 | A global Hero list exceeds a channel max after auto-add | The affected channel is warned and booking is blocked until adjusted, while counts still recompute |

## Acceptance Criteria

- AC-001: The guided flow is active
- AC-002: The brand catalogue contains the case SKUs
- AC-003: Advertiser and brand are shown on the summary panel
- AC-004: Hero and Measurement SKUs are applied
- AC-005: Each affected channel reflects the auto-added Hero SKUs
- AC-006: The Hero/Measurement counts equal the expected values and Hero indicators appear only on Hero SKUs

## Locator Hints

- Prefer role/name and data-testid locators owned by PlanningPage / NectarFlow page objects.
- Use exact visible text for warning copy (e.g. "Hero") and summary panel values.
- Use CSS only with an explicit `// locator-policy:exception <reason>` comment directly above the locator call.

## Generated Test Requirements

- Must import from fixtures/test and use Page Objects / Component Objects for all locators.
- Generation Mode is suite: generate one focused test per Data Case (DC-###), each enumerating its DC id in the title.
- Across the suite, every AC id (AC-001, AC-002, AC-003, AC-004, AC-005, AC-006) must be covered by at least one test.
- Seed preconditions via the `dataManager` fixture (fixtures/test-data-manager.ts); do not configure data through the admin UI.
- Put `expect(...)` only in the final assertion step of each test; title it `Assert AC-###: ...`.
- Must assert the salient expected values "Hero", "Measurement".
- Must not use page.waitForTimeout, networkidle, XPath, test.only, or any form of skip; must not use real credentials or commit auth state.

## Notes

- This suite targets the live Pollen development environment; `Parallel Safe` is `no` and `Data Isolation` is `external`.
- The 36 Data Cases are transformed from specs/test-cases-skus-2.yaml (area: Hero-SKU indicators, all-brand-linked modal, auto-add and count recompute); each carries its source case id in notes for traceability.
- Several cases depend on test-data management helpers that are not yet implemented (see fixtures/test-data-manager.ts `MISSING_TEST_DATA_FUNCTIONS`); those tests will fail loudly until the helpers are wired.
- AUTHORING CAVEAT: authored without a live DOM-discovery snapshot. Run `npm run ai:dom:discover` against `/planning` and heal locators before treating generated tests as green.
