# Flow: Complex wizard personal-plan branch with referral source and deterministic confirmation

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-CX-WIZARD-002 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | smoke |
| Auth | none |
| Target Test File | tests/smoke/complex-wizard-personal-plan.spec.ts |
| Base Path | /complex/wizard |
| Tags | @generated @smoke @local-fixture @complex-wizard |
| Generation Mode | single |
| Generation Source | manual |
| Generation Status | pending-generation |

## User Story

As a new personal-plan user on the deterministic local fixture,
I want to complete the three-step account wizard through the Personal branch with a referral source,
So that the plan-dependent dynamic fields and the review summary's branch-aware rendering prove testable end to end.

## Preconditions

- The local fixture server is started automatically by the Playwright `webServer` configuration (`node local-fixture/server.mjs`).
- The flow runs in the `local-chromium` project, whose `baseURL` is the local fixture origin `http://127.0.0.1:3000`.
- No authentication and no external network access are required.

## Out-of-scope

- The business-plan dynamic fields (company name, VAT); FLOW-CX-WIZARD-001 exercises the business branch.
- Validation-error recovery; all step-1 values are valid from the start.
- The range slider, contenteditable notes field, and Back-button state preservation.

## Stability Requirements

| Field | Value |
|---|---|
| Parallel Safe | yes |
| Data Isolation | per-test |
| Allowed Retries | 0 |

## Variants

| Locale | Role | Plan |
|---|---|---|
| en-US | guest | standard |

## Includes

- none

## Business Rules

| Rule ID | Rule | Formula | Blocking Behavior |
|---|---|---|---|
| RULE-001 | Valid step-1 fields enable Next. | name>=2 chars AND valid email AND password>=8 with digit => Next enabled | A disabled Next blocks progression. |
| RULE-002 | Choosing the Personal plan reveals the referral select and keeps the company field hidden. | plan=personal => referral select visible AND company field hidden | A wrong dynamic branch blocks step 2 completion. |
| RULE-003 | The step-3 review summary renders the referral value and shows `n/a` for the company on the personal branch. | plan=personal + referral=podcast => summary "podcast" AND company "n/a" | A branch-blind summary fails the review assertion. |
| RULE-004 | Submitting with consent shows a spinner phase and then a deterministic confirmation code. | submit => busy status, then code CFX-02231 for the pinned inputs | A missing confirmation code fails the final business assertion. |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | fullName `Personal Tester`, email `personal.tester@example.com`, password `fixture-pass-2`, plan `personal`, referral `Podcast`, startDate `2026-10-01` | The referral select replaces the company field, the review summary shows `podcast` and company `n/a`, and the success panel shows confirmation code `CFX-02231` | Code is a deterministic function of the pinned inputs |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "fullName": "Personal Tester",
      "email": "personal.tester@example.com",
      "password": "fixture-pass-2",
      "plan": "personal",
      "referralOptionLabel": "Podcast",
      "startDate": "2026-10-01"
    },
    "expected": {
      "referralSummary": "podcast",
      "companySummary": "n/a",
      "confirmationCode": "CFX-02231"
    },
    "notes": "The wizard derives the confirmation code deterministically from the submitted state; the review summary prints the referral select's value ('podcast'), not its label."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| fullName | Personal Tester | Step 1 name input (testid `wizard-name`), length 15 |
| email | personal.tester@example.com | Valid from the start (testid `wizard-email`), length 27 |
| password | fixture-pass-2 | Meets length and digit rules (testid `wizard-password`) |
| plan | personal | Reveals the referral dynamic field |
| referralOptionLabel | Podcast | Visible label; the underlying option value is `podcast` |
| startDate | 2026-10-01 | Step 2 date input |
| confirmationCode | CFX-02231 | Deterministic code for the pinned inputs |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | Fully local deterministic fixture | [] |

## Mocks as JSON

```json
[]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Open the wizard page | `/complex/wizard` | none | The page shows heading `Account setup wizard` and progress `Step 1 of 3` | Progress line is testid `wizard-progress` |
| 2 | AC-002 | Fill valid name, email, and password | Step 1 inputs | `Personal Tester` / `personal.tester@example.com` / `fixture-pass-2` | Next becomes enabled with no validation errors | Inputs carry testids `wizard-name`, `wizard-email`, `wizard-password`; Next has no testid — use role/name |
| 3 | AC-003 | Advance to step 2 and choose the Personal plan | Next button, Plan select | plan `personal` | Progress reads `Step 2 of 3` and the referral select appears while the company field stays hidden | Plan select is testid `wizard-plan`; the referral select's visible label is `How did you hear about us?` and it has no testid |
| 4 | AC-004 | Choose the referral source and the start date | Referral select, Start date input | `Podcast`, `2026-10-01` | Next becomes enabled for step 2 | The date input uses label `Start date`; select the referral by its visible label `Podcast` |
| 5 | AC-005 | Advance to step 3 and review the summary | Next button, review summary | none | The review summary shows referral `podcast` and company `n/a` | Summary is testid `review-summary`; progress reads `Step 3 of 3`; the summary prints the option value `podcast`, not the label |
| 6 | AC-006 | Confirm consent and submit | Consent checkbox, Create account button | none | A busy spinner status appears, then the success panel | Submit is testid `wizard-submit`; the async delay is a fixed 1100 ms |
| 7 | AC-006 | Inspect the confirmation code | Success panel | none | The confirmation code reads `CFX-02231` | Final assertion only: testid `confirmation-code` has text `CFX-02231` |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | The user leaves the start date empty on step 2 | Next remains disabled on step 2 and the wizard cannot reach the review step. |

## Acceptance Criteria

- AC-001: The wizard opens on step 1 showing heading `Account setup wizard` and progress `Step 1 of 3`.
- AC-002: Valid step-1 values enable Next without surfacing validation errors.
- AC-003: Step 2 reveals the referral select for the Personal plan while the company field stays hidden.
- AC-004: Selecting referral `Podcast` and the start date enables Next on step 2.
- AC-005: The step-3 review summary shows referral `podcast` and company `n/a`.
- AC-006: Submitting with consent passes the spinner phase and shows confirmation code `CFX-02231`.

## Locator Hints

- Keep all locators in an inline Page Object class inside the generated file; the test body must not create direct Playwright locators.
- Step-1 inputs and the plan select carry testids (`wizard-name`, `wizard-email`, `wizard-password`, `wizard-plan`); the referral select, date, consent, Next, and Back controls deliberately have none — use labels and role/name.
- The referral select's accessible name is its wrapping label `How did you hear about us?`; select the option by its visible label `Podcast` (the review summary then prints the option's value `podcast`).
- The consent checkbox's real accessible name is the full sentence `I confirm the details above are correct` — use `getByRole('checkbox', { name: 'I confirm the details above are correct' })` and never abbreviate the name (there is no control named 'Consent').
- The submit control carries testid `wizard-submit` — use `getByTestId('wizard-submit')` (its visible label is 'Create account' and it stays disabled until the consent checkbox is checked).
- Wait for the success panel (testid `wizard-success`) via web-first assertions; the submit delay is a fixed 1100 ms and must not be bridged with hard waits.
- The confirmation code element is testid `confirmation-code` inside the success panel.

## Generated Test Requirements

- Must import `test` and `expect` from `../../fixtures/test`.
- Must keep the flow Page Object inline in the generated file and must not import or modify another Page Object.
- Must generate exactly one primary test and no optional `NEG-001` test.
- Must declare the exact metadata tags through the Playwright `{ tag: [...] }` option.
- Must use `test.step`, and every step title must carry at least one `AC-###` token.
- Must declare a `covered-ac-ids` annotation whose set equals AC-001 through AC-006.
- Must place `expect(...)` only in the final assertion step.
- Must title that final step `Assert AC-006: confirmation code is CFX-02231` and assert only the visible confirmation code text.
- Must not use hard waits, XPath, focused tests, skipped tests, or direct Playwright locators in the generated test body.

## Notes

- This flow is the branch complement of FLOW-CX-WIZARD-001: same wizard, opposite plan branch (personal/referral instead of business/company), no validation-error recovery.
- The confirmation code is computed as `(email.length * 73 + fullName.length * 17 + teamSize) % 100000`, zero-padded to five digits; the pinned inputs (email `personal.tester@example.com` length 27, full name `Personal Tester` length 15, default team size 5) yield `(27 * 73 + 15 * 17 + 5) % 100000 = 2231`, i.e. `CFX-02231`.
