# Flow: Media Planner channel deletion confirmation dialog

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-007 |
| Spec Version | 1.2.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/media-planner-channel-deletion-dialog.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @no-preconditions |
| Review Status | pending-review |
| Review Sign-off | pending |
| Generation Source | manual-test-case |
| Generation Status | generated |
| Generation Mode | suite |

## User Story

As a media planner,
I want an accessible confirmation dialog when I activate the delete control next to a channel in the media section,
So that I can intentionally remove a channel after a successful confirmation or cancel and keep the channel unchanged.

## Preconditions

- The user has a valid non-production authenticated Playwright storage state.
- `PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.rtd.js-devops.co.uk/`.
- Local storage key `feature-flags` enables `FEATURE_NECTAR_AI`, `FEATURE_NUP`, and `FEATURE_NECTAR_AI_MP`.
- The user can access Media Planner at `/planning`.
- The advertiser `N360_Unilever_MS`, brand `Unilever | Knorr | MS`, objective `Customer retention`, and product search `knorr` are available (SKU 2001227 is NOT brand-linked in dev — live-verified 2026-07-04: "None of your SKUs are associated with the selected advertiser and brand").
- Every emitted case starts a fresh, unsaved conversation and creates exactly the one or two channels named by that case.
- `E2E_MP_DELETION_ONSITE_CHANNEL` and `E2E_MP_DELETION_OFFSITE_CHANNEL` identify exact, brand-resolvable non-production channel names; the documented dev defaults are `Homepage Sponsored Product` and `Meta`.
- Campaign start dates are chosen at least 20 days from the current date so the separate booking-deadline validation does not interfere with the deletion flow (live 2026-07-04: the offsite channel Meta enforces a 14-day booking deadline; onsite channels accepted +10).

## Out-of-scope

- Admin configuration changes are out of scope and must remain read-only.
- Booking-deadline and minimum-duration administration is out of scope.
- Chat-driven deletion recompute parity is pending automation and is not claimed by the emitted suite.
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
| RULE-001 | The delete control in a channel's media row is enabled, keyboard-focusable, and accessibly named while the channel exists | deleteControl.enabled === true AND deleteControl accessible name identifies delete/remove and its channel | Test failure: an unavailable or ambiguous control prevents intentional deletion |
| RULE-002 | Activating the delete control opens a modal confirmation dialog with the verbatim wording | role=dialog; dialogText === "Are you sure you want to delete this channel?" (case-sensitive, single space, trailing question mark, no period); focus is inside the dialog | Blocking: the summary remains unchanged until the user chooses Delete, Cancel, or Escape |
| RULE-003 | A successful Delete removes only the target; Cancel/Escape keep the plan unchanged | on Delete: target absent AND survivor present AND newTotalBudget = capturedTotalBudget - deletedChannelBudget; on Cancel/Escape: rows, total, and dates equal their captured values | Blocking: the modal closes after any action; Cancel/Escape return focus to the invoking delete control; backend-failure rollback is separately pending because the delete operation is not captured |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | plan with one onsite channel (budget £50,000, start today+20, end today+50); action=inspect delete control | The control is enabled/focusable and its accessible name communicates delete/remove plus the target channel identity | Group B standard channel; repeated generic button names are not sufficient |
| DC-002 | plan with one onsite channel; activate its delete control with the keyboard | A named role=dialog appears, focus is inside it, and it contains the exact text "Are you sure you want to delete this channel?" | Group B standard channel; covers TC-DEL-002, wording-lock TC-DEL-021, and keyboard/dialog accessibility |
| DC-003 | plan with onsite £50,000 and offsite £40,000; target=onsite; action=open dialog then click the exact Delete button | The dialog closes, onsite is absent, offsite remains, and Total Budget recomputes from £90,000 to £40,000 | Group B; reduced from four groups — at-home/in-store additions are pending brand-resolvable dev channels (see Pending Automation); covers TC-DEL-003 |
| DC-004 | plan with onsite and offsite; capture channel rows, Total Budget, and campaign dates; target=onsite; action=open dialog then click Cancel | The dialog closes, the captured plan state is byte-identical, and focus returns to the onsite delete control | Group B; reduced from four groups (see DC-003 note); covers TC-DEL-004 and TC-DEL-023 |
| DC-005 | plan with onsite and offsite; capture channel rows, Total Budget, and campaign dates; action=open onsite dialog then press Escape | The dialog closes, the captured plan state is byte-identical, and focus returns to the onsite delete control | Group B standard channels; covers TC-DEL-005 and pairs with DC-004 as the cancel/dismiss equivalence table |
| DC-006 | plan with onsite (target) and offsite; click the exact Delete button for onsite, then re-open for offsite and click the exact Cancel button | Delete removes onsite and Cancel keeps offsite; the buttons are not swapped, duplicated, mislabelled, or non-functional | Group B standard channels; NUP-19104 regression characterization; covers TC-DEL-006 |
| DC-007 | plan with EXACTLY one onsite channel (budget £50,000, start today+20, end today+50); boundary=at-minimum; action=delete the only channel and confirm | The media section shows no channel rows, Total Budget shows the empty value "£--", and campaign start/end show no parseable dates | Group B standard channel; count=1 boundary of delete-all; covers TC-DEL-007 |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "channels": [
        {
          "group": "onsite",
          "budget": "50000",
          "startOffsetDays": 20,
          "endOffsetDays": 50
        }
      ],
      "action": "inspect-delete-control",
      "target": "onsite"
    },
    "expected": {
      "result": "control-enabled",
      "accessibleNamePattern": "/delete|remove/i",
      "accessibleNameIdentifiesChannel": true
    },
    "notes": "Group B standard channel. Delete control must be enabled and focusable, not the previous inactive/greyed state per NUP-15407."
  },
  {
    "caseId": "DC-002",
    "inputs": {
      "channels": [
        {
          "group": "onsite",
          "budget": "50000",
          "startOffsetDays": 20,
          "endOffsetDays": 50
        }
      ],
      "action": "click-delete-control",
      "target": "onsite"
    },
    "expected": {
      "result": "dialog-open",
      "dialogText": "Are you sure you want to delete this channel?",
      "namedDialog": true,
      "focusInsideDialog": true
    },
    "notes": "Group B standard channel. Wording is case-sensitive against the CONFIRMATION_WORDING constant (capital A, single space, trailing question mark, no period). Covers wording-lock TC-DEL-021."
  },
  {
    "caseId": "DC-003",
    "inputs": {
      "channels": [
        {
          "group": "onsite",
          "budget": "50000",
          "startOffsetDays": 20,
          "endOffsetDays": 50
        },
        {
          "group": "offsite",
          "budget": "40000",
          "startOffsetDays": 20,
          "endOffsetDays": 50
        }
      ],
      "action": "open-dialog-then-delete",
      "target": "onsite"
    },
    "expected": {
      "result": "deleted",
      "dialogHidden": true,
      "removedChannel": "onsite",
      "remainingChannels": [
        "offsite"
      ],
      "totalBudgetBefore": "£90,000",
      "totalBudgetAfter": "£40,000"
    },
    "notes": "Group B standard channels. Use the dialog-scoped exact `Delete` button verified by the Page Object; do not guess Yes/Confirm aliases."
  },
  {
    "caseId": "DC-004",
    "inputs": {
      "channels": [
        {
          "group": "onsite",
          "budget": "50000",
          "startOffsetDays": 20,
          "endOffsetDays": 50
        },
        {
          "group": "offsite",
          "budget": "40000",
          "startOffsetDays": 20,
          "endOffsetDays": 50
        }
      ],
      "action": "open-dialog-then-cancel",
      "target": "onsite",
      "captureBeforeAction": [
        "totalBudget",
        "campaignStart",
        "campaignEnd"
      ]
    },
    "expected": {
      "result": "unchanged",
      "dialogHidden": true,
      "channelsUnchanged": true,
      "totalBudgetUnchanged": true,
      "campaignDatesUnchanged": true,
      "focusReturnedToInvoker": true
    },
    "notes": "Group B standard channels. Use the dialog-scoped exact `Cancel` button verified by the Page Object. Asserts byte-identical Total Budget and timeline."
  },
  {
    "caseId": "DC-005",
    "inputs": {
      "channels": [
        {
          "group": "onsite",
          "budget": "50000",
          "startOffsetDays": 20,
          "endOffsetDays": 50
        },
        {
          "group": "offsite",
          "budget": "40000",
          "startOffsetDays": 20,
          "endOffsetDays": 50
        }
      ],
      "action": "open-dialog-then-dismiss",
      "dismissVia": ["Escape"],
      "target": "onsite",
      "captureBeforeAction": ["totalBudget", "campaignStart", "campaignEnd"]
    },
    "expected": {
      "result": "unchanged",
      "dialogHidden": true,
      "channelsUnchanged": true,
      "totalBudgetUnchanged": true,
      "campaignDatesUnchanged": true,
      "focusReturnedToInvoker": true
    },
    "notes": "Group B standard channels. Escape dismissal is required to equal Cancel and is executed as the second row of the cancellation equivalence table."
  },
  {
    "caseId": "DC-006",
    "inputs": {
      "channels": [
        {
          "group": "onsite",
          "budget": "50000"
        },
        {
          "group": "offsite",
          "budget": "40000"
        }
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
      "channels": [
        {
          "group": "onsite",
          "budget": "50000",
          "startOffsetDays": 20,
          "endOffsetDays": 50
        }
      ],
      "boundary": "at-minimum",
      "action": "delete-only-channel-and-confirm",
      "target": "onsite",
      "captureBeforeAction": [
        "totalBudget",
        "campaignStart",
        "campaignEnd"
      ]
    },
    "expected": {
      "result": "emptied",
      "channelRowCount": 0,
      "totalBudget": "\u00a3--",
      "campaignDatesParseable": false
    },
    "notes": "Group B standard channel. Count=1 -> 0 at-minimum boundary of the delete-all behaviour. Empty timeline may render a placeholder; assert zero parseable dates."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| advertiser | N360_Unilever_MS | Non-production advertiser |
| brand | Unilever \| Knorr \| MS | Non-production brand |
| objective | Customer retention | Media Planner objective |
| productSearch | knorr | Product search term for the guided flow (live-proven; the source case's SKU 2001227 is not brand-linked in dev) |
| onsiteChannel | Homepage Sponsored Product | Default exact onsite channel; override with `E2E_MP_DELETION_ONSITE_CHANNEL` |
| offsiteChannel | Meta | Default exact offsite channel; override with `E2E_MP_DELETION_OFFSITE_CHANNEL` |
| onsiteBudget | 50000 | Per-channel budget for onsite |
| offsiteBudget | 40000 | Per-channel budget for offsite |
| confirmationWording | Are you sure you want to delete this channel? | Verbatim dialog text (case-sensitive constant CONFIRMATION_WORDING) |
| emptyTotalBudget | £-- | Total Budget value shown when no channels remain (per authenticated selector audit) |
| bookingDeadlineDays | 14 | Read-only configured booking-deadline rule (live 2026-07-04: Meta enforces 14 days) avoided by choosing start >= today+20 |

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
| 1 | AC-001 | Build a one-channel plan and inspect its delete control | /planning and summary-panel channel row | DC-001 target onsite | The channel row appears and its delete control is enabled and accessibly named | row visible; delete control enabled with accessible name /delete\|remove/i |
| 2 | AC-002 | Keyboard-activate the delete control and inspect the confirmation dialog | channel delete control | DC-002 target onsite | A named role=dialog appears with focus inside and the verbatim wording "Are you sure you want to delete this channel?" | role/name; focused descendant; exact confirmation wording |
| 3 | AC-003 | Confirm deletion in a two-channel plan | confirmation dialog exact Delete button | DC-003 target onsite | Onsite is removed, offsite remains, and Total Budget changes from £90,000 to £40,000 | target count 0; survivor visible; computed remaining total |
| 4 | AC-004 | Cancel or Escape deletion in independent two-channel plans | confirmation dialog Cancel button or Escape | DC-004, DC-005 | The dialog closes, all captured plan fields are unchanged, and focus returns to the invoking control | both rows; exact total/dates; invoking control focused |
| 5 | NEG-001 | Use the exact Delete label for onsite, then the exact Cancel label for offsite | confirmation dialog buttons | DC-006 | Delete removes onsite and Cancel keeps offsite; swapped, duplicated, or non-functional labels fail | onsite count 0; offsite visible; dialog hidden |
| 6 | AC-005 | Delete the only channel and assert the empty-state recompute boundary | summary-panel and delete dialog | DC-007 | Deleting the only channel empties the media section and Total Budget shows "£--" | delete-control count 0; Total Budget "£--"; no year in dates |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | DC-006 (NUP-19104): the Delete and Cancel buttons are swapped, mislabelled, duplicated, or non-functional | The test fails; the exact labelled Delete action must remove onsite and the exact labelled Cancel action must keep offsite |

## Acceptance Criteria

- AC-001: A built channel row exposes an enabled, focusable delete control whose accessible name identifies both the destructive action and target channel.
- AC-002: Keyboard-activating the delete control opens a named modal dialog, moves focus inside it, and shows the verbatim text "Are you sure you want to delete this channel?".
- AC-003: Choosing the exact Delete action removes only the target and recomputes Total Budget to the remaining channel's £40,000 budget.
- AC-004: Cancelling or pressing Escape closes the dialog, preserves both rows, Total Budget, and campaign dates, and returns focus to the invoking delete control.
- AC-005: Deleting the only channel empties the media section and Total Budget shows the empty value "£--" (the count=1 -> 0 boundary).

## Locator Hints

- Use the live-verified Page Object wrappers for the delete control: `PlanningPage.channelDeleteControlFor(channelName)` (the channel's summary block filtered by name, then `getByRole('button', { name: /delete channel/i })` — verified 2026-06-23; the DOM has no role=row grid).
- Prefer `getByRole('dialog')` filtered by the confirmation wording for the confirmation dialog.
- Use the live-verified Page Object wrappers for the dialog actions: Confirm `PlanningPage.modalDeleteConfirmButton()` (`getByRole('button', { name: 'Delete', exact: true })`, verified 2026-06-23), Cancel `PlanningPage.modalDeleteCancelButton()` (dialog-scoped `getByRole('button', { name: 'Cancel', exact: true })`), dismiss via `PlanningPage.dismissDialogWithEscape()` (keyboard Escape; no X/close control is asserted).
- Prefer exact visible text for assistant option chips such as advertiser, brand, objective, SKU, Add hero SKU, and Confirm.
- Scope assertions to the active tabpanel; test-tab-{onsite|offsite|instore|athome} all stay mounted.
- Use CSS only with an explicit locator-policy exception comment directly above the locator call.

## Generated Test Requirements

- Must import from fixtures/test.
- Must use test.step.
- Must use Page Objects or Component Objects for all locators.
- Must not create direct `page.getBy*` or `page.locator(...)` locators in generated test bodies.
- This spec declares `Generation Mode | suite`; split the flow into focused tests, with DC-004/DC-005 as a real two-row cancellation equivalence table and every other emitted case executed once.
- Must put `expect(...)` only in the final assertion step for each test.
- Must title assertion steps `Assert AC-###: ...` or `Assert NEG-###: ...`.
- Must include meaningful expect assertions for user-visible behavior.
- In suite mode, must cover every AC ID from this spec with a final assertion step.
- Must assert the salient expected values "Are you sure you want to delete this channel?", "£--", onsite, offsite.
- Must assert dialog focus containment and focus restoration using locator-based focus assertions; a plain captured boolean is insufficient.
- Default generated-test execution target is Chromium only.
- Cross-browser generated-test execution is opt-in.
- Must enumerate every Data Cases as JSON case ID: DC-001, DC-002, DC-003, DC-004, DC-005, DC-006, DC-007.
- Plan creation is multiple AI turns (30-60s each); mark slow tests `test.slow` with an extended expect timeout (~75s) for backend round-trips.
- Must not use page.waitForTimeout.
- Must not use page.waitForLoadState('networkidle').
- Must not use XPath.
- Must not use test.only.
- Must not silently skip.
- Must not use real credentials.
- Must not commit auth state.

## Pending Automation (no test emitted)

Cases that are specified but cannot be verified end-to-end today (E2E-only policy: no placeholder
tests). Automate each once its blocker is removed.

| Source Case | Blocker |
|---|---|
| DC-008 (TC-DEL-008/009) — staggered middle-channel recompute | Needs the pre-configured staggered multi-channel fixture (E2E_MP_DELETION_STAGGERED_FIXTURE unset) plus cost-oracle parity for the expected totals |
| DC-009 (TC-DEL-018/022) — UI-vs-chat deletion equivalence | Same staggered fixture dependency; also two equivalent plans per run |
| DC-010 / NEG-004 (TC-DEL-024) — delete endpoint fault-injection (HTTP 500) | The channel-delete request (GraphQL op name) is uncaptured; route interception needs one HAR of a manual delete to pin the op without breaking sibling reads |
| Four-group variants of DC-003/DC-004 (at home, in-store) | No live-proven brand-available at-home/in-store dev channel for Unilever \| Knorr \| MS; the emitted cases run on the two proven groups (onsite, offsite) |

## Notes

- This test intentionally avoids admin pages and does not change Channel Management or channel configuration; channel rules are treated as pre-configured and read-only.
- The confirmation wording is asserted case-sensitively against the constant `CONFIRMATION_WORDING` = "Are you sure you want to delete this channel?" (capital A, single space, trailing question mark, no period); source confirmed in NUP-15407.doc.
- Emitted cases DC-001 through DC-007 run on exact, env-overridable channels added to a fresh plan. Pending DC-008/DC-009 require pre-configured staggered fixtures; pending DC-010 requires the captured delete operation and a safe fault-injection contract.
- The Page Object uses the live-verified exact `Delete` and `Cancel` labels. DC-006 proves those labelled actions are neither swapped nor non-functional.
- Recompute expectations are derived from the requested channel budgets; defaults are £90,000 before and £40,000 after deleting onsite.
- Campaign start dates are kept at least 20 days out so the booking-deadline validation does not interfere with the deletion flow.
- Human review must confirm the exact dialog wording, accessible dialog name, focus placement/restoration, empty-state copy, and the two default channel names. Backend failure/rollback remains blocked until the GraphQL delete operation is captured safely.
