# HAR API Test Generator

Production-minded TypeScript framework for turning browser HAR captures into maintainable Playwright API tests.

## What It Does

- Parses one or more `.har`, `.json`, or `.md` capture files from a file path or folder.
- Filters static assets, frontend bundles, fonts, images, analytics/tracking hosts, and telemetry beacon paths. Supports a `--first-party` allowlist to drop everything except your own API hosts.
- Normalizes API requests by domain, method, path, query, headers, bodies, status, content type, and timing.
- Masks secrets — including secrets nested inside JSON-encoded strings and form/multipart bodies — before writing generated code or fixtures.
- Generates a **smoke tier** (one repeatable test per endpoint, for every method) plus an **extended tier** (resource CRUD flows, missing-field negatives, and auth/security checks).
- Marks generated tests with metadata for origin, category, confidence, execution mode, and mutation risk.
- Supports a calibration loop: inferred negatives run in record-only mode against staging, and confirmed 4xx contracts graduate to active exact-status tests.
- Generates Playwright API tests with status, content type, soft response-time, secret-leak, and AJV JSON-schema assertions.
- Routes each captured host independently (`BASE_URL_<HOST>`), so multi-host captures do not collapse onto one origin.
- Emits Codex-ready analysis artifacts when `--ai` is enabled.

## Quick Start

```bash
npm install
npm run build
npm test
npm run generate -- --har ./examples/session.har --out ./tests/generated --base-url https://api.example.com --ai
```

Generated tests are written to `tests/generated/`.

## CLI

```bash
npm run generate -- \
  --har ./examples/session.har \
  --out ./tests/generated \
  --base-url https://api.example.com \
  --include "/v1/" \
  --exclude "analytics" \
  --ignore-domain google-analytics.com \
  --first-party heartpace.dev \
  --method GET,POST \
  --status 200,201 \
  --generation-mode smoke,extended \
  --inference-level balanced \
  --inferred-run-mode mixed \
  --negative-status-policy family \
  --mutation-policy guarded \
  --ai
```

Options:

- `--har`: HAR file or folder. Repeatable and comma-separated values are supported.
- `--out`: generated output directory. Defaults to `./tests/generated`.
- `--base-url`: overrides captured base URLs in generated tests.
- `--include`: include only URLs matching a regex or substring.
- `--exclude`: exclude URLs matching a regex or substring.
- `--ignore-domain`: ignore a hostname or parent domain.
- `--first-party`: keep only these hosts (and their subdomains); drops all other hosts. Repeatable/comma-separated. The highest-leverage knob for cutting third-party noise.
- `--method`: include selected HTTP methods.
- `--status`: include selected response statuses.
- `--generation-mode`: `smoke`, `extended`, or a comma-separated combination. Defaults to both. (Legacy `replay`→`smoke`, `inferred`/`scenario`→`extended` are accepted.)
- `--inference-level`: `conservative`, `balanced`, or `aggressive`. Defaults to `balanced`.
- `--inferred-run-mode`: `mixed`, `all-active`, or `replay-only`. Defaults to `mixed`.
- `--negative-status-policy`: `family`, `strict`, or `config`. Defaults to `family`.
- `--mutation-policy`: `guarded`, `all-skipped`, or `all-active`. Defaults to `guarded`.
- `--calibration`: load a calibration overrides file (array of `{title, hostname?, observedStatus}`). `config/calibration-overrides.json` is auto-loaded when present.
- `--ai`: write `har-analysis.json` and `codex-test-improvement-prompt.md`.
- `--dry-run`: print the generation summary without writing files.
- `--config`: load a custom config file.

## Generation Logic

The generator runs a planner between normalization and code generation:

```text
HAR entries -> parse/filter/normalize -> test planner -> Playwright generator
```

The planner produces two tiers:

**Smoke tier** (`@smoke`) — exactly one repeatable test per `(host, method, path)` endpoint, for **every** method including mutating ones. Each is a reworked recording of the observed request (secrets and dynamic values replaced with placeholders) that can be run repeatedly. The most informative observed sample (successful, with a response body) is chosen as the representative.

**Extended tier** (`@extended`) — built on the smoke endpoints:

- `crud`: resource flows grouped by collection path, ordered create → read → update → delete. When both create and delete are observed the delete runs last, so the flow cleans up after itself (`mutationRisk: guarded`); otherwise it is `unsafe` and emitted as `test.fixme`.
- `negative`: missing-required-field variants (only for endpoints that were observed returning 2xx) and invalid dynamic path parameters.
- `security`: missing or invalid auth, cookie, API key, or CSRF headers.
- `scenario`: chronological flows such as login → account/session → logout.

Every generated test is labeled in a comment:

```ts
// origin: inferred | category: negative | confidence: high | execution: active | mutationRisk: guarded
```

Each test also receives one or more service tags, such as `@auth`, `@profile`, `@approval`, or `@hiring`. State-changing tests are additionally tagged `@mutating`, and inferred negative/security tests are tagged `@calibrate` for the calibration workflow below.

Execution defaults are intentionally mixed:

- Smoke tests are `active` (destructive ones — logout, password change, deletes — are `test.fixme`).
- Inferred `negative`/`security` validation tests are `test.fixme` by default: their "bad input ⇒ 4xx" expectation is an unverified guess, and real APIs are frequently lenient (they return 2xx), so these are emitted as triage candidates rather than active assertions. Confirm the real contract with the calibration workflow below, or force them on with `--inferred-run-mode all-active`.
- Mutating CRUD flows without a cleanup step are `test.fixme`.
- `--generation-mode smoke` keeps smoke-only behavior available.

Generated specs are endpoint-centered:

```text
tests/generated/
  stageautomation-heartpace-dev/
    auth-main-login.spec.ts
    user-password-param.spec.ts
  scenarios/
    stageautomation-heartpace-dev-login-account-logout-flow.spec.ts
  fixtures/
  schemas/
  support/
```

Every generated file starts with a GENERATED banner — never edit them by hand; rerun the generator instead. A preflight spec runs before the endpoint suites and fails fast with one clear error when required environment variables are missing, instead of letting every test fail cryptically.

Generated output also includes production-readiness metadata:

- `run-manifest.json`: total test counts, category/execution/mutation-risk counts, schema count, source HAR files (stored relative to the project root so the committed manifest is machine-independent), and required/optional environment variables.
- `.env.generated.example`: placeholders required by generated paths and payloads, plus optional headers and `BASE_URL`.

## Calibration Workflow

Inferred negative and security tests start life as `test.fixme` guesses tagged `@calibrate`. The calibration loop turns confirmed guesses into active exact-status assertions:

1. `npm run test:api:calibrate` against a seeded staging environment. `CALIBRATION_MODE=true` runs the `@calibrate` tests for real; instead of asserting, each status check records `{label, host, expected, actual}` to `test-results/calibration-results.jsonl` (override the path with `CALIBRATION_OUTPUT_FILE`; the report reads the same variable).
2. `npm run calibrate:report -- --write-overrides` prints a verdict per test — `graduate` (4xx observed: ready to activate), `lenient` (2xx observed: the API accepts the bad input, so the negative expectation is wrong — investigate or drop), `review` (anything else) — and writes `config/calibration-overrides.json` (custom path: `--write-overrides=<path>`; a bare positional argument is always the input results file).
3. Regenerate: `npm run generate -- --har ./examples`. The overrides file is auto-loaded (or pass one explicitly with `--calibration <file>`), and confirmed negatives graduate to active tests asserting the observed status.

`config/calibration-overrides.json` is meant to be committed — it is part of the input the generator consumes, so regeneration stays deterministic for everyone. `--write-overrides` merges with the committed file rather than overwriting it (graduations are a ratchet): graduated tests lose their `@calibrate` tag and are absent from later calibration runs, so prior `graduate`/`lenient` entries survive and fresh results win per `(hostname, title)`. Only `graduate` and `lenient` rows are written; `review` rows are inconclusive and the generator ignores them.

## Architecture

Source modules are intentionally small and testable:

- `src/har`: HAR parsing, filtering, and normalization.
- `src/generator`: fixtures, JSON schemas, Playwright support helpers, and spec generation.
- `src/ai`: deterministic Codex analysis and prompt generation.
- `src/utils`: masking, URL normalization, hashing, and file-system helpers.
- `src/cli`: command-line parsing and config loading.

Project-level defaults live in `config/har-api-tests.config.ts`.

## Secret Handling

Generated files never keep captured Authorization headers, cookies, CSRF values, API keys, passwords, tokens, dynamic IDs, cache busters, or emails. They are replaced with placeholders such as:

- `${API_AUTHORIZATION}`
- `${API_COOKIE}`
- `${API_KEY}`
- `${CSRF_TOKEN}`
- `${TEST_EMAIL}`
- `${TEST_PASSWORD}`
- `${USER_ID}`
- `${CACHE_BUSTER}`

Masking is recursive and depth-aware: it descends into JSON that is encoded as a string (for example an Intercom `user_data` blob), masks form-urlencoded and multipart field values, and sweeps embedded bearer tokens, JWTs, and emails out of free-text/framed payloads (such as socket.io frames). Structural headers (`content-type`, `accept`, etc.) are never treated as secrets, so media types like `application/x-www-form-urlencoded` are preserved verbatim. A `npm run scan:secrets` guard fails the build if any generated artifact still contains an email, JWT, bearer token, or session cookie.

At runtime, generated tests resolve placeholders from environment variables and omit empty secret headers.
Path and request-body placeholders fail fast when required environment variables are missing, so generated tests do not silently call malformed dynamic URLs or send empty credentials. `${CACHE_BUSTER}` defaults to the current timestamp.

Auth state derived during global setup (CSRF token, session cookie, user id, and the login bearer token as `API_TOKEN`/`API_AUTHORIZATION`) is written to a dedicated, gitignored `./.auth/generated-auth.env` file — never your project `.env`. Override the location with `GENERATED_ENV_FILE`.

### Multi-service auth (cookie vs bearer hosts)

A single capture often spans services with different auth: one host uses the session cookie, another expects `Authorization: Bearer <token>` plus a tenant header. The generated runtime supports both:

- The session cookie is auto-attached to every first-party host in the capture (and any `AUTH_COOKIE_DOMAIN` you set).
- For hosts that authenticate with the login bearer token instead, list them in `AUTH_BEARER_HOSTS` (comma-separated). Those requests get `Authorization: Bearer ${API_AUTHORIZATION}` injected automatically.
- Tenant headers captured as named placeholders (e.g. `${X_SITE_UUID}`) are filled from the matching env var.

Example for a Heartpace-style capture where `apps`/`workforce` use bearer + tenant auth:

```bash
AUTH_BEARER_HOSTS=apps.heartpace.dev,workforce.heartpace.dev
X_SITE_UUID=<your-tenant-uuid>
```

Secret headers remain optional at runtime. If a generated header placeholder such as `${API_AUTHORIZATION}`, `${API_COOKIE}`, `${CSRF_TOKEN}`, or `${X_SITE_UUID}` resolves to an empty value, the header is omitted so public endpoint smoke tests can still run.

## CI/CD and Reporting

Fast framework validation runs on every push and pull request:

```bash
npm run ci
```

Generated API tests are split from framework validation because they call live or staging services and require seeded data:

```bash
npm run test:api:smoke
npm run test:api:generated
```

- `test:api:smoke` runs generated tests tagged `@smoke`.
- `test:api:generated` runs the full generated suite and should be used against a stable seeded environment.
- `test:api:calibrate` runs the `@calibrate` tests in recording mode (see the calibration workflow above).
- GitHub Actions runs the smoke suite only when `RUN_GENERATED_API_SMOKE=true` and required secrets such as `BASE_URL` and `USER_ID` are configured. Short-lived auth values (CSRF token, session cookie, bearer token) are derived fresh by the generated global setup, so they are never stored as CI secrets.
- CI regenerates the suite from `./examples` and fails on drift, so the committed `tests/generated/` always matches the generator output.
- Playwright retries failed tests once in CI (`CI=true`) and never locally, so local failures stay loud while CI tolerates one-off flakes.
- Playwright emits list, HTML, JSON, and JUnit reports under `playwright-report/` and `test-results/`.

Runtime knobs for generated tests:

- `BASE_URL` overrides the primary host only; use `BASE_URL_<HOST>` (e.g. `BASE_URL_STAGEAUTOMATION_HEARTPACE_DEV`) to retarget individual hosts in a multi-host capture. Foreign hosts keep their captured origin.
- Response-time checks are a soft warning by default. Set `ASSERT_RESPONSE_TIME=true` to make them hard assertions.
- `run-manifest.json` includes a `schemaCoverage` field (`full` / `partial` / `none`). It is `none` when the capture carried no response bodies, in which case schema and response-field assertions are inert — re-capture with response content to enable them.

For live smoke runs, start with variables from `tests/generated/.env.generated.example` after generation, then provide only the values needed by the selected environment.

## AI/Codex Workflow

The v1 framework does not call OpenAI, OpenAPI, or any live AI provider. With `--ai`, it writes deterministic artifacts that Codex can use as context:

- `har-analysis.json`: grouped endpoint summary, statuses, body/schema hints, and dynamic candidates.
- `codex-test-improvement-prompt.md`: a ready-to-use prompt for improving generated tests.

Future provider integrations can plug into the same analysis output without changing the core generator.

## Validation

```bash
npm run ci
npm run lint
npm run build
npm test
npm run test:api:smoke
```

The integration test starts a local mock API, generates Playwright tests from a temporary HAR, and runs those generated tests against the mock server.

## Limitations

- Generated tests validate observed behavior; they do not infer business rules that are absent from HAR traffic.
- JSON schemas are intentionally shape/type focused and avoid exact assertions for dynamic values. Schemas built from a single observed sample do not emit `required` — one observation cannot prove a field is mandatory.
- Non-JSON responses are replayed with status/content-type checks, but schema validation is only generated for JSON responses.
- OpenAPI ingestion and live AI orchestration are planned extension points, not v1 runtime dependencies.
