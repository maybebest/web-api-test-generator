# Root PsychicBook Dev Healing Design

## Goal

Run the tracked PsychicBook Playwright suite from the repository root against
the PsychicBook development environment, repair verified locator or
synchronization failures with the existing healer, and keep the canonical
stage suite unchanged.

This design supersedes the test-source choice in
`2026-08-07-tests-dev-healer-support-design.md`. The source suite is the root
`tests/` directory, not `packages/web/tests/`.

## Scope

- Treat `/tests` as the canonical PsychicBook suite: six API spec files and
  nine UI spec files.
- Create `/tests-dev` as a tracked, path-for-path copy of `/tests`.
- Run `/tests-dev` against `https://user.dev.psychicbook.net/` and the matching
  PsychicBook dev service endpoints.
- Use the existing healer for every repair applied to a copied test file.
- Remove the erroneous `packages/web/tests-dev` mirror. It was copied from the
  Pollen/Nectar suite and is not a source for this task.
- Preserve `packages/web/tests`, the root `tests` suite, and shared PsychicBook
  fixtures/page objects unless an independently reproduced framework defect
  requires a TDD infrastructure fix.

No Pollen/Nectar execution, authentication, data setup, or test repair is in
scope.

## Directory Model

```text
web-api-test-generator/
  tests/              # canonical PsychicBook stage tests
    api/
    ui/
  tests-dev/          # isolated PsychicBook dev copies healed in this task
    api/
    ui/
  packages/web/tests/ # independent framework suite; unchanged
```

`packages/web/tests-dev` is deleted as an incorrect mirror. There must be only
one development copy for the root PsychicBook suite.

## Environment Routing

The root environment registry gains an exact `dev` entry. `TEST_ENV=dev`
selects the dev web, API, helpdesk, and generation endpoints; stage remains the
default for ordinary runs.

The root Playwright configuration accepts the same exact internal suite-root
selector already used by the healer:

- absent or `tests` selects `./tests`;
- `tests-dev` selects `./tests-dev`;
- every other value fails closed.

This prevents ordinary stage commands from collecting the copied tests and
prevents arbitrary-directory execution.

## Healer Execution

The existing healer is invoked from the repository root so the root
`playwright.config.ts`, root fixtures, and root page objects are used. A target
below `tests-dev` remains a handwritten single-file target and is verified
with the root `api` or `ui` Playwright project selected explicitly.

For each copied spec:

1. Run a one-file baseline on `TEST_ENV=dev`, one worker, retries disabled.
2. If green, leave it unchanged.
3. If failure evidence is locator drift or synchronization owned by the spec,
   invoke the healer with `--apply`.
4. Require the healer's static gates and repeated runtime verification before
   accepting the candidate.
5. If the healer reports environment, authentication, test-data,
   product/contract, or shared-owner failure, do not force a test edit; record
   the classification and resolve the actual prerequisite separately.
6. Repeat until the file is green, then run the complete dev suite.

Manual edits may extend healer infrastructure only after a failing regression
test proves that the healer cannot perform this standard root-suite task.
Business assertions, payloads, test data, and expected outcomes are never
weakened to obtain a green run.

## Testing Strategy

TDD coverage must prove:

- root Playwright defaults to `tests` and selects only the exact `tests-dev`
  value;
- `TEST_ENV=dev` resolves all PsychicBook dev endpoints while stage remains
  unchanged;
- the healer accepts root `tests-dev` targets when launched from the root;
- the healer passes the selected suite root and project to verification;
- traversal, sibling-lookalike, symlink, dirty-target, integrity, and
  concurrent-edit protections remain active;
- the wrong `packages/web/tests-dev` mirror is absent; and
- canonical root tests remain byte-for-byte unchanged by dev healing.

Acceptance requires collection of all copied API and UI tests, file-by-file
baseline/healing evidence, and a final full `tests-dev` run. TypeScript, lint,
healer self-tests, and secret scanning run after the final repair.

## Safety and Feedback

- Credentials remain in ignored `.env` files and are never printed or
  committed.
- Runtime reports, traces, videos, screenshots, and healer archives remain
  ignored artifacts.
- Destructive dev tests use the suite's existing cleanup contracts; failures
  caused by missing cleanup or unavailable disposable data are reported, not
  hidden.
- For every healer cycle, record classification accuracy, provider use,
  attempts, verification duration, policy warnings, applied diff, and final
  result. Only observed shortcomings become framework-improvement items.
