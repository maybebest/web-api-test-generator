# PsychicBook generator and healer feedback — 2026-08-06 post-fix rerun

## Scope and data handling

This experiment deleted the existing PsychicBook target, created a new manifest-bound
generation task, evaluated the resulting source against the real reviewed stage flow,
introduced one controlled locator failure, ran the proposal-only healer, fixed one
newly reproduced healer defect test-first, and repeated the live healer evaluation.

The experiment ran only in the isolated `codex/healer-policy-soft-fail` linked
worktree. The primary checkout was read-only. The stage origin, HTTP Basic identity,
and returning-user identity were supplied only through process runtime variables.
Their values, authorization material, cookies, request bodies, screenshots, videos,
traces, and raw browser reports are intentionally absent from this report. Browser
artifact directories were deleted after safe UI facts were recorded.

The reviewed deterministic verification value `1234` remains part of the flow
contract. Healer `--apply` and `--allow-dirty` were not used.

## Durable artifacts

- Design: `docs/superpowers/specs/2026-08-06-psychicbook-post-fix-rerun-design.md`
- Plan: `docs/superpowers/plans/2026-08-06-psychicbook-post-fix-rerun.md`
- Flow spec: `packages/web/specs/psychicbook-healing-experiment.md`
- Runtime helper: `packages/web/data/psychicbook.ts`
- Fresh evaluated target: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Generation task: `packages/web/.ai-runs/2026-08-06T08-53-43-208Z-flow-psy-heal-001/generation-task.md`
- Pre-fix healer archive: `packages/web/.ai-runs/heal/1786006868736-11109-b12c818d-a56e-4dce-80a8-1c1810e416c4/`
- Post-fix healer archive: `packages/web/.ai-runs/heal/1786007220194-12570-445cf255-9d71-493a-b756-bfe6a3d30674/`

The ignored generation/healer archives retain bounded source, diff, and safe audit
material only. They are not committed.

## Result summary

| Stage | Result |
| --- | --- |
| Framework baseline | 402/402 self-tests and TypeScript passed before the experiment. |
| Fresh generator | Wrapper failed, claimed no file was written, but Codex CLI created the target as a workspace side effect. |
| Static candidate gates | Strict spec, generated review, TypeScript, and focused ESLint passed. |
| Unchanged live baseline | 3/3 Chromium runs passed, with zero unexpected, skipped, or flaky results. |
| Controlled RED | One accessible name changed to `Get Started BROKEN`; 1/1 failed at that locator before identity submission. |
| Pre-fix healer | `proposal-ready`, attempt 1, 2/2 live passes, target unchanged; candidate also removed the EOF newline. |
| Framework fix | Final-line-ending preservation added test-first; healer suite 75/75 and full self-suite 403/403 passed. |
| Post-fix healer | `proposal-ready`, attempt 1, 2/2 live passes, target unchanged; candidate was byte-exact except for the intended locator repair. |
| Final full gate | First repeat reached verification but the stage UI reported a registration-by-code error; 1 failed and 2 did not run after early stop. |

The current healer is successful for the controlled locator case after the fix. The
overall external journey is not deterministic enough to call the final three-repeat
gate GREEN.

## Fresh generator evaluation

The fresh task was bound to `FLOW-PSY-HEAL-001`, spec version `1.0.0`, single mode,
AC-001 through AC-004, and behavioral spec SHA-256
`23e012214461a1475c9fc8ef54fb1ceee84924d1f35778afba3a816d32b59911`.
The target was absent immediately before provider invocation and result-cache reuse
was disabled.

One Codex CLI invocation ran with a five-minute budget. The CLI created a complete
98-line target, but returned no fenced TypeScript on stdout. The wrapper exited 1 and
printed that no file was written. Independent filesystem inspection proved that the
target existed with SHA-256
`300793b37413dc2331c68dbee7f1a501604be8c593c7b4f273268e5d424303e2`.

This reproduces the 2026-08-05 generator defect without a timeout: the provider acts
as a workspace-editing agent while the wrapper assumes a returned-source contract.
The failed wrapper neither detects nor quarantines the unexpected mutation. A second
identical expensive call was deliberately skipped under the predeclared stop rule.

The side-effect candidate contained no runtime password or returning-user value and
retained its final newline. It was copied into the ignored run as diagnostic input,
the unexpected target was deleted, and the exact same bytes were materialized again
through the controller solely for static, live, and healer evaluation. Generator
success is not claimed.

## Static acceptance and baseline

The candidate passed:

- strict flow-spec validation;
- generated-test review;
- TypeScript compilation;
- focused ESLint for the target and runtime helper.

The reviewer emitted two non-blocking observations: the declared NEG-001 does not
have a dedicated test in single mode, and the four anonymous numeric verification
inputs require a justified CSS fallback.

Before any break, the full generated gate ran Chromium with one worker, zero retries,
and `repeat-each=3`. All 3/3 runs passed. This is stronger causal evidence than the
2026-08-05 initial run, which encountered the external registration error before a
clean baseline was established.

## Controlled RED

The experiment changed exactly one line:

```diff
-    this.getStartedLink = page.getByRole('link', { name: 'Get Started' });
+    this.getStartedLink = page.getByRole('link', { name: 'Get Started BROKEN' });
```

The target changed from SHA-256
`300793b37413dc2331c68dbee7f1a501604be8c593c7b4f273268e5d424303e2` to
`734164e3d065836ea6b947a60d8bb767a62f5c055687ddc77dcae9076e5ae9b7` while retaining
the final newline. A one-worker, zero-retry run failed after 30 seconds while waiting
for the nonexistent accessible name. The visible DOM still contained the real
`Get Started` link. Execution stopped before the email step, so the RED was causal.

## Healer evaluation before the new fix

The proposal-only healer used one diagnostic baseline, at most three provider
attempts, two candidate verification runs, one worker, and zero retries. It classified
the failure as repairable `synchronization` with reason code
`ACTIONABILITY_TIMEOUT`, invoked Codex CLI once, and reported `proposal-ready` after
2/2 live candidate passes.

Every recorded hard gate was `passed`: policy, typecheck, lint, review, runtime,
candidate integrity, and diff. The broken target SHA remained
`734164e3d065836ea6b947a60d8bb767a62f5c055687ddc77dcae9076e5ae9b7`, proving
proposal-only mutation safety.

The semantic repair was correct, but the archived candidate also removed the final
newline. Its SHA-256 was
`4e382130ec037f84f4c913c6cfdd2e22a546ba6f54b520611fa0cbaf180b2fa0`, and the diff
contained `No newline at end of file`. The framework nevertheless recorded
`diff: passed` and returned `proposal-ready`. This was a real, reproducible exactness
defect, not a product or environment failure.

## Root cause and test-first fix

The shared fenced-code extractor intentionally trims surrounding whitespace. The
ordinary generator compensates by appending a final newline before writing its
output; the healer previously did not. Its diff gate accepted every non-empty bounded
Git diff, so the incidental EOF change was treated as valid.

A focused regression test first reproduced the failure by returning a valid healed
source without its final newline and asserting that the archived proposal preserves
the target's terminal line ending. It failed with `false !== true`. The healer was
then changed at the provider-to-candidate boundary to preserve the original target's
terminal line-ending presence before safety, policy, static, runtime, integrity, and
diff gates run.

Verification after the change:

- focused regression: 1/1 passed;
- complete healer test file: 75/75 passed;
- complete framework self-suite: 403/403 passed;
- both changed `.mjs` files passed Node syntax checks.

The direct repository ESLint command is not configured as a Node-script gate and
reports pre-existing Node-global errors across untouched `.mjs` lines. It was not
used as evidence for or against this scoped fix.

## Post-fix live healer result

The live healer was rerun with the same broken target and the same proposal-only
settings. It again used one provider attempt and passed 2/2 consecutive Chromium
runs. All hard gates passed, and the target remained unchanged at the broken SHA.

The archived candidate now:

- changes only `Get Started BROKEN` back to `Get Started`;
- retains final byte `0a`;
- contains no EOF diff marker;
- has SHA-256
  `300793b37413dc2331c68dbee7f1a501604be8c593c7b4f273268e5d424303e2`, exactly equal
  to the pre-break target.

The controller restored the single locator line and independently recovered that same
pre-break SHA. The live candidate did not trigger a policy warning, so this experiment
does not add external evidence for the policy soft-fail route; dedicated framework
self-tests continue to cover it.

## Final verification and external-stage result

After restoration, strict spec validation, generated review, TypeScript, focused
ESLint, spec-drift checking, and the complete 403-test framework suite passed.

The final full live gate requested three repeats. The first repeat completed the
landing, email, Continue, alternative-code, and code-entry actions, but the stage UI
then displayed:

`An error occurred while registration by code.`

The account-settings control never appeared. The gate correctly failed closed. With
`--max-failures=1`, the remaining two repeats did not run and the JSON report contained
one unexpected test plus two skipped/aborted repeats. All browser artifacts were
deleted after this safe observation.

This matches the external nondeterminism seen on 2026-08-05. In the current run the
same target passed the initial 3/3 gate and both separate healer candidates passed
2/2, yet the final gate encountered the product error. That evidence points to the
stage registration-by-code path, not the repaired locator or the line-ending fix.

## Evidence-backed improvement backlog

### P0 — Make the Codex CLI generator contract transactional

Still reproduced. Choose either returned source or authorized workspace editing.
Snapshot the target before invocation, detect and quarantine any mutation when the
wrapper fails, and never report `No file was written` when a file appeared.

### P0 external dependency — Stabilize registration by code

Still reproduced outside the framework. The deterministic-code stage journey can
pass several times and then return a registration error. Product/backend ownership
is required; a test retry would conceal the behavior rather than fix it.

### Fixed in this run — Preserve exact healer file endings

The healer now preserves the target terminal line ending, has a focused regression,
and produced a byte-exact live proposal for the intended one-line repair.

### P1 — Improve repeated-gate early-stop diagnostics

Still reproduced. `--max-failures=1` converts one real product failure into an extra
top-level abort/configuration error plus two skipped repeats. The fail-closed verdict
is correct, but public diagnostics should distinguish the causal failure from
intentional early-stop fallout.

### P2 — Distinguish permanent locator drift from synchronization

Still observed but not blocking. A permanent zero-match accessible name is classified
as `synchronization`. A safe near-match signal could support a more precise
`locator-drift` reason without weakening repair gates.

No additional healer defects were invented: after the terminal-line-ending fix, the
controlled repair path, proposal-only mutation safety, static gates, and two-run live
verification all behaved as designed.

## Conclusion

The healer is in good condition for this controlled locator scenario after one real
exactness defect was fixed. It now produces a byte-minimal proposal, passes every hard
gate and 2/2 live verification, and leaves the broken target untouched. The remaining
confirmed risks are the generator's non-transactional Codex CLI integration, the
external registration-by-code flake, and noisy early-stop diagnostics in the full
repeated gate.
