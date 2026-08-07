# Flow: Extended SKU management across conversation, editors and combined summary

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-023 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P0 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/sains/sku-management-extended.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @sku-management-extended |
| Review Status | pending-review |
| Review Sign-off | pending |
| Generation Source | manual-test-case |
| Generation Status | generated |
| Generation Mode | suite |

## User Story

As a media planner,
I want measurement SKUs mapped from SKU numbers, hero assignments editable from the conversation, the editors and the combined summary — with brand isolation, deduplication and a post-channel lock enforced,
So that my plan's SKU selection always reflects exactly what I chose, with no duplicates, no foreign-brand products and no accidental loss of confirmed SKUs.

## Preconditions

- The user has a valid non-production authenticated Playwright storage state (`playwright/.auth/user.json`).
- `PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.pollen.js-devops.co.uk/`.
- Local storage key `feature-flags` enables `FEATURE_NECTAR_AI`, `FEATURE_NUP`, and `FEATURE_NECTAR_AI_MP`.
- The advertiser `N360_Unilever_MS`, brand `Unilever | Knorr | MS`, and objective `Customer retention` are available for the guided journeys.
- The Knorr SKU numbers 2023755, 2023779 and 2023786 are brand-linked in the dev catalogue (verified read-only against the live planning API, 2026-07-11).
- `NECTAR_PLANNING_SESSION_ID` pins a disposable QA-owned planningAI session whose selected brand is the Persil catalogue pool (`specs/skus/.sku-pools.json`, 102 live-probed SKU ids) for the seeded editor cases.
- The offsite channel `Meta` is bookable for a runtime-computed future campaign window with a 7k budget (needed only by the post-channel lock case).

## Out-of-scope

- Admin and channel configuration changes (max/min hero limits) are out of scope and must remain read-only.
- Saving, discarding and booking the plan are out of scope (covered by FLOW-MP-020/FLOW-MP-022).
- Per-channel hero editing and channel-deletion synchronization are out of scope (covered by the skus suites).
- Single-prompt parsing equivalence classes (phrasings, orderings, invalid ids) are out of scope (covered by FLOW-SKU-PARSE).
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
| RULE-001 | Hero SKUs are always a subset of Measurement SKUs | measurementCount(after) = measurementCount(before) + countOf(newly assigned heroes not already in the measurement set); every SKU renders exactly one row per list | A hero without a measurement row, a duplicate row, or an inflated counter is a defect |
| RULE-002 | Hero candidates come only from the selected brand catalogue | candidateSet is a subset of brandCatalogue(selectedBrand); a crafted cross-brand SET_SKUS payload is rejected or not persisted | Offering or persisting a foreign-brand SKU is a brand-isolation defect |
| RULE-003 | The confirmed global SKU set locks once a channel is provided | a SET_SKUS removal issued after a channel exists leaves the persisted campaignSkus unchanged | A post-channel removal that persists is a data-integrity defect |
| RULE-004 | Conversational updates deduplicate SKU numbers | counters count unique skuIds only; a repeated skuId adds no additional row | Count inflation from repeated ids is a defect |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | guided journey to measurement search; enter SKU number 2023755 | Exactly one product row maps, labelled with the catalogue product name and the SKU number | E2E-SKU-002; NUP-15404 |
| DC-002 | guided journey; measurements 2023755 and 2023779 confirmed; both promoted to hero; unassign 2023779 in the conversation | The unassign is immediate (no confirmation dialog); exactly one row returns to the promotable state; the row remains a measurement row | E2E-SKU-009; NUP-15404 AC Scenario 2 |
| DC-003 | pinned session seeded hero {7096764}, measurement {7096764, 7304367}; open the Hero editor | Brand SKUs 7759164 and 8114265 (outside the measurement set) are offered as candidates; the foreign-brand SKU 2023755 is not offered | E2E-SKU-014; NUP-20956; NUP-21959 |
| DC-004 | seeded baseline; promote 8114265 in one Hero edit and confirm | Hero counter 2 and measurement counter 3 (the non-measurement hero was auto-added once) | E2E-SKU-015; NUP-20956; NUP-21960 |
| DC-005 | seeded baseline; promote 7304367, 7759164 and 8114265 in one Hero edit and confirm | Hero counter 4 and measurement counter 4 (only the two missing SKUs were auto-added); each promoted SKU has exactly one measurement row | E2E-SKU-017; NUP-20956; NUP-21965 |
| DC-006 | seeded baseline; open the Measurement editor | The hero row 7096764 carries the hero indicator, the measurement-only row 7304367 does not, and both keep exactly one row with the selected count at 2 | E2E-SKU-018; NUP-20956; NUP-21966 |
| DC-007 | seeded baseline; assign 7304367 as hero via the Hero editor, then unassign it, all in one page session | The indicator appears on the toggled row after assignment and disappears after unassignment without a page reload; hero counter returns to 1 and measurement counter stays 2 | E2E-SKU-019; NUP-21968 |
| DC-008 | seeded baseline on the 102-SKU Persil pool; search and select 8119540 and 7495079 in separate searches; re-search the first; confirm | The earlier selection is still checked after later searches and saving commits the exact unique selection (hero counter 3) | E2E-SKU-028; NUP-20956 |
| DC-009 | guided journey; combined single prompt with SKU numbers; inspect summary edit controls before and after confirmation | Before confirmation no summary edit control is offered; after confirmation both the Measurement and Hero edit controls are enabled | E2E-SKU-035; NUP-19273 |
| DC-010 | combined summary displayed; follow-up chat adds 2023786 and repeats 2023779 before any confirmation; confirm the refreshed review | The new SKU appears once in the refreshed table; confirmed counters equal the deduplicated totals (measurement 3, hero 1) | E2E-SKU-036; NUP-19273 |
| DC-011 | combined summary confirmed first; the same follow-up chat is sent afterwards; confirm the refreshed review | Same deduplicated totals (measurement 3, hero 1); the repeated SKU does not inflate any count | E2E-SKU-037; NUP-19273 |
| DC-012 | combined summary displayed; open the Edit SKU list action beneath it; promote 2023786 and confirm | The Hero editor (not the Measurement editor) opens; the promotion is reflected in the combined table and persists when the editor is reopened | E2E-SKU-040; NUP-19216; NUP-21714; NUP-21978 |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "journey": "guided to measurement search",
      "skuNumber": 2023755
    },
    "expected": {
      "mappedRows": 1
    },
    "notes": "E2E-SKU-002; NUP-15404 — SKU-number entry maps once with the catalogue name."
  },
  {
    "caseId": "DC-002",
    "inputs": {
      "journey": "measurements confirmed and both promoted",
      "skuNumbers": [2023755, 2023779],
      "unassign": 2023779
    },
    "expected": {
      "promotableRowsAfterUnassign": 1,
      "confirmationDialogs": 0,
      "rowRemainsMeasurement": true
    },
    "notes": "E2E-SKU-009 — immediate in-conversation hero unassign."
  },
  {
    "caseId": "DC-003",
    "inputs": {
      "seedHero": [7096764],
      "seedMeasurement": [7096764, 7304367],
      "brandCandidates": [7759164, 8114265],
      "foreignSku": 2023755
    },
    "expected": {
      "brandCandidatesOffered": 2,
      "foreignCandidateRows": 0
    },
    "notes": "E2E-SKU-014 — all-brand-linked candidate scope; foreign brand absent."
  },
  {
    "caseId": "DC-004",
    "inputs": {
      "promote": [8114265]
    },
    "expected": {
      "heroCount": 2,
      "measurementCount": 3
    },
    "notes": "E2E-SKU-015 — single non-measurement hero auto-adds one measurement."
  },
  {
    "caseId": "DC-005",
    "inputs": {
      "promote": [7304367, 7759164, 8114265]
    },
    "expected": {
      "heroCount": 4,
      "measurementCount": 4
    },
    "notes": "E2E-SKU-017 — bulk mixed promotion adds only the missing measurements."
  },
  {
    "caseId": "DC-006",
    "inputs": {
      "seedHero": [7096764],
      "seedMeasurement": [7096764, 7304367]
    },
    "expected": {
      "heroIndicatorRows": 1,
      "indicatorFreeRows": 1,
      "selectedCount": 2
    },
    "notes": "E2E-SKU-018 — indicator marks exactly the current heroes without extra rows."
  },
  {
    "caseId": "DC-007",
    "inputs": {
      "toggleHero": 7304367
    },
    "expected": {
      "indicatorRowsAfterAssign": 1,
      "indicatorRowsAfterUnassign": 0,
      "heroCount": 1,
      "measurementCount": 2
    },
    "notes": "E2E-SKU-019 — indicator follows assignment changes without reload."
  },
  {
    "caseId": "DC-008",
    "inputs": {
      "deepCatalogueSkus": [8119540, 7495079],
      "cataloguePoolSize": 102
    },
    "expected": {
      "selectionRetainedAcrossSearches": true,
      "heroCount": 3
    },
    "notes": "E2E-SKU-028 — large-catalogue search, selection persistence, exact save."
  },
  {
    "caseId": "DC-009",
    "inputs": {
      "combinedPrompt": "2023755, 2023779 and hero skus 2023755"
    },
    "expected": {
      "editControlsBeforeConfirm": 0,
      "editControlsEnabledAfterConfirm": 2
    },
    "notes": "E2E-SKU-035 — confirmation gates the summary edit controls."
  },
  {
    "caseId": "DC-010",
    "inputs": {
      "followUpRequest": "add 2023786, 2023779",
      "confirmInitialSummaryFirst": false
    },
    "expected": {
      "measurementCount": 3,
      "heroCount": 1
    },
    "notes": "E2E-SKU-036 — chat augmentation before confirmation, deduplicated."
  },
  {
    "caseId": "DC-011",
    "inputs": {
      "followUpRequest": "add 2023786, 2023779",
      "confirmInitialSummaryFirst": true
    },
    "expected": {
      "measurementCount": 3,
      "heroCount": 1
    },
    "notes": "E2E-SKU-037 — chat augmentation after the initial summary, deduplicated."
  },
  {
    "caseId": "DC-012",
    "inputs": {
      "promoteViaEditAction": 2023786
    },
    "expected": {
      "heroEditorOpens": true,
      "measurementEditorDialogs": 0,
      "promotedRowPersists": true
    },
    "notes": "E2E-SKU-040 — the combined-summary edit action opens the Hero editor."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| advertiser | N360_Unilever_MS | Non-production advertiser |
| brand | Unilever \| Knorr \| MS | Non-production brand for the guided journeys |
| objective | Customer retention | Nectar AI planning objective |
| channelRequest | Offsite, Meta, <today+45d> till <today+75d>, the budget is 7k, Self-Serve | Free-text channel request; dates computed at runtime (NEG-001 only) |
| knorrHeroSku | 2023755 | Knorr 8 Vegetable Stock Cubes 80g (live-verified 2026-07-11) |
| knorrSecondSku | 2023779 | Knorr 8 Beef Stock Cubes 80g (live-verified 2026-07-11) |
| knorrFollowUpSku | 2023786 | Knorr 8 Chicken Stock Cubes 80g (live-verified 2026-07-11) |
| combinedPrompt | 2023755, 2023779 and hero skus 2023755 | Single-prompt combined Hero+Measurement definition |
| followUpRequest | add 2023786, 2023779 | One new SKU plus one repeated SKU |
| pinnedSession | NECTAR_PLANNING_SESSION_ID | QA-owned Persil-brand planningAI session for the seeded editor cases |
| persilSeedHero | 7096764 | Seeded hero+measurement SKU (Persil pool) |
| persilSeedMeasurement | 7304367 | Seeded measurement-only SKU (Persil pool) |
| persilCandidates | 7759164, 8114265 | Brand SKUs outside the seeded measurement set |
| persilDeepCatalogue | 8119540, 7495079 | Deep-catalogue SKUs for the large-pool search case |
| skuPool | specs/skus/.sku-pools.json | Real catalogue pool (102 live-probed Persil ids) |
| skuNameSource | fixtures/nectar-api.ts getSkusBySkuId | Catalogue names resolved at runtime for editor searches |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | Live Pollen development environment drives both the guided journeys and the seeded pinned session | [] |

## Mocks as JSON

```json
[]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Search measurement products by SKU number | Guided planner + assistant chat | advertiser; brand; objective; skuNumber | Exactly one product row maps for the entered brand SKU number, labelled with the catalogue product name | mapped row count and label |
| 2 | AC-002 | Promote two conversation SKUs to hero, then unassign one | Hero-selection step in the chat | two SKU numbers; unassign target | The unassign takes effect immediately with no confirmation dialog; the row returns to the promotable state and stays listed as a measurement row | promote-control count and dialog count |
| 3 | AC-003 | Open the global Hero editor on a seeded session | Summary panel Hero edit control | seeded hero and measurement sets | Brand SKUs outside the measurement set are offered as candidates and a foreign-brand SKU is not offered | candidate search results |
| 4 | AC-004 | Promote candidate SKUs in one Hero edit and confirm | Hero editor | case promote list | Hero and measurement counters recompute to the expected unique totals and each promoted SKU has exactly one measurement row | summary counters plus row counts |
| 5 | AC-005 | Toggle a hero assignment and inspect the Measurement editor | Measurement editor rows | hero toggle target | Rows currently assigned as hero carry the `Hero SKU` indicator, other rows do not, and the indicator follows assignment changes without a page reload | indicator presence per row |
| 6 | AC-006 | Search and select across a large brand catalogue in the Hero editor | Hero editor search | two deep-catalogue SKU names | The search exposes eligible deep-catalogue SKUs, an earlier selection stays checked after later searches, and saving commits the exact unique selection | checked state plus hero counter |
| 7 | AC-007 | Review the combined summary before and after confirmation | Summary panel edit controls | combined single prompt; Confirm | The summary edit controls are absent before confirmation and both the Measurement and Hero edit controls are enabled after | edit-control count then enabled state |
| 8 | AC-008 | Send a follow-up chat message with one new and one repeated SKU | Assistant chat | follow-up request; Confirm | The refreshed selection includes the new SKU once and the confirmed counters equal the deduplicated totals | chat row plus counters |
| 9 | AC-009 | Open the Edit SKU list action under the combined summary and promote a SKU | Combined summary edit action | promote target | The Hero editor opens rather than the Measurement editor, and the promotion is reflected in the combined table and persists when the editor reopens | dialog identity plus row persistence |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | After a channel is provided, attempt to remove a confirmed global SKU through a direct state update | The persisted campaign SKU set is unchanged and the summary keeps the confirmed measurement count |
| NEG-002 | A wrong-brand SKU is searched in the Hero editor and a crafted cross-brand state update is attempted | The foreign SKU is not offered as a candidate and the cross-brand update is not persisted |

## Acceptance Criteria

- AC-001: Entering a valid brand SKU number in the measurement search maps exactly one product row whose label carries the catalogue product name and the SKU number.
- AC-002: Unassigning a hero in the conversation takes effect immediately: no confirmation dialog opens, exactly one row returns to the promotable state, and the unassigned row remains listed as a measurement row.
- AC-003: The global Hero editor offers brand SKUs beyond the current measurement set as candidates and offers no foreign-brand SKU.
- AC-004: Confirming hero promotions auto-adds only the missing SKUs to the measurement set and the summary counters recompute to the expected unique totals.
- AC-005: The Measurement editor marks exactly the current hero rows with the hero indicator, and the indicator follows hero assignment changes within the same page session without a reload.
- AC-006: With a large brand catalogue, the Hero editor search exposes eligible SKUs, retains selections across searches, and saving commits the exact unique selection.
- AC-007: Before the combined summary is confirmed the summary-panel edit controls are absent; after confirmation both the Measurement and Hero edit controls are enabled.
- AC-008: A follow-up chat message updates the combined selection: the new SKU is added once, the repeated SKU does not inflate the totals, and the confirmed summary counters equal the deduplicated totals.
- AC-009: The Edit SKU list action under the combined summary opens the Hero editor (not the Measurement editor), and a promotion made there is reflected in the combined table and persists when the editor is reopened.

## Locator Hints

- Use `PlanningPage.summaryHeroCount()` / `PlanningPage.summaryMeasurementCount()` for the summary counters; the rows concatenate text without whitespace, so assert with a digit-lookbehind count pattern, never an exact-text match.
- Use `PlanningPage.openHeroEditModal()` / `PlanningPage.openMeasurementEditModal()`, `PlanningPage.modalSkuRow(sku)`, `PlanningPage.modalSelectedCount()`, and `PlanningPage.editModalConfirm()` / `PlanningPage.editModalCancel()` for the verified editor surfaces.
- Use `PlanningPage.productCheckboxes()` and `PlanningPage.addHeroSkuButton()` for the in-chat product rows and promote controls.
- `SkuManagementExtendedComponent` (pages/SkuManagementExtendedComponent.ts) owns the new surfaces: the editor search box and candidate rows, the hero-indicator badge, the chat-panel SKU rows and removal controls, the combined-summary Edit SKU list action and the dialog-identity locators. Its inferred locators are documented in the class and must be healed on the first live run.
- Never use positional picks without a `// locator-policy:exception <reason>` comment; prefer role/name and data-testid locators throughout.

## Generated Test Requirements

- Must import from fixtures/test.
- Must use test.step.
- Must use Page Objects or Component Objects for all locators.
- Must not create direct `page.getBy*` or `page.locator(...)` locators in generated test bodies.
- This spec declares `Generation Mode | suite`; emit one focused test per Data Case (DC-001 through DC-012) plus one test per negative case (NEG-001, NEG-002), each enumerating its case id in the title, and parameterize coherent groups by looping over case-row arrays.
- Must declare the spec metadata `Tags` exactly via the Playwright `{ tag: [...] }` option on every test.
- Must put `expect(...)` only in the final assertion step for each test.
- Must title the final assertion step `Assert AC-###: ...` or `Assert NEG-###: ...`.
- Seeded pinned-session cases must restore the seeded selection through the `dataManager` fixture (or an equivalent fixture write) before finishing, so the shared session is left as the manager's last write.
- API-assisted state reads and crafted state-update attempts must go through the existing `fixtures/nectar-api.ts` helpers only.
- Default generated-test execution target is Chromium only.
- Cross-browser generated-test execution is opt-in.
- Must not use page.waitForTimeout.
- Must not use page.waitForLoadState('networkidle').
- Must not use XPath.
- Must not use test.only.
- Must not silently skip (`test.skip`/`test.fixme`/`test.fail` in any form).
- Must not use real credentials.
- Must not commit auth state.
- Must not set `test.use({ storageState: <literal> })`; the `.authenticated.spec.ts` suffix routes the test to the `chromium-auth` project.
- Tests live in the dedicated `tests/regression/sains/` folder (Jira-docs-derived suite).

## Notes

- Sources: NUP-15404 (measurement mapping, hero unassign), NUP-20956 + NUP-21959/21960/21965/21966/21968 (global Hero modal, auto-add, indicators, post-channel lock), NUP-19273 (single-prompt combined summary, chat augmentation), NUP-19216/NUP-21714/NUP-21978 (Edit SKU list entry point). Catalogue traceability: E2E-SKU-002, -009, -014, -015, -017, -018, -019, -021, -025, -028, -035, -036, -037, -040.
- The Knorr SKU numbers (2023755/2023779/2023786) and the Persil pool names were verified read-only against the live dev planning API on 2026-07-11 (planning_getSkusBySkuId / planning_getSkus); editor search terms are resolved at runtime from the catalogue via `getSkusBySkuId` so name drift cannot rot the suite.
- INFERRED locators pending the first live run (the dev environment currently crashes the SKU-search chat turn, so this suite is delivered static-green): the editor search box and candidate-row naming, the hero-indicator badge copy, the chat-panel removal control at the hero step, and the combined-summary Edit SKU list action. All are owned by `SkuManagementExtendedComponent` with heal notes.
- The seeded editor cases mutate only the pinned QA session and restore the seeded selection before finishing so the dataManager teardown can return the session to its original state. The guided-journey cases build fresh throwaway conversations (Parallel Safe = no, Data Isolation = external).
- NEG-001 attempts the removal through the documented state-update API (the exposed shortcut path); the UI removal affordances after a channel exists are intentionally not asserted until the first live audit settles whether they are hidden or rejected with feedback.
- NEG-002 captures the persisted state before asserting and writes the pre-attempt selection back if the crafted cross-brand update unexpectedly persists, so a backend defect is surfaced red without permanently polluting the pinned session.
