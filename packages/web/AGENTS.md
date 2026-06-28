# Codex Instructions

You are working on an AI-assisted Playwright AQA framework.

- The current goal is not just to document good behavior; it is to enforce good behavior through templates, scripts, gates, and CI.
- Keep Playwright Test deterministic.
- Use Playwright CLI plus locally installed SKILLS as the primary browser automation aid.
- Use `agent-browser` as a pre-generation DOM/accessibility discovery aid only.
- Use MCP only as a secondary exploratory/debugging tool.
- Playwright MCP must be launched with `--allowed-origins` mirroring `agent-browser.json` `allowedDomains` (sample in `ai/workflows/playwright-mcp-workflow.md`; synced copy in `.playwright/cli.config.json` `allowedOrigins`; a self-test fails if they drift).
- Do not commit secrets or auth state.
- Prefer stable meaningful `data-testid` locators first, then semantic locators.
- Do not use XPath.
- Do not use hard waits.
- Do not use `test.only`, `describe.only`, or `it.only`.
- Always run relevant tests after modifying tests or framework files.
- When fixing a failing test, collect evidence first.
- Do not remove assertions just to make tests pass.
- Document assumptions in `docs/ai-testing/ASSUMPTIONS.md`.

## Generated Tests

- For generated tests, always start from `specs/_template.md`.
- For raw Gherkin, checklists, or manual test cases, use `npm run ai:spec:import` to create an `ai-draft` spec, then require human review before generation.
- Validate specs before generating tests.
- Use `npm run ai:generate-test` to create a generation task.
- Before generation, prefer `npm run ai:dom:discover` when current UI DOM/accessibility evidence is needed for selector candidates.
- Review discovery artifacts with `npm run ai:dom:discover:review`.
- Never copy `agent-browser` refs like `@e1` or `@e2` into generated Playwright tests.
- The framework selector policy owns final Playwright locator selection.
- The Markdown spec is the contract.
- The generated Playwright test is the implementation.
- The gate is the acceptance check.
- Every spec must declare `Owner`, `Spec Version`, `Stability Requirements`, `Variants`, and `Includes`.
- `Variants` header must match `ai/config.json` `variantAxes`. `Includes` is `none` or one or more `FLOW-...` IDs.
- Capture calculation/validation logic in `Business Rules` and boundary/parametric examples in both `Data Cases` and `Data Cases as JSON`.
- For minimum/duration rules, require below-minimum, at-minimum, and above-minimum data cases.
- Default generation mode is single-test mode. A spec may declare the optional `Generation Mode` Metadata row (`single` | `suite`); review and gate resolve the mode from it, and a `--mode` flag that contradicts the spec metadata is a hard error.
- Generate a suite only when the spec declares `Generation Mode | suite` or a suite is explicitly requested.
- Default generated-test execution target is Chromium only.
- Cross-browser generated-test execution is opt-in.
- Single-test mode must generate exactly one primary `test(...)` block plus optionally one test per spec `NEG-###` case. The primary test declares a `covered-ac-ids` annotation whose set must equal the AC ids named in its step titles (every step title carries `AC-###` tokens). Spec metadata Tags must be declared exactly via the Playwright `{ tag: [...] }` option.
- `test.skip`/`test.fixme`/`test.fail` are forbidden in all forms, including runtime calls inside test bodies.
- Suite mode must cover AC IDs across focused tests.
- Every AC ID must be mapped from the spec Flow Steps table.
- In suite mode, each `Assert AC-###` step title may name at most one AC ID — combined-AC assertion steps are forbidden. In single mode, non-assertion step titles may carry multiple `AC-###` tokens, but the final assertion step names exactly one AC or NEG id.
- In suite mode, each negative case ID must have at least one `test.step` title containing `NEG-XXX`. In single mode, NEG tests are optional; uncovered NEG ids are a non-blocking review warning.
- Single-mode NEG tests must name their `NEG-###` id in the test title and in every step title, and end with an `Assert NEG-###: ...` step containing at least one meaningful expect.
- Generated tests must verify one clear functionality or business outcome per test.
- Generated tests must put `expect(...)` only in the final assertion step for each test.
- Tautological `expect.poll(...)` assertions are rejected, including producers that fold to a constant across multiple statements — a multi-statement constant producer is still constant.
- Final assertion steps must be titled `Assert AC-###: ...` or `Assert NEG-###: ...`.
- Generated tests must include the spec path, spec version, and spec hash header.
- Use `test.describe.serial` when the spec declares `Parallel Safe = no`.
- When `Variants` lists more than one row, enumerate them by looping over the rows (`for (const variant of variants) { test.describe(variant.label, ...) }`). `@playwright/test` has no `.each`; do not use it.
- When `Data Cases as JSON` lists more than one row, loop over the case rows (`for (const dataCase of dataCases) { test(\`${dataCase.caseId} ...\`, ...) }`) and include every `caseId` in the test titles or data rows.
- Assert salient expected values from `Data Cases as JSON`, such as channel names, minimum days, generated IDs, and exact validation-message fragments.
- Never use `page.locator('xpath=...')`, raw XPath, or `:nth-child` chains.
- Never use raw CSS selectors in generated tests unless the previous line contains `// locator-policy:exception <reason>`.
- String-selector action APIs are forbidden outright in generated tests — `page.click('css...')`, `page.fill('css...', value)` and the other selector-string action/query calls (`page.waitForSelector`, `page.$`, `page.$$`, ...). Call actions on locator objects owned by Page Objects or Component Objects.
- Generated test bodies must not create direct `page.getBy*` or `page.locator(...)` locators.
- Put generated locators in Page Objects or Component Objects.
- Use locator priority order inside Page Objects/Component Objects: `getByTestId` for stable meaningful `data-testid`, then `getByRole` with accessible name, `getByLabel`, `getByPlaceholder`, `getByText` for stable visible copy, and raw CSS only with an exception comment.
- Use existing Page Objects, components, fixtures, helpers, and test data builders when they make generated tests clearer and more reusable.
- Keep Page Objects simple: user-level actions and meaningful locators, no broad generic utility layers, hidden assertions, or hidden side effects in constructors.
- Never set `test.use({ storageState: '<literal>' })`. Use the `chromium-auth` Playwright project.
- Specs with `Auth | required` must name their `Target Test File` `<name>.authenticated.spec.ts` — spec validation fails this as a hard error otherwise. Non-auth specs must not use the `.authenticated.spec.ts` suffix (also a hard validation error). The `chromium-auth` project selects tests by `/.*\.authenticated\.spec\.ts/` and every non-auth browser project ignores that pattern.
- Run `npm run ai:test:review` and `npm run ai:test:gate`.
- The gate's Playwright stage runs with `--reporter=html,json` (overriding the config reporters, so junit/Allure output is not produced during gate runs) and fails unless the JSON report shows at least one passing test and zero failed or skipped tests for the target file. Flaky runs fail too: a test that passed only after a retry is a deterministic-test failure, not a pass.
- Run `npm run ai:spec:drift` after changing specs or generated tests. Hand-written tests without a spec must appear in `tests/.no-header-allowlist`.
- Never create TODO-only passing regression tests.
- Do not use auth state in unauthenticated projects.
- Auth setup must assert success before saving `storageState`. The `setup` project runs `tests/setup/auth.setup.ts` only when `E2E_AUTH_ENABLED=true`.
- A spec that is human-reviewed but not yet implemented against a live environment must set `Generation Status | pending-generation`; strict validation and `ai:test:gate:all` then skip its missing target test instead of failing.
- The bundled demo app under `demo-app/` is the local system under test; Playwright starts it via `webServer` for local/CI runs. Start it manually with `npm run demo:start` (serves `http://localhost:3000`, the default `PLAYWRIGHT_TEST_BASE_URL`) for discovery, exploration, or gate runs outside `playwright test`.
- CI gates must remain green. The workflow uses a concurrency group, so an in-progress run on the same ref is cancelled when a new push arrives. CI installs browsers per need (quality job: chromium only; regression matrix: the matrix project's engine). The `PW_PROJECTS` repo variable may include derived project names such as `chromium-auth` or `mobile-chrome` — the matrix resolves them to engines.

## Recording-Driven Tests

- Chrome DevTools Recorder JSON under `recordings/*.json` is a separate source contract from Markdown specs. Files prefixed with `_` (e.g. `recordings/_example.json`) are templates and are skipped by the recording gates.
- Validate with `npm run ai:recording:validate`, normalize with `npm run ai:recording:normalize`, build a task with `npm run ai:recording:generate-test`, and generate Playwright Test code under `tests/recorded/*.spec.ts`.
- Recorded tests must import from `fixtures/test`, carry the `/* recording: <path> title:<title> sha256:<hash> */` header, cover every `RSTEP-###` and `ASSERT-###`, and pass `ai:recording:review`, `ai:recording:gate`, and `ai:recording:drift`.
- Never emit Puppeteer/replay code, hard waits, XPath, focused tests, or secret-like literals into recorded tests.
- Recorded-test review enforces the same safety rules as the generated path: `test.skip`/`test.fixme`/`test.fail` are forbidden in every form including runtime calls, selector arguments that do not fold to a static string fail closed, and positional picks (`.first()`/`.last()`/`.nth(<n>)`) require `// locator-policy:exception <reason>` on the previous line.

## AI Brain for Generation

- `npm run ai:brain:doctor` reports which brain will run AI generation and where each key came from (environment vs `<repo>/.env` — the real environment always wins; key material is never printed). Selection order: `ANTHROPIC_API_KEY` (env or .env) -> Anthropic Messages API (default model `claude-opus-4-8`), else `OPENAI_API_KEY` -> OpenAI Chat Completions (default `gpt-4o-2024-11-20`), else a local `claude` CLI, else `codex` CLI. `AI_BRAIN` forces a choice (`anthropic|openai|claude-cli|codex-cli`; `claude`/`codex` aliases) and errors clearly if the forced brain is unavailable. Knobs: `ANTHROPIC_MAX_TOKENS`/`OPENAI_MAX_TOKENS` (default 16000), `AI_BRAIN_TIMEOUT_MS` (default 120000).
- `npm run ai:brain:generate -- <generation-task.md> --out <target.spec.ts>` runs the selected brain; always follow with `ai:test:review` and `ai:test:gate`. The brain drafts code — the gates remain the acceptance check. REST brains receive a pinned output contract (exactly one ```ts fence with the complete file; locators must be grounded in the task's DOM/recording evidence); CLI brains receive the raw task. If the model output is truncated, a refusal, or not plausible TypeScript, generation fails WITHOUT writing the file. Token usage is logged to stderr and recorded under `generation` in the run's `.ai-runs/**/manifest.json`.
