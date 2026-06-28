# Explore Flow With Playwright CLI

## Purpose

Guide Codex or another AI QA agent through exploratory flow discovery before deterministic tests are created.

## Operating Rules

- Use Playwright CLI plus locally installed SKILLS as the primary AI/browser automation tool.
- Start a named session for each flow:

```bash
export PLAYWRIGHT_CLI_SESSION=<flow-name>
```

- Open the app in a headed browser:

```bash
playwright-cli open "$PLAYWRIGHT_TEST_BASE_URL" --headed
```

- Capture accessibility snapshots before interacting:

```bash
playwright-cli snapshot --filename=<name>.yml
```

- Use element refs from snapshots, not guessed selectors.
- Re-snapshot after navigation or DOM-changing actions.
- Capture screenshots for evidence:

```bash
playwright-cli screenshot --filename=evidence.png
```

- Check console and network when failures or unexpected states occur:

```bash
playwright-cli console error
playwright-cli network
```

- Capture findings as exploration notes (accessible names, roles, labels, stable `data-testid`s, expected user-visible results, known risks, evidence locations). Do not paste session-only element refs such as `@e1`/`@e2` into any committed artifact.
- Do not create tests during exploration unless explicitly asked.

## Handoff: producing a valid spec

Exploration notes are not a spec. To turn them into a generation-ready spec:

1. Copy `specs/_template.md` to `specs/<flow-name>.md`.
2. Fill every required section and Metadata field from your exploration notes. Map each Acceptance Criterion to a Flow Steps row, capture calculation/validation logic in `Business Rules`, and boundary/parametric examples in both `Data Cases` and `Data Cases as JSON`.
3. Replace element refs with policy-vocabulary locators (accessible names, roles, labels, stable test ids).
4. Validate until it passes:

```bash
npm run ai:spec:validate -- specs/<flow-name>.md
```

The spec is the contract handed to generation only after `ai:spec:validate` passes. A spec that is human-reviewed but cannot yet be implemented against a live environment should set `Generation Status | pending-generation`. A pending-generation spec whose Target Test File already exists fails `ai:test:gate:all` and `ai:spec:validate --strict` as a stale status. If the flow should always be generated as a multi-test suite, declare it once in the optional `Generation Mode | suite` Metadata row so review/gate resolve the mode from the spec instead of relying on `--mode` flags.

## Output

Exploration notes plus a `specs/<flow-name>.md` that passes `ai:spec:validate`.

