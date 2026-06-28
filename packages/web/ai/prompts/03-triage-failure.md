# Triage Playwright Test Failure

## Purpose

Classify a failing test with evidence before proposing or applying a fix.

## Workflow

1. Run the failing test with trace enabled:

```bash
npx playwright test path/to/file.spec.ts --trace on
```

2. Inspect the Playwright report:

```bash
npx playwright show-report
```

3. Inspect trace, screenshots, console logs, and network activity.
4. Classify the failure as one of:
   - product bug
   - test bug
   - environment issue
   - data issue
   - flaky timing issue
   - locator drift
5. Do not delete assertions to make tests pass.
6. Propose the smallest safe fix.
7. Rerun the affected test.
8. Summarize the evidence, classification, fix, and final result.

## Evidence Standard

Use traces and screenshots for UI failures, console/network output for runtime failures, and exact command output for environment or dependency issues.

