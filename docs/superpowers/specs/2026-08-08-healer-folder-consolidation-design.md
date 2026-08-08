# Healer Folder Consolidation Design

## Goal

Move all production code owned exclusively by the Playwright test healer into
`packages/web/scripts/ai/healer/` without changing healer behavior, policy,
public results, or command usage.

## Scope

The following implementation files move into the new folder:

- `heal-test.mjs`
- `test-heal.mjs`
- `test-heal-context.mjs`
- `test-heal-contract.mjs`
- `test-heal-scoped-role.mjs`
- `test-heal-triage.mjs`

The old `packages/web/scripts/ai/heal-test.mjs` path remains as a thin
compatibility entry point. It may delegate CLI execution and re-export the
existing public functions and constants, but it must contain no healer policy,
orchestration, evidence, context, contract, or repair logic.

No algorithms, defaults, status handling, exit codes, policy severity,
verification behavior, prompt text, or result rendering change in this work.

## Directory Model

```text
packages/web/scripts/ai/
  heal-test.mjs                 # compatibility entry point only
  healer/
    heal-test.mjs               # CLI and orchestration implementation
    test-heal.mjs               # repair engine and source policy
    test-heal-context.mjs       # bounded repository context
    test-heal-contract.mjs      # target contract resolution
    test-heal-scoped-role.mjs   # scoped-role evidence gate
    test-heal-triage.mjs        # runtime failure classification
  lib/                          # shared framework modules only
  __tests__/                    # existing central test layout
```

The structure intentionally stays flat. Six implementation files do not
justify additional `core`, `policy`, or `cli` subdirectories.

## Ownership Boundary

Only healer-exclusive production modules move. Shared modules such as the AI
client, gate runner, selector policy, secret safety, verified file reader,
test-suite root resolver, and scoped-role locator remain in `lib/` because
other generation, review, discovery, or gate paths use them.

Tests remain in `scripts/ai/__tests__/` to preserve the repository's existing
test discovery and organization. The manual prompt remains at
`ai/prompts/04-heal-locator.md`, alongside the other workflow prompts. Docs
remain in `docs/`.

## Compatibility

`npm run ai:test:heal` and direct calls to `node scripts/ai/heal-test.mjs` must
continue to work unchanged. Existing named imports from the old entry path
must also keep working through re-exports.

The implementation file in `healer/` remains directly executable for focused
development. Both entry paths call the same exported CLI function, so there is
one implementation and no duplicated behavior.

Internal healer imports change only as required by the new filesystem
location. Consumers of healer-exclusive modules update to their new paths.
No compatibility files are retained under `lib/`; the sole compatibility
surface is the established top-level CLI module.

## Testing Strategy

Before moving files, run the focused healer tests to establish a green
baseline. After the move, verify:

- the old compatibility CLI exposes the same help and argument behavior;
- the new direct CLI path behaves identically;
- old-path named imports still resolve;
- all healer unit and CLI tests pass;
- repository checks detect no stale imports of the old `lib/test-heal*` paths;
- the broader framework test suite, typecheck, and lint pass.

The refactor is accepted only if the existing tests pass without weakening or
rewriting their behavioral assertions.

## Non-Goals

- Refactoring the large healer orchestrator or repair engine.
- Renaming public commands, environment variables, statuses, or schemas.
- Introducing a barrel module, dependency injection layer, or new abstraction.
- Moving shared framework code merely because the healer imports it.
- Relocating tests, prompts, documentation, run artifacts, or generated files.
