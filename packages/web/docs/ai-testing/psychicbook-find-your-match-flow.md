# Flow: PsychicBook returning-user login and find-your-match question

> **Documentation, not a gated spec.** This flow targets the live
> `https://user.stage.psychicbook.net` environment, so it does not live in
> `specs/` (the spec→gate pipeline runs against the bundled demo app). It is the
> contract and DOM-discovery record for the staging e2e test at
> `tests/staging/psychicbook-find-your-match.spec.ts`, which runs under the
> opt-in `staging` Playwright project (`npm run test:e2e:staging`).

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MATCH-001 |
| Doc Version | 1.0.2 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | staging e2e |
| Auth | none (the flow performs login itself) |
| Target Test File | tests/staging/psychicbook-find-your-match.spec.ts |
| Target Environment | https://user.stage.psychicbook.net (HTTP basic auth via env) |
| Base Path | / |

## User Story

As a returning PsychicBook user,
I want to log in with my email and a verification code and ask a match question from the home page,
So that I am matched with the right psychic advisor.

## Preconditions

- Target: the live `https://user.stage.psychicbook.net` environment. Run with `npm run test:e2e:staging` (sets `E2E_STAGING_ENABLED=true` and the base URL). The staging host sits behind HTTP basic auth (the browser "system login" prompt); credentials are supplied only via the `E2E_HTTP_BASIC_USERNAME` / `E2E_HTTP_BASIC_PASSWORD` environment variables (never committed).
- The environment accepts the deterministic verification code `1234` for the test email.
- The test email belongs to a returning user, so no first-time profile step appears after verification.
- The staging site shows a cookie-consent banner on first visit; the flow dismisses it when present so it cannot intercept clicks.

## Out-of-scope

- Real email delivery and reading the emailed login link (the flow always switches to verification-code entry).
- Social logins (Apple, Google, Phone).
- First-time user onboarding (profile details step).
- The advisor-matching result content shown after the Psychic Match page loads (matching dialog outcome, advisor chat).
- Production authentication.
- Persisting authenticated storage state.

## Stability Requirements

| Field | Value |
|---|---|
| Parallel Safe | no |
| Data Isolation | shared |
| Allowed Retries | 0 |

## Variants

Variant columns are project-configurable in `ai/config.json`. The default axes are:

| Locale | Role | Plan |
|---|---|---|
| en-US | guest | standard |

## Includes

- none

## Business Rules

| Rule ID | Rule | Formula | Blocking Behavior |
|---|---|---|---|
| RULE-001 | A returning user authenticates with email plus verification code `1234` | email + code `1234` submitted on the Verify your Email screen | Authentication completes and the psychics experience is shown |
| RULE-002 | Only the correct verification code completes authentication | any code other than `1234` | User stays on the Verify your Email screen and is not redirected |
| RULE-003 | A match question submitted from the home page opens the Psychic Match page | non-empty question + Get the answer | The Psychic Match page loads at `/match-advisor/` with the "Psychic Match" breadcrumb |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | email=den.muzya@gmail.com; code=1234; question=Birthday | Psychic Match page loads at `/match-advisor/` with the "Psychic Match" breadcrumb visible | Primary deterministic returning-user case |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "url": "/",
      "email": "den.muzya@gmail.com",
      "verificationCode": "1234",
      "question": "Birthday"
    },
    "expected": {
      "successPath": "/match-advisor/",
      "pageBreadcrumb": "Psychic Match",
      "result": "The Psychic Match page loads after the question is submitted"
    },
    "notes": "Code 1234 is the deterministic verification code for the test email; the user is a returning user with no profile step."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| email | den.muzya@gmail.com | returning-user staging test mailbox supplied by the QA owner |
| verificationCode | 1234 | deterministic environment test code |
| question | Birthday | match question typed into the find-your-match text area |
| wrongVerificationCode | 9999 | NEG-001: any code other than 1234 keeps the user on the Verify your Email screen |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | Live UI flow against the staging environment | none |

## Mocks as JSON

```json
[]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Open landing page | / | n/a | Landing page is visible with a Get Started entry | Get Started link is visible |
| 2 | AC-002 | Click Get Started | Get Started link | n/a | Signup screen with email entry appears | email input is visible |
| 3 | AC-002 | Submit email | Email field and Continue button | den.muzya@gmail.com | Login-link screen appears with a verification-code alternative | Have a verification code button is visible |
| 4 | AC-003 | Switch to verification code entry | "Have a verification code instead?" button | n/a | Verify your Email screen shows the 4-digit code inputs | code inputs are visible |
| 5 | AC-003, AC-004 | Enter verification code | 4-digit code inputs | 1234 | Authentication completes and the psychics experience loads | psychics page is shown |
| 6 | AC-005 | Go to home | Home link | n/a | Home page loads with the find-your-match widget available | match question text area is reachable |
| 7 | AC-005 | Type the match question | Find-your-match text area | Birthday | Question is accepted and submission is enabled | Get the answer button is enabled |
| 8 | AC-006 | Submit the match question | Get the answer button | n/a | A new page loads: Psychic Match at /match-advisor/ | URL is /match-advisor/ and the "Psychic Match" breadcrumb is visible |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | An incorrect verification code (9999) is entered | The user stays on the Verify your Email screen and is not redirected to the psychics experience |

## Acceptance Criteria

- AC-001: The landing page is visible from `/` with a Get Started entry.
- AC-002: Get Started leads to signup, and the submitted email reaches the login-link screen offering a verification-code alternative.
- AC-003: The user can switch to verification-code entry and enter code `1234`.
- AC-004: Completing the code authenticates the returning user and shows the psychics experience.
- AC-005: From the psychics experience, the Home link leads to the home page where the find-your-match question can be typed.
- AC-006: Submitting the question loads a new page — the Psychic Match page at `/match-advisor/`, identified by the visible "Psychic Match" breadcrumb.

## Locator Hints

- The staging UI exposes no `data-testid` attributes (verified by DOM discovery); prefer role/name, label, and placeholder locators owned by Page Objects.
- Get Started entry: role link with accessible name matching "Get Started".
- Email field: role textbox with accessible name matching "email" (staging uses placeholder "Enter your email"); submit via role button "Continue".
- Verification-code alternative: role button with name matching "have a verification code".
- Code inputs: four anonymous single-digit inputs (`inputmode="numeric"`, `maxlength="1"`) with no accessible name, label, or placeholder; a CSS fallback with a locator-policy exception comment and positional digit picks is required. Entering the 4th digit submits automatically.
- Home link: role link named "Home" on the psychics page.
- Match question: role textbox with accessible name "Type your question here…" (the name comes from the placeholder; a hidden chat-composer input shares the same placeholder text, so a placeholder locator is ambiguous while the role locator only matches the visible widget). Submit via role button "Get the answer" (disabled until a question is typed).
- Outcome ("new page loaded"): URL `/match-advisor/` plus the visible "Psychic Match" breadcrumb. Do not assert the "Find your match with a Psychic Expert" heading — it is a transient pre-matching title that the real environment hides behind a "Matching you…" modal and then replaces with a "Meet Your Psychic Match" result heading; the breadcrumb is the only signal stable across the whole lifecycle (exactly one visible element throughout).

## Generated Test Requirements

- Must import from fixtures/test.
- Must use test.step.
- Must use Page Objects or Component Objects for all locators.
- Must not create direct `page.getBy*` or `page.locator(...)` locators in the generated test body.
- Default generation mode is single-test mode; the optional `Generation Mode` metadata row overrides it.
- Generate a suite only when the spec declares `Generation Mode | suite` or a suite is explicitly requested.
- In single-test mode, must generate exactly one primary requested-scenario test with one primary final assertion step, plus optionally one test per spec `NEG-###` case.
- The single-mode primary test must declare a `covered-ac-ids` annotation whose set equals the AC ids named in its step titles.
- In the single-mode primary test, every `test.step` title must carry at least one `AC-###` token.
- Must declare the spec metadata `Tags` exactly via the Playwright `{ tag: [...] }` option.
- Must put `expect(...)` only in the final assertion step for each test.
- Must title assertion steps `Assert AC-###: ...` or `Assert NEG-###: ...`.
- Must include meaningful expect assertions for user-visible behavior.
- Must enumerate every Data Cases as JSON case ID.
- Must assert the salient expected values /match-advisor/ and Psychic Match.
- Default generated-test execution target is Chromium only.
- Cross-browser generated-test execution is opt-in.
- Must not use page.waitForTimeout.
- Must not use XPath.
- Must not use test.only.
- Must not silently skip: `test.skip`, `test.fixme`, and `test.fail` are forbidden in all forms, including runtime calls inside test bodies.
- Must not commit HTTP basic auth credentials or auth state; staging credentials come from environment variables only.

## Notes

- DOM discovery evidence captured from `https://user.stage.psychicbook.net` on 2026-06-11 (ARIA snapshots, element inventories, screenshots under `.ai-runs/discovery-psychicbook/`, gitignored).
- The staging signup auto-submits when the 4th code digit is typed; there is no Continue button on the Verify your Email screen.
- An incorrect code outlines the digit inputs in red and keeps the user on the Verify your Email screen; no persistent inline error text was observed, so NEG-001 asserts only the user-visible outcome (still on Verify your Email, not redirected).
- Submitting the match question triggers a "Matching you with your advisor…" modal (~10s) that resolves to a "Meet Your Psychic Match" result page echoing the typed question. AC-006 deliberately asserts the page-identity signals that are stable from the moment the new page loads (URL `/match-advisor/` + "Psychic Match" breadcrumb) rather than waiting on the matching backend, keeping the test fast and deterministic. Timeline captured by discovery probes on 2026-06-11.
- The home-page find-your-match widget is lazy-hydrated on staging; the Page Object scrolls to reveal it before typing.
- Staging serves the authenticated home variant (which owns the "Match with advisor" / find-your-match widget) only on a full document load: after an in-session login, client-side navigation to Home keeps the unauthenticated home shell, which has no match widget at all (verified by discovery probes on 2026-06-11, including a reload A/B). The Page Object therefore reloads the document once after clicking Home.
- This test runs only against the live staging environment under the opt-in `staging` Playwright project; it is intentionally excluded from the demo-app gates and CI sweep (the bundled demo app is not modified to mirror this journey).
