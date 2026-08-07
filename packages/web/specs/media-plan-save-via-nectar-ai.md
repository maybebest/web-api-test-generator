# Flow: Build and save a media plan via Nectar AI

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-020 |
| Spec Version | 1.2.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/media-plan-save-via-nectar-ai.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated |
| Review Status | pending-review |
| Review Sign-off | pending |
| Generation Source | manual-test-case |
| Generation Status | generated |

## User Story

As a media planner,
I want to build a complete media plan through the Nectar AI guided assistant from a single objective-and-budget conversation and save it,
So that I get a correctly named, downloadable plan that I can open in Pollen without constructing the plan manually.

## Preconditions

- The user has a valid non-production authenticated Playwright storage state (`playwright/.auth/user.json`).
- `PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.pollen.js-devops.co.uk/`.
- Local storage key `feature-flags` enables `FEATURE_NECTAR_AI`, `FEATURE_NUP`, and `FEATURE_NECTAR_AI_MP`.
- The user can access the Planning page at `/planning`.
- The advertiser `N360_Unilever_MS`, brand `Unilever | Knorr | MS`, and objective `Customer retention` are available.
- The product search term `knorr` returns at least one product/SKU.
- The offsite channel `Meta` (live-verified available for this brand 2026-07-03; the previous 'DD Pubmatic - Display' is rejected by the assistant as unavailable for the chosen brand) is bookable for a future campaign window (the test computes start=+45d / end=+75d at runtime so the request can never rot into past dates) with a 7k budget.

## Out-of-scope

- Admin and channel configuration changes are out of scope and must remain read-only.
- Booking-deadline and minimum campaign-duration validation are out of scope (covered by other specs).
- Deep verification inside the Pollen editor after `Edit in Pollen` is out of scope; this flow only asserts the action is available. Pollen/read-model parity remains blocked until a disposable saved-plan readback fixture and cleanup contract exist.
- Additional special-character export variants and edit-then-re-export freshness remain blocked until deterministic advertiser/brand/objective fixtures and an owned edit/reset contract exist; DC-001 proves RFC 4180 parsing against the currently documented plan values (including the existing pipe-delimited brand) but does not claim broader variant coverage.
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
| RULE-001 | Saving a Nectar AI plan confirms success and unlocks post-save actions | After `Confirm the save plan`, the assistant shows `Your plan has been saved as a draft.` and both `Download` and `Edit in Pollen` become enabled | Post-save actions remain disabled and the plan is not persisted until the save is confirmed |
| RULE-002 | Saved plan name structure | planName is composed of `[YYYY_MM]` derived from the CREATION month, the advertiser/brand chain and the objective, plus a generated unique suffix (live-observed 2026-07-03: `2026_07_Unilever\|Knorr\|MS_Retention_<unique-number>`; the suffix renders in an editable input) | A saved plan whose visible name omits the year-month or brand-chain tokens indicates a defect |
| RULE-003 | A channel request populates the Media section | Entering a channel with future dates and a budget adds the resolved channel row with its budget to the Media section (the summary-timeline copy format is not live-verified and is not asserted) | A missing channel row after a confirmed add indicates a defect |
| RULE-004 | The post-save download is a usable CSV for the saved plan | the browser download completes without failure; suggested filename ends in `.csv`; bounded bytes decode as UTF-8 and parse as RFC 4180; every logical row is non-empty and has the same field count; parsed records contain the documented advertiser, brand, objective, channel, budget and Measurement SKU count tokens without assuming a fixed column order | A failed/non-CSV/empty/malformed/ragged download or a missing saved-plan token indicates a broken export |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | advertiser=N360_Unilever_MS; brand=Unilever \| Knorr \| MS; objective=Customer retention; productSearch=knorr; channelGroup=offsite; channel=Meta; startDate=today+45d; endDate=today+75d; budget=7k; Measurement SKU count=1 | result=saved; message contains "Your plan has been saved as a draft."; the visible plan name matches `YYYY_MM_Unilever\|Knorr\|MS_` (creation month + brand chain); Download and Edit in Pollen are enabled; the completed `.csv` is valid UTF-8/RFC 4180 with non-empty rectangular rows and contains the documented advertiser, brand, objective, channel, budget and SKU-count tokens | Primary deterministic happy-path case; no exact export column layout is assumed |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "advertiser": "N360_Unilever_MS",
      "brand": "Unilever | Knorr | MS",
      "objective": "Customer retention",
      "productSearch": "knorr",
      "channelGroup": "offsite",
      "channelRequest": "Offsite, Meta, <today+45d> till <today+75d>, the budget is 7k, Self-Serve",
      "startDate": "today+45d",
      "endDate": "today+75d",
      "summaryTimeline": "<today+45d> - <today+75d>",
      "budget": "7k"
    },
    "expected": {
      "result": "saved",
      "message": "Your plan has been saved as a draft.",
      "planNameContains": ["<creation YYYY_MM>_", "Unilever|Knorr|MS"],
      "downloadable": true,
      "csvFilename": true,
      "csvRfc4180": true,
      "csvNonEmptyRectangularRows": true,
      "csvContains": ["N360_Unilever_MS", "Unilever | Knorr | MS", "Customer retention", "Meta", "7k or 7000-equivalent", "Measurement SKU count=1"],
      "editableInPollen": true
    },
    "notes": "Single deterministic journey; the visible prefix is creation-date dependent and the editable suffix is asserted as Retention_<generated digits>."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| advertiser | N360_Unilever_MS | Non-production advertiser |
| brand | Unilever \| Knorr \| MS | Non-production brand |
| objective | Customer retention | Nectar AI planning objective |
| productSearch | knorr | Product search term entered in the assistant |
| channelRequest | Offsite, Meta, <today+45d> till <today+75d>, the budget is 7k, Self-Serve | Free-text channel request sent to the assistant (dates computed at runtime) |
| channelGroup | offsite | Channel group used in the saved plan name |
| startDate | today+45d | Campaign start date (computed at runtime so the request never rots into the past) |
| endDate | today+75d | Campaign end date (computed at runtime) |
| summaryTimeline | (not asserted) | The live timeline copy format is unverified; the channel row + budget are the asserted signals |
| budget | 7k | Channel request budget |
| exportBudgetTokens | 7k; 7000; 7,000; £7,000; decimal equivalents | Documented equivalent renderings accepted without pinning a column format |
| exportSkuCount | 1 Measurement SKU | Must be semantically associated with a SKU label in the parsed records; a bare unrelated digit is insufficient |
| savedMessage | Your plan has been saved as a draft. | Salient save confirmation copy |

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
| 1 | AC-001 | Launch the Nectar AI guided planner | /planning | Create Media Plans in minutes with Nectar AI; Help me build a plan based on my objective & budget | The objective-and-budget guided flow is active | guided flow control is visible |
| 2 | AC-002 | Select advertiser and brand | Guided planner controls | N360_Unilever_MS; Unilever \| Knorr \| MS; Confirm | Advertiser and brand are shown on the summary panel | advertiser and brand are visible on summary |
| 3 | AC-003 | Enter the campaign objective | Assistant chat | Customer retention; Send | Objective is shown on the summary panel | objective is visible on summary |
| 4 | AC-004 | Search products and select campaign SKUs | Assistant chat and product search table | knorr; Send; select product(s); Confirm | Hero SKUs and Campaign SKUs counts are set on the summary panel | Hero SKUs and Campaign SKUs counts are visible |
| 5 | AC-005 | Add an offsite channel via chat | Assistant chat | Offsite, Meta, <today+45d> till <today+75d>, the budget is 7k, Self-Serve; Send | The channel appears in the Media section with its name and budget | channel row is visible |
| 6 | AC-006 | Confirm and save the plan | Confirm; Confirm the save plan | n/a | The assistant replies "Your plan has been saved as a draft." and Download and Edit in Pollen are enabled | save confirmation is visible; actions are enabled |
| 7 | AC-007 | Verify the saved plan name structure | Plan name | n/a | The visible plan name matches the live structure `YYYY_MM_Unilever\|Knorr\|MS_` (creation month + brand chain; the unique suffix renders in an editable input) | plan name matches the live structure |
| 8 | AC-008 | Download and inspect the saved plan export; confirm the Pollen handoff remains available | Download; Edit in Pollen | N360_Unilever_MS; Unilever \| Knorr \| MS; Customer retention; Meta; 7k; Measurement SKU count=1 | The download completes as a non-empty UTF-8 `.csv`; RFC 4180 parsing succeeds; rows are rectangular and non-empty; saved-plan tokens are present independent of column order; Edit in Pollen is enabled | inspect browser Download failure/filename/bytes, parse records, assert structural checks and token-presence checks; do not navigate into Pollen |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | The plan save is attempted before any channel has been added | The save confirmation is not offered until at least one channel exists in the Media section |

## Acceptance Criteria

- AC-001: From the Planning page the user can launch the Nectar AI guided planner and choose to build a plan by objective and budget.
- AC-002: The user can select the advertiser and brand, and both appear on the summary panel.
- AC-003: The user can enter a campaign objective, and it appears on the summary panel.
- AC-004: The user can search products and select SKUs, and the summary panel shows the Hero SKUs and Campaign SKUs counts.
- AC-005: The user can add an offsite channel via chat; it appears in the Media section with name, dates, budget and total budget, and the summary timeline is predefined from the channel dates.
- AC-006: The user can confirm and save the plan, and the assistant confirms "Your plan has been saved as a draft." with Download and Edit in Pollen enabled.
- AC-007: The saved plan name uses the runtime creation `YYYY_MM`, the `Unilever|Knorr|MS` brand chain, and a non-empty `Retention_<generated digits>` suffix.
- AC-008: From the saved plan the user can download a successful non-empty `.csv` whose UTF-8 RFC 4180 records are rectangular and contain the documented advertiser, brand, objective, channel, budget and Measurement SKU count tokens without relying on a fixed column layout; Edit in Pollen remains enabled.

## Locator Hints

- Prefer role/name locators for the assistant buttons and links (Create Media Plans in minutes with Nectar AI, Help me build a plan based on my objective & budget, Confirm, Confirm the save plan, Download, Edit in Pollen).
- Prefer labels or combobox role/name locators for the advertiser and brand selectors.
- Prefer exact visible text for the save confirmation copy and the summary panel values.
- Use a meaningful `data-testid` for the plan name and summary panel when one is available; otherwise heal the locator from a DOM-discovery snapshot.
- Use `PlanningPage.planNameSuffixInput()` for the editable generated suffix (`data-testid=plan-name-input`).
- Use CSS only with an explicit `// locator-policy:exception <reason>` comment directly above the locator call.

## Generated Test Requirements

- Must import from fixtures/test.
- Must use test.step.
- Must use Page Objects or Component Objects for all locators.
- Must not create direct `page.getBy*` or `page.locator(...)` locators in the generated test body.
- Default generation mode is single-test mode.
- Generate a suite only when the spec declares `Generation Mode | suite` or a suite is explicitly requested.
- In single-test mode, must generate one requested-scenario test with one primary final assertion step.
- The single-mode primary test must declare a `covered-ac-ids` annotation whose set equals the AC ids named in its step titles.
- In the single-mode primary test, every `test.step` title must carry at least one `AC-###` token.
- Must declare the spec metadata `Tags` exactly via the Playwright `{ tag: [...] }` option.
- Must put `expect(...)` only in the final assertion step for the test.
- Must title the final assertion step `Assert AC-###: ...`.
- Must enumerate the `Data Cases as JSON` case id DC-001 in the test title.
- Must assert the salient expected values: "Your plan has been saved as a draft.", N360_Unilever_MS, Unilever|Knorr|MS, Customer retention, Meta, 7k and Measurement SKU count 1.
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

## Notes

- This flow targets the live Pollen development environment and saves a real plan to the database, so `Parallel Safe` is `no` and `Data Isolation` is `external`.
- The saved-plan name is asserted from the runtime creation year/month plus the stable brand chain because the suffix is generated per save.
- Clicking `Edit in Pollen` navigates away from the saved-plan view; this flow asserts that the action is enabled rather than following the navigation, which is left for a follow-up Pollen-editor spec.
- AC-008 covers only the automatable browser/file-content subset of canonical `EXT-EXPORT-001`: successful download, `.csv` filename, bounded UTF-8 decode, RFC 4180 structure and saved-plan token presence. It does not claim UI/Pollen/read-model parity.
- Export special-character fixtures, edit-and-re-export freshness and Pollen/read-model parity are explicitly blocked as listed in Out-of-scope; add them only after owned fixture/reset/readback contracts exist.
- The entry/advertiser/product/summary locators were live-audited 2026-07-02/03; the save-stage controls (saveButton, savedConfirmation, editInPollenLink) sit past the read-only recon boundary and are pinned from the manual case — the first live save run is their verification.

## Automation Status

- NEG-001 is emitted in the same serial suite as DC-001. Both use `PlanningPage.saveButton()`: DC-001 proves the control is observable after channel confirmation, while NEG-001 proves it is absent at the pre-channel stage, avoiding a locator that can only ever pass by being wrong.
