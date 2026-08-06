# PsychicBook generator and healer feedback — 2026-08-06 rerun 3

## Scope and safety

This is a third independent live rerun of the approved PsychicBook generation and
controlled locator-healing experiment. The existing target was deleted, a fresh
manifest-bound task was created, one provider call was made without result-cache
reuse, the accepted source was evaluated against the real non-production stage, one
locator was deliberately broken, and the healer ran proposal-only.

The experiment used only the isolated `codex/healer-policy-soft-fail` worktree. The
primary checkout was read-only. Stage origin, HTTP Basic identity, and returning-user
identity existed only in process environments. Their values, authorization data,
cookies, request bodies, screenshots, videos, traces, and raw browser reports are not
retained. The deterministic value `1234` remains part of the reviewed contract.

## Run artifacts

- Design: `docs/superpowers/specs/2026-08-06-psychicbook-third-post-fix-rerun-design.md`
- Plan: `docs/superpowers/plans/2026-08-06-psychicbook-third-post-fix-rerun.md`
- Generation task: `.ai-runs/2026-08-06T09-43-30-223Z-flow-psy-heal-001/generation-task.md`
- Safe provider side-effect candidate: `.ai-runs/2026-08-06T09-43-30-223Z-flow-psy-heal-001/provider-side-effect-candidate.spec.ts`
- Healer audit: `.ai-runs/heal/1786009787489-23686-1b504163-3d45-42c2-9edf-2f91bae8e1dd/`
- Evaluated target: `tests/regression/psychicbook-healing-experiment.spec.ts`

Ignored source/audit artifacts are retained only after exact runtime-value scans.
Browser artifacts were moved to the system Trash after bounded facts were recorded.

## Result summary

| Stage | Result |
| --- | --- |
| Starting framework | 404/404 self-tests and TypeScript passed. |
| Fresh generator | Wrapper exited 1 and claimed no file was written; the provider created a complete target and runtime artifact directories anyway. |
| Static acceptance | Strict spec, generated reviewer, TypeScript, and focused ESLint passed. |
| Fresh live baseline | 3/3 passed; unexpected=0, skipped=0, flaky=0. |
| Controlled RED | The one changed accessible name failed 1/1 at the intended link before runtime identity submission. |
| Proposal-only healer | `proposal-ready` on attempt 1; every hard gate passed and candidate verification passed 2/2. |
| Exact restoration | Candidate and restored target matched the pre-break SHA-256 and retained terminal byte `0a`. |
| Final framework | Strict checks, drift, and 404/404 self-tests passed. |
| Final live gate | 3/3 passed; unexpected=0, skipped=0, flaky=0. |

## Fresh generator evaluation

The target was absent and the spec lifecycle was `pending-generation` before task
creation and provider invocation. Doctor selected Codex CLI and result-cache reuse was
disabled. The task was bound to `FLOW-PSY-HEAL-001`, single mode, AC-001 through
AC-004, and behavioral spec SHA-256
`23e012214461a1475c9fc8ef54fb1ceee84924d1f35778afba3a816d32b59911`.

The provider completed within the five-minute budget, but its stdout contained no
fenced TypeScript. The wrapper exited 1 and declared `No file was written`.
Independent filesystem inspection found a complete 98-line target with SHA-256
`300793b37413dc2331c68dbee7f1a501604be8c593c7b4f273268e5d424303e2` and terminal
byte `0a`. The spec lifecycle remained pending in this rerun.

The provider also left a new generated-gate run and top-level Playwright/Allure test
artifacts. Their timestamps fell inside the provider call and preceded the controller's
first live baseline. This is evidence that the agentic CLI executed workspace and test
side effects while the wrapper treated it as a text-returning brain. Those transient
artifacts were moved to Trash before the controlled experiment continued.

The source was exact-scanned, archived under the ignored generation run, removed from
the unexpected location, and deliberately materialized by the controller. Its bytes
matched the previous accepted target, but generator success is not claimed: a failed
transaction cannot be relabelled by later source quality.

## Static acceptance and baseline

The evaluated source passed strict spec validation, generated-test review, TypeScript,
and focused ESLint. The reviewer emitted only two existing non-blocking notes:

- optional `NEG-001` lacks a dedicated test in single mode;
- the anonymous numeric verification fields use a documented CSS exception.

The unchanged Chromium gate used one worker, zero retries, and three repeats. All 3/3
passed with no unexpected, skipped, or flaky result. This established GREEN before the
controlled break.

## Controlled RED

Exactly one source line changed:

```diff
-    this.getStartedLink = page.getByRole('link', { name: 'Get Started' });
+    this.getStartedLink = page.getByRole('link', { name: 'Get Started BROKEN' });
```

The SHA-256 changed from
`300793b37413dc2331c68dbee7f1a501604be8c593c7b4f273268e5d424303e2` to
`734164e3d065836ea6b947a60d8bb767a62f5c055687ddc77dcae9076e5ae9b7`; terminal byte
`0a` was preserved. One direct run timed out at the broken accessible name before the
email fill. Bounded accessibility context contained the real `Get Started` link, so
the failure was causal and repairable.

## Healer evaluation

The healer used one diagnostic baseline and one Codex CLI attempt. Its triage was:

- classification: `synchronization`;
- repairable: `true`;
- reason: `ACTIONABILITY_TIMEOUT`.

The candidate verification command requested two repeats, one worker, zero retries,
and did not use fail-fast. Both 2/2 passed. The terminal status was `proposal-ready`.
Policy, TypeScript, lint, generated review, runtime, candidate integrity, and diff
checks all passed. No policy warning occurred.

The proposal changed only `Get Started BROKEN` back to `Get Started`. Its SHA-256 was
`300793b37413dc2331c68dbee7f1a501604be8c593c7b4f273268e5d424303e2`, exactly equal
to the pre-break target, and its terminal byte was `0a`. The proposal-only run left the
broken target unchanged. The controller restored the one accepted line and recovered
the same exact bytes.

No new healer defect was reproduced. For this controlled locator scenario the healer
was correctly classified, bounded, mutation-safe, exact, and live-verified.

## Final verification

After restoration, strict spec validation, generated review, TypeScript, focused
ESLint, and spec drift all passed. The complete framework self-suite passed 404/404.
The final three-repeat Chromium gate then passed 3/3 with zero unexpected, skipped,
or flaky results.

Across the fresh baseline, healer candidate verification, and final gate, the
unchanged/repaired positive journey passed 8/8 with zero retries. This rerun did not
reproduce the earlier external registration-by-code error, so no new external-stage
problem is claimed here.

## Evidence-backed improvements

### P0 — Separate agentic CLI execution from text-brain output

Still reproduced and more visible in this rerun. Codex CLI edited the target and ran
test tooling while the wrapper expected a fenced stdout response, then the wrapper
returned failure and claimed no file was written.

The smallest robust architecture is to give agentic CLI brains an isolated temporary
workspace with an explicit writable allowlist, capture their final response and
mutation manifest separately, and promote only controller-approved files after gates.
On any wrapper failure, the framework must roll back or quarantine every provider
mutation and runtime artifact before returning. The terminal manifest should record
both the provider exit/output-contract result and the observed mutation set.

### Healer — no additional change justified

The previously added complete-repeat behavior worked: candidate verification ran 2/2
without fail-fast pollution. Proposal-only semantics, hard gates, target integrity,
secret redaction, diff exactness, and final-newline preservation all held. Inventing a
new healer improvement from this run would not be evidence-based.

## Conclusion

The healer is in good condition for the exercised locator-repair path. The generator's
Codex CLI integration remains non-transactional and currently violates its own
failure message by leaving source and runtime side effects. That generator boundary is
the only framework defect reproduced by rerun 3.
