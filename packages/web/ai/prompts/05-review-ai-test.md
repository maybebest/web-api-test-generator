# Review AI-Generated Playwright Test

Use this checklist before merge:

- Test is deterministic.
- Test is independent.
- No hard waits.
- No production credentials.
- No committed auth state.
- No `test.skip`/`test.fixme`/`test.fail` anywhere — defining or runtime/conditional form. A self-skipping test exits 0 while verifying nothing.
- The spec header hash matches the spec's actual behavioral hash.
- Locators are robust.
- Locators are owned by Page Objects or Component Objects; generated tests do not create direct `page.getBy*` or `page.locator` locators.
- Selector arguments fold to static strings; unfoldable selectors and positional picks (`.first()`, `.last()`, `.nth(<n>)`) carry `// locator-policy:exception <reason>`.
- Each test verifies one business outcome.
- Assertions appear only in the single final `Assert AC-###` or `Assert NEG-###` step for each test.
- Assertions verify user-visible behavior and are not broad URL regexes or generic fallback visibility checks.
- Test data is isolated.
- Failure artifacts are enabled.
- CI command passes.
- Default generation mode is single-test mode; the spec's optional `Generation Mode` metadata resolves the mode, and a contradicting `--mode` flag is a hard error.
- Generate a suite only when the spec declares `Generation Mode | suite` or a suite is explicitly requested.
- Default generated-test execution target is Chromium only.
- Cross-browser generated-test execution is opt-in.
- Spec metadata `Tags` are declared exactly (set equality) via the Playwright `{ tag: [...] }` option on the describe block or test.
- In single-test mode, the file has exactly one primary `test(...)` block plus optionally one test per spec `NEG-###` case.
- The single-mode primary test declares a `covered-ac-ids` annotation; every annotated AC exists in the spec, and the annotation set equals the AC ids named in the primary test's step titles (every step title carries its `AC-###` token(s)).
- Single-mode NEG tests name their `NEG-###` id in the title and every step title and end with an `Assert NEG-###: ...` step containing a meaningful expect; uncovered NEG ids are a non-blocking warning.
- In suite mode, every AC ID is covered by a final assertion step across the suite, and NEG coverage is required.
- The executed gate's Playwright JSON report shows at least one passing test and zero failed or skipped tests for the target file.

Reject or revise the test when any item is missing. Do not merge generated tests just because they compile.
