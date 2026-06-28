# CI Debugging Workflow

## Run Tests

```bash
npx playwright test
npx playwright test tests/smoke --project=chromium
npx playwright test path/to/file.spec.ts --trace on
```

## Open Reports And Traces

```bash
npx playwright show-report
npx playwright show-trace path/to/trace.zip
```

## Classify The Failure

- Product bug: the app behavior is wrong or regressed.
- Test bug: the test expectation or locator is wrong.
- Environment issue: app URL, browser dependencies, or CI service setup failed.
- Data issue: required test data is missing, stale, or not isolated.
- Flaky timing issue: the app is eventually correct but synchronization is weak.
- Locator drift: the UI element still exists but its accessible contract changed.

## Decide Where The Fix Belongs

- App code: user-visible behavior or accessibility contract is broken.
- Test code: the test no longer reflects the intended behavior.
- Data setup: fixtures or accounts need stable seeded state.
- Environment: CI needs base URL, browser dependencies, or service startup changes.

Do not delete assertions to make CI green. Attach trace/report evidence to the failure summary.

