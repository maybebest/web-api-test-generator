# PsychicBook fourth post-fix generation and healer rerun design

Date: 2026-08-06

## Goal

Run a fourth independent PsychicBook generator/healer experiment from a deleted
target and a fresh manifest-bound generation task. Preserve every earlier report and
publish this observation as `rerun-4`.

## Chosen approach

Use the existing isolated `codex/healer-policy-soft-fail` worktree and treat each
boundary as an independent receipt:

1. Prove the worktree is clean, dependencies exist, transient browser directories are
   absent, and the read-only primary checkout has a stable status digest.
2. Delete only `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
   and move only its flow lifecycle to `pending-generation`.
3. Create a fresh generation task and invoke the selected brain once with result-cache
   reuse disabled.
4. Compare wrapper exit/output claims with actual target, spec, gate-run, report,
   trace, video, and Allure mutations. A wrapper failure is never called success even
   if a useful source file appears.
5. Exact-scan any complete side-effect source, quarantine it under the ignored
   generation run, restore controller ownership, and accept it for evaluation only
   after strict spec, reviewer, TypeScript, and focused ESLint gates.
6. Establish a three-repeat Chromium baseline with one worker and zero retries.
7. Change only the `Get Started` accessible name to `Get Started BROKEN` and prove the
   direct failure occurs before the runtime identity is submitted.
8. Run healer proposal-only with one diagnostic baseline, at most three provider
   attempts, two complete candidate verification repeats, one worker, and zero
   retries.
9. Require all healer hard gates, an unchanged broken target, exactly one repaired
   line, candidate SHA equality with the pre-break target, and terminal byte `0a`.
10. Restore the accepted line through the controller, run final static/self/live
    gates once, scrub secrets and browser artifacts, and publish the report.

## Alternatives rejected

- Healer `--apply` combines diagnosis and mutation and weakens the causal audit.
- Reusing the committed generated target avoids generator cost but does not satisfy
  the requested fresh delete-and-regenerate path.

## Runtime and privacy boundary

The stage origin, HTTP Basic identity, and returning-user identity exist only in
process environments for live commands. They must not enter tracked source,
Markdown, provider/healer audits, Git history, or retained browser artifacts. The
deterministic value `1234` remains part of the reviewed contract.

Screenshots, video, traces, reports, storage state, authorization data, cookies,
request bodies, and raw error contexts are transient. Inspect only bounded safe facts
and move exact generated directories to the system Trash. Retained generation and
healer audits must pass exact runtime-value scans.

## Classification rules

- Wrapper failure plus any provider-owned mutation is a generator transaction defect.
- Provider-created test reports or gate runs are separate unauthorized mutations,
  even when the provider was trying to validate its candidate.
- The deliberate zero-match locator failure is controlled healer input.
- Authentication, network, registration, backend, or business assertion failures
  after the repaired locator are non-repairable external/product outcomes unless
  evidence proves a framework boundary caused them.
- Passing healer verification and a later full-gate failure are separate receipts.
- Record known problems only when reproduced in this run.
- Any framework change requires `systematic-debugging`, a falsifiable root-cause
  hypothesis, focused RED regression coverage, and the smallest responsible fix.

## Outputs

- Fresh ignored generation task and bounded source audit.
- Fresh proposal-only healer audit.
- Restored generated target at exact pre-break bytes.
- `packages/web/docs/ai-testing/psychicbook-healing-feedback-2026-08-06-rerun-4.md`.
- Framework changes only for a defect newly reproduced and proven by this run.

## Success criteria

Every stage has an explicit receipt; runtime secrets are absent from owned artifacts;
the primary checkout digest is unchanged; target bytes are restored; fresh static,
self-test, and live results are recorded; and the report distinguishes generator,
healer, test, and external-stage behavior without inventing improvements.
