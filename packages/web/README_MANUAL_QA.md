# Manual QA Guide

Simple guide for using this AI-assisted Playwright framework to turn manual test cases into generated UI tests.

## What This Framework Does

- Uses Playwright for UI automation.
- Uses Codex to help create specs, Page Objects, and tests.
- Generates one focused test by default.
- Generates a test suite only when the spec declares `Generation Mode | suite` or you explicitly ask for a suite.
- Runs generated tests in Chromium by default.

## Preconditions

- The application under test is available locally or on an approved non-production URL.
- Deterministic local checks use the committed fixture at `http://127.0.0.1:3000/`; Playwright starts it automatically.
- You have access to this repository.
- You have Codex available and can ask it to edit files in this repo.
- Do not use production credentials.
- Do not commit auth state, cookies, tokens, traces, screenshots, or videos with sensitive data.

## Setup

Install or select Node with `nvm` (the project requires Node >= 20; CI runs Node 22):

```bash
nvm install 22
nvm use 22
```

Install packages:

```bash
npm ci
```

Install Playwright browsers:

```bash
npm run pw:install
```

Optional browser discovery tool:

```bash
npm run ai:browser:install
npm run ai:browser:doctor
```

Check the framework:

```bash
npm run typecheck
npm run ai:test:self
```

Start the deterministic fixture when you need it outside `playwright test`:

```bash
npm run fixture:start
```

It serves `http://127.0.0.1:3000`. `PLAYWRIGHT_TEST_BASE_URL` is only for explicit external non-production runs.

## Input Data Format

Give Codex a clear manual test case. Keep it boring and explicit.

Example:

```text
Create a single Playwright UI test.

Title: Login with email verification code
URL: http://127.0.0.1:3000/

Steps:
1. Open / and wait for the auth entry screen.
2. Enter email and click continue.
3. Wait for the verification-code screen.
4. Enter verification code.
5. Click verification continue if it is shown.
6. If this is a first-time user, complete profile details.
7. Verify final authentication outcome.

Test data:
- Email: qa.user@example.test
- Verification code: 1234
- First name: QA
- Last name: Test
- Birth date: 1993-05-19

Expected result:
- User redirects to /psychics, or a visible local auth failure/blocking signal is shown.

Notes:
- Local login may fail after the code is entered. This is acceptable.
```

## Ask Codex For One Test

Use this wording when you want one test only:

```text
Using the solution in the root folder, generate a single Playwright UI test from this manual test case.
Use the framework rules:
- default generation mode is single-test mode
- use Page Objects for locators
- only the final assertion step should contain expect(...)
- run generated-test review, gate, and spec drift after implementation

<paste manual test case here>
```

Codex should create or update:

- a spec under `specs/`
- a generated test under `tests/`
- Page Objects under `pages/` when needed
- a generation run under `.ai-runs/`

## Ask Codex For A Suite

Use this wording only when you want multiple tests:

```text
Using the solution in the root folder, generate a Playwright UI test suite for every acceptance criterion in this manual test case.
Use suite generation mode.
Each test must verify one clear outcome and only its final assertion step should contain expect(...).

<paste manual test case here>
```

Suite mode should be explicit. Do not say "suite" unless you really want multiple tests.

## Normal Workflow

1. Create or update a spec from the manual test case.

   Start from:

   ```text
   specs/_template.md
   ```

   For raw Gherkin, checklist, or manual notes:

   ```bash
   npm run ai:spec:import -- --input docs/manual/<case>.md --out specs/<flow>.draft.md
   ```

2. Validate the spec:

   ```bash
   npm run ai:spec:validate -- specs/<flow>.md
   ```

3. Optional: collect DOM evidence before choosing locators:

   ```bash
   npm run ai:dom:discover -- --spec specs/<flow>.md --url http://127.0.0.1:3000/
   npm run ai:dom:discover:review -- --spec specs/<flow>.md
   ```

4. Create a generation task.

   Single test, default:

   ```bash
   npm run ai:generate-test -- specs/<flow>.md --target tests/regression/<flow>.spec.ts
   ```

   Suite, explicit:

   ```bash
   npm run ai:generate-test -- specs/<flow>.md --target tests/regression/<flow>.spec.ts --mode suite
   ```

5. Ask Codex to implement the generated task file from `.ai-runs/<run>/generation-task.md`.

6. Review and run the generated test:

   ```bash
   npm run ai:test:review -- --spec specs/<flow>.md --test tests/regression/<flow>.spec.ts
   npm run ai:test:gate -- --spec specs/<flow>.md --test tests/regression/<flow>.spec.ts
   npm run ai:spec:drift
   ```

If the spec declares `Generation Mode | suite` in Metadata, omit `--mode` — review and gate resolve it automatically. Passing a `--mode` that contradicts the spec is a hard error. The `--mode suite`/`--mode single` flags still work for specs that declare no `Generation Mode` row:

```bash
npm run ai:test:review -- --spec specs/<flow>.md --test tests/regression/<flow>.spec.ts --mode suite
npm run ai:test:gate -- --spec specs/<flow>.md --test tests/regression/<flow>.spec.ts --mode suite
```

## Run In Playwright UI Mode

Open generated/spec-bound tests in UI mode:

```bash
npm run ai:test:ui:generated
```

For one spec:

```bash
npm run ai:test:ui:generated -- --spec specs/<flow>.md --project chromium
```

## Important Rules

- Default generation mode is single-test mode.
- Generate a suite only when the spec declares `Generation Mode | suite` or a suite is explicitly requested.
- Default generated-test execution target is Chromium only.
- Cross-browser generated-test execution is opt-in.
- Put all locators in Page Objects or Component Objects.
- Do not create `page.getBy*` or `page.locator(...)` locators directly inside generated tests.
- Do not call string-selector action APIs like `page.click('css...')` or `page.fill('css...', value)` — they are forbidden outright; act through Page Object locators.
- Prefer stable meaningful `data-testid`, then role, label, placeholder, stable text.
- Do not use XPath.
- Do not use hard waits like `page.waitForTimeout`.
- Do not use `test.only`, `describe.only`, or `it.only`.
- Do not use `test.skip`, `test.fixme`, or `test.fail` in any form, including runtime calls inside test bodies.
- Do not remove assertions just to make a test pass.
- Only the final `Assert AC-###` or `Assert NEG-###` step should contain `expect(...)`.
- In single mode the primary test declares a `covered-ac-ids` annotation, every step title carries `AC-###` tokens, and the spec `Tags` are declared exactly via the Playwright `{ tag: [...] }` option (the review enforces all three).

## Useful Commands

```bash
npm run typecheck
npm run ai:test:self
npm run fixture:start
npm run ai:spec:validate -- specs/<flow>.md
npm run ai:generate-test -- specs/<flow>.md --target tests/regression/<flow>.spec.ts
npm run ai:test:review -- --spec specs/<flow>.md --test tests/regression/<flow>.spec.ts
npm run ai:test:gate -- --spec specs/<flow>.md --test tests/regression/<flow>.spec.ts
npm run ai:spec:drift
npm run test:e2e:report
```

## Common Problems

If the local fixture is not running, start it first:

```bash
npm run fixture:start
```

Then point the gate at it:

```bash
PLAYWRIGHT_TEST_BASE_URL=https://your-non-production-host.example E2E_AUTH_ENABLED=true npm run ai:test:gate -- --spec specs/<flow>.md --test tests/regression/<flow>.authenticated.spec.ts
```

If a locator is flaky, ask Codex to collect DOM evidence first:

```text
Collect DOM discovery evidence for this spec, review it, then update the Page Object locators.
```

If a generated test has many assertions in every step, ask Codex to fix it:

```text
Refactor this generated test to single-responsibility assertion style.
Keep setup/action steps assertion-free.
Only the final Assert AC-### or Assert NEG-### step may contain expect(...).
```

## Where To Look

- Specs: `specs/`
- Generated tests: `tests/`
- Page Objects: `pages/`
- Generation runs: `.ai-runs/`
- Framework docs: `docs/ai-testing/`
- Main rules for Codex: `AGENTS.md`
