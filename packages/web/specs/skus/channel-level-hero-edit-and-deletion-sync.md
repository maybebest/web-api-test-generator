# Flow: Channel-level Hero edit, per-channel SKU definition and deletion sync

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-SKU-CHAN |
| Spec Version | 1.0.0 |
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
So that Hero/Measurement SKU selections and channel limits behave deterministically across the 30 documented cases.

## Preconditions

- A valid non-production authenticated Playwright storage state (`playwright/.auth/user.json`).
- `PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.pollen.js-devops.co.uk/`.
- A plan with at least two channels and per-channel Hero selections is available.
- Per-channel Hero edit/delete is supported (see Missing test-data functions: setPlanHeroSkus, unlinkSkuFromBrand).

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
| RULE-001 | Hero SKUs can be defined per channel and persist for that channel | channel.hero is set independently per channel and reflected after Apply | A per-channel Hero edit that does not persist is a defect |
| RULE-002 | Deleting a Hero SKU syncs the change to the affected channels and recomputes counts | on delete(sku): every channel referencing sku drops it and recomputes its count | A stale SKU remaining on a channel after deletion is a defect |
| RULE-003 | Editing one channel does not mutate the Hero selection of another channel | edit(channelA) leaves channelB.hero unchanged | Cross-channel bleed of a per-channel edit is a defect |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | Global Hero SKUs: 1001,1002,1003; Channels: offSite (Meta), onSite; Edit on offSite only: remove 1003, add 1004 | offSite modal opens pre-populated with global Hero SKUs {1001,1002,1003}; After save, offSite channel Hero SKUs = {1001,1002,1004}; onSite channel Hero SKUs re… | TC-CHAN-001 (E2E/Critical) |
| DC-002 | Global Hero SKUs: 2001,2002; Channel: offSite (Meta) | Modal shows Hero SKUs {2001,2002} pre-selected (mirrors the global Hero list); No additional or missing SKUs versus the global Hero list | TC-CHAN-002 (UI/High) |
| DC-003 | Prompt: "offSite: Meta, 40k, 20-25/03/2026, skus 12345, 234235"; Channel: offSite (Meta), budget 40k, dates 20-25/03/2026; Defined SKUs: 12345, 234235 | offSite (Meta) channel is created with budget 40k and dates 20-25/03/2026; The channel's assigned SKUs = exactly the user-defined set {12345, 234235}; Global H… | TC-CHAN-003 (E2E/Critical) |
| DC-004 | Global Hero SKUs: 3001,3002,3003; Prompt: "offSite: Meta, 40k, 20-25/03/2026" (no skus clause) | The SKU-processing node detects no user-defined SKUs for the channel; All global Hero SKUs {3001,3002,3003} are assigned to the offSite channel | TC-CHAN-004 (Integration/High) |
| DC-005 | Global Hero SKUs: 4001,4002; Channel A prompt: offSite: Meta, 40k, 20-25/03/2026, skus 9001, 9002; Channel B prompt: onSite, 30k, 20-25/03/2026 (no skus clause) | Channel A (offSite/Meta) assigned SKUs = {9001,9002} (user-defined only); Channel B (onSite) assigned SKUs = global Hero set {4001,4002} (defaulted because non… | TC-CHAN-005 (E2E/High) |
| DC-006 | SKU 5005, initial is_hero=False; Channel: offSite (Meta) | The update method runs on channel modification; StateData.campaign_skus[5005].is_hero == True; The union of Hero SKUs across channels now includes 5005 | TC-CHAN-006 (Integration/Critical) |
| DC-007 | offSite Hero: 6001,6002; onSite Hero: 6001; Unique Hero SKU on offSite only: 6002; Delete channel: offSite (Meta) | 6002 no longer used as Hero by any remaining channel → StateData.campaign_skus[6002].is_hero == False; 6001 still Hero on onSite → StateData.campaign_skus[6001… | TC-CHAN-007 (Integration/Critical) |
| DC-008 | offSite Hero: 7001,7002; onSite Hero: 7001,7002; Delete channel: offSite (Meta) | 7001 and 7002 still used as Hero by onSite → both retain is_hero == True; Unique Hero SKU count stays at 2; No SKU flipped to is_hero=False because none became… | TC-CHAN-008 (Integration/High) |
| DC-009 | offSite Hero before: 8001,8002; Modify offSite: deselect 8002 | 8002 is no longer Hero on any channel → StateData.campaign_skus[8002].is_hero == False; 8001 still Hero on offSite → is_hero remains True; Hero count for the p… | TC-CHAN-009 (Integration/High) |
| DC-010 | Configured max = 3 (assumption; parameterize); Hero SKUs assigned to offSite: 1001,1002,1003 (count = 3) | Channel added to the summary panel with all 3 selected SKUs; NO warning shown (count <= max); Booking/Save is NOT blocked | TC-CHAN-010 (E2E/High) |
| DC-011 | Configured max = 3 (assumption); Hero SKUs assigned: 1001,1002 (count = 2 = max-1) | Channel added with both SKUs; NO warning shown; Booking/Save allowed | TC-CHAN-011 (E2E/Medium) |
| DC-012 | Configured max = 3 (assumption); Hero SKUs assigned: 1001,1002,1003,1004 (count = 4 = max+1) | Channel is still ADDED to the summary panel with all 4 selected SKUs; Warning shown with EXACT text: "Media limit: 3 Hero SKUs. Edit SKUs"; User is BLOCKED fro… | TC-CHAN-012 (E2E/Critical) |
| DC-013 | Configured max = 3; Current Hero: 1001,1002,1003,1004 (4); Deselect 1004 to reach 3 | After reaching 3 (== max), the 'Media limit' warning is removed; Booking/Save is now ENABLED; offSite Hero SKUs = {1001,1002,1003} | TC-CHAN-013 (E2E/Critical) |
| DC-014 | maxHeroSkus = unset; Hero SKUs assigned: 1001,1002,1003,1004,1005,1006 (6, arbitrarily large) | Channel added with all 6 SKUs; NO 'Media limit' warning shown; No restriction — booking/Save allowed regardless of count | TC-CHAN-014 (E2E/High) |
| DC-015 | Global Hero: 1001,1002,1003,1004 (4); offSite max = 3 | offSite channel is still ADDED with all global Hero SKUs; Warning shown indicating the max and that the selection exceeds it: "Media limit: 3 Hero SKUs. Edit S… | TC-CHAN-015 (E2E/Critical) |
| DC-016 | Single channel: offSite (Meta), max=3; Hero count = 4 | Backend detects maxHeroSkus exceeded after activation; The single channel is BLOCKED from being added; User is informed of the limit; Flow routes to the ask no… | TC-CHAN-016 (Integration/High) |
| DC-017 | offSite (Meta): max=3, Hero=4 (exceeds); onSite: within max | offSite (the exceeding channel) is BLOCKED from being added; user informed; Flow CONTINUES with the other resolver nodes (onSite) since more than one channel w… | TC-CHAN-017 (Integration/High) |
| DC-018 | minHeroSkus = 1 (assumption; parameterize); Hero count = 0 | Backend detects Hero count below minHeroSkus; Channel is blocked from being added; User is informed; if single channel typed, routes to ask node | TC-CHAN-018 (Integration/Medium) |
| DC-019 | Measurement: 1001,1002,1003; Hero: 1002 | Row for 1002 shows the 'Hero SKU' indicator; Rows for 1001 and 1003 do NOT show the indicator | TC-CHAN-019 (UI/High) |
| DC-020 | SKU 1003 toggled Hero then un-Hero | After assign: 'Hero SKU' indicator appears on 1003 in real time (no refresh); After unassign: the indicator is removed from 1003 in real time | TC-CHAN-020 (UI/High) |
| DC-021 | Measurement before: 1001,1002 (2); Assign non-Measurement SKU 1009 as Hero | 1009 auto-added to Measurement SKUs → Measurement count grows from 2 to 3; Hero count tracks selection → 1 (just 1009); Summary panel and tables reflect update… | TC-CHAN-021 (E2E/High) |
| DC-022 | Prompt: "1, 2, 3, 4 and hero skus 3, 5, 6"; Expected Measurement = {1,2,3,4,5,6}; Expected Hero = {3,5,6} | Measurement SKUs = {1,2,3,4,5,6} (5 and 6 auto-added since they were Hero but not in original Measurement); Hero SKUs = {3,5,6}; SKU 3 is both Measurement and … | TC-CHAN-022 (E2E/Critical) |
| DC-023 | Brand-linked SKUs: 1001,1002,1009,1010; Measurement subset: 1001,1002 | Modal lists ALL brand-linked SKUs {1001,1002,1009,1010}; Non-Measurement SKUs 1009,1010 are selectable as Hero candidates | TC-CHAN-023 (UI/Medium) |
| DC-024 | Assign non-Measurement SKU 1009 as Hero on offSite | 1009 auto-added to Measurement SKUs → Measurement count grows to 2; StateData.campaign_skus[1009].is_hero == True; offSite channel Hero set includes 1009; Summ… | TC-CHAN-024 (E2E/High) |
| DC-025 | Remove 1002 from offSite only; 1002 remains Hero on onSite | 1002 is still Hero on onSite → StateData.campaign_skus[1002].is_hero remains True; offSite Hero set no longer contains 1002 (isolated to offSite); Unique Hero … | TC-CHAN-025 (Integration/High) |
| DC-026 | Prompt: offSite: Meta, 40k, 20-25/03/2026, skus 12345, 234235; Measurement before: 1001 | offSite channel assigned SKUs = {12345, 234235}; Any defined SKU not already in Measurement is auto-added to Measurement per the auto-add rule; Measurement set… | TC-CHAN-026 (E2E/Medium) |
| DC-027 | offSite Hero: 1001; Delete offSite (Meta) | No channel uses 1001 as Hero → StateData.campaign_skus[1001].is_hero == False; Unique Hero count drops from 1 to 0; Hero count in summary reflects 0 | TC-CHAN-027 (Integration/Medium) |
| DC-028 | Global Hero: 5,6; Prompt: 'offSite: Meta, 40k, 20-25/03/2026, skus 12345, 234235; onSite, 30k, 20-25/03/2026'; Meta defines skus 12345,234235; onSite defines n… | offSite Meta assigned SKUs = exactly {12345, 234235} (its defined set); global Hero 5,6 are NOT force-added to Meta.; onSite assigned SKUs = global Hero set {5… | TC-CHAN-028 (E2E/High) |
| DC-029 | minHeroSkus = 1; Deselect 1001 -> Hero count 0 (below min) | The channel falls below minHeroSkus on save; the user is informed of the min requirement.; The plan cannot proceed/book with the channel below its min (consist… | TC-CHAN-029 (E2E/Medium) |
| DC-030 | Run 1 (single): type only offSite Meta with Hero 1,2,3,4 (exceeds) -> expect block + ask node; Run 2 (multi): type offSite Meta with Hero 1,2,3,4 (exceeds) AND… | Run 1: Meta blocked, no other channel, flow routes to the ask node.; Run 2: Meta blocked, onSite added, flow continues with other resolver nodes (NOT the ask n… | TC-CHAN-030 (Integration/Medium) |

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
      "sourceCaseId": "TC-CHAN-003",
      "title": "Per-channel SKU definition in chat single prompt assigns the defined SKUs to that channel",
      "technique": [
        "Positive",
        "Cross-Field"
      ],
      "preconditions": [
        "Logged into Nectar AI Media Planner with brand and Measurement SKUs context established",
        "Chat ready to accept channel definitions"
      ],
      "testData": [
        "Prompt: \"offSite: Meta, 40k, 20-25/03/2026, skus 12345, 234235\"",
        "Channel: offSite (Meta), budget 40k, dates 20-25/03/2026",
        "Defined SKUs: 12345, 234235"
      ],
      "steps": [
        "1. Send the chat prompt: offSite: Meta, 40k, 20-25/03/2026, skus 12345, 234235",
        "2. Wait for the assistant resolver + SKU-processing node to complete (30-60s)",
        "3. Open the offSite (Meta) channel and inspect assigned SKUs"
      ],
      "expectedText": [
        "offSite (Meta) channel is created with budget 40k and dates 20-25/03/2026",
        "The channel's assigned SKUs = exactly the user-defined set {12345, 234235}",
        "Global Hero SKUs are NOT force-assigned to this channel because the user explicitly defined SKUs for it"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-003 E2E/Critical"
  },
  {
    "caseId": "DC-004",
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
    "caseId": "DC-005",
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
    "caseId": "DC-006",
    "inputs": {
      "sourceCaseId": "TC-CHAN-006",
      "title": "Adding a SKU as Hero to a channel sets is_hero=True in StateData.campaign_skus",
      "technique": [
        "State-Recompute",
        "Data-Persistence"
      ],
      "preconditions": [
        "Media plan with campaign_skus including SKU 5005 currently with is_hero=False",
        "Channel offSite (Meta) exists"
      ],
      "testData": [
        "SKU 5005, initial is_hero=False",
        "Channel: offSite (Meta)"
      ],
      "steps": [
        "1. Open offSite (Meta) channel edit modal",
        "2. Assign SKU 5005 as a Hero SKU for that channel",
        "3. Save the modal so the StateData update method runs",
        "4. Inspect StateData.campaign_skus entry for 5005"
      ],
      "expectedText": [
        "The update method runs on channel modification",
        "StateData.campaign_skus[5005].is_hero == True",
        "The union of Hero SKUs across channels now includes 5005"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-006 Integration/Critical"
  },
  {
    "caseId": "DC-007",
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
    "caseId": "DC-008",
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
    "caseId": "DC-009",
    "inputs": {
      "sourceCaseId": "TC-CHAN-009",
      "title": "Modifying a channel to remove a Hero SKU re-syncs is_hero across remaining channels",
      "technique": [
        "State-Recompute",
        "Data-Persistence"
      ],
      "preconditions": [
        "Single channel offSite (Meta) with Hero {8001,8002}",
        "SKU 8002 is Hero only on offSite",
        "StateData.campaign_skus: 8001 is_hero=True, 8002 is_hero=True"
      ],
      "testData": [
        "offSite Hero before: 8001,8002",
        "Modify offSite: deselect 8002"
      ],
      "steps": [
        "1. Open offSite (Meta) edit modal",
        "2. Deselect Hero SKU 8002 (keep 8001)",
        "3. Save the modal so the update method runs on modification",
        "4. Inspect is_hero for 8001 and 8002"
      ],
      "expectedText": [
        "8002 is no longer Hero on any channel → StateData.campaign_skus[8002].is_hero == False",
        "8001 still Hero on offSite → is_hero remains True",
        "Hero count for the plan reflects the reduced Hero set"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-009 Integration/High"
  },
  {
    "caseId": "DC-010",
    "inputs": {
      "sourceCaseId": "TC-CHAN-010",
      "title": "Assign exactly max Hero SKUs to a channel (count == max) — channel added, no warning, booking allowed",
      "technique": [
        "Boundary-BVA",
        "Positive"
      ],
      "preconditions": [
        "Channel offSite (Meta) configured with maxHeroSkus = 3 (parameterized; assumption: max=3 per example in spec)"
      ],
      "testData": [
        "Configured max = 3 (assumption; parameterize)",
        "Hero SKUs assigned to offSite: 1001,1002,1003 (count = 3)"
      ],
      "steps": [
        "1. Assign exactly 3 Hero SKUs (1001,1002,1003) to offSite (Meta)",
        "2. Wait for channel activation/backend check",
        "3. Inspect summary panel and booking control"
      ],
      "expectedText": [
        "Channel added to the summary panel with all 3 selected SKUs",
        "NO warning shown (count <= max)",
        "Booking/Save is NOT blocked"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-010 E2E/High"
  },
  {
    "caseId": "DC-011",
    "inputs": {
      "sourceCaseId": "TC-CHAN-011",
      "title": "Assign max-1 Hero SKUs to a channel (count < max) — channel added, no warning",
      "technique": [
        "Boundary-BVA",
        "Positive"
      ],
      "preconditions": [
        "Channel offSite (Meta) configured with maxHeroSkus = 3 (parameterized)"
      ],
      "testData": [
        "Configured max = 3 (assumption)",
        "Hero SKUs assigned: 1001,1002 (count = 2 = max-1)"
      ],
      "steps": [
        "1. Assign 2 Hero SKUs (1001,1002) to offSite (Meta)",
        "2. Wait for activation/backend check",
        "3. Inspect summary panel and booking control"
      ],
      "expectedText": [
        "Channel added with both SKUs",
        "NO warning shown",
        "Booking/Save allowed"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-011 E2E/Medium"
  },
  {
    "caseId": "DC-012",
    "inputs": {
      "sourceCaseId": "TC-CHAN-012",
      "title": "Assign max+1 Hero SKUs to a channel (count > max) — channel added with all SKUs, warning shown, booking blocked",
      "technique": [
        "Boundary-BVA",
        "Negative",
        "Error-Message"
      ],
      "preconditions": [
        "Channel offSite (Meta) configured with maxHeroSkus = 3 (parameterized)"
      ],
      "testData": [
        "Configured max = 3 (assumption)",
        "Hero SKUs assigned: 1001,1002,1003,1004 (count = 4 = max+1)"
      ],
      "steps": [
        "1. Assign 4 Hero SKUs (1001,1002,1003,1004) to offSite (Meta)",
        "2. Wait for activation/backend check",
        "3. Inspect summary panel, warning area, and booking control",
        "4. Attempt to book/save the plan"
      ],
      "expectedText": [
        "Channel is still ADDED to the summary panel with all 4 selected SKUs",
        "Warning shown with EXACT text: \"Media limit: 3 Hero SKUs. Edit SKUs\"",
        "User is BLOCKED from booking/saving the plan until selection meets the max",
        "Booking control disabled or save rejected"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-012 E2E/Critical"
  },
  {
    "caseId": "DC-013",
    "inputs": {
      "sourceCaseId": "TC-CHAN-013",
      "title": "Resolve over-max by deselecting excess via modal — warning clears and booking unblocks",
      "technique": [
        "State-Recompute",
        "Error-Message",
        "Positive"
      ],
      "preconditions": [
        "Channel offSite (Meta) with maxHeroSkus = 3 currently over-assigned with 4 Hero SKUs and showing the warning, booking blocked"
      ],
      "testData": [
        "Configured max = 3",
        "Current Hero: 1001,1002,1003,1004 (4)",
        "Deselect 1004 to reach 3"
      ],
      "steps": [
        "1. Confirm warning 'Media limit: 3 Hero SKUs. Edit SKUs' is shown and booking is blocked",
        "2. Open the channel modal and deselect the excess SKU 1004 (now 3 selected)",
        "3. Save the modal",
        "4. Re-inspect warning area and booking control"
      ],
      "expectedText": [
        "After reaching 3 (== max), the 'Media limit' warning is removed",
        "Booking/Save is now ENABLED",
        "offSite Hero SKUs = {1001,1002,1003}"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-013 E2E/Critical"
  },
  {
    "caseId": "DC-014",
    "inputs": {
      "sourceCaseId": "TC-CHAN-014",
      "title": "No max configured for a channel — assigning many Hero SKUs imposes no restriction",
      "technique": [
        "Equivalence-Partition",
        "Negative",
        "Boundary-BVA"
      ],
      "preconditions": [
        "Channel onSite configured with NO maxHeroSkus (unset/null)"
      ],
      "testData": [
        "maxHeroSkus = unset",
        "Hero SKUs assigned: 1001,1002,1003,1004,1005,1006 (6, arbitrarily large)"
      ],
      "steps": [
        "1. Assign 6 Hero SKUs to onSite (a channel with no max configured)",
        "2. Wait for activation/backend check",
        "3. Inspect summary panel, warning area, and booking control"
      ],
      "expectedText": [
        "Channel added with all 6 SKUs",
        "NO 'Media limit' warning shown",
        "No restriction — booking/Save allowed regardless of count"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-014 E2E/High"
  },
  {
    "caseId": "DC-015",
    "inputs": {
      "sourceCaseId": "TC-CHAN-015",
      "title": "Global Hero list exceeds a channel's max (global-then-select-channels) — affected channel added with warning, booking blocked",
      "technique": [
        "Decision-Table",
        "Error-Message",
        "Negative"
      ],
      "preconditions": [
        "Global Hero list = {1001,1002,1003,1004} (4 SKUs)",
        "Channel offSite (Meta) configured with maxHeroSkus = 3 (parameterized)"
      ],
      "testData": [
        "Global Hero: 1001,1002,1003,1004 (4)",
        "offSite max = 3"
      ],
      "steps": [
        "1. Assign global Hero list of 4 SKUs",
        "2. Then select the offSite (Meta) channel (max 3), which pre-populates with the 4 global Hero SKUs",
        "3. Wait for activation/backend check",
        "4. Inspect summary panel, warning, booking control",
        "5. Attempt to book"
      ],
      "expectedText": [
        "offSite channel is still ADDED with all global Hero SKUs",
        "Warning shown indicating the max and that the selection exceeds it: \"Media limit: 3 Hero SKUs. Edit SKUs\"",
        "User must deselect excess per channel via modal",
        "Booking BLOCKED until each affected channel is adjusted to meet its max"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-015 E2E/Critical"
  },
  {
    "caseId": "DC-016",
    "inputs": {
      "sourceCaseId": "TC-CHAN-016",
      "title": "Backend: single typed channel exceeds maxHeroSkus on activation — block channel, go to ask node",
      "technique": [
        "Decision-Table",
        "Negative",
        "Error-Message"
      ],
      "preconditions": [
        "Only ONE channel typed in the prompt: offSite (Meta), maxHeroSkus=3",
        "Hero selection for that channel = 4 SKUs (exceeds max)"
      ],
      "testData": [
        "Single channel: offSite (Meta), max=3",
        "Hero count = 4"
      ],
      "steps": [
        "1. Type a single channel offSite (Meta) with 4 Hero SKUs",
        "2. Trigger channel activation; backend checks minHeroSkus/maxHeroSkus",
        "3. Observe resolver routing and user message"
      ],
      "expectedText": [
        "Backend detects maxHeroSkus exceeded after activation",
        "The single channel is BLOCKED from being added",
        "User is informed of the limit",
        "Flow routes to the ask node (since only one channel was typed)"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-016 Integration/High"
  },
  {
    "caseId": "DC-017",
    "inputs": {
      "sourceCaseId": "TC-CHAN-017",
      "title": "Backend: one of multiple typed channels exceeds maxHeroSkus — block that channel, continue with other resolver nodes",
      "technique": [
        "Decision-Table",
        "Negative",
        "Edge-Case"
      ],
      "preconditions": [
        "MORE than one channel typed: offSite (Meta, max=3) with 4 Hero SKUs; onSite (valid, within max)"
      ],
      "testData": [
        "offSite (Meta): max=3, Hero=4 (exceeds)",
        "onSite: within max"
      ],
      "steps": [
        "1. Type two channels in one prompt where offSite exceeds its max and onSite is valid",
        "2. Trigger activation; backend checks min/max Hero per channel",
        "3. Observe routing and which channels are added"
      ],
      "expectedText": [
        "offSite (the exceeding channel) is BLOCKED from being added; user informed",
        "Flow CONTINUES with the other resolver nodes (onSite) since more than one channel was typed",
        "onSite is processed normally"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-017 Integration/High"
  },
  {
    "caseId": "DC-018",
    "inputs": {
      "sourceCaseId": "TC-CHAN-018",
      "title": "Backend: channel below minHeroSkus on activation is blocked and user informed",
      "technique": [
        "Boundary-BVA",
        "Negative"
      ],
      "preconditions": [
        "Channel offSite (Meta) configured with minHeroSkus = 1 (parameterized; assumption)",
        "Hero selection for the channel = 0 (below min)"
      ],
      "testData": [
        "minHeroSkus = 1 (assumption; parameterize)",
        "Hero count = 0"
      ],
      "steps": [
        "1. Activate offSite (Meta) with 0 Hero SKUs (below configured min)",
        "2. Backend checks minHeroSkus/maxHeroSkus",
        "3. Observe block and message"
      ],
      "expectedText": [
        "Backend detects Hero count below minHeroSkus",
        "Channel is blocked from being added",
        "User is informed; if single channel typed, routes to ask node"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-018 Integration/Medium"
  },
  {
    "caseId": "DC-019",
    "inputs": {
      "sourceCaseId": "TC-CHAN-019",
      "title": "Hero SKU indicator appears next to Hero SKUs in the Measurement SKUs modal/table",
      "technique": [
        "Positive",
        "Cross-Field"
      ],
      "preconditions": [
        "Measurement SKUs = {1001,1002,1003}",
        "Hero SKUs = {1002} (subset of Measurement)"
      ],
      "testData": [
        "Measurement: 1001,1002,1003",
        "Hero: 1002"
      ],
      "steps": [
        "1. Open the Measurement SKUs modal/table",
        "2. Inspect each SKU row for the 'Hero SKU' indicator"
      ],
      "expectedText": [
        "Row for 1002 shows the 'Hero SKU' indicator",
        "Rows for 1001 and 1003 do NOT show the indicator"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-019 UI/High"
  },
  {
    "caseId": "DC-020",
    "inputs": {
      "sourceCaseId": "TC-CHAN-020",
      "title": "Hero SKU indicator updates in real time on assign/unassign",
      "technique": [
        "State-Recompute",
        "Positive"
      ],
      "preconditions": [
        "Measurement SKUs modal/table open",
        "SKU 1003 currently NOT Hero (no indicator)"
      ],
      "testData": [
        "SKU 1003 toggled Hero then un-Hero"
      ],
      "steps": [
        "1. Assign 1003 as Hero",
        "2. Observe the Measurement table row for 1003 without manual refresh",
        "3. Unassign 1003 as Hero",
        "4. Observe the row again"
      ],
      "expectedText": [
        "After assign: 'Hero SKU' indicator appears on 1003 in real time (no refresh)",
        "After unassign: the indicator is removed from 1003 in real time"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-020 UI/High"
  },
  {
    "caseId": "DC-021",
    "inputs": {
      "sourceCaseId": "TC-CHAN-021",
      "title": "Auto-add non-Measurement Hero increments Measurement count; summary and tables reflect updated counts",
      "technique": [
        "State-Recompute",
        "Cross-Field",
        "Data-Persistence"
      ],
      "preconditions": [
        "Measurement SKUs = {1001,1002} (count 2)",
        "Hero SKUs = {} (count 0)",
        "SKU 1009 is brand-linked but NOT a Measurement SKU"
      ],
      "testData": [
        "Measurement before: 1001,1002 (2)",
        "Assign non-Measurement SKU 1009 as Hero"
      ],
      "steps": [
        "1. Capture Measurement count (2) and Hero count (0) from summary",
        "2. Assign non-Measurement SKU 1009 as Hero",
        "3. Re-inspect summary panel and Measurement/Hero tables"
      ],
      "expectedText": [
        "1009 auto-added to Measurement SKUs → Measurement count grows from 2 to 3",
        "Hero count tracks selection → 1 (just 1009)",
        "Summary panel and tables reflect updated counts",
        "1009 shows the 'Hero SKU' indicator in the Measurement table"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-021 E2E/High"
  },
  {
    "caseId": "DC-022",
    "inputs": {
      "sourceCaseId": "TC-CHAN-022",
      "title": "Single-prompt parsing: Hero SKUs not already Measurement are auto-added to Measurement",
      "technique": [
        "Positive",
        "Cross-Field",
        "Decision-Table"
      ],
      "preconditions": [
        "Chat ready to accept a single combined prompt"
      ],
      "testData": [
        "Prompt: \"1, 2, 3, 4 and hero skus 3, 5, 6\"",
        "Expected Measurement = {1,2,3,4,5,6}",
        "Expected Hero = {3,5,6}"
      ],
      "steps": [
        "1. Send single prompt: 1, 2, 3, 4 and hero skus 3, 5, 6",
        "2. Wait for parsing/summary",
        "3. Inspect Measurement SKU set and Hero SKU set in the summary"
      ],
      "expectedText": [
        "Measurement SKUs = {1,2,3,4,5,6} (5 and 6 auto-added since they were Hero but not in original Measurement)",
        "Hero SKUs = {3,5,6}",
        "SKU 3 is both Measurement and Hero (no duplicate Measurement entry; marked Hero)"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-022 E2E/Critical"
  },
  {
    "caseId": "DC-023",
    "inputs": {
      "sourceCaseId": "TC-CHAN-023",
      "title": "Channel-level Hero modal displays all brand-linked SKUs (not only Measurement SKUs)",
      "technique": [
        "Positive",
        "Equivalence-Partition"
      ],
      "preconditions": [
        "Brand has Measurement SKUs {1001,1002} and additional brand-linked non-Measurement SKUs {1009,1010}",
        "Channel offSite (Meta) selected"
      ],
      "testData": [
        "Brand-linked SKUs: 1001,1002,1009,1010",
        "Measurement subset: 1001,1002"
      ],
      "steps": [
        "1. Open the offSite (Meta) channel-level Hero SKU modal",
        "2. Inspect the list of selectable SKUs"
      ],
      "expectedText": [
        "Modal lists ALL brand-linked SKUs {1001,1002,1009,1010}",
        "Non-Measurement SKUs 1009,1010 are selectable as Hero candidates"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-023 UI/Medium"
  },
  {
    "caseId": "DC-024",
    "inputs": {
      "sourceCaseId": "TC-CHAN-024",
      "title": "Assigning a non-Measurement SKU as channel Hero auto-adds it to Measurement and sets is_hero=True",
      "technique": [
        "State-Recompute",
        "Cross-Field",
        "Data-Persistence"
      ],
      "preconditions": [
        "Channel offSite (Meta) selected",
        "Measurement SKUs = {1001} (count 1)",
        "SKU 1009 brand-linked, non-Measurement, is_hero=False"
      ],
      "testData": [
        "Assign non-Measurement SKU 1009 as Hero on offSite"
      ],
      "steps": [
        "1. Open offSite (Meta) Hero modal",
        "2. Assign non-Measurement SKU 1009 as Hero for the channel",
        "3. Save (triggers StateData update method)",
        "4. Inspect Measurement set, is_hero flag for 1009, and counts"
      ],
      "expectedText": [
        "1009 auto-added to Measurement SKUs → Measurement count grows to 2",
        "StateData.campaign_skus[1009].is_hero == True",
        "offSite channel Hero set includes 1009",
        "Summary/tables reflect updated counts and the Hero indicator on 1009"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-024 E2E/High"
  },
  {
    "caseId": "DC-025",
    "inputs": {
      "sourceCaseId": "TC-CHAN-025",
      "title": "Edit Hero on one channel does not change is_hero for a SKU still Hero on another channel",
      "technique": [
        "State-Recompute",
        "Cross-Field",
        "Edge-Case"
      ],
      "preconditions": [
        "offSite (Meta) Hero {1001,1002}; onSite Hero {1002}",
        "SKU 1002 is Hero on both channels"
      ],
      "testData": [
        "Remove 1002 from offSite only",
        "1002 remains Hero on onSite"
      ],
      "steps": [
        "1. Open offSite (Meta) modal and deselect Hero SKU 1002",
        "2. Save (update method runs)",
        "3. Inspect is_hero for 1002 and onSite Hero set"
      ],
      "expectedText": [
        "1002 is still Hero on onSite → StateData.campaign_skus[1002].is_hero remains True",
        "offSite Hero set no longer contains 1002 (isolated to offSite)",
        "Unique Hero count unchanged because 1002 is still used somewhere"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-025 Integration/High"
  },
  {
    "caseId": "DC-026",
    "inputs": {
      "sourceCaseId": "TC-CHAN-026",
      "title": "Per-channel defined SKUs that are non-Measurement are auto-added to Measurement (single-prompt channel definition)",
      "technique": [
        "Cross-Field",
        "Edge-Case"
      ],
      "preconditions": [
        "Measurement SKUs = {1001} before the prompt",
        "SKU 234235 is brand-linked but not currently a Measurement SKU"
      ],
      "testData": [
        "Prompt: offSite: Meta, 40k, 20-25/03/2026, skus 12345, 234235",
        "Measurement before: 1001"
      ],
      "steps": [
        "1. Send the per-channel definition prompt with skus 12345, 234235",
        "2. Wait for the SKU-processing node",
        "3. Inspect offSite channel SKUs and the Measurement SKU set"
      ],
      "expectedText": [
        "offSite channel assigned SKUs = {12345, 234235}",
        "Any defined SKU not already in Measurement is auto-added to Measurement per the auto-add rule",
        "Measurement set reflects the additions and counts update in the summary"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-026 E2E/Medium"
  },
  {
    "caseId": "DC-027",
    "inputs": {
      "sourceCaseId": "TC-CHAN-027",
      "title": "Delete the only channel using a Hero SKU — is_hero=False and unique Hero count reaches zero",
      "technique": [
        "Boundary-BVA",
        "State-Recompute",
        "Edge-Case"
      ],
      "preconditions": [
        "Single channel offSite (Meta) with Hero {1001}",
        "SKU 1001 is_hero=True, used only by offSite"
      ],
      "testData": [
        "offSite Hero: 1001",
        "Delete offSite (Meta)"
      ],
      "steps": [
        "1. Capture unique Hero count = 1",
        "2. Delete the offSite (Meta) channel",
        "3. Allow update method to run",
        "4. Inspect is_hero for 1001 and unique Hero count"
      ],
      "expectedText": [
        "No channel uses 1001 as Hero → StateData.campaign_skus[1001].is_hero == False",
        "Unique Hero count drops from 1 to 0",
        "Hero count in summary reflects 0"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-027 Integration/Medium"
  },
  {
    "caseId": "DC-028",
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
  },
  {
    "caseId": "DC-029",
    "inputs": {
      "sourceCaseId": "TC-CHAN-029",
      "title": "Channel modal Hero edit: deselecting ALL Hero SKUs for a channel that has minHeroSkus configured surfaces the min violation on save",
      "technique": [
        "Boundary-BVA",
        "Negative",
        "Error-Message"
      ],
      "preconditions": [
        "Channel offSite (Meta) configured with minHeroSkus = 1.",
        "offSite Meta currently has Hero {1001} (at min)."
      ],
      "testData": [
        "minHeroSkus = 1",
        "Deselect 1001 -> Hero count 0 (below min)"
      ],
      "steps": [
        "1. Open the offSite Meta channel modal.",
        "2. Deselect SKU 1001 so the channel has 0 Hero SKUs (below min 1).",
        "3. Attempt to save the modal.",
        "4. Inspect the resulting state/message and booking control."
      ],
      "expectedText": [
        "The channel falls below minHeroSkus on save; the user is informed of the min requirement.",
        "The plan cannot proceed/book with the channel below its min (consistent with the NUP-20507 min check).",
        "Re-selecting at least 1 Hero SKU clears the violation."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-029 E2E/Medium"
  },
  {
    "caseId": "DC-030",
    "inputs": {
      "sourceCaseId": "TC-CHAN-030",
      "title": "Single-channel block vs multi-channel continue: side-by-side decision-table confirming routing differs only by typed-channel COUNT, not by which channel violates",
      "technique": [
        "Decision-Table",
        "Negative"
      ],
      "preconditions": [
        "Backend min/max check runs after channel activation.",
        "offSite Meta maxHeroSkus = 3."
      ],
      "testData": [
        "Run 1 (single): type only offSite Meta with Hero 1,2,3,4 (exceeds) -> expect block + ask node",
        "Run 2 (multi): type offSite Meta with Hero 1,2,3,4 (exceeds) AND onSite with Hero 1,2 (valid) -> expect Meta blocked, onSite continues"
      ],
      "steps": [
        "1. Run 1: send a single-channel prompt where Meta exceeds max; record routing (ask node?) and whether Meta added.",
        "2. Run 2: send a multi-channel prompt where Meta exceeds max and onSite is valid; record routing and which channels added.",
        "3. Compare the two runs."
      ],
      "expectedText": [
        "Run 1: Meta blocked, no other channel, flow routes to the ask node.",
        "Run 2: Meta blocked, onSite added, flow continues with other resolver nodes (NOT the ask node).",
        "The ONLY difference driving the routing is the count of typed channels (one vs more-than-one), with the same violating channel."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-CHAN-030 Integration/Medium"
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| advertiser | N360_Unilever_MS | Non-production advertiser (data/media-planner.ts) |
| brand | Unilever \| Knorr \| MS | Non-production brand |
| dataManager | fixtures/test-data-manager.ts | API helpers to seed channel/SKU preconditions |
| salientCopy | Hero, Edit | Salient strings the generated tests must assert |

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
| 2 | AC-002 | Seed the channels and their Hero SKUs via API | dataManager.setPlanHeroSkus | plan; channel; case Hero SKUs | Each channel starts from the case-defined Hero selection | precondition helper resolves without error |
| 3 | AC-003 | Select advertiser and brand | Guided planner controls | advertiser; brand; Confirm | Advertiser and brand are shown on the summary panel | advertiser and brand visible on summary |
| 4 | AC-004 | Open the channel Hero edit modal for the channel under test | Summary panel channel row; Edit | channel; Edit Hero | The per-channel Hero edit modal is shown with the current selection | edit modal is visible with the channel selection |
| 5 | AC-005 | Apply the case's per-channel edit or deletion | Edit modal | case edit/delete; Apply | The edit or deletion is applied to the channel | channel selection reflects the edit |
| 6 | AC-006 | Verify per-channel persistence and deletion sync | Summary panel channel rows and counts | n/a | The edited channel reflects the change, deletions sync to all affected channels and recompute counts, and other channels are unchanged | channels and counts match the case |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | Delete a Hero SKU shared by two channels | Both channels drop the SKU and recompute; no channel retains the deleted SKU |
| NEG-002 | Cancel a per-channel Hero edit | The channel keeps its prior selection and no other channel is affected |

## Acceptance Criteria

- AC-001: The guided flow is active
- AC-002: Each channel starts from the case-defined Hero selection
- AC-003: Advertiser and brand are shown on the summary panel
- AC-004: The per-channel Hero edit modal is shown with the current selection
- AC-005: The edit or deletion is applied to the channel
- AC-006: The edited channel reflects the change, deletions sync to all affected channels and recompute counts, and other channels are unchanged

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
- Must assert the salient expected values "Hero", "Edit".
- Must not use page.waitForTimeout, networkidle, XPath, test.only, or any form of skip; must not use real credentials or commit auth state.

## Notes

- This suite targets the live Pollen development environment; `Parallel Safe` is `no` and `Data Isolation` is `external`.
- The 30 Data Cases are transformed from specs/test-cases-skus-2.yaml (area: Channel-level Hero edit, per-channel SKU definition and deletion sync); each carries its source case id in notes for traceability.
- Several cases depend on test-data management helpers that are not yet implemented (see fixtures/test-data-manager.ts `MISSING_TEST_DATA_FUNCTIONS`); those tests will fail loudly until the helpers are wired.
- AUTHORING CAVEAT: authored without a live DOM-discovery snapshot. Run `npm run ai:dom:discover` against `/planning` and heal locators before treating generated tests as green.
