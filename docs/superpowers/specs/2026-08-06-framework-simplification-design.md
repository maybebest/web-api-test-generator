# Framework Simplification Design

## Goal

Reduce the maintenance and state complexity added by the PsychicBook healer experiments without weakening verification, secret handling, atomic promotion, or the requested policy-warning behavior.

## Scope

The cleanup covers the current `codex/healer-policy-soft-fail` branch only:

- keep proposal-only warnings successful;
- keep `--apply` warning-bearing promotions atomic and non-zero for CI;
- keep typecheck, lint, contract review, runtime verification, integrity, and diff checks hard;
- keep the single diagnostic baseline and complete candidate repetitions;
- remove PsychicBook-specific infrastructure coupling;
- make ESLint dependencies reproducible from the committed manifests;
- consolidate the experiment documentation;
- reduce orchestration branching without introducing a generic pipeline framework.

The cleanup does not remove the AST policy evaluator, change locator selection, mask the external registration failure, or add retries.

## Result Model

Policy warnings are orthogonal metadata, not separate lifecycle states.

- Accepted proposals return `status: "proposal-ready"`.
- Applied candidates return `status: "healed"`.
- Warning-bearing accepted results include `policyIssueCodes`.
- CLI exit status remains `0` for a proposal with warnings.
- CLI exit status is `1` for an applied candidate with warnings.
- CLI prints warning codes from the accepted result only. Warnings from candidates rejected by later hard gates remain in the bounded run summary and are not presented as final-result warnings.

The run summary is the authoritative policy-warning audit. Per-attempt policy-warning files are removed because they duplicate the same sanitized codes.

## Execution Policy

The Playwright stage receives one explicit execution purpose instead of independent `diagnostic` and `failFast` booleans:

- `gate`: promotion/full-gate repeat rules and single-target fail-fast;
- `diagnostic`: exactly one run and no fail-fast;
- `healer-candidate`: approved repeat count and no fail-fast.

The default remains `gate`, preserving existing callers. The healer selects `diagnostic` for the baseline and `healer-candidate` for candidate verification.

## Runtime Configuration

The experiment reuses the existing generic `E2E_USER_EMAIL` secret rather than teaching the gate about `PSYCHICBOOK_E2E_EMAIL`. A required-email helper belongs in `data/users.ts`, next to the existing standard user data. The PsychicBook-only data module and its dedicated environment test are removed; a generic gate-environment test verifies the username/secret distinction and static stripping.

## Healer Boundaries

`healSingleTest` remains a linear orchestration function. Only cohesive operations are extracted:

- accepted-result construction and CLI rendering;
- candidate verification purpose selection;
- candidate promotion integrity checks where extraction reduces the main function materially.

No abstract stage registry, state-machine library, class hierarchy, or generic middleware layer is introduced.

Secret detection remains fail-closed. Its overlapping checks are exposed through one candidate-source boundary so callers do not compose scanners independently. Existing secret regression cases remain authoritative.

## Spec and Test Shape

The PsychicBook spec retains the repository-required metadata, data cases, JSON, flow steps, and acceptance criteria. It removes experiment-only exact identifier requirements and repeated prose where the central generation policy already owns the rule.

The generated test keeps one scenario and the inline cohesive page object required for a single-file heal. It uses `requireStandardUserEmail()` and removes unused expected-data fields. Locator and assertion behavior remain unchanged.

Policy CLI tests move out of the already-large healer integration test module. Similar hard-gate warning cases remain table-driven.

## Documentation

One final feedback report contains:

- the run timeline;
- implemented defects;
- framework observations;
- unresolved generator and external-product issues;
- final verification evidence.

Earlier rerun plans, rerun designs, and per-run feedback reports are removed after their unique evidence is preserved in the consolidated report.

## Dependency Contract

`packages/web/package.json` declares exact versions for ESLint and every package imported by `eslint.config.mjs`. The root lockfile is regenerated with npm. A self-test verifies the committed manifest contains the config imports, preventing success caused only by a parent or cached `node_modules`.

## Verification

The implementation must pass:

- targeted policy, healer, gate-environment, and generated-gate node tests;
- `npm run typecheck` in `packages/web`;
- ESLint against the PsychicBook generated test;
- the complete `npm run ai:test:self` suite;
- `git diff --check`.

No live PsychicBook rerun is required because the cleanup does not change the tested browser flow or external selectors.
