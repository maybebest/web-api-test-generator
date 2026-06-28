# Flow: Media Planner channel deletion confirmation dialog

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-007 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/media-planner-channel-deletion-dialog.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @no-preconditions |
| Review Status | pending-review |
| Generation Source | manual-test-case |
| Generation Status | pending-generation |
| Generation Mode | suite |

## User Story

As a media planner,
I want a confirmation dialog when I click the delete control next to a channel in the media section,
So that I can intentionally remove a channel (sending a delete request to the backend) or cancel and keep the channel unchanged.

## Preconditions

- The user has a valid non-production authenticated Playwright storage state.
- `PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.rtd.js-devops.co.uk/`.
- Local storage key `feature-flags` enables `FEATURE_NECTAR_AI`, `FEATURE_NUP`, and `FEATURE_NECTAR_AI_MP`.
- The user can access Media Planner at `/planning`.
- The advertiser `N360_Unilever_MS`, brand `Unilever | Knorr | MS`, objective `Customer retention`, and SKU `2001227` are available.
- A media plan can be created via the Nectar AI Assistant with one or more standard channels (onsite, offsite, at home, in-store) listed in the media section (summary-panel). This satisfies the standard (group B) cases.
- For the recompute-comparison cases (group A), the plan requires channels pre-configured with known staggered start/end dates and distinct per-channel budgets so that one channel bounds neither the earliest start nor the latest end. The configured dates and budgets are read-only fixture inputs; their source of truth is the env override `E2E_MP_DELETION_STAGGERED_FIXTURE` when set, otherwise the documented default schedule.
- Campaign start dates are chosen at least 10 days from the current date so the separate booking-deadline validation does not interfere with the deletion flow.

## Out-of-scope

- Admin configuration changes are out of scope and must remain read-only.
- Booking-deadline and minimum-duration administration is out of scope.
- Chat-driven deletion recompute parity is covered only as an equivalence partition against the UI delete path; full chat-deletion behaviour is owned by a separate flow.
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
| RULE-001 | The delete control in a channel's media row is active and clickable when the channel is listed | deleteControl.enabled === true when the channel row is present in summary-panel | Non-blocking; the control simply must not be disabled or greyed while the channel exists |
| RULE-002 | Clicking the delete control opens a confirmation dialog showing the verbatim wording | dialogText === "Are you sure you want to delete this channel?" (case-sensitive, single space, trailing question mark, no period) | Blocking; no delete request is sent until the dialog is confirmed |
| RULE-003 | Confirming removes the channel and cancelling/dismissing keeps it; remaining channels and the budget recompute deterministically | newTotalBudget = capturedTotalBudget - deletedChannelBudget on confirm; newTotalBudget = capturedTotalBudget and deleteRequestCount = 0 on cancel/dismiss | Blocking; on confirm a delete request is sent and the channel is removed, on cancel/dismiss no request is sent and the channel remains |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | plan with one onsite channel (budget £50,000, start today+10, end today+40); action=inspect delete control | The onsite channel's delete control is enabled, focusable, and has an accessible name matching /delete\|remove/i | Group B standard channel; covers TC-DEL-001 |
| DC-002 | plan with one onsite channel; action=click delete control | A role=dialog appears containing the exact text "Are you sure you want to delete this channel?" | Group B standard channel; covers TC-DEL-002 and the wording-lock TC-DEL-021 |
| DC-003 | plan with onsite, offsite, at home, in-store; target=onsite; action=open dialog then click Confirm | A delete request is sent to the channel-deletion endpoint, the dialog closes, onsite is removed from summary-panel, the other three channels remain | Group B standard channels; covers TC-DEL-003 |
| DC-004 | plan with onsite, offsite, at home, in-store; capture Total Budget before; target=onsite; action=open dialog then click Cancel | The dialog closes, no delete request is sent, all four channels remain, Total Budget and campaign start/end are byte-identical to the captured values | Group B standard channels; covers TC-DEL-004 and TC-DEL-023 |
| DC-005 | plan with one onsite channel; action=open dialog then press Escape (and, in a second run, click any X/close control if present) | The dialog closes, no delete request is sent, the onsite channel remains listed | Group B standard channel; covers TC-DEL-005; if no X/Escape affordance exists the run records actual behaviour instead of failing |
| DC-006 | plan with onsite (target) and offsite; action=enumerate dialog buttons, click the labelled Confirm for onsite, then re-open for offsite and click the labelled Cancel | The labelled Confirm button performs the delete (onsite removed) and the labelled Cancel button performs the no-op (offsite remains); buttons are not swapped, duplicated, mislabelled, or non-functional | Group B standard channels; NUP-19104 regression characterization; covers TC-DEL-006 |
| DC-007 | plan with EXACTLY one onsite channel (budget £50,000, start today+10, end today+40); boundary=at-minimum; action=delete the only channel and confirm | The media section shows no channel rows, Total Budget shows the empty value "£--", and campaign start/end show no parseable dates | Group B standard channel; count=1 boundary of delete-all; covers TC-DEL-007 |
| DC-008 | plan with staggered onsite (today+10..today+40, earliest start), at home (today+12..today+42, target/middle), in-store (today+14..today+47), offsite (today+16..today+52, latest end); boundary=below-minimum; action=delete at home and confirm | at home is removed, Total Budget = captured total − at home budget, campaign START and END are unchanged, all survivors' budgets and dates are unchanged | Group A; requires the pre-configured staggered multi-channel fixture; covers TC-DEL-008 and TC-DEL-009 |
| DC-009 | two equivalent plans with onsite (today+10..today+40), at home (today+12..today+42), in-store (today+14..today+47), offsite (today+16..today+52); boundary=above-minimum; Plan A deletes offsite via UI dialog, Plan B deletes offsite via chat | Both paths remove offsite, both yield identical Total Budget = total − offsite budget, both yield campaign END = today+47 and START = today+10 | Group A; requires two pre-configured equivalent staggered fixtures; UI-vs-chat equivalence partition; covers TC-DEL-018 and TC-DEL-022 |
| DC-010 | plan with onsite (target) and offsite; channel-delete endpoint fault-injected to return HTTP 500; action=open dialog and confirm | onsite is NOT removed from the summary, the channel and Total Budget remain unchanged, and an error indication is surfaced | Group B standard channels plus route fault-injection; covers TC-DEL-024 |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "channels": [{ "group": "onsite", "budget": "50000", "startOffsetDays": 10, "endOffsetDays": 40 }],
      "action": "inspect-delete-control",
      "target": "onsite"
    },
    "expected": {
      "result": "control-enabled",
      "accessibleNamePattern": "/delete|remove/i"
    },
    "notes": "Group B standard channel. Delete control must be enabled and focusable, not the previous inactive/greyed state per NUP-15407."
  },
  {
    "caseId": "DC-002",
    "inputs": {
      "channels": [{ "group": "onsite", "budget": "50000", "startOffsetDays": 10, "endOffsetDays": 40 }],
      "action": "click-delete-control",
      "target": "onsite"
    },
    "expected": {
      "result": "dialog-open",
      "dialogText": "Are you sure you want to delete this channel?"
    },
    "notes": "Group B standard channel. Wording is case-sensitive against the CONFIRMATION_WORDING constant (capital A, single space, trailing question mark, no period). Covers wording-lock TC-DEL-021."
  },
  {
    "caseId": "DC-003",
    "inputs": {
      "channels": [
        { "group": "onsite", "budget": "50000", "startOffsetDays": 10, "endOffsetDays": 40 },
        { "group": "offsite" },
        { "group": "at home" },
        { "group": "in-store" }
      ],
      "action": "open-dialog-then-confirm",
      "target": "onsite"
    },
    "expected": {
      "result": "deleted",
      "deleteRequestSent": true,
      "dialogHidden": true,
      "removedChannel": "onsite",
      "remainingChannels": ["offsite", "at home", "in-store"]
    },
    "notes": "Group B standard channels. Confirm button label is guessed /^(yes|confirm|delete)\\b/i pending NUP-15407 codegen verification."
  },
  {
    "caseId": "DC-004",
    "inputs": {
      "channels": [
        { "group": "onsite", "budget": "50000", "startOffsetDays": 10, "endOffsetDays": 40 },
        { "group": "offsite" },
        { "group": "at home" },
        { "group": "in-store" }
      ],
      "action": "open-dialog-then-cancel",
      "target": "onsite",
      "captureBeforeAction": ["totalBudget", "campaignStart", "campaignEnd"]
    },
    "expected": {
      "result": "unchanged",
      "deleteRequestSent": false,
      "dialogHidden": true,
      "channelsUnchanged": true,
      "totalBudgetUnchanged": true,
      "campaignDatesUnchanged": true
    },
    "notes": "Group B standard channels. Cancel button label guessed /^(no|cancel)\\b/i. Asserts byte-identical Total Budget and timeline (folds TC-DEL-004 and TC-DEL-023)."
  },
  {
    "caseId": "DC-005",
    "inputs": {
      "channels": [{ "group": "onsite", "budget": "50000", "startOffsetDays": 10, "endOffsetDays": 40 }],
      "action": "open-dialog-then-dismiss",
      "dismissVia": ["Escape", "close-icon-if-present"],
      "target": "onsite"
    },
    "expected": {
      "result": "unchanged",
      "deleteRequestSent": false,
      "dialogHidden": true,
      "channelRemains": "onsite"
    },
    "notes": "Group B standard channel. Dismiss is inferred to equal Cancel per NUP-15407. If no X/Escape affordance exists, record actual behaviour rather than hard-failing."
  },
  {
    "caseId": "DC-006",
    "inputs": {
      "channels": [
        { "group": "onsite", "budget": "50000" },
        { "group": "offsite", "budget": "40000" }
      ],
      "action": "enumerate-buttons-then-confirm-onsite-then-cancel-offsite",
      "target": "onsite"
    },
    "expected": {
      "result": "labels-honored",
      "confirmDeletesOnsite": true,
      "cancelKeepsOffsite": true,
      "buttonsNotSwappedOrMislabelled": true
    },
    "notes": "Group B standard channels. NUP-19104 regression. NUP-19104 title is truncated, so capture button labels/order/outcome as evidence; characterization until the defect ticket is confirmed."
  },
  {
    "caseId": "DC-007",
    "inputs": {
      "channels": [{ "group": "onsite", "budget": "50000", "startOffsetDays": 10, "endOffsetDays": 40 }],
      "boundary": "at-minimum",
      "action": "delete-only-channel-and-confirm",
      "target": "onsite",
      "captureBeforeAction": ["totalBudget", "campaignStart", "campaignEnd"]
    },
    "expected": {
      "result": "emptied",
      "channelRowCount": 0,
      "totalBudget": "£--",
      "campaignDatesParseable": false
    },
    "notes": "Group B standard channel. Count=1 -> 0 at-minimum boundary of the delete-all behaviour. Empty timeline may render a placeholder; assert zero parseable dates."
  },
  {
    "caseId": "DC-008",
    "inputs": {
      "channels": [
        { "group": "onsite", "startOffsetDays": 10, "endOffsetDays": 40, "note": "earliest start" },
        { "group": "at home", "startOffsetDays": 12, "endOffsetDays": 42, "note": "middle/target" },
        { "group": "in-store", "startOffsetDays": 14, "endOffsetDays": 47 },
        { "group": "offsite", "startOffsetDays": 16, "endOffsetDays": 52, "note": "latest end" }
      ],
      "boundary": "below-minimum",
      "action": "delete-middle-channel-and-confirm",
      "target": "at home",
      "captureBeforeAction": ["perChannelBudgets", "totalBudget", "campaignStart", "campaignEnd"]
    },
    "expected": {
      "result": "deleted",
      "removedChannel": "at home",
      "totalBudgetFormula": "capturedTotal - atHomeBudget",
      "campaignStartUnchanged": true,
      "campaignEndUnchanged": true,
      "survivorBudgetsUnchanged": true
    },
    "notes": "Group A. Requires the pre-configured staggered multi-channel fixture (source of truth env E2E_MP_DELETION_STAGGERED_FIXTURE). Middle channel bounds neither extreme; folds TC-DEL-008 and TC-DEL-009. Compute expected total via cost-oracle parity, never hardcoded UI strings."
  },
  {
    "caseId": "DC-009",
    "inputs": {
      "planA": {
        "channels": [
          { "group": "onsite", "startOffsetDays": 10, "endOffsetDays": 40 },
          { "group": "at home", "startOffsetDays": 12, "endOffsetDays": 42 },
          { "group": "in-store", "startOffsetDays": 14, "endOffsetDays": 47 },
          { "group": "offsite", "startOffsetDays": 16, "endOffsetDays": 52, "note": "latest end" }
        ],
        "deleteVia": "ui-dialog",
        "target": "offsite"
      },
      "planB": {
        "channels": "same as planA",
        "deleteVia": "chat",
        "target": "offsite"
      },
      "boundary": "above-minimum"
    },
    "expected": {
      "result": "equivalent",
      "bothRemoveOffsite": true,
      "totalBudgetFormula": "capturedTotal - offsiteBudget",
      "campaignEnd": "today+47",
      "campaignStart": "today+10"
    },
    "notes": "Group A. Requires two pre-configured equivalent staggered fixtures. UI-vs-chat deletion equivalence partition; folds TC-DEL-018 and the delete/re-add idempotence intent of TC-DEL-022. Separate conversations on the shared dev env."
  },
  {
    "caseId": "DC-010",
    "inputs": {
      "channels": [
        { "group": "onsite", "budget": "50000" },
        { "group": "offsite" }
      ],
      "action": "open-dialog-and-confirm",
      "target": "onsite",
      "faultInjection": { "endpoint": "channel-delete", "status": 500 }
    },
    "expected": {
      "result": "not-removed",
      "removedChannel": null,
      "totalBudgetUnchanged": true,
      "errorSurfaced": true
    },
    "notes": "Group B standard channels plus page.route fault-injection. Guards against optimistic-removal-without-rollback when the backend delete fails; error wording is undocumented, capture whatever is shown."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| advertiser | N360_Unilever_MS | Non-production advertiser |
| brand | Unilever \| Knorr \| MS | Non-production brand |
| objective | Customer retention | Media Planner objective |
| sku | 2001227 | SKU used by the guided flow |
| onsiteChannel | onsite | Standard channel, primary delete target |
| offsiteChannel | offsite | Standard channel |
| atHomeChannel | at home | Standard channel, middle/bounded target in DC-008 |
| inStoreChannel | in-store | Standard channel |
| onsiteBudget | 50000 | Per-channel budget for onsite |
| offsiteBudget | 40000 | Per-channel budget for offsite |
| confirmationWording | Are you sure you want to delete this channel? | Verbatim dialog text (case-sensitive constant CONFIRMATION_WORDING) |
| emptyTotalBudget | £-- | Total Budget value shown when no channels remain (per authenticated selector audit) |
| bookingDeadlineDays | 5 | Read-only configured booking-deadline rule avoided by choosing start >= today+10 |
| staggeredFixtureEnv | E2E_MP_DELETION_STAGGERED_FIXTURE | Optional override; source of truth for the group A pre-configured staggered start/end dates and per-channel budgets |
| deleteEndpointFaultStatus | 500 | HTTP status used to fault-inject the channel-delete endpoint in DC-010 |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | Live dev environment validates the configured channel rule | [] |

## Mocks as JSON

```json
[]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Open Media Planner and build a plan with the required channels via the Nectar AI Assistant | /planning | feature-flags enabled; Try now; Help me build a plan based on my objective & budget; N360_Unilever_MS; Unilever \| Knorr \| MS; Customer retention; 2001227; Confirm; channel requests with budgets and dates | The requested channels appear as rows in the media section (summary-panel) | channel rows are visible in summary-panel |
| 2 | AC-002 | Inspect the delete control in a channel's media row | summary-panel channel row | DC-001 target onsite | The delete control is enabled, focusable, and has an accessible name matching /delete\|remove/i | delete control toBeEnabled with accessible name /delete\|remove/i |
| 3 | AC-003 | Click the delete control and read the confirmation dialog | channel delete control | DC-002 target onsite | A role=dialog appears with the verbatim wording "Are you sure you want to delete this channel?" | dialog toBeVisible and toContainText the exact confirmation wording |
| 4 | AC-004 | Confirm deletion in the dialog and observe the network request and media list | confirmation dialog Confirm button | DC-003 target onsite | A delete request is sent, the dialog closes, onsite is removed, and the other three channels remain | delete request captured, dialog toBeHidden, summary-panel not.toContainText onsite, survivors still listed |
| 5 | AC-005 | Cancel or dismiss the dialog and re-read the media list, Total Budget, and timeline | confirmation dialog Cancel/close control or Escape | DC-004, DC-005 | The dialog closes, no delete request is sent, the channel remains, and Total Budget plus campaign dates are byte-identical | no delete request, dialog toBeHidden, channel still listed, captured Total Budget and dates unchanged |
| 6 | AC-006 | Enumerate the dialog buttons and verify each label performs its action | confirmation dialog buttons | DC-006 onsite Confirm and offsite Cancel | The labelled Confirm deletes onsite and the labelled Cancel keeps offsite; buttons are not swapped or mislabelled | captured button labels/outcomes match (NUP-19104) |
| 7 | AC-007 | Delete channels and assert deterministic recompute across boundary and equivalence cases | summary-panel and delete dialog | DC-007, DC-008, DC-009 | Deleting the only channel empties the section to "£--" with no parseable dates; deleting a middle channel changes only the budget; UI and chat deletion produce the same recomputed summary | empty-state, recompute formulas via cost-oracle parity, and UI-vs-chat equality all hold |
| 8 | AC-008 | Confirm deletion while the delete endpoint is fault-injected to 500 | confirmation dialog Confirm button | DC-010 target onsite, route 500 | onsite is not removed, Total Budget is unchanged, and an error indication is surfaced | summary-panel still toContainText onsite, total unchanged, error visible |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | DC-004: user opens the delete dialog for onsite and clicks Cancel | The dialog closes, no delete request is sent, all channels and Total Budget remain unchanged |
| NEG-002 | DC-005: user dismisses the delete dialog via Escape or the X/close control | The dialog closes, no delete request is sent, and the channel remains listed |
| NEG-003 | DC-006 (NUP-19104): the Confirm and Cancel buttons are swapped, mislabelled, duplicated, or non-functional | The test fails; the labelled Confirm must delete and the labelled Cancel must perform a no-op |
| NEG-004 | DC-010: the channel-delete backend request returns HTTP 500 after Confirm | The channel is NOT removed (no optimistic removal without rollback), Total Budget is unchanged, and an error is surfaced |

## Acceptance Criteria

- AC-001: Media Planner opens and a plan with the requested standard channels is built so the channels appear as rows in the media section.
- AC-002: The delete control in a channel's media row is active (enabled, focusable, accessibly named).
- AC-003: Clicking the delete control opens a confirmation dialog containing the verbatim text "Are you sure you want to delete this channel?".
- AC-004: Confirming the dialog sends a delete request, closes the dialog, removes the target channel, and leaves the remaining channels listed.
- AC-005: Cancelling or dismissing the dialog closes it, sends no delete request, and leaves the channel, Total Budget, and campaign dates unchanged.
- AC-006: The dialog's Confirm and Cancel buttons behave per their labels and are not swapped, duplicated, mislabelled, or non-functional (NUP-19104 regression).
- AC-007: Channel deletion recomputes the summary deterministically — deleting the only channel empties the section to "£--" with no parseable dates, deleting a middle channel changes only the budget, and UI and chat deletion paths yield the same recomputed summary.
- AC-008: When the backend delete request fails with 500, the channel is not removed, Total Budget is unchanged, and an error is surfaced.

## Locator Hints

- Prefer role/name locators for the delete control: `getByRole('row', { name: channelName }).getByRole('button', { name: /delete|remove/i })`.
- Prefer `getByRole('dialog')` filtered by the confirmation wording for the confirmation dialog.
- Prefer role/name for the dialog action buttons: Confirm `getByRole('button', { name: /^(yes|confirm|delete)\b/i })`, Cancel `getByRole('button', { name: /^(no|cancel)\b/i })`, close `getByRole('button', { name: /close/i })`.
- Prefer exact visible text for assistant option chips such as advertiser, brand, objective, SKU, Add hero SKU, and Confirm.
- Scope assertions to the active tabpanel; test-tab-{onsite|offsite|instore|athome} all stay mounted.
- Use CSS only with an explicit locator-policy exception comment directly above the locator call.

## Generated Test Requirements

- Must import from fixtures/test.
- Must use test.step.
- Must use Page Objects or Component Objects for all locators.
- Must not create direct `page.getBy*` or `page.locator(...)` locators in generated test bodies.
- This spec declares `Generation Mode | suite`; split the flow into focused tests (delete-control active, dialog wording, confirm-deletes, cancel/dismiss-keeps, NUP-19104 buttons, recompute boundary/equivalence, backend-failure).
- Must put `expect(...)` only in the final assertion step for each test.
- Must title assertion steps `Assert AC-###: ...` or `Assert NEG-###: ...`.
- Must include meaningful expect assertions for user-visible behavior.
- In suite mode, must cover every AC ID from this spec with a final assertion step.
- Must assert the salient expected values "Are you sure you want to delete this channel?", "£--", onsite, offsite.
- Default generated-test execution target is Chromium only.
- Cross-browser generated-test execution is opt-in.
- Must enumerate every Data Cases as JSON case ID: DC-001, DC-002, DC-003, DC-004, DC-005, DC-006, DC-007, DC-008, DC-009, DC-010.
- Plan creation is multiple AI turns (30-60s each); mark slow tests `test.slow` with an extended expect timeout (~75s) for backend round-trips.
- Must not use page.waitForTimeout.
- Must not use page.waitForLoadState('networkidle').
- Must not use XPath.
- Must not use test.only.
- Must not silently skip.
- Must not use real credentials.
- Must not commit auth state.

## Notes

- This test intentionally avoids admin pages and does not change Channel Management or channel configuration; channel rules are treated as pre-configured and read-only.
- The confirmation wording is asserted case-sensitively against the constant `CONFIRMATION_WORDING` = "Are you sure you want to delete this channel?" (capital A, single space, trailing question mark, no period); source confirmed in NUP-15407.doc.
- Group B cases (DC-001 through DC-007, DC-010) run on standard channels added to a fresh plan with no required field values. Group A cases (DC-008, DC-009) require channels pre-configured with known staggered start/end dates and distinct per-channel budgets; set `E2E_MP_DELETION_STAGGERED_FIXTURE` when a non-production environment uses a different configured schedule, in which case that override is the source of truth.
- Confirm/Cancel button labels are guessed pending codegen against NUP-15407; the NUP-19104 button regression (DC-006) is a characterization test that captures actual labels/order/outcomes before asserting pass/fail.
- Recompute expectations are computed via cost-oracle parity from captured numbers, never from hardcoded UI strings.
- Campaign start dates are kept at least 10 days out so the booking-deadline validation does not interfere with the deletion flow.
