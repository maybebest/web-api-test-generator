# Flow: HFSS eligibility filtering — live offsite mixed-SKU core

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-030 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P0 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/sains/hfss-category-eligibility.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @media-planner @authenticated @eligibility |
| Generation Mode | single |
| Review Status | pending-review |
| Review Sign-off | pending |
| Generation Source | canonical-test-case |
| Generation Status | generated |

## User Story

As a media planner selecting a channel with HFSS restrictions,
I want only ineligible Hero SKUs removed from that channel while my global campaign selection remains intact,
So that an eligible remainder can proceed without silently changing the campaign's master SKU set.

## Preconditions

- A fresh authenticated non-production browser state exists for `https://www.dev.pollen.js-devops.co.uk`.
- The operator explicitly sets `E2E_ALLOW_PERSISTENT_TEST_DATA=true`; the observed schema has no conversation-delete operation, so one conversation shell remains after the owned channel is removed.
- The live advertiser `The QA Advertiser™` exposes brand `Hellmanns` for all four channel groups.
- Catalogue readback resolves SKU `8161985` as HFSS and SKU `8184969` as non-HFSS for the selected brand.
- Exactly one visible offsite media named `OK_Offsite_HFSS` exists; its live admin configuration has `hasHFSSRestrictions=true`, categories `BABY`, `BWS`, and `PET_DOG`, and no Hero minimum or maximum.
- The test fails closed before UI mutation if any fixture value drifts.

## Out-of-scope

- This flow is the defensible live offsite core of canonical `XLSX::TC-VAL-003`; it does not claim full canonical coverage.
- Category-only filtering, simultaneous HFSS+category rejection, the no-eligible-Hero partition, invalid channel positions in multi-channel batches, onsite/in-store/at-home parity, and a bounded post-filter Hero min/max failure remain blocked until approved deterministic fixtures and their structured reason-code contract are supplied.
- The disputed summary-panel restriction message is not required. The approved target-build surface for this row is the visible assistant feedback plus `planningAI_chatHistory` structured state.
- Saving, booking, CSV export, CRM handoff, and plan deletion are out of scope. The test removes its owned channel and leaves the unavoidable conversation shell disclosed above.
- `REPO::TC-VAL-003` in `specs/test-cases.yaml` is a different Hero-propagation case and is not evidence for this flow.

## Stability Requirements

| Field | Value |
|---|---|
| Parallel Safe | no |
| Data Isolation | external |
| Allowed Retries | 0 |

## Variants

| Locale | Role | Plan |
|---|---|---|
| en-GB | internal media planner | fresh mixed-HFSS conversation |

## Includes

- none

## Business Rules

| Rule ID | Rule | Formula | Blocking Behavior |
|---|---|---|---|
| RULE-001 | HFSS filtering is channel-scoped and once-effective | Global Heroes `{8161985,8184969}` + `OK_Offsite_HFSS` => channel Heroes `{8184969}` while global Heroes remain `{8161985,8184969}` | Removing the eligible SKU, retaining the HFSS SKU, or mutating the global set is a planning-integrity defect |
| RULE-002 | Eligibility feedback is visible and API-correlated | The assistant names the restricted channel and HFSS reason; chat history names rejected SKU `8161985`; the channel readback names media id `6981e2dd205dfe855026fdff` and one retained Hero | Silent filtering or UI/API disagreement prevents an auditable plan |
| RULE-003 | Post-filter unbounded limits do not fabricate a block | With live `minHeroSKUs=null` and `maxHeroSKUs=null`, one eligible Hero remains and the channel is added exactly once | A fabricated Hero-count rejection blocks a valid channel |
| RULE-004 | Test-owned channel state is cleaned even when an assertion fails | Teardown deletes `OK_Offsite_HFSS` from the session and readback contains no remaining channel | Leaving a channel behind contaminates later shared-environment runs |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | Hellmanns Heroes: `8161985` (HFSS), `8184969` (non-HFSS); channel `OK_Offsite_HFSS`; £10,000 Managed service; runtime dates +30d..+60d | Visible HFSS feedback; one summary channel; API channel Heroes `{8184969}`; global Heroes unchanged; configured null min/max preserved; owned channel removed in teardown | Live-proven on 2026-07-13 against dev |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "advertiser": "The QA Advertiser™",
      "brand": "Hellmanns",
      "globalHeroSkuIds": [8161985, 8184969],
      "restrictedSkuId": 8161985,
      "eligibleSkuId": 8184969,
      "channel": "OK_Offsite_HFSS",
      "budget": 10000,
      "service": "Managed service",
      "dates": "today+30d..today+60d"
    },
    "expected": {
      "globalHeroSkuIds": [8161985, 8184969],
      "channelHeroSkuIds": [8184969],
      "channelCount": 1,
      "minHeroSkus": null,
      "maxHeroSkus": null,
      "cleanupChannelCount": 0
    },
    "notes": "Approved live offsite mixed-HFSS core; canonical category/batch/group variants remain blocked."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| advertiser | The QA Advertiser™ | Non-production QA advertiser |
| brand | Hellmanns | Links to Sainsbury's `Hellmann's` catalogue brand |
| restrictedSku | 8161985 | Live catalogue `isHFSS=true` preflight |
| eligibleSku | 8184969 | Live catalogue `isHFSS=false` preflight |
| channel | OK_Offsite_HFSS | Visible offsite media; live config preflight |
| mediaId | 6981e2dd205dfe855026fdff | Must match live name resolution |
| restrictionCategories | BABY, BWS, PET_DOG | Sorted live configuration equality |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | Live Pollen development UI plus admin/catalogue/session GraphQL readback | [] |

## Mocks as JSON

```json
[]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001, AC-002 | Preflight the live catalogue/media fixtures, start a fresh conversation, and select both SKUs as Measurement and Hero | Admin/catalogue GraphQL + Nectar AI UI | DC-001 fixture | Live classifications/config match and the mixed Hero set is committed | fixture evidence and captured session id |
| 2 | AC-003 | Request the exact restricted channel and select the exact score-ranked candidate | Assistant chat | DC-001 channel request | Assistant reports HFSS filtering and one channel appears in summary | visible feedback and channel row |
| 3 | AC-004 | Read the session state and history, then delete the owned channel | `planningAI_chatHistory` + summary delete UI | captured session id | Only `8184969` is assigned to the channel, global set remains unchanged, limits are null, and cleanup leaves no channel | structured state/history equality and cleanup readback |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | Explicit persistent-conversation consent is absent | Test fails before creating a conversation; no UI mutation occurs |

## Acceptance Criteria

- AC-001: Live preflight proves the exact channel configuration and mixed SKU classification before starting the UI journey.
- AC-002: The UI commits SKU `8161985` and SKU `8184969` as the global Measurement/Hero set in one fresh authenticated conversation.
- AC-003: Selecting `OK_Offsite_HFSS` produces visible channel-specific HFSS feedback and exactly one summary channel.
- AC-004: API readback retains both global Heroes, assigns only eligible SKU `8184969` to the channel, records the rejected SKU/reason in history, preserves the null post-filter min/max state, and teardown removes the owned channel.

## Locator Hints

- Use the associated checkbox accessible name ending in the SKU id for initial product selection.
- Use `selectedSku-<skuId>` scoped `toggle-hero-button` controls for the two Hero promotions.
- Use the exact score-ranked candidate containing `OK_Offsite_HFSS`, never the first unscoped channel match.
- Use the assistant paragraph beginning `The following SKUs were removed` for visible feedback and the API history for the rejected SKU id.
- Use `PlanningPage.summaryChannel(name)` and the row-scoped delete control for mutation and cleanup.

## Generated Test Requirements

- Import `test` and `expect` from `fixtures/test`.
- Keep all locators and live-flow actions in `HfssEligibilityComponent`.
- Require `E2E_ALLOW_PERSISTENT_TEST_DATA=true` before navigation.
- Compare structured state and history; do not assert non-contractual assistant prose beyond the HFSS reason/channel feedback.
- Preserve any primary failure if cleanup also fails, and never silently skip.
- Put all `expect(...)` calls in the final assertion step.
- Run only in the authenticated Chromium project with zero retries and one worker.

## Notes

- Source: canonical workbook row `XLSX::TC-VAL-003`, "Filter ineligible Heroes and continue channel batches".
- Live evidence on 2026-07-13 confirmed `8161985` was removed once from `OK_Offsite_HFSS`, `8184969` remained as the only channel Hero, global campaign Heroes remained unchanged, and channel cleanup returned `channels=[]`.
- Full canonical promotion requires deterministic category-restricted SKUs for the selected advertiser, all four supported channel-group fixtures, bounded post-filter min/max fixtures, mixed-batch ordering cases, a stable reason-code field, and a conversation delete contract.
