# web-api-test-generator

A single repository that combines two independent test solutions as **npm workspaces**.
Each suite keeps its own module system, tooling, config, `.env`, and AI pipeline — the
workspace boundary *is* the module boundary, so modularity is preserved end to end.

| Package | Path | What it is | Module system | Runner |
|---|---|---|---|---|
| `playwright-aqa-web` | [`packages/web`](packages/web) | AI-assisted Playwright **web E2E** framework (Page Objects, fixtures, specs/recordings, ~40 `ai:*` generation/review/gate scripts, Allure, accessibility, visual). | CommonJS | Playwright |
| `har-api-tests` | [`packages/api`](packages/api) | Generates maintainable Playwright **API tests from HAR** files (parser → generator → CLI → calibration), plus modular `channel-management/` and `partners-advertisers/` sub-packages. | ESM (NodeNext) | Vitest + Playwright |

The two suites deliberately stay separate at the package level: their module systems
(CommonJS vs ESM/NodeNext) and Playwright configs are mutually exclusive and cannot share
one root `package.json` / `tsconfig` / `playwright.config`. Workspaces let them coexist
with **one install** while each runs exactly as it did standalone.

## Requirements

- Node `>= 20` (CI and `.nvmrc` pin **22**)
- One `npm install` at the root installs both workspaces. `@playwright/test` and `typescript`
  dedupe to a single version; `dotenv` (17 vs 16) and `@types/node` (24 vs 22) stay nested
  per package so each suite keeps its exact behavior.

## Quick start

```bash
npm install                      # install both workspaces (single hoisted node_modules)
npm run web:browsers:install     # one-time Playwright browser download (web)

npm run verify                   # web typecheck + api lint + api build + api unit tests
```

## Common commands (root delegates)

Every script runs in its package's own working directory (this is what keeps the
cwd-coupled API generator deterministic).

```bash
# Web (packages/web)
npm run web:typecheck            # tsc --noEmit (CommonJS)
npm run web:test                 # playwright test  (needs PLAYWRIGHT_TEST_BASE_URL + auth)
npm run web:test:smoke           # chromium smoke
npm run web:test:list            # list all web tests
npm run web:ai:self              # AI-script self-tests

# API (packages/api)
npm run api:lint                 # tsc --noEmit -p tsconfig.test.json (NodeNext)
npm run api:build                # tsc -p tsconfig.json -> dist/
npm run api:test                 # vitest unit tests
npm run api:generate -- --har ./examples   # regenerate tests from HAR
npm run api:ci                   # lint + build + unit + secret scan
```

You can also work inside a package directly (`cd packages/web && npm run test:e2e:ui`) —
all the original package scripts are unchanged.

## Configuration

Each package owns its own `.env` (gitignored) and `.env.example`:

- [`packages/web/.env.example`](packages/web/.env.example) — `PLAYWRIGHT_TEST_BASE_URL`, the
  `E2E_*` auth family, and the AI-brain keys (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`).
- [`packages/api/.env.example`](packages/api/.env.example) — `BASE_URL`, the shared GraphQL
  auth chain (`CHANNEL_BEARER_TOKEN` → `API_AUTHORIZATION` → `API_TOKEN`), and calibration knobs.

## CI

Two scoped GitHub Actions workflows live at the repo root and only fire on their package's
changes:

- [`.github/workflows/web.yml`](.github/workflows/web.yml) — web quality gates + regression matrix.
- [`.github/workflows/api.yml`](.github/workflows/api.yml) — api lint/build/unit + generated-suite drift check.

## Roadmap (deferred, additive)

The two suites share real domain overlap (`channel-management`, `partners-advertisers`
against the same GraphQL endpoint; auth, secret-scanning, env-loading, masking). These are
intentionally **not** merged in this step. Planned follow-ups, each an isolated PR:

1. `packages/shared` — a dual CJS+ESM canonical channel-management client; delete the web
   fixture's local re-implementation.
2. A unified secret-scan / clean-tree CI gate.
3. A shared domain glossary (advertiser/brand/SKU/channel defaults).
4. An optional root `playwright.config.ts` aggregator for a single `npx playwright test`.
