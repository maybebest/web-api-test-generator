# Flow: Media plan entry, persistence and idempotency via Nectar AI

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-025 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P0 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/sains/entry-and-persistence.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated |
| Review Status | pending-review |
| Review Sign-off | pending |
| Generation Source | manual-test-case |
| Generation Status | generated |
| Generation Mode | suite |

## User Story

As a media planner,
I want my in-progress and saved plans to be created, persisted and restored reliably — with safe handling of unauthenticated access, repeated save/delete actions, date-rule revalidation and no leakage of authentication material into the UI,
So that I never lose or duplicate a plan and never see internal credentials, however I enter or re-enter the planning flow.

## Preconditions

- The user has a valid non-production authenticated Playwright storage state (`playwright/.auth/user.json`).
- `PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.pollen.js-devops.co.uk/`.
- Local storage key `feature-flags` enables `FEATURE_NECTAR_AI`, `FEATURE_NUP`, and `FEATURE_NECTAR_AI_MP`.
- The user can access the Planning page at `/planning`; the guided session URL scheme is `/planning/nectar-ai/<sessionId>`.
- The advertiser `N360_Unilever_MS`, brand `Unilever | Knorr | MS`, and objective `Customer retention` are available.
- The product search term `knorr` returns at least one selectable product/SKU.
- The offsite channel `Meta` (budget 7k or £40000) and the onsite channel `Homepage Sponsored Product` (budget £50000) are bookable for a future campaign window (the test computes start=+45d / end=+75d at runtime so requests can never rot into past dates); `Meta` enforces a booking-deadline lead time (observed live 2026-07-04: at least two weeks).
- The offsite channel `Offsite Display` carries no booking-deadline lead time and no configured shortest-span floor (`minCampaignDurationDays` null); a read-only `admin_getEveryMedia`/`admin_getMedia` preflight verifies this before the short-range case runs and fails closed otherwise.
- The saved-session GraphQL reads (`planningAI_chatHistory`, `planning_getPlan` in `fixtures/nectar-api.ts`) resolve with the bearer token derived from the saved storage state.

## Out-of-scope

- Admin and channel configuration changes are out of scope; the only config access is the read-only no-floor preflight.
- Post-sign-in route restoration after an unauthenticated rejection is out of scope (tests never enter credentials; the asserted signal is that the sign-in experience renders with no plan data).
- Backend channel-array field assertions on `planning_getPlan` are out of scope (the persisted-deletion signal is the reopened summary plus the recomputed total); the plan-record identity signals are the session's single `planId` and the plan's advertiser/brand identity.
- Forced network fault injection, request replay at the transport level, log/telemetry inspection and server-side log assertions are out of scope on the live environment (the token-leak case asserts the visible UI copy only).
- Browser/viewport matrix coverage (catalogue E2E-NFR-011) is out of scope: authenticated specs run only in the `chromium-auth` Desktop Chrome project by design, and asserting other engines/viewports would require Playwright project config changes plus an agreed support matrix that does not exist.
- Performance SLA measurement (catalogue E2E-NFR-012) is out of scope: no SLA or maximum plan volume is documented, so any latency budget would be invented rather than asserted against a real rule.
- The saved-plan name structure, CSV download and the Pollen editor hand-off are out of scope (covered by FLOW-MP-020).
- Discard behavior is out of scope (covered by FLOW-MP-022).
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
| RULE-001 | Advertiser + brand confirmation auto-creates the early draft exactly once | After the advertiser and brand are confirmed, the planning session references exactly one draft plan (a single `planId` on the session) whose advertiser and brand match the confirmed selection (NUP-20082; naming contract in unexported NUP-21160 is asserted as a contract, not an exact name) | A missing or multiple early draft breaks autosave recovery and every downstream persistence guarantee |
| RULE-002 | Confirmed plan state is durable and restore is duplication-free | Reloading an in-progress session or reopening a saved one reconstructs the summary from persisted data: every summary field equals its pre-restore snapshot and exactly one row exists per confirmed channel | A restore that drops or duplicates confirmed values silently corrupts the plan |
| RULE-003 | Save and delete confirmations are once-effective | Replaying the same user action (double-activating `Save plan as draft`, or double-activating the delete confirmation) applies the action once: the session keeps its single `planId`, and exactly one channel is removed per confirmed deletion | A replay that creates a second plan record or removes a second channel is a critical defect |
| RULE-004 | Edits to a saved plan revalidate dates against current channel rules | A date change requested on a saved plan whose new start violates the channel's booking-deadline lead time is rejected with the documented copy and the persisted timeline stays unchanged (NUP-16919) | Accepting a stale-validated edit books an unfulfillable campaign |
| RULE-005 | A channel with no configured shortest-span floor accepts any valid future range | When the channel's config carries no shortest-span floor, a short valid future range (3-day span) is accepted: the channel is added and no floor rejection is fabricated (NUP-16919 AC Scenario 6; NUP-18907) | Fabricating a floor where none is configured blocks legitimate bookings |
| RULE-006 | Authentication material never renders in UI copy | After the save journey, the visible assistant conversation and summary panel contain no JWT token material (no `eyJ` prefix) | Rendering token material in the UI is a security defect |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | journey=confirm advertiser+brand only (advertiser=N360_Unilever_MS; brand=Unilever \| Knorr \| MS); capture sessionId from the URL | The session references exactly one auto-created draft plan whose advertiser and brand identity match the confirmed selection (via `planningAI_chatHistory` + `planning_getPlan`) | Catalogue E2E-ACC-004 (NUP-20082) |
| DC-002 | journey=one confirmed Meta channel (7k, +45d..+75d); snapshot summary; restore=reload-mid-journey (reopen the session URL without saving) | Every summary field equals the snapshot, exactly one Meta channel row remains and the chat input is usable | Catalogue E2E-ACC-006 |
| DC-003 | journey=one confirmed Meta channel (7k, +45d..+75d); snapshot summary; restore=save-then-reopen (save the draft, reopen the session URL) | Every summary field equals the pre-save snapshot, exactly one Meta channel row remains and the chat input is usable | Catalogue E2E-NFR-016 |
| DC-004 | journey=confirmed Meta plan; capture the draft planId; action=double-activate `Save plan as draft` | The saved copy appears, the session still references the same single planId, one Meta channel row remains and the total budget is unchanged | Catalogue E2E-PLN-009 |
| DC-005 | channel=Offsite Display (read-only preflight: no booking-deadline lead time, no shortest-span floor); request a 3-day range at +45d with budget 7k | The channel is added to the summary and no floor rejection is shown | Catalogue E2E-CHN-008 |
| DC-006 | journey=confirmed Meta plan, saved; action=request a date change whose start is inside Meta's booking-deadline lead time (+5d..+35d) | The edit is rejected naming the booking deadline and the summary timeline stays unchanged | Catalogue E2E-CHN-013 |
| DC-007 | journey=two channels (Homepage Sponsored Product £50000 + Meta £40000); delete Homepage Sponsored Product; confirm and save; reopen the session URL | The deleted channel stays removed after reopen, Meta remains and the total budget equals the survivor's £40,000 | Catalogue E2E-CHN-035 |
| DC-008 | journey=two channels (Homepage Sponsored Product £50000 + Meta £40000); open the delete dialog for Homepage Sponsored Product; double-activate the delete confirmation | Exactly one channel is removed: the target is gone, Meta remains and the total recomputes to £40,000 | Catalogue E2E-CHN-037 (UI replay variant) |
| DC-009 | journey=confirmed Meta plan, saved; inspect the visible assistant conversation and summary panel copy | The saved copy is shown and neither panel's visible text contains the JWT prefix | Catalogue E2E-NFR-009 (honest UI-copy scope) |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "advertiser": "N360_Unilever_MS",
      "brand": "Unilever | Knorr | MS",
      "stage": "advertiser-brand-confirmed",
      "sessionIdSource": "page URL"
    },
    "expected": {
      "draftPlanRecords": 1,
      "advertiserIdentity": "N360_Unilever_MS",
      "brandIdentity": "Unilever | Knorr | MS"
    },
    "notes": "Early autosave contract; the draft name rule lives in unexported NUP-21160 so identity, not name, is asserted."
  },
  {
    "caseId": "DC-002",
    "inputs": {
      "journey": "one confirmed Meta channel",
      "restore": "reload-mid-journey"
    },
    "expected": {
      "channelRows": 1,
      "summary": "equals captured snapshot",
      "chatInput": "usable"
    },
    "notes": "Mid-journey reload restores summary and position without duplication."
  },
  {
    "caseId": "DC-003",
    "inputs": {
      "journey": "one confirmed Meta channel",
      "restore": "save-then-reopen"
    },
    "expected": {
      "channelRows": 1,
      "summary": "equals pre-save snapshot",
      "chatInput": "usable"
    },
    "notes": "The saved plan is reconstructed from durable data alone."
  },
  {
    "caseId": "DC-004",
    "inputs": {
      "journey": "confirmed Meta plan",
      "action": "double-activate the save draft action"
    },
    "expected": {
      "planRecords": 1,
      "savedMessage": "Your plan has been saved as a draft.",
      "channelRows": 1,
      "totalBudget": "unchanged"
    },
    "notes": "Save idempotency: the replay must not create a second plan record or lose state."
  },
  {
    "caseId": "DC-005",
    "inputs": {
      "channel": "Offsite Display",
      "config": "no shortest-span floor (read-only preflight, fails closed)",
      "spanDays": 3,
      "startOffsetDays": 45
    },
    "expected": {
      "channelAdded": true,
      "floorRejection": "absent"
    },
    "notes": "No floor is fabricated for an unconfigured channel."
  },
  {
    "caseId": "DC-006",
    "inputs": {
      "stage": "saved plan",
      "edit": "date change with a start inside the booking-deadline lead time"
    },
    "expected": {
      "rejection": "does not meet the booking deadline",
      "timeline": "unchanged"
    },
    "notes": "Saved-plan edits revalidate against current channel rules."
  },
  {
    "caseId": "DC-007",
    "inputs": {
      "channels": "Homepage Sponsored Product + Meta",
      "action": "delete Homepage Sponsored Product, confirm the plan, save, reopen the session"
    },
    "expected": {
      "deletedChannelRows": 0,
      "survivor": "Meta",
      "totalBudget": "£40,000"
    },
    "notes": "Deletion is durable across save and reopen."
  },
  {
    "caseId": "DC-008",
    "inputs": {
      "channels": "Homepage Sponsored Product + Meta",
      "action": "double-activate the delete confirmation"
    },
    "expected": {
      "deletedChannelRows": 0,
      "survivor": "Meta",
      "totalBudget": "£40,000"
    },
    "notes": "Delete idempotency, UI replay variant; transport-level replay is out of scope on live."
  },
  {
    "caseId": "DC-009",
    "inputs": {
      "journey": "confirmed Meta plan, saved"
    },
    "expected": {
      "savedMessage": "Your plan has been saved as a draft.",
      "jwtPrefixInVisibleUiCopy": "absent"
    },
    "notes": "Token-leak scope is the visible assistant and summary copy only."
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
| metaRequest | Offsite, Meta, <today+45d> till <today+75d>, the budget is 7k, Self-Serve | Live-proven single-channel request (dates computed at runtime) |
| onsiteRequest | Onsite, Homepage Sponsored Product, £50000, <today+45d> - <today+75d>, Self-Serve | Live-proven two-channel builder request |
| offsiteRequest | Offsite, Meta, £40000, <today+45d> - <today+75d>, Self-Serve | Live-proven two-channel builder request |
| noFloorChannel | Offsite Display | No booking-deadline lead time and no shortest-span floor (read-only preflight) |
| shortRangeRequest | Offsite Display, the budget is 7k, <today+45d> till <today+47d> | 3-day span request |
| invalidEditRequest | Please change the Meta channel dates to <today+5d> till <today+35d> | Start inside Meta's booking-deadline lead time |
| savedMessage | Your plan has been saved as a draft. | Standard saved-plan copy (live-verified 2026-07-03) |
| deadlineRejection | does not meet the booking deadline | Booking-deadline rejection fragment (observed live 2026-07-04) |
| floorRejection | must be at least | Shortest-span floor rejection fragment that must NOT appear for DC-005 |
| jwtPrefix | eyJ | Base64 JSON-web-token prefix that must never render in visible UI copy |
| survivorBudget | £40,000 | Total budget after Homepage Sponsored Product (£50000) is deleted |

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
| 1 | AC-001 | Confirm advertiser and brand in a fresh guided conversation and capture the session id from the URL | Guided planner | advertiser; brand | The session references exactly one auto-created draft plan matching the confirmed advertiser and brand | expect.poll over the planning GraphQL reads plus the summary advertiser |
| 2 | AC-002 | Build to one confirmed channel, snapshot the summary, then restore the session per the data case (mid-journey reload or save-then-reopen) | PlanningPage + EntryAndPersistencePage | journey; restore mode | Every summary field equals the snapshot; exactly one channel row remains and the chat input is usable | toHaveText against the captured snapshot + toHaveCount |
| 3 | AC-003 | Double-activate the save-draft action on a confirmed plan | Post-confirmation save CTA | double click | The assistant confirms `Your plan has been saved as a draft.`; the session keeps its single pre-save planId, one channel row and an unchanged total | poll the session planId + summary reads |
| 4 | AC-004 | Request the preflighted no-floor channel for a short valid future range | Assistant chat | 3-day span request | The channel is added to the summary and no `must be at least` floor rejection is shown | summary channel row visible + rejection count 0 |
| 5 | AC-005 | Save the plan, then request a date change whose start is inside the channel's booking-deadline lead time | Assistant chat | invalid edit request | The edit is rejected with `does not meet the booking deadline` and the summary timeline stays unchanged | chat copy + timeline equality |
| 6 | AC-006 | Delete one of two channels, confirm the plan, save, and reopen the session | Summary delete control + save + session URL | target channel | The deleted channel stays removed after reopen; the survivor remains and the total equals the survivor's budget | count 0 + survivor visible + total budget |
| 7 | AC-007 | Double-activate the delete confirmation for one of two channels | Delete confirmation dialog | double click | Exactly one channel is removed: the survivor remains and the total recomputes to the survivor's budget | count checks + total budget |
| 8 | AC-008 | Save a plan and inspect the visible assistant and summary copy | Assistant chat + summary panel | saved journey | The visible copy never contains the `eyJ` JWT prefix | not.toContainText on both panels |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | A fresh browser context that carries no stored authentication opens the protected /planning route (catalogue E2E-ACC-002) | The sign-in experience renders (credential entry or sign-in call-to-action) and no plan data is shown: no planner entry card and no summary panel |

## Acceptance Criteria

- AC-001: After the advertiser and brand are confirmed, the planning session references exactly one auto-created draft plan whose advertiser and brand identity match the confirmed selection, and the summary reflects the confirmed advertiser.
- AC-002: Restoring the plan session (mid-journey reload or save-then-reopen) reconstructs every snapshotted summary field to equality, keeps exactly one channel row per confirmed channel, and leaves the chat input usable.
- AC-003: Double-activating the save-draft action is once-effective: the saved copy appears, the session still references the same single planId captured before saving, exactly one channel row remains and the total budget is unchanged.
- AC-004: A channel whose configuration carries no shortest-span floor accepts a 3-day valid future range: the channel is added and no floor rejection is shown.
- AC-005: A date change requested on a saved plan whose new start violates the channel's booking-deadline lead time is rejected with the documented copy and the summary timeline stays unchanged.
- AC-006: A channel deleted before saving stays removed after the session is saved and reopened: the deleted channel is absent, the survivor remains and the total budget equals the survivor's budget.
- AC-007: Double-activating the delete confirmation removes exactly one channel: the target disappears, the survivor remains and the total recomputes to the survivor's budget.
- AC-008: After the save journey, the visible assistant conversation and the summary panel contain no JWT token material (no `eyJ` prefix).

## Locator Hints

- Reuse `PlanningPage` for every live-verified journey surface: the guided entry, chat, advertiser/brand panel, product/hero confirmation, channel request/disambiguation, summary reads (`summaryAdvertiser`, `summaryBrands`, `summaryObjective`, `summaryDates`, `summaryTotalBudget`, `heroSkusCount`, `campaignSkusCount`, `summaryChannel`), the delete dialog (`openDeleteChannelDialog`, `modalDeleteConfirmButton`), the save CTA (`saveButton`, `savePlan`, `savedConfirmation`) and `gotoSession`.
- New suite-specific surfaces live in `EntryAndPersistencePage` (pages/EntryAndPersistencePage.ts): the unauthenticated `/planning` entry, the sign-in affordance, the session-id URL capture, the summary snapshot reads and the mode-dependent restore.
- The API oracle uses `fixtures/nectar-api.ts` reads only: `planningAI_chatHistory` for the session's planId and `planning_getPlan` for the draft's advertiser/brand identity; `admin_getEveryMedia`/`admin_getMedia` for the read-only no-floor preflight.
- Prefer role/name and testid locators; never positional picks without a documented exception.

## Generated Test Requirements

- Must import from fixtures/test.
- Must use test.step.
- Must use Page Objects or Component Objects for all locators.
- Must not create direct `page.getBy*` or `page.locator(...)` locators in generated test bodies.
- This spec declares `Generation Mode | suite`; emit one focused test per Data Case (DC-###) plus one test for NEG-001, each enumerating its case id in the title.
- Must declare the spec metadata `Tags` exactly via the Playwright `{ tag: [...] }` option.
- Must put `expect(...)` only in the final assertion step for each test.
- Must title the final assertion step `Assert AC-###: ...` or `Assert NEG-###: ...`.
- Must enumerate the `Data Cases as JSON` case ids DC-001, DC-002, DC-003, DC-004, DC-005, DC-006, DC-007, DC-008 and DC-009 in test titles.
- Must assert the salient expected values `Your plan has been saved as a draft.`, `does not meet the booking deadline`, `must be at least` and `eyJ`.
- The unauthenticated negative case must override the project storage state with an empty in-memory state via `test.use` inside its own describe block (never a storage-state file path literal) so the chromium-auth project routing stays intact.
- Backend reads must go through `fixtures/nectar-api.ts`; admin config access is read-only (preflight) and no admin write is permitted.
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

- Catalogue mapping: DC-001=E2E-ACC-004, DC-002=E2E-ACC-006, DC-003=E2E-NFR-016, DC-004=E2E-PLN-009, DC-005=E2E-CHN-008, DC-006=E2E-CHN-013, DC-007=E2E-CHN-035, DC-008=E2E-CHN-037, DC-009=E2E-NFR-009, NEG-001=E2E-ACC-002. E2E-NFR-011 (viewport/browser matrix) and E2E-NFR-012 (performance SLA) are intentionally NOT emitted: the first requires Playwright project config changes plus an unagreed support matrix, the second has no documented SLA or volume ceiling — any assertion would be invented (see Out-of-scope).
- The unauthenticated negative case is arrangeable without config edits because `test.use({ storageState: { cookies: [], origins: [] } })` inside a describe block overrides the chromium-auth project's storage state for that block only; the sign-in affordance mirrors the credential-field defaults the auth setup itself uses (fixtures/auth.fixture.ts).
- E2E-ACC-002's post-sign-in route restoration is deliberately not asserted: tests must never enter credentials.
- E2E-CHN-037's forced-slow-response/transport-replay variant stays blocked on live (no request interception); the double-activation UI variant is the honest arrangeable slice.
- The `does not meet the booking deadline` fragment was observed live 2026-07-04 (Meta booking-deadline enforcement); the saved copy `Your plan has been saved as a draft.` was live-verified 2026-07-03 on FLOW-MP-020. The post-save date-edit turn itself has not been live-proven yet; if the live copy differs the test fails honestly red and the fragment must be healed from a live run, never weakened.
- `Offsite Display` was live-proven to carry `bookingDeadlineDays` null (FLOW-MP-005 preflight); the same read-only preflight here additionally requires the shortest-span floor (`minCampaignDurationDays`) to be unset and fails closed if the dev config changes.
- Every DC journey builds a fresh plan on the live dev environment (`Parallel Safe` = no, `Data Isolation` = external). DC-003/DC-004/DC-006/DC-007/DC-009 leave saved drafts, matching FLOW-MP-020 behavior; DC-002/DC-005/DC-008 leave unsaved sessions.
- NEG-001 is meaningful (not vacuous) because the same planner-entry and summary locators are live-verified as present by the authenticated cases in the same suite run.
