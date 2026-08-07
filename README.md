# web-api-test-generator

A single repository with three focused **npm workspaces**.
Each workspace keeps its own module system, tooling, and config — the
workspace boundary *is* the module boundary, so modularity is preserved end to end.

| Package | Path | What it is | Module system | Runner |
|---|---|---|---|---|
| `playwright-aqa-web` | [`packages/web`](packages/web) | AI-assisted Playwright **web E2E** framework. Generates UI tests from **Markdown specs** *and* from **Chrome DevTools Recorder** exports (Page Objects, fixtures, ~40 `ai:*` generation/review/gate scripts, drift checks, Allure, accessibility, visual). | CommonJS | Playwright |
| `har-api-tests` | [`packages/api`](packages/api) | Generates maintainable Playwright **API tests from HAR** files (parser → generator → CLI → calibration), plus modular `channel-management/` and `partners-advertisers/` sub-packages. | ESM (NodeNext) | Vitest + Playwright |
| `test-generator-ui` | [`packages/ui`](packages/ui) | Local browser interface for the HAR, Markdown-spec, and Recorder generation workflows. | ESM | Node test runner |

The test suites deliberately stay separate at the package level: their module systems
(CommonJS vs ESM/NodeNext) and Playwright configs are mutually exclusive and cannot share
one root `package.json` / `tsconfig` / `playwright.config`. Workspaces let them coexist
with **one install** while each runs exactly as it did standalone.

## What the combined solution generates

Three generation paths feed the independent web and API suites; the UI wraps those same workflows:

| Input you have | Generated output | Suite | Entry command (from repo root) |
|---|---|---|---|
| **HAR capture** (browser / WebInspector network export) | Playwright **API** tests | `packages/api` | `npm run api:generate -- --har ./examples/session.har --out ./test-results/generated-example --first-party example.test` |
| **Markdown spec / docs** (acceptance criteria + data cases) | Playwright **UI (E2E)** tests | `packages/web` | `npm run web:ai:generate -- <spec>` → `npm run web:ai:gate` |
| **Chrome DevTools Recorder JSON** (`packages/web/recordings/*.json`) | Playwright **UI (E2E)** tests | `packages/web` | `npm run web:ai:recording:generate -- recordings/<flow>.json` → `npm run web:ai:recording:gate` |

Each path is contract-first (the HAR / spec / recording is the source of truth), stamps a hashed
header into its output, and is drift-checked and gated before a generated test is accepted. The two
UI paths share `packages/web`'s page objects, fixtures, locator policy, and gates; the API path
lives entirely in `packages/api`. **The web and api suites stay independent** — different module
systems, configs, `.env`, and CI workflows — so neither depends on the other.

## Requirements

- Node `>= 20` (CI and `.nvmrc` pin **22**)
- One `npm install` at the root installs all three workspaces. `@playwright/test` and `typescript`
  dedupe to a single version; `dotenv` (17 vs 16) and `@types/node` (24 vs 22) stay nested
  per package so each suite keeps its exact behavior.

## Quick start

```bash
npm install                      # install all workspaces (single hoisted node_modules)
npm run web:browsers:install     # one-time Playwright browser download (web)

npm test                         # UI + API unit/replay + deterministic local web tests
npm run verify                   # deterministic package quality and machine-policy gates
```

## Common commands (root delegates)

Every script runs in its package's own working directory (this is what keeps the
cwd-coupled API generator deterministic).

```bash
# Web (packages/web)
npm run web:typecheck            # tsc --noEmit (CommonJS)
npm run web:test:local           # deterministic local smoke/a11y/visual/recorded suites
npm run web:test                 # local by default; external projects only when explicitly configured
npm run web:test:smoke           # local-chromium smoke
npm run web:test:list            # list all web tests
npm run web:ai:self              # AI-script self-tests
npm run web:ai:eval              # offline golden reference/pipeline-drift evaluation
npm run web:ai:tokens -- --json  # factual provider token/cache/retry telemetry
npm run web:ai:mcp               # bounded stdio MCP facade (plan/act/task generation)

# Local UI wrapper
npm run ui:dev                   # browser shell for API HAR, web spec, and recorder generators
npm run ui:test                  # UI server/unit tests

# API (packages/api)
npm run api:lint                 # tsc --noEmit -p tsconfig.test.json (NodeNext)
npm run api:build                # tsc -p tsconfig.json -> dist/
npm run api:test                 # vitest unit tests
npm run api:test:replay          # committed generated smoke tier against local replay
npm run api:generate -- --har ./examples/session.har --out ./test-results/generated-example --first-party example.test
npm run api:ci                   # lint + build + unit + secret scan
```

You can also work inside a package directly (`cd packages/web && npm run test:e2e:ui`); the root scripts are convenience delegates.

## Configuration

Each package owns its own `.env` (gitignored) and `.env.example`:

- [`packages/web/.env.example`](packages/web/.env.example) — `PLAYWRIGHT_TEST_BASE_URL`, the
  `E2E_*` auth family, and the AI-brain keys (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`).
- [`packages/api/.env.example`](packages/api/.env.example) — `BASE_URL`, the shared GraphQL
  auth chain (`CHANNEL_BEARER_TOKEN` → `API_AUTHORIZATION` → `API_TOKEN`), and calibration knobs.

## CI

Three package-scoped GitHub Actions workflows live at the repo root and only fire on their package's
changes:

- [`.github/workflows/web.yml`](.github/workflows/web.yml) — deterministic local quality gates + opt-in authenticated regression.
- [`.github/workflows/api.yml`](.github/workflows/api.yml) — API lint/build/unit, secret scanning, dependency audit, deterministic generated-suite replay, and source-capture drift checks when the private captures are available.
- [`.github/workflows/ui.yml`](.github/workflows/ui.yml) — UI typecheck and tests.

The separate [`.github/workflows/secret-scan.yml`](.github/workflows/secret-scan.yml) is a repository-wide fail-closed secret scan.

## Roadmap (deferred, additive)

The two suites share real domain overlap (`channel-management`, `partners-advertisers`
against the same GraphQL endpoint; auth, secret-scanning, env-loading, masking). These are
intentionally **not** merged in this step. Planned follow-ups, each an isolated PR:

1. `packages/shared` — a dual CJS+ESM canonical channel-management client; delete the web
   fixture's local re-implementation.
2. A shared domain glossary (advertiser/brand/SKU/channel defaults).
3. An optional root `playwright.config.ts` aggregator for a single `npx playwright test`.
