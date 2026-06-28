# Architecture

```text
Requirements / PRDs / Checklists
        ↓
Manual-doc importer or human-written strict flow spec
        ↓
Spec validator
        ↓
Optional agent-browser DOM/accessibility discovery
        ↓
Generation task builder
        ↓
Codex-generated Playwright test
        ↓
Static generated-test review
        ↓
Spec drift check
        ↓
Playwright execution gate
        ↓
CI validation
        ↓
Reports / traces / screenshots / videos
```

```text
Exploration support
        ↓
AI QA Orchestrator / Codex
        ↓
Primary: Playwright CLI + SKILLS
Secondary: Playwright MCP
        ↓
Deterministic Playwright Test code
```

```text
Chrome DevTools Recorder JSON
        ↓
Recording validator
        ↓
Recording normalizer
        ↓
Recording generation task
        ↓
Recorded Playwright test
        ↓
Recording static review
        ↓
Recording execution gate
        ↓
Recording drift check
        ↓
CI validation
```

## Workflow

- Planner: explores the app, records user flows, and writes `specs/*.md`.
- Manual-doc importer: converts Gherkin/checklists/manual QA notes into `ai-draft` specs with `NEEDS_REVIEW` fields. It does not bypass human review.
- Spec validator: enforces the required flow contract before generation.
- Generation task builder: turns a valid spec into a deterministic Codex task and manifest under `.ai-runs/`. Default generation mode is single-test mode.
- DOM discovery: uses `agent-browser` before generation to capture current accessibility snapshots and selector candidates. It is evidence only; the framework selector policy chooses final Playwright locators.
- Generator: converts the task into deterministic Playwright Test code.
- Static reviewer: uses the TypeScript compiler API to check single-vs-suite generation scope, AC coverage in suite mode, the single-mode `covered-ac-ids` annotation and AC-tokened step titles, exact spec-Tags declaration, declared mocks, data-case IDs, salient expected values, forbidden patterns (including runtime `test.skip`/`fixme`/`fail` calls, string-selector action APIs such as `page.click('css...')`, and constant `expect.poll` producers even across multiple statements), single final assertion steps, POM locator ownership, locator hints, URL/secrets, CSS selector exceptions, and test style.
- Drift checker: compares generated test header hashes against the behavioral sections of the current spec.
- Execution gate: runs generated tests in Chromium by default with `--reporter=html,json` and fails unless the JSON report shows at least one passing and zero failed or skipped tests for the target file. A flaky run fails too: a test that passed only after a retry is a deterministic-test failure. Cross-browser generated-test execution is opt-in. Failure evidence is copied under `.ai-runs/<run>/evidence/` only when `playwright-report`/`test-results` artifacts actually exist — no empty evidence directories are created.
- Healer: fixes verified locator or synchronization failures with evidence.
- Recording validator: accepts only Chrome DevTools Recorder JSON files under `recordings/*.json`; rejects malformed steps, unsupported step types, unsafe URLs, unsafe typed values, unusable selectors, and recordings without assertion-worthy outcomes.
- Recording normalizer: assigns stable `RSTEP-###` and `ASSERT-###` identifiers and produces the behavioral hash used in recorded-test headers.
- Recording generation task builder: creates `.ai-runs/<run>/generation-task.md` from the validated recording contract. It does not generate from Gherkin, checklists, or loose notes.
- Recording reviewer/gate: enforces Playwright-native generated tests under `tests/recorded/*.spec.ts` and rejects Puppeteer replay code, missing step/assertion coverage, string-selector action APIs, forbidden selectors, hard waits, focused tests, stale recording hashes, and secret-like literals. It applies the same runtime `test.skip`/`fixme`/`fail` ban, fail-closed unfoldable-selector rule, and positional-pick exception-comment rule as the generated path. The gate's chromium stage writes a JSON report (`PLAYWRIGHT_JSON_OUTPUT_NAME=.ai-runs/recording-gate-last-run.json`) and passes only when `expected>=1 && unexpected===0 && skipped===0 && flaky===0` — a test that passed only after retry fails the gate (factored as `playwrightJsonVerdict` in `scripts/ai/recording-test-gate.mjs`). The report file is deleted after a green run; evidence directories are created only when `playwright-report`/`test-results` artifacts exist.

Prompts are guidance. Templates, scripts, gates, and CI are controls.

Generate a suite only when the spec declares `Generation Mode | suite` or a suite is explicitly requested.

## Contract Extensions

- `Business Rules` captures calculation, validation, and blocking behavior that should be asserted directly.
- `Data Cases` captures boundary and parameterized examples for humans.
- `Data Cases as JSON` is the machine-readable contract. Multiple JSON cases require generated tests to enumerate cases by looping over the case rows (`for (const dataCase of dataCases) { test(...) }`); `@playwright/test` has no `.each`. The `.each` detection is AST-only — a `.each` mention in comments no longer counts as usage.
- In single mode, the primary test must declare a `covered-ac-ids` annotation whose set equals the AC ids named in its step titles; every step title carries `AC-###` tokens.
- Spec metadata `Tags` must be declared exactly (set equality) via the Playwright `{ tag: [...] }` option on the test or describe block.
- Selector policy fails closed: `.locator()` arguments that do not fold to a static string and positional picks (`.first()`, `.last()`, `.nth(<n>)`) on locator-like or Page-Object-rooted expressions require a `// locator-policy:exception <reason>` comment on the previous line (warning when present, failure when absent).
- Minimum/duration rules require below-minimum, at-minimum, and above-minimum cases before human-reviewed validation passes.
- `Variants` are project-configurable through `ai/config.json`; the default axes are `Locale`, `Role`, and `Plan`.
- `Mocks as JSON` is a contract. Generated tests must structurally register declared mock URLs and reference response values and non-GET methods.

## Selector Ownership

`agent-browser` is used as eyes before generation, not as a selector authority. Its temporary refs are never valid Playwright selectors. The framework selector policy scores candidates and the generated test must use approved Playwright locators or a documented CSS exception.

Locator priority inside Page Objects/Component Objects is: `this.page.getByTestId(...)` for meaningful stable `data-testid`, `this.page.getByRole(...)` with accessible name, `this.page.getByLabel(...)`, `this.page.getByPlaceholder(...)`, `this.page.getByText(...)` for stable visible copy, then raw CSS only with `// locator-policy:exception <reason>`.

## Reuse Model

Generated tests must use Page Objects or Component Objects for locator ownership. Keep abstractions small and intentional: page objects expose user-level actions and stable locators, while scenario-specific assertions stay in the final assertion step of the focused test.

## Test Ownership

QA engineers own the behavior, assertions, test data, and merge decisions. AI may draft and repair code, but every test must remain understandable and reviewable by humans.

## Recording-Driven Generation

The recording-driven path is separate from the Markdown spec path. Chrome DevTools Recorder JSON is the source contract, not a discovery artifact. Generated recorded tests must translate the recording into maintainable Playwright Test code, use `fixtures/test`, and run through `ai:recording:review`, `ai:recording:gate`, and `ai:recording:drift`.

## Artifact Handling

Reports, traces, screenshots, videos, and storage state can contain sensitive data. They are ignored locally and uploaded from CI only as test artifacts. Do not commit them.

CI artifact set (`.github/workflows/playwright.yml`):

- Quality job, on any run: `allure-results`, `allure-report`, `playwright-report`, `test-results`, `ai-spec-coverage`.
- Regression matrix, on any run: `allure-results-<project>`, `allure-report-<project>`, `playwright-report-<project>`, `test-results-<project>`.
- Quality job, on failure only: `ai-gate-evidence` containing `.ai-runs/<run>/evidence` (7-day retention). This is the durable copy of per-gate failure evidence — later gate runs overwrite `playwright-report/`.
- The PR coverage comment is posted only for same-repo PRs; fork PRs get the `ai-spec-coverage` artifact instead.

The gate scripts run Playwright with `--reporter=html,json`, which overrides the config reporters — `junit.xml` and `allure-results` are NOT produced by `ai:test:gate`/`ai:recording:gate` Playwright stages. Plain `playwright test` runs (smoke, accessibility, regression matrix) keep the config reporters and feed Allure/junit normally.

## Security Boundaries

Use non-production environments and accounts. Store credentials in local environment variables or CI secrets. Never commit `playwright/.auth/*.json`, cookies, bearer tokens, passwords, or real user data.

Default Playwright projects are unauthenticated. Auth state is generated only for authenticated projects after login success is asserted.
