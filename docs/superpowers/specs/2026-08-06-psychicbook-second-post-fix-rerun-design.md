# PsychicBook second post-fix generation and healer rerun design

Date: 2026-08-06

## Goal

Repeat the already approved PsychicBook generator/healer experiment from a newly
deleted target and a newly created manifest-bound generation task. Preserve the first
2026-08-06 report and publish this run independently as `rerun-2` so sequential
observations cannot overwrite one another.

## Approved approach

Reuse the transaction-oriented experiment design from
`2026-08-06-psychicbook-post-fix-rerun-design.md` with these explicit properties:

1. Work only in the existing linked worktree on
   `codex/healer-policy-soft-fail`; the primary checkout is read-only.
2. Delete the exact current target and move the flow spec to
   `pending-generation` before creating the new generation task.
3. Record the generator wrapper result independently from filesystem mutation.
4. Materialize a complete side-effect candidate only as diagnostic test input when
   the wrapper itself failed; never relabel wrapper failure as success.
5. Require static gates before live execution.
6. Establish an unchanged three-repeat baseline before the controlled break.
7. Change only the `Get Started` accessible name to `Get Started BROKEN`.
8. Run the healer proposal-only with one diagnostic baseline, at most three provider
   attempts, two candidate verification runs, one worker, and zero retries.
9. Require exact candidate bytes apart from the intended locator repair, including
   preservation of the terminal newline.
10. Restore the target through the controller and run a final three-repeat gate.

## Runtime and privacy boundary

The reviewed stage origin, HTTP Basic identity, and returning-user identity remain in
one process environment only. They must not enter source, Markdown, provider audit,
Git history, shell history, or retained browser artifacts. The deterministic value
`1234` is part of the reviewed test contract and may remain in the test.

Browser reports, screenshots, videos, traces, storage state, authorization data,
cookies, request bodies, and failure contexts are transient. Inspect only bounded safe
facts and delete the exact artifact directories immediately afterward. Retained
generation/healer source audits must pass exact runtime-value scans.

## Classification rules

- A wrapper failure plus target creation is a generator output-contract defect.
- A controlled early zero-match failure is healer input, not product flakiness.
- A later stage registration error is an external service/product outcome unless
  evidence proves a framework boundary caused it.
- A two-run healer success and a later full-gate failure are reported separately;
  neither result erases the other.
- A known problem is recorded again only when reproduced in this run.
- A new framework change requires `systematic-debugging`, one falsifiable root-cause
  hypothesis, a focused failing regression, and the smallest responsible fix.

## Outputs

- Fresh generation task and bounded ignored source audit.
- Fresh proposal-only healer audit.
- Restored generated target at its exact pre-break bytes.
- New report:
  `packages/web/docs/ai-testing/psychicbook-healing-feedback-2026-08-06-rerun-2.md`.
- Framework code changes only if a newly reproduced defect survives evidence-led
  classification and a RED regression test.

## Success criteria

The experiment is complete when every stage has an explicit receipt, runtime secrets
are absent from owned artifacts, the primary checkout digest is unchanged, the target
is restored, the framework self-suite and static gates have fresh results, and the
report distinguishes framework behavior from external stage behavior without
inventing improvements.
