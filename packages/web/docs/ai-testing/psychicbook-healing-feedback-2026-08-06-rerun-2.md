# PsychicBook generator and healer feedback — 2026-08-06 rerun 2

## Scope and privacy

This is a second independent post-fix execution of the reviewed PsychicBook flow. The
existing target was deleted, a fresh manifest-bound generation task was created, the
resulting source was statically and live evaluated, one locator was deliberately
broken, and the proposal-only healer was run against the real stage.

The experiment ran only in the linked `codex/healer-policy-soft-fail` worktree. The
primary checkout remained read-only. The stage origin, HTTP Basic identity, and
returning-user identity existed only in a process environment. Their values,
authorization material, cookies, request bodies, screenshots, videos, traces, and raw
browser reports are intentionally absent. The reviewed value `1234` remains part of
the test contract. Healer `--apply` and `--allow-dirty` were not used.

## Fresh run artifacts

- Design: `docs/superpowers/specs/2026-08-06-psychicbook-second-post-fix-rerun-design.md`
- Plan: `docs/superpowers/plans/2026-08-06-psychicbook-second-post-fix-rerun.md`
- Generation task: `packages/web/.ai-runs/2026-08-06T09-20-17-765Z-flow-psy-heal-001/generation-task.md`
- First healer audit: `packages/web/.ai-runs/heal/1786008406221-17376-7d4fb26d-14ad-4be1-962c-b79b56e23592/`
- Post-fix healer audit: `packages/web/.ai-runs/heal/1786008717552-18318-a86eda1c-9e62-4033-baa0-6c51131cb673/`
- Evaluated target: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`

Ignored source/audit artifacts are retained only after exact runtime-value scanning.
All browser artifact directories were deleted after bounded safe facts were recorded.

## Result summary

| Stage | Result |
| --- | --- |
| Starting framework | 403/403 self-tests and TypeScript passed. |
| Fresh generator | Wrapper failed and claimed no file was written; Codex CLI created the target and changed the spec lifecycle anyway. |
| Static acceptance | Strict spec, generated review, TypeScript, and focused ESLint passed. |
| Fresh live baseline | 3/3 passed; unexpected=0, skipped=0, flaky=0. |
| Controlled RED | One accessible name changed to `Get Started BROKEN`; 1/1 failed at the intended link before identity submission. |
| First healer run | Candidate repeat 1 passed and repeat 2 failed at AC-004; fail-fast abort pollution produced a false `environment-failure`. |
| Framework fix | Healer verification now executes all requested repeats without `--max-failures=1`; affected suite 80/80 and full self-suite 404/404 passed. |
| Post-fix healer | `proposal-ready`, attempt 1, 2/2 passed, exact one-line candidate, target unchanged. |
| Final full gate | 2 passed, 1 failed after the UI reported a registration-by-code error. |

## Generator evaluation

The target was absent before creating the task and before invoking the provider.
Result-cache reuse was disabled and the configured brain was Codex CLI. The task was
bound to `FLOW-PSY-HEAL-001`, single mode, AC-001 through AC-004, and behavioral spec
SHA-256 `23e012214461a1475c9fc8ef54fb1ceee84924d1f35778afba3a816d32b59911`.

The provider call completed within the five-minute budget, but stdout contained no
fenced TypeScript. The wrapper exited 1 and printed `No file was written`. Independent
inspection showed two workspace mutations:

1. `tests/regression/psychicbook-healing-experiment.spec.ts` appeared as a complete
   98-line source file with SHA-256
   `300793b37413dc2331c68dbee7f1a501604be8c593c7b4f273268e5d424303e2`.
2. The flow spec lifecycle changed from `pending-generation` to `generated`.

This is another direct reproduction of the non-transactional Codex CLI integration,
now with evidence that the provider mutates more than the declared output target. The
candidate and spec contained no runtime password or returning-user value. The
controller archived the candidate, reverted both unexpected mutations, and then
materialized the same source bytes and generated lifecycle deliberately for evaluation.
Generator success is not claimed.

## Static and live baseline

The diagnostic source passed strict spec validation, generated-test review,
TypeScript, and focused ESLint. The reviewer emitted only the existing non-blocking
single-mode NEG-001 note and the justified CSS fallback note for the anonymous numeric
verification inputs.

The unchanged full gate used Chromium, one worker, zero retries, and three repeats.
All 3/3 passed. This proves that the later controlled failure was not present in the
fresh target baseline.

## Controlled RED

Exactly one source line changed:

```diff
-    this.getStartedLink = page.getByRole('link', { name: 'Get Started' });
+    this.getStartedLink = page.getByRole('link', { name: 'Get Started BROKEN' });
```

The target changed from SHA-256
`300793b37413dc2331c68dbee7f1a501604be8c593c7b4f273268e5d424303e2` to
`734164e3d065836ea6b947a60d8bb767a62f5c055687ddc77dcae9076e5ae9b7`, retaining its
final newline. A one-worker, zero-retry run timed out at that exact accessible name.
Bounded context showed the real `Get Started` link. The failure occurred before the
email step and was causal.

## First healer run and reproduced framework defect

The healer used one diagnostic baseline, invoked Codex CLI once, and produced the
correct semantic candidate. Policy, TypeScript, lint, and generated review passed.
Candidate verification requested two repeats. The first passed; the second reached
the final account-control assertion and failed.

Because single-target promotion execution still included `--max-failures=1`,
Playwright added a top-level abort/configuration error to the ordinary test failure.
The JSON gate classified that shape as runtime-environment, and the healer returned:

- status `environment-failure`;
- reason `GATE_ENVIRONMENT_FAILURE`;
- one provider attempt;
- no candidate proposal.

The fail-closed decision was safe and the broken target SHA remained unchanged, but
the classification lost the causal test result. This was a framework defect: the
healer requested repeated evidence while its execution flag allowed the first failure
to interrupt or pollute that evidence.

## Root cause and test-first fix

Two focused RED assertions were added before production changes:

1. `healSingleTest` must pass `failFast:false` to spec-bound verification.
2. `executeGeneratedPair` with `failFast:false` must omit `--max-failures=1` while
   retaining `repeat-each=2`, one worker, and zero retries.

Both failed on the old implementation: healer passed `undefined`, and the CLI still
contained the early-stop flag.

The minimal change introduced a default-true `failFast` option at the Playwright stage
boundary and explicitly disabled it for healer candidate verification, including the
standalone lane. Ordinary full gates keep their existing default. Verification:

- both focused tests passed after the change;
- complete affected test files passed 80/80;
- complete framework self-suite passed 404/404;
- TypeScript and changed-script syntax checks passed.

## Post-fix live healer

The same broken target was passed to a fresh proposal-only healer run. Its candidate
command contained `repeat-each=2`, one worker, and zero retries, and did not contain
`max-failures`. Both 2/2 candidate runs passed.

The terminal status was `proposal-ready` after one attempt. Every recorded hard gate
passed: policy, typecheck, lint, review, runtime, candidate integrity, and diff. The
target remained at broken SHA-256
`734164e3d065836ea6b947a60d8bb767a62f5c055687ddc77dcae9076e5ae9b7`.

The candidate:

- changed only `Get Started BROKEN` back to `Get Started`;
- retained final byte `0a`;
- had SHA-256
  `300793b37413dc2331c68dbee7f1a501604be8c593c7b4f273268e5d424303e2`, exactly equal
  to the pre-break target.

The controller restored that one line and independently recovered the same SHA. No
policy warning occurred, so this run does not add live evidence for policy soft-fail;
that path remains covered by framework self-tests.

## Final live outcome

After restoration, all static checks and the 404-test framework suite passed. The
final full gate requested three repeats with zero retries. Repeats 1 and 2 passed.
Repeat 3 reached the verification UI, which displayed:

`An error occurred while registration by code.`

The account-settings control did not appear, so the final result was 2 passed and
1 failed. This is direct run-to-run nondeterminism in the external stage path: the same
target passed the initial 3/3 baseline and the post-fix healer candidate passed 2/2.
The gate correctly failed closed; the result is not evidence that the locator repair
was wrong.

## Evidence-backed improvements

### P0 — Transactional generator/provider contract

Still reproduced. Codex CLI changed both the target and spec while the wrapper failed
and claimed no file was written. Snapshot all authorized paths, run workspace-editing
providers in an explicit transaction, and quarantine or revert every unexpected
mutation before returning failure.

### Fixed — Complete healer verification evidence

The healer no longer uses fail-fast for its repeated candidate checks. It now obtains
all requested repeat outcomes without turning an ordinary test failure into a false
environment failure. Normal full-gate fail-fast behavior is unchanged.

### P0 external dependency — Registration-by-code nondeterminism

Still reproduced. Several consecutive successes can be followed by the product UI's
registration error. A retry would hide the behavior; product/backend diagnosis is
required.

### P1 — Full-gate early-stop diagnostic noise

Still observable. The default full gate retains `--max-failures=1`, which can add a
top-level Playwright abort error to a causal test failure. Its fail-closed verdict is
correct, but public output should distinguish intentional early-stop fallout from
setup/configuration failures.

No other healer defects were invented. After the scoped repeat-collection fix, the
controlled locator repair was exact, mutation-safe, and 2/2 live verified.

## Conclusion

The healer is in good condition for the controlled locator scenario after one newly
reproduced execution-classification defect was fixed. The generator is still not
transactional, and the external registration-by-code journey remains flaky. Those are
the two dominant real risks shown by this rerun.
