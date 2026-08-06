# Flow: PsychicBook generated-test healing experiment

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-PSY-HEAL-001 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | none |
| Target Test File | tests/regression/psychicbook-healing-experiment.spec.ts |
| Base Path | / |
| Tags | @generated @regression @psychicbook @healing-experiment |
| Generation Mode | single |
| Generation Source | manual |
| Generation Status | pending-generation |

## User Story

As a returning PsychicBook user,
I want to sign in with my environment-provided email and deterministic verification code,
So that I can see the account-settings control in the authenticated top menu.

## Preconditions

- `PLAYWRIGHT_TEST_BASE_URL` identifies the reviewed non-production PsychicBook environment.
- `E2E_HTTP_BASIC_USERNAME` and `E2E_HTTP_BASIC_PASSWORD` supply the browser-level HTTP Basic challenge at runtime.
- `PSYCHICBOOK_E2E_EMAIL` identifies a returning non-production user that can complete the email-verification journey without onboarding.
- The deterministic verification code `1234` is accepted for the returning user.

## Out-of-scope

- Production environments, real email delivery, social login, phone login, first-time onboarding, profile changes, and account-settings-page behavior.
- Committed HTTP Basic values, a committed user identity, browser authentication state, and healer promotion through `--apply`.

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
|---|---|---|---|
| RULE-001 | Authentication uses runtime browser configuration and identity plus the deterministic stage verification code. | runtime base URL + HTTP Basic + runtime email + `1234` | Missing runtime configuration blocks the external flow. |
| RULE-002 | A verified returning user exposes the account-settings control in the authenticated top menu. | verified returning user => visible account-settings control | Absence of the control fails the final business assertion. |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | Runtime base URL, HTTP Basic values, `PSYCHICBOOK_E2E_EMAIL`, and verification code `1234` | The authenticated top menu exposes the account-settings control | Positive returning-user path used for the controlled healing experiment |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "baseUrlEnv": "PLAYWRIGHT_TEST_BASE_URL",
      "httpBasicUsernameEnv": "E2E_HTTP_BASIC_USERNAME",
      "httpBasicPasswordEnv": "E2E_HTTP_BASIC_PASSWORD",
      "emailEnv": "PSYCHICBOOK_E2E_EMAIL",
      "verificationCode": "1234"
    },
    "expected": {
      "authenticatedTopMenu": true,
      "accountSettingsControlVisible": true
    },
    "notes": "All live values remain outside the generated source and generation artifacts."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| baseUrl | PLAYWRIGHT_TEST_BASE_URL | Non-production PsychicBook base URL supplied at runtime |
| httpBasicUsername | E2E_HTTP_BASIC_USERNAME | Browser-challenge username supplied at runtime |
| httpBasicPassword | E2E_HTTP_BASIC_PASSWORD | Browser-challenge password supplied at runtime |
| email | PSYCHICBOOK_E2E_EMAIL | Returning-user identity supplied at runtime |
| verificationCode | 1234 | Deterministic stage verification value |

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
| 2 | AC-002 | Activate Get Started | Get Started link | none | The email-entry screen opens | Use role `link` with accessible name `Get Started` |
| 3 | AC-002 | Enter the returning-user email | Email textbox | PSYCHICBOOK_E2E_EMAIL | The field receives the runtime email | Use role `textbox` with an email accessible name |
| 4 | AC-002 | Continue from email entry | Continue button | none | The verification method screen opens | Use role `button` with accessible name `Continue` |
| 5 | AC-003 | Choose direct verification-code entry | Have a verification code instead button | none | Four verification digit inputs become available | Use role `button` with name matching `have a verification code` case-insensitively |
| 6 | AC-003 | Enter the verification code | Four anonymous numeric inputs | 1234 | The deterministic value is submitted and the authenticated experience opens | Fill `input[inputmode="numeric"][maxlength="1"]` in rendered order inside the Page Object only |
| 7 | AC-004 | Inspect the authenticated top menu | Returning-user account avatar button | none | The account-settings icon is visible | Final assertion only: within the `banner`, button named exactly `T` for the reviewed returning user |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | A rejected verification value is entered | The user remains on verification entry and the account-settings control is not shown. |

## Acceptance Criteria

- AC-001: The landing page opens through the environment-provided browser challenge configuration.
- AC-002: Get Started opens email entry and Continue accepts `PSYCHICBOOK_E2E_EMAIL`.
- AC-003: The user chooses direct code entry and submits `1234` through the four digit inputs.
- AC-004: The authenticated top menu exposes a visible account-settings control.

## Locator Hints

- Define a focused `PsychicBookHealingExperimentPage` class inline in the generated test file; do not import or modify an existing Page Object.
- Keep every Playwright locator inside that inline Page Object so the single-file healer owns the deliberately broken locator.
- Import the Playwright `Locator` and `Page` types, type the inline Page Object with them, and instantiate it as `psychicBookPage` so the deterministic reviewer recognizes its user-level method and locator calls.
- Use `page.getByRole('link', { name: 'Get Started' })` for the Get Started control; this is the locator that the experiment will later break and heal.
- Use role/name locators for Email, Continue, the verification-code alternative, and the account-settings control.
- The reviewed authenticated accessibility snapshot exposes the top-menu account-settings icon as `button "T"` inside the `banner`; define it with `page.getByRole('banner').getByRole('button', { name: 'T', exact: true })`.
- The reviewed verification digits are anonymous numeric inputs. A raw CSS locator is permitted only inside the inline Page Object with the immediately preceding comment `// locator-policy:exception the reviewed verification fields are anonymous numeric inputs without semantic names`.
- Filling the fourth digit submits the deterministic code; do not add a hard wait or an unrequested submission control.

## Generated Test Requirements

- Must import `test` and `expect` from `../../fixtures/test`.
- Must import `requirePsychicBookEmail` from `../../data/psychicbook` and call that reviewed helper to obtain the runtime email; direct `process` or `process.env` access is forbidden in generated source.
- Must define `PsychicBookHealingExperimentPage` inline in this generated file and must not import `PsychicBookLoginPage` or any other Page Object.
- Must import `Locator` and `Page` types from `@playwright/test`, declare locator members as `Locator`, type the constructor page as `Page`, and instantiate the Page Object with the exact local name `psychicBookPage`.
- Must generate exactly one primary test and no optional `NEG-001` test.
- Must declare the exact metadata tags through Playwright's `{ tag: [...] }` option.
- Must use `test.describe.serial` and `test.step`.
- Inside the primary test callback, before the first `test.step`, must declare the AC annotation with exactly `test.info().annotations.push({ type: 'covered-ac-ids', description: 'AC-001 AC-002 AC-003 AC-004' });`.
- Must not declare `covered-ac-ids` through the test options object's `annotation` property; the deterministic reviewer accepts only the required `test.info().annotations.push(...)` call inside the test callback.
- Must obtain the email at runtime only by calling `requirePsychicBookEmail()`; the reviewed helper owns the missing-value error.
- Must not read or embed the runtime base URL or HTTP Basic values; Playwright configuration owns those values.
- Must validate that the verification code contains exactly four ASCII digits before filling the four rendered numeric inputs in order.
- Must place `expect(...)` only in the final step titled `Assert AC-004: account-settings control is visible`.
- Must assert only that the reviewed top-menu account avatar button `T` is visible.
- Must not use XPath, hard waits, focused/skipped tests, committed authentication state, or direct Playwright locators in the test body.

## Notes

- This is an isolated, uncommitted experiment target for exercising generation, controlled locator failure, and proposal-only healing.
- The framework supplies HTTP Basic credentials through Playwright configuration when both runtime variables are present.
