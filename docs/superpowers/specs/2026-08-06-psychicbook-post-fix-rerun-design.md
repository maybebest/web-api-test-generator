# PsychicBook post-fix generation and healer rerun design

Date: 2026-08-06

## Goal

Repeat the complete PsychicBook generated-test and proposal-only healing experiment
against the current post-fix framework. Delete the existing target, generate a fresh
test, establish the real live outcome, introduce one controlled `Get Started BROKEN`
locator failure, evaluate healer behavior, and publish only evidence-backed feedback.

The experiment must not invent improvement work when the current framework behaves
correctly. New framework changes are allowed only for a reproducible defect with a
test-first regression case.

## Isolation and owned artifacts

Work only in the existing linked worktree:

`/Users/maybebest/Documents/web-api-test-generator/.worktrees/healer-policy-soft-fail`

on branch `codex/healer-policy-soft-fail`. The primary checkout remains read-only.

This rerun owns:

- `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`, which is
  deleted before generation and recreated by the framework;
- the lifecycle field in `packages/web/specs/psychicbook-healing-experiment.md`;
- a new ignored generation run below `packages/web/.ai-runs/`;
- a new ignored healer archive below `packages/web/.ai-runs/heal/`;
- `packages/web/docs/ai-testing/psychicbook-healing-feedback-2026-08-06.md`;
- regression tests and implementation changes only for newly reproduced framework
  defects.

The runtime helper `packages/web/data/psychicbook.ts` is retained because it is the
reviewed environment-only boundary, not a generated target.

## Browser journey

The generated test must:

1. Open the configured PsychicBook stage origin using browser-level HTTP Basic auth.
2. Activate **Get Started**.
3. Enter the runtime returning-user email.
4. Activate **Continue**.
5. Activate **Have a verification code instead?**.
6. Enter the deterministic reviewed value `1234` in the four digit fields.
7. Verify the account-settings control in the authenticated top menu.

The Markdown flow spec remains the behavioral contract. The target must use the
framework fixture, an inline Page Object owning every locator, zero retries, no hard
waits, a final-step-only assertion, and no embedded credentials or authentication
state.

## Runtime and privacy boundary

The stage origin, HTTP Basic username/password, and returning-user email are supplied
only as process environment variables. The generated source obtains the email through
`requirePsychicBookEmail()` and never reads runtime configuration directly.

Runtime values, cookies, authorization data, storage state, request bodies, raw
browser reports, screenshots, videos, and traces must not be committed or copied into
the report. The reviewed verification value `1234` is part of the test contract and
may remain in source.

Potentially sensitive browser artifacts are inspected only for bounded safe facts and
then deleted. Generation/healer source archives may be retained only after checking
that they contain no runtime values.

## Fresh generation workflow

1. Record a digest of the primary checkout status for later unchanged-state proof.
2. Delete only the exact target in the isolated worktree.
3. Change the spec lifecycle from `generated` to `pending-generation`.
4. Run strict spec validation while the target is absent.
5. Create a new manifest-bound generation task.
6. Invoke the configured brain with result-cache reuse disabled and a bounded timeout.
7. Detect both the declared wrapper result and any direct provider workspace mutation.
8. Require a complete target, then return the spec lifecycle to `generated`.
9. Run generated review, TypeScript, and focused ESLint.

The generator is successful only when its own receipt/output contract says so. If a
CLI provider writes the target while the wrapper exits nonzero, preserve a safe copy
for diagnosis, remove the side effect before any retry, and label the resulting test
diagnostic rather than accepted generation output.

At most three provider attempts are allowed. Repeating an identical, already
understood output-contract failure without new evidence is not useful.

## Live baseline

Run the fresh target through Chromium with one worker and retries disabled. The full
generated gate requests three repeats; an additional one-run control is allowed when
needed to isolate the current product outcome.

Final GREEN requires every requested repeat to pass with zero failed, skipped,
retried, flaky, or unaccounted executions. A registration-by-code error, onboarding
redirect, authentication rejection, network failure, or missing account control is
reported under its actual product/data/environment category.

## Controlled RED

Change exactly:

```diff
-    this.getStartedLink = page.getByRole('link', { name: 'Get Started' });
+    this.getStartedLink = page.getByRole('link', { name: 'Get Started BROKEN' });
```

No other byte may change. The broken test is run once with one worker and zero retries.
The RED is valid only if it fails at the intentionally changed link before email
submission and registration-code handling.

## Proposal-only healer evaluation

Run healer with auto-healing enabled, result-cache reuse disabled, at most three AI
attempts, and two consecutive candidate verification runs. Do not pass `--apply` or
`--allow-dirty`.

Record:

- safe triage classification and reason codes;
- provider attempt count and terminal status;
- policy warning codes, if any;
- typecheck, lint, review, runtime, candidate-integrity, and diff checks;
- requested versus completed verification count;
- target digest before and after proposal-only execution.

An acceptable candidate must restore only `Get Started BROKEN` to `Get Started`, keep
the final newline, preserve all assertions/metadata/data, pass every hard gate, and
leave the broken target unchanged. Incidental EOF or formatting churn is not an exact
one-line repair even if Playwright passes.

The controller restores the one intended line after evaluation. If healer produces
an exact accepted proposal, the restoration is based on that proposal. Otherwise it
is documented as authorized manual cleanup, not healer success.

## Defect handling

When a new failure appears:

1. reproduce it independently of the external product when possible;
2. identify the failing framework boundary before proposing a change;
3. add a focused regression test and verify RED;
4. implement the smallest fix;
5. verify focused GREEN and the complete framework self-suite;
6. rerun the real PsychicBook step that originally exposed the defect.

External stage nondeterminism is feedback but not automatically a framework defect.
Known problems from the 2026-08-05 report are mentioned again only when this rerun
reproduces them or provides new evidence that they are fixed.

## Final verification and report

After cleanup, require:

- exact target digest restoration;
- strict spec validation;
- generated-test review;
- TypeScript and focused ESLint;
- spec drift check;
- full framework self-tests;
- a final three-repeat live generated gate;
- a clean intended branch diff and unchanged primary-checkout status digest.

The 2026-08-06 report compares current behavior with the 2026-08-05 findings. It
separates generator, healer, gate, product/backend, test-data, authentication,
network, and environment outcomes. If no new framework defect is reproduced, it says
that directly and identifies which previously reported risks were not observed.

## Stop conditions

- Missing runtime configuration stops before browser launch.
- Persistent HTTP Basic, DNS, TLS, browser, or stage unavailability is not healed.
- A RED outside the intentionally broken locator does not qualify as the controlled
  healer experiment.
- A candidate that changes more than the exact locator line is never promoted.
- A product failure in candidate verification remains a hard runtime rejection.

## Success evidence

Handoff includes the fresh generation task/outcome, generated or diagnostic target,
baseline result, causal controlled RED, healer archive and bounded diff assessment,
final verification statuses, a secret-free 2026-08-06 report, and explicit evidence
that the primary checkout and runtime-value boundary were preserved.
