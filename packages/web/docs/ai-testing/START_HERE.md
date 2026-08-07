# AI Testing Framework: Start Here

This repository now contains a Playwright-based web testing framework with AI-assisted workflows around it.

The short version:

- Playwright Test runs the real automated tests.
- AI tools help explore pages, draft tests, debug failures, and suggest fixes.
- CI is the final authority.
- Generated tests must still be normal, deterministic Playwright tests.
- Specs, scripts, gates, and CI now enforce the AI test-generation contract.

## What Is Implemented

### Playwright Test Setup

The project has a TypeScript Playwright setup with:

- `playwright.config.ts`
- a deterministic `local-chromium` project plus external Chromium, Firefox, WebKit, and mobile Chrome projects when an external URL is configured
- zero retries, serialized external workers, reports, traces, screenshots, and videos
- `PLAYWRIGHT_TEST_BASE_URL` support
- optional auth setup through `tests/setup/auth.setup.ts`

Default generated-test execution target is Chromium only. Cross-browser generated-test execution is opt-in.

### Test Structure

Tests are organized by purpose:

```text
tests/
  setup/          auth setup
  smoke/          fast confidence checks
  regression/     business flow tests
  accessibility/  axe accessibility checks
  visual/         blocking local layout/CSS contract
  recorded/       Chrome Recorder-derived local flow
```

### Reusable Test Code

Shared framework code lives here:

```text
fixtures/    shared Playwright fixtures
pages/       page objects
components/  reusable UI components
data/        fake test users and shared test data
mocks/       API mocking helpers
specs/       human-readable flow specs
```

### AI Guidance

AI-specific material lives here:

```text
ai/prompts/     prompts for exploration, generation, triage, healing, review
ai/policies/    locator, security, quality, and MCP rules
ai/workflows/   Playwright CLI, MCP, and CI debugging workflows
scripts/ai/     executable validators, task builders, and generated-test gates
ai/config.json  project-specific variant axes for generated specs
```

### CI

GitHub Actions workflow is added at:

```text
.github/workflows/web.yml
```

It runs two jobs on pull requests and pushes to `main`/`master` (with a concurrency group that cancels in-progress runs on the same ref):

- `quality`: static quality gates plus smoke, accessibility, visual-contract, and recorded local tests in `local-chromium`.
- `authenticated-regression`: an opt-in, preflighted, single-worker `chromium-auth` run against the configured non-production environment.

Both jobs upload Playwright reports, test results, and Allure results/reports as artifacts; the quality job also uploads the spec coverage catalog and, on failure, the `.ai-runs` gate evidence.

## The Testing Flow

Use this workflow for real QA work.

### 1. Understand The Feature

Start from a requirement, ticket, PRD, bug report, or manual QA notes.

Write down:

- what the user is trying to do
- the starting page
- the important actions
- the expected result
- required test data

### 2. Explore With Playwright CLI

Use Playwright CLI and local skills to inspect the real app.

Example (start the deterministic fixture first; exploration sessions do not start it for you):

```bash
npm run fixture:start &
export PLAYWRIGHT_TEST_BASE_URL=http://127.0.0.1:3000
export PLAYWRIGHT_CLI_SESSION=checkout-flow

playwright-cli open "$PLAYWRIGHT_TEST_BASE_URL" --headed
playwright-cli snapshot --filename=checkout-start.yml
playwright-cli screenshot --filename=checkout-start.png
```

During exploration:

- use snapshot element refs
- prefer accessible names and roles
- re-snapshot after navigation
- check console/network if something breaks
- do not create final tests until the flow is understood

### 3. Save The Flow As A Spec

If you are starting from raw Gherkin, a checklist, or manual QA notes, create a draft spec:

```bash
npm run ai:spec:import -- --input docs/manual/<scenario>.md --out specs/<flow-name>.draft.md
```

Resolve every `NEEDS_REVIEW` value and provide deterministic business rules/data cases, then run the normal spec validator. No interactive promotion or sign-off step is required.

Start from the strict template:

```bash
cp specs/_template.md specs/<flow-name>.md
```

Example:

```text
specs/checkout-flow.md
```

The spec should be readable by a human QA engineer and valid for automation:

```bash
npm run ai:spec:validate -- specs/<flow-name>.md
```

Use `Business Rules` for calculation or blocking behavior, `Data Cases` for human-readable boundaries, and `Data Cases as JSON` for the exact machine-checkable cases like N-1/N/N+1 duration checks.

Create the Codex task:

```bash
npm run ai:generate-test -- specs/<flow-name>.md --target tests/regression/<flow-name>.spec.ts
```

### 4. Generate Or Write The Test

Create deterministic Playwright Test code under:

```text
tests/smoke/
tests/regression/
```

Use the shared import:

```ts
import { test, expect } from '../../fixtures/test';
```

Use:

- `test.step`
- page objects/component objects for all locators and reusable business actions
- stable meaningful test IDs inside POM first, then semantic locators like `getByRole`, `getByLabel`, and stable `getByText`
- Default generation mode is single-test mode.
- Generate a suite only when the spec declares `Generation Mode | suite` or a suite is explicitly requested.
- one final `Assert AC-###` or `Assert NEG-###` step per test
- web-first assertions like `toBeVisible`, `toHaveText`, `toHaveURL` only in that final assertion step

Avoid:

- direct `page.getBy*` or `page.locator(...)` locators in generated test bodies
- XPath
- hard waits
- random CSS classes
- deleting assertions just to make a test pass
- production credentials

Single-test mode generates one requested-scenario test with one primary final verification responsibility. Suite mode covers all AC IDs from its spec across focused tests.

Review and gate the generated test:

```bash
npm run ai:test:review -- --spec specs/<flow-name>.md --test tests/regression/<flow-name>.spec.ts
npm run ai:test:gate -- --spec specs/<flow-name>.md --test tests/regression/<flow-name>.spec.ts
npm run ai:spec:drift
npm run ai:spec:catalog
```

### 5. Run The Test Locally

Smoke tests:

```bash
npm run test:e2e:smoke
```

Regression tests:

```bash
npm run test:e2e:regression
```

All tests:

```bash
npm run test:e2e
```

UI mode:

```bash
npm run test:e2e:ui
```

Debug mode:

```bash
npm run test:e2e:debug
```

### 6. Debug Failures With Evidence

Run with trace:

```bash
npm run test:e2e:trace
```

Open report:

```bash
npm run test:e2e:report
```

Classify the failure before fixing it:

- product bug
- test bug
- environment issue
- data issue
- flaky timing issue
- locator drift

Only fix what the evidence supports.

### 7. Let CI Confirm

CI validates all flow specs, checks drift, gates every generated spec/test pair, runs the framework self-tests, runs smoke/accessibility checks, and runs the regression browser matrix on pull requests and pushes to `main` or `master`.

CI uploads:

- Playwright HTML report (`playwright-report`, plus `playwright-report-<project>` from the matrix)
- test results (`test-results`, plus `test-results-<project>`)
- Allure results and report (`allure-results`/`allure-report`, plus per-project copies)
- the spec coverage catalog (`ai-spec-coverage`)
- on quality-job failure only: `ai-gate-evidence` with the `.ai-runs/<run>/evidence` directories (7-day retention)

The PR coverage comment is posted only for same-repo PRs; fork PRs get the `ai-spec-coverage` artifact instead.

Do not upload or commit auth state files.

## How To Set Up Locally

Install dependencies:

```bash
npm install
```

Install browsers (full local install of all engines; CI installs per need instead):

```bash
npm run pw:install
```

Set the app URL:

```bash
export PLAYWRIGHT_TEST_BASE_URL=https://your-non-production-host.example
```

Start the deterministic fixture when working outside `playwright test` (test runs start it automatically):

```bash
npm run fixture:start
```

Run smoke tests:

```bash
npm run test:e2e:smoke
```

## AI Brain For Generation

AI generation selects a "brain" at run time. Keys can live in the environment or in `<repo>/.env` — the real environment always wins. `ANTHROPIC_API_KEY` selects the Anthropic Messages API first, then `OPENAI_API_KEY` selects OpenAI Chat Completions; with no key, a locally installed `claude` CLI is used, then a `codex` CLI. `AI_BRAIN` forces a choice. Run `npm run ai:brain:doctor` to see the resolution without making a paid call. Details: `docs/ai-testing/QUICKSTART.md` and `.env.example`.

## Allure Reports

Allure reporting is on by default (`ALLURE_ENABLED=false` opts out). Build and open the HTML report with `npm run allure:generate` / `npm run allure:open` — these need a Java runtime on `PATH`. See `docs/ai-testing/QUICKSTART.md` for details.

## Auth

Auth is optional and disabled by default.

Unauthenticated projects do not use `storageState`. Auth state is generated only when `E2E_AUTH_ENABLED=true`, required config exists, and login success is asserted.

For real login tests, use non-production credentials:

```bash
export E2E_AUTH_ENABLED=true
export E2E_LOGIN_PATH=/login
export E2E_USER_EMAIL=test@example.com
export E2E_USER_PASSWORD=<non-production-password>
export E2E_AUTH_SUCCESS_SELECTOR="[data-testid='user-menu']"
```

Never commit:

```text
playwright/.auth/*.json
```

## Visual Tests

The blocking local visual suite checks a deterministic layout/CSS contract in `local-chromium` and attaches a screenshot as evidence. It does not claim pixel-baseline comparison.

Run it with `npm run test:e2e:visual`.

## Accessibility Tests

Accessibility tests use `@axe-core/playwright`.

Run them with:

```bash
npm run test:e2e:accessibility
```

## Useful Commands

```bash
npm run typecheck
npm run test:e2e:smoke
npm run test:e2e:regression
npm run test:e2e:ui
npm run test:e2e:debug
npm run test:e2e:report
npm run pw:codegen
```

## Simple Rule Of Thumb

AI can help you move faster, but the final test must be boring in the best possible way:

- clear
- deterministic
- reviewed
- runnable in CI
- based on user-visible behavior
