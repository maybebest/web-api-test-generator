# Flow: Authenticated Nectar AI entry-shell responsive and accessibility checks

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-MP-027 |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P1 |
| Test Type | regression |
| Auth | required |
| Target Test File | tests/regression/sains/entry-shell-responsive-accessibility.authenticated.spec.ts |
| Base Path | /planning |
| Tags | @generated @regression @accessibility @responsive @authenticated |
| Generation Mode | suite |
| Review Status | pending-review |
| Review Sign-off | pending |
| Generation Source | coverage-gap-analysis |
| Generation Status | generated |

## User Story

As an authenticated media planner,
I want the Nectar AI entry action to remain visible, named and keyboard reachable at representative desktop, tablet and mobile viewport probes,
So that I can begin planning without a layout or automated-accessibility barrier.

## Preconditions

- A valid non-production authenticated Playwright storage state is supplied through `E2E_AUTH_STATE_PATH`.
- `PLAYWRIGHT_TEST_BASE_URL` points to the reviewed non-production Pollen environment.
- The account can open `/planning` and the Nectar AI feature flags are enabled by `PlanningPage.goto()`.
- The `/planning` landing shell renders the live-verified `my360-targeting-try-now-button` entry action.
- Browser zoom and device scale factor use the Playwright Chromium defaults.
- The three viewport sizes below are explicit smoke probes, not a product support-matrix commitment; product/UX owners must review them before this pending-review flow is promoted.

## Out-of-scope

- Activating the entry action, creating a Nectar AI session, or changing any plan, catalogue or channel data.
- Responsive behavior after the landing shell, including chat, summary tables, SKU dialogs and channel dialogs.
- Safari, Firefox, physical-device, browser-zoom, orientation-change and operating-system assistive-technology coverage.
- Manual screen-reader announcements, reading order, visual focus-ring quality, cognitive usability and keyboard operation after the entry action.
- Accessibility defects that axe-core cannot detect automatically.
- Treating the three probes as an agreed supported-device matrix; they remain pending human review.

## Stability Requirements

| Field | Value |
|---|---|
| Parallel Safe | yes |
| Data Isolation | shared |
| Allowed Retries | 0 |

## Variants

| Locale | Role | Plan |
|---|---|---|
| en-GB | authenticated media planner | entry shell only |

## Includes

- none

## Business Rules

| Rule ID | Rule | Formula | Blocking Behavior |
|---|---|---|---|
| RULE-001 | The entry action remains usable at each declared viewport probe | `documentElement.scrollWidth - documentElement.clientWidth <= 1` and the entry-action rectangle is fully inside the viewport with 1px rendering tolerance | Horizontal clipping or an off-screen primary action blocks entry for that layout probe |
| RULE-002 | The entry action exposes its purpose to accessibility APIs | The live entry control has the accessible name `Try Nectar AI Assistant now` | An unnamed or misleading primary action is not operable by screen-reader users |
| RULE-003 | The visible authenticated page has no violations detectable by the selected axe-core rules | Unique violation IDs from WCAG 2.0/2.1 A/AA axe-core tags equal `[]` for the document | A detected rule violation fails the automated accessibility baseline |
| RULE-004 | Natural forward keyboard traversal reaches the entry action | Repeated `Tab` from the post-navigation focus position reaches the live entry control within 80 presses, without a click or programmatic target focus | A control omitted from the natural Tab order blocks keyboard-only entry |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | viewport=1440x900; label=desktop probe | Entry action is visible and contained; horizontal overflow is no more than 1px | Chromium layout probe only |
| DC-002 | viewport=1024x768; label=tablet landscape probe | Entry action is visible and contained; horizontal overflow is no more than 1px | Chromium layout probe only |
| DC-003 | viewport=390x844; label=mobile portrait probe | Entry action is visible and contained; horizontal overflow is no more than 1px | Chromium layout probe only |
| DC-004 | viewport=1440x900; inspect live entry control | Entry action has the accessible name Try Nectar AI Assistant now | Automated accessible-name subset; verified against the live DOM on 2026-07-13 |
| DC-005 | viewport=1440x900; scan the document with WCAG 2.0/2.1 A/AA axe-core tags | Unique automated violation IDs equal an empty array | Automated rules only; manual checks remain out of scope |

## Data Cases as JSON

```json
[
  {
    "caseId": "DC-001",
    "inputs": { "viewport": { "width": 1440, "height": 900 }, "label": "desktop probe" },
    "expected": { "maxHorizontalOverflowPixels": 1, "entryActionContained": true },
    "notes": "Authenticated Chromium landing-shell probe; not a support-matrix declaration."
  },
  {
    "caseId": "DC-002",
    "inputs": { "viewport": { "width": 1024, "height": 768 }, "label": "tablet landscape probe" },
    "expected": { "maxHorizontalOverflowPixels": 1, "entryActionContained": true },
    "notes": "Authenticated Chromium landing-shell probe; not a physical tablet claim."
  },
  {
    "caseId": "DC-003",
    "inputs": { "viewport": { "width": 390, "height": 844 }, "label": "mobile portrait probe" },
    "expected": { "maxHorizontalOverflowPixels": 1, "entryActionContained": true },
    "notes": "Authenticated Chromium landing-shell probe; not a physical mobile claim."
  },
  {
    "caseId": "DC-004",
    "inputs": { "viewport": { "width": 1440, "height": 900 }, "inspection": "accessible name" },
    "expected": { "accessibleName": "Try Nectar AI Assistant now" },
    "notes": "Does not assert manual screen-reader announcements."
  },
  {
    "caseId": "DC-005",
    "inputs": { "viewport": { "width": 1440, "height": 900 }, "axeTags": ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    "expected": { "violationIds": [] },
    "notes": "The axe-core result is an automated subset, not an accessibility certification."
  }
]
```

## Test Data

| Name | Value | Notes |
|---|---|---|
| desktopViewport | 1440x900 | Explicit desktop smoke probe pending product review |
| tabletViewport | 1024x768 | Explicit tablet-landscape smoke probe pending product review |
| mobileViewport | 390x844 | Explicit mobile-portrait smoke probe pending product review |
| keyboardTraversalLimit | 80 | Bounded diagnostic guard against an unreachable target |
| targetTestId | my360-targeting-try-now-button | Live-verified stable locator owned by `PlanningPage` |
| targetAccessibleName | Try Nectar AI Assistant now | Live-verified accessible name; visible label remains Try now |
| axeScope | authenticated document | Scans the rendered application document; browser chrome is outside page content |
| axeTags | wcag2a, wcag2aa, wcag21a, wcag21aa | Automated WCAG 2.0/2.1 A/AA rules |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | The authenticated development environment renders the live entry shell | [] |

## Mocks as JSON

```json
[]
```

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Set one declared viewport and open authenticated planning | `/planning` entry shell | DC-001, DC-002 or DC-003 viewport | Live Nectar AI entry action renders without activating it | Page Object readiness wait |
| 2 | AC-001 | Inspect document overflow and entry-action bounds | Document root and entry action | 1px rendering tolerance | No horizontal overflow beyond tolerance and action is inside viewport | `expect.poll` on Page Object layout readings; entry locator visible |
| 3 | AC-002 | Inspect the entry action's accessibility identity | Nectar AI entry action | Try Nectar AI Assistant now | Entry action exposes the expected accessible name | `toHaveAccessibleName` on Page Object locator |
| 4 | AC-003 | Run the declared axe-core rules | authenticated document | WCAG 2.0/2.1 A/AA tags | Unique violation ID list is empty | `expect.poll` on cached scan result |
| 5 | AC-002 | Traverse the natural focus order without clicking | Nectar AI entry action | Up to 80 Tab presses | Entry action receives browser focus | `toBeFocused` on Page Object locator |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | The entry action is absent from the natural forward keyboard sequence through the bounded 80-Tab traversal | The focus assertion fails, identifying a keyboard-entry blocker without clicking or mutating live data |

## Acceptance Criteria

- AC-001: At 1440x900, 1024x768 and 390x844, the live entry action is visible, fully inside the viewport and the document has no more than 1px horizontal rendering overflow.
- AC-002: The live entry action has the accessible name Try Nectar AI Assistant now and can receive focus through natural forward keyboard traversal.
- AC-003: The visible authenticated document reports no violation IDs for the selected WCAG 2.0/2.1 A/AA axe-core rules.

## Locator Hints

- Reuse `PlanningPage.startAssistantButton()` (`getByTestId('my360-targeting-try-now-button')`) for the live entry control.
- Run the automated axe-core scan against the rendered authenticated document; do not depend on a landmark that is absent from the live DOM.
- Keep all document, viewport, focus and accessibility inspection behind `NectarAiEntryShellPage`.

## Generated Test Requirements

- Must import `test` and `expect` from `fixtures/test`.
- Must use `test.step` and keep every `expect(...)` in one final assertion step per test.
- Must use `NectarAiEntryShellPage`; the test body must not create direct locators.
- Must enumerate DC-001, DC-002 and DC-003 as separate tests from a data-case array.
- Must cover DC-004, DC-005 and NEG-001 with focused tests.
- Must set the viewport before navigation and must never activate the entry action.
- Must not create, edit, save or delete a plan or planning session.
- Must use natural `Tab` presses for NEG-001 and must not call `focus()` on the target.
- Must keep the exact metadata tag set on every generated test.
- Must not use screenshots, traces, video, `waitForTimeout`, XPath, `test.only`, `test.skip`, `test.fixme` or `test.fail`.
- Must remain marked pending-review until the viewport probes and assertions receive human sign-off.

## Notes

- This flow closes only the safe, read-only entry-shell subset of the responsive and accessibility gaps. It does not claim the full Nectar AI planning journey is responsive or accessible.
- The authenticated project already disables trace, screenshot and video retention, preventing auth/session material from being written to test artifacts.
- A normal release gate must continue to reject this pending-review spec. Static preview is permitted with `--allow-pending-review`; promotion requires a hash-bound human review sign-off.
