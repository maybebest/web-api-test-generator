# PsychicBook generator and healer feedback — 2026-08-06 rerun 4

## Scope and safety

This is a fourth independent live rerun of the approved PsychicBook generation and
controlled locator-healing experiment. The target was deleted, a fresh
manifest-bound task was created, the selected provider was invoked once without
result-cache reuse, one locator was deliberately broken, and the healer ran
proposal-only against the real non-production stage.

Only the isolated `codex/healer-policy-soft-fail` worktree was modified. The primary
checkout remained read-only. Stage origin, HTTP Basic identity, and returning-user
identity existed only in process environments. The deterministic value `1234`
remains part of the reviewed test contract.

Browser reports, screenshots, videos, traces, and raw contexts were transient. The
failed final gate contained the runtime identity in two evidence files; after the
safe product message and counts were recorded, the complete exact gate directory was
moved to the system Trash. No browser artifact remains in the worktree.

## Run artifacts

- Design: `docs/superpowers/specs/2026-08-06-psychicbook-fourth-post-fix-rerun-design.md`
- Plan: `docs/superpowers/plans/2026-08-06-psychicbook-fourth-post-fix-rerun.md`
- Generation task: `.ai-runs/2026-08-06T09-57-39-129Z-flow-psy-heal-001/generation-task.md`
- Safe side-effect source: `.ai-runs/2026-08-06T09-57-39-129Z-flow-psy-heal-001/provider-side-effect-candidate.spec.ts`
- Healer audit: `.ai-runs/heal/1786010609598-28510-653c77a7-fe12-4ce7-b9ff-5946603370b7/`
- Evaluated target: `tests/regression/psychicbook-healing-experiment.spec.ts`

## Result summary

| Stage | Result |
| --- | --- |
| Starting framework | 404/404 self-tests and TypeScript passed. |
| Fresh generator | Wrapper exited 1 and claimed no file was written; Codex CLI created the target and browser/test artifacts. |
| Static acceptance | Strict spec, generated reviewer, TypeScript, and focused ESLint passed. |
| Fresh live baseline | 3/3 passed; unexpected=0, skipped=0, flaky=0. |
| Controlled RED | One accessible name changed; 1/1 failed at the intended link before identity submission. |
| Proposal-only healer | `proposal-ready` on attempt 1; all hard gates passed and verification passed 2/2. |
| Exact restoration | Restored target matched the pre-break SHA-256 and terminal byte `0a`. |
| Final framework | Strict checks, drift, and 404/404 self-tests passed. |
| Final live gate | 1 passed, 1 failed at AC-004, 1 did not run after fail-fast; the UI reported a registration-by-code error. |

## Generator evaluation

Before provider invocation, the target, `.ai-runs/gate-*`, `test-results`,
`playwright-report`, and `allure-results` were all absent. The flow lifecycle was
`pending-generation`. Doctor selected Codex CLI and result-cache reuse was disabled.

The provider returned no fenced TypeScript. The wrapper exited 1 and declared
`No file was written`. Independent inspection instead found:

1. a complete 98-line target with SHA-256
   `300793b37413dc2331c68dbee7f1a501604be8c593c7b4f273268e5d424303e2` and terminal
   byte `0a`;
2. a new generated-gate run;
3. top-level Playwright report/test-results directories and Allure results.

Their timestamps were inside the provider call. The lifecycle remained pending and
the generation manifest contained only the original task metadata, not a terminal
generation receipt. Exact scanning of the 41 source/audit/browser files found no
stage URL, runtime password, or returning-user identity.

The complete source was archived under the ignored generation run, the provider
artifacts were moved to Trash, the unexpected target was removed, and the same safe
bytes were deliberately materialized by the controller. Generator success is not
claimed: the wrapper and filesystem described incompatible outcomes.

## Static acceptance and initial live baseline

The evaluated source passed strict spec validation, generated-test review,
TypeScript, and focused ESLint. The reviewer emitted only the existing non-blocking
single-mode `NEG-001` coverage note and the justified CSS exception for anonymous
numeric inputs.

The first live Chromium gate used one worker, zero retries, and three repeats. All
3/3 passed with zero unexpected, skipped, or flaky results.

## Controlled RED

Exactly one line changed:

```diff
-    this.getStartedLink = page.getByRole('link', { name: 'Get Started' });
+    this.getStartedLink = page.getByRole('link', { name: 'Get Started BROKEN' });
```

The target SHA-256 changed from
`300793b37413dc2331c68dbee7f1a501604be8c593c7b4f273268e5d424303e2` to
`734164e3d065836ea6b947a60d8bb767a62f5c055687ddc77dcae9076e5ae9b7`; terminal byte
`0a` was preserved. The direct run timed out on the broken accessible name before the
email fill, while bounded context showed the real `Get Started` link.

## Healer evaluation

The healer used one diagnostic baseline and one Codex CLI attempt. Triage was
`synchronization`, repairable, with reason `ACTIONABILITY_TIMEOUT`. Candidate
verification explicitly used two repeats, one worker, zero retries, and no
`--max-failures` flag. Both 2/2 passed.

The terminal status was `proposal-ready`. Policy, TypeScript, lint, generated review,
runtime, candidate integrity, and diff checks all passed. No policy warning occurred.
The proposal changed only `Get Started BROKEN` back to `Get Started`, retained byte
`0a`, and had the exact pre-break SHA-256. Proposal-only mode left the broken target
unchanged. The controller restored only the accepted line.

No new healer defect was reproduced. For this locator scenario, healer behavior was
correctly classified, exact, bounded, and mutation-safe.

## Final live failure classification

After restoration, strict spec/reviewer/TypeScript/ESLint/drift checks and the full
404-test framework suite passed. The final live gate requested three zero-retry
repeats. Repeat 1 passed. Repeat 2 reached the final AC-004 assertion, but the product
UI displayed:

`An error occurred while registration by code.`

The account-settings control never appeared. Full-gate fail-fast then prevented
repeat 3 from running and added one top-level abort error to the JSON verdict.

Evidence contradicts a repaired-locator defect: the same restored bytes passed the
initial 3/3 baseline, healer candidate verification passed 2/2, and final repeat 1
passed before repeat 2 produced an explicit registration error. The narrowest
supported classification is intermittent external registration/backend behavior.
The gate correctly failed closed; no retry-to-green was performed.

## Evidence-backed improvements

### P0 — Transactional boundary for agentic CLI generation

Reproduced again. Codex CLI edited the target and ran validation/browser tooling while
the wrapper expected a fenced text response, then returned failure and claimed no
file was written.

Agentic CLI brains need an isolated temporary workspace with a writable allowlist,
separate final-response and mutation receipts, and controller-only promotion. Any
wrapper failure must quarantine or roll back every source and runtime artifact before
returning. The manifest should record provider exit, output-contract result, observed
mutations, and cleanup outcome.

### P0 external dependency — registration-by-code nondeterminism

Reproduced after five consecutive successful positive-path executions in this run.
Product/backend telemetry should correlate the failed registration attempt and expose
a machine-readable failure reason. Retries in the test would hide this behavior and
are not a fix.

### P1 — Full-gate fail-fast diagnostic pollution

Reproduced again. `--max-failures=1` correctly stops the ordinary full gate, but its
intentional abort appears as both a top-level environment-style error and a skipped
repeat alongside the causal product failure. The public verdict should distinguish
fail-fast fallout from setup/configuration errors while remaining fail-closed.

### Healer — no additional change justified

All proposal-only safety, classification, verification, integrity, diff, policy,
redaction, and newline guarantees held. This run provides no evidence for another
healer change.

## Conclusion

The healer is in good condition for the controlled locator-repair path. The generator
remains non-transactional. The final stage also reproduced an intermittent external
registration failure, and the full-gate output still adds fail-fast diagnostic noise.
No other improvement is claimed.
