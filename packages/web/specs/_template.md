# Flow: <flow name>

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-001 |
| Spec Version | 1.0.0 |
| Owner | qa@example.com |
| Priority | P0 |
| Test Type | smoke/regression/accessibility/visual |
| Auth | none/required/optional |
| Target Test File | tests/regression/your-flow-name.spec.ts |
| Base Path | / |
| Tags | @generated @regression |
| Generation Mode | single |
| Generation Source | manual |
| Generation Status | pending-generation |

Notes on metadata:

- `Generation Mode` is optional: `single` (default) or `suite`. Review and gate resolve the mode from this row; a contradicting `--mode` flag is a hard error.
- Generation is authorized by deterministic spec validation and machine policy gates; no interactive sign-off metadata is required.
- If `Auth` is `required`, the `Target Test File` must end in `.authenticated.spec.ts` so it runs in the `chromium-auth` project (non-auth browser projects ignore that pattern).
- `Tags` must be declared exactly (set equality) on the generated test or describe block via the Playwright `{ tag: [...] }` option.

## User Story

As a <user>,
I want to <action>,
So that <business value>.

## Preconditions

- ...

## Out-of-scope

- ...

## Stability Requirements

| Field | Value |
|---|---|
| Parallel Safe | yes/no |
| Data Isolation | per-test/shared/external |
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
| RULE-001 | Primary business rule to verify | User action produces the expected visible result | User-visible outcome is asserted |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | email=test@example.com | Confirmation is visible | Primary deterministic case |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "email": "test@example.com"
    },
    "expected": {
      "result": "Confirmation is visible"
    },
    "notes": "Primary deterministic case"
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| email | test@example.com | fake user only |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| ... | ... | ... |

## Mocks as JSON

```json
[
  {
    "method": "POST",
    "url": "/api/orders",
    "status": 201,
    "body": {
      "requestId": "REQ-MOCKED-9999"
    }
  }
]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Open page | /checkout | n/a | Checkout page is visible | heading is visible |
| 2 | AC-002 | Fill email | Email field | test@example.com | Email is accepted | field has value |
| 3 | AC-003, AC-004 | Submit form | Submit button | n/a | Confirmation is shown | confirmation heading visible |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | Missing required email | Error message is visible |

## Acceptance Criteria

- AC-001: The user can open the flow entry page.
- AC-002: The user can complete the primary action.
- AC-003: The user sees a clear confirmation.
- AC-004: The final state contains a user-visible business result.

## Locator Hints

- Prefer Page Object or Component Object locators using `this.page.getByTestId(...)` when a meaningful `data-testid` exists and is stable.
- Prefer role/name locators when no stable `data-testid` exists.
- Prefer labels for form fields.
- Use placeholder locators only when no label exists.
- Use visible text locators only for stable visible copy.

## Generated Test Requirements

- Must import from fixtures/test.
- Must use test.step.
- Must use Page Objects or Component Objects for all locators.
- Must not create direct `page.getBy*` or `page.locator(...)` locators in the generated test body.
- Default generation mode is single-test mode; the optional `Generation Mode` metadata row overrides it.
- Generate a suite only when the spec declares `Generation Mode | suite` or a suite is explicitly requested.
- In single-test mode, must generate exactly one primary requested-scenario test with one primary final assertion step, plus optionally one test per spec `NEG-###` case.
- The single-mode primary test must declare a `covered-ac-ids` annotation (`test.info().annotations.push({ type: 'covered-ac-ids', description: 'AC-### ...' })`) whose set equals the AC ids named in its step titles.
- In the single-mode primary test, every `test.step` title must carry at least one `AC-###` token.
- Must declare the spec metadata `Tags` exactly via the Playwright `{ tag: [...] }` option.
- In suite mode, must split broad flows into focused tests that verify one functionality or business outcome.
- Must put `expect(...)` only in the final assertion step for each test.
- Must title assertion steps `Assert AC-###: ...` or `Assert NEG-###: ...`.
- Must include meaningful expect assertions for user-visible behavior.
- In suite mode, must cover every AC ID from this spec with a final assertion step; NEG coverage is required in suite mode and a non-blocking warning in single mode.
- Default generated-test execution target is Chromium only.
- Cross-browser generated-test execution is opt-in.
- Must not use page.waitForTimeout.
- Must not use XPath.
- Must not use test.only.
- Must not silently skip: `test.skip`, `test.fixme`, and `test.fail` are forbidden in all forms, including runtime calls inside test bodies.
- Must not use real credentials.
- Must not commit auth state.

## Notes

- ...
