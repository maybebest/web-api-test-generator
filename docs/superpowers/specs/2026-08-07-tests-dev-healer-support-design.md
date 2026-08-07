# Tests-Dev Healer Support Design

## Goal

Create a complete development mirror of the tracked Playwright test suite at
`packages/web/tests-dev` and let the existing single-file healer repair tests
there without changing the canonical `packages/web/tests` suite.

The first live use must repair both copied PsychicBook tests against
`https://user.dev.psychicbook.net/` and require three consecutive green
Chromium verification runs before applying each repair.

## Scope

- Copy every Git-tracked file below `packages/web/tests` to the same relative
  path below `packages/web/tests-dev`.
- Do not copy ignored or runtime-created content such as `tests/.tmp`, reports,
  traces, screenshots, videos, or authentication state.
- Keep ordinary local and CI Playwright commands scoped to `packages/web/tests`.
- Extend healer target handling, contract resolution, static review, candidate
  verification, and Playwright execution to support the exact sibling root
  `packages/web/tests-dev`.
- Heal only the two copied PsychicBook regression specs in this experiment.

No automatic mirror synchronization command, multi-file healer, or general
arbitrary test-root support is included.

## Directory Model

The canonical and development trees have matching relative layouts:

```text
packages/web/
  tests/
    regression/psychicbook-account-menu.spec.ts
    regression/psychicbook-healing-experiment.spec.ts
    ...
  tests-dev/
    regression/psychicbook-account-menu.spec.ts
    regression/psychicbook-healing-experiment.spec.ts
    ...
```

Only the two exact roots are valid healer locations:

- `tests/**`
- `tests-dev/**`

All existing regular-file, realpath, symlink, traversal, integrity, concurrent
edit, candidate ownership, and dirty-target protections remain active for both
roots.

## Canonical Contract Mapping

The dev tree is an execution mirror, not a second source of specifications.
Contract checks map a dev target to its canonical identity by replacing only
the leading `tests-dev/` segment with `tests/`:

```text
tests-dev/regression/example.spec.ts -> tests/regression/example.spec.ts
```

The canonical identity is used for:

- flow-spec `Target Test File` discovery;
- recording bindings;
- the no-header allowlist;
- test-type and project inference; and
- policy decisions that distinguish generated, recorded, and handwritten tests.

The actual dev path remains the file read, linted, typechecked, executed,
archived, and atomically replaced. A dev copy therefore cannot bypass a
canonical spec or recording contract.

## Playwright Routing

`playwright.config.ts` keeps `./tests` as its default `testDir`. It accepts one
internal, exact-valued suite-root setting used by healer subprocesses:

- absent or `tests` -> `./tests`
- `tests-dev` -> `./tests-dev`
- every other value -> configuration error

The setting is included in the gate environment allowlist, but the healer owns
its value based on the validated target root. Callers cannot use it to select an
arbitrary directory. Regular package scripts and CI do not set it, so the dev
mirror is never collected accidentally and tests are not executed twice.

TypeScript and lint verification cover `tests-dev` without changing the normal
Playwright collection root.

## Single-File Healing Boundary

The healer remains single-file and must not gain permission to rewrite shared
Page Objects. The copied PsychicBook healing-experiment spec already owns its
locator in the spec file and is directly healable.

The copied account-menu spec currently delegates the failing locator to the
shared `pages/PsychicBookLoginPage.ts`. In the dev copy only, that existing Page
Object implementation is moved into the copied spec before the healer run,
without changing its behavior or locator. This preserves the known red
baseline while making the repair a single-file candidate. The canonical spec
and canonical shared Page Object remain unchanged.

## Healing Workflow

1. Commit the framework support and complete tracked-file mirror so healer
   targets begin clean.
2. Reproduce each copied PsychicBook failure once on the dev target.
3. Run `ai:test:heal` with apply mode and three verification runs.
4. Use runtime configuration from private `.env` files without printing or
   committing credentials.
5. Accept only an atomically applied candidate that passes typecheck, ESLint,
   the generated-test reviewer, healer policy, and three consecutive Chromium
   runs with retries disabled and one worker.
6. Confirm the canonical tests and shared Page Object are byte-for-byte
   unchanged.

If the healer classifies a failure as environmental, non-repairable, or
manual-change-required, the target stays unchanged and the exact status is
reported. The workflow does not weaken a hard gate to force acceptance.

## Testing Strategy

Framework tests must prove:

- `tests-dev/**` is accepted while every other sibling root is rejected;
- symlink and traversal protections remain effective;
- dev paths map to canonical `tests/**` contract identities;
- spec, recording, and handwritten allowlist behavior is unchanged through
  that mapping;
- healer subprocesses select `tests-dev`, while ordinary commands default to
  `tests`;
- invalid suite-root settings fail closed;
- candidates in `tests-dev` still pass typecheck, lint, review, integrity, and
  atomic-apply checks; and
- existing `tests/**` healer behavior remains green.

Live acceptance requires both copied PsychicBook tests to pass three
consecutive Chromium runs on the requested dev host after healer apply. The
broader framework self-suite, typecheck, lint, spec drift, and secret scans run
afterward.

## Security and Repository Hygiene

- No credentials, auth state, screenshots, traces, videos, or reports are
  copied or committed.
- Healer audit data remains under private `.ai-runs/heal/**` directories.
- The new root selector is a fixed two-value policy, not an arbitrary path.
- Original canonical tests are not modified by dev healing.
- The full dev mirror is intentionally a snapshot for this experiment; keeping
  it synchronized later requires a separate explicit decision.
