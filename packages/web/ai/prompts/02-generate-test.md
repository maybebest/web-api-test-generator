# Generate Deterministic Playwright Tests

## Contract

The Markdown spec is the contract.
The generated Playwright test is the implementation.
The gate is the acceptance check.

Do not generate tests from memory or from loose notes. Start from a spec that passes the deterministic validator and follows `specs/_template.md`. If the input is raw Gherkin, a checklist, or a manual test case, first create a draft spec with `npm run ai:spec:import`, resolve every `NEEDS_REVIEW` marker, and run the automated policy gates before implementation.

## Workflow

1. Validate the spec:

```bash
npm run ai:spec:validate -- <spec-path>
```

2. Create or read the deterministic generation task:

```bash
npm run ai:generate-test -- <spec-path> --target <target-test-file>
```

Default generation mode is single-test mode. A spec may declare its mode in the optional `Generation Mode` Metadata row (`single` or `suite`); the tooling resolves that automatically, so prefer setting the spec metadata over passing flags. Generate a suite only when the spec declares `Generation Mode | suite` or the user explicitly requests it with `--mode suite` or equivalent wording such as "full suite" or "all AC tests". A `--mode` flag that contradicts the spec's `Generation Mode` is a hard error.

If current UI evidence is needed before selecting locators, run DOM discovery first:

```bash
npm run ai:dom:discover -- --spec <spec-path> --url <target-url>
npm run ai:dom:discover:review -- --spec <spec-path>
npm run ai:generate-test -- <spec-path> --target <target-test-file>
```

Treat the discovery artifact as evidence only. Do not copy `agent-browser` refs such as `@e1` into tests.

3. Implement the generated test:

- Add the exact generated header comment with spec path, spec version, and spec hash. The hash must be the real behavioral hash of the spec — the reviewer recomputes and compares it.
- Import from `fixtures/test`.
- Use `test.step`.
- Declare the spec metadata `Tags` exactly (set equality) on the describe block or test via the Playwright tag option, e.g. `test('title', { tag: ['@generated', '@regression'] }, async ({ page }) => { ... })`.
- In default single-test mode, generate exactly one primary `test(...)` block for the requested scenario/business outcome, plus optionally one test per spec Negative Case.
- The single-mode primary test must declare a covered-ac-ids annotation: `test.info().annotations.push({ type: 'covered-ac-ids', description: 'AC-001 AC-002 ...' })`. Every annotated AC must exist in the spec, and the annotation set must equal the AC ids named in the primary test's step titles.
- In the single-mode primary test, every `test.step` title must name the AC id(s) it exercises as `AC-###` tokens, e.g. `Arrange AC-001: open auth entry screen`, `Assert AC-006: redirected to /psychics`.
- Optional single-mode NEG tests must name their `NEG-###` id in the test title and in every step title, and end with an `Assert NEG-###: ...` step containing at least one meaningful expect. Uncovered NEG ids produce a non-blocking review warning.
- In explicit suite mode, split broad flows into focused tests. Each generated test verifies one clear functionality or business outcome. NEG coverage is required in suite mode.
- Suite-mode authoring is subtle (per-AC static `Assert AC-###` step titles, at most one AC per step, one test per NEG, the data-case loop vs static-title tension). Read `docs/ai-testing/SUITE_MODE_RULES.md` and the worked example `tests/regression/media-planner-booking-deadline.authenticated.spec.ts` before generating a suite.
- Use action/setup steps for navigation and inputs, then one final assertion step.
- The final assertion step must be titled `Assert AC-###: ...` or `Assert NEG-###: ...` and name exactly one AC or negative-case ID.
- Do not put `expect(...)` in every `test.step`. Assertions belong only in the final assertion step for that test.
- Multiple assertions are allowed only inside that final step and only when they prove the same outcome, such as a URL plus a stable page-root signal.
- Put all locators in Page Objects or Component Objects. Generated tests must not call `page.getByTestId`, `page.getByRole`, `page.getByLabel`, `page.getByPlaceholder`, `page.getByText`, or `page.locator` directly.
- Use locator priority order inside Page Objects/Component Objects:
  1. `this.page.getByTestId(...)` when a meaningful `data-testid` exists and is stable.
  2. `this.page.getByRole(...)` with accessible name.
  3. `this.page.getByLabel(...)`.
  4. `this.page.getByPlaceholder(...)`.
  5. `this.page.getByText(...)` only for stable visible copy.
  6. Raw CSS only with `// locator-policy:exception <reason>`.
- Use the framework selector policy and any reviewed DOM discovery artifact for locator candidates.
- In single-test mode, the final assertion step names the primary AC/NEG ID and AC IDs may appear as comments or annotations when useful.
- In suite mode, add final assertion-step coverage for every AC ID.
- Add meaningful assertions for user-visible behavior.
- Honor Flow Step `AC IDs` mappings.
- Use `Mocks as JSON` for deterministic API mocks when present.
- Implement `Business Rules` with direct assertions of the rule outcome.
- Use `Data Cases as JSON` as the machine-readable boundary/parametric contract.
- Multiple JSON data cases require a loop over the case rows (`for (const dataCase of dataCases) { test(\`${dataCase.caseId} ...\`, ...) }`); `@playwright/test` has no `.each`. Every `caseId` must appear in test data or titles. In suite mode, `test.step` titles must be static string literals — a templated `Assert ${id}` step title does not register AC coverage — so loop only a group of data rows that share the same AC (keeping the `Assert AC-###` title static) and hand-write the other AC/NEG tests. See `docs/ai-testing/SUITE_MODE_RULES.md`.
- Assert salient expected values from data cases, including channel names, minimum days, generated IDs, and exact validation-message fragments. When the spec lists "Must assert the salient expected values ...", those exact values must appear inside an assertion, a step/test title, or an iterated data row.
- Follow `ai/config.json` variant axes; multiple variant rows require a loop that defines one `test.describe(...)` per variant.
- Declare any CSS locator fallback with `// locator-policy:exception <reason>` on the previous line. The same exception comment is required for selector arguments that do not fold to a static string and for positional picks (`.first()`, `.last()`, `.nth(<n>)`) on locators.
- Never call `test.skip`, `test.fixme`, or `test.fail` — neither the test-defining form nor runtime/conditional calls inside test bodies. Runtime skips exit 0 without verifying anything and fail both the static review and the executed gate's JSON-report verdict.
- Use existing Page Objects, components, fixtures, and data builders before adding new ones.
- Keep POM simple: locators and user-level actions only. Do not hide business assertions in Page Object methods or vague helpers.
- Avoid hard waits.
- Avoid XPath.
- Avoid `test.only`, `describe.only`, and `it.only`.
- Avoid real credentials.
- Avoid committed storage state.

4. Run static generated-test review. Without `--mode`, the spec's `Generation Mode` metadata applies (default `single`); pass `--mode` only when the spec declares none, and never a value that contradicts the spec (that is a hard error):

```bash
npm run ai:test:review -- --spec <spec-path> --test <target-test-file>
npm run ai:test:review -- --spec <spec-path> --test <target-test-file> --mode <single|suite>
```

5. Run the full generated-test gate (same mode resolution as the review):

```bash
npm run ai:test:gate -- --spec <spec-path> --test <target-test-file>
```

Default generated-test execution target is Chromium only. Cross-browser generated-test execution is opt-in with `--all-projects` or `--projects chromium,firefox,webkit`. The gate runs Playwright with `--reporter=html,json` and fails unless the JSON report shows at least one passing test and zero failed or skipped tests for the target file — a self-skipping test cannot pass the gate.

6. Run drift and catalog checks when specs or generated tests changed:

```bash
npm run ai:spec:drift
npm run ai:spec:catalog
```

7. Fix only verified issues reported by the review, gate, Playwright report, trace, console, or network evidence.

## Final Output

When finished, report:

- Spec path.
- Test path.
- AC IDs covered.
- Commands run.
- Pass/fail results.
- Known assumptions.
