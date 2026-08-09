# Flow: Complex feed lazy loading, story expansion, and nested comments

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-CX-FEED-001 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | smoke |
| Auth | none |
| Target Test File | tests/smoke/complex-feed-lazyload-comments.spec.ts |
| Base Path | /complex/feed |
| Tags | @generated @smoke @local-fixture @complex-feed |
| Generation Mode | single |
| Generation Source | manual |
| Generation Status | pending-generation |

## User Story

As a feed reader on the deterministic local fixture,
I want the skeleton-loaded feed to render, load more stories on demand, and expand a story with its nested comments,
So that lazy rendering, recursive DOM, and live counters prove testable end to end.

## Preconditions

- The local fixture server is started automatically by the Playwright `webServer` configuration (`node local-fixture/server.mjs`).
- The flow runs in the `local-chromium` project, whose `baseURL` is the local fixture origin `http://127.0.0.1:3000`.
- No authentication and no external network access are required; skeletons resolve after a fixed 600 ms and Load more after a fixed 500 ms.

## Out-of-scope

- Hover/focus tooltips on story headers and tag-chip content assertions.
- Collapsing comment branches after expansion and exhausting the feed to its 25-story maximum.
- Toast notifications and any styling concerns.

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
| RULE-002 | Load more appends a batch of 5 stories after a fixed 500 ms delay and raises the unread badge to 20. | click Load more => 20 feed items AND badge "20" | A missing batch blocks the lazy-load flow. |
| RULE-003 | Expanding a story's details marks it read and decrements the unread badge. | first Details expand on story 1 => badge "19" | A stale badge fails the final business assertion. |
| RULE-004 | Each story carries a recursive comment tree that nests four levels down or deeper. | open Comments on story 1 => comment `C-1-1-1-1` visible | A missing deep comment blocks the comment-tree flow. |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | initial batch `15`, one Load more click, expand story `1` details and comments | 20 stories render, the deep comment `Comment C-1-1-1-1 on story 1` is visible, and the unread badge reads `19` | All timings are fixed constants |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "initialBatch": "15",
      "loadMoreClicks": "1",
      "expandedStory": "1"
    },
    "expected": {
      "storyCountAfterLoadMore": 20,
      "deepCommentText": "Comment C-1-1-1-1 on story 1",
      "unreadBadgeText": "19"
    },
    "notes": "Feed data is generated from fixed seed arrays; delays are fixed at 600 ms and 500 ms."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| unreadBadgeTestId | unread-badge | Live unread counter |
| loadMoreTestId | feed-load-more | Lazy-load trigger button |
| firstStoryTestId | feed-item-1 | First rendered story article |
| deepCommentText | Comment C-1-1-1-1 on story 1 | Fourth-level comment in story 1's tree |

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
| 2 | AC-002 | Load one more batch | Load more button | none | The feed grows to 20 stories and the badge shows `20` | Button is testid `feed-load-more`; it disables while the fixed 500 ms batch loads |
| 3 | AC-003 | Expand the first story's details | Details button on story 1 | none | The details section appears and the story is marked read | The 15+ `Details` buttons are identical (strict-mode trap); scope to testid `feed-item-1` |
| 4 | AC-004 | Open the first story's comments | Comments button on story 1 | none | The nested comment tree renders with `Comment C-1-1-1-1 on story 1` visible | Comment branches nest five levels; `Toggle replies` repeats ~60 times page-wide |
| 5 | AC-005 | Inspect the unread badge | Unread badge | none | The badge reads `19` after one story was read | Final assertion only: testid `unread-badge` has text `19` |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | Expanding the same story's details a second time | The unread badge does not decrement below `19`; a double decrement fails the final assertion. |

## Acceptance Criteria

- AC-001: The feed replaces its skeletons with 15 stories and the unread badge shows `15`.
- AC-002: Load more appends a batch of 5, growing the feed to 20 stories and the badge to `20`.
- AC-003: Expanding story 1's details reveals its details section and marks the story read.
- AC-004: Story 1's comment tree shows the fourth-level comment `Comment C-1-1-1-1 on story 1`.
- AC-005: After reading one story the unread badge reads `19`.

## Locator Hints

- Keep all locators in an inline Page Object class inside the generated file; the test body must not create direct Playwright locators.
- Stories carry testids `feed-item-1` .. `feed-item-N`; the Details, Comments, and Toggle replies buttons deliberately have no testids and duplicate their accessible names across every story — always scope them to a story container.
- The unread badge is testid `unread-badge`; the Load more button is testid `feed-load-more` and changes its visible text while loading.
- Rely on web-first assertions for both fixed delays (600 ms skeleton swap, 500 ms batch append); never bridge them with hard waits.
- Count stories via the shared `feed-item` article class or the testid prefix, not by visible text.

## Generated Test Requirements

- Must import `test` and `expect` from `../../fixtures/test`.
- Must keep the flow Page Object inline in the generated file and must not import or modify another Page Object.
- Must generate exactly one primary test and no optional `NEG-001` test.
- Must declare the exact metadata tags through the Playwright `{ tag: [...] }` option.
- Must use `test.step`, and every step title must carry at least one `AC-###` token.
- Must declare a `covered-ac-ids` annotation whose set equals AC-001 through AC-005.
- Must place `expect(...)` only in the final assertion step.
- Must title that final step `Assert AC-005: unread badge shows 19` and assert only the unread badge text.
- Must not use hard waits, XPath, focused tests, skipped tests, or direct Playwright locators in the generated test body.

## Notes

- The feed page is a DOM-complexity stress fixture: roughly 800 nodes and maximum element depth 21 once the first batch renders, growing with each Load more batch.
- Comment trees are generated recursively to five levels with per-branch `Toggle replies` collapse buttons.
