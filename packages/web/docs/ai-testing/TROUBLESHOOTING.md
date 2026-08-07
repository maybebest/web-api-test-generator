# Troubleshooting

## Browsers Are Not Installed

```bash
npx playwright install --with-deps
```

## Base URL Is Not Reachable

Set the target app URL:

```bash
npm run fixture:start
```

For local discovery, verify the deterministic fixture is running:

```bash
npm run fixture:start
```

It serves `http://127.0.0.1:3000`. Playwright starts it automatically via `webServer`; discovery commands and manual exploration do not. `PLAYWRIGHT_TEST_BASE_URL` is external-only.

## Generated Test Gate Fails

Validate the spec first:

```bash
npm run ai:spec:validate -- specs/login.md
```

Then review the generated test:

```bash
npm run ai:test:review -- --spec specs/login.md --test tests/regression/login.spec.ts
```

Common causes:

- Spec still contains one or more `NEEDS_REVIEW` markers.
- Missing required spec section.
- Placeholder-only content.
- Missing AC coverage marker.
- Missing Flow Step `AC IDs` mapping.
- Declared `Mocks as JSON` route/value is not structurally registered or referenced by the test.
- `Data Cases as JSON` is malformed or does not match the human-readable Data Cases table.
- Multiple JSON Data Cases or Variants exist but the test does not loop over them (`for (const dataCase of dataCases) { test(...) }`). `@playwright/test` has no `.each`.
- Minimum/duration rules are missing below-minimum, at-minimum, or above-minimum cases.
- Expected channel names, minimum days, generated IDs, or validation-message fragments are missing from generated assertions/data rows.
- Missing or stale spec version/hash header.
- No meaningful `expect` assertion.
- Forbidden `test.only`, XPath, hard wait, unapproved CSS selector, or `nth-child` selector.
- Missing `covered-ac-ids` annotation, step titles without `AC-###` tokens, or an annotation set that does not equal the AC ids named in step titles (single mode).
- Spec metadata `Tags` not declared exactly via the Playwright `{ tag: [...] }` option.
- A `--mode` flag that contradicts the spec's `Generation Mode` metadata (hard error — remove the flag or fix the spec).
- A string-selector action API such as `page.click('css...')` or `page.fill('css...', value)` — forbidden outright in generated tests; act through Page Object/Component Object locators.
- A tautological `expect.poll(...)` producer that folds to a constant, even when written as multiple statements.

### "Forbidden runtime test control found: test.skip"

The review rejects `test.skip`/`test.fixme`/`test.fail` in every form, including runtime or conditional calls inside test bodies. A runtime skip exits 0 without verifying anything. Remove the call and fix the test instead — the executed gate's JSON-report verdict also fails skipped runs.

### "Playwright JSON report shows N skipped test(s)"

The gate runs Playwright with `--reporter=html,json` and fails unless the JSON report shows at least one passing and zero failed or skipped tests for the target file. Remove `test.skip`/`test.fixme` (or whatever causes the skip) so every targeted test really runs.

### Gate fails on a flaky (retry-only) pass

Gate runs fail when a test passed only after a Playwright retry: "passed on retry" is a deterministic-test failure, not a pass. Find the nondeterminism (racing locator, time-dependent data, unmocked external call), fix the test or the Page Object, and re-run until it passes on the first attempt.

### "Auth | required spec must target *.authenticated.spec.ts"

This is a hard validation error in both directions: a spec with `Auth | required` must name its `Target Test File` `<name>.authenticated.spec.ts`, and a spec without required auth must NOT use the `.authenticated.spec.ts` suffix. Rename the `Target Test File` (and the test file itself, if generated) to match the spec's `Auth` value. The suffix is what routes a test to the `chromium-auth` project, so a mismatch would either run an authenticated flow without storage state or silently match zero tests.

### "Stale Generation Status"

A spec marked `Generation Status | pending-generation` whose `Target Test File` already exists on disk fails `ai:test:gate:all` and `ai:spec:validate --strict`. Either set `Generation Status | generated` so the test is gated, or delete the stale test file.

### "Generated test header hash does not match"

The header is compared against the spec's behavioral SHA-256 hash. Regenerate the header via the drift/import workflow: run `npm run ai:spec:drift`, then re-run `npm run ai:generate-test` and update the generated test header from the new task.

## Spec Drift Fails

Run:

```bash
npm run ai:spec:drift
```

If the generated test header hash is stale, re-run:

```bash
npm run ai:generate-test -- specs/login.md --target tests/regression/login.spec.ts
```

Then update the generated test from the new task so the header matches the current spec.

Drift hashing is behavioral. Editing Notes alone should not require a new header, but editing ACs, steps, business rules, data cases, Data Cases as JSON, mocks, variants, includes, or execution metadata should.

## Manual Import Produces A Draft Spec

Imported specs intentionally fail normal validation until deterministic contract values replace every marker:

```bash
npm run ai:spec:import -- --input docs/manual/scenario.md --out specs/scenario.draft.md
npm run ai:spec:validate -- specs/scenario.draft.md --allow-draft
```

Replace `NEEDS_REVIEW` values, confirm rule semantics and boundary data, then run normal validation. No sign-off metadata is required.

## Auth State Is Missing

Auth is disabled by default and unauthenticated projects do not use `storageState`.

To generate auth state for a real non-production app:

```bash
export E2E_AUTH_ENABLED=true
export E2E_AUTH_REUSE_STATE=false
export E2E_AUTH_STATE_PATH=playwright/.auth/user.json
export E2E_LOGIN_PATH=/login
export E2E_USER_EMAIL=test@example.com
export E2E_USER_PASSWORD=<non-production-password>
export E2E_AUTH_SUCCESS_SELECTOR="[data-testid='user-menu']"
npx playwright test --project=chromium-auth
```

Auth setup fails early when required config is missing. It saves `playwright/.auth/user.json` only after login success is asserted by selector or URL regex.

To reuse an existing non-committed Playwright storage state file instead of running login setup:

```bash
export E2E_AUTH_ENABLED=true
export E2E_AUTH_REUSE_STATE=true
export E2E_AUTH_STATE_PATH=playwright/.auth/user.json
npx playwright test tests/regression/media-planner-minimum-campaign-duration.authenticated.spec.ts --project=chromium-auth
```

If the reviewed non-production hostname does not contain a `dev`, `test`, `stage`, `qa`, `uat`,
`sandbox`, or `preview` label, also export its exact hostname through
`E2E_AUTH_ALLOWED_HOSTS`. Production-like unclassified hosts fail before test collection.

Specs with `Auth | required` must name their `Target Test File` `<name>.authenticated.spec.ts` (a hard validation error otherwise, and non-auth specs must not use the suffix — see "Auth | required spec must target *.authenticated.spec.ts" above): the `chromium-auth` project selects tests by `/.*\.authenticated\.spec\.ts/` and every non-auth browser project ignores that pattern, so an old non-`.authenticated` filename can never match `chromium-auth`.

Auth-required generated specs run on `chromium-auth`. When `E2E_AUTH_ENABLED` is not true, `npm run ai:test:gate:all` still validates and statically reviews those specs, then skips live browser execution with an explicit message.

For the Media Planner duration validation flow, configure:

```bash
export PLAYWRIGHT_TEST_BASE_URL=https://www.dev.rtd.js-devops.co.uk/
export E2E_AUTH_ENABLED=true
export E2E_MP_DD_COMPETITION_PAGE_MIN_DURATION_DAYS=<configured-channel-minimum>
```

Any Media Planner spec still marked `Generation Status | pending-generation` has no claimed target test. The normal `ai:test:gate:all` and strict validation fail closed until the required live contract and preconditions are available and the target test is committed. Use `--allow-draft` only for an explicitly structural, non-release validation.

Then provide the normal auth setup variables or a valid non-committed storage state through the authenticated project workflow.

## Flaky Locator

Use `ai/prompts/04-heal-locator.md`. Capture a Playwright CLI snapshot, identify the equivalent accessible element, update the locator minimally, and rerun the affected test. For a verified automated proposal, run:

```bash
# Safe default: verified proposal, target unchanged
AI_AUTOHEAL_ENABLED=true npm run ai:test:heal -- --test tests/recorded/checkout-confirmation.spec.ts

# Explicit promotion of a clean target
AI_AUTOHEAL_ENABLED=true npm run ai:test:heal -- --test tests/recorded/checkout-confirmation.spec.ts --apply

# Explicitly accept an already-dirty starting target
AI_AUTOHEAL_ENABLED=true npm run ai:test:heal -- --test tests/recorded/checkout-confirmation.spec.ts --apply --allow-dirty
```

Status meanings are precise: `already-green` means the baseline passed, so there is no provider
invocation or proposal archive. `proposal-ready` occurs only in default non-mutating mode after a
repairable failing target produces a fully verified single-test candidate. `not-repairable` ends
without a healing proposal or provider invocation; an environment failure aborts healing rather
than continuing to the provider. `manual-change-required` means evidence points to Page Object or
Component ownership: imported Page Object/Component source is context-only and never
auto-promoted. `healed` occurs only after explicit `--apply`, full verification, and every
integrity/concurrency rule; a dirty-at-start target is allowed only with explicit `--allow-dirty`.

Only `locator-drift` and `synchronization` runtime failures are eligible. Product, auth, network,
data, assertion-mismatch, and unclassified failures are not repairable. A `--dom-snapshot` must be
a verified selector-discovery artifact under `.ai-runs/dom-discovery/`; the healer accepts at most
the fixed 64 KiB context. Recorded tests go through the recorded reviewer before runtime
verification.

For an intentional functionality change, begin by updating the Markdown spec, its version, the
affected acceptance criteria, and data cases. Do not heal an expectation to match a product change.

## Visual Snapshot Mismatch

Visual tests are opt-in through `ENABLE_VISUAL_TESTS=true` and run only in the `chromium` project (firefox/webkit/mobile-chrome `testIgnore` `tests/visual/`). Screenshot comparison policy is centralized in `playwright.config.ts`: `maxDiffPixelRatio: 0.01`, animations disabled, baselines under `tests/__screenshots__/{testFilePath}/{projectName}-{platform}/`. Review the diff carefully, update baselines only for intentional UI changes, and keep visual checks out of blocking CI until the team approves stable baselines.

## ai:clean:check Fails On Leftover Artifacts

`npm run ai:clean:check` ignores empty directories and `.gitkeep`/`.DS_Store` placeholders; if it fails, there is a real runtime file in the listed directory (e.g. under `.ai-runs/` or `playwright-report/`). Delete the listed files — recursively empty leftovers such as a stale `.ai-runs/gate-*/evidence/` no longer fail the check.

## Allure Report Generation Fails (Missing Java)

`npm run allure:generate`, `allure:open`, and `allure:serve` use `allure-commandline`, which requires a Java runtime (JRE 8+) on `PATH`. If the command fails with an error like `Unable to locate a Java Runtime` or `JAVA_HOME is not set`, install a JRE/JDK or set `JAVA_HOME`. Test runs themselves do not need Java — only report generation does. Set `ALLURE_ENABLED=false` to disable the Allure reporter entirely.

## CI Dependency Issue

Confirm CI uses the detected package manager, installs dependencies, and runs:

```bash
npx playwright install --with-deps
```

Note: CI itself installs browsers per need (quality job: chromium only; regression matrix: only the matrix project's engine, with `chromium-auth`/`mobile-chrome` mapping to chromium). `npm run pw:install` remains the full local install of all engines.

## Trace And Report Usage

```bash
npx playwright show-report
npx playwright show-trace path/to/trace.zip
```

## MCP Is Not Configured

MCP is optional. Use the Playwright CLI workflow when MCP is unavailable. If your environment supports MCP, add the server with the mandatory `--allowed-origins` boundary (mirrors `agent-browser.json` `allowedDomains`; see `ai/workflows/playwright-mcp-workflow.md`):

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

## Playwright CLI Is Not Installed Globally

Use the fallback (the package is `@playwright/cli`; the old unscoped `playwright-cli` npm package is deprecated and must not be used):

```bash
npx @playwright/cli --help
```

Prefer pinning a version (e.g. `npx @playwright/cli@<version>`) over a floating `@latest` so exploration sessions stay reproducible.
