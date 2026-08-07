# Flow: Recover safely from transient Nectar AI and product-search failures

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-031 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/sains/reliability-recovery.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @reliability |
| Generation Mode | suite |
| Review Status | pending-review |
| Review Sign-off | pending |
| Generation Source | curated-e2e-gap |
| Generation Status | generated |

## User Story

As a media planner,
I want transient assistant and product-search failures to be visible and safely retryable,
So that I neither lose work nor create duplicate planner state.

## Preconditions

- A valid non-production authenticated Playwright storage state is available.
- The advertiser `N360_Unilever_MS` and brand `Unilever | Knorr | MS` are available.
- Browser routing can intercept only the selected `planningAI_chat` GraphQL request for this page.
- The suite creates external dev conversations; the environment currently has no conversation-delete operation.

## Out-of-scope

- Autosave persistence failure is not represented by a separate browser request and cannot be claimed by this suite.
- A real downstream validation-service 4xx/5xx requires a run-scoped backend failure injector; the product-search row here covers the observable GraphQL transport boundary only.
- Production data, denial-of-service load, and broad network blocking are out of scope.

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
| RULE-001 | An assistant transport failure is explicit | injected planningAI_chat 503 => visible error + Retry + Cancel | A silent spinner or disabled composer strands the user |
| RULE-002 | Product-search failure is atomic | failed search => zero selected SKUs and retry affordance | Partial or duplicate SKU state corrupts the plan |
| RULE-003 | A user retry is once-effective | one failed request + one user retry => one successful next state | Automatic duplicate mutations are unsafe |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | EXT-AI-RETRY-001; first objective-flow planningAI_chat returns 503 | Error, Retry and Cancel are visible; no advertiser state is committed | Explicit recovery contract |
| DC-002 | EXT-DEPENDENCY-001 subset; product search `knorr` returns 503 | Error and Retry are visible; zero Measurement SKUs remain selected | Browser-observable dependency boundary |
| DC-003 | EXT-AI-RETRY-001; one failure followed by user Retry | Exactly two matched calls occur and the advertiser/brand panel renders once | Once-effective retry |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": { "catalogueId": "EXT-AI-RETRY-001", "status": 503, "failures": 1 },
    "expected": { "error": "visible", "retry": "visible", "cancel": "visible", "committedState": "none" },
    "notes": "The assertion starts immediately after the one run-scoped failure; an automatic retry must not erase the required user-visible choice."
  },
  {
    "caseId": "DC-002",
    "inputs": { "catalogueId": "EXT-DEPENDENCY-001", "message": "knorr", "status": 503, "failures": 1 },
    "expected": { "error": "visible", "retry": "visible", "measurementSkuCount": 0 },
    "notes": "This is partial dependency coverage because a service-internal failure injector is not exposed."
  },
  {
    "caseId": "DC-003",
    "inputs": { "catalogueId": "EXT-AI-RETRY-001", "status": 503, "failures": 1, "action": "Retry" },
    "expected": { "matchedCalls": 2, "advertiserPanelCount": 1 },
    "notes": "Fails if the application silently auto-retries instead of offering the documented user choice."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| advertiser | N360_Unilever_MS | Non-production advertiser |
| brand | Unilever \| Knorr \| MS | Non-production brand |
| objective | Customer retention | Reaches product search |
| productSearch | knorr | Exact intercepted chat message |
| injectedStatus | 503 | Run-scoped response, never sent to backend |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| browser fault controller | Only the selected planningAI_chat document/message is fulfilled by `ReliabilityRecoveryComponent`; all other traffic continues untouched | HTTP 503 GraphQL error for the configured first N calls |

## Mocks as JSON

```json
[]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Inject one failure and start objective-based planning | planningAI_chat | HTTP 503 | Explicit error with Retry and Cancel; advertiser panel absent | alert and accessible buttons visible |
| 2 | AC-002 | Build to product search and inject one failure for `knorr` | planningAI_chat | knorr | Explicit error, Retry and zero committed Measurement SKUs | summary count remains zero |
| 3 | AC-003 | Inject one failure then activate Retry | recovery action | Retry | One successful state transition after exactly two matched calls | panel count=1 and counters exact |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | Install a message-scoped fault, then load the Planning landing page without sending that message | Non-target GraphQL traffic continues untouched, the Planning entry renders, and the matched-call count remains zero |

## Acceptance Criteria

- AC-001: A transient assistant failure produces an accessible visible error with Retry and Cancel and commits no advertiser state.
- AC-002: A failed product search produces an accessible visible error with Retry and leaves zero Measurement SKUs selected.
- AC-003: Activating Retry after one injected failure results in exactly one successful transition and no duplicate panel or request.

## Locator Hints

- Keep fault matching in `ReliabilityRecoveryComponent` and match both the `op` query parameter and request variables.
- Prefer role `alert` or documented visible failure copy for the error surface.
- Use accessible role/name locators for Retry and Cancel.
- Use `PlanningPage.advertiserBrandPanel()` and `PlanningPage.campaignSkusCount()` for state assertions.

## Generated Test Requirements

- Must import from fixtures/test and use test.step.
- Must keep all locators and route interception in Page/Component Objects.
- Must enumerate DC-001, DC-002 and DC-003 in focused test titles.
- Must put expect calls only in each test's final assertion step.
- Must declare the metadata Tags exactly.
- Must not use fixed sleeps, test.skip, test.fixme, test.fail, XPath or networkidle.
- Must not log request bodies, tokens, storage state or user data.
- Must not intercept any GraphQL operation or message beyond the declared target.

## Notes

- Maps the browser-automatable portions of `EXT-AI-RETRY-001` and `EXT-DEPENDENCY-001` from the curated workbook.
- `EXT-AUTOSAVE-001` still requires a backend autosave-failure injector plus persisted revision readback; declaring a generic planningAI_chat failure as autosave coverage would be false.
- Live reconnaissance on 2026-07-13 observed a silent automatic retry after the first 503; these tests intentionally encode the required user-visible behavior and may expose a product defect.
