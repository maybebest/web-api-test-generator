# Flow: Single-prompt Hero and Measurement recognition and parsing

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-SKU-PARSE |
| Spec Version | 2.0.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/skus/single-prompt-hero-measurement-parsing.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @single-prompt-hero-measurement-parsing |
| Generation Mode | suite |
| Review Status | human-reviewed |
| Review Sign-off | legacy-reviewed-before-signoff-metadata |
| Generation Source | manual-test-case |
| Generation Status | generated |

## User Story

As a media planner,
I want the Nectar AI planner to enforce single-prompt hero and measurement recognition and parsing correctly,
So that Hero/Measurement SKU selections behave deterministically (0 of the 18 documented cases are automated end-to-end today; the rest are enumerated under Pending Automation).

## Preconditions

- A valid non-production authenticated Playwright storage state (`playwright/.auth/user.json`).
- `PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.pollen.js-devops.co.uk/`.
- A brand-linked catalogue containing every SKU named in the case prompts is available.
- Natural-language SKU parsing is enabled for the assistant (FEATURE_NECTAR_AI_MP).

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
| RULE-001 | A single chat prompt is parsed into the correct Measurement and Hero SKU sets | parse('1, 2, 3, 4 and hero skus 3, 5, 6') => measurement={1,2,3,4}, hero={3,5,6} | Misclassifying a Hero SKU as Measurement (or vice versa) is a defect |
| RULE-002 | A SKU named as both Measurement and Hero is recognised in both roles | sku in measurement AND hero when the prompt lists it in both | Dropping a dual-role SKU from either set is a defect |
| RULE-003 | Unknown or non-brand-linked SKUs in the prompt are reported, not silently dropped | unknownSkus(prompt) are surfaced to the user | Silently ignoring an unrecognised SKU is a defect |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | Prompt free text: "1, 2, 3, 4 and hero skus 3, 5, 6"; Expected Measurement set: {1,2,3,4,5,6}; Expected Hero set: {3,5,6}; SKUs 5 and 6 are NOT in the typed Me… | Prompt is recognized as a single-prompt Hero+Measurement definition (no separate SKU-selection table step is shown); Measurement SKUs = exactly {1,2,3,4,5,6} (… | TC-PRM-001 (E2E/Critical) |
| DC-002 | Prompt: "1, 2, 3, 4 and hero skus 3, 5, 6" | The legacy step that forces the user to first select SKUs then show the Hero SKU table is bypassed; A summary/mapped table is presented in a single step (no in… | TC-PRM-002 (E2E/High) |
| DC-003 | Prompt: "1, 2, 3, 4 and hero skus 3" (Hero is a strict subset of typed Measurement); Expected Measurement={1,2,3,4}, Hero={3} | Measurement SKUs = {1,2,3,4} (4 entries, no auto-add because Hero 3 already present); SKU 3 appears exactly once in Measurement, flagged Hero; Hero SKUs = {3} … | TC-PRM-003 (Integration/High) |
| DC-004 | Prompt: "1, 2 and hero skus 7, 8" (no Hero overlaps typed Measurement); Expected Measurement={1,2,7,8}, Hero={7,8} | Measurement SKUs = {1,2,7,8} (grew from typed 2 to 4 via auto-add of 7 and 8); Hero SKUs = {7,8} (2 entries); Measurement count = 4, Hero count = 2 | TC-PRM-004 (Integration/High) |
| DC-005 | Prompt: "1, 2, 3, 4" (no "hero skus" segment); Expected Measurement={1,2,3,4}, Hero={} until table flow | No Hero definition recognized; Hero set initially empty; System falls back to the standard flow: Measurement SKUs accepted as {1,2,3,4} then the Hero SKU table… | TC-PRM-005 (E2E/High) |
| DC-006 | Variant A: "1, 2, 3, 4 and HERO SKUS 3, 5, 6" (uppercase); Variant B: "1, 2, 3, 4 and Hero SKUs: 3, 5, 6" (mixed case + colon); Variant C: "1 2 3 4 and hero sk… | Every variant is recognized as a single-prompt Hero+Measurement definition; Each yields Measurement={1,2,3,4,5,6} and Hero={3,5,6} (identical to PRM-001); Casi… | TC-PRM-006 (Integration/Medium) |
| DC-007 | Prompt: "1, 2, 2, 3, 3 and hero skus 3, 3, 5, 5, 6" (duplicates in both lists); Expected Measurement={1,2,3,5,6} (unique), Hero={3,5,6} (unique) | Measurement SKUs deduped to {1,2,3,5,6} (5 unique entries, no duplicate rows); Hero SKUs deduped to {3,5,6} (3 unique entries); Measurement count = 5, Hero cou… | TC-PRM-007 (Integration/Medium) |
| DC-008 | Prompt: "1, 2, 3 and hero skus 3, 99999" where 99999 is invalid/non-existent | Valid SKUs parsed: Measurement contains {1,2,3}; Hero contains the valid Hero 3; Invalid SKU 99999 is NOT silently added as a valid Measurement or Hero entry; … | TC-PRM-008 (Integration/High) |
| DC-009 | Prompt: "1, 2, 3, 4 and hero skus 3, 5, 6"; Expected StateData.campaign_skus entries for {1,2,3,4,5,6}; is_hero True for {3,5,6}, False for {1,2,4} | campaign_skus contains exactly 6 entries: 1,2,3,4,5,6; is_hero == True for SKUs 3,5,6; is_hero == False for SKUs 1,2,4; Auto-added Hero SKUs 5,6 are present in… | TC-PRM-009 (Integration/High) |
| DC-010 | Follow-up prompt: "add 7, 8 and hero skus 8"; Expected after follow-up: Measurement={1,2,3,4,5,6,7,8}, Hero={3,5,6,8} | Mapped table updates without restarting the flow; Measurement SKUs = {1,2,3,4,5,6,7,8} (count 8); Hero SKUs = {3,5,6,8} (count 4); SKU 8 added as Hero and auto… | TC-PRM-010 (E2E/Medium) |
| DC-011 | Prompt: "1 and hero skus 1"; Expected Measurement={1}, Hero={1} | Measurement = {1} (1 entry); Hero = {1} (1 entry); the same SKU is both Measurement and Hero with no duplicate; Measurement count = 1, Hero count = 1 | TC-PRM-011 (Unit/Low) |
| DC-012 | Prompt: "1, 2, 3 and hero skus" (no ids after keyword) | Measurement SKUs = {1,2,3} parsed correctly; Hero set is empty OR the user is asked to specify Hero SKUs (exact behavior not specified in source — assert Measu… | TC-PRM-012 (Integration/Low) |
| DC-013 | Row A (subset): "1,2,3 and hero skus 2" → Measurement={1,2,3}, Hero={2}; Row B (extends): "1,2,3 and hero skus 3,4,5" → Measurement={1,2,3,4,5}, Hero={3,4,5}; … | Row A: Measurement={1,2,3}, Hero={2}, summary shown (no auto-add); Row B: Measurement={1,2,3,4,5} (4,5 auto-added), Hero={3,4,5}, summary shown; Row C: Measure… | TC-PRM-013 (Integration/High) |
| DC-014 | Brand-linked SKUs available for Hero: {1,2,3,4,5,6,7,8,9}; Current Measurement = {1,2,3,4,5,6}, current Hero = {3,5,6} | The Hero edit modal lists ALL brand-linked SKUs {1,2,3,4,5,6,7,8,9}, not only the current Measurement set; Currently-assigned Hero SKUs {3,5,6} are shown selec… | TC-PRM-014 (UI/Medium) |
| DC-015 | Initial Hero-flagged rows: {3,5,6}; non-Hero rows: {1,2,4} | Measurement table shows a "Hero SKU" indicator on rows 3,5,6 and none on rows 1,2,4; After unassigning 5: indicator on row 5 disappears in real time; Hero coun… | TC-PRM-015 (UI/Medium) |
| DC-016 | Variant forward: '1, 2, 3, 4 and hero skus 3, 5, 6'; Variant reversed: 'hero skus 3, 5, 6 and 1, 2, 3, 4'; Both expected: Measurement = {1,2,3,4,5,6}, Hero = {… | Both variants parse to Measurement = {1,2,3,4,5,6} and Hero = {3,5,6}.; Clause order does not change the parse result.; If the reversed order is NOT recognized… | TC-PRM-016 (Integration/Medium) |
| DC-017 | Prompt: 'please add some hero skus for me' (no numeric ids at all) | No Measurement or Hero SKUs are fabricated/added (both sets empty or unchanged).; The user is asked to specify SKU ids / the input is treated as needing clarif… | TC-PRM-017 (Integration/Medium) |
| DC-018 | Prompt: '1, 2, 3 and hero skus 1, 2, 3' (Hero == Measurement exactly); Expected Measurement = {1,2,3}, Hero = {1,2,3} | Measurement SKUs = {1,2,3} (count 3, no auto-add growth since Hero is fully contained).; Hero SKUs = {1,2,3} (count 3).; Each SKU appears exactly once and is H… | TC-PRM-018 (Integration/Medium) |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "sourceCaseId": "TC-PRM-001",
      "title": "Single prompt with Hero subset extending Measurement is parsed: Measurement={1,2,3,4,5,6}, Hero={3,5,6}",
      "technique": [
        "Positive",
        "Cross-Field",
        "State-Recompute"
      ],
      "preconditions": [
        "User is authenticated into Nectar AI Media Planner chat",
        "A brand with SKUs 1,2,3,4,5,6 linked is selected",
        "Channel/service selected has no Hero max configured (no maxHeroSkus) so parsing is verified in isolation"
      ],
      "testData": [
        "Prompt free text: \"1, 2, 3, 4 and hero skus 3, 5, 6\"",
        "Expected Measurement set: {1,2,3,4,5,6}",
        "Expected Hero set: {3,5,6}",
        "SKUs 5 and 6 are NOT in the typed Measurement list (1,2,3,4) and must be auto-added"
      ],
      "steps": [
        "1. Open Nectar AI chat and start a new media plan",
        "2. Send the single prompt: \"1, 2, 3, 4 and hero skus 3, 5, 6\"",
        "3. Wait for the assistant turn to complete (allow 30-60s)",
        "4. Inspect the resulting summary/mapped table for Measurement SKUs and Hero SKUs"
      ],
      "expectedText": [
        "Prompt is recognized as a single-prompt Hero+Measurement definition (no separate SKU-selection table step is shown)",
        "Measurement SKUs = exactly {1,2,3,4,5,6} (6 entries); SKUs 5 and 6 auto-added because they were declared Hero but not typed in Measurement",
        "Hero SKUs = exactly {3,5,6} (3 entries)",
        "SKU 3 appears once in Measurement and is flagged Hero (no duplicate)",
        "Summary panel shows Measurement count = 6 and Hero count = 3"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-PRM-001 E2E/Critical"
  },
  {
    "caseId": "DC-002",
    "inputs": {
      "sourceCaseId": "TC-PRM-002",
      "title": "Recognized single prompt skips the Measurement and Hero selection tables and shows summary directly",
      "technique": [
        "Positive",
        "Edge-Case"
      ],
      "preconditions": [
        "Authenticated chat session",
        "Brand with SKUs 1,2,3,4,5,6 linked"
      ],
      "testData": [
        "Prompt: \"1, 2, 3, 4 and hero skus 3, 5, 6\""
      ],
      "steps": [
        "1. Start a new media plan in chat",
        "2. Send the single prompt containing both Measurement and Hero SKUs",
        "3. Observe the assistant flow after the turn completes"
      ],
      "expectedText": [
        "The legacy step that forces the user to first select SKUs then show the Hero SKU table is bypassed",
        "A summary/mapped table is presented in a single step (no intermediate Measurement-selection table and no separate Hero-selection table prompt)",
        "Summary reflects Measurement={1,2,3,4,5,6}, Hero={3,5,6}"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-PRM-002 E2E/High"
  },
  {
    "caseId": "DC-003",
    "inputs": {
      "sourceCaseId": "TC-PRM-003",
      "title": "Hero SKU declared in prompt that is already in Measurement stays a single Measurement entry marked Hero",
      "technique": [
        "Positive",
        "Decision-Table",
        "Cross-Field"
      ],
      "preconditions": [
        "Authenticated chat session",
        "Brand with SKUs 1,2,3,4 linked"
      ],
      "testData": [
        "Prompt: \"1, 2, 3, 4 and hero skus 3\" (Hero is a strict subset of typed Measurement)",
        "Expected Measurement={1,2,3,4}, Hero={3}"
      ],
      "steps": [
        "1. Start a new media plan",
        "2. Send \"1, 2, 3, 4 and hero skus 3\"",
        "3. Wait for the turn to complete and inspect the summary"
      ],
      "expectedText": [
        "Measurement SKUs = {1,2,3,4} (4 entries, no auto-add because Hero 3 already present)",
        "SKU 3 appears exactly once in Measurement, flagged Hero",
        "Hero SKUs = {3} (1 entry)",
        "Measurement count = 4, Hero count = 1, no duplicate row for SKU 3"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-PRM-003 Integration/High"
  },
  {
    "caseId": "DC-004",
    "inputs": {
      "sourceCaseId": "TC-PRM-004",
      "title": "Hero SKUs entirely outside Measurement are all auto-added (hero extends measurement)",
      "technique": [
        "Positive",
        "Decision-Table",
        "Boundary-BVA",
        "State-Recompute"
      ],
      "preconditions": [
        "Authenticated chat session",
        "Brand with SKUs 1,2,7,8 linked"
      ],
      "testData": [
        "Prompt: \"1, 2 and hero skus 7, 8\" (no Hero overlaps typed Measurement)",
        "Expected Measurement={1,2,7,8}, Hero={7,8}"
      ],
      "steps": [
        "1. Start a new media plan",
        "2. Send \"1, 2 and hero skus 7, 8\"",
        "3. Wait for completion and inspect summary counts"
      ],
      "expectedText": [
        "Measurement SKUs = {1,2,7,8} (grew from typed 2 to 4 via auto-add of 7 and 8)",
        "Hero SKUs = {7,8} (2 entries)",
        "Measurement count = 4, Hero count = 2"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-PRM-004 Integration/High"
  },
  {
    "caseId": "DC-005",
    "inputs": {
      "sourceCaseId": "TC-PRM-005",
      "title": "Only Measurement SKUs typed (no hero keyword) falls back to the table/Hero-selection flow",
      "technique": [
        "Negative",
        "Decision-Table",
        "Edge-Case"
      ],
      "preconditions": [
        "Authenticated chat session",
        "Brand with SKUs 1,2,3,4 linked"
      ],
      "testData": [
        "Prompt: \"1, 2, 3, 4\" (no \"hero skus\" segment)",
        "Expected Measurement={1,2,3,4}, Hero={} until table flow"
      ],
      "steps": [
        "1. Start a new media plan",
        "2. Send \"1, 2, 3, 4\" with no Hero definition",
        "3. Observe assistant flow after completion"
      ],
      "expectedText": [
        "No Hero definition recognized; Hero set initially empty",
        "System falls back to the standard flow: Measurement SKUs accepted as {1,2,3,4} then the Hero SKU table/selection step is offered (single-prompt summary skip does NOT apply)",
        "Summary is not shown in place of the Hero-selection table"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-PRM-005 E2E/High"
  },
  {
    "caseId": "DC-006",
    "inputs": {
      "sourceCaseId": "TC-PRM-006",
      "title": "Equivalence: alternate phrasings/casing of the hero keyword are all recognized",
      "technique": [
        "Equivalence-Partition",
        "Positive"
      ],
      "preconditions": [
        "Authenticated chat session",
        "Brand with SKUs 1,2,3,5,6 linked",
        "ASSUMPTION: keyword matching is case-insensitive and tolerant of phrasing variants of \"hero skus\"; exact accepted synonyms are not enumerated in the source, so this case parameterizes phrasings and asserts equivalent parsing"
      ],
      "testData": [
        "Variant A: \"1, 2, 3, 4 and HERO SKUS 3, 5, 6\" (uppercase)",
        "Variant B: \"1, 2, 3, 4 and Hero SKUs: 3, 5, 6\" (mixed case + colon)",
        "Variant C: \"1 2 3 4 and hero skus 3 5 6\" (space separators)",
        "All expected to yield Measurement={1,2,3,4,5,6}, Hero={3,5,6}"
      ],
      "steps": [
        "1. For each phrasing variant A, B, C: start a fresh media plan",
        "2. Send the variant prompt",
        "3. Wait for completion and capture parsed Measurement and Hero sets",
        "4. Repeat for all variants"
      ],
      "expectedText": [
        "Every variant is recognized as a single-prompt Hero+Measurement definition",
        "Each yields Measurement={1,2,3,4,5,6} and Hero={3,5,6} (identical to PRM-001)",
        "Casing and separator style do not change the parsed result"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-PRM-006 Integration/Medium"
  },
  {
    "caseId": "DC-007",
    "inputs": {
      "sourceCaseId": "TC-PRM-007",
      "title": "Duplicate SKU ids in the prompt are deduped to unique entries",
      "technique": [
        "Edge-Case",
        "Equivalence-Partition",
        "Negative"
      ],
      "preconditions": [
        "Authenticated chat session",
        "Brand with SKUs 1,2,3,5,6 linked"
      ],
      "testData": [
        "Prompt: \"1, 2, 2, 3, 3 and hero skus 3, 3, 5, 5, 6\" (duplicates in both lists)",
        "Expected Measurement={1,2,3,5,6} (unique), Hero={3,5,6} (unique)"
      ],
      "steps": [
        "1. Start a new media plan",
        "2. Send the prompt containing repeated SKU ids",
        "3. Wait for completion and inspect counts"
      ],
      "expectedText": [
        "Measurement SKUs deduped to {1,2,3,5,6} (5 unique entries, no duplicate rows)",
        "Hero SKUs deduped to {3,5,6} (3 unique entries)",
        "Measurement count = 5, Hero count = 3",
        "SKU 3 appears once, flagged Hero"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-PRM-007 Integration/Medium"
  },
  {
    "caseId": "DC-008",
    "inputs": {
      "sourceCaseId": "TC-PRM-008",
      "title": "Hero SKU referencing a non-existent / non-brand-linked SKU is rejected with an error and does not silently auto-add",
      "technique": [
        "Negative",
        "Error-Message",
        "Edge-Case"
      ],
      "preconditions": [
        "Authenticated chat session",
        "Brand with SKUs 1,2,3,5 linked",
        "SKU 99999 is NOT a brand-linked / existing SKU",
        "ASSUMPTION: invalid SKU handling is not specified in the source; exact message text is parameterized and the case asserts the invalid SKU is not added as a valid Measurement/Hero entry"
      ],
      "testData": [
        "Prompt: \"1, 2, 3 and hero skus 3, 99999\" where 99999 is invalid/non-existent"
      ],
      "steps": [
        "1. Start a new media plan",
        "2. Send \"1, 2, 3 and hero skus 3, 99999\"",
        "3. Wait for completion and inspect the response and tables"
      ],
      "expectedText": [
        "Valid SKUs parsed: Measurement contains {1,2,3}; Hero contains the valid Hero 3",
        "Invalid SKU 99999 is NOT silently added as a valid Measurement or Hero entry",
        "The user is informed the referenced Hero SKU is invalid/unrecognized (exact text not specified in source — assert an error/clarification is surfaced rather than silent success)"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-PRM-008 Integration/High"
  },
  {
    "caseId": "DC-009",
    "inputs": {
      "sourceCaseId": "TC-PRM-009",
      "title": "is_hero flags in StateData.campaign_skus match the parsed Hero set after single-prompt parse",
      "technique": [
        "State-Recompute",
        "Data-Persistence",
        "Cross-Field"
      ],
      "preconditions": [
        "Authenticated chat session with backend StateData inspectable (API/DB or debug)",
        "Brand with SKUs 1,2,3,4,5,6 linked"
      ],
      "testData": [
        "Prompt: \"1, 2, 3, 4 and hero skus 3, 5, 6\"",
        "Expected StateData.campaign_skus entries for {1,2,3,4,5,6}; is_hero True for {3,5,6}, False for {1,2,4}"
      ],
      "steps": [
        "1. Start a new media plan",
        "2. Send the single prompt",
        "3. Wait for completion",
        "4. Read back StateData.campaign_skus"
      ],
      "expectedText": [
        "campaign_skus contains exactly 6 entries: 1,2,3,4,5,6",
        "is_hero == True for SKUs 3,5,6",
        "is_hero == False for SKUs 1,2,4",
        "Auto-added Hero SKUs 5,6 are present in campaign_skus with is_hero True"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-PRM-009 Integration/High"
  },
  {
    "caseId": "DC-010",
    "inputs": {
      "sourceCaseId": "TC-PRM-010",
      "title": "Adding more SKUs via chat after the summary updates the mapped table",
      "technique": [
        "State-Recompute",
        "Data-Persistence",
        "Positive"
      ],
      "preconditions": [
        "Authenticated chat session",
        "Brand with SKUs 1,2,3,4,5,6,7,8 linked",
        "Initial single prompt already parsed (Measurement={1,2,3,4,5,6}, Hero={3,5,6}) and summary shown"
      ],
      "testData": [
        "Follow-up prompt: \"add 7, 8 and hero skus 8\"",
        "Expected after follow-up: Measurement={1,2,3,4,5,6,7,8}, Hero={3,5,6,8}"
      ],
      "steps": [
        "1. Complete PRM-001 so the summary is displayed with Measurement count 6 / Hero count 3",
        "2. Send a follow-up chat: \"add 7, 8 and hero skus 8\"",
        "3. Wait for the assistant turn to complete",
        "4. Re-inspect the mapped/summary table"
      ],
      "expectedText": [
        "Mapped table updates without restarting the flow",
        "Measurement SKUs = {1,2,3,4,5,6,7,8} (count 8)",
        "Hero SKUs = {3,5,6,8} (count 4); SKU 8 added as Hero and auto-present in Measurement",
        "Counts in summary panel reflect the new totals"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-PRM-010 E2E/Medium"
  },
  {
    "caseId": "DC-011",
    "inputs": {
      "sourceCaseId": "TC-PRM-011",
      "title": "Boundary: single Measurement SKU also declared Hero (smallest valid single-prompt set)",
      "technique": [
        "Boundary-BVA",
        "Edge-Case",
        "Positive"
      ],
      "preconditions": [
        "Authenticated chat session",
        "Brand with SKU 1 linked"
      ],
      "testData": [
        "Prompt: \"1 and hero skus 1\"",
        "Expected Measurement={1}, Hero={1}"
      ],
      "steps": [
        "1. Start a new media plan",
        "2. Send \"1 and hero skus 1\"",
        "3. Wait for completion and inspect"
      ],
      "expectedText": [
        "Measurement = {1} (1 entry)",
        "Hero = {1} (1 entry); the same SKU is both Measurement and Hero with no duplicate",
        "Measurement count = 1, Hero count = 1"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-PRM-011 Unit/Low"
  },
  {
    "caseId": "DC-012",
    "inputs": {
      "sourceCaseId": "TC-PRM-012",
      "title": "Edge: hero keyword present but with empty Hero list is treated as no Hero (or surfaced), Measurement still parsed",
      "technique": [
        "Edge-Case",
        "Negative",
        "Error-Message"
      ],
      "preconditions": [
        "Authenticated chat session",
        "Brand with SKUs 1,2,3 linked",
        "ASSUMPTION: behavior for a dangling \"hero skus\" with no ids is not specified; case parameterizes the outcome and asserts Measurement is unaffected"
      ],
      "testData": [
        "Prompt: \"1, 2, 3 and hero skus\" (no ids after keyword)"
      ],
      "steps": [
        "1. Start a new media plan",
        "2. Send \"1, 2, 3 and hero skus\"",
        "3. Wait for completion and inspect"
      ],
      "expectedText": [
        "Measurement SKUs = {1,2,3} parsed correctly",
        "Hero set is empty OR the user is asked to specify Hero SKUs (exact behavior not specified in source — assert Measurement unaffected and no invalid Hero entry created)"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-PRM-012 Integration/Low"
  },
  {
    "caseId": "DC-013",
    "inputs": {
      "sourceCaseId": "TC-PRM-013",
      "title": "Decision-table: parse outcome across (hero ⊆ measurement | hero extends measurement | hero only | measurement only)",
      "technique": [
        "Decision-Table",
        "Equivalence-Partition",
        "State-Recompute"
      ],
      "preconditions": [
        "Authenticated chat session",
        "Brand with SKUs 1,2,3,4,5,6,7 linked"
      ],
      "testData": [
        "Row A (subset): \"1,2,3 and hero skus 2\" → Measurement={1,2,3}, Hero={2}",
        "Row B (extends): \"1,2,3 and hero skus 3,4,5\" → Measurement={1,2,3,4,5}, Hero={3,4,5}",
        "Row C (hero only/no overlap with typed): \"1,2 and hero skus 6,7\" → Measurement={1,2,6,7}, Hero={6,7}",
        "Row D (measurement only): \"1,2,3\" → Measurement={1,2,3}, Hero={} → table flow"
      ],
      "steps": [
        "1. For each row A-D, start a fresh media plan",
        "2. Send the row's prompt",
        "3. Wait for completion and capture parsed Measurement and Hero sets and whether single-prompt summary or table flow was used",
        "4. Validate against the row's expected"
      ],
      "expectedText": [
        "Row A: Measurement={1,2,3}, Hero={2}, summary shown (no auto-add)",
        "Row B: Measurement={1,2,3,4,5} (4,5 auto-added), Hero={3,4,5}, summary shown",
        "Row C: Measurement={1,2,6,7} (6,7 auto-added), Hero={6,7}, summary shown",
        "Row D: Measurement={1,2,3}, Hero empty, falls back to Hero-selection table flow (no single-prompt summary skip)"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-PRM-013 Integration/High"
  },
  {
    "caseId": "DC-014",
    "inputs": {
      "sourceCaseId": "TC-PRM-014",
      "title": "Single-prompt edit of Hero SKUs offers all brand-linked SKUs (not only Measurement)",
      "technique": [
        "Positive",
        "Cross-Field"
      ],
      "preconditions": [
        "Authenticated chat session",
        "Brand with SKUs 1,2,3,4,5,6 plus additional brand-linked SKUs 7,8,9 not in current Measurement",
        "Single prompt \"1,2,3,4 and hero skus 3,5,6\" already parsed; summary shown"
      ],
      "testData": [
        "Brand-linked SKUs available for Hero: {1,2,3,4,5,6,7,8,9}",
        "Current Measurement = {1,2,3,4,5,6}, current Hero = {3,5,6}"
      ],
      "steps": [
        "1. From the single-prompt summary, open the Hero SKU edit modal",
        "2. Inspect the list of SKUs available to assign as Hero"
      ],
      "expectedText": [
        "The Hero edit modal lists ALL brand-linked SKUs {1,2,3,4,5,6,7,8,9}, not only the current Measurement set",
        "Currently-assigned Hero SKUs {3,5,6} are shown selected/checked",
        "Selecting a non-Measurement SKU (e.g. 7) and confirming auto-adds it to Measurement (Measurement count grows)"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-PRM-014 UI/Medium"
  },
  {
    "caseId": "DC-015",
    "inputs": {
      "sourceCaseId": "TC-PRM-015",
      "title": "Measurement SKUs table shows real-time Hero indicator reflecting the single-prompt parse and subsequent edits",
      "technique": [
        "State-Recompute",
        "Positive",
        "Data-Persistence"
      ],
      "preconditions": [
        "Authenticated chat session",
        "Brand with SKUs 1,2,3,4,5,6 linked",
        "Single prompt \"1,2,3,4 and hero skus 3,5,6\" parsed; Measurement table visible"
      ],
      "testData": [
        "Initial Hero-flagged rows: {3,5,6}; non-Hero rows: {1,2,4}"
      ],
      "steps": [
        "1. After parsing, open/view the Measurement SKUs table",
        "2. Verify the Hero SKU indicator on each row",
        "3. Open the Hero edit modal, unassign SKU 5, confirm",
        "4. Re-inspect the Measurement table and summary counts",
        "5. Re-assign SKU 5 as Hero, confirm, re-inspect"
      ],
      "expectedText": [
        "Measurement table shows a \"Hero SKU\" indicator on rows 3,5,6 and none on rows 1,2,4",
        "After unassigning 5: indicator on row 5 disappears in real time; Hero count = 2; SKU 5 remains a Measurement row (Measurement count still 6)",
        "After re-assigning 5: indicator on row 5 reappears in real time; Hero count back to 3",
        "Summary panel counts update after each change (Hero count tracks selection)"
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-PRM-015 UI/Medium"
  },
  {
    "caseId": "DC-016",
    "inputs": {
      "sourceCaseId": "TC-PRM-016",
      "title": "Single-prompt parse equivalence: Measurement and Hero lists given in REVERSED order ('hero skus ... and ...') parse identically",
      "technique": [
        "Equivalence-Partition",
        "Positive",
        "Decision-Table"
      ],
      "preconditions": [
        "Authenticated chat session.",
        "Brand with SKUs 1,2,3,4,5,6 linked.",
        "ASSUMPTION: ordering of the Hero clause relative to the Measurement clause is not specified as significant; this case parameterizes order and asserts equivalence, flagging a gap if reversed order is not recognized."
      ],
      "testData": [
        "Variant forward: '1, 2, 3, 4 and hero skus 3, 5, 6'",
        "Variant reversed: 'hero skus 3, 5, 6 and 1, 2, 3, 4'",
        "Both expected: Measurement = {1,2,3,4,5,6}, Hero = {3,5,6}"
      ],
      "steps": [
        "1. Send the forward variant in a fresh plan; capture parsed Measurement and Hero sets.",
        "2. Send the reversed variant in a fresh plan; capture parsed sets.",
        "3. Compare the two results."
      ],
      "expectedText": [
        "Both variants parse to Measurement = {1,2,3,4,5,6} and Hero = {3,5,6}.",
        "Clause order does not change the parse result.",
        "If the reversed order is NOT recognized, record it as a documented gap rather than a silent pass."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-PRM-016 Integration/Medium"
  },
  {
    "caseId": "DC-017",
    "inputs": {
      "sourceCaseId": "TC-PRM-017",
      "title": "Single-prompt parse negative: free text with no numeric SKU ids and a stray 'hero skus' keyword does not fabricate SKUs",
      "technique": [
        "Negative",
        "Edge-Case",
        "Error-Message"
      ],
      "preconditions": [
        "Authenticated chat session.",
        "Brand with SKUs 1,2,3 linked.",
        "ASSUMPTION: behavior for a prompt mentioning 'hero skus' with no parseable ids anywhere is not specified; assert no invalid SKUs are created and the user is asked to clarify."
      ],
      "testData": [
        "Prompt: 'please add some hero skus for me' (no numeric ids at all)"
      ],
      "steps": [
        "1. Start a new media plan.",
        "2. Send the prompt containing the hero keyword but no SKU ids.",
        "3. Wait for completion and inspect Measurement/Hero sets and the assistant response."
      ],
      "expectedText": [
        "No Measurement or Hero SKUs are fabricated/added (both sets empty or unchanged).",
        "The user is asked to specify SKU ids / the input is treated as needing clarification rather than silently producing a Hero set.",
        "No invalid SKU row appears."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-PRM-017 Integration/Medium"
  },
  {
    "caseId": "DC-018",
    "inputs": {
      "sourceCaseId": "TC-PRM-018",
      "title": "Single-prompt parse equivalence: Measurement and Hero lists that fully overlap ('1,2,3 and hero skus 1,2,3') yield Measurement={1,2,3}, all Hero, no growth",
      "technique": [
        "Equivalence-Partition",
        "Boundary-BVA",
        "Decision-Table"
      ],
      "preconditions": [
        "Authenticated chat session.",
        "Brand with SKUs 1,2,3 linked."
      ],
      "testData": [
        "Prompt: '1, 2, 3 and hero skus 1, 2, 3' (Hero == Measurement exactly)",
        "Expected Measurement = {1,2,3}, Hero = {1,2,3}"
      ],
      "steps": [
        "1. Start a new media plan.",
        "2. Send '1, 2, 3 and hero skus 1, 2, 3'.",
        "3. Wait for completion and inspect the summary."
      ],
      "expectedText": [
        "Measurement SKUs = {1,2,3} (count 3, no auto-add growth since Hero is fully contained).",
        "Hero SKUs = {1,2,3} (count 3).",
        "Each SKU appears exactly once and is Hero-flagged; no duplicate rows.",
        "Measurement count == Hero count == 3."
      ]
    },
    "expected": {
      "outcome": "matches the documented case behaviour"
    },
    "notes": "TC-PRM-018 Integration/Medium"
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
| salientCopy | hero, Measurement | Salient strings the generated tests must assert |

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
| 2 | AC-002 | Seed the brand-linked SKUs referenced by the prompt via API | dataManager.ensureBrandLinkedSkus | brand; prompt SKUs | The catalogue contains the SKUs named in the prompt | precondition helper resolves without error |
| 3 | AC-003 | Select advertiser and brand | Guided planner controls | advertiser; brand; Confirm | Advertiser and brand are shown on the summary panel | advertiser and brand visible on summary |
| 4 | AC-004 | Send the case's single Hero+Measurement prompt | Assistant chat | case prompt; Send | The assistant parses the prompt into Measurement and Hero sets | assistant returns a parsed selection |
| 5 | AC-005 | Apply the parsed selection | Assistant chat | Confirm | The parsed Measurement and Hero SKUs are applied to the plan | summary reflects the parsed selection |
| 6 | AC-006 | Verify the parsed Measurement and Hero sets | Summary panel counts and SKU lists | n/a | The Measurement and Hero sets equal the expected parse, including any dual-role SKU, and unknown SKUs are reported | parsed sets match the case |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | A prompt names a SKU not linked to the brand | The unrecognised SKU is reported to the user rather than silently dropped |
| NEG-002 | A prompt lists a SKU as both Measurement and Hero | The SKU is recognised in both roles |

## Acceptance Criteria

- AC-001: The guided flow is active
- AC-002: The catalogue contains the SKUs named in the prompt
- AC-003: Advertiser and brand are shown on the summary panel
- AC-004: The assistant parses the prompt into Measurement and Hero sets
- AC-005: The parsed Measurement and Hero SKUs are applied to the plan
- AC-006: The Measurement and Hero sets equal the expected parse, including any dual-role SKU, and unknown SKUs are reported

## Locator Hints

- Prefer role/name and data-testid locators owned by PlanningPage / NectarFlow page objects.
- Use exact visible text for counter copy (e.g. "hero") and summary panel values.
- Use CSS only with an explicit `// locator-policy:exception <reason>` comment directly above the locator call.

## Generated Test Requirements

- Must import from fixtures/test and use Page Objects / Component Objects for all locators.
- Generation Mode is suite: generate one focused test per Data Case (DC-###), each enumerating its DC id in the title.
- Across the suite, every AC id (AC-001, AC-002, AC-003, AC-004, AC-005, AC-006) must be covered by at least one test.
- Seed preconditions via the `dataManager` fixture (fixtures/test-data-manager.ts); do not configure data through the admin UI.
- Put `expect(...)` only in the final assertion step of each test; title it `Assert AC-###: ...`.
- Must assert the salient expected values "hero", "Measurement".
- Must not use page.waitForTimeout, networkidle, XPath, test.only, or any form of skip; must not use real credentials or commit auth state.

## Notes

- This suite targets the live Pollen development environment; `Parallel Safe` is `no` and `Data Isolation` is `external`.
- E2E-only policy: every Data Case row above maps to an emitted, executable end-to-end test (API seed of REAL catalogue SKUs -> direct seeded-session navigation -> live UI assertion). Source cases that cannot be verified end-to-end today are enumerated under Pending Automation with their blockers — no weak panel-smoke or guaranteed-red placeholder tests are generated for them.
- Source: specs/test-cases-skus-2.yaml (area: Single-prompt Hero and Measurement recognition and parsing); every row keeps its source case id for traceability.
- Locators were live-audited (2026-07-02/03) against the dev environment; the seed/hydrate/assert pipeline is live-proven.

## Pending Automation (no test emitted)

These 18 source cases are E2E-specified but cannot be verified end-to-end today. They are intentionally NOT generated — the framework ships only executable E2E tests.

| Source Case | Blocker |
|---|---|
| TC-PRM-001 — Single prompt with Hero subset extending Measurement is parsed: Measurement={1,2,3,4,5,6}, Hero={3,5,6} | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-PRM-002 — Recognized single prompt skips the Measurement and Hero selection tables and shows summary directly | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-PRM-003 — Hero SKU declared in prompt that is already in Measurement stays a single Measurement entry marked Hero | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-PRM-004 — Hero SKUs entirely outside Measurement are all auto-added (hero extends measurement) | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-PRM-005 — Only Measurement SKUs typed (no hero keyword) falls back to the table/Hero-selection flow | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-PRM-006 — Equivalence: alternate phrasings/casing of the hero keyword are all recognized | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-PRM-007 — Duplicate SKU ids in the prompt are deduped to unique entries | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-PRM-008 — Hero SKU referencing a non-existent / non-brand-linked SKU is rejected with an error and does not silently au… | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-PRM-009 — is_hero flags in StateData.campaign_skus match the parsed Hero set after single-prompt parse | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-PRM-010 — Adding more SKUs via chat after the summary updates the mapped table | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-PRM-011 — Boundary: single Measurement SKU also declared Hero (smallest valid single-prompt set) | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-PRM-012 — Edge: hero keyword present but with empty Hero list is treated as no Hero (or surfaced), Measurement still pa… | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-PRM-013 — Decision-table: parse outcome across (hero ⊆ measurement \\| hero extends measurement \\| hero only \\| measurem… | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-PRM-014 — Single-prompt edit of Hero SKUs offers all brand-linked SKUs (not only Measurement) | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-PRM-015 — Measurement SKUs table shows real-time Hero indicator reflecting the single-prompt parse and subsequent edits | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-PRM-016 — Single-prompt parse equivalence: Measurement and Hero lists given in REVERSED order ('hero skus ... and ...')… | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
| TC-PRM-017 — Single-prompt parse negative: free text with no numeric SKU ids and a stray 'hero skus' keyword does not fabr… | no-assertable-expectation: the source case has no UI-checkable outcome without the assistant flow |
| TC-PRM-018 — Single-prompt parse equivalence: Measurement and Hero lists that fully overlap ('1,2,3 and hero skus 1,2,3') … | ui-flow-expectation: the expected counts assume assistant-flow actions beyond the seeded state |
