# Generate Deterministic Playwright Tests From a Recording

## Contract

The Chrome DevTools Recorder JSON under `recordings/*.json` is the contract.
The generated Playwright test under `tests/recorded/*.spec.ts` is the implementation.
The recording gate is the acceptance check.

This path is separate from the Markdown-spec path. Do not generate a recorded test from Gherkin, checklists, or loose notes. Files prefixed with `_` (e.g. `recordings/_example.json`) are templates and are skipped by the gates.

## Workflow

1. Validate the recording:

```bash
npm run ai:recording:validate -- <recording.json>
```

2. Normalize it to inspect the stable `RSTEP-###` / `ASSERT-###` ids, chosen locators, and behavioral hash:

```bash
npm run ai:recording:normalize -- <recording.json>
```

3. Build the deterministic generation task (it prints the exact header and gate commands):

```bash
npm run ai:recording:generate-test -- <recording.json> --target tests/recorded/<name>.spec.ts
```

4. Implement the recorded test:

- Add the exact header comment `/* recording: <recording-path> title:<title> sha256:<hash> */`.
- Import `test` and `expect` from `fixtures/test`.
- Use one `test.step` per recording step; title each step so it begins with its `RSTEP-###` id, and include the `ASSERT-###` id in the title of each `waitForElement`-derived assertion step.
- Each step body must perform the recorded action (navigate -> `goto`, change -> `fill`/`type`, click -> `click`, keyDown/keyUp -> `press`); title-only step bodies are rejected by the review.
- Translate recorder selectors into Playwright locators (`getByRole`/`getByLabel`/`getByTestId`/`getByText`); never emit Puppeteer/replay code, transient `@e` refs, XPath, `nth-child`, hard waits, focused tests, or secret-like literals.
- Call actions on locator objects only. String-selector APIs — `page.click('css')`, `page.fill('css', value)`, `page.type(...)`, `page.press(...)`, `page.check(...)`, `page.hover(...)`, `page.selectOption(...)`, `page.setInputFiles(...)`, `page.waitForSelector(...)`, `page.$`/`page.$$` — are forbidden and rejected by the review.
- Every typed recording value must be passed to the `fill`/`type` call inside its own `RSTEP` step (const folding is understood); assertion steps must `expect(...)` the contract locator for their `ASSERT-###` (same `getBy*` method and primary argument as the normalized recording).

5. Review and gate:

```bash
npm run ai:recording:review -- --recording <recording.json> --test tests/recorded/<name>.spec.ts
npm run ai:recording:gate -- --recording <recording.json> --test tests/recorded/<name>.spec.ts
npm run ai:recording:drift
```

## Final Output

Report the recording path, test path, RSTEP/ASSERT ids covered, commands run, and pass/fail results.
