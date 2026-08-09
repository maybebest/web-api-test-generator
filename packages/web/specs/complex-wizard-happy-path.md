# Flow: Complex wizard happy path with one recovered validation error

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-CX-WIZARD-001 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | smoke |
| Auth | none |
| Target Test File | tests/smoke/complex-wizard-happy-path.spec.ts |
| Base Path | /complex/wizard |
| Tags | @generated @smoke @local-fixture @complex-wizard |
| Generation Mode | single |
| Generation Source | manual |
| Generation Status | pending-generation |

## User Story

As a new user on the deterministic local fixture,
I want to complete the three-step account wizard, recovering from one email validation error on the way,
So that the stateful wizard proves validation, dynamic fields, and async submission work end to end.

## Preconditions

- The local fixture server is started automatically by the Playwright `webServer` configuration (`node local-fixture/server.mjs`).
- The flow runs in the `local-chromium` project, whose `baseURL` is the local fixture origin `http://127.0.0.1:3000`.
- No authentication and no external network access are required.

## Out-of-scope

- The personal-plan dynamic fields (referral select); this flow exercises the business-plan branch only.
- The range slider, contenteditable notes field, and Back-button state preservation.
- Exhaustive validation matrix; exactly one email validation error is exercised and recovered.

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

## Business Rules

| Rule ID | Rule | Formula | Blocking Behavior |
|---|---|---|---|
| RULE-001 | Blurring an invalid email surfaces the inline error in the `role=alert` region and keeps Next disabled. | invalid email + blur => alert contains "Enter a valid email address." AND Next disabled | A silent invalid email blocks the validation flow. |
| RULE-002 | Valid step-1 fields enable Next; steps preserve state client-side. | name>=2 chars AND valid email AND password>=8 with digit => Next enabled | A disabled Next blocks progression. |
| RULE-003 | Choosing the Business plan reveals the company-name field on step 2. | plan=business => company field visible | A hidden dynamic field blocks step 2 completion. |
| RULE-004 | Submitting with consent shows a spinner phase and then a deterministic confirmation code. | submit => busy status, then code CFX-01798 for the pinned inputs | A missing confirmation code fails the final business assertion. |

## Includes

- none

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | fullName `Wizard User`, bad email `wizard.user`, good email `wizard.user@example.com`, password `fixture-pass-1`, plan `business`, company `Fixture Works Ltd`, startDate `2026-09-01` | The email error appears once and clears; the success panel shows confirmation code `CFX-01798` | Code is a deterministic function of the pinned inputs |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "fullName": "Wizard User",
      "invalidEmail": "wizard.user",
      "email": "wizard.user@example.com",
      "password": "fixture-pass-1",
      "plan": "business",
      "company": "Fixture Works Ltd",
      "startDate": "2026-09-01"
    },
    "expected": {
      "emailError": "Enter a valid email address.",
      "reviewShowsEmail": true,
      "confirmationCode": "CFX-01798"
    },
    "notes": "The wizard derives the confirmation code deterministically from the submitted state."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| fullName | Wizard User | Step 1 name input (testid `wizard-name`) |
| invalidEmail | wizard.user | Triggers the blur validation error |
| email | wizard.user@example.com | Valid replacement value (testid `wizard-email`) |
| password | fixture-pass-1 | Meets length and digit rules (testid `wizard-password`) |
| plan | business | Reveals the company-name dynamic field |
| company | Fixture Works Ltd | Business-branch dynamic field |
| startDate | 2026-09-01 | Step 2 date input |
| confirmationCode | CFX-01798 | Deterministic code for the pinned inputs |

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
| 2 | AC-002 | Enter an invalid email and blur the field | Email input | `wizard.user` | The `role=alert` region lists `Enter a valid email address.` and Next stays disabled | Blur (e.g. Tab away) triggers validation; the region has no testid |
| 3 | AC-003 | Fill valid name, email, and password | Step 1 inputs | `Wizard User` / `wizard.user@example.com` / `fixture-pass-1` | The alert region clears its text content (it stays attached and visible — it never hides) and Next becomes enabled | Inputs carry testids `wizard-name`, `wizard-email`, `wizard-password`; assert empty text, not hidden state |
| 4 | AC-004 | Advance to step 2 and choose the Business plan | Next button, Plan select | plan `business` | Progress reads `Step 2 of 3` and the company-name field appears | Plan select is testid `wizard-plan`; company field has a visible label and no testid |
| 5 | AC-004 | Complete step 2 with company and start date | Company and Start date inputs | `Fixture Works Ltd`, `2026-09-01` | Next becomes enabled for step 2 | The date input uses label `Start date` |
| 6 | AC-005 | Advance to step 3 and review the summary | Next button, review summary | none | The review summary shows the submitted email address | Summary is testid `review-summary`; progress reads `Step 3 of 3` |
| 7 | AC-006 | Confirm consent and submit | Consent checkbox, Create account button | none | A busy spinner status appears, then the success panel | Submit is testid `wizard-submit`; the async delay is a fixed 1100 ms |
| 8 | AC-006 | Inspect the confirmation code | Success panel | none | The confirmation code reads `CFX-01798` | Final assertion only: testid `confirmation-code` has text `CFX-01798` |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | The user submits without correcting the invalid email | Next remains disabled on step 1 and the wizard cannot reach the review step. |

## Acceptance Criteria

- AC-001: The wizard opens on step 1 showing heading `Account setup wizard` and progress `Step 1 of 3`.
- AC-002: Blurring an invalid email shows `Enter a valid email address.` in the alert region while Next stays disabled.
- AC-003: Valid step-1 values clear the alert region's text content — the region stays attached and visible (assert empty text, never wait for it to hide) — and enable Next.
- AC-004: Step 2 reveals the company-name field for the Business plan and accepts the start date.
- AC-005: The step-3 review summary reflects the entered email address.
- AC-006: Submitting with consent passes the spinner phase and shows confirmation code `CFX-01798`.

## Locator Hints

- Keep all locators in an inline Page Object class inside the generated file; the test body must not create direct Playwright locators.
- Step-1 inputs and the plan select carry testids (`wizard-name`, `wizard-email`, `wizard-password`, `wizard-plan`); the company, date, consent, Next, and Back controls deliberately have none — use labels and role/name.
- The validation region is `role=alert`; inline field errors are plain spans without roles.
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
- Must title that final step `Assert AC-006: confirmation code is CFX-01798` and assert only the visible confirmation code text.
- Must not use hard waits, XPath, focused tests, skipped tests, or direct Playwright locators in the generated test body.

## Notes

- The wizard keeps all step fieldsets in the DOM and toggles visibility, so Back/Next preserve state without storage.
- The confirmation code is computed as `(email.length * 73 + fullName.length * 17 + teamSize) % 100000`, zero-padded to five digits; the pinned inputs yield `CFX-01798` with the default team size of 5.
