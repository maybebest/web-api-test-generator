# Heal Broken Locator Safely

## Purpose

Repair locator drift without masking product regressions.

## Workflow

1. Use Playwright CLI snapshot first:

```bash
playwright-cli snapshot --filename=locator-healing.yml
```

2. Identify the equivalent accessible element in the current UI.
3. Prefer `getByTestId` when a meaningful `data-testid` exists and is stable, then `getByRole` with accessible name, `getByLabel`, `getByPlaceholder`, and `getByText` only for stable visible copy.
4. Do not replace robust locators with brittle CSS.
5. Do not hide product regressions by weakening assertions.
6. Update the test or Page Object minimally.
7. Rerun affected tests.
8. Re-run the gates the change touches, since a locator edit can violate the locator policy or hint checks:

```bash
# For a generated spec-bound test (and its Page Object). Without --mode, the
# spec's optional "Generation Mode" metadata applies (default single); a flag
# that contradicts the spec metadata is a hard error:
npm run ai:test:review -- --spec <spec-path> --test <test-file>
npm run ai:test:gate -- --spec <spec-path> --test <test-file>
npm run ai:spec:drift

# For a recorded test:
npm run ai:recording:review -- --recording <recording.json> --test <test-file>
npm run ai:recording:gate -- --recording <recording.json> --test <test-file>
```

9. Document the before locator, after locator, reason, evidence, gate results, and rerun result.

## Forbidden Fixes

- XPath.
- `nth-child` chains.
- Positional picks (`.first()`, `.last()`, `.nth(<n>)`) without `// locator-policy:exception <reason>` on the previous line.
- Dynamic selector expressions that do not fold to a static string, unless justified with `// locator-policy:exception <reason>`.
- Random generated CSS classes.
- Skipping the test (`test.skip`/`test.fixme`/`test.fail`, defining or runtime form) instead of healing the locator.
- Removing user-visible assertions without a product-owner decision.
