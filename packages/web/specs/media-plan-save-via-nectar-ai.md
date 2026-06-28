# Flow: Build and save a media plan via Nectar AI

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-020 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/media-plan-save-via-nectar-ai.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated |
| Review Status | human-reviewed |
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
- The offsite channel `DD Pubmatic - Display` is bookable for the campaign window 20/04/2026–20/05/2026 with a 7k budget.

## Out-of-scope

- Admin and channel configuration changes are out of scope and must remain read-only.
- Booking-deadline and minimum campaign-duration validation are out of scope (covered by other specs).
- Deep verification inside the Pollen editor after `Edit in Pollen` is out of scope; this flow only asserts the action is available.
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
| RULE-001 | Saving a Nectar AI plan confirms success and unlocks post-save actions | After `Confirm the save plan`, the assistant shows `Your plan is now saved.` and both `Download` and `Edit in Pollen` become enabled | Post-save actions remain disabled and the plan is not persisted until the save is confirmed |
| RULE-002 | Saved plan name structure | planName is composed of `[YYYY-MM]` derived from the campaign start date (20/04/2026 -> 2026-04), the selected `[brand]`, the entered `[objective]`, the channel `[channel group]` (offsite), and a generated `[unique number]` to avoid save conflicts | A saved plan whose name omits any of these tokens indicates a defect |
| RULE-003 | A channel request predefines the summary timeline | Entering a channel with dates `20/04/2026 till 20/05/2026` sets the summary panel timeline to `20 April 2026 - 20 May 2026` | A summary timeline that does not match the channel dates indicates a defect |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | advertiser=N360_Unilever_MS; brand=Unilever \| Knorr \| MS; objective=Customer retention; productSearch=knorr; channelGroup=offsite; channel=DD Pubmatic - Display; startDate=20/04/2026; endDate=20/05/2026; budget=7k | result=saved; message contains "Your plan is now saved."; plan name contains 2026-04 and offsite and a trailing unique number; Download and Edit in Pollen are enabled; a CSV file is downloaded | Primary deterministic happy-path case |

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
      "channelRequest": "Offsite, DD Pubmatic - Display, 20/04/2026 till 20/05/2026, the budget is 7k",
      "startDate": "20/04/2026",
      "endDate": "20/05/2026",
      "summaryTimeline": "20 April 2026 - 20 May 2026",
      "budget": "7k"
    },
    "expected": {
      "result": "saved",
      "message": "Your plan is now saved.",
      "planNameContains": ["2026-04", "offsite"],
      "downloadable": true,
      "editableInPollen": true
    },
    "notes": "Single deterministic journey; the unique number in the plan name is generated and is asserted only as a trailing digit sequence."
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
| channelRequest | Offsite, DD Pubmatic - Display, 20/04/2026 till 20/05/2026, the budget is 7k | Free-text channel request sent to the assistant |
| channelGroup | offsite | Channel group used in the saved plan name |
| startDate | 20/04/2026 | Campaign start date (drives the 2026-04 name token and summary timeline) |
| endDate | 20/05/2026 | Campaign end date |
| summaryTimeline | 20 April 2026 - 20 May 2026 | Predefined summary panel timeline derived from the channel dates |
| budget | 7k | Channel request budget |
| savedMessage | Your plan is now saved. | Salient save confirmation copy |

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
| 5 | AC-005 | Add an offsite channel via chat | Assistant chat | Offsite, DD Pubmatic - Display, 20/04/2026 till 20/05/2026, the budget is 7k; Send | The channel appears in the Media section with name, dates, budget and total budget, and the summary timeline is predefined to 20 April 2026 - 20 May 2026 | channel and summary dates are visible |
| 6 | AC-006 | Confirm and save the plan | Confirm; Confirm the save plan | n/a | The assistant replies "Your plan is now saved." and Download and Edit in Pollen are enabled | save confirmation is visible; actions are enabled |
| 7 | AC-007 | Verify the saved plan name structure | Plan name | n/a | The plan name contains the 2026-04 start token, the channel group offsite, and a trailing unique number | plan name matches the documented structure |
| 8 | AC-008 | Download the saved plan and confirm it can be opened in Pollen | Download; Edit in Pollen | n/a | A CSV file is downloaded and Edit in Pollen is available | download produces a .csv file; Edit in Pollen is enabled |

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
- AC-006: The user can confirm and save the plan, and the assistant confirms "Your plan is now saved." with Download and Edit in Pollen enabled.
- AC-007: The saved plan name follows the structure [YYYY-MM start]-[brand]-[objective]-[channel group]-[unique number].
- AC-008: From the saved plan the user can download a CSV file and open the plan in Pollen via Edit in Pollen.

## Locator Hints

- Prefer role/name locators for the assistant buttons and links (Create Media Plans in minutes with Nectar AI, Help me build a plan based on my objective & budget, Confirm, Confirm the save plan, Download, Edit in Pollen).
- Prefer labels or combobox role/name locators for the advertiser and brand selectors.
- Prefer exact visible text for the save confirmation copy and the summary panel values.
- Use a meaningful `data-testid` for the plan name and summary panel when one is available; otherwise heal the locator from a DOM-discovery snapshot.
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
- Must assert the salient expected values: "Your plan is now saved.", 2026-04, offsite.
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
- The saved-plan name is asserted through environment-independent fragments (`2026-04`, `offsite`, a trailing unique number) because the unique suffix is generated per save.
- Clicking `Edit in Pollen` navigates away from the saved-plan view; this flow asserts that the action is enabled rather than following the navigation, which is left for a follow-up Pollen-editor spec.
- AUTHORING CAVEAT: the generated test and its Page Object were authored without a live DOM-discovery snapshot. Run `npm run ai:dom:discover` against `/planning` and heal any locator that does not resolve before treating this test as green.
