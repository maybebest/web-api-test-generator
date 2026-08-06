# PsychicBook third post-fix generation and healer rerun design

Date: 2026-08-06

## Goal

Repeat the approved PsychicBook generator/healer experiment from a newly deleted
target and a new manifest-bound generation task. Preserve the earlier reports and
publish this observation independently as `rerun-3`.

## Chosen approach

Use the existing isolated `codex/healer-policy-soft-fail` worktree and treat every
experiment boundary as an independent receipt:

1. Record the clean worktree, framework baseline, and a digest of the read-only
   primary checkout.
2. Delete only `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
   and change only the flow lifecycle to `pending-generation`.
3. Create a fresh generation task and invoke the configured brain once with cache
   reuse disabled.
4. Compare the generator declaration with actual filesystem mutations. A failed
   wrapper may yield diagnostic source, but it is never reported as generator
   success.
5. Accept source for evaluation only after strict spec validation, generated-test
   review, TypeScript, focused lint, and exact secret scans.
6. Establish a three-repeat Chromium baseline with one worker and zero retries.
7. Change only the `Get Started` accessible name to `Get Started BROKEN` and prove
   that the failure occurs at that locator before the runtime identity is submitted.
8. Run healer proposal-only with one diagnostic baseline, at most three provider
   attempts, and two complete candidate verification repeats.
9. Require an exact one-line candidate diff, preserved terminal newline, unchanged
   broken target, and all healer hard gates to pass before restoring the target.
10. Run fresh static, framework-self, and three-repeat live gates, then publish the
    evidence-backed report.

## Alternatives considered

- Healer `--apply` would combine diagnosis and mutation, weakening the causal audit.
- Reusing the existing generated test would avoid generator cost but would not test
  the requested delete-and-regenerate path.

Both alternatives are rejected for this feedback experiment.

## Runtime and privacy boundary

The reviewed stage origin, HTTP Basic identity, and returning-user identity exist
only in one process environment. They must not enter source, Markdown, provider
audits, Git history, retained shell output, or browser artifacts. The deterministic
value `1234` is part of the reviewed test contract.

Browser reports, screenshots, videos, traces, storage state, authorization data,
cookies, request bodies, and raw failure contexts are transient. Inspect only bounded
safe facts and delete their exact directories after each live stage. Retained
generation and healer audits must pass exact runtime-value scans.

## Classification rules

- A wrapper failure plus any provider-owned workspace mutation is a generator
  transaction defect, even if the resulting source later passes gates.
- The deliberate zero-match failure is controlled healer input, not product
  instability.
- Registration, authentication, network, backend, or assertion failures after the
  repaired locator are non-repairable unless evidence proves a framework cause.
- Passing healer verification and a later live-gate failure are separate receipts;
  neither overwrites the other.
- Reproduce before recording a known problem in this run.
- Any framework change requires `systematic-debugging`, a falsifiable root-cause
  hypothesis, a focused RED regression, and the smallest responsible fix.

## Expected outputs

- A fresh ignored generation task and bounded source audit.
- A fresh proposal-only healer audit.
- The generated target restored to its exact pre-break bytes.
- `packages/web/docs/ai-testing/psychicbook-healing-feedback-2026-08-06-rerun-3.md`.
- Framework code changes only for defects reproduced by this run.

## Success criteria

The experiment is complete when each stage has an explicit receipt, runtime secrets
are absent from owned artifacts, the primary checkout digest is unchanged, the
target is restored, current static and self-test results are recorded, and the report
separates generator, healer, test, and external-stage behavior without inventing
improvements.
