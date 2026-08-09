# Flow: PsychicBook footer navigation opens the About Us page

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-PSY-FOOTER-001 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P2 |
| Test Type | regression |
| Auth | none |
| Target Test File | tests/regression/psychicbook-footer-about.spec.ts |
| Base Path | / |
| Tags | @generated @regression @psychicbook @footer |
| Generation Mode | single |
| Generation Source | manual |
| Generation Status | pending-generation |

## User Story

As an anonymous PsychicBook visitor,
I want to follow the About Us link in the site footer,
So that I can read who is behind the service before signing up.

## Preconditions

- `PLAYWRIGHT_TEST_BASE_URL` identifies the reviewed non-production PsychicBook environment.
- `E2E_HTTP_BASIC_USERNAME` and `E2E_HTTP_BASIC_PASSWORD` supply the browser-level HTTP Basic challenge at runtime when the environment requires it.
- No application sign-in is required for this anonymous navigation flow.

## Out-of-scope

- Production environments, committed HTTP Basic values, and any authenticated behavior.
- Content review of the About Us copy beyond its visible page heading.
- Every other footer link; this flow covers only the About Us destination.

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
| RULE-001 | The landing page footer exposes an About Us navigation link for anonymous visitors. | landing page => visible footer About Us link | A missing footer link blocks the navigation flow. |
| RULE-002 | Following the footer About Us link opens the About Us page with its visible page heading. | click footer About Us link => About Us heading visible | Absence of the heading fails the final business assertion. |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | base path `/` and the footer link named `About Us` | The About Us page shows its level-one heading `About Us` | Positive anonymous footer-navigation path |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "basePath": "/",
      "footerLinkName": "About Us"
    },
    "expected": {
      "aboutUsHeadingVisible": true
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
| footerLinkName | About Us | Visible accessible name of the reviewed footer link |

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
| 2 | AC-002 | Activate the footer About Us link | About Us footer link | none | The browser navigates to the About Us page | Scope the link to the footer landmark and use accessible name `About Us` |
| 3 | AC-003 | Inspect the About Us page heading | About Us level-one heading | none | The About Us heading is visible | Final assertion only: visible level-one heading `About Us` |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | The About Us destination fails to render its page content | The About Us heading is not visible and the flow fails its final assertion. |

## Acceptance Criteria

- AC-001: The landing page opens through the environment-provided browser challenge configuration.
- AC-002: The footer exposes an About Us link that navigates to the About Us page.
- AC-003: The About Us page shows its visible level-one heading `About Us`.

## Locator Hints

- Keep all locators in an inline Page Object class inside the generated file; the test body must not create direct Playwright locators.
- Scope the footer link through the `contentinfo` landmark role, then role `link` with exact accessible name `About Us`.
- Use role `heading` with level 1 and exact accessible name `About Us` for the final assertion.
- Do not assert on the page URL; the visible heading is the reviewed business outcome.

## Generated Test Requirements

- Must import `test` and `expect` from `../../fixtures/test`.
- Must keep the flow Page Object inline in the generated file and must not import or modify another Page Object.
- Must generate exactly one primary test and no optional `NEG-001` test.
- Must declare the exact metadata tags through the Playwright `{ tag: [...] }` option.
- Must use `test.step`, and every step title must carry at least one `AC-###` token.
- Must declare a `covered-ac-ids` annotation whose set equals AC-001, AC-002, and AC-003.
- Must not read or embed the runtime base URL or HTTP Basic values; Playwright configuration owns those values.
- Must place `expect(...)` only in the final assertion step.
- Must title that final step `Assert AC-003: About Us heading is visible` and assert only the visible level-one About Us heading.
- Must not use hard waits, XPath, focused tests, skipped tests, or direct Playwright locators in the generated test body.

## Notes

- The framework supplies HTTP Basic credentials through Playwright configuration when both runtime variables are present.
- The reviewed non-production environment renders the About Us page at `/about/` with a stable level-one heading.
