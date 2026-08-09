# Flow: PsychicBook FAQ catalog shows the first registration question

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-PSY-FAQ-001 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P2 |
| Test Type | regression |
| Auth | none |
| Target Test File | tests/regression/psychicbook-faq-catalog.spec.ts |
| Base Path | / |
| Tags | @generated @regression @psychicbook @faq |
| Generation Mode | single |
| Generation Source | manual |
| Generation Status | pending-generation |

## User Story

As an anonymous PsychicBook visitor,
I want to open the FAQ catalog from the site footer,
So that I can read how to register and start a free chat before creating an account.

## Preconditions

- `PLAYWRIGHT_TEST_BASE_URL` identifies the reviewed non-production PsychicBook environment.
- `E2E_HTTP_BASIC_USERNAME` and `E2E_HTTP_BASIC_PASSWORD` supply the browser-level HTTP Basic challenge at runtime when the environment requires it.
- No application sign-in is required for this anonymous navigation flow.

## Out-of-scope

- Production environments, committed HTTP Basic values, and any authenticated behavior.
- FAQ category switching, search, and every FAQ entry other than the reviewed first registration question.
- The landing-page FAQ section; this flow covers the dedicated FAQ catalog page.

## Stability Requirements

| Field | Value |
|---|---|
| Parallel Safe | yes |
| Data Isolation | external |
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
| RULE-001 | The landing page footer exposes a FAQ navigation link for anonymous visitors. | landing page => visible footer FAQ link | A missing footer link blocks the navigation flow. |
| RULE-002 | The FAQ catalog page presents the first registration question to anonymous visitors. | open FAQ catalog => visible first registration question | Absence of the question entry fails the final business assertion. |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | base path `/`, the footer link named `FAQ`, and the reviewed question text | The FAQ catalog shows the visible question `How do I register and start a free chat?` | Positive anonymous FAQ-catalog path |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "basePath": "/",
      "footerLinkName": "FAQ",
      "questionText": "How do I register and start a free chat?"
    },
    "expected": {
      "faqHeadingReached": true,
      "firstRegistrationQuestionVisible": true
    },
    "notes": "Runtime base URL and HTTP Basic values remain outside the committed specification."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| baseUrl | PLAYWRIGHT_TEST_BASE_URL | Non-production PsychicBook base URL supplied at runtime |
| httpBasicUsername | E2E_HTTP_BASIC_USERNAME | Browser-challenge username supplied at runtime |
| httpBasicPassword | E2E_HTTP_BASIC_PASSWORD | Browser-challenge password supplied at runtime |
| footerLinkName | FAQ | Visible accessible name of the reviewed footer link |
| questionText | How do I register and start a free chat? | Exact visible text of the reviewed first FAQ entry |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | Live non-production external flow | [] |

## Mocks as JSON

```json
[]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Open the external landing page | `/` | PLAYWRIGHT_TEST_BASE_URL with framework browser challenge configuration | The PsychicBook landing page is reached | Start without embedding runtime values |
| 2 | AC-002 | Activate the footer FAQ link | FAQ footer link | none | The browser navigates to the FAQ catalog page with its level-one heading | Scope the link to the footer landmark and use exact accessible name `FAQ` |
| 3 | AC-003 | Inspect the first registration question entry | First FAQ question entry | none | The question `How do I register and start a free chat?` is visible | Final assertion only: visible exact question text |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | The FAQ catalog fails to render its question entries | The first registration question is not visible and the flow fails its final assertion. |

## Acceptance Criteria

- AC-001: The landing page opens through the environment-provided browser challenge configuration.
- AC-002: The footer exposes a FAQ link that navigates to the FAQ catalog page.
- AC-003: The FAQ catalog shows the visible question `How do I register and start a free chat?`.

## Locator Hints

- Keep all locators in an inline Page Object class inside the generated file; the test body must not create direct Playwright locators.
- Scope the footer link through the `contentinfo` landmark role, then role `link` with exact accessible name `FAQ`.
- The FAQ question entries are plain text nodes, not headings; use an exact visible-text locator for `How do I register and start a free chat?`.
- Do not assert on the page URL; the visible question entry is the reviewed business outcome.

## Generated Test Requirements

- Must import `test` and `expect` from `../../fixtures/test`.
- Must keep the flow Page Object inline in the generated file and must not import or modify another Page Object.
- Must generate exactly one primary test and no optional `NEG-001` test.
- Must declare the exact metadata tags through the Playwright `{ tag: [...] }` option.
- Must use `test.step`, and every step title must carry at least one `AC-###` token.
- Must declare a `covered-ac-ids` annotation whose set equals AC-001, AC-002, and AC-003.
- Must not read or embed the runtime base URL or HTTP Basic values; Playwright configuration owns those values.
- Must place `expect(...)` only in the final assertion step.
- Must title that final step `Assert AC-003: first registration question is visible` and assert only the visible first registration question entry.
- Must not use hard waits, XPath, focused tests, skipped tests, or direct Playwright locators in the generated test body.

## Notes

- The framework supplies HTTP Basic credentials through Playwright configuration when both runtime variables are present.
- The reviewed non-production environment renders the FAQ catalog at `/faq/` with the Psychics category expanded by default and the first question visible without interaction.
