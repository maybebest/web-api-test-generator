# HAR API Test Generator

Production-minded TypeScript framework for turning browser HAR captures into maintainable Playwright API tests.

## What It Does

- Parses one or more `.har`, `.json`, or `.md` capture files from a file path or folder.
- Filters static assets, frontend bundles, fonts, images, analytics/tracking hosts, and telemetry beacon paths. Supports a `--first-party` allowlist to drop everything except your own API hosts.
- Normalizes API requests by domain, method, path, query, headers, bodies, status, content type, and timing.
- Masks secrets — including secrets nested inside JSON-encoded strings and form/multipart bodies — before writing generated code or fixtures.
- Generates a **smoke tier** (one repeatable test per endpoint, for every method) plus an **extended tier** (capture-bounded resource flows, deterministic request-body/path negatives, and auth/security checks).
- Marks generated tests with metadata for origin, category, confidence, execution mode, and mutation risk.
- Supports an automated calibration loop: pending inferred negatives run in record-only mode, and machine evidence deterministically activates or skips them.
- Generates Playwright API tests with status, content type, soft response-time, secret-leak, and AJV JSON-schema assertions. Compatible response samples from the same endpoint are combined so required fields are inferred only from repeated evidence.
- Routes each captured host independently (`BASE_URL_<HOST>`), so multi-host captures do not collapse onto one origin.
- Preserves duplicate query parameters in capture order by default and produces request-aware, loopback-only replay contracts that match the original host, query, stable headers, content type, and body.
- Fails closed for live traffic and credentials: requests and secret headers are routed only to explicitly configured exact origins.
- Emits Codex-ready analysis artifacts when `--ai` is enabled.

## Quick Start

```bash
npm install
npm run build
npm test
npm run generate -- --har ./examples/session.har --out ./test-results/generated-example --base-url https://api.example.test --first-party example.test --ai
```

The sample writes nine tests to the gitignored `test-results/generated-example/` directory, leaving
the committed project suite in `tests/generated/` untouched.

## CLI

```bash
npm run generate -- \
  --har ./examples/session.har \
  --out ./test-results/generated-example \
  --base-url https://api.example.test \
  --include "/v1/" \
  --exclude "analytics" \
  --ignore-domain google-analytics.com \
  --first-party example.test \
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
- `--out`: generated output directory. Defaults to `./tests/generated`. A non-empty directory is
  replaced only when its ownership marker and complete file inventory prove it is unchanged output
  from this generator; arbitrary or locally modified directories are rejected without deletion.
- `--base-url`: overrides captured base URLs in generated tests.
- `--include`: include only URLs matching a regex or substring.
- `--exclude`: exclude URLs matching a regex or substring.
- `--ignore-domain`: ignore a hostname or parent domain.
- `--first-party`: keep only these hosts (and their subdomains); drops all other hosts. Repeatable/comma-separated. The highest-leverage knob for cutting third-party noise.
- `--method`: include selected HTTP methods.
- `--status`: include selected response statuses.
- `--generation-mode`: `smoke`, `extended`, or a comma-separated combination. The built-in config defaults to both. (Legacy `replay`→`smoke`, `inferred`/`scenario`→`extended` are accepted.)
- `--inference-level`: `conservative`, `balanced`, or `aggressive`. The built-in config defaults to `balanced`.
- `--inferred-run-mode`: `mixed`, `all-active`, or `replay-only`. The built-in config defaults to `mixed`.
- `--negative-status-policy`: `family`, `strict`, or `config`. The built-in config defaults to `family`.
- `--mutation-policy`: `guarded`, `all-skipped`, or `all-active`. The built-in config defaults to `guarded`: guarded mutations are active and unsafe mutations are skipped. `all-skipped` suppresses every mutation; `all-active` also activates unsafe mutations, except flows rejected for missing identifier correlation.
- `--preserve-duplicate-query-params`: preserve repeated query keys and their capture order. Enabled by default; pass `--preserve-duplicate-query-params=false` only when intentionally restoring last-value collapsing.
- `--calibration`: load a calibration overrides file (array of `{title, hostname?, observedStatus}`). `config/calibration-overrides.json` is auto-loaded when present.
- `--ai`: write `har-analysis.json` and `codex-test-improvement-prompt.md`.
- `--dry-run`: print the generation summary without writing files.
- `--config`: load a custom config file.

An omitted generation option leaves the loaded config unchanged; only an explicitly supplied CLI option overrides it. Unknown options, missing values, and non-boolean values for boolean flags fail fast.

## Generation Logic

The generator runs a planner between normalization and code generation:

```text
HAR entries -> parse/filter/normalize -> test planner -> Playwright generator
```

The planner produces two tiers:

**Smoke tier** (`@smoke`) — exactly one repeatable test per `(host, method, path, query-key shape)` endpoint, for **every** method including mutating ones. Each is a reworked recording of the observed request (secrets and dynamic values replaced with placeholders). The most informative observed sample (successful, with request/response bodies) is chosen as the representative, while distinct compatible response samples contribute to its schema.

**Extended tier** (`@extended`) — built on the smoke endpoints:

- `crud`: resource flows grouped by capture source, host, and collection path, ordered create → read → update → delete. A flow never joins requests from different HAR files or origins. When both create and delete are observed the delete runs last, so the flow cleans up after itself (`mutationRisk: guarded`); otherwise it is `unsafe` and the default policy skips it automatically.
- `negative`: deterministic missing-field, invalid-type, null/empty, numeric-boundary, query, and dynamic-path variants, according to the selected inference level and only where the observed request supports the inference.
- `security`: missing or invalid auth, cookie, API key, or CSRF headers.
- `scenario`: chronological flows such as login → account/session → logout, bounded to one capture source and host. Capture timestamps are used when present; file entry order is the deterministic fallback.

The planner records correlation status for every scenario: `not-required` for read-only flows, `static` when steps reuse a captured environment placeholder, and `missing` when a mutating flow has no demonstrated correlation. Generated scenarios replay observed values; they do not claim to extract an ID from one response and feed it into the next request.

Every generated test is labeled in a comment:

```ts
// origin: inferred | category: negative | confidence: high | execution: active | mutationRisk: guarded
```

Each test also receives one or more service tags, such as `@auth`, `@profile`, or `@hiring`. State-changing tests are additionally tagged `@mutating`; pending inferred negative/security tests receive `@calibrate` for the automated calibration lane below.

Execution is decided entirely by framework policy and has three states:

- `active`: runs in normal generated-suite commands. Read-only tests and guarded mutations use this state by default.
- `calibrate`: is skipped in normal runs and executed automatically by `npm run calibrate:auto`, which records evidence without asserting the provisional status. A 4xx observation promotes the case to `active` with an exact status; a 2xx observation moves the invalid negative expectation to `skip`; other statuses remain `calibrate` for the next automated run.
- `skip`: is a final machine decision for cases rejected by policy or correctness checks, including unsafe mutations under the default `guarded` policy and scenarios with missing identifier correlation. It is not a pending queue.
- `--mutation-policy all-skipped` skips every mutation. `all-active` activates unsafe mutations, but never overrides a missing-correlation correctness rejection.
- `--inferred-run-mode all-active` runs inferred validation directly; `replay-only` skips inferred cases.
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

Generation is transactional: the complete suite is written to a sibling staging directory and is
only swapped into place after every artifact and ownership marker is ready. The previous suite is
restored if publishing fails. If filters produce zero planned tests, a normal generation command
fails without touching existing output; use `--dry-run` when deliberately inspecting an empty plan.
The `.har-api-tests-generated.json` v2 marker records a hash of the complete generated inventory and
portable provenance for source content, effective config/options, calibration input, and generator
build. A verified repeat with the same provenance returns `publication: "unchanged"` without
rewriting or swapping the output. Local additions or edits are never silently deleted by a later regeneration. If cleanup of the
previous-output backup fails after a successful swap, the complete new output remains in place and
the residual backup path is reported; a potentially partial backup is never restored over a
complete suite.

The JSON generation summary reports `published`, `unchanged`, or `dry-run`, along with phase timings
for parse, filter, normalize, calibration, provenance, planning, ownership verification, write,
marker, publish, and total duration. The core and `--ai` paths make no model/provider calls, so AI
token usage is exactly zero; the summary exposes that fact in `llmUsage` (requests, retries, input,
output, cached, reasoning, retry, and total tokens all remain zero). `--ai` only writes deterministic local analysis artifacts.

Generated output also includes production-readiness metadata:

- `run-manifest.json`: total test counts, category/execution/mutation-risk/correlation counts, schema count, source HAR files (stored relative to the project root so the committed manifest is machine-independent), and required/optional environment variables.
- `.env.generated.example`: placeholders required by generated paths and payloads, plus optional headers and `BASE_URL`.

## Automated Calibration Workflow

Pending inferred negative and security cases use execution state `calibrate` and tag `@calibrate`. They are quarantined from normal runs while the framework gathers evidence automatically:

1. Configure the seeded target through `BASE_URL`, exact `TRUSTED_API_ORIGINS`, and the required test/auth values.
2. Run `npm run calibrate:auto`. It executes the calibration suite in record-only mode and then runs `calibrate:report`, so no separate decision or write command is needed. Each result is recorded as `{label, host, expected, actual}` in `test-results/calibration-results.jsonl`; override the location with `CALIBRATION_OUTPUT_FILE`.
3. The report classifies 4xx as `confirmed`, 2xx as `lenient`, and other statuses as `inconclusive`. Confirmed and lenient decisions are merged atomically into `config/calibration-overrides.json` by default; inconclusive cases remain in the automated calibration lane.
4. Regenerate with `npm run generate -- --har ./examples`. The overrides file is loaded automatically (or pass `--calibration <file>`), producing exact active assertions for confirmed cases and deterministic skips for lenient cases.

`npm run calibrate:report` can process an existing JSONL file independently and also writes decisions by default. Use `--no-write-overrides` only for a read-only diagnostic report, or `--write-overrides=<path>` for a custom output. Existing evidence is merged by `(hostname, title)`, fresh results win, and prior decisions survive when promoted cases are absent from later calibration runs. The overrides file is a deterministic generator input and can be committed with the generated suite.

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

Masking is recursive and depth-aware: it descends into JSON that is encoded as a string (for example an Intercom `user_data` blob), masks form-urlencoded and multipart field values, and sweeps embedded bearer tokens, JWTs, and emails out of free-text/framed payloads (such as socket.io frames). Structural headers (`content-type`, `accept`, etc.) are never treated as secrets, so media types like `application/x-www-form-urlencoded` are preserved verbatim. A `npm run scan:secrets` guard fails the build if any generated artifact still contains an email, JWT, bearer token, or session cookie. The scan also fails closed if Git cannot enumerate tracked files or if a configured scan matches no files; an empty scan can never report success.

Form-urlencoded captures are parsed strictly. Invalid percent/UTF-8 escapes and disagreement between `postData.text` and `postData.params` stop generation instead of being repaired into a different valid request.

At runtime, generated tests resolve placeholders from environment variables and omit empty secret headers.
Path and request-body placeholders fail fast when required environment variables are missing, so generated tests do not silently call malformed dynamic URLs or send empty credentials. `${CACHE_BUSTER}` defaults to the current timestamp.

### Live execution safety

Generated code refuses network traffic unless the target is explicitly trusted:

- Normal/live mode requires a non-empty comma-separated `TRUSTED_API_ORIGINS` list. Entries are exact origins such as `https://staging-api.example.test:8443`, not host suffixes or URL prefixes. A `BASE_URL` override changes routing but never grants trust.
- `POST`, `PUT`, `PATCH`, and `DELETE` follow the generated execution state and `--mutation-policy`; there is no second runtime switch. Under the default `guarded` policy, guarded mutations are active and unsafe mutations are skipped automatically.
- Replay mode accepts only the exact `HAR_API_REPLAY_ORIGIN`, and that origin must use a loopback hostname. It cannot be repointed at a live host.
- TLS verification is strict by default. `API_IGNORE_HTTPS_ERRORS=true` and `AUTH_IGNORE_HTTPS_ERRORS=true` are explicit, local-only escape hatches for a known self-signed environment.

### Authentication setup

Authentication is off by default with `AUTH_STRATEGY=none`. Use `AUTH_STRATEGY=static-env` to supply placeholders directly. To perform a login in global setup, configure `AUTH_STRATEGY=http-login`, `AUTH_LOGIN_URL`, and `AUTH_LOGIN_BODY`; the strategy is the single activation source, with no second enable flag or product-specific fallback. The login URL must belong to `TRUSTED_API_ORIGINS`. Optional knobs include `AUTH_LOGIN_METHOD`, `AUTH_LOGIN_CONTENT_TYPE`, `AUTH_LOGIN_HEADERS`, and the CSRF extraction settings.

Auth state derived during HTTP login (CSRF token, session cookie, user id, and the login bearer token as `API_TOKEN`/`API_AUTHORIZATION`) is published atomically as one complete, owner-only snapshot in the dedicated, gitignored `./.auth/generated-auth.env` file — never your project `.env`. The file carries an ownership marker; an unmarked regular file selected through `GENERATED_ENV_FILE` is never read, replaced, or deleted. Setup removes the previous owned snapshot before login, so a failed login or a response that omits one field cannot reuse another user/environment's value. The fresh snapshot is authoritative only while the HTTP-login strategy is enabled.

### Multi-service auth (cookie vs bearer hosts)

A single capture often spans services with different auth: one host uses the session cookie, another expects `Authorization: Bearer <token>` plus a tenant header. The generated runtime supports both without sending either credential to every captured service:

- List exact origins that may receive the session cookie in `AUTH_COOKIE_ORIGINS` (comma-separated).
- List exact origins that may receive the login bearer token in `AUTH_BEARER_ORIGINS`.
- Use `AUTH_API_KEY_ORIGINS` for captured API-key headers and `AUTH_SECRET_HEADER_ORIGINS` for any additional header configured as secret.
- These allowlists govern captured secret-header placeholders as well as automatic injection. A trusted API origin does not receive a credential unless the matching credential allowlist also contains that exact origin.
- Tenant headers captured as named placeholders (e.g. `${X_SITE_UUID}`) are filled from the matching env var.

Example for a Heartpace-style capture where `apps`/`workforce` use bearer + tenant auth:

```bash
AUTH_BEARER_ORIGINS=https://apps.heartpace.dev,https://workforce.heartpace.dev
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
npm run test:api:smoke:mutating
npm run test:api:generated
```

- `test:api:smoke` runs only non-mutating generated tests tagged `@smoke`.
- `test:api:smoke:mutating` selects active mutating smoke tests separately. The target must belong to exact `TRUSTED_API_ORIGINS`.
- `test:api:replay` runs the committed smoke tier against the credential-free local replay server;
  CI always runs this lane, including payload-placeholder preflight checks. Its manifest must be
  valid and non-empty, every captured host is forcibly routed to loopback, and each request must
  match its declared original host, method, path/query, stable headers, content type, and body.
  Ambient live/auth values are overridden, port reuse is forbidden, and undeclared or mismatched
  requests return an error rather than falling through.
- `test:api:generated` runs the full generated suite and should be used against a stable seeded environment.
- `test:api:calibrate` runs only the `calibrate`/`@calibrate` cases in recording mode; `calibrate:auto` follows it with the evidence report and atomic override update.
- Pull-request and scheduled CI are credential-free and run only deterministic validation plus mock-backed replay. Live checks run in a separate job only from `main`/`master` after merge (or a dispatch of that same trusted branch) when `RUN_API_LIVE=true`. The machine gate requires HTTPS, exact `TRUSTED_API_ORIGINS`, and `API_ENVIRONMENT_CLASS=ephemeral|qa|staging`. Mutating smoke and calibration additionally require their own run flags and `API_MUTATION_SCOPE=disposable`; no in-framework human approval is involved.
- For HTTP-login setup in CI, configure `AUTH_STRATEGY=http-login`, `AUTH_LOGIN_URL`, and `AUTH_LOGIN_BODY`. Derived short-lived auth state is written only to the job workspace, not stored as a repository secret.
- CI regenerates the suite and fails on drift when every source capture recorded in
  `run-manifest.json` is present. Raw captures can be intentionally gitignored because they contain
  secrets; when those sources are absent, CI reports the drift check as skipped and relies on the
  mandatory mock-backed replay to execute the committed generated suite.
- Playwright retries are disabled in every environment. Generated smoke cases can mutate state, so an automatic retry could execute the same write twice and conceal nondeterminism.
- Playwright emits list, HTML, JSON, and JUnit reports under `playwright-report/` and `test-results/`.

Runtime knobs for generated tests:

- `BASE_URL` overrides the primary host only; use `BASE_URL_<HOST>` (e.g. `BASE_URL_STAGEAUTOMATION_HEARTPACE_DEV`) to retarget individual hosts in a multi-host capture. Foreign hosts keep their captured origin.
- Response-time checks are a soft warning by default. Set `ASSERT_RESPONSE_TIME=true` to make them hard assertions.
- `run-manifest.json` includes a `schemaCoverage` field (`full` / `partial` / `none`). It is `none` when the capture carried no response bodies, in which case schema and response-field assertions are inert — re-capture with response content to enable them.

For live smoke runs, start with variables from `tests/generated/.env.generated.example` after generation, then provide only the values needed by the selected environment.

Example read-only invocation (the trusted origin must exactly match the resolved request origin):

```bash
TRUSTED_API_ORIGINS=https://staging-api.example.test \
BASE_URL=https://staging-api.example.test \
npm run test:api:smoke
```

Mutating smoke is a separate selection and uses the planner's deterministic risk policy. Point it at an isolated, seeded trusted environment:

```bash
TRUSTED_API_ORIGINS=https://isolated-api.example.test \
BASE_URL=https://isolated-api.example.test \
npm run test:api:smoke:mutating
```

Run pending inferred contracts and persist the evidence decisions automatically:

```bash
TRUSTED_API_ORIGINS=https://isolated-api.example.test \
BASE_URL=https://isolated-api.example.test \
npm run calibrate:auto
```

## AI/Codex Workflow

The framework does not call OpenAI, OpenAPI, or any live AI provider. With `--ai`, it writes deterministic artifacts that Codex can use as context:

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
- JSON schemas are intentionally shape/type focused and avoid exact assertions for dynamic values. One observed response cannot prove a field is mandatory, so a single-sample schema does not emit `required`. When the same endpoint/status has multiple compatible captured responses, a field becomes required only when it appears in every sample.
- Non-JSON responses are replayed with status/content-type checks, but schema validation is only generated for JSON responses.
- OpenAPI ingestion and live AI orchestration are planned extension points, not v1 runtime dependencies.
