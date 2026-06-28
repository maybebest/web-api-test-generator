# Quickstart

This repository uses npm.

## Install Dependencies

```bash
npm install
npx playwright install --with-deps
```

This installs all browser engines locally (same as `npm run pw:install`). CI installs browsers per need instead: the quality job installs chromium only, and the regression matrix installs the matrix project's engine (`chromium-auth`/`mobile-chrome` map to chromium).

## Configure The Target App

```bash
export PLAYWRIGHT_TEST_BASE_URL=http://localhost:3000
```

Start the bundled demo app with `npm run demo:start` (serves `http://localhost:3000`, the default `PLAYWRIGHT_TEST_BASE_URL`). `playwright test` starts it automatically via `webServer`; start it manually for DOM discovery, recording, or exploration sessions.

Optional non-production credentials:

```bash
export E2E_AUTH_ENABLED=true
export E2E_USER_EMAIL=test@example.com
export E2E_USER_PASSWORD=<non-production-password>
export E2E_AUTH_SUCCESS_SELECTOR="[data-testid='user-menu']"
```

## Run Tests

```bash
PLAYWRIGHT_TEST_BASE_URL=http://localhost:3000 npx playwright test tests/smoke --project=chromium
npx playwright test tests/regression
npx playwright test --ui
npx playwright test --debug
```

## Generated Test Workflow

If you start from raw manual QA text, draft a strict spec first:

```bash
npm run ai:spec:import -- --input docs/manual/scenario-4.md --out specs/scenario-4.draft.md
```

Review the `NEEDS_REVIEW` fields, confirm business rules and data cases, then promote `Review Status` from `ai-draft` to `human-reviewed`.

Create a spec manually:

```bash
cp specs/_template.md specs/login.md
```

Fill the required sections, then validate it:

```bash
npm run ai:spec:validate -- specs/login.md
```

Create the Codex task:

```bash
npm run ai:generate-test -- specs/login.md --target tests/regression/login.spec.ts
```

Ask Codex to implement the generated task at `.ai-runs/<run>/generation-task.md`, then run:

```bash
npm run ai:test:review -- --spec specs/login.md --test tests/regression/login.spec.ts
npm run ai:test:gate -- --spec specs/login.md --test tests/regression/login.spec.ts
npm run ai:spec:drift
npm run ai:spec:catalog
npm run test:e2e:smoke
npm run test:e2e:regression
```

The spec is the contract. The generated test is the implementation. The gate is the acceptance check.

Each spec must include `Spec Version`, Flow Step `AC IDs`, stability requirements, variants, includes, business rules, data cases, `Data Cases as JSON`, and `Mocks as JSON` when API mocking is needed.

For validation rules such as minimum campaign duration, fill below-minimum, at-minimum, and above-minimum JSON data cases before promoting the draft to human-reviewed.

Variant axes are configured in `ai/config.json`. Change them before writing product-specific specs when your app needs axes like `Channel`, `Market`, or `Plan Type`.

## AI Brain Selection

AI generation (`npm run ai:brain:generate`) picks a "brain" at run time. Keys may live in the real environment or in `<repo>/.env` (the real environment always wins):

1. `ANTHROPIC_API_KEY` set -> Anthropic Messages API (default model `claude-opus-4-8`).
2. `OPENAI_API_KEY` set -> OpenAI Chat Completions (default model `gpt-4o-2024-11-20`).
3. Otherwise a locally installed `claude` CLI, then a `codex` CLI.

`AI_BRAIN` forces a choice (`anthropic|openai|claude-cli|codex-cli`, with `claude`/`codex` aliases) and errors clearly when the forced brain is unavailable. Run `npm run ai:brain:doctor` to see the resolution and where each key came from — it makes no paid call and never prints key material. See `.env.example` for all knobs.

## Auth Projects

Default projects are unauthenticated. Auth state is generated only when `E2E_AUTH_ENABLED=true`, required login config is present, and login success is proven by `E2E_AUTH_SUCCESS_SELECTOR` or `E2E_AUTH_SUCCESS_URL_REGEX`.

Authenticated runs use the conditional `chromium-auth` project. Do not commit `playwright/.auth/*.json`.

Specs with `Auth | required` MUST name their `Target Test File` `<name>.authenticated.spec.ts`. The `chromium-auth` project selects tests by `/.*\.authenticated\.spec\.ts/`, and every non-auth browser project (chromium, firefox, webkit, mobile-chrome) ignores that pattern, so authenticated specs run only with storage state and never silently match zero tests.

## Allure Reports

Allure reporting is enabled by default (`allure-playwright` writes raw results to `allure-results/` on every `playwright test` run). Opt out with `ALLURE_ENABLED=false`. Generating or viewing the HTML report requires a Java runtime (JRE 8+) on `PATH` — test runs themselves do not need Java.

```bash
npm run allure:generate   # build allure-report/ from allure-results/
npm run allure:open       # open a generated report
npm run allure:serve      # one-shot: generate and serve from allure-results/
```

`allure-results/` and `allure-report/` are gitignored; CI uploads both as artifacts. Note: the AI gate scripts run Playwright with `--reporter=html,json`, so gate runs do not feed Allure — only plain `playwright test` runs do.

## Playwright CLI And Skills

Recommended local developer setup:

```bash
npm install -g @playwright/cli@latest
playwright-cli install --skills
playwright-cli --help
```

If global installation is unavailable (the package is `@playwright/cli`; the old unscoped `playwright-cli` npm package is deprecated — prefer pinning a version over `@latest`):

```bash
npx @playwright/cli --help
```

## Optional MCP Setup

Use MCP only when Playwright CLI snapshots are not enough. The server must be launched with `--allowed-origins` mirroring `agent-browser.json` `allowedDomains` (a self-test fails if the synced copies drift; see `ai/workflows/playwright-mcp-workflow.md`):

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@playwright/mcp@latest",
        "--allowed-origins",
        "http://localhost:3000;http://127.0.0.1:3000;http://0.0.0.0:3000;https://www.dev.rtd.js-devops.co.uk"
      ]
    }
  }
}
```

If your Codex environment supports MCP config, add the server there. CI does not need MCP.

## Optional Playwright Test Agents

If your installed Playwright version supports it, you can initialize Playwright test agents outside CI:

```bash
npx playwright init-agents --loop=vscode
```

This maps to the repo workflow: planner creates `specs/*.md`, generator creates `tests/*.spec.ts`, and healer repairs verified failures with evidence.
