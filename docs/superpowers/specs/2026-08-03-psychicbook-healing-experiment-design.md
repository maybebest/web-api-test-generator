# PsychicBook generated-test healing experiment design

Date: 2026-08-03

## Goal

Exercise the repository's real external generated-test and safe-healing workflow against the reviewed PsychicBook stage environment:

1. Generate an isolated Playwright test through the solution.
2. Prove the generated test passes the requested email-verification journey.
3. Introduce one deliberate locator-only failure.
4. Prove the broken target fails for locator drift.
5. Ask the solution's healer to produce and verify a repair proposal.
6. Promote the verified proposal outside the currently unsafe healer `--apply` path.
7. Prove the restored test passes the same live acceptance check.

The experiment must not change or overwrite the existing uncommitted PsychicBook spec, test, Page Object, or data-helper files.

## Isolated artifacts

The experiment owns these new paths:

- `packages/web/specs/psychicbook-healing-experiment.md`
- `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- a new generation run below `packages/web/.ai-runs/`
- healer evidence and candidate artifacts below `packages/web/.ai-runs/heal/`

The generated target remains uncommitted after the experiment so the human partner can inspect its final healed form.

## Runtime data boundary

The live browser run receives all identity and HTTP Basic values through process environment variables:

- `PLAYWRIGHT_TEST_BASE_URL`
- `E2E_HTTP_BASIC_USERNAME`
- `E2E_HTTP_BASIC_PASSWORD`
- `PSYCHICBOOK_E2E_EMAIL`

The deterministic verification value is part of the requested stage test contract. No runtime email, HTTP Basic value, cookie, storage state, or authorization material may be written into the spec, generated test, generation prompt, Git history, or public summary. Browser traces and retained media must be treated as sensitive live-run artifacts and must not be committed.

## Generated-test shape

The Markdown flow spec is a single-mode, external, non-production regression contract with one primary test and a final assertion that the account-settings control is visible in the authenticated top menu.

The generated target must:

- import `test` and `expect` from the framework fixture;
- define a focused inline `PsychicBookHealingExperimentPage` Page Object in the generated test file;
- keep all Playwright locators inside that inline Page Object;
- obtain the email from `PSYCHICBOOK_E2E_EMAIL` at runtime;
- perform the requested landing, Get Started, email, Continue, alternative-code, code-entry, and account-settings verification journey;
- contain `expect(...)` only in the final assertion step;
- use no XPath, hard wait, focused/skipped test, or committed authentication state.

The inline Page Object is intentional. A normal imported Page Object is context-only for the current single-file healer and would correctly produce `manual-change-required`. Keeping the focused owner in the generated target lets the experiment exercise a real one-file locator repair without weakening generated-test ownership rules.

## Generation and initial GREEN

The solution must run its standard flow:

1. Validate the experiment spec.
2. Optionally collect bounded landing-page DOM evidence through the repository discovery command.
3. Create a manifest-bound generation task with `ai:generate-test`.
4. Generate the target with `ai:brain:generate`.
5. Run generated-test static review.
6. Run TypeScript and lint checks relevant to the target.
7. Run the generated-test live gate in Chromium with retries disabled.

The initial GREEN is accepted only when the report proves at least one expected test passed and no test failed, skipped, or became flaky.

## Controlled RED

After the initial GREEN, change exactly the inline Page Object's semantic accessible-name locator for the Get Started control to a known non-matching name.

Do not change:

- steps or their order;
- runtime data handling;
- actions other than the locator expression;
- assertions or expected outcomes;
- test metadata or spec binding;
- retries, waits, or skip behavior.

Run the isolated target once with retries disabled. The RED is accepted only when the failure is classified as locator drift at the intentionally changed locator. Authentication, network, data, assertion, or environment failures do not count as the controlled RED and stop the experiment for diagnosis.

## Healing and safe promotion

Run `ai:test:heal` in its default proposal-only mode with auto-healing explicitly enabled. The healer must:

- classify the baseline as repairable locator drift;
- preserve the spec-bound executable semantics;
- produce a single-file candidate;
- pass policy, typecheck, lint, generated-test review, and consecutive runtime verification;
- return `proposal-ready` without changing the broken target.

The current branch has a confirmed load-bearing time-of-check/time-of-use residual in healer `--apply`. Therefore this experiment must not invoke `--apply` or `--allow-dirty`. After verifying the archived candidate digest, bounded diff, and exact locator-only change, apply the candidate to the isolated untracked target through the controller's normal file-edit mechanism. This tests the healer's generation and verification behavior without relying on the unsafe promotion path.

## Final verification

After promotion, run fresh checks on the actual healed target:

- generated-test static review;
- TypeScript and lint;
- spec drift;
- the live generated-test gate in Chromium with retries disabled;
- a diff inspection proving that the intentional locator break was the only repaired behavior.

The final result is GREEN only when the account-settings assertion passes with zero failed, skipped, or flaky results. Otherwise report the exact observed status and retain the diagnostic artifacts without claiming success.

## Failure handling

- Missing runtime configuration: stop before browser execution.
- HTTP Basic, DNS, TLS, or stage availability failure: classify as environment failure; do not heal.
- Email or verification rejection: classify as auth/data failure; do not heal.
- First-time onboarding instead of the returning-user route: stop as a precondition mismatch.
- Healer policy/review rejection: retain the rejected-attempt audit and report it.
- Healer candidate still failing: do not promote it.
- Any change beyond the intended locator expression: reject the candidate.

## Success evidence

The handoff must include:

- the generated spec and final healed test paths;
- generation run and healer archive paths;
- initial GREEN result;
- controlled RED classification;
- healer status and candidate-diff summary;
- final GREEN result;
- confirmation that existing PsychicBook files and unrelated dirty-worktree changes were preserved;
- the known limitation that healer `--apply` was deliberately not exercised.
