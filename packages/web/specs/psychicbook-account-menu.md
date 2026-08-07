# Flow: PsychicBook account menu after email verification

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-PSY-001 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | none |
| Target Test File | tests/regression/psychicbook-account-menu.spec.ts |
| Base Path | / |
| Tags | @generated @regression @psychicbook |
| Generation Mode | single |
| Generation Source | manual |
| Generation Status | generated |

## User Story

As a returning PsychicBook user,
I want to sign in with my environment-provided email and verification code,
So that I can access the account-settings control in the authenticated top menu.

## Preconditions

- `PLAYWRIGHT_TEST_BASE_URL` identifies the reviewed non-production PsychicBook environment.
- `E2E_HTTP_BASIC_USERNAME` and `E2E_HTTP_BASIC_PASSWORD` supply browser-level authentication challenge configuration at runtime when the environment requires it.
- `E2E_USER_EMAIL` identifies a returning non-production user that can complete the email-verification journey without first-time onboarding.
- The deterministic verification code `1234` is accepted for that returning user.

## Out-of-scope

- Real email delivery, social login, phone login, first-time onboarding, profile changes, and account-settings-page behavior.
- Production environments, committed browser-challenge credentials, committed authentication state, and real one-time codes.

## Stability Requirements

| Field | Value |
|---|---|
| Parallel Safe | no |
| Data Isolation | external |
| Allowed Retries | 0 |

## Variants

| Locale | Role | Plan |
|---|---|---|
| en-US | returning user | standard |

## Includes

- none

## Business Rules

| Rule ID | Rule | Formula | Blocking Behavior |
|---|---|---|
| RULE-001 | Authentication uses runtime-provided browser configuration and identity values with the deterministic verification code. | `PLAYWRIGHT_TEST_BASE_URL` + optional HTTP Basic credentials + `E2E_USER_EMAIL` + `1234` | Missing runtime configuration blocks the external flow. |
| RULE-002 | A returning user who completes email verification exposes the account-settings control in the authenticated top menu. | verified returning user => visible account-settings control | Absence of the control fails the final business assertion. |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | base URL, HTTP Basic credentials when required, `E2E_USER_EMAIL`, and verification code `1234` | The authenticated top menu exposes the account-settings control | Positive returning-user account-menu path |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "baseUrlEnv": "PLAYWRIGHT_TEST_BASE_URL",
      "httpBasicUsernameEnv": "E2E_HTTP_BASIC_USERNAME",
      "httpBasicPasswordEnv": "E2E_HTTP_BASIC_PASSWORD",
      "emailEnv": "E2E_USER_EMAIL",
      "verificationCode": "1234"
    },
    "expected": {
      "authenticatedTopMenu": true,
      "accountSettingsControlVisible": true
    },
    "notes": "Runtime values remain outside the committed specification."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| baseUrl | PLAYWRIGHT_TEST_BASE_URL | Non-production PsychicBook base URL |
| httpBasicUsername | E2E_HTTP_BASIC_USERNAME | Runtime HTTP Basic username when required |
| httpBasicPassword | E2E_HTTP_BASIC_PASSWORD | Runtime HTTP Basic password when required |
| email | E2E_USER_EMAIL | Runtime returning-user identity |
| verificationCode | 1234 | Deterministic verification value |

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
| 1 | AC-001 | Open the external landing page | `/` | PLAYWRIGHT_TEST_BASE_URL with framework browser challenge configuration | The PsychicBook landing page is reached | Start the journey without committing browser challenge values |
| 2 | AC-002 | Activate Get Started | Get Started control | none | The email-entry screen opens | Use a semantic Get Started locator |
| 3 | AC-002 | Enter the returning-user email | Email field | E2E_USER_EMAIL | The email field receives the runtime value | Use a semantic email-field locator |
| 4 | AC-002 | Continue from email entry | Continue control | none | The verification-code alternative is available | Use a semantic Continue locator |
| 5 | AC-003 | Choose verification-code entry | Have a verification code instead control | none | The verification-code entry controls are available | Use a semantic alternative-entry locator |
| 6 | AC-003 | Enter the verification code | Verification-code inputs | 1234 | The deterministic verification value is accepted for submission | Keep anonymous digit-input handling inside the Page Object if required |
| 7 | AC-003 | Submit the verification code | Verification-code entry | 1234 | The returning user reaches the authenticated experience | Support the environment's verification submission behavior |
| 8 | AC-004 | Inspect the authenticated top menu | Account-settings top-menu control | none | The account-settings control is visible | Final assertion only: visible account-settings control |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | A rejected verification value is entered | The user remains on verification entry and the account-settings control is not shown. |

## Acceptance Criteria

- AC-001: The PsychicBook landing page opens through the environment-provided browser-level authentication challenge.
- AC-002: Get Started opens email entry and Continue accepts `E2E_USER_EMAIL`.
- AC-003: The user switches to verification-code entry and submits `1234`.
- AC-004: The authenticated top menu exposes a visible account-settings control.

## Locator Hints

- Use a Page Object for all PsychicBook locators; generated test bodies must not create direct Playwright locators.
- Prefer stable `data-testid` locators, then role and accessible-name locators for Get Started, Email, Continue, the verification-code alternative, and the account-settings top-menu control.
- If the verification digits have no stable semantic locator, keep the documented CSS fallback and locator-policy exception inside the Page Object only.

## Generated Test Requirements

- Must import from `fixtures/test`.
- Must use `test.step` and generate exactly one primary test in single-test mode.
- Must generate only the one primary single-mode test for this request and must not generate an optional `NEG-001` test.
- Must use a PsychicBook Page Object or Component Object for all locators and user actions.
- Must declare the exact metadata tags through the Playwright `{ tag: [...] }` option.
- Must obtain the returning-user identity through `requireStandardUserEmail()`; the framework consumes the base URL and browser challenge configuration, and the Page Object accepts the deterministic code string `1234`.
- Must not commit real credentials, an email address, or authentication state.
- Must place `expect(...)` only in the final assertion step.
- Must title that final step `Assert AC-004: account-settings control is visible` and assert only the visible account-settings top-menu control.
- Must not use hard waits, XPath, focused tests, skipped tests, or direct Playwright locators in the generated test body.

## Notes

- The framework supplies HTTP Basic credentials through Playwright configuration when both Basic-auth environment variables are present.
- This generated contract is validated statically; it does not claim a live external execution.
