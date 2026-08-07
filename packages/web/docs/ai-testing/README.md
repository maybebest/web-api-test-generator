# AI-Assisted Playwright Testing

This repository contains a reusable AI-assisted web automated testing framework for QA automation teams.

For a simple human-readable overview, start with [START_HERE.md](START_HERE.md).

The non-negotiable design principles for the generation agent live in
[AGENT_GROUND_RULES.md](AGENT_GROUND_RULES.md) (rules R1–R17 + an evidence-based compliance
matrix); check every pipeline change against them.

The deterministic golden evaluator is documented in [EVALS.md](EVALS.md). The bounded stdio
facade for reviewed plans, browser steps, and generation-task artifacts is documented in
[MCP_SERVER.md](MCP_SERVER.md).
Prompt compaction, provider/exact caching, structured output, token telemetry, and CI budgets are
documented in [TOKEN_ECONOMY.md](TOKEN_ECONOMY.md).

## Execution Truth

Playwright Test is the deterministic execution framework. AI can explore, draft, triage, and suggest repairs, but committed tests must be normal Playwright Test specs that run locally and in CI.

## AI Tooling Model

- Primary: Playwright CLI plus locally installed SKILLS.
- DOM discovery: `agent-browser` before generation when current UI evidence is needed for selector candidates.
- Secondary: Playwright MCP for complex exploratory and debugging sessions.
- Implementation agent: Codex.
- Final authority: CI results, reports, traces, screenshots, and videos.

## How QA Engineers Use It

1. Explore flows with Playwright CLI snapshots.
2. Capture the behavior in `specs/*.md`.
3. Generate or write deterministic tests under `tests/`.
4. Keep shared actions in `pages/`, `components/`, and `fixtures/`.
5. Run the relevant project locally.
6. Let CI confirm the final result.

## Safe AI Usage

AI should help create and maintain tests, not bypass QA judgment. It must not use production credentials, commit auth state, hide product bugs, remove assertions to force a pass, or replace deterministic CI execution.

## Generated Test Workflow

Prompts are guidance. Templates, scripts, gates, and CI are controls.

1. For raw manual docs, Gherkin, or checklist text, create a draft spec first:

```bash
npm run ai:spec:import -- --input docs/manual/login.md --out specs/login.draft.md
```

Resolve every `NEEDS_REVIEW` value and provide deterministic business rules/data cases. Normal validation fails closed while a marker remains; behavioral SHA-256 drift checks invalidate generated tests after later contract changes.

2. Or create a flow spec from the strict template:

```bash
cp specs/_template.md specs/login.md
```

3. Fill every required section and acceptance criterion.
4. Validate the spec:

```bash
npm run ai:spec:validate -- specs/login.md
```

5. Optionally capture current UI evidence for selector candidates:

```bash
npm run ai:dom:discover -- --spec specs/example-flow.md --url http://127.0.0.1:3000/recorded-example/checkout
npm run ai:dom:discover:review -- --spec specs/login.md
```

6. Create a deterministic Codex generation task. The task links the latest matching DOM discovery artifact when one exists, writes a manifest, and requires the generated test to include a spec version/hash header.

```bash
npm run ai:generate-test -- specs/login.md --target tests/regression/login.spec.ts
```

7. Ask Codex to implement `.ai-runs/<run>/generation-task.md`.
8. Review the generated test:

```bash
npm run ai:test:review -- --spec specs/login.md --test tests/regression/login.spec.ts
```

9. Run the full gate:

```bash
npm run ai:test:gate -- --spec specs/login.md --test tests/regression/login.spec.ts
```

10. Check drift and update the local coverage catalog:

```bash
npm run ai:spec:drift
npm run ai:spec:catalog
```

The catalog (`docs/ai-testing/coverage.md`) includes a `NEG Coverage` column: covered/total spec `NEG-###` ids found in the target test (`none` when a spec declares no NEG cases). A pending-generation spec reports `0/<n>` until its test lands.

11. Open generated/spec-bound tests in Playwright UI mode without framework healthcheck tests:

```bash
npm run ai:test:ui:generated
```

Useful filters:

```bash
npm run ai:test:ui:generated -- --spec specs/login.md
npm run ai:test:ui:generated -- --project chromium
npm run ai:test:ui:generated -- --dry-run
```

This command reads `Target Test File` from valid specs and verifies the generated spec header before launching Playwright UI mode. It does not glob every file under `tests/`.

12. Run the suite:

```bash
npm run test:e2e:smoke
npm run test:e2e:regression
```

The Markdown spec is the contract. The generated Playwright test is the implementation. The gate is the acceptance check.

See [AGENT_BROWSER.md](AGENT_BROWSER.md) for the pre-generation discovery workflow and selector ownership model.

Specs must map every acceptance criterion to at least one Flow Step through the `AC IDs` column. Use `Business Rules` for calculation/validation rules, `Data Cases` for human-readable boundary examples, and `Data Cases as JSON` for machine-checkable case data. Default generation mode is single-test mode; a spec may declare `Generation Mode | single/suite` in Metadata and the review/gate resolve it automatically (a contradicting `--mode` flag is a hard error). Generate a suite only when the spec declares `Generation Mode | suite` or a suite is explicitly requested. Generated tests use Page Objects/Component Objects for locators and assert user-visible outcomes only in the final `Assert AC-###` or `Assert NEG-###` step for each test.

The static reviewer additionally enforces: in single mode, AC-tokened step titles whose union equals the primary test's `covered-ac-ids` annotation set; exact (set-equality) declaration of the spec metadata `Tags` via the Playwright `{ tag: [...] }` option; fail-closed selector policy for unfoldable `.locator()` arguments and positional picks (`.first()`/`.last()`/`.nth(n)` need a `// locator-policy:exception` comment); and a ban on `test.skip`/`test.fixme`/`test.fail` in all forms, including runtime calls. String-selector action APIs (`page.click('css...')`, `page.fill('css...', value)`, ...) are forbidden outright, and tautological `expect.poll(...)` assertions are rejected even when the producer folds to a constant across multiple statements. The executed gate fails flaky runs: a test that passed only after a retry is a deterministic-test failure.

Default generated-test execution target is Chromium only. Cross-browser generated-test execution is opt-in with `--all-projects` or an explicit `--projects` list.

For minimum/duration rules, reviewed specs must include below-minimum, at-minimum, and above-minimum JSON data cases. Generated tests must enumerate multiple JSON data cases by looping over the case rows (`for (const dataCase of dataCases) { test(...) }`; `@playwright/test` has no `.each` — detection is AST-only, so a `.each` mention in comments no longer counts) and assert salient expected values such as channel name, minimum days, generated IDs, and validation-message fragments.

`ai/config.json` controls project-specific variant axes. The default is `Locale | Role | Plan`; product teams can change it to axes such as `Channel | Region | Plan` before authoring specs.

Spec drift uses a behavioral hash: changes to ACs, steps, data cases, mocks, rules, variants, includes, and execution metadata require regeneration, while purely editorial notes do not.

## Auth Projects

Default browser projects are unauthenticated and do not use `storageState`. Set `E2E_AUTH_ENABLED=true` only for authenticated runs. When enabled, auth setup requires non-production credentials plus `E2E_AUTH_SUCCESS_SELECTOR` or `E2E_AUTH_SUCCESS_URL_REGEX`, asserts login success, and saves `playwright/.auth/user.json` with owner-only permissions only after success.
