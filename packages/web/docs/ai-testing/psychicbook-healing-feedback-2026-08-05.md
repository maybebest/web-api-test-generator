# PsychicBook generation and healer feedback — 2026-08-05 rerun

## Scope and data handling

This experiment reran the real spec-bound generator and proposal-only healer against
the reviewed PsychicBook stage journey. The existing experiment target was absent in
the isolated worktree, so the flow was generated again from a fresh spec/task rather
than reusing an old test.

The stage origin, HTTP Basic identity, and returning-user identity were supplied only
through process runtime variables. Their values, authorization material, cookies,
request bodies, screenshots, videos, traces, and raw browser reports are intentionally
absent from this report. Browser failure directories that could contain the live
identity were deleted after their safe observations were recorded.

The deterministic stage verification value `1234` is part of the reviewed test
contract and remains in the spec and test source. Healer `--apply` was not used.

## Durable artifacts

- Flow spec: `packages/web/specs/psychicbook-healing-experiment.md`
- Runtime data helper: `packages/web/data/psychicbook.ts`
- Generated diagnostic target: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Generation task: `packages/web/.ai-runs/2026-08-05T17-21-02-113Z-flow-psy-heal-001/generation-task.md`
- Successful healer archive: `packages/web/.ai-runs/heal/1785952781761-33454-9f061328-ea1c-4295-9c2d-54dd524ccb66/`

The browser gate directories were transient and are not publishable receipts. The
healer archive contains only bounded source/diff/audit material and no runtime identity.

## Result summary

| Stage | Result |
| --- | --- |
| Fresh generator | Wrapper failed twice, although the Codex CLI directly wrote a candidate into the workspace both times. |
| Static candidate checks | Spec validation, generated-test review, TypeScript, and focused ESLint passed. |
| Initial live candidate | Reached verification, then the UI reported a registration-by-code error and the account control was absent. |
| Controlled RED | Exact accessible name changed from `Get Started` to `Get Started BROKEN`; the test failed at that link before identity submission. |
| Final healer attempt | `proposal-ready` on attempt 1; all hard gates passed and the candidate passed 2/2 live Chromium runs. |
| Proposal-only safety | Broken target SHA-256 stayed unchanged throughout healer execution. |
| Controller cleanup | Restored only the intentional locator line and recovered the exact pre-break target bytes. |
| Final full gate | Repeat 1 passed; repeat 2 reached verification but showed the registration-by-code error; repeat 3 did not run after the first failure. |

The experiment therefore validates the healer's repair path and mutation safety, but
the external flow is not deterministic enough to call the restored test fully GREEN.

## Fresh generation

The task was bound to behavioral spec SHA-256
`23e012214461a1475c9fc8ef54fb1ceee84924d1f35778afba3a816d32b59911`.
Exact-result reuse was disabled.

Two generator invocations exposed the same integration mismatch in different ways:

1. The first invocation hit the 120-second wrapper timeout. The wrapper exited 1, but
   the Codex CLI had already written the target as a workspace side effect.
2. A second invocation with a 300-second budget completed after about 210 seconds.
   The CLI again wrote the target directly, while the wrapper rejected stdout because
   it contained no fenced code block and reported that no file was written.

The framework therefore had no successful generation receipt even though a source
file existed. That source was treated as diagnostic input only. Before the controlled
break it had SHA-256
`300793b37413dc2331c68dbee7f1a501604be8c593c7b4f273268e5d424303e2`.

This is a P0 output-contract defect: a provider operating as a workspace-editing agent
must not be combined with a wrapper that assumes code is returned only on stdout. A
failed wrapper must also detect and quarantine unexpected workspace mutations.

## Live baseline and controlled RED

The first unchanged live run reached **Verify your Email**, then the UI displayed:

`An error occurred while registration by code.`

The final account-settings assertion timed out. No response body or request payload
was retained, so this observation does not establish a backend root cause.

The controlled break changed exactly one semantic line:

```diff
-    this.getStartedLink = page.getByRole('link', { name: 'Get Started' });
+    this.getStartedLink = page.getByRole('link', { name: 'Get Started BROKEN' });
```

The broken target SHA-256 was
`734164e3d065836ea6b947a60d8bb767a62f5c055687ddc77dcae9076e5ae9b7`.
An isolated one-worker, zero-retry run failed at the intended `click()` after waiting
for the nonexistent accessible name. The visible page still contained **Get Started**,
and execution stopped before the email and registration steps. The RED was causal.

## Healer defects found and fixed during the run

The real run exposed six independent framework defects before a proposal could be
verified. Each fix was written test-first and the affected self-tests passed afterward.

1. **Runtime identity was stripped from browser gates.**
   `PSYCHICBOOK_E2E_EMAIL` was absent from the external-runtime allowlist. It is now
   forwarded to browser gates while remaining absent from static subprocesses.

2. **The HTTP Basic username was treated as secret source material.**
   Because the product name also occurred in paths and source identifiers, matching
   the low-entropy username caused a generic preflight `HEAL_ERROR`. Runtime auth
   names and values requiring source redaction are now separate sets; the password
   and email remain protected.

3. **Baseline repeats were incompatible with `--max-failures=1`.**
   A two-repeat failing baseline produced one failed result plus an interrupted result
   and top-level abort error, which was misclassified as an environment failure. The
   healer now uses one explicit diagnostic baseline run and reserves 2/3 consecutive
   runs for the candidate.

4. **The generated gate rejected the new one-run diagnostic mode.**
   A narrowly scoped internal `diagnostic` option now permits `repeat-each=1` without
   weakening the public promotion/full gate values. Diagnostic runs omit
   `--max-failures=1`, preventing a normal test failure from becoming an abort error.

5. **A valid traceability digest looked like a secret in candidates.**
   The strict candidate scanner rejected the required 64-character SHA-256 in a valid
   `spec:` or `recording:` header. Only that verified header field is now exempted;
   known runtime values and other secret-like literals remain hard failures.

6. **The JSON verifier misunderstood current Playwright repeat output.**
   Playwright represents `repeat-each=2` as two spec nodes with one result each. The
   verifier expected two results inside every node, so a visible `2 passed` became a
   false runtime-environment failure. It now groups executions by logical test and
   still rejects incomplete repeat counts. A real two-repeat, always-green fixture
   confirmed the corrected contract.

The isolated branch also lacked an ESLint flat config, so the focused candidate lint
could not run until the current workspace config was materialized. The healer should
preflight this dependency with an actionable error before spending a browser or AI
attempt.

## Successful healer proposal

The final proposal-only run used one diagnostic baseline, at most three AI attempts,
two candidate verification runs, one Chromium worker, and zero retries. Triage was
`synchronization` with reason code `ACTIONABILITY_TIMEOUT`; the known permanent
zero-match locator is still not distinguished from a genuinely delayed element.

Codex CLI returned a candidate on attempt 1. The following gates all passed:

- source safety and policy;
- TypeScript and ESLint;
- generated-test static review;
- two consecutive live Chromium runs;
- candidate integrity and diff generation.

The terminal status was `proposal-ready`. The candidate restored
`Get Started BROKEN` to `Get Started`, and the browser reported 2/2 passes. The
original broken target retained SHA-256
`734164e3d065836ea6b947a60d8bb767a62f5c055687ddc77dcae9076e5ae9b7`, proving
proposal-only mutation safety.

The proposal also removed the final newline at EOF. This was behaviorally harmless
and passed current diff policy, but it violated the experiment's exact one-line byte
criterion. The controller therefore did not promote the archived candidate. It
manually restored only the locator line, preserved the newline, and recovered exact
pre-break SHA-256
`300793b37413dc2331c68dbee7f1a501604be8c593c7b4f273268e5d424303e2`.

The live candidate did not trigger a policy warning, so this run does not provide
external evidence for the new policy soft-fail path. That behavior remains covered by
the dedicated policy/healer self-tests: proposal mode continues after a warning;
`--apply` applies a fully verified candidate but returns a warning failure to its
caller; all later hard gates remain mandatory.

## Final verification

After exact controller cleanup, generated-test review, test listing, and TypeScript
completed successfully as part of the full gate. The three-repeat live run used one
worker and zero retries:

- repeat 1 passed;
- repeat 2 reached the verification screen, displayed the registration-by-code error,
  and failed the final account-control assertion;
- repeat 3 was not run because the single-target gate uses `--max-failures=1`.

This is the same external-flow uncertainty seen in earlier PsychicBook experiments:
two consecutive candidate runs can pass, while a subsequent full gate fails. It is
evidence of run-to-run nondeterminism, not evidence that the locator repair was wrong.

## Improvement backlog

### P0 — Make generator/provider contracts transactional

Choose one contract: returned source or authorized workspace edits. Snapshot the
target before invocation, reject/quarantine unexpected mutations on timeout or parse
failure, and never report “no file was written” when the provider wrote one. Add a
heartbeat for long CLI calls.

### P0 — Stabilize the external registration-by-code journey

The stage UI intermittently rejects the deterministic code and never reaches the
account control. Until the product path is deterministic, neither a two-run healer
gate nor a three-run regression gate can provide durable acceptance.

### P1 — Align healer readiness with the final gate

The healer returned `proposal-ready` after 2/2 live passes, but the following
three-repeat gate failed. Use the same repeat policy/receipt for external promotion,
or label a two-run result as provisional.

### P1 — Avoid max-failure abort pollution in repeated single-target gates

The full gate's early-stop flag adds a top-level Playwright abort error and a skipped
repeat after a normal product/test failure. Either execute all requested repeats or
classify this known early-stop shape as runtime-test while retaining the fail-closed
verdict.

### P1 — Require byte-minimal proposals when requested

The intended locator repair also removed the EOF newline. Add a minimal-diff rule or
formatter normalization before candidate comparison so unrelated byte churn is
reported and optionally rejected.

### P1 — Improve safe public diagnostics

Several distinct failures surfaced as `HEAL_ERROR`, `HEAL_BRAIN_ERROR`, or
`HEAL_ENVIRONMENT_FAILURE` with details omitted. Public output can safely include the
last completed stage, allowlisted reason codes, attempt number, and archive path.

### P2 — Classify permanent locator drift separately

A persistent zero-match accessible name was classified as synchronization. Compare a
bounded DOM near-match with delayed-actionability evidence and emit `locator-drift`
when justified.

### P2 — Retain redacted success receipts

Successful gates currently clean their raw execution directories. Keep a small
secret-free receipt containing target/spec digests, project, repeats, retries, counts,
and verdict while deleting screenshots, videos, traces, and raw reports.

## Conclusion

After the framework fixes above, the healer completed the intended real workflow:
it reproduced the controlled locator failure, generated the correct semantic repair,
passed every static gate, passed 2/2 live verification runs, returned a proposal, and
left the broken target untouched. The most important remaining risks are the
generator's non-transactional CLI integration, external registration flakiness, the
2-run versus 3-run readiness mismatch, generic diagnostics, and incidental diff noise.
