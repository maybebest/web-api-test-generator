# Test Quality Gate

A test can be merged only if:

- It has meaningful assertions.
- It can run independently.
- It does not depend on test order.
- It cleans up or uses isolated data.
- It avoids external third-party instability or mocks it.
- It passes locally or failure is documented as a product bug.
- It produces useful failure artifacts.

Generated tests must be reviewed like human-written tests. Do not merge tests that only verify implementation details or page internals.

## Generated Test Gate

- The spec is the contract.
- The generated Playwright test is the implementation.
- The gate is the acceptance check.
- Generated tests must pass `npm run ai:test:review`.
- Generated tests must pass `npm run ai:test:gate`.
- Generated tests must pass `npm run ai:spec:drift`.
- Pre-generation DOM discovery should pass `npm run ai:dom:discover:review` when a discovery artifact is used.
- Default generation mode is single-test mode.
- A spec may declare its mode in the optional `Generation Mode` Metadata row (`single` | `suite`). Mode resolution: an explicit `--mode` flag wins; a `--mode` flag that contradicts the spec metadata is a hard error (prevents local-pass/CI-fail divergence); otherwise the spec metadata applies; otherwise `single`. `ai:test:gate:all` passes no flag and therefore picks up each spec's mode.
- Generate a suite only when the spec declares `Generation Mode | suite` or suite mode is explicitly requested.
- Default generated-test execution target is Chromium only.
- Cross-browser generated-test execution is opt-in.
- Single-test mode must produce exactly one primary `test(...)` block with one primary final verification responsibility, plus optionally one test per spec Negative Case.
- The single-mode primary test must declare a `covered-ac-ids` annotation (`test.info().annotations.push({ type: 'covered-ac-ids', description: 'AC-### ...' })`). Every annotated AC id must exist in the spec's Acceptance Criteria, the annotation set must equal the union of AC ids named in the primary test's step titles, and the final assertion step's AC id must be in the set.
- In the single-mode primary test, every `test.step` title must name the AC id(s) it exercises as `AC-###` tokens (e.g. `Arrange AC-001: open auth entry screen`); assertion steps keep the `Assert AC-###: ...` form.
- Single-mode NEG tests are optional but, when present, must name their `NEG-###` id in the test title and every step title and end with an `Assert NEG-###: ...` step containing at least one meaningful expect. NEG ids without a test in single mode produce a non-blocking review warning; NEG tests need no `covered-ac-ids` annotation.
- Spec metadata `Tags`, when non-empty, must be declared exactly (set equality) on the generated describe block or test via the Playwright `{ tag: [...] }` option.
- Suite mode must cover all AC IDs from the spec with focused tests.
- Every AC ID must map to at least one Flow Step row.
- In suite mode, every AC ID must be verified by a focused generated test whose final assertion step is named `Assert AC-###: ...`.
- In suite mode, negative cases must be verified by a final assertion step named `Assert NEG-###: ...` (NEG coverage stays required in suite mode).
- A generated test may contain setup/action steps, but only its final assertion step may contain `expect(...)`.
- A generated test must verify one clear functionality or business outcome; split broad end-to-end flows into focused tests only in explicit suite mode.
- Generated tests must honor declared Business Rules, Data Cases, Data Cases as JSON, Variants, and Mocks as JSON.
- Multiple JSON Data Cases or Variants must be enumerated by looping over the case/variant rows (`for (const dataCase of dataCases) { test(...) }`); `@playwright/test` has no `.each`. Every `caseId` must appear in a title or data row.
- Minimum/duration rules must include below-minimum, at-minimum, and above-minimum cases.
- Generated tests must assert salient expected values from JSON data cases. Values listed in a spec's "Must assert the salient expected values ..." requirement must appear inside an assertion, a step/test title, or an iterated data row (a dead constant does not satisfy the gate).
- Raw manual docs must be imported into an `ai-draft` spec and human-reviewed before the normal generation gate can pass.
- Generated tests must not skip themselves: `test.skip`, `test.fixme`, and `test.fail` are forbidden in every form — test-defining, zero-arg, and condition-arg runtime calls (including bracket-access or cast obfuscations).
- The generated spec header hash must match the spec's actual behavioral hash; a stale or fabricated 64-hex value fails review.
- The executed gate runs Playwright with `--reporter=html,json` and parses the JSON report: it fails unless the target file has at least one passing test and zero failed or skipped tests, closing the "skipped test exits 0" hole end-to-end.
- A pending-generation spec whose Target Test File already exists on disk is a stale Generation Status: `ai:test:gate:all` fails it and `ai:spec:validate --strict` flags it.
- The coverage catalog (`ai:spec:catalog`) reports per-spec NEG coverage (`covered/total` NEG ids found in the target test).
- Generated tests must not be TODO-only.
- Passing tests with no business outcome are not acceptable.
- Generated tests must not contain `agent-browser` snapshot refs.
- Generated test locators must live in Page Objects or Component Objects; tests must not create direct `page.getBy*` or `page.locator(...)` locators.
- Page Objects and Component Objects must follow locator priority: stable meaningful `data-testid`, role/name, label, placeholder, stable visible text, then documented raw CSS fallback.
- Generated tests should use existing Page Objects, components, fixtures, and small helpers where this improves readability and reuse.

## Recorded Test Gate

- The Chrome DevTools Recorder JSON is the contract.
- The generated Playwright test is the implementation.
- The gate is the acceptance check.
- Recorded tests must pass `npm run ai:recording:validate`.
- Recorded tests must pass `npm run ai:recording:review`.
- Recorded tests must pass `npm run ai:recording:gate`.
- Recorded tests must pass `npm run ai:recording:drift`.
- Recorded tests must include the recording path, title, and normalized recording hash header.
- Every required `RSTEP-###` from the normalized recording must be represented by a `test.step`.
- Every `ASSERT-###` must have a meaningful `expect(...)` assertion.
- Recorded tests must be Playwright-native and must not use Puppeteer replay as the runtime.
- Recorded tests must not contain real credentials, OTPs, bearer tokens, cookies, storage state, or production URLs.
- Recorded tests must not contain XPath, hard waits, focused tests, or unapproved raw CSS selectors.
