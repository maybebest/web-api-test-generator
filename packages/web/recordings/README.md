# Chrome Recorder Inputs

This directory contains Chrome DevTools Recorder JSON files. Recorded tests are generated only from these files.

## Required Workflow

1. Record a user flow in Chrome DevTools Recorder.
2. Add or edit Recorder assertions so the JSON contains at least one observable `waitForElement` outcome.
3. Export as JSON into `recordings/*.json`.
4. Validate the recording:

```bash
npm run ai:recording:validate -- recordings/<flow>.json
```

5. Create the generation task:

```bash
npm run ai:recording:generate-test -- recordings/<flow>.json
```

6. Generate or update the target test under `tests/recorded/*.spec.ts`.
7. Run the gate:

```bash
npm run ai:recording:gate -- --recording recordings/<flow>.json --test tests/recorded/<flow>.spec.ts
```

## Rules

- The Recorder JSON is the contract.
- Do not generate recorded tests from Gherkin, manual notes, checklists, screenshots, or memory.
- Do not commit secrets, cookies, auth state, traces, screenshots, videos, or HAR files.
- Navigate URLs are screened for secrets: suspicious query/hash parameter names (`token`, `sid`, `session`, `code`, `otp`, `key`, `auth`, `bearer`, ...) and secret-looking parameter values are hard validation errors. Re-record against a clean session or strip the parameters.
- Use semantic Playwright locators in generated tests.
- Actions must be called on locator objects (`page.getByRole(...).click()`). String-selector APIs (`page.click('css')`, `page.fill('css', ...)`, `page.waitForSelector(...)`, `page.$`/`page.$$`) are rejected by the review.
- Do not copy transient browser refs into tests.
- Do not use XPath, `:nth-child` chains, hard waits, or focused tests.
- `waitForElement` steps must use operator `>=`, `==`, or `<=` and a non-negative integer `count` (Chrome Recorder set).
- Re-record or edit the recording when it lacks assertion-worthy outcomes.

## Ignored Recorder Metadata

Normalization intentionally drops replay metadata that is not user behavior, but never silently:

- `setViewport` and `scroll` steps are reported in the normalize output under `ignoredSteps` with a reason.
- Step `assertedEvents` (e.g. navigation URL/page title) are reported under `ignoredEvents` with a reason. They are excluded from the behavior contract and the `sha256` behavior hash by design — surfacing them does not (and must not) change existing hashes. If an asserted outcome matters, express it as a `waitForElement` assertion in the recording instead.

Inspect both channels with:

```bash
npm run ai:recording:normalize -- recordings/<flow>.json
```
