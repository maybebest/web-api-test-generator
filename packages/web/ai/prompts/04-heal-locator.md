# Heal Broken Locator Safely

## Purpose

Repair locator drift without masking product regressions.

## Safe Healer Operator Contract

Run the healer only for repairable runtime failures:

```bash
# Safe default: verified proposal, target unchanged
AI_AUTOHEAL_ENABLED=true npm run ai:test:heal -- --test tests/recorded/checkout-confirmation.spec.ts

# Explicit promotion of a clean target
AI_AUTOHEAL_ENABLED=true npm run ai:test:heal -- --test tests/recorded/checkout-confirmation.spec.ts --apply

# Explicitly accept an already-dirty starting target
AI_AUTOHEAL_ENABLED=true npm run ai:test:heal -- --test tests/recorded/checkout-confirmation.spec.ts --apply --allow-dirty
```

The default success status is `proposal-ready` only when a repairable failing target produces a
fully verified single-test candidate: its candidate diff is evidence only and the target is
unchanged. A baseline-green target returns `already-green` with no proposal. Environment,
non-repairable, and `manual-change-required` paths return their own statuses and might not create a
candidate proposal. Page Object or Component source is context-only, returns
`manual-change-required`, and is never auto-promoted. `--allow-dirty` is invalid unless `--apply`
is also present. `--apply` promotes a fully verified target, clean unless `--allow-dirty` is
explicit; integrity and concurrency checks always remain. A supplied `--dom-snapshot` must be a
verified selector-discovery artifact below `.ai-runs/dom-discovery/`; only its bounded context is
supplied to the healer.

Only `locator-drift` and `synchronization` runtime failures are repairable. Product, auth,
network, data, assertion-mismatch, and unclassified failures require human action and are
reported as not repairable. Recorded targets use the recorded reviewer before runtime verification;
other spec-bound targets use the generated-test reviewer.

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

## Intentional Functionality Changes

Do not heal an expectation for an intentional product change. Update the Markdown spec, increment
its version, and update the affected acceptance criteria and data cases first. Regenerate or
manually update the test from that revised contract, then run the appropriate review, gate, and
drift checks.

## Forbidden Fixes

- XPath.
- `nth-child` chains.
- Positional picks (`.first()`, `.last()`, `.nth(<n>)`) without `// locator-policy:exception <reason>` on the previous line.
- Dynamic selector expressions that do not fold to a static string, unless justified with `// locator-policy:exception <reason>`.
- Random generated CSS classes.
- Skipping the test (`test.skip`/`test.fixme`/`test.fail`, defining or runtime form) instead of healing the locator.
- Removing user-visible assertions without a product-owner decision.
