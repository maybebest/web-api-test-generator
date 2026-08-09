# Flow: Complex feed tooltips on hover and focus with single-decrement read state

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-CX-FEED-002 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | smoke |
| Auth | none |
| Target Test File | tests/smoke/complex-feed-tooltip-read-state.spec.ts |
| Base Path | /complex/feed |
| Tags | @generated @smoke @local-fixture @complex-feed |
| Generation Mode | single |
| Generation Source | manual |
| Generation Status | pending-generation |

## User Story

As a feed reader on the deterministic local fixture,
I want story tooltips to appear on both hover and keyboard focus and the unread badge to decrement exactly once per story read,
So that the CSS-driven tooltip pattern and the idempotent read-state counter prove testable end to end.

## Preconditions

- The local fixture server is started automatically by the Playwright `webServer` configuration (`node local-fixture/server.mjs`).
- The flow runs in the `local-chromium` project, whose `baseURL` is the local fixture origin `http://127.0.0.1:3000`.
- No authentication and no external network access are required; skeletons resolve after a fixed 600 ms.

## Out-of-scope

- The Load more lazy-load batch flow and story counts beyond the initial 15 (covered by FLOW-CX-FEED-001).
- Comment trees and the Toggle replies buttons.
- Tooltip styling and positioning; only visibility and text are asserted.

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
| RULE-001 | The initial skeletons are replaced by exactly 15 deterministic stories and the unread badge shows 15. | after fixed 600 ms => 15 feed items AND badge "15" | A wrong initial count blocks the flow. |
| RULE-002 | Hovering a story's info tip reveals its tooltip; the tooltip is hidden otherwise. | hover tip on story 2 => tooltip "Story 2 is deterministic fixture data" visible | A hover-dead tooltip blocks the tooltip flow. |
| RULE-003 | Focusing a story's info tip with the keyboard reveals the same tooltip pattern. | focus tip on story 3 => tooltip "Story 3 is deterministic fixture data" visible | A focus-dead tooltip blocks the accessibility path. |
| RULE-004 | Expanding a story's details marks it read and decrements the unread badge exactly once; repeat expands never decrement again. | first Details expand on story 2 => badge "14"; collapse + re-expand => badge stays "14" | A double decrement fails the final business assertion. |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | hover tip on story `2`, focus tip on story `3`, expand story `2` details twice | Both tooltips show their story-specific text and the unread badge reads `14` after the double expand | All timings are fixed constants; tooltips are pure CSS hover/focus reveals |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "hoverStory": "2",
      "focusStory": "3",
      "readStory": "2",
      "detailsExpansions": "2"
    },
    "expected": {
      "hoverTooltipText": "Story 2 is deterministic fixture data",
      "focusTooltipText": "Story 3 is deterministic fixture data",
      "unreadBadgeAfterRead": "14"
    },
    "notes": "The read-state guard decrements only on the first Details expand of a story; tooltips never change the badge."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| unreadBadgeTestId | unread-badge | Live unread counter |
| hoverStoryTestId | feed-item-2 | Story whose tip is hovered and whose details are expanded |
| focusStoryTestId | feed-item-3 | Story whose tip is keyboard-focused |
| hoverTooltipText | Story 2 is deterministic fixture data | Tooltip text for story 2 |
| focusTooltipText | Story 3 is deterministic fixture data | Tooltip text for story 3 |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | Fully local deterministic fixture | [] |

## Mocks as JSON

```json
[]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Open the feed page | `/complex/feed` | none | Skeleton loaders are replaced by 15 stories and the unread badge shows `15` | Wait via web-first assertions on testid `feed-item-1`, not hard waits |
| 2 | AC-002 | Hover the info tip on story 2 | Info tip inside testid `feed-item-2` | none | The tooltip `Story 2 is deterministic fixture data` becomes visible | The tooltip is role `tooltip`; 15 identical info tips exist page-wide — always scope to the story container |
| 3 | AC-003 | Focus the info tip on story 3 | Info tip inside testid `feed-item-3` | none | The tooltip `Story 3 is deterministic fixture data` becomes visible | The tip is a focusable span (tabindex 0); focus it directly — the CSS reveal also fires on `:focus` |
| 4 | AC-004 | Expand story 2's details | Details button on story 2 | none | The story is marked read and the badge drops to `14` | The 15 `Details` buttons are identical (strict-mode trap); scope to testid `feed-item-2` |
| 5 | AC-005 | Collapse and re-expand story 2's details | Details button on story 2 | none | The badge still reads `14`; a story decrements the unread count only once | Two more clicks on the same Details button; the read guard is idempotent |
| 6 | AC-005 | Inspect the unread badge | Unread badge | none | The badge reads `14` | Final assertion only: testid `unread-badge` has text `14` |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | Hovering or focusing info tips on unread stories | The unread badge never changes from tooltip interactions; only a Details expand decrements it. |

## Acceptance Criteria

- AC-001: The feed replaces its skeletons with 15 stories and the unread badge shows `15`.
- AC-002: Hovering story 2's info tip reveals the tooltip `Story 2 is deterministic fixture data`.
- AC-003: Keyboard-focusing story 3's info tip reveals the tooltip `Story 3 is deterministic fixture data`.
- AC-004: The first expand of story 2's details marks it read and drops the badge to `14`.
- AC-005: Collapsing and re-expanding story 2's details leaves the badge at `14` — the decrement is once per story.

## Locator Hints

- Keep all locators in an inline Page Object class inside the generated file; the test body must not create direct Playwright locators.
- Stories carry testids `feed-item-1` .. `feed-item-15`; the info tips, Details buttons, and tooltips deliberately have no testids and duplicate their structure across every story — always scope them to a story container.
- The info tip is the focusable span with class `tip` (tabindex 0) inside the story header; it has no accessible role, so target it inside the story container with a `.tip` CSS class locator carrying a `// locator-policy:exception` justification.
- Assert tooltips via `getByRole('tooltip')` scoped to the story container (each story owns exactly one tooltip) and check the exact text.
- The unread badge is testid `unread-badge`; assert its text with web-first assertions.
- Rely on web-first assertions for the fixed 600 ms skeleton swap; never bridge it with hard waits.

## Generated Test Requirements

- Must import `test` and `expect` from `../../fixtures/test`.
- Must keep the flow Page Object inline in the generated file and must not import or modify another Page Object.
- Must generate exactly one primary test and no optional `NEG-001` test.
- Must declare the exact metadata tags through the Playwright `{ tag: [...] }` option.
- Must use `test.step`, and every step title must carry at least one `AC-###` token.
- Must declare a `covered-ac-ids` annotation whose set equals AC-001 through AC-005.
- Must place `expect(...)` only in the final assertion step.
- Must title that final step `Assert AC-005: unread badge shows 14` and assert only the unread badge text.
- Must not use hard waits, XPath, focused tests, skipped tests, or direct Playwright locators in the generated test body.

## Notes

- This flow is the interaction complement of FLOW-CX-FEED-001: it stays on the initial 15-story batch and exercises the hover/focus tooltip pattern and the idempotent read-state counter that flow leaves out-of-scope.
- Tooltips are revealed purely by CSS `:hover` / `:focus` / `:focus-within` on the tip span; no JavaScript runs on tooltip reveal, so no timing waits are needed.
