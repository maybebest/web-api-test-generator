# Flow: Isolate two parallel Nectar AI conversations

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-029 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P0 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/sains/parallel-conversation-isolation.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @isolation |
| Generation Mode | single |
| Review Status | pending-review |
| Review Sign-off | pending |
| Generation Source | curated-e2e-gap |
| Generation Status | generated |

## User Story

As a media planner working in two tabs,
I want each Nectar AI conversation to keep its own plan state,
So that alternating work cannot leak or delete another plan.

## Preconditions

- A valid non-production authenticated Playwright storage state is available.
- The same authorised planner may open two tabs in one browser context.
- `E2E_ALLOW_PERSISTENT_TEST_DATA=true` explicitly acknowledges that two conversation shells remain because the live schema has no session-delete operation.
- The dev advertiser, brand, `knorr` products and `Meta` channel are available.
- The assistant accepts and preserves the canonical dev objective labels `Increase sales & conversions` and `Customer acquisition`; arbitrary marker suffixes are deliberately not used because the live assistant normalizes them away.

## Out-of-scope

- Cross-user role isolation requires a second independently authorised storage state and remains a separate precondition.
- Conversation-shell deletion cannot be asserted until the backend exposes a delete/archive operation.
- Production accounts and data are prohibited.

## Stability Requirements

| Field | Value |
|---|---|
| Parallel Safe | no |
| Data Isolation | external |
| Allowed Retries | 0 |

## Variants

| Locale | Role | Plan |
|---|---|---|
| en-GB | same planner in two tabs | two owned drafts |

## Includes

- none

## Business Rules

| Rule ID | Rule | Formula | Blocking Behavior |
|---|---|---|---|
| RULE-001 | Session and plan identity is unique per conversation | alpha.sessionId != bravo.sessionId and alpha.planId != bravo.planId | Shared identity causes cross-tab corruption |
| RULE-002 | State is isolated after alternating writes and reload | each UI/API state contains its own supported objective and excludes the other supported objective | Any cross-leak is a critical data-isolation defect |
| RULE-003 | Cleanup is ownership-scoped | discard alpha => bravo still readable; then discard bravo => neither plan readable | One cleanup must never delete another plan |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | TC-ACC-005; tabs Alpha and Bravo with distinct supported objectives; discard Alpha, read Bravo, then discard Bravo | Distinct session/plan IDs, same authenticated owner, isolated UI/API state after reload; Bravo survives Alpha cleanup and both owned plans are unreadable after their own discard | Same-user two-tab variant; conversation shells remain |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": { "catalogueId": "TC-ACC-005", "tabs": 2, "objectives": ["Increase sales & conversions", "Customer acquisition"] },
    "expected": { "uniqueSessionIds": true, "uniquePlanIds": true, "sameOwner": true, "crossLeak": false, "bravoSurvivesAlpha": true, "alphaPlanReadable": false, "bravoPlanReadable": false },
    "notes": "Alternates the identity and objective stages between two pages, reloads both, then uses the UI discard path for ownership-scoped plan cleanup."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| alphaObjective | Increase sales & conversions | Canonical product objective and Alpha state marker |
| bravoObjective | Customer acquisition | Canonical product objective and Bravo state marker |
| advertiser | N360_Unilever_MS | Non-production advertiser |
| brand | Unilever \| Knorr \| MS | Non-production brand |
| productSearch | knorr | Cleanup journey product |
| channel | Meta | Cleanup journey channel |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | Live authenticated development environment | [] |

## Mocks as JSON

```json
[]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Open two tabs and alternate advertiser/brand and objective stages | Nectar AI | distinct supported objectives | Unique session and plan IDs owned by the same planner | compare API identifiers and owner IDs |
| 2 | AC-001 | Reload both session URLs and query chat history/plan reads | UI + API | both IDs | Each state contains only its own selected objective | positive and negative containment |
| 3 | AC-002 | Finish/discard Alpha, prove Bravo survives, then finish/discard Bravo | UI discard + plan read | alpha then bravo | Cleanup affects only its owned plan | cross-plan survival then unreadable plans |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | The explicit persistent-shell consent flag is absent | Test fails before creating either conversation instead of silently leaking data |

## Acceptance Criteria

- AC-001: Alpha and Bravo have distinct non-empty session and plan identifiers under the same non-empty owner, and after reload each UI/API state contains only its own objective marker.
- AC-002: Discarding Alpha leaves Bravo readable, then discarding Bravo makes both owned plans unreadable while the two undeletable conversation shells are reported explicitly.

## Locator Hints

- Compose two `PlanningPage` instances inside `ParallelConversationIsolationComponent`.
- Capture session IDs from `/planning/nectar-ai/<sessionId>` URLs, never visible conversation titles.
- Use `PlanningPage.summaryObjective()` for UI isolation and API chat-history state for durable isolation.
- Use the documented discard confirmation UI for owned-plan cleanup.

## Generated Test Requirements

- Must import from fixtures/test and use test.step.
- Must keep all locators in Page/Component Objects.
- Must use single mode with exactly one primary DC-001 test, add a `covered-ac-ids` annotation for AC-001 and AC-002, name one covered AC in every primary test step, and put expect calls only in the final assertion step.
- Must declare metadata Tags exactly and map TC-ACC-005 in the title.
- Must fail closed before mutation unless `E2E_ALLOW_PERSISTENT_TEST_DATA=true`.
- Must attempt owned-plan cleanup before the final assertions so an isolation assertion cannot prevent teardown.
- Must not use fixed page sleeps, test.skip, test.fixme, test.fail, XPath or networkidle.
- Must not print session IDs, owner IDs, tokens, request bodies or storage state.

## Notes

- This is meaningful partial coverage of TC-ACC-005: the same-user/two-tab isolation and plan cleanup variant is automated.
- Full canonical coverage still needs a second role-qualified auth state and a verified conversation delete/archive contract.
