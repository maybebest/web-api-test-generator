# Flow: Discard or keep a draft media plan via Nectar AI

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-022 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/sains/media-plan-discard-flow.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated |
| Review Status | pending-review |
| Review Sign-off | pending |
| Generation Source | manual-test-case |
| Generation Status | generated |
| Generation Mode | suite |

## User Story

As a media planner,
I want clear options to save my draft plan or discard it after confirming channels, with an explicit confirmation step and unambiguous messaging,
So that I can safely delete a plan I no longer want — or back out of the deletion — without losing a plan by accident.

## Preconditions

- The user has a valid non-production authenticated Playwright storage state (`playwright/.auth/user.json`).
- `PLAYWRIGHT_TEST_BASE_URL` points to `https://www.dev.pollen.js-devops.co.uk/`.
- Local storage key `feature-flags` enables `FEATURE_NECTAR_AI`, `FEATURE_NUP`, and `FEATURE_NECTAR_AI_MP`.
- The user can access the Planning page at `/planning`.
- The advertiser `N360_Unilever_MS`, brand `Unilever | Knorr | MS`, and objective `Customer retention` are available.
- The product search term `knorr` returns at least one selectable product/SKU.
- The offsite channel `Meta` is bookable for a future campaign window (the test computes start=+45d / end=+75d at runtime so the request can never rot into past dates) with a 7k budget.

## Out-of-scope

- Admin and channel configuration changes are out of scope and must remain read-only.
- The saved-plan name structure, CSV download and the Pollen editor hand-off are out of scope (covered by FLOW-MP-020).
- Booking-deadline, duration and store validation are out of scope (covered by other specs).
- Database-level verification that the discarded plan record is deleted is out of scope for the UI suite; the asserted signal is the documented discarded-state messaging.
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
| RULE-001 | Save/discard actions are gated on final channel confirmation | The `Save plan as draft` and `Discard draft plan` actions are offered only after the user confirms channel selection and details (NUP-20082 Constraint 1); before that stage the discard action is absent | Offering discard before a confirmed plan exists risks deleting the auto-saved early draft unintentionally |
| RULE-002 | Discard always asks for confirmation first | Clicking `Discard draft plan` never deletes immediately: the assistant asks `Are you sure you want to discard your draft plan?` and offers `Yes, discard draft plan` and `No, continue with my plan` (NUP-20082 Scenarios 2-3) | An immediate delete without the confirmation question is a defect |
| RULE-003 | Yes permanently discards; No keeps and saves | Choosing `Yes, discard draft plan` deletes the plan and shows the discarded message; choosing `No, continue with my plan` keeps the plan and persists the latest details with the standard saved-plan message (NUP-20082 Scenarios 2-3) | A `No` answer that deletes, or a `Yes` answer that keeps the plan, is a critical defect |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | journey=build to plan confirmation (advertiser=N360_Unilever_MS; brand=Unilever \| Knorr \| MS; objective=Customer retention; productSearch=knorr; channel=Meta; dates=+45d..+75d; budget=7k) | Both post-confirmation actions are offered with the exact labels `Save plan as draft` and `Discard draft plan` | NUP-20082 Scenario 4 + Constraint 1 |
| DC-002 | journey=DC-001 then click `Discard draft plan` | The assistant asks `Are you sure you want to discard your draft plan?` and surfaces the two hot buttons `Yes, discard draft plan` and `No, continue with my plan`; the plan is not yet deleted | NUP-20082 Scenarios 2-3 shared prompt |
| DC-003 | journey=DC-002 then click `No, continue with my plan` | The plan is not deleted; the assistant persists the latest details and replies with the standard saved-plan message `Your plan has been saved as a draft.` | NUP-20082 Scenario 3 (live save copy verified 2026-07-03 on FLOW-MP-020) |
| DC-004 | journey=DC-002 then click `Yes, discard draft plan` | The plan record is discarded and the assistant replies that the plan has been discarded | NUP-20082 Scenario 2 |

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
      "channelRequest": "Offsite, Meta, <today+45d> till <today+75d>, the budget is 7k, Self-Serve",
      "stage": "plan-confirmed"
    },
    "expected": {
      "saveActionLabel": "Save plan as draft",
      "discardActionLabel": "Discard draft plan"
    },
    "notes": "Post-confirmation action labels and availability (NUP-20082 Scenario 4)."
  },
  {
    "caseId": "DC-002",
    "inputs": {
      "stage": "plan-confirmed",
      "action": "Discard draft plan"
    },
    "expected": {
      "confirmationQuestion": "Are you sure you want to discard your draft plan?",
      "yesButton": "Yes, discard draft plan",
      "noButton": "No, continue with my plan"
    },
    "notes": "Discard is a two-step action; the prompt precedes any deletion."
  },
  {
    "caseId": "DC-003",
    "inputs": {
      "stage": "discard-prompt-open",
      "choice": "No, continue with my plan"
    },
    "expected": {
      "result": "kept-and-saved",
      "message": "Your plan has been saved as a draft."
    },
    "notes": "NUP-20082 Scenario 3: No overwrites the early draft with the latest details and shows the standard saved message."
  },
  {
    "caseId": "DC-004",
    "inputs": {
      "stage": "discard-prompt-open",
      "choice": "Yes, discard draft plan"
    },
    "expected": {
      "result": "discarded",
      "messageFragment": "plan has been discarded"
    },
    "notes": "NUP-20082 Scenario 2: Yes deletes the plan record and shows the discarded message."
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
| channelRequest | Offsite, Meta, <today+45d> till <today+75d>, the budget is 7k, Self-Serve | Free-text channel request (dates computed at runtime) |
| discardAction | Discard draft plan | Post-confirmation discard action label |
| confirmationQuestion | Are you sure you want to discard your draft plan? | Discard confirmation copy (NUP-20082) |
| yesButton | Yes, discard draft plan | Affirmative hot button |
| noButton | No, continue with my plan | Negative hot button |
| savedMessage | Your plan has been saved as a draft. | Standard saved-plan copy (live-verified 2026-07-03) |
| discardedFragment | plan has been discarded | Salient fragment of the discarded-state copy |

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
| 1 | AC-001 | Build a plan to final channel confirmation | Guided planner + assistant chat | advertiser; brand; objective; productSearch; channelRequest; Confirm | Both `Save plan as draft` and `Discard draft plan` actions are offered | both action buttons are visible and enabled |
| 2 | AC-002 | Click `Discard draft plan` | Post-confirmation actions | Discard draft plan | The assistant asks `Are you sure you want to discard your draft plan?` with `Yes, discard draft plan` and `No, continue with my plan` hot buttons | confirmation question and both hot buttons are visible |
| 3 | AC-003 | Answer `No, continue with my plan` | Discard confirmation hot buttons | No, continue with my plan | The plan is kept and saved with the standard saved-plan message | saved confirmation is visible |
| 4 | AC-003 | Answer `Yes, discard draft plan` | Discard confirmation hot buttons | Yes, discard draft plan | The plan is discarded and the assistant confirms the discarded state | discarded confirmation is visible |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | At the objective stage — before any channel has been added or confirmed — inspect the assistant actions | The `Discard draft plan` action is not offered before final channel confirmation |

## Acceptance Criteria

- AC-001: After final channel confirmation, both actions are offered with the exact labels `Save plan as draft` and `Discard draft plan`.
- AC-002: Clicking `Discard draft plan` opens the confirmation question `Are you sure you want to discard your draft plan?` with the hot buttons `Yes, discard draft plan` and `No, continue with my plan`, and does not delete the plan yet.
- AC-003: Answering the confirmation resolves the draft according to the choice: `No, continue with my plan` keeps the plan and persists the latest details with the standard saved-plan message; `Yes, discard draft plan` discards the plan and the assistant confirms the discarded state.

## Locator Hints

- Use `PlanningPage.saveButton()` (role button `Save plan as draft`) and `PlanningPage.discardButton()` (role button `Discard draft plan`, anchored exact regex so it never matches the `Yes, discard draft plan` hot button) for the post-confirmation actions.
- Use `PlanningPage.discardPrompt()` for the confirmation question copy and `PlanningPage.discardYesButton()` / `PlanningPage.discardNoButton()` (anchored role-name regexes) for the hot buttons.
- Use `PlanningPage.savedConfirmation()` for the saved copy and `PlanningPage.discardedConfirmation()` for the discarded copy.
- The hot buttons render inside the assistant chat panel as regular buttons; prefer role/name locators, never positional picks.

## Generated Test Requirements

- Must import from fixtures/test.
- Must use test.step.
- Must use Page Objects or Component Objects for all locators.
- Must not create direct `page.getBy*` or `page.locator(...)` locators in generated test bodies.
- This spec declares `Generation Mode | suite`; emit one focused test per Data Case (DC-###) plus one test for NEG-001, each enumerating its case id in the title.
- Must declare the spec metadata `Tags` exactly via the Playwright `{ tag: [...] }` option.
- Must put `expect(...)` only in the final assertion step for each test.
- Must title the final assertion step `Assert AC-###: ...` or `Assert NEG-###: ...`.
- Must enumerate the `Data Cases as JSON` case ids DC-001, DC-002, DC-003 and DC-004 in test titles.
- Must assert the salient expected values: Are you sure you want to discard your draft plan?, Yes, discard draft plan, No, continue with my plan, Your plan has been saved as a draft.
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

- Source: NUP-20082 "Update plan saving and discard functionality" (Done, SignedOffByKaty) — Scenarios 2, 3 and 4 plus Constraint 1; catalogue cases E2E-PLN-001/002/006/007/008.
- The documented post-save copy in NUP-20082 ("Your plan is now saved.") does not exist live; the live-verified copy is `Your plan has been saved as a draft.` (FLOW-MP-020, 2026-07-03). The discarded-state copy is asserted on its salient fragment for the same reason.
- Every DC journey builds a fresh plan on the live dev environment (`Parallel Safe` = no, `Data Isolation` = external). DC-004 deletes its own plan; DC-003 leaves a saved draft, matching FLOW-MP-020 behavior.
- NEG-001 is meaningful (not vacuous) because the same `discardButton()` locator is live-verified as present by DC-001 in the same suite run.
