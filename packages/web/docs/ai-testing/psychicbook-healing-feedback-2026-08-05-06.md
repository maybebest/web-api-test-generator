# PsychicBook generator and healer feedback — 2026-08-05 to 2026-08-06

## Purpose and safety

This report consolidates five real executions of the reviewed PsychicBook generation
and controlled locator-healing experiment. Each execution deleted the prior target,
created a fresh spec-bound generation task, evaluated the resulting source, changed
the `Get Started` locator to `Get Started BROKEN`, and ran the healer proposal-only.

All executions used the isolated `codex/healer-policy-soft-fail` worktree and the
non-production stage. The base URL, HTTP Basic password, and returning-user email
were supplied only at runtime. Cookies, request bodies, screenshots, traces, videos,
and raw browser reports are not retained. The deterministic code `1234` is part of
the reviewed contract and remains in source. Healer `--apply` was not used in the
live experiment.

## Durable artifacts

- Flow spec: `packages/web/specs/psychicbook-healing-experiment.md`
- Runtime identity helper: `packages/web/data/users.ts`
- Evaluated target: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Original experiment design: `docs/superpowers/specs/2026-08-03-psychicbook-healing-experiment-design.md`
- Framework simplification design: `docs/superpowers/specs/2026-08-06-framework-simplification-design.md`
- Framework simplification plan: `docs/superpowers/plans/2026-08-06-framework-simplification.md`

Generation tasks and healer audits remain ignored runtime artifacts. Repeated
execution-specific plans, designs, and reports were removed after this consolidated
record was created.

## Combined result

| Area | Evidence-backed result |
|---|---|
| Generator | Every fresh Codex CLI invocation violated the wrapper contract: the wrapper failed and claimed no file was written while the provider changed workspace files and sometimes ran browser tooling. |
| Static quality | The evaluated source repeatedly passed strict spec validation, generated-test review, TypeScript, and focused ESLint. |
| Controlled RED | The one-line accessible-name change failed at the intended `Get Started` click before email submission in every run. |
| Healer | After the fixes below, proposal-only healing restored the exact locator on attempt 1, passed every hard gate and 2/2 live candidate checks, and never mutated the broken target. |
| Positive path | One rerun produced 8/8 clean executions across baseline, healer verification, and final gate. Other runs intermittently failed after code entry. |
| External failure | The UI sometimes displayed `An error occurred while registration by code.` and did not expose the account control. |
| Policy warnings | The live candidates did not trigger a policy warning; the soft-fail behavior is proven by deterministic framework tests only. |

## Run matrix

| Run | Framework checks | Fresh baseline | Healer evidence | Final gate |
|---|---|---|---|---|
| 2026-08-05 | Exact self-suite count was not recorded; every affected self-test and static candidate check passed. | Registration-by-code error before a clean repeated baseline was established. | After six framework fixes: `proposal-ready`, attempt 1, all hard gates passed, candidate 2/2, broken target unchanged. | 1 passed; 1 failed after the registration error; repeat 3 did not run after fail-fast. |
| 2026-08-06 post-fix | Started 402/402; terminal-line regression raised the suite to 403/403. | 3/3 passed; unexpected=0, skipped=0, flaky=0. | Pre-fix and post-fix both returned `proposal-ready` on attempt 1 with 2/2 passes; post-fix candidate preserved exact EOF bytes. | 1 failed after the registration error; 2 did not run after fail-fast. |
| 2026-08-06 rerun 2 | Started 403/403; complete-repeat fix raised the suite to 404/404; focused affected tests 80/80. | 3/3 passed; unexpected=0, skipped=0, flaky=0. | First candidate passed repeat 1 and failed repeat 2 but was misclassified as environment failure; after the fix: `proposal-ready`, attempt 1, exact candidate 2/2, target unchanged. | 2 passed; 1 failed after the registration error. |
| 2026-08-06 rerun 3 | Started and finished 404/404; strict checks, TypeScript, ESLint, and drift passed. | 3/3 passed; unexpected=0, skipped=0, flaky=0. | `proposal-ready`, attempt 1, all hard gates passed, candidate 2/2, exact restoration. | 3/3 passed; unexpected=0, skipped=0, flaky=0. The complete positive journey was 8/8. |
| 2026-08-06 rerun 4 | Started and finished 404/404; strict checks, TypeScript, ESLint, and drift passed. | 3/3 passed; unexpected=0, skipped=0, flaky=0. | `proposal-ready`, attempt 1, all hard gates passed, candidate 2/2, exact restoration. | 1 passed; 1 failed at AC-004 after the registration error; 1 did not run after fail-fast. |

## Generator observations

The target was absent before every generation call and result-cache reuse was
disabled. Codex CLI produced a complete, statically valid test as a workspace side
effect, but returned no fenced TypeScript to the text-oriented wrapper. Depending on
the run, it also changed the spec lifecycle or created gate, Playwright, and Allure
artifacts. The wrapper then exited with failure and printed `No file was written`.

The source itself was useful diagnostic input, but generator success is not claimed:
a failed transaction cannot be relabelled by later source quality. The experiment
removed or quarantined provider side effects before deliberately materializing the
same scanned source for evaluation.

This remains the highest-priority framework defect. Agentic CLI providers need an
isolated writable boundary, an observed mutation manifest, and controller-only
promotion. A wrapper failure must roll back or quarantine every provider mutation
before returning.

## Controlled failure and healer behavior

The controlled break changed only:

```diff
-    this.getStartedLink = page.getByRole('link', { name: 'Get Started' });
+    this.getStartedLink = page.getByRole('link', { name: 'Get Started BROKEN' });
```

The direct zero-retry run timed out on the nonexistent accessible name while bounded
page context still exposed the real `Get Started` link. The failure happened before
runtime identity submission and was therefore causal.

The final healer behavior was stable across the last runs:

- one diagnostic baseline execution;
- one Codex CLI attempt;
- repairable `synchronization` triage with `ACTIONABILITY_TIMEOUT`;
- source-safety, policy, TypeScript, ESLint, generated-review, runtime, integrity, and
  diff gates all passed;
- candidate verification completed 2/2 with one worker, zero retries, and no
  fail-fast interruption;
- terminal status `proposal-ready`;
- candidate changed only the broken accessible name, retained the target line ending,
  and matched the pre-break bytes;
- proposal-only mode left the broken target unchanged.

No further healer change is justified by these executions.

## Framework defects found and fixed

### Runtime identity forwarding

The first healer run stripped the experiment-specific email variable from browser
gates. Runtime identity forwarding is now generic: `E2E_USER_EMAIL` is required by
the shared user-data helper, browser gates receive it, and static subprocesses do not.

### Runtime identity versus source secrets

The low-entropy HTTP Basic username also appeared in product paths and identifiers,
causing a false secret rejection. Runtime authentication values and source-redaction
values are now separate; passwords and user identities remain protected.

### Baseline repeat classification

A failing repeated baseline combined with `--max-failures=1` produced a failed result,
an interrupted result, and a top-level abort that looked like an environment failure.
The healer now runs one explicit diagnostic baseline and reserves repeated evidence
for candidates.

### Diagnostic gate semantics

The generated gate originally rejected the one-run diagnostic mode. Execution now
uses explicit purposes: `gate`, `diagnostic`, and `healer-candidate`. Each purpose owns
its repeat and fail-fast policy, replacing overlapping booleans.

### Traceability digest secret false positive

The strict candidate scanner treated the required 64-character SHA-256 in a valid
`spec:` or `recording:` header as secret material. Only that verified header field is
exempt; known runtime values and other secret-like literals remain hard failures.

### Playwright repeat JSON shape

Current Playwright JSON represents repeats as separate spec nodes with one result
each. The verifier expected multiple results in every node and rejected a visible
`2 passed`. It now groups executions by logical test and still fails incomplete
repeat counts.

### Terminal line ending

The fenced-code extractor trims surrounding whitespace. The generator normalized its
output, but the healer did not, so a correct locator proposal also removed the final
newline. The healer now preserves the target's terminal line ending before every
candidate gate. The resulting live proposal was byte-minimal.

### Candidate repeat collection

Candidate verification requested two repeats but inherited fail-fast. One product
failure added an abort/configuration error and produced a false environment verdict.
Healer-candidate execution now collects every requested repeat without
`--max-failures=1`.

### Policy warning result model

Policy findings are advisory only after a candidate passes all hard gates. Accepted
results now keep the ordinary `proposal-ready` or `healed` status and attach stable
`policyIssueCodes`; there are no warning-specific success statuses or per-attempt
warning files. Proposal mode exits successfully with a warning. `--apply` promotes a
fully verified candidate but exits non-zero so CI sees the warning failure requested
by policy.

### Configuration and dependencies

The experiment-specific runtime helper was replaced by the shared users helper. The
ESLint flat-config packages used by the workspace are declared explicitly and pinned,
and a self-test protects that dependency contract.

## External-stage observations

The same unchanged or repaired target sometimes passed several consecutive runs and
then reached the verification screen where the product displayed:

`An error occurred while registration by code.`

Observed final gates included a clean 3/3, a 2-pass/1-fail result, and a
1-pass/1-fail/1-not-run result after full-gate fail-fast. This contradicts a locator
repair defect and supports intermittent registration/backend behavior. Product
telemetry is required; retrying the test to green would hide the failure.

## Remaining improvements

### P0 — Transactional agentic generation

Still open and repeatedly reproduced. Run workspace-editing providers in an isolated
temporary workspace with a narrow writable allowlist. Record provider exit,
output-contract result, observed mutations, and cleanup outcome separately. Promote
only controller-approved files after validation.

### P0 external — Registration-by-code reliability

Still open outside the framework. Correlate the deterministic-code failure with
backend telemetry and expose a machine-readable cause. Do not add retries as a fix.

### P1 — Full-gate fail-fast diagnostics

Still open. Ordinary gates may stop after the first failure, but their public result
should distinguish intentional fail-fast fallout from genuine setup/configuration
errors while remaining fail-closed.

### P2 — Permanent locator drift classification

Still optional. The permanent zero-match name is reported as synchronization. A
bounded, redacted near-match signal could produce a more precise `locator-drift`
reason, but no extra heuristic should be added without real diagnostic value.

## Overengineering review

The cleanup following these runs deliberately removed logic that did not protect a
real boundary:

- warning-specific accepted statuses and duplicate warning artifacts;
- overlapping `diagnostic` and `failFast` flags;
- product-specific runtime identity plumbing;
- unused expected-value duplication in the generated test;
- exact local-variable, class-member, and annotation-AST requirements in the flow
  spec;
- five near-identical rerun plans, designs, and reports.

Security checks, atomic promotion, concurrent-edit detection, candidate integrity,
secret redaction, repeat verification, and hard static/runtime gates remain because
each protects a demonstrated failure mode. No generic pipeline or additional policy
engine was introduced.

## Conclusion

For the exercised locator-repair path, the healer is in good condition: it is exact,
bounded, mutation-safe, and live-verified. The dominant framework risk is the
non-transactional generator/provider boundary. The other confirmed risks are the
external registration failure and noisy full-gate early-stop diagnostics. No further
healer improvement is claimed without new evidence.
