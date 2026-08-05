# PsychicBook generation and healing rerun design

Date: 2026-08-05

## Goal

Repeat the repository's full external generated-test and safe-healing workflow against the reviewed PsychicBook stage environment, using a fresh generated target and a controlled `Get Started BROKEN` locator failure. The result is an evidence-based comparison with the earlier experiment and a focused list of framework improvement candidates.

The experiment evaluates the framework and records findings. It does not implement framework fixes.

## Owned artifacts

The rerun owns these artifacts:

- the target `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`, which will be deleted when present before regeneration and recreated through the framework;
- the existing flow contract `packages/web/specs/psychicbook-healing-experiment.md`, whose generation status may be changed only as required by the framework's regeneration lifecycle;
- the environment-only helper `packages/web/data/psychicbook.ts`, recreated from its reviewed implementation when it is absent from the isolated worktree;
- a fresh generation run below `packages/web/.ai-runs/` with result-cache reuse disabled;
- a fresh healer archive below `packages/web/.ai-runs/heal/`;
- a new comparison report at `packages/web/docs/ai-testing/psychicbook-healing-feedback-2026-08-05.md`.

Earlier reports and `.ai-runs` artifacts are preserved for comparison. Unrelated dirty-worktree files are not modified.

## Requested browser journey

The regenerated Playwright test must:

1. Open the configured PsychicBook stage landing page through HTTP Basic authentication.
2. Activate **Get Started**.
3. enter the runtime email in the email field;
4. activate **Continue**;
5. activate **Have a verification code instead?**;
6. enter the deterministic verification code `1234`;
7. verify that the returning user's account-settings control is visible in the authenticated top menu.

The generated target must continue to follow the repository's single-mode generated-test rules: framework fixture import, all locators owned by the inline Page Object, final-step-only assertion, zero retries, no hard waits, no XPath, no focused or skipped tests, and no committed authentication state.

## Runtime data boundary

Live values are supplied only through the process environment:

- `PLAYWRIGHT_TEST_BASE_URL`;
- `E2E_HTTP_BASIC_USERNAME`;
- `E2E_HTTP_BASIC_PASSWORD`;
- `PSYCHICBOOK_E2E_EMAIL`.

The generated source obtains the email only through `requirePsychicBookEmail()`
from `packages/web/data/psychicbook.ts`. That helper validates presence without
embedding, printing, or persisting the runtime identity.

The verification value `1234` remains part of the reviewed stage test contract. The runtime email, HTTP Basic values, cookies, storage state, and authorization material must not be written to source files, generation inputs, Git history, or the feedback report. Live traces and retained browser media are sensitive local diagnostic artifacts and must not be committed.

## Fresh regeneration

The existing generated test is removed before a new generation task is created. The flow spec is moved to `pending-generation` only if required for validation while the target is absent. The standard framework workflow is then used:

1. validate the Markdown flow spec;
2. create a new manifest-bound generation task;
3. invoke the configured AI brain with result-cache reuse disabled;
4. statically review the candidate;
5. run the target's TypeScript and lint checks;
6. execute the live Chromium promotion gate with retries disabled.

If verified generation rejects the candidate because the external stage flow fails, the rejection is retained as framework feedback. A statically valid rejected candidate may be materialized only as an isolated diagnostic target for the controlled healer experiment, with that deviation recorded explicitly in the final report.

## Baseline observation

Before the intentional break, run the regenerated or diagnostic target unchanged and record the exact outcome. A pass establishes the clean behavioral baseline. A failure caused by the known or another external product condition is not relabeled as a test failure; it is recorded with bounded network and UI evidence.

The experiment may continue to the locator-only healer exercise after a product or environment baseline failure only when the candidate passed all static checks and the intentional locator failure occurs before the failing product interaction. The final report must not call such a baseline GREEN.

## Controlled RED

Change exactly one locator expression in the generated target's inline Page Object:

```ts
page.getByRole('link', { name: 'Get Started' })
```

becomes:

```ts
page.getByRole('link', { name: 'Get Started BROKEN' })
```

No step, action order, runtime-data handling, assertion, expected outcome, retry, wait, metadata, or spec binding may change. Run the isolated target once with retries disabled. The controlled RED is valid only when execution fails at the intentionally changed locator before the registration APIs are reached.

## Healing and safe promotion

Run `ai:test:heal` with auto-healing enabled in its default proposal-only mode. Do not invoke healer `--apply` or `--allow-dirty` because the earlier audit identified a load-bearing time-of-check/time-of-use residual in that promotion path.

The healer is expected to:

- classify the observed locator failure;
- produce a single-file candidate;
- preserve the spec-bound test semantics and final assertion;
- pass policy, integrity, TypeScript, lint, generated-test review, and consecutive live verification;
- return `proposal-ready` without mutating the broken target.

The proposal is accepted only when its bounded diff changes `Get Started BROKEN` back to `Get Started` and nothing else. After candidate digest and diff verification, apply the proposal through the controller's normal file-edit mechanism.

Any broader change, assertion weakening, skipped execution, or candidate that does not pass the healer's verification is rejected and retained as diagnostic evidence.

## Final verification

Run fresh checks against the actual restored target:

- generated-test static review;
- TypeScript;
- focused lint;
- spec drift;
- the full live Chromium gate with three repeats and retries disabled;
- a final diff inspection confirming that healing restored only the intentional locator change.

Final GREEN requires every configured repeat to pass with zero failed, skipped, retried, or flaky tests. If any repeat fails, report the exact observed status and evidence rather than claiming success.

## Feedback report

The new report compares the rerun with the 2026-08-04 experiment and records:

- generation task and archived run locations;
- generator brain and cache behavior without key material;
- initial generation and baseline outcomes;
- controlled RED location and observed classification;
- healer status, candidate diff, verification count, and mutation behavior;
- final three-repeat gate result;
- external stage failures, including bounded downstream request evidence when available;
- what worked well;
- prioritized, reproducible framework improvement candidates.

The report must distinguish generator, healer, framework-gate, product/backend, test-data, authentication, network, and environment failures. Findings may recommend framework fixes but must not implement them in this experiment.

## Stop conditions

- Missing runtime configuration stops live execution before browser launch.
- HTTP Basic, DNS, TLS, or persistent stage unavailability is classified as environment failure and is not healed.
- Email or verification rejection is classified as auth/data or product failure and is not healed.
- First-time onboarding instead of the reviewed returning-user journey is a precondition mismatch.
- A failure that does not occur at `Get Started BROKEN` does not qualify as the controlled RED.
- A healer candidate that changes more than the intended locator is not promoted.

## Success evidence

The handoff includes the regenerated spec-bound target, fresh generation and healer archive paths, all observed GREEN/RED statuses, the exact healer proposal summary, final gate evidence, the new comparison report, confirmation that earlier evidence and unrelated changes were preserved, and explicit disclosure that healer `--apply` was not exercised.
