# Flow: Golden checkout single flow

## Metadata

| Field | Value |
|---|---|
| Flow ID | EVAL-SINGLE-001 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | none |
| Target Test File | tests/regression/eval-single-checkout.spec.ts |
| Base Path | /checkout |
| Tags | @generated @regression |
| Generation Status | generated |
| Generation Mode | single |

## User Story

As a shopper,
I want to submit a checkout form,
So that I receive a confirmation.

## Preconditions

- Checkout page is available.

## Out-of-scope

- Payment processing.

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
| RULE-001 | Checkout request returns a visible confirmation | Submitting the checkout form returns a request ID | Confirmation is visible |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | email=test@example.com | Confirmation visible | Primary case |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "email": "test@example.com"
    },
    "expected": {
      "requestId": "REQ-1001",
      "result": "Confirmation visible"
    },
    "notes": "Primary case"
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
| /checkout | Open page | HTML form |

## Mocks as JSON

```json
[
  {
    "method": "POST",
    "url": "/api/orders",
    "status": 201,
    "body": {
      "requestId": "REQ-1001"
    }
  }
]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Open page | /checkout | n/a | Checkout page is visible | heading is visible |
| 2 | AC-002 | Fill email | Email field | test@example.com | Email accepted | field has value |
| 3 | AC-003 | Submit | Submit button | n/a | Confirmation visible | heading visible |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | Missing email | Error visible |

## Acceptance Criteria

- AC-001: Checkout entry page is visible.
- AC-002: User can fill required contact fields.
- AC-003: User can submit the order request.

## Locator Hints

- Prefer `getByRole('heading', { name: 'Checkout' })` for the page heading.
- Prefer `getByRole('button', { name: 'Place order request' })` for submission.

## Generated Test Requirements

- Must import from fixtures/test.
- Must use test.step.
- Must use semantic locators.
- Must include meaningful expect assertions.
- In single-test mode, must generate one requested-scenario test with one primary final assertion step.
- Must annotate or comment AC coverage.
- Must not use page.waitForTimeout.
- Must not use XPath.
- Must not use test.only.
- Must not silently skip.
- Must not use real credentials.
- Must not commit auth state.

## Notes

- Offline deterministic golden-evaluation fixture.
