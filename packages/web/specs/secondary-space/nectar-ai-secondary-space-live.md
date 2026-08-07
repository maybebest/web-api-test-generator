# Flow: Nectar AI Secondary Space live configuration, selection, editing, and persistence

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-SEC-001 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P0 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/secondary-space/nectar-ai-secondary-space-live.authenticated.spec.ts |
| Base Path | /planning/nectar-ai |
| Tags | @generated @regression @secondary-space @authenticated |
| Generation Mode | suite |
| Review Status | pending-review |
| Review Sign-off | pending |
| Generation Source | coverage-gap-analysis |
| Generation Status | generated |

## User Story

As an authenticated internal media planner,
I want Base-linked Secondary Space elements to be selected, edited, and restored accurately,
So that the plan carries the required physical element quantities without silently losing or changing them.

## Preconditions

- A valid non-production authenticated Playwright storage state is supplied through `E2E_AUTH_STATE_PATH`.
- `PLAYWRIGHT_TEST_BASE_URL` points to the reviewed Pollen development environment.
- The authenticated account is an internal user with access to `admin_getEveryMedia` and the two named read-only fixture channels.
- The externally visible channel defaults to `e2e-do-not-update-piggyback`; it can be overridden with `E2E_SECONDARY_SPACE_PUBLIC_CHANNEL`.
- The internal-only channel defaults to `OK_SecondSpace_BarkerEar`; it can be overridden with `E2E_SECONDARY_SPACE_INTERNAL_CHANNEL`.
- Both channels are visible, in-store `SECONDARY_SPACE` media, link to a Base media record, and Base direct/cache lookups expose PiggyBack assets.
- The public fixture has exactly one mandatory and two optional elements; the generated UI expectations are deliberately pinned to this reviewed fixture shape.
- Plan-creating cases require the explicit opt-in `E2E_SECONDARY_SPACE_MUTATION_ENABLED=true`.
- The default advertiser `N360_Unilever_MS`, brand `Unilever | Persil | MS`, and product search `persil` remain available to this account. They can be overridden through the matching `E2E_SECONDARY_SPACE_*` variables.
- A read-only preflight requires the chosen brand's `availableChannels` to contain `INSTORE` before creating a plan. The previously used `Unilever | Knorr | MS` fixture is intentionally rejected because the live catalogue exposes only offsite/onsite channel codes for that brand.
- A read-only `planning_getCycles` preflight supplies a numeric Group 2 cycle starting at least 60 days in the future; its exact start/end dates, cycle number, and food group are sent together so stale hard-coded cycles and booking-deadline violations cannot invalidate the plan fixture.
- Every mutating case creates a new session and generated plan identity, records its local start time, deletes only the plan belonging to that newly created session, and verifies that the deleted plan is no longer readable.
- The tested backend has no conversation-delete operation. Cleanup deletes the business plan; the non-sensitive planning conversation/session record can remain in development history.

## Out-of-scope

- The external-user half of TC-SEC-002. No fresh external-role storage state was provided, so this suite proves the internal account's view and the fixture metadata but cannot prove that an external user is denied the internal-only fixture.
- TC-SEC-003 mixed-channel input in one message. No reviewed pair of deterministic Secondary Space and non-Secondary-Space fixtures, prompt grammar, or expected sequential rendering contract is available.
- The architectural authority/fallback decision behind TC-SEC-001. The suite compares the direct and cached Base responses; it does not decide which source should win if Pollen and Base disagree.
- TC-SEC-006 post-save locking and injected update failures. The suite proves the supported pre-save Edit Channel path, but no approved lock point or safe failure-injection mechanism exists.
- TC-SEC-007 booking/CRM hand-off. No approved `BookingPiggyBackAssets` request schema, non-production booking stub, or reversible booking cleanup contract was supplied.
- Feature-flag removal in deployed bundles. The current application source still references `FEATURE_SECONDARY_SPACE`; production-removal acceptance needs an agreed release/bundle inspection target.
- Human-only visual truncation quality, physical-device behavior, screen-reader announcements, and business approval of the element labels.

## Stability Requirements

| Field | Value |
|---|---|
| Parallel Safe | yes |
| Data Isolation | per-test |
| Allowed Retries | 0 |

## Variants

| Locale | Role | Plan |
|---|---|---|
| en-GB | internal authenticated planner | unique temporary development draft |

## Includes

- none

## Business Rules

| Rule ID | Rule | Formula | Blocking Behavior |
|---|---|---|---|
| RULE-001 | Direct and cached Base media resolve the same complete element contract | Linked Base ID equals both response IDs; sorted `(id, mandatory, name)` sets are equal; each fixture has a non-empty asset array whose names are non-empty | Missing, unnamed, mismatched, or cache-divergent elements block reliable Secondary Space rendering |
| RULE-002 | Visibility metadata reflects the fixture audience | Internal profile can read both fixtures; public fixture is `isVisible=true, isVisibleToInternalOnly=false`; internal fixture is `isVisible=true, isVisibleToInternalOnly=true` | Incorrect visibility metadata can expose internal media or hide valid public media |
| RULE-003 | Mandatory quantities are constrained and immutable after confirmation | Initial quantity is `1`; options are integers `1..10`; selected total follows quantity; confirmed control is disabled | Zero/out-of-range or mutable confirmed mandatory quantities produce an invalid plan |
| RULE-004 | Optional selection supports zero-state gating and bulk assignment | Initial optional quantities are `0`; zero disables Confirm but leaves Skip enabled; options are `0..10`; Assign all copies the source quantity to every optional element | A missing bulk action or an accepted zero total violates the optional-selection contract |
| RULE-005 | Optional edit preserves exact asset identity | Manually selected values hydrate in Edit Channel; changing the second value preserves the first asset and updates only the intended asset | A non-opening editor or an ID/quantity mismatch prevents safe correction |
| RULE-006 | Draft save and restoration preserve exact assets | A confirmed manual selection survives save and same-session reload as the same sorted `(asset id, quantity)` set | Lost or silently changed quantities corrupt the restored draft |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | Public and internal linked media; Base `fetchFromCache=false` and `true` | IDs and complete sorted PiggyBack asset contracts are equal for each fixture | TC-SEC-001 executable consistency subset; architectural fallback remains out of scope |
| DC-002 | Fresh internal auth profile; public and internal-only fixtures | Role is internal; public/internal visibility flags differ exactly as configured | TC-SEC-002 internal-account subset; external denial needs a second storage state |
| DC-003 | Public fixture mandatory element; quantity `1 -> 4 -> Confirm` | `1..10` options, totals `1 -> 4`, and confirmed select becomes disabled | TC-SEC-004 |
| DC-004 | Public fixture optional elements; `0 -> 3 + Assign all -> Confirm` | Zero-state gating is correct; Assign all produces optional quantities `3` and `3`, which persist in the plan | TC-SEC-005 bulk-assignment contract; remains independently red if the control is missing |
| DC-005 | Public fixture optional elements; manually select `3` and `3`; open Edit Channel and change the second optional to `5` | Edit hydration is exact; no Assign all exists in the modal; the saved edit contains optional `3` and `5` | Executable pre-save edit subset of TC-SEC-006, independent of Assign all |
| DC-006 | Public fixture optional elements; manually select and confirm `3` and `3`; save and reload the same session | The confirmed channel remains present with mandatory `1` and optional `3`, `3` after save and reload | Executable draft-persistence subset of TC-SEC-007, independent of the Edit Channel path |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": { "fixtures": ["public", "internal"], "fetchFromCache": [false, true] },
    "expected": { "linkedIdsMatch": true, "assetContractsEqual": true, "assetsNamed": true },
    "notes": "Executable TC-SEC-001 consistency subset; no fallback-source authority is inferred."
  },
  {
    "caseId": "DC-002",
    "inputs": { "role": "internal", "fixtures": ["public", "internal-only"] },
    "expected": { "publicVisible": true, "publicInternalOnly": false, "internalVisible": true, "internalInternalOnly": true },
    "notes": "External-user denial is not claimed without an external auth state."
  },
  {
    "caseId": "DC-003",
    "inputs": { "fixture": "public", "mandatoryQuantity": 4 },
    "expected": { "default": 1, "options": [1,2,3,4,5,6,7,8,9,10], "selectedTotal": 4, "locked": true },
    "notes": "A unique plan is deleted in finally."
  },
  {
    "caseId": "DC-004",
    "inputs": { "fixture": "public", "optionalBeforeEdit": [3,3], "optionalAfterEdit": [3,5] },
    "expected": { "zeroConfirmDisabled": true, "skipEnabled": true, "assignAllResult": [3,3] },
    "notes": "Covers the optional zero state and required Assign all behavior without hiding a missing control behind later persistence checks."
  },
  {
    "caseId": "DC-005",
    "inputs": { "fixture": "public", "optionalBeforeEdit": [3,3], "optionalAfterEdit": [3,5], "selectionMethod": "manual" },
    "expected": { "hydrated": [3,3], "afterEdit": [3,5], "modalAssignAllCount": 0 },
    "notes": "Covers pre-save edit independently of Assign all; post-save locking is not claimed."
  },
  {
    "caseId": "DC-006",
    "inputs": { "fixture": "public", "optionalQuantities": [3,3], "selectionMethod": "manual" },
    "expected": { "afterSave": [3,3], "afterReload": [3,3] },
    "notes": "Covers draft save and same-session restoration independently of Edit Channel; booking is not claimed."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| publicSecondarySpaceFixture | e2e-do-not-update-piggyback | Read-only media configuration; plan references it but does not edit it |
| internalSecondarySpaceFixture | OK_SecondSpace_BarkerEar | Read-only internal visibility/configuration probe |
| advertiser | N360_Unilever_MS | Existing dev fixture; env-overridable |
| brand | Unilever \| Persil \| MS | Live catalogue exposes `INSTORE`; env-overridable |
| objective | Customer retention | Accepted Nectar AI objective; arbitrary timestamped objectives are rejected by the live assistant |
| productSearch | persil | Selects the first returned dev SKU; env-overridable with the brand |
| campaignWindow | exact dates of the next numeric Group 2 cycle starting at least 60 days ahead | Read from `planning_getCycles`; satisfies the live booking deadline and avoids invalid cycle/food-group combinations |
| budget | £7,000 | Plan-local test value |
| storesAndCycle | 100 stores plus the cycle and Group 2 identifiers returned by preflight | Plan-local store count plus a current valid in-store cycle and food group |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | Authenticated development-environment integration/E2E checks use live responses | [] |

## Mocks as JSON

```json
[]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Read each Pollen media link and both Base variants | GraphQL media configuration | DC-001 | Both Base paths resolve the linked, complete element contract | Compare sorted typed snapshots |
| 2 | AC-002 | Read profile and fixture visibility metadata | GraphQL profile/media configuration | DC-002 | Internal user sees both and metadata distinguishes their audiences | Exact role/flag assertions |
| 3 | AC-003 | Build temporary plan, request public Secondary Space, change and confirm mandatory quantity | Nectar AI mandatory component | DC-003 | Default/options/total are correct and committed select locks | Page Object readings and disabled state |
| 4 | AC-004, NEG-001 | Confirm mandatory and inspect optional zero state | Nectar AI optional component | DC-004 | Confirm is disabled at total zero while Skip remains enabled | Button states and exact quantity list |
| 5 | AC-004 | Select `3`, Assign all, confirm, and read plan | Optional component and plan API | DC-004 | Both optional assets persist with quantity `3` | Asset-ID/quantity comparison |
| 6 | AC-005 | Manually select `3` for both optional elements, confirm, then change the second to `5` in Edit Channel | Optional component and Secondary Space edit section | DC-005 | Existing selections hydrate; edit UI has no unsupported Assign all action; saved edit is `3`, `5` | Scoped edit Page Object readings and plan API |
| 7 | AC-006 | In a separate plan manually confirm `3`, `3`, save the draft, restore the same session, and read the plan after each transition | Plan API and restored summary | DC-006 | Exact IDs and quantities remain `1`, `3`, and `3` | Compare snapshots before save and after reload |
| 8 | AC-003, AC-004, AC-005, AC-006 | Delete the test-owned plan in `finally` | `planning_deletePlan` | Captured session created during test | Plan is no longer readable | Ownership/time guard plus post-delete read |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | All optional quantities remain at their initial zero value | Optional Confirm is disabled and Skip remains enabled; no zero-total confirmation can be submitted |

## Acceptance Criteria

- AC-001: For both reviewed fixtures, direct and cached Base requests resolve the linked media ID, return at least one asset, return non-empty asset names, and expose identical sorted `(id, mandatory, name)` contracts.
- AC-002: The supplied internal account can read both fixtures and their visibility metadata identifies exactly one public and one internal-only channel.
- AC-003: The public fixture's mandatory element starts at `1`, exposes only `1..10`, updates the selected total, and becomes disabled after confirmation.
- AC-004: Two optional elements start at `0`, enforce zero-total gating, support `0..10`, and expose Assign all that copies the selected source quantity to both assets.
- AC-005: Manually selected optional values hydrate in Edit Channel, the modal omits Assign all, and saving a change preserves exact asset identity while updating only the intended quantity.
- AC-006: A separately confirmed manual optional selection preserves exact asset IDs/quantities after draft save and same-session reload without depending on Edit Channel.

## Locator Hints

- Use `SecondarySpacePage.secondaryStageTitle()`, `secondaryStageSelects()`, `activeSecondaryConfirmButton()`, and `activeSecondarySkipButton()` for chat components.
- Scope edit selectors through the visible `media-selection` modal and the `Select your element(s) for secondary space` section.
- Use the channel row's accessible `Edit Channel` control; do not choose an unscoped edit button.
- Keep GraphQL configuration, persistence, ownership, and cleanup operations in `secondary-space.fixture.ts`.

## Generated Test Requirements

- Must import `test` and `expect` from `fixtures/test`.
- Must use `test.step` and keep every `expect(...)` in the final assertion step of each test.
- Must use `SecondarySpacePage`; generated test bodies must not create direct Playwright locators.
- Must enumerate DC-001 through DC-006 in focused tests and cover NEG-001 explicitly.
- Must keep the exact metadata tag set on every test.
- Must compute campaign dates at runtime and obtain a new session/generated plan identity for each created plan.
- Must require `E2E_SECONDARY_SPACE_MUTATION_ENABLED=true` before any browser case creates a plan.
- Must run plan deletion in `finally`, refuse cleanup for invalid/old sessions, and verify deletion.
- Must never edit either media fixture or Base configuration.
- Must not claim the external-role, mixed-batch, post-save-lock, failure-injection, booking, CRM, feature-removal, or manual-UX gaps listed out of scope.
- Must not use screenshots, traces, video, `waitForTimeout`, XPath, `test.only`, `test.skip`, `test.fixme`, or `test.fail`.
- Must remain pending-review until the fixture contracts, mutation opt-in, cleanup, locators, and partial TC-SEC mappings receive human sign-off.

## Notes

- The suite intentionally exposes incomplete Base asset names as a failing contract rather than hiding the defect or substituting Pollen-side stale names.
- TC-SEC-006 is only covered through the supported pre-save Edit Channel flow; post-save lock behavior is not implemented as a test without an approved product decision.
- TC-SEC-007 is only covered through plan API persistence, draft save, and session reload; a booking assertion would be fabricated without the booking schema/stub and cleanup contract.
- Authenticated browser artifacts are disabled by the project policy, avoiding trace/screenshot/video retention of the supplied session.
