# Flow: Per-channel Hero SKU assignment via chat and channel modal

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-026 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P0 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/sains/channel-hero-assignment.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated |
| Review Status | pending-review |
| Review Sign-off | pending |
| Generation Source | manual-test-case |
| Generation Status | generated |
| Generation Mode | suite |

## User Story

As a media planner,
I want each channel to carry its own Hero SKU assignment — defaulted from the global Heroes when I say nothing, overridden exactly when I name SKUs, editable per channel without leaking into sibling channels, and always reflected in the campaign counters and the media summary,
So that every channel promotes exactly the products I chose for it and the campaign totals never misreport the per-channel state.

## Preconditions

- The user has a valid non-production authenticated Playwright storage state (`playwright/.auth/user.json`).
- `PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.pollen.js-devops.co.uk/`.
- Local storage key `feature-flags` enables `FEATURE_NECTAR_AI`, `FEATURE_NUP`, and `FEATURE_NECTAR_AI_MP`.
- The advertiser `N360_Unilever_MS`, brand `Unilever | Knorr | MS`, and objective `Customer retention` are available for the guided journeys.
- The Knorr SKU numbers 2023755, 2023779 and 2023786 are brand-linked in the dev catalogue (verified read-only against the live planning API, 2026-07-11). The journeys confirm 2023755 and 2023779 as the global Heroes, so 2023786 stays outside the confirmed set and plays the brand-linked non-measurement candidate.
- The Persil SKU 7096764 (specs/skus/.sku-pools.json, live-probed pool) belongs to a different brand and plays the foreign-brand probe.
- The offsite channel `Meta` and the onsite channels `Homepage Sponsored Product` and `SmartShop Handset Home Page (DEMO)` resolve by name in the dev environment for a runtime-computed future campaign window (start +45d, end +75d).
- Channel SKU clauses in chat use the documented per-channel definition syntax: a trailing `skus <id>, <id>` fragment on the channel request.

## Out-of-scope

- Admin and channel configuration changes (max/min hero limits) are out of scope and must remain read-only; the zero-hero case relies on the channel accepting an empty selection as currently configured.
- Saving, discarding and booking the plan are out of scope (FLOW-MP-020 / FLOW-MP-022), as is cross-application verification in the core Pollen editor (E2E-CHS-018, see Pending Automation).
- Post-final-confirmation channel locking is out of scope (E2E-CHS-017, see Pending Automation).
- Global campaign-level Hero editor behaviour is out of scope (FLOW-MP-023 and the skus suites).
- Session-wide SET_SKUS seeding is intentionally not used: the captured contract has no channel dimension and cannot arrange or prove per-channel state (established by FLOW-SKU-CHAN). Every case here drives real UI journeys.
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
| RULE-001 | Omitted channel SKU input defaults to the global Heroes; an explicit clause overrides it exactly | channelHeroes(no clause) = globalHeroes; channelHeroes(clause) = clause set exactly | A defaulted channel missing a global Hero, or an explicit channel silently gaining extra SKUs, is a defect |
| RULE-002 | Campaign Hero uniqueness follows set semantics | campaignHeroCount = countOf(unique Heroes across the campaign); assigning a Hero already carried elsewhere adds nothing; removing a Hero from its last carrying channel subtracts one | Double counting on shared assignment or a stale count after removal is a defect |
| RULE-003 | A non-measurement channel Hero is auto-added to the global Measurements exactly once | measurementCount(after) = measurementCount(before) + 1 for one newly assigned non-measurement SKU; sibling channels gain nothing | A missing auto-add, a duplicate measurement row, or a sibling channel gaining the SKU automatically is a defect |
| RULE-004 | Per-channel edits and deletions stay isolated and recompute the campaign state | editing or deleting channel A never mutates channel B; deleting a channel recomputes the campaign Hero union from the remaining channels | State bleeding between channels or a stale Hero surviving a deletion is a defect |
| RULE-005 | The media summary reports per-channel Hero counts | each channel row shows its own Hero count and updates in place; an empty channel renders a dash, never a zero or a blank | A stale, shared or zero-rendered per-channel count is a defect |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | global Heroes 2023755 and 2023779 confirmed; add Meta via chat with no SKU clause; open the Meta channel Hero modal | The modal is pre-populated with both global Heroes exactly once (2 rows) and the campaign Hero counter stays 2 | E2E-CHS-001; NUP-17751; NUP-19529 |
| DC-002 | same global Heroes; add Meta with the explicit clause skus 2023755; open the Meta channel Hero modal | The modal holds exactly the explicit set (1 row: 2023755) and the campaign Hero counter stays 2 | E2E-CHS-002; NUP-19529 |
| DC-003 | same global Heroes; add Meta and then Homepage Sponsored Product, both without SKU clauses; open the Homepage Sponsored Product channel Hero modal | The second channel's own modal is pre-populated with the current global Heroes (2 rows); the state belongs to the chosen channel | E2E-CHS-004; NUP-18943 |
| DC-004 | one batch chat message defines three channels: Meta with skus 2023755, Homepage Sponsored Product with no clause, SmartShop Handset Home Page with skus 2023779; complete each resolver sequentially | Meta holds only 2023755, Homepage Sponsored Product holds both globals, SmartShop holds only 2023779; assignments do not bleed between channels | E2E-CHS-003; NUP-19529; NUP-20403 |
| DC-005 | Meta added with default Heroes; open its channel Hero modal and search the brand-linked non-measurement SKU 2023786 | The SKU is offered as an assignable candidate in the channel Hero modal | E2E-CHS-005; NUP-20956; NUP-21962 |
| DC-006 | Meta and Homepage Sponsored Product added; assign 2023786 as Hero to Meta only via its channel modal | The global Measurement counter grows from 2 to 3 with exactly one 2023786 measurement row; the Homepage channel modal does not gain 2023786; the Meta modal lists it | E2E-CHS-006; NUP-20956 |
| DC-007 | Meta and Homepage Sponsored Product added with identical default Heroes; edit Meta only: remove 2023779 and add 2023786 | Meta holds 2023755 and 2023786; Homepage Sponsored Product still holds 2023755 and 2023779 | E2E-CHS-007; NUP-18943 |
| DC-008 | Meta added; add the previously unused 2023786 as Hero via the Meta channel modal | The campaign Hero counter increments from 2 to 3, the measurement counter reads 3, and Meta lists the SKU | E2E-CHS-008; NUP-18943 |
| DC-009 | Meta and Homepage Sponsored Product added; add 2023786 to both channel modals | Both channels list the SKU while the campaign Hero counter reads 3, not 4 | E2E-CHS-009; NUP-18943; NUP-19140 |
| DC-010 | 2023786 assigned as Hero on Meta and Homepage Sponsored Product; remove it from Meta only | The Meta modal loses the SKU, Homepage retains it, and the campaign Hero counter stays 3 | E2E-CHS-010; NUP-18943; NUP-19140 |
| DC-011 | 2023786 assigned as Hero only on Meta; remove it from Meta | The campaign Hero counter returns to 2 while the measurement counter stays 3 (the SKU remains a measurement) | E2E-CHS-011; NUP-18943; NUP-19140 |
| DC-012 | Meta edited to hold 2023755 and 2023786 while Homepage Sponsored Product holds 2023755 and 2023779; delete Meta and confirm | The Meta row disappears, the campaign Hero counter recomputes to 2, and the Homepage modal keeps exactly its own set with no 2023786 anywhere | E2E-CHS-012; NUP-18943; NUP-19140 |
| DC-013 | Meta and Homepage Sponsored Product added with 2 default Heroes each; confirm a Meta modal change adding 2023786 | The Meta summary row shows 3 while the Homepage row still shows 2, without a page reload | E2E-CHS-013; NUP-18943 |
| DC-014 | Meta grown to 3 Heroes via its modal; Homepage Sponsored Product added with the explicit clause skus 2023755 | The media summary carries a Hero SKUs column with no Details column, and the rows show 3 and 1 respectively | E2E-CHS-014; NUP-20813 |
| DC-015 | Meta added with the explicit clause skus 2023755, then its single Hero removed via the channel modal | The Meta Hero SKUs summary cell renders a dash, never a zero | E2E-CHS-015; NUP-20813 |
| DC-016 | Meta added with the explicit clause skus 2023755; add 2023786 via the channel modal, then remove it | The Meta summary count transitions 1 to 2 and back to 1 with no page reload and no stale value | E2E-CHS-016; NUP-20813 |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "globalHeroes": [2023755, 2023779],
      "channels": ["Meta"],
      "skuClause": "none",
      "openModalFor": "Meta"
    },
    "expected": {
      "modalRowCount": 2,
      "modalSkus": [2023755, 2023779],
      "campaignHeroCount": 2
    },
    "notes": "E2E-CHS-001; NUP-17751; NUP-19529 — omitted clause defaults all global Heroes exactly once."
  },
  {
    "caseId": "DC-002",
    "inputs": {
      "globalHeroes": [2023755, 2023779],
      "channels": ["Meta"],
      "skuClause": "skus 2023755",
      "openModalFor": "Meta"
    },
    "expected": {
      "modalRowCount": 1,
      "modalSkus": [2023755],
      "campaignHeroCount": 2
    },
    "notes": "E2E-CHS-002; NUP-19529 — explicit clause overrides the default; the global Hero list is unchanged."
  },
  {
    "caseId": "DC-003",
    "inputs": {
      "globalHeroes": [2023755, 2023779],
      "channels": ["Meta", "Homepage Sponsored Product"],
      "skuClause": "none",
      "openModalFor": "Homepage Sponsored Product"
    },
    "expected": {
      "modalRowCount": 2,
      "modalSkus": [2023755, 2023779],
      "campaignHeroCount": 2
    },
    "notes": "E2E-CHS-004; NUP-18943 — the chosen channel's modal opens pre-populated with its own current assignment."
  },
  {
    "caseId": "DC-004",
    "inputs": {
      "batchChannels": ["Meta", "Homepage Sponsored Product", "SmartShop Handset Home Page (DEMO)"],
      "explicitClauses": { "first": "skus 2023755", "third": "skus 2023779" }
    },
    "expected": {
      "firstChannelSkus": [2023755],
      "secondChannelSkus": [2023755, 2023779],
      "thirdChannelSkus": [2023779]
    },
    "notes": "E2E-CHS-003; NUP-19529; NUP-20403 — mixed explicit and defaulted assignment stays independent per channel."
  },
  {
    "caseId": "DC-005",
    "inputs": {
      "channels": ["Meta"],
      "searchSku": 2023786
    },
    "expected": {
      "candidateOffered": true
    },
    "notes": "E2E-CHS-005; NUP-20956; NUP-21962 — brand-linked non-measurement SKUs are assignable channel Hero candidates."
  },
  {
    "caseId": "DC-006",
    "inputs": {
      "channels": ["Meta", "Homepage Sponsored Product"],
      "assignToChannel": "Meta",
      "assignSku": 2023786
    },
    "expected": {
      "measurementCount": 3,
      "autoAddedMeasurementRows": 1,
      "siblingChannelRows": 0,
      "editedChannelRows": 1
    },
    "notes": "E2E-CHS-006; NUP-20956 — non-measurement channel Hero auto-adds to global Measurements once; siblings gain nothing."
  },
  {
    "caseId": "DC-007",
    "inputs": {
      "channels": ["Meta", "Homepage Sponsored Product"],
      "editChannel": "Meta",
      "removeSku": 2023779,
      "addSku": 2023786
    },
    "expected": {
      "editedChannelSkus": [2023755, 2023786],
      "siblingChannelSkus": [2023755, 2023779]
    },
    "notes": "E2E-CHS-007; NUP-18943 — editing one channel leaves the sibling channel untouched."
  },
  {
    "caseId": "DC-008",
    "inputs": {
      "channels": ["Meta"],
      "addHeroTo": ["Meta"],
      "removeHeroFrom": [],
      "operationSku": 2023786
    },
    "expected": {
      "campaignHeroCount": 3,
      "measurementCount": 3,
      "channelsListing": ["Meta"],
      "channelsNotListing": []
    },
    "notes": "E2E-CHS-008; NUP-18943 — a previously unused Hero increments the unique campaign count exactly once."
  },
  {
    "caseId": "DC-009",
    "inputs": {
      "channels": ["Meta", "Homepage Sponsored Product"],
      "addHeroTo": ["Meta", "Homepage Sponsored Product"],
      "removeHeroFrom": [],
      "operationSku": 2023786
    },
    "expected": {
      "campaignHeroCount": 3,
      "measurementCount": 3,
      "channelsListing": ["Meta", "Homepage Sponsored Product"],
      "channelsNotListing": []
    },
    "notes": "E2E-CHS-009; NUP-18943; NUP-19140 — assigning the same Hero to a second channel does not double count."
  },
  {
    "caseId": "DC-010",
    "inputs": {
      "channels": ["Meta", "Homepage Sponsored Product"],
      "addHeroTo": ["Meta", "Homepage Sponsored Product"],
      "removeHeroFrom": ["Meta"],
      "operationSku": 2023786
    },
    "expected": {
      "campaignHeroCount": 3,
      "measurementCount": 3,
      "channelsListing": ["Homepage Sponsored Product"],
      "channelsNotListing": ["Meta"]
    },
    "notes": "E2E-CHS-010; NUP-18943; NUP-19140 — removal from one of several carrying channels retains campaign Hero status."
  },
  {
    "caseId": "DC-011",
    "inputs": {
      "channels": ["Meta"],
      "addHeroTo": ["Meta"],
      "removeHeroFrom": ["Meta"],
      "operationSku": 2023786
    },
    "expected": {
      "campaignHeroCount": 2,
      "measurementCount": 3,
      "channelsListing": [],
      "channelsNotListing": ["Meta"]
    },
    "notes": "E2E-CHS-011; NUP-18943; NUP-19140 — removal from the last carrying channel clears campaign Hero status while the SKU stays a measurement."
  },
  {
    "caseId": "DC-012",
    "inputs": {
      "channels": ["Meta", "Homepage Sponsored Product"],
      "editChannel": "Meta",
      "removeSku": 2023779,
      "addSku": 2023786,
      "deleteChannel": "Meta"
    },
    "expected": {
      "deletedChannelRows": 0,
      "campaignHeroCount": 2,
      "survivorChannelSkus": [2023755, 2023779],
      "staleSkuRows": 0
    },
    "notes": "E2E-CHS-012; NUP-18943; NUP-19140 — deletion recomputes the campaign Hero union from the remaining channels."
  },
  {
    "caseId": "DC-013",
    "inputs": {
      "channels": ["Meta", "Homepage Sponsored Product"],
      "assignToChannel": "Meta",
      "assignSku": 2023786
    },
    "expected": {
      "editedChannelSummaryCount": 3,
      "siblingChannelSummaryCount": 2
    },
    "notes": "E2E-CHS-013; NUP-18943 — the confirmed change renders on the edited channel's summary row only, no reload."
  },
  {
    "caseId": "DC-014",
    "inputs": {
      "channels": ["Meta", "Homepage Sponsored Product"],
      "growChannel": "Meta",
      "growSku": 2023786,
      "soleHeroClauseChannel": "Homepage Sponsored Product"
    },
    "expected": {
      "heroSkusColumnPresent": true,
      "detailsColumnCount": 0,
      "rowCounts": [3, 1]
    },
    "notes": "E2E-CHS-014; NUP-20813 — the summary carries per-channel Hero counts in place of a Details column."
  },
  {
    "caseId": "DC-015",
    "inputs": {
      "channels": ["Meta"],
      "soleHeroSku": 2023755,
      "removeAllHeroes": true
    },
    "expected": {
      "dashCellPresent": true,
      "zeroCells": 0
    },
    "notes": "E2E-CHS-015; NUP-20813 — a zero-Hero channel renders a dash, never a zero."
  },
  {
    "caseId": "DC-016",
    "inputs": {
      "channels": ["Meta"],
      "soleHeroSku": 2023755,
      "toggleSku": 2023786
    },
    "expected": {
      "summaryCountSequence": [1, 2, 1]
    },
    "notes": "E2E-CHS-016; NUP-20813 — the per-channel count updates dynamically without a reload."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| advertiser | N360_Unilever_MS | Non-production advertiser |
| brand | Unilever \| Knorr \| MS | Non-production brand for the guided journeys |
| objective | Customer retention | Nectar AI planning objective |
| productSearch | Knorr 8 | One search maps both known SKU numbers in a single turn (live-verified 2026-07-11) |
| globalHeroA | 2023755 | Knorr 8 Vegetable Stock Cubes 80g — confirmed measurement and Hero |
| globalHeroB | 2023779 | Knorr 8 Beef Stock Cubes 80g — confirmed measurement and Hero |
| followUpSku | 2023786 | Knorr 8 Chicken Stock Cubes 80g — brand-linked, kept outside the confirmed set |
| foreignSku | 7096764 | Persil-brand SKU (specs/skus/.sku-pools.json) — foreign-brand probe |
| offsiteChannelRequest | Offsite, Meta, <today+45d> till <today+75d>, the budget is 7k, Self-Serve | Free-text channel request; dates computed at runtime |
| offsiteSoleHeroClause | , skus 2023755 | Appended explicit per-channel SKU clause (documented syntax) |
| onsiteChannelRequest | Onsite, Homepage Sponsored Product, £7000, <today+45d> - <today+75d>, Self-Serve | Second channel; phrasing proven by the deletion-recompute suite |
| thirdChannelRequestName | SmartShop Handset Home Page | Request name omits the catalogue (DEMO) suffix |
| skuNameSource | fixtures/nectar-api.ts getSkusBySkuId | Catalogue names resolved at runtime for modal candidate searches |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | Live Pollen development environment drives every guided journey end to end | [] |

## Mocks as JSON

```json
[]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Add a channel via chat and open its channel Hero modal | Assistant chat + summary channel row | channel request with or without an explicit SKU clause | The modal holds the documented per-case assignment: all global Heroes exactly once when the clause is omitted, exactly the explicit set otherwise, with the campaign Hero counter unchanged | modal row count, per-SKU rows and campaign counter |
| 2 | AC-002 | Define three channels in one batch message with mixed clauses | Assistant chat resolvers | batch request with explicit clauses on the first and third channels | Each channel modal holds its own documented set; explicit and defaulted assignments do not bleed between channels | per-channel modal rows |
| 3 | AC-003 | Search the channel Hero modal candidates | Channel Hero modal search | brand-linked non-measurement SKU | The SKU is offered as an assignable candidate for the channel | candidate row visible |
| 4 | AC-004 | Assign a non-measurement SKU as Hero to one channel only | Channel Hero modal | candidate SKU on the edited channel | The global Measurement counter grows by one with exactly one new measurement row, the edited channel lists the SKU, and the sibling channel does not gain it | measurement counter plus per-channel modal rows |
| 5 | AC-005 | Edit one channel's Hero set with a second channel present | Channel Hero modal | remove one Hero and add another on the edited channel | Only the edited channel changes; the sibling channel keeps its original set | both channel modal sets |
| 6 | AC-006 | Apply per-channel Hero add and remove operations | Channel Hero modals | case-defined add and remove operations | The campaign Hero counter follows unique set semantics and each channel modal lists exactly the expected membership | campaign counter, measurement counter and modal membership |
| 7 | AC-007 | Delete a channel that holds a unique Hero | Summary channel delete control | confirm the deletion | The campaign Hero union recomputes from the remaining channels and no stale Hero row survives | deleted row absent, counter recomputed, survivor modal intact |
| 8 | AC-008 | Confirm a Hero change on one channel | Channel Hero modal + summary rows | add one Hero to the edited channel | The edited channel row shows the updated count while the sibling row is unchanged, with no page reload | per-row count cells |
| 9 | AC-009 | Inspect the media summary columns | Media summary | two channels with different Hero counts | The summary carries a Hero SKUs column in place of a Details column and each row shows its own per-channel count | column header present, legacy column absent, row cells |
| 10 | AC-010 | Empty one channel's Hero selection | Channel Hero modal | remove the channel's only Hero | The channel's Hero SKUs summary cell renders a dash rather than a zero or a blank | dash cell present, zero cell absent |
| 11 | AC-011 | Add then remove one Hero on a single channel | Channel Hero modal | candidate SKU toggled on and off | The per-channel summary count transitions one to two and back to one without a page reload or a stale value | count cell sequence |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | Search the channel Hero modal candidates for a foreign-brand SKU | The foreign-brand SKU is not offered as a candidate in the channel Hero modal |

## Acceptance Criteria

- AC-001: A channel added without a SKU clause is pre-populated with every current global Hero exactly once, an explicit clause assigns exactly the clause set instead, and the campaign Hero counter is unchanged by the channel add.
- AC-002: Channels defined together in one batch message keep independent assignments: explicit clauses stay exact and the clause-free channel defaults to all global Heroes.
- AC-003: The channel Hero modal offers brand-linked SKUs beyond the measurement set as assignable candidates.
- AC-004: Assigning a non-measurement SKU as a channel Hero auto-adds it to the global Measurements exactly once, and no sibling channel gains the SKU automatically.
- AC-005: Editing one channel's Hero set leaves the sibling channel's set unchanged.
- AC-006: The campaign Hero counter follows unique set semantics across per-channel add and remove operations, and each channel modal lists exactly the expected membership.
- AC-007: Deleting a channel recomputes the campaign Hero union from the remaining channels with no stale Hero surviving anywhere.
- AC-008: A confirmed per-channel Hero change renders on the edited channel's summary row only, without a page reload.
- AC-009: The media summary shows a Hero SKUs column instead of a Details column, with each channel row carrying its own count.
- AC-010: A channel with zero Heroes renders a dash in its Hero SKUs summary cell, never a zero or a blank.
- AC-011: The per-channel Hero count updates dynamically as Heroes are added and removed, without a page reload.

## Locator Hints

- Use `PlanningPage.summaryHeroCount()` / `PlanningPage.summaryMeasurementCount()` for the campaign counters; the rows concatenate text without whitespace, so assert with a digit-lookbehind count pattern, never an exact-text match.
- Use `PlanningPage.modalSkuRow(sku)`, `PlanningPage.modalSelectedSkuRows()`, `PlanningPage.modalRemoveSku(sku)` and `PlanningPage.editModalConfirm()` / `PlanningPage.editModalCancel()` for the open channel dialog's rows and controls (the dialog reuses the verified editor contract).
- Use `PlanningPage.enterChannelRequest(...)`, `PlanningPage.summaryChannel(...)` and `PlanningPage.deleteChannel(...)` for channel adds and deletion.
- `ChannelHeroAssignmentComponent` (pages/ChannelHeroAssignmentComponent.ts) owns the new surfaces: the per-channel Edit SKUs affordance and channel-scoped Hero dialog opener, the dialog candidate search and candidate rows, the batch multi-channel resolver driver, and the media-summary Hero SKUs column, rows and count cells. Its inferred locators are documented in the class and must be healed on the first live run.
- Never use positional picks without a `// locator-policy:exception <reason>` comment; prefer role/name and data-testid locators throughout.

## Generated Test Requirements

- Must import from fixtures/test.
- Must use test.step.
- Must use Page Objects or Component Objects for all locators.
- Must not create direct `page.getBy*` or `page.locator(...)` locators in generated test bodies.
- This spec declares `Generation Mode | suite`; emit one focused test per Data Case (DC-001 through DC-016) plus one test for NEG-001, each enumerating its case id in the title, and parameterize coherent groups by looping over case-row arrays.
- Must declare the spec metadata `Tags` exactly via the Playwright `{ tag: [...] }` option on every test.
- Must put `expect(...)` only in the final assertion step for each test.
- Must title the final assertion step `Assert AC-###: ...` or `Assert NEG-###: ...`.
- Modal candidate searches must resolve catalogue product names at runtime through the existing `fixtures/nectar-api.ts` read helper so fixture drift fails loudly instead of passing vacuously.
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

- Sources: NUP-17751 / NUP-19529 (defaulting and explicit per-channel clauses), NUP-18943 (channel Hero modal, isolation, unique campaign count, channel view), NUP-19140 (state sync on removal/deletion), NUP-20403 (batch independence), NUP-20956 / NUP-21962 (candidate scope and auto-add), NUP-20813 (summary Hero SKUs column). Catalogue traceability: E2E-CHS-001 through E2E-CHS-016 (E2E-CHS-017/018 pending, see below).
- This flow intentionally does NOT reuse the session-wide SET_SKUS seeding path: FLOW-SKU-CHAN already established that the captured contract has no channel dimension and cannot represent per-channel state. Every case arranges through the real chat channel-add and per-channel Hero modal journeys.
- The Knorr SKU numbers (2023755/2023779/2023786) were verified read-only against the live dev planning API on 2026-07-11; modal search terms are resolved at runtime from the catalogue via `getSkusBySkuId` so name drift cannot rot the suite.
- INFERRED surfaces pending the first live run (the dev environment currently crashes the SKU-search chat turn, so this suite is delivered static-green): the per-channel Edit SKUs affordance and channel-scoped dialog identity, the dialog candidate search box and candidate-row naming, the media-summary table semantics (Hero SKUs column header, per-row count cells and the dash cell), the chat SKU clause phrasing on channel requests, and whether the channel-modal counter recomputes the campaign Hero row immediately. All are owned by `ChannelHeroAssignmentComponent` with heal notes.
- The zero-Hero case (DC-015) additionally assumes the resolved Meta channel carries no configured Hero floor; if the environment enforces one, the modal will refuse the empty selection and the case must be re-arranged against a channel without a floor.
- Guided journeys build fresh throwaway conversations on the live dev environment (`Parallel Safe` = no, `Data Isolation` = external); no admin or shared configuration is written.

## Pending Automation (no test emitted)

Two catalogue cases are E2E-specified but cannot be verified honestly today. They are intentionally NOT generated — the framework ships only executable E2E tests with real oracles.

| Source Case | Blocker |
|---|---|
| E2E-CHS-017 — Only final channel confirmation locks channel editing | undocumented-oracle: NUP-20785's locked/disabled post-confirmation state has no available copy or DOM evidence, and the catalogue itself flags the lock scope as unreconciled with pre-draft Secondary Space editing; asserting an invented lock signal would fake coverage |
| E2E-CHS-018 — Per-channel and campaign Hero state survives reload/open in Pollen | cross-app-oracle: the documented expectation is consistency between Nectar AI and the core Pollen SKU views; the core Pollen editor surfaces have zero locator evidence in this repo, and an AI-side-only reload assertion would overstate the case as covered |
