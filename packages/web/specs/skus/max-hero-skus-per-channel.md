# Flow: Maximum Hero SKUs per channel validation

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-SKU-MAX |
| Spec Version | 2.0.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/skus/max-hero-skus-per-channel.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @max-hero-skus-per-channel |
| Generation Mode | suite |
| Review Status | human-reviewed |
| Generation Source | manual-test-case |
| Generation Status | pending-generation |

## User Story

As a media planner,
I want the Nectar AI planner to enforce maximum hero skus per channel validation correctly,
So that Hero/Measurement SKU selections behave deterministically (0 of the 39 documented cases are automated end-to-end today; the rest are enumerated under Pending Automation).

## Preconditions

- A valid non-production authenticated Playwright storage state (`playwright/.auth/user.json`).
- `PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.pollen.js-devops.co.uk/`.
- The advertiser, brand and a brand-linked catalogue with the case SKUs are available.
- The channel under test can have its maxHeroSkus configured via the implemented dataManager.setChannelMaxHeroSkus (captured admin_editMedia contract).

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
| RULE-001 | A channel blocks booking when its assigned Hero SKU count exceeds the configured maxHeroSkus | bookable = heroCount <= channel.maxHeroSkus; over-limit warning shown when heroCount > channel.maxHeroSkus | Booking stays blocked until heroCount <= maxHeroSkus |
| RULE-002 | The over-limit warning numeral is data-driven and equals the configured maxHeroSkus | warning == 'Media limit: ' + channel.maxHeroSkus + ' Hero SKUs. Edit SKUs' | A numeral hardcoded to 3 (not tracking maxHeroSkus) is a defect |
| RULE-003 | A channel is still added with all selected Hero SKUs when over the limit; only booking is gated | channelAdded == true regardless of heroCount; only bookable is gated on the count | Silently dropping over-limit SKUs instead of warning is a defect |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | maxHeroSkus = 2; Hero assigned: 1,2,3 (count == max+1 == 3); Verbatim warning expected: 'Media limit: 2 Hero SKUs. Edit SKUs' (numeral == configured max 2, NOT… | Warning text is EXACTLY 'Media limit: 2 Hero SKUs. Edit SKUs' - the numeral equals the configured maxHeroSkus (2).; The numeral is NOT hardcoded to 3 (the spec… | TC-MAX-001 (E2E/High) |
| DC-002 | channel=Sponsored Search; maxHeroSkus=3; selected Hero SKUs=2 (SKU-1001, SKU-1002) | Channel 'Sponsored Search' is added to the summary panel with both selected Hero SKUs; No 'Media limit' warning is displayed; User is allowed to proceed to boo… | TC-MAX-002 (E2E/High) |
| DC-003 | channel=Sponsored Search; maxHeroSkus=3; selected Hero SKUs=3 (SKU-1001, SKU-1002, SKU-1003) | Channel added to summary panel with all 3 Hero SKUs; No 'Media limit' warning displayed (count == max is allowed, 'equal to or less than'); Booking/save is NOT… | TC-MAX-003 (E2E/Critical) |
| DC-004 | channel=Sponsored Search; maxHeroSkus=3; selected Hero SKUs=4 (SKU-1001..SKU-1004) | Channel 'Sponsored Search' IS added to the summary panel with ALL 4 selected Hero SKUs; Warning is displayed with EXACT text: "Media limit: 3 Hero SKUs. Edit S… | TC-MAX-004 (E2E/Critical) |
| DC-005 | channel=Sponsored Search; maxHeroSkus=3; selected Hero SKUs=8 (SKU-1001..SKU-1008) | All 8 selected Hero SKUs appear in the summary panel for the channel; Warning displayed with EXACT text: "Media limit: 3 Hero SKUs. Edit SKUs"; Booking/save is… | TC-MAX-005 (E2E/High) |
| DC-006 | channel=Sponsored Search; maxHeroSkus=3; minHeroSkus=0; selected Hero SKUs=0 | Channel added to summary panel with no Hero SKUs; No 'Media limit' maximum warning displayed; User is not blocked by the maximum rule (assuming minHeroSkus=0) | TC-MAX-006 (E2E/Medium) |
| DC-007 | channel=Affiliate; maxHeroSkus=1; selected Hero SKUs=1 (SKU-2001) | Channel added with 1 Hero SKU; No 'Media limit' warning displayed; Booking/save not blocked | TC-MAX-007 (E2E/High) |
| DC-008 | channel=Affiliate; maxHeroSkus=1; selected Hero SKUs=2 (SKU-2001, SKU-2002) | Channel added to summary panel with both Hero SKUs; Warning displayed with EXACT text: "Media limit: 1 Hero SKUs. Edit SKUs"; Booking/save blocked until reduce… | TC-MAX-008 (E2E/Critical) |
| DC-009 | channel=Display; maxHeroSkus=5; selected Hero SKUs=6 (SKU-3001..SKU-3006) | Warning displayed with EXACT text: "Media limit: 5 Hero SKUs. Edit SKUs"; Channel still added with all 6 SKUs; booking blocked | TC-MAX-009 (UI/High) |
| DC-010 | channel=Sampling; maxHeroSkus=null; selected Hero SKUs=10 (SKU-4001..SKU-4010) | Channel added to summary panel with all 10 Hero SKUs; No 'Media limit' warning is ever displayed; User is not blocked; booking/save proceeds | TC-MAX-010 (E2E/High) |
| DC-011 | channel=Sampling; maxHeroSkus=null; selected Hero SKUs=3 | No warning shown (null max must not coincidentally apply a default like 3); Booking not blocked | TC-MAX-011 (Integration/Low) |
| DC-012 | channel=Sponsored Search; maxHeroSkus=3; initial Hero SKUs=5 (SKU-1001..SKU-1005); deselect 2 → final 3 | Modal opens listing the channel's selected Hero SKUs; After applying with 3 SKUs, the "Media limit: 3 Hero SKUs. Edit SKUs" warning is removed; Booking/save is… | TC-MAX-012 (E2E/Critical) |
| DC-013 | channel=Sponsored Search; maxHeroSkus=3; initial=5; deselect 1 → final 4 | Warning still shown with EXACT text: "Media limit: 3 Hero SKUs. Edit SKUs"; Booking/save remains blocked (4 > 3) | TC-MAX-013 (E2E/High) |
| DC-014 | channel=Sponsored Search; maxHeroSkus=3; initial=4; deselect 1 → final 3 | Warning is cleared at count==max (3); Booking/save unblocked; Channel retains exactly 3 Hero SKUs | TC-MAX-014 (E2E/High) |
| DC-015 | global Hero SKUs=5; channel=Sponsored Search; maxHeroSkus=3 | Channel is still added to the summary panel with all 5 global Hero SKUs; Warning displayed for the channel with EXACT text: "Media limit: 3 Hero SKUs. Edit SKU… | TC-MAX-015 (E2E/Critical) |
| DC-016 | global Hero SKUs=5; channelA=Sponsored Search (max=3); channelB=Affiliate (max=1) | Both channels added to summary panel with all 5 SKUs each; 'Sponsored Search' shows EXACT: "Media limit: 3 Hero SKUs. Edit SKUs"; 'Affiliate' shows EXACT: "Med… | TC-MAX-016 (E2E/Critical) |
| DC-017 | global Hero SKUs=3; Sponsored Search max=3 (within); Affiliate max=1 (exceeded) | 'Sponsored Search' shows NO warning (3 == its max); 'Affiliate' shows EXACT: "Media limit: 1 Hero SKUs. Edit SKUs"; Booking blocked due to 'Affiliate' only; un… | TC-MAX-017 (E2E/High) |
| DC-018 | Display: max=5, assigned=4 (ok); Sponsored Search: max=3, assigned=4 (over) | 'Display' shows no warning; 'Sponsored Search' shows EXACT: "Media limit: 3 Hero SKUs. Edit SKUs"; The entire plan's booking/save is blocked because one channe… | TC-MAX-018 (E2E/Critical) |
| DC-019 | typed channels=1 ('Sponsored Search'); resolved maxHeroSkus=3; selected Hero SKUs=4 | Channel is NOT added (blocked) because 4 > maxHeroSkus(3); User is informed of the limit; Because only ONE channel was typed, the flow is blocked and routed to… | TC-MAX-019 (Integration/Critical) |
| DC-020 | typed channels=2 ('Sponsored Search' over with 4, 'Display' ok with 3); Sponsored Search max=3; Display max=5 | 'Sponsored Search' is blocked from being added and the user is informed of its limit; 'Display' is processed normally (within max); Because MORE than one chann… | TC-MAX-020 (Integration/Critical) |
| DC-021 | typed channels=1; minHeroSkus=2; selected Hero SKUs=1 (below min) | Channel is blocked from being added because 1 < minHeroSkus(2); User is informed of the minimum requirement; Single channel => flow routed to ask node | TC-MAX-021 (Integration/High) |
| DC-022 | Sponsored Search: 3 Hero SKUs (==max); Display: 4 Hero SKUs (within) | Both channels are added (no block); No limit-violation message is shown; Flow continues normally through resolver nodes | TC-MAX-022 (Integration/Medium) |
| DC-023 | typed channels=1 ('Sampling'); maxHeroSkus=null; selected Hero SKUs=12 | Channel 'Sampling' is added; No limit block or informing message is produced; Flow continues normally (no ask-node diversion for limits) | TC-MAX-023 (Integration/High) |
| DC-024 | channel=Sponsored Search; max=3; start=3 → add 1 → 4 | Warning reappears with EXACT text: "Media limit: 3 Hero SKUs. Edit SKUs"; Booking/save is blocked again | TC-MAX-024 (E2E/Medium) |
| DC-025 | channel=Sponsored Search; minHeroSkus=2; maxHeroSkus=3; selected Hero SKUs=1 (below min) | User is informed that the channel requires at least minHeroSkus(2); Booking/save is blocked until at least 2 Hero SKUs are assigned; Assigning a 2nd Hero SKU (… | TC-MAX-025 (E2E/Medium) |
| DC-026 | channel=Sponsored Search; max=3; assigned=4 | A SKU editing modal opens for 'Sponsored Search'; The modal lists the channel's currently selected Hero SKUs (the 4 assigned); Edits are scoped to this channel… | TC-MAX-026 (UI/Medium) |
| DC-027 | channel=Sponsored Search; max=3; assigned=4 | Booking/Save is prevented; the plan is not booked/saved; The over-limit warning "Media limit: 3 Hero SKUs. Edit SKUs" remains and the user is directed to fix t… | TC-MAX-027 (E2E/High) |
| DC-028 | Channel: offSite Meta, maxHeroSkus = 3; Hero assigned: 1,2,3 (count == max == 3) | Channel is added to the summary panel with all 3 SKUs (1,2,3).; NO 'Media limit' warning is shown (count == max is within limit).; Booking/saving is NOT blocke… | TC-MAX-028 (E2E/High) |
| DC-029 | maxHeroSkus = 3; Hero assigned: 1,2 (count == max-1 == 2) | Channel added with 2 SKUs.; No 'Media limit' warning.; Booking not blocked. | TC-MAX-029 (E2E/Medium) |
| DC-030 | maxHeroSkus = 3; Hero assigned: 1,2,3,4 (count == max+1 == 4); Verbatim warning expected: 'Media limit: 3 Hero SKUs. Edit SKUs' | Channel IS still added to the summary panel WITH all 4 selected SKUs (the channel is not dropped).; A warning is shown with EXACT text: 'Media limit: 3 Hero SK… | TC-MAX-030 (E2E/Critical) |
| DC-031 | Channel: onSite, maxHeroSkus = unset/null; Hero assigned: 1,2,3,4,5,6 (count 6, arbitrarily large) | Channel added with all 6 SKUs.; NO 'Media limit' warning shown (no max means no restriction).; Booking/saving NOT blocked regardless of count. | TC-MAX-031 (E2E/High) |
| DC-032 | maxHeroSkus = 1; Step A Hero assigned: 1 (count == max == 1); Step B Hero assigned: 1,2 (count == max+1 == 2); Verbatim warning expected at step B: 'Media limi… | After step 1 (count == 1 == max): channel added, no warning, booking allowed.; After step 2 (count == 2 == max+1): channel still added with both SKUs, warning … | TC-MAX-032 (E2E/Medium) |
| DC-033 | offSite Meta: Hero 1,2,3,4 (count 4 > max 3) -> warned; onSite: Hero 1,2,3 (count 3 < max 5) -> clean; Verbatim warning on Meta: 'Media limit: 3 Hero SKUs. Edi… | offSite Meta shows the 'Media limit: 3 Hero SKUs. Edit SKUs' warning; onSite shows NO warning.; Booking is BLOCKED at the plan level because at least one chann… | TC-MAX-033 (E2E/High) |
| DC-034 | Global Hero: 1,2,3,4 (count 4); offSite Meta max = 3 -> exceeded (4 > 3); onSite max = 4 -> at limit (4 == 4), not exceeded; Verbatim warning on Meta: 'Media l… | offSite Meta (4 > 3) shows the warning 'Media limit: 3 Hero SKUs. Edit SKUs'.; onSite (4 == 4) shows NO warning (count equals its max, within limit).; Booking … | TC-MAX-034 (E2E/High) |
| DC-035 | maxHeroSkus = 3; Deselect SKU 4 -> remaining Hero 1,2,3 (count == max == 3) | The 'Media limit: 3 Hero SKUs. Edit SKUs' warning is removed.; Channel now shows 3 Hero SKUs (1,2,3).; Booking/saving is unblocked (control enabled). | TC-MAX-035 (E2E/Critical) |
| DC-036 | maxHeroSkus = 3; Deselect SKUs 3 and 4 -> remaining Hero 1,2 (count == max-1 == 2) | Warning cleared.; Channel shows 2 Hero SKUs.; Booking unblocked (any count <= max clears the block, not only count == max). | TC-MAX-036 (E2E/Medium) |
| DC-037 | Single channel typed: offSite Meta with Hero 1,2,3,4; maxHeroSkus = 3 | Adding the channel is BLOCKED (maxHeroSkus exceeded after activation) - distinct from the front-end summary-panel behaviour where the channel IS added with a w… | TC-MAX-037 (Integration/High) |
| DC-038 | Channels typed: offSite Meta (Hero 1,2,3,4 -> exceeds), onSite (Hero 1,2 -> within); maxHeroSkus = 3 each | offSite Meta (exceeds max) is BLOCKED from being added; the user is informed.; Because MORE than one channel was typed, the flow does NOT go to the ask node; i… | TC-MAX-038 (Integration/High) |
| DC-039 | minHeroSkus = 1 (parameterized); Hero count = 0 (below min) | Backend detects Hero count below minHeroSkus.; Channel is blocked from being added; user is informed.; If only this single channel was typed, the flow routes t… | TC-MAX-039 (Integration/Medium) |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "sourceCaseId": "TC-MAX-001",
      "title": "FIX: max+1 boundary warning numeral must equal the configured max, not a literal 3 (re-baselines IND-018/CHAN-012 assertion)",
      "technique": [
        "Boundary-BVA",
        "Error-Message",
        "Negative"
      ],
      "preconditions": [
        "Channel offSite (Meta) configured with maxHeroSkus = 2 (deliberately NOT 3, to prove the numeral is data-driven).",
        "Brand-linked catalogue includes SKUs 1,2,3."
      ],
      "testData": [
        "maxHeroSkus = 2",
        "Hero assigned: 1,2,3 (count == max+1 == 3)",
        "Verbatim warning expected: 'Media limit: 2 Hero SKUs. Edit SKUs' (numeral == configured max 2, NOT 3)"
      ],
      "steps": [
        "1. Configure the channel max to 2.",
        "2. Assign 3 Hero SKUs (1,2,3) to offSite Meta (exceeds max of 2).",
        "3. Apply and wait.",
        "4. Inspect the exact warning text and the booking control."
      ],
      "expectedText": [
        "Warning text is EXACTLY 'Media limit: 2 Hero SKUs. Edit SKUs' - the numeral equals the configured maxHeroSkus (2).",
        "The numeral is NOT hardcoded to 3 (the spec example value); it is interpolated from channel config.",
        "Channel still added with all 3 SKUs; booking blocked."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-001 E2E/High"
  },
  {
    "caseId": "DC-002",
    "inputs": {
      "sourceCaseId": "TC-MAX-002",
      "title": "Hero SKU count below channel max (count = max-1) — channel added, no warning",
      "technique": [
        "Boundary Value Analysis",
        "Equivalence Partitioning"
      ],
      "preconditions": [
        "Logged into Nectar AI Media Planner",
        "Channel 'Sponsored Search' configured with maxHeroSkus=3, minHeroSkus=0 (assumption: max=3 per ticket example)"
      ],
      "testData": [
        "channel=Sponsored Search",
        "maxHeroSkus=3",
        "selected Hero SKUs=2 (SKU-1001, SKU-1002)"
      ],
      "steps": [
        "1. Start a new media plan",
        "2. Select channel 'Sponsored Search'",
        "3. Assign exactly 2 Hero SKUs (SKU-1001, SKU-1002) to the channel",
        "4. Observe the summary panel and any warnings",
        "5. Attempt to proceed to booking/save"
      ],
      "expectedText": [
        "Channel 'Sponsored Search' is added to the summary panel with both selected Hero SKUs",
        "No 'Media limit' warning is displayed",
        "User is allowed to proceed to booking/save without being blocked"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-002 E2E/High"
  },
  {
    "caseId": "DC-003",
    "inputs": {
      "sourceCaseId": "TC-MAX-003",
      "title": "Hero SKU count equals channel max (count = max) — channel added, no warning, not blocked",
      "technique": [
        "Boundary Value Analysis"
      ],
      "preconditions": [
        "Logged in",
        "Channel 'Sponsored Search' configured with maxHeroSkus=3"
      ],
      "testData": [
        "channel=Sponsored Search",
        "maxHeroSkus=3",
        "selected Hero SKUs=3 (SKU-1001, SKU-1002, SKU-1003)"
      ],
      "steps": [
        "1. Start a new media plan",
        "2. Select channel 'Sponsored Search'",
        "3. Assign exactly 3 Hero SKUs (SKU-1001, SKU-1002, SKU-1003)",
        "4. Observe summary panel and warnings",
        "5. Attempt to proceed to booking/save"
      ],
      "expectedText": [
        "Channel added to summary panel with all 3 Hero SKUs",
        "No 'Media limit' warning displayed (count == max is allowed, 'equal to or less than')",
        "Booking/save is NOT blocked; user can proceed"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-003 E2E/Critical"
  },
  {
    "caseId": "DC-004",
    "inputs": {
      "sourceCaseId": "TC-MAX-004",
      "title": "Hero SKU count exceeds channel max by one (count = max+1) — channel added with all SKUs + exact warning + blocked",
      "technique": [
        "Boundary Value Analysis",
        "Error Guessing"
      ],
      "preconditions": [
        "Logged in",
        "Channel 'Sponsored Search' configured with maxHeroSkus=3"
      ],
      "testData": [
        "channel=Sponsored Search",
        "maxHeroSkus=3",
        "selected Hero SKUs=4 (SKU-1001..SKU-1004)"
      ],
      "steps": [
        "1. Start a new media plan",
        "2. Select channel 'Sponsored Search'",
        "3. Assign 4 Hero SKUs (SKU-1001, SKU-1002, SKU-1003, SKU-1004)",
        "4. Observe summary panel content and warning text exactly",
        "5. Attempt to proceed to booking/save without adjusting"
      ],
      "expectedText": [
        "Channel 'Sponsored Search' IS added to the summary panel with ALL 4 selected Hero SKUs",
        "Warning is displayed with EXACT text: \"Media limit: 3 Hero SKUs. Edit SKUs\"",
        "Booking/save is BLOCKED until the selection is reduced to <= 3"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-004 E2E/Critical"
  },
  {
    "caseId": "DC-005",
    "inputs": {
      "sourceCaseId": "TC-MAX-005",
      "title": "Hero SKU count far exceeds channel max (count >> max) — all SKUs retained, exact warning, blocked",
      "technique": [
        "Boundary Value Analysis",
        "Error Guessing"
      ],
      "preconditions": [
        "Logged in",
        "Channel 'Sponsored Search' configured with maxHeroSkus=3"
      ],
      "testData": [
        "channel=Sponsored Search",
        "maxHeroSkus=3",
        "selected Hero SKUs=8 (SKU-1001..SKU-1008)"
      ],
      "steps": [
        "1. Start a new media plan",
        "2. Select channel 'Sponsored Search'",
        "3. Assign 8 Hero SKUs (SKU-1001 through SKU-1008)",
        "4. Inspect summary panel for all SKUs and warning text",
        "5. Attempt to proceed to booking"
      ],
      "expectedText": [
        "All 8 selected Hero SKUs appear in the summary panel for the channel",
        "Warning displayed with EXACT text: \"Media limit: 3 Hero SKUs. Edit SKUs\"",
        "Booking/save is blocked"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-005 E2E/High"
  },
  {
    "caseId": "DC-006",
    "inputs": {
      "sourceCaseId": "TC-MAX-006",
      "title": "Zero Hero SKUs assigned (count = 0) below max — no warning, not blocked",
      "technique": [
        "Boundary Value Analysis"
      ],
      "preconditions": [
        "Logged in",
        "Channel 'Sponsored Search' configured with maxHeroSkus=3, minHeroSkus=0"
      ],
      "testData": [
        "channel=Sponsored Search",
        "maxHeroSkus=3",
        "minHeroSkus=0",
        "selected Hero SKUs=0"
      ],
      "steps": [
        "1. Start a new media plan",
        "2. Select channel 'Sponsored Search'",
        "3. Do not assign any Hero SKUs (count=0)",
        "4. Observe summary panel and warnings",
        "5. Attempt to proceed to booking"
      ],
      "expectedText": [
        "Channel added to summary panel with no Hero SKUs",
        "No 'Media limit' maximum warning displayed",
        "User is not blocked by the maximum rule (assuming minHeroSkus=0)"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-006 E2E/Medium"
  },
  {
    "caseId": "DC-007",
    "inputs": {
      "sourceCaseId": "TC-MAX-007",
      "title": "Singleton max (max=1) with exactly 1 Hero SKU — allowed, no warning",
      "technique": [
        "Boundary Value Analysis"
      ],
      "preconditions": [
        "Logged in",
        "Channel 'Affiliate' configured with maxHeroSkus=1 (assumption: singleton channel)"
      ],
      "testData": [
        "channel=Affiliate",
        "maxHeroSkus=1",
        "selected Hero SKUs=1 (SKU-2001)"
      ],
      "steps": [
        "1. Start a new media plan",
        "2. Select channel 'Affiliate' (maxHeroSkus=1)",
        "3. Assign exactly 1 Hero SKU (SKU-2001)",
        "4. Observe summary panel and warnings",
        "5. Attempt to proceed to booking"
      ],
      "expectedText": [
        "Channel added with 1 Hero SKU",
        "No 'Media limit' warning displayed",
        "Booking/save not blocked"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-007 E2E/High"
  },
  {
    "caseId": "DC-008",
    "inputs": {
      "sourceCaseId": "TC-MAX-008",
      "title": "Singleton max (max=1) with 2 Hero SKUs — warning numeral '1', all SKUs kept, blocked",
      "technique": [
        "Boundary Value Analysis",
        "Error Guessing"
      ],
      "preconditions": [
        "Logged in",
        "Channel 'Affiliate' configured with maxHeroSkus=1"
      ],
      "testData": [
        "channel=Affiliate",
        "maxHeroSkus=1",
        "selected Hero SKUs=2 (SKU-2001, SKU-2002)"
      ],
      "steps": [
        "1. Start a new media plan",
        "2. Select channel 'Affiliate' (maxHeroSkus=1)",
        "3. Assign 2 Hero SKUs (SKU-2001, SKU-2002)",
        "4. Read the warning text exactly",
        "5. Attempt to proceed to booking"
      ],
      "expectedText": [
        "Channel added to summary panel with both Hero SKUs",
        "Warning displayed with EXACT text: \"Media limit: 1 Hero SKUs. Edit SKUs\"",
        "Booking/save blocked until reduced to 1"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-008 E2E/Critical"
  },
  {
    "caseId": "DC-009",
    "inputs": {
      "sourceCaseId": "TC-MAX-009",
      "title": "Warning numeral tracks a different configured max (max=5) — verbatim '5'",
      "technique": [
        "Equivalence Partitioning",
        "Data-Driven"
      ],
      "preconditions": [
        "Logged in",
        "Channel 'Display' configured with maxHeroSkus=5 (assumption: alternate-service max)"
      ],
      "testData": [
        "channel=Display",
        "maxHeroSkus=5",
        "selected Hero SKUs=6 (SKU-3001..SKU-3006)"
      ],
      "steps": [
        "1. Start a new media plan",
        "2. Select channel 'Display' (maxHeroSkus=5)",
        "3. Assign 6 Hero SKUs (SKU-3001 through SKU-3006)",
        "4. Read the warning text exactly"
      ],
      "expectedText": [
        "Warning displayed with EXACT text: \"Media limit: 5 Hero SKUs. Edit SKUs\"",
        "Channel still added with all 6 SKUs; booking blocked"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-009 UI/High"
  },
  {
    "caseId": "DC-010",
    "inputs": {
      "sourceCaseId": "TC-MAX-010",
      "title": "No maximum configured (max=null) — any count allowed, never warned or blocked",
      "technique": [
        "Equivalence Partitioning"
      ],
      "preconditions": [
        "Logged in",
        "Channel 'Sampling' configured with maxHeroSkus=null (no max)"
      ],
      "testData": [
        "channel=Sampling",
        "maxHeroSkus=null",
        "selected Hero SKUs=10 (SKU-4001..SKU-4010)"
      ],
      "steps": [
        "1. Start a new media plan",
        "2. Select channel 'Sampling' (no max configured)",
        "3. Assign 10 Hero SKUs (SKU-4001 through SKU-4010)",
        "4. Observe summary panel and warnings",
        "5. Attempt to proceed to booking"
      ],
      "expectedText": [
        "Channel added to summary panel with all 10 Hero SKUs",
        "No 'Media limit' warning is ever displayed",
        "User is not blocked; booking/save proceeds"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-010 E2E/High"
  },
  {
    "caseId": "DC-011",
    "inputs": {
      "sourceCaseId": "TC-MAX-011",
      "title": "No max configured — count equal to other channels' typical max still no warning",
      "technique": [
        "Equivalence Partitioning"
      ],
      "preconditions": [
        "Logged in",
        "Channel 'Sampling' configured with maxHeroSkus=null"
      ],
      "testData": [
        "channel=Sampling",
        "maxHeroSkus=null",
        "selected Hero SKUs=3"
      ],
      "steps": [
        "1. Start a new media plan",
        "2. Select channel 'Sampling' (no max)",
        "3. Assign 3 Hero SKUs",
        "4. Observe warnings",
        "5. Proceed to booking"
      ],
      "expectedText": [
        "No warning shown (null max must not coincidentally apply a default like 3)",
        "Booking not blocked"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-011 Integration/Low"
  },
  {
    "caseId": "DC-012",
    "inputs": {
      "sourceCaseId": "TC-MAX-012",
      "title": "Deselect excess via modal then proceed — warning clears, booking unblocked",
      "technique": [
        "State Transition",
        "Use Case Testing"
      ],
      "preconditions": [
        "Logged in",
        "Channel 'Sponsored Search' configured with maxHeroSkus=3",
        "Channel currently over limit with 5 Hero SKUs and warning showing"
      ],
      "testData": [
        "channel=Sponsored Search",
        "maxHeroSkus=3",
        "initial Hero SKUs=5 (SKU-1001..SKU-1005)",
        "deselect 2 → final 3"
      ],
      "steps": [
        "1. With 5 Hero SKUs assigned and warning visible, click 'Edit SKUs' in the warning",
        "2. In the modal, deselect 2 SKUs (SKU-1004, SKU-1005)",
        "3. Confirm/apply the modal (final count=3)",
        "4. Observe the channel warning and booking state",
        "5. Proceed to booking/save"
      ],
      "expectedText": [
        "Modal opens listing the channel's selected Hero SKUs",
        "After applying with 3 SKUs, the \"Media limit: 3 Hero SKUs. Edit SKUs\" warning is removed",
        "Booking/save is now unblocked and the plan can be saved/booked"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-012 E2E/Critical"
  },
  {
    "caseId": "DC-013",
    "inputs": {
      "sourceCaseId": "TC-MAX-013",
      "title": "Deselect via modal to over-limit-still (5→4) — warning persists, still blocked",
      "technique": [
        "State Transition",
        "Boundary Value Analysis"
      ],
      "preconditions": [
        "Logged in",
        "Channel 'Sponsored Search' maxHeroSkus=3",
        "Channel over limit with 5 Hero SKUs"
      ],
      "testData": [
        "channel=Sponsored Search",
        "maxHeroSkus=3",
        "initial=5",
        "deselect 1 → final 4"
      ],
      "steps": [
        "1. Open the 'Edit SKUs' modal from the warning",
        "2. Deselect only 1 SKU (final count=4)",
        "3. Apply the modal",
        "4. Observe warning and booking state"
      ],
      "expectedText": [
        "Warning still shown with EXACT text: \"Media limit: 3 Hero SKUs. Edit SKUs\"",
        "Booking/save remains blocked (4 > 3)"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-013 E2E/High"
  },
  {
    "caseId": "DC-014",
    "inputs": {
      "sourceCaseId": "TC-MAX-014",
      "title": "Modal deselect exactly to max (count=3) — boundary unblocks",
      "technique": [
        "Boundary Value Analysis",
        "State Transition"
      ],
      "preconditions": [
        "Logged in",
        "Channel 'Sponsored Search' maxHeroSkus=3",
        "Channel over limit with 4 Hero SKUs"
      ],
      "testData": [
        "channel=Sponsored Search",
        "maxHeroSkus=3",
        "initial=4",
        "deselect 1 → final 3"
      ],
      "steps": [
        "1. Open 'Edit SKUs' modal",
        "2. Deselect 1 SKU so final count = 3 (exactly max)",
        "3. Apply modal",
        "4. Observe warning and booking state",
        "5. Proceed to booking"
      ],
      "expectedText": [
        "Warning is cleared at count==max (3)",
        "Booking/save unblocked",
        "Channel retains exactly 3 Hero SKUs"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-014 E2E/High"
  },
  {
    "caseId": "DC-015",
    "inputs": {
      "sourceCaseId": "TC-MAX-015",
      "title": "Global Hero list set first, then channel selected exceeding its max — channel added, warned, blocked (Scenario 4)",
      "technique": [
        "Use Case Testing",
        "Boundary Value Analysis"
      ],
      "preconditions": [
        "Logged in",
        "Global Hero SKU list set to 5 SKUs (SKU-1001..SKU-1005)",
        "Channel 'Sponsored Search' configured maxHeroSkus=3"
      ],
      "testData": [
        "global Hero SKUs=5",
        "channel=Sponsored Search",
        "maxHeroSkus=3"
      ],
      "steps": [
        "1. Assign 5 Hero SKUs globally first",
        "2. Select channel 'Sponsored Search' (maxHeroSkus=3)",
        "3. Proceed",
        "4. Observe the channel in the summary panel and its warning",
        "5. Attempt to book"
      ],
      "expectedText": [
        "Channel is still added to the summary panel with all 5 global Hero SKUs",
        "Warning displayed for the channel with EXACT text: \"Media limit: 3 Hero SKUs. Edit SKUs\"",
        "Booking is blocked until Hero SKUs for the channel are adjusted to <= 3"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-015 E2E/Critical"
  },
  {
    "caseId": "DC-016",
    "inputs": {
      "sourceCaseId": "TC-MAX-016",
      "title": "Global Hero list exceeds two channels' max — warning on EACH affected channel, blocked until all fixed",
      "technique": [
        "Use Case Testing",
        "Equivalence Partitioning"
      ],
      "preconditions": [
        "Logged in",
        "Global Hero list = 5 SKUs",
        "Channel 'Sponsored Search' maxHeroSkus=3; Channel 'Affiliate' maxHeroSkus=1"
      ],
      "testData": [
        "global Hero SKUs=5",
        "channelA=Sponsored Search (max=3)",
        "channelB=Affiliate (max=1)"
      ],
      "steps": [
        "1. Set global Hero list to 5 SKUs",
        "2. Select both 'Sponsored Search' and 'Affiliate'",
        "3. Proceed",
        "4. Inspect each channel's warning text in the summary panel",
        "5. Attempt to book"
      ],
      "expectedText": [
        "Both channels added to summary panel with all 5 SKUs each",
        "'Sponsored Search' shows EXACT: \"Media limit: 3 Hero SKUs. Edit SKUs\"",
        "'Affiliate' shows EXACT: \"Media limit: 1 Hero SKUs. Edit SKUs\"",
        "Booking blocked until BOTH channels adjusted to their own max"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-016 E2E/Critical"
  },
  {
    "caseId": "DC-017",
    "inputs": {
      "sourceCaseId": "TC-MAX-017",
      "title": "Global exceeds one channel but within another — only over-limit channel warned",
      "technique": [
        "Equivalence Partitioning",
        "Use Case Testing"
      ],
      "preconditions": [
        "Logged in",
        "Global Hero list = 3 SKUs",
        "Channel 'Sponsored Search' maxHeroSkus=3; Channel 'Affiliate' maxHeroSkus=1"
      ],
      "testData": [
        "global Hero SKUs=3",
        "Sponsored Search max=3 (within)",
        "Affiliate max=1 (exceeded)"
      ],
      "steps": [
        "1. Set global Hero list to 3 SKUs",
        "2. Select 'Sponsored Search' and 'Affiliate'",
        "3. Proceed",
        "4. Inspect warnings per channel",
        "5. Attempt to book"
      ],
      "expectedText": [
        "'Sponsored Search' shows NO warning (3 == its max)",
        "'Affiliate' shows EXACT: \"Media limit: 1 Hero SKUs. Edit SKUs\"",
        "Booking blocked due to 'Affiliate' only; unblocks after Affiliate reduced to 1"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-017 E2E/High"
  },
  {
    "caseId": "DC-018",
    "inputs": {
      "sourceCaseId": "TC-MAX-018",
      "title": "Mixed-max multi-channel plan — one channel over blocks the WHOLE plan",
      "technique": [
        "Use Case Testing",
        "Decision Table"
      ],
      "preconditions": [
        "Logged in",
        "Channel 'Display' max=5 with 4 Hero SKUs (compliant)",
        "Channel 'Sponsored Search' max=3 with 4 Hero SKUs (over)"
      ],
      "testData": [
        "Display: max=5, assigned=4 (ok)",
        "Sponsored Search: max=3, assigned=4 (over)"
      ],
      "steps": [
        "1. Build a plan with 'Display' (4 SKUs, within max=5)",
        "2. Add 'Sponsored Search' (4 SKUs, over max=3)",
        "3. Observe each channel state",
        "4. Attempt to book the whole plan"
      ],
      "expectedText": [
        "'Display' shows no warning; 'Sponsored Search' shows EXACT: \"Media limit: 3 Hero SKUs. Edit SKUs\"",
        "The entire plan's booking/save is blocked because one channel exceeds its max",
        "After fixing 'Sponsored Search' to 3, plan becomes bookable"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-018 E2E/Critical"
  },
  {
    "caseId": "DC-019",
    "inputs": {
      "sourceCaseId": "TC-MAX-019",
      "title": "Backend: single channel typed exceeds maxHeroSkus — block add, route to ask node",
      "technique": [
        "Use Case Testing",
        "Error Guessing"
      ],
      "preconditions": [
        "Backend resolver pipeline available",
        "Channel service resolves maxHeroSkus=3, minHeroSkus=1",
        "User prompt names exactly ONE channel"
      ],
      "testData": [
        "typed channels=1 ('Sponsored Search')",
        "resolved maxHeroSkus=3",
        "selected Hero SKUs=4"
      ],
      "steps": [
        "1. Submit a prompt naming a single channel 'Sponsored Search' with 4 Hero SKUs",
        "2. Backend activates the channel and checks min/maxHeroSkus",
        "3. Observe whether channel is added and which node the flow routes to",
        "4. Observe the user-facing informing message"
      ],
      "expectedText": [
        "Channel is NOT added (blocked) because 4 > maxHeroSkus(3)",
        "User is informed of the limit",
        "Because only ONE channel was typed, the flow is blocked and routed to the ask node"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-019 Integration/Critical"
  },
  {
    "caseId": "DC-020",
    "inputs": {
      "sourceCaseId": "TC-MAX-020",
      "title": "Backend: multiple channels typed, one exceeds max — block that one, continue other resolver nodes",
      "technique": [
        "Use Case Testing",
        "Decision Table"
      ],
      "preconditions": [
        "Backend resolver pipeline available",
        "'Sponsored Search' max=3; 'Display' max=5",
        "User prompt names TWO channels"
      ],
      "testData": [
        "typed channels=2 ('Sponsored Search' over with 4, 'Display' ok with 3)",
        "Sponsored Search max=3",
        "Display max=5"
      ],
      "steps": [
        "1. Submit a prompt naming 'Sponsored Search' (4 Hero SKUs) and 'Display' (3 Hero SKUs)",
        "2. Backend activates each channel and checks min/maxHeroSkus",
        "3. Observe handling of the over-limit channel vs the compliant one",
        "4. Observe routing"
      ],
      "expectedText": [
        "'Sponsored Search' is blocked from being added and the user is informed of its limit",
        "'Display' is processed normally (within max)",
        "Because MORE than one channel was typed, the flow continues with the other resolver nodes (does NOT go straight to ask node)"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-020 Integration/Critical"
  },
  {
    "caseId": "DC-021",
    "inputs": {
      "sourceCaseId": "TC-MAX-021",
      "title": "Backend: single channel typed below minHeroSkus — block add, inform, ask node",
      "technique": [
        "Boundary Value Analysis",
        "Error Guessing"
      ],
      "preconditions": [
        "Backend resolver available",
        "Channel 'Sponsored Search' resolves minHeroSkus=2, maxHeroSkus=3",
        "User prompt names exactly ONE channel"
      ],
      "testData": [
        "typed channels=1",
        "minHeroSkus=2",
        "selected Hero SKUs=1 (below min)"
      ],
      "steps": [
        "1. Submit a prompt naming a single channel with only 1 Hero SKU",
        "2. Backend checks min/maxHeroSkus after activation",
        "3. Observe add/block decision and routing"
      ],
      "expectedText": [
        "Channel is blocked from being added because 1 < minHeroSkus(2)",
        "User is informed of the minimum requirement",
        "Single channel => flow routed to ask node"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-021 Integration/High"
  },
  {
    "caseId": "DC-022",
    "inputs": {
      "sourceCaseId": "TC-MAX-022",
      "title": "Backend: multiple channels typed, all within min/max — all added, full resolver continues",
      "technique": [
        "Equivalence Partitioning"
      ],
      "preconditions": [
        "Backend resolver available",
        "'Sponsored Search' max=3 min=1; 'Display' max=5 min=1",
        "Prompt names TWO compliant channels"
      ],
      "testData": [
        "Sponsored Search: 3 Hero SKUs (==max)",
        "Display: 4 Hero SKUs (within)"
      ],
      "steps": [
        "1. Submit a prompt naming both channels, each within their min/max",
        "2. Backend activates and checks limits",
        "3. Observe additions and routing"
      ],
      "expectedText": [
        "Both channels are added (no block)",
        "No limit-violation message is shown",
        "Flow continues normally through resolver nodes"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-022 Integration/Medium"
  },
  {
    "caseId": "DC-023",
    "inputs": {
      "sourceCaseId": "TC-MAX-023",
      "title": "Backend: no max configured (null) on resolved channel — never blocked regardless of count",
      "technique": [
        "Equivalence Partitioning"
      ],
      "preconditions": [
        "Backend resolver available",
        "Channel 'Sampling' resolves maxHeroSkus=null, minHeroSkus=null"
      ],
      "testData": [
        "typed channels=1 ('Sampling')",
        "maxHeroSkus=null",
        "selected Hero SKUs=12"
      ],
      "steps": [
        "1. Submit a prompt naming 'Sampling' with 12 Hero SKUs",
        "2. Backend activates and checks min/maxHeroSkus (both null)",
        "3. Observe add/block decision"
      ],
      "expectedText": [
        "Channel 'Sampling' is added",
        "No limit block or informing message is produced",
        "Flow continues normally (no ask-node diversion for limits)"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-023 Integration/High"
  },
  {
    "caseId": "DC-024",
    "inputs": {
      "sourceCaseId": "TC-MAX-024",
      "title": "Re-exceeding after a valid state — adding SKUs back over max re-triggers warning and re-blocks",
      "technique": [
        "State Transition"
      ],
      "preconditions": [
        "Logged in",
        "Channel 'Sponsored Search' max=3",
        "Channel currently compliant with 3 Hero SKUs, no warning"
      ],
      "testData": [
        "channel=Sponsored Search",
        "max=3",
        "start=3 → add 1 → 4"
      ],
      "steps": [
        "1. With a compliant channel (3 Hero SKUs, no warning), open 'Edit SKUs'",
        "2. Add 1 more Hero SKU (SKU-1004), making count=4",
        "3. Apply the modal",
        "4. Observe warning and booking state"
      ],
      "expectedText": [
        "Warning reappears with EXACT text: \"Media limit: 3 Hero SKUs. Edit SKUs\"",
        "Booking/save is blocked again"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-024 E2E/Medium"
  },
  {
    "caseId": "DC-025",
    "inputs": {
      "sourceCaseId": "TC-MAX-025",
      "title": "Min configured boundary: count below minHeroSkus on UI — informs/blocks (min enforcement)",
      "technique": [
        "Boundary Value Analysis"
      ],
      "preconditions": [
        "Logged in",
        "Channel 'Sponsored Search' configured minHeroSkus=2, maxHeroSkus=3"
      ],
      "testData": [
        "channel=Sponsored Search",
        "minHeroSkus=2",
        "maxHeroSkus=3",
        "selected Hero SKUs=1 (below min)"
      ],
      "steps": [
        "1. Start a new media plan",
        "2. Select channel 'Sponsored Search' (min=2, max=3)",
        "3. Assign only 1 Hero SKU (below the minimum)",
        "4. Observe summary panel messaging",
        "5. Attempt to proceed to booking"
      ],
      "expectedText": [
        "User is informed that the channel requires at least minHeroSkus(2)",
        "Booking/save is blocked until at least 2 Hero SKUs are assigned",
        "Assigning a 2nd Hero SKU (reaching min=2) clears the block"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-025 E2E/Medium"
  },
  {
    "caseId": "DC-026",
    "inputs": {
      "sourceCaseId": "TC-MAX-026",
      "title": "Warning 'Edit SKUs' affordance opens the channel SKU modal scoped to that channel",
      "technique": [
        "Use Case Testing"
      ],
      "preconditions": [
        "Logged in",
        "Channel 'Sponsored Search' max=3 over limit with 4 Hero SKUs, warning showing"
      ],
      "testData": [
        "channel=Sponsored Search",
        "max=3",
        "assigned=4"
      ],
      "steps": [
        "1. With the over-limit warning visible, click the 'Edit SKUs' link in the warning",
        "2. Observe the modal that opens",
        "3. Verify the SKUs listed belong to this channel only"
      ],
      "expectedText": [
        "A SKU editing modal opens for 'Sponsored Search'",
        "The modal lists the channel's currently selected Hero SKUs (the 4 assigned)",
        "Edits are scoped to this channel and do not affect other channels' Hero SKUs"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-026 UI/Medium"
  },
  {
    "caseId": "DC-027",
    "inputs": {
      "sourceCaseId": "TC-MAX-027",
      "title": "Booking explicitly attempted while over limit surfaces block reason, no save persisted",
      "technique": [
        "Error Guessing",
        "Negative Testing"
      ],
      "preconditions": [
        "Logged in",
        "Channel 'Sponsored Search' max=3 with 4 Hero SKUs, warning present"
      ],
      "testData": [
        "channel=Sponsored Search",
        "max=3",
        "assigned=4"
      ],
      "steps": [
        "1. With the channel over limit, click the Book/Save plan action",
        "2. Observe system response",
        "3. Verify backend persistence state of the plan"
      ],
      "expectedText": [
        "Booking/Save is prevented; the plan is not booked/saved",
        "The over-limit warning \"Media limit: 3 Hero SKUs. Edit SKUs\" remains and the user is directed to fix the selection",
        "No booked/saved plan record is created in the backend for the over-limit state"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-027 E2E/High"
  },
  {
    "caseId": "DC-028",
    "inputs": {
      "sourceCaseId": "TC-MAX-028",
      "title": "Channel max boundary: assigning exactly max Hero SKUs (count == max) is accepted with no warning and booking allowed",
      "technique": [
        "Boundary-BVA",
        "Positive"
      ],
      "preconditions": [
        "Channel offSite (Meta) configured with maxHeroSkus = 3 (parameterize MAX from channel config; 3 from spec example).",
        "Brand-linked catalogue includes SKUs 1,2,3."
      ],
      "testData": [
        "Channel: offSite Meta, maxHeroSkus = 3",
        "Hero assigned: 1,2,3 (count == max == 3)"
      ],
      "steps": [
        "1. Assign exactly 3 Hero SKUs (1,2,3) to offSite Meta.",
        "2. Apply and wait for the assistant/backend turn to complete (30-60s).",
        "3. Inspect the summary panel: channel presence, SKU list, warning area.",
        "4. Inspect the booking/save control state."
      ],
      "expectedText": [
        "Channel is added to the summary panel with all 3 SKUs (1,2,3).",
        "NO 'Media limit' warning is shown (count == max is within limit).",
        "Booking/saving is NOT blocked by this channel (control enabled)."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-028 E2E/High"
  },
  {
    "caseId": "DC-029",
    "inputs": {
      "sourceCaseId": "TC-MAX-029",
      "title": "Channel max boundary: assigning max-1 Hero SKUs (count < max) is accepted with no warning",
      "technique": [
        "Boundary-BVA",
        "Positive"
      ],
      "preconditions": [
        "Channel offSite (Meta) configured with maxHeroSkus = 3 (parameterized).",
        "Brand-linked catalogue includes SKUs 1,2."
      ],
      "testData": [
        "maxHeroSkus = 3",
        "Hero assigned: 1,2 (count == max-1 == 2)"
      ],
      "steps": [
        "1. Assign 2 Hero SKUs (1,2) to offSite Meta.",
        "2. Apply and wait for processing.",
        "3. Inspect summary panel and warning area.",
        "4. Inspect booking control."
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
    "notes": "TC-MAX-029 E2E/Medium"
  },
  {
    "caseId": "DC-030",
    "inputs": {
      "sourceCaseId": "TC-MAX-030",
      "title": "Channel max boundary: assigning max+1 Hero SKUs (count > max) adds channel with all SKUs but shows verbatim warning and blocks booking",
      "technique": [
        "Boundary-BVA",
        "Negative",
        "Error-Message"
      ],
      "preconditions": [
        "Channel offSite (Meta) configured with maxHeroSkus = 3 (parameterized).",
        "Brand-linked catalogue includes SKUs 1,2,3,4."
      ],
      "testData": [
        "maxHeroSkus = 3",
        "Hero assigned: 1,2,3,4 (count == max+1 == 4)",
        "Verbatim warning expected: 'Media limit: 3 Hero SKUs. Edit SKUs'"
      ],
      "steps": [
        "1. Assign 4 Hero SKUs (1,2,3,4) to offSite Meta (exceeds max of 3).",
        "2. Apply and wait for processing.",
        "3. Inspect summary panel: channel presence, full SKU list, warning text.",
        "4. Inspect booking/save control state.",
        "5. Attempt to book/save the plan."
      ],
      "expectedText": [
        "Channel IS still added to the summary panel WITH all 4 selected SKUs (the channel is not dropped).",
        "A warning is shown with EXACT text: 'Media limit: 3 Hero SKUs. Edit SKUs'.",
        "User is BLOCKED from booking/saving until the selection meets the max (book/save disabled or rejected).",
        "An edit/deselect modal is reachable from the warning to remove the excess."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-030 E2E/Critical"
  },
  {
    "caseId": "DC-031",
    "inputs": {
      "sourceCaseId": "TC-MAX-031",
      "title": "Channel with NO max configured: assigning a large Hero SKU count imposes no restriction and no warning",
      "technique": [
        "Equivalence-Partition",
        "Decision-Table",
        "Positive"
      ],
      "preconditions": [
        "Channel onSite has NO maxHeroSkus configured (max unset/null); fixture leaves maxHeroSkus null.",
        "Brand-linked catalogue includes SKUs 1..6."
      ],
      "testData": [
        "Channel: onSite, maxHeroSkus = unset/null",
        "Hero assigned: 1,2,3,4,5,6 (count 6, arbitrarily large)"
      ],
      "steps": [
        "1. Assign 6 Hero SKUs to onSite (no max configured).",
        "2. Apply and wait.",
        "3. Inspect summary panel, warning area, and booking control."
      ],
      "expectedText": [
        "Channel added with all 6 SKUs.",
        "NO 'Media limit' warning shown (no max means no restriction).",
        "Booking/saving NOT blocked regardless of count."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-031 E2E/High"
  },
  {
    "caseId": "DC-032",
    "inputs": {
      "sourceCaseId": "TC-MAX-032",
      "title": "Channel max = exactly 1 (singleton limit): one Hero accepted, two Hero blocked with warning interpolating '1 Hero SKU'",
      "technique": [
        "Boundary-BVA",
        "Error-Message",
        "Decision-Table"
      ],
      "preconditions": [
        "Channel offSite (Meta) configured with maxHeroSkus = 1.",
        "Brand-linked catalogue includes SKUs 1,2."
      ],
      "testData": [
        "maxHeroSkus = 1",
        "Step A Hero assigned: 1 (count == max == 1)",
        "Step B Hero assigned: 1,2 (count == max+1 == 2)",
        "Verbatim warning expected at step B: 'Media limit: 1 Hero SKUs. Edit SKUs' (numeral interpolated from max; pluralization per actual UI)"
      ],
      "steps": [
        "1. Assign 1 Hero SKU (1) to offSite Meta; apply; inspect warning and booking.",
        "2. Add a second Hero SKU (2) so count = 2; apply; inspect warning and booking."
      ],
      "expectedText": [
        "After step 1 (count == 1 == max): channel added, no warning, booking allowed.",
        "After step 2 (count == 2 == max+1): channel still added with both SKUs, warning shown with the numeral 1 interpolated from maxHeroSkus, booking blocked until deselected to 1."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-032 E2E/Medium"
  },
  {
    "caseId": "DC-033",
    "inputs": {
      "sourceCaseId": "TC-MAX-033",
      "title": "Mixed-max plan: one channel over its max blocks booking even while another channel is within its max",
      "technique": [
        "Decision-Table",
        "Error-Message",
        "State-Recompute"
      ],
      "preconditions": [
        "Channel offSite (Meta) configured maxHeroSkus = 3; Channel onSite configured maxHeroSkus = 5.",
        "Both channels selected in one plan."
      ],
      "testData": [
        "offSite Meta: Hero 1,2,3,4 (count 4 > max 3) -> warned",
        "onSite: Hero 1,2,3 (count 3 < max 5) -> clean",
        "Verbatim warning on Meta: 'Media limit: 3 Hero SKUs. Edit SKUs'"
      ],
      "steps": [
        "1. Assign 4 Hero SKUs to offSite Meta (exceeds its max 3) and 3 Hero SKUs to onSite (within its max 5).",
        "2. Apply and wait.",
        "3. Inspect both channels' warning state independently.",
        "4. Attempt to book the plan."
      ],
      "expectedText": [
        "offSite Meta shows the 'Media limit: 3 Hero SKUs. Edit SKUs' warning; onSite shows NO warning.",
        "Booking is BLOCKED at the plan level because at least one channel (Meta) exceeds its max.",
        "Fixing only onSite would not unblock; the plan unblocks only after Meta is reduced to <= 3."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-033 E2E/High"
  },
  {
    "caseId": "DC-034",
    "inputs": {
      "sourceCaseId": "TC-MAX-034",
      "title": "Global Hero list exceeds the lower of two channels' DIFFERENT maxes: only the channel whose max is exceeded is warned",
      "technique": [
        "Decision-Table",
        "Error-Message",
        "Boundary-BVA"
      ],
      "preconditions": [
        "Global Hero list = 1,2,3,4 (4 SKUs) assigned BEFORE selecting channels; global pre-populates every selected channel.",
        "Channel offSite (Meta) maxHeroSkus = 3; Channel onSite maxHeroSkus = 4."
      ],
      "testData": [
        "Global Hero: 1,2,3,4 (count 4)",
        "offSite Meta max = 3 -> exceeded (4 > 3)",
        "onSite max = 4 -> at limit (4 == 4), not exceeded",
        "Verbatim warning on Meta: 'Media limit: 3 Hero SKUs. Edit SKUs'"
      ],
      "steps": [
        "1. Assign global Hero SKUs 1,2,3,4.",
        "2. Select offSite Meta (max 3) and onSite (max 4); each is pre-populated with the 4 global Hero SKUs.",
        "3. Wait for processing.",
        "4. Inspect warning state of each channel and the booking control.",
        "5. Attempt to book."
      ],
      "expectedText": [
        "offSite Meta (4 > 3) shows the warning 'Media limit: 3 Hero SKUs. Edit SKUs'.",
        "onSite (4 == 4) shows NO warning (count equals its max, within limit).",
        "Booking BLOCKED until offSite Meta is reduced; onSite needs no adjustment.",
        "Each channel's warning reflects its OWN configured max, not a shared global value."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-034 E2E/High"
  },
  {
    "caseId": "DC-035",
    "inputs": {
      "sourceCaseId": "TC-MAX-035",
      "title": "After deselecting excess down to max, the warning clears and booking unblocks (recompute on save)",
      "technique": [
        "State-Recompute",
        "Positive",
        "Error-Message"
      ],
      "preconditions": [
        "From MAX-092 end state: offSite Meta has 4 Hero SKUs (1,2,3,4), 'Media limit: 3 Hero SKUs. Edit SKUs' warning shown, booking blocked, maxHeroSkus = 3."
      ],
      "testData": [
        "maxHeroSkus = 3",
        "Deselect SKU 4 -> remaining Hero 1,2,3 (count == max == 3)"
      ],
      "steps": [
        "1. Open the deselect/edit modal from the warning.",
        "2. Deselect SKU 4 so the channel has 3 Hero SKUs (1,2,3).",
        "3. Apply/save and wait for recompute.",
        "4. Inspect warning area and booking control."
      ],
      "expectedText": [
        "The 'Media limit: 3 Hero SKUs. Edit SKUs' warning is removed.",
        "Channel now shows 3 Hero SKUs (1,2,3).",
        "Booking/saving is unblocked (control enabled)."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-035 E2E/Critical"
  },
  {
    "caseId": "DC-036",
    "inputs": {
      "sourceCaseId": "TC-MAX-036",
      "title": "Reducing an over-max channel to max-1 (not just to max) also clears the warning and unblocks",
      "technique": [
        "Boundary-BVA",
        "State-Recompute",
        "Positive"
      ],
      "preconditions": [
        "offSite Meta over-assigned with 4 Hero SKUs (1,2,3,4), warning shown, booking blocked, maxHeroSkus = 3."
      ],
      "testData": [
        "maxHeroSkus = 3",
        "Deselect SKUs 3 and 4 -> remaining Hero 1,2 (count == max-1 == 2)"
      ],
      "steps": [
        "1. From the warning, open the deselect modal.",
        "2. Deselect SKUs 3 and 4 so only 1,2 remain (count 2 < max 3).",
        "3. Apply/save and wait.",
        "4. Inspect warning and booking control."
      ],
      "expectedText": [
        "Warning cleared.",
        "Channel shows 2 Hero SKUs.",
        "Booking unblocked (any count <= max clears the block, not only count == max)."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-036 E2E/Medium"
  },
  {
    "caseId": "DC-037",
    "inputs": {
      "sourceCaseId": "TC-MAX-037",
      "title": "Backend NUP-20507: SINGLE channel typed exceeds maxHeroSkus on activation -> channel blocked from being added and flow routes to the ask node",
      "technique": [
        "Decision-Table",
        "Negative",
        "Error-Message"
      ],
      "preconditions": [
        "User types exactly ONE channel in chat whose Hero selection exceeds its maxHeroSkus.",
        "offSite (Meta) maxHeroSkus = 3; the prompt specifies 4 Hero SKUs for it.",
        "Backend min/max check runs after channel activation."
      ],
      "testData": [
        "Single channel typed: offSite Meta with Hero 1,2,3,4",
        "maxHeroSkus = 3"
      ],
      "steps": [
        "1. Send a single-channel prompt assigning 4 Hero SKUs to offSite Meta.",
        "2. Wait for the assistant/backend turn (30-60s).",
        "3. Inspect whether the channel was added, the user message, and where the flow routed."
      ],
      "expectedText": [
        "Adding the channel is BLOCKED (maxHeroSkus exceeded after activation) - distinct from the front-end summary-panel behaviour where the channel IS added with a warning.",
        "The user is informed of the limit.",
        "Because only ONE channel was typed, the flow goes to the ask node (re-prompting the user to adjust)."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-037 Integration/High"
  },
  {
    "caseId": "DC-038",
    "inputs": {
      "sourceCaseId": "TC-MAX-038",
      "title": "Backend NUP-20507: MULTIPLE channels typed, one exceeds maxHeroSkus -> only that channel blocked, flow continues with other resolver nodes",
      "technique": [
        "Decision-Table",
        "Negative"
      ],
      "preconditions": [
        "User types MORE than one channel in chat.",
        "offSite Meta maxHeroSkus = 3 with 4 Hero SKUs (exceeds); onSite maxHeroSkus = 3 with 2 Hero SKUs (within).",
        "Backend min/max check runs after channel activation."
      ],
      "testData": [
        "Channels typed: offSite Meta (Hero 1,2,3,4 -> exceeds), onSite (Hero 1,2 -> within)",
        "maxHeroSkus = 3 each"
      ],
      "steps": [
        "1. Send a multi-channel prompt: Meta with 4 Hero SKUs and onSite with 2 Hero SKUs.",
        "2. Wait for backend processing (30-60s).",
        "3. Inspect which channels were added and how the flow continued."
      ],
      "expectedText": [
        "offSite Meta (exceeds max) is BLOCKED from being added; the user is informed.",
        "Because MORE than one channel was typed, the flow does NOT go to the ask node; it CONTINUES with the other resolver nodes.",
        "onSite is added with its 2 Hero SKUs."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-038 Integration/High"
  },
  {
    "caseId": "DC-039",
    "inputs": {
      "sourceCaseId": "TC-MAX-039",
      "title": "Backend NUP-20507: channel BELOW minHeroSkus on activation is blocked and the user informed",
      "technique": [
        "Boundary-BVA",
        "Negative"
      ],
      "preconditions": [
        "Channel offSite (Meta) configured with minHeroSkus = 1 (parameterize MIN).",
        "The channel's Hero selection on activation = 0 (below min)."
      ],
      "testData": [
        "minHeroSkus = 1 (parameterized)",
        "Hero count = 0 (below min)"
      ],
      "steps": [
        "1. Activate offSite (Meta) with 0 Hero SKUs (below configured min).",
        "2. Backend checks minHeroSkus/maxHeroSkus after activation.",
        "3. Observe whether the channel is blocked and the user message/routing."
      ],
      "expectedText": [
        "Backend detects Hero count below minHeroSkus.",
        "Channel is blocked from being added; user is informed.",
        "If only this single channel was typed, the flow routes to the ask node (consistent with the single-channel rule); if multiple were typed, other resolvers continue."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-MAX-039 Integration/Medium"
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
| salientCopy | Media limit, Edit SKUs | Salient strings the generated tests must assert |

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
| 1 | AC-001 | Launch the Nectar AI guided planner | /planning | Create Media Plans in minutes with Nectar AI; Help me build a plan based on my objective & budget | The guided objective-and-budget flow is active | guided flow control is visible |
| 2 | AC-002 | Seed the channel maxHeroSkus precondition via API | dataManager.setChannelMaxHeroSkus | channel; case maxHeroSkus | The channel under test has the case-specified maxHeroSkus | precondition helper resolves without error |
| 3 | AC-003 | Select advertiser and brand | Guided planner controls | advertiser; brand; Confirm | Advertiser and brand are shown on the summary panel | advertiser and brand visible on summary |
| 4 | AC-004 | Build to the Hero SKU selection step | Assistant chat and product search | objective; productSearch; select measurement SKUs; Confirm | The Hero SKU selection step is reached | Hero SKU controls are visible |
| 5 | AC-005 | Assign the case's Hero SKUs to the channel and apply | Assistant chat / channel modal | case Hero SKUs; Apply | The channel is added with the selected Hero SKUs | channel appears in the Media section |
| 6 | AC-006 | Verify the over-limit warning numeral and booking state | Summary panel channel row; booking control | n/a | When heroCount > maxHeroSkus the warning reads exactly Media limit: {maxHeroSkus} Hero SKUs. Edit SKUs and booking is blocked; otherwise no warning and booking is allowed | warning text equals configured max; booking state matches the case |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | Assign maxHeroSkus+1 Hero SKUs to a channel configured with maxHeroSkus=2 | Booking is blocked and the warning numeral equals 2 (the configured max), not a literal 3 |
| NEG-002 | Assign Hero SKUs to a channel whose maxHeroSkus is unset (null) | The channel applies a safe default limit and surfaces a deterministic state rather than an unbounded selection |

## Acceptance Criteria

- AC-001: The guided objective-and-budget flow is active
- AC-002: The channel under test has the case-specified maxHeroSkus
- AC-003: Advertiser and brand are shown on the summary panel
- AC-004: The Hero SKU selection step is reached
- AC-005: The channel is added with the selected Hero SKUs
- AC-006: When heroCount > maxHeroSkus the warning reads exactly "Media limit: {maxHeroSkus} Hero SKUs. Edit SKUs" and booking is blocked; otherwise no warning and booking is allowed

## Locator Hints

- Prefer role/name and data-testid locators owned by PlanningPage / NectarFlow page objects.
- Use exact visible text for counter copy (e.g. "Media limit") and summary panel values.
- Use CSS only with an explicit `// locator-policy:exception <reason>` comment directly above the locator call.

## Generated Test Requirements

- Must import from fixtures/test and use Page Objects / Component Objects for all locators.
- Generation Mode is suite: generate one focused test per Data Case (DC-###), each enumerating its DC id in the title.
- Across the suite, every AC id (AC-001, AC-002, AC-003, AC-004, AC-005, AC-006) must be covered by at least one test.
- Seed preconditions via the `dataManager` fixture (fixtures/test-data-manager.ts); do not configure data through the admin UI.
- Put `expect(...)` only in the final assertion step of each test; title it `Assert AC-###: ...`.
- Must assert the salient expected values "Media limit", "Edit SKUs".
- Must not use page.waitForTimeout, networkidle, XPath, test.only, or any form of skip; must not use real credentials or commit auth state.

## Notes

- This suite targets the live Pollen development environment; `Parallel Safe` is `no` and `Data Isolation` is `external`.
- E2E-only policy: every Data Case row above maps to an emitted, executable end-to-end test (API seed of REAL catalogue SKUs -> direct seeded-session navigation -> live UI assertion). Source cases that cannot be verified end-to-end today are enumerated under Pending Automation with their blockers — no weak panel-smoke or guaranteed-red placeholder tests are generated for them.
- Source: specs/test-cases-skus-2.yaml (area: Maximum Hero SKUs per channel validation); every row keeps its source case id for traceability.
- Locators were live-audited (2026-07-02/03) against the dev environment; the seed/hydrate/assert pipeline is live-proven.

## Pending Automation (no test emitted)

These 39 source cases are E2E-specified but cannot be verified end-to-end today. They are intentionally NOT generated — the framework ships only executable E2E tests.

| Source Case | Blocker |
|---|---|
| TC-MAX-001 — FIX: max+1 boundary warning numeral must equal the configured max, not a literal 3 (re-baselines IND-018/CHAN… | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-002 — Hero SKU count below channel max (count = max-1) — channel added, no warning | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-003 — Hero SKU count equals channel max (count = max) — channel added, no warning, not blocked | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-004 — Hero SKU count exceeds channel max by one (count = max+1) — channel added with all SKUs + exact warning + blo… | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-005 — Hero SKU count far exceeds channel max (count >> max) — all SKUs retained, exact warning, blocked | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-006 — Zero Hero SKUs assigned (count = 0) below max — no warning, not blocked | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-007 — Singleton max (max=1) with exactly 1 Hero SKU — allowed, no warning | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-008 — Singleton max (max=1) with 2 Hero SKUs — warning numeral '1', all SKUs kept, blocked | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-009 — Warning numeral tracks a different configured max (max=5) — verbatim '5' | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-010 — No maximum configured (max=null) — any count allowed, never warned or blocked | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-MAX-011 — No max configured — count equal to other channels' typical max still no warning | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-MAX-012 — Deselect excess via modal then proceed — warning clears, booking unblocked | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-013 — Deselect via modal to over-limit-still (5→4) — warning persists, still blocked | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-014 — Modal deselect exactly to max (count=3) — boundary unblocks | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-015 — Global Hero list set first, then channel selected exceeding its max — channel added, warned, blocked (Scenari… | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-016 — Global Hero list exceeds two channels' max — warning on EACH affected channel, blocked until all fixed | warning-needs-channel: the plan has no channels; needs assignChannelToPlan (unimplemented) or the UI chat flow |
| TC-MAX-017 — Global exceeds one channel but within another — only over-limit channel warned | warning-needs-channel: the plan has no channels; needs assignChannelToPlan (unimplemented) or the UI chat flow |
| TC-MAX-018 — Mixed-max multi-channel plan — one channel over blocks the WHOLE plan | warning-needs-channel: the plan has no channels; needs assignChannelToPlan (unimplemented) or the UI chat flow |
| TC-MAX-019 — Backend: single channel typed exceeds maxHeroSkus — block add, route to ask node | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-020 — Backend: multiple channels typed, one exceeds max — block that one, continue other resolver nodes | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-MAX-021 — Backend: single channel typed below minHeroSkus — block add, inform, ask node | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-MAX-022 — Backend: multiple channels typed, all within min/max — all added, full resolver continues | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-MAX-023 — Backend: no max configured (null) on resolved channel — never blocked regardless of count | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-MAX-024 — Re-exceeding after a valid state — adding SKUs back over max re-triggers warning and re-blocks | warning-needs-channel: the plan has no channels; needs assignChannelToPlan (unimplemented) or the UI chat flow |
| TC-MAX-025 — Min configured boundary: count below minHeroSkus on UI — informs/blocks (min enforcement) | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-026 — Warning 'Edit SKUs' affordance opens the channel SKU modal scoped to that channel | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-MAX-027 — Booking explicitly attempted while over limit surfaces block reason, no save persisted | warning-needs-channel: the plan has no channels; needs assignChannelToPlan (unimplemented) or the UI chat flow |
| TC-MAX-028 — Channel max boundary: assigning exactly max Hero SKUs (count == max) is accepted with no warning and booking … | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-029 — Channel max boundary: assigning max-1 Hero SKUs (count < max) is accepted with no warning | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-030 — Channel max boundary: assigning max+1 Hero SKUs (count > max) adds channel with all SKUs but shows verbatim w… | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-031 — Channel with NO max configured: assigning a large Hero SKU count imposes no restriction and no warning | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-MAX-032 — Channel max = exactly 1 (singleton limit): one Hero accepted, two Hero blocked with warning interpolating '1 … | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-033 — Mixed-max plan: one channel over its max blocks booking even while another channel is within its max | warning-needs-channel: the plan has no channels; needs assignChannelToPlan (unimplemented) or the UI chat flow |
| TC-MAX-034 — Global Hero list exceeds the lower of two channels' DIFFERENT maxes: only the channel whose max is exceeded i… | warning-needs-channel: the plan has no channels; needs assignChannelToPlan (unimplemented) or the UI chat flow |
| TC-MAX-035 — After deselecting excess down to max, the warning clears and booking unblocks (recompute on save) | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-036 — Reducing an over-max channel to max-1 (not just to max) also clears the warning and unblocks | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-037 — Backend NUP-20507: SINGLE channel typed exceeds maxHeroSkus on activation -> channel blocked from being added… | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-038 — Backend NUP-20507: MULTIPLE channels typed, one exceeds maxHeroSkus -> only that channel blocked, flow contin… | channel-config: needs channel media resolution (E2E_MP_*_CHANNEL) + admin_editMedia write |
| TC-MAX-039 — Backend NUP-20507: channel BELOW minHeroSkus on activation is blocked and the user informed | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
