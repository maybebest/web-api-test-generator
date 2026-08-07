# PsychicBook generation and healer rerun feedback — 2026-08-05

## Scope

This rerun exercised fresh, manifest-bound generation, an unchanged live baseline,
a controlled `Get Started BROKEN` failure, proposal-only healing, authorized manual
cleanup, and final verification against the reviewed PsychicBook stage journey. It
evaluated the framework; it did not implement framework or PsychicBook fixes.

Playwright configuration receives the stage URL and HTTP Basic credentials through
process-only runtime variables. The generated source obtains only the returning-user
email through the reviewed `requirePsychicBookEmail()` helper. Their values, plus
request payloads, authorization material, cookies, storage state, screenshots,
traces, and raw browser content, are intentionally absent from this report. Raw
Playwright failure evidence is sensitive local diagnostic material and must remain
uncommitted.

The fresh generator did not promote its candidate. The target used by the remaining
experiment was materialized byte-for-byte from the runtime-rejected archive only
after its static acceptance evidence had been checked. It is therefore a diagnostic
target, not an accepted generation result. Healer `--apply` and `--allow-dirty` were
never exercised.

## Fresh artifacts

- Flow spec: `packages/web/specs/psychicbook-healing-experiment.md`
- Diagnostic target: `packages/web/tests/regression/psychicbook-healing-experiment.spec.ts`
- Generation task: `packages/web/.ai-runs/2026-08-05T01-36-15-849Z-flow-psy-heal-001/generation-task.md`
- Provider input: `packages/web/.ai-runs/2026-08-05T01-36-15-849Z-flow-psy-heal-001/provider-input.md`
- Task manifest: `packages/web/.ai-runs/2026-08-05T01-36-15-849Z-flow-psy-heal-001/manifest.json`
- Generation run: `packages/web/.ai-runs/generation/28c38fbf-fca8-4432-8db6-ad34d4c2d288/`
- Rejected source: `packages/web/.ai-runs/rejected/28c38fbf-fca8-4432-8db6-ad34d4c2d288/candidate.ts`
- Retained failed promotion gate: `packages/web/.ai-runs/gate-1785893830780-61661-74105933-dd20-4415-a077-de6a4fad34f6-psychicbook-healing-experiment/`
- Healer archive: `packages/web/.ai-runs/heal/1785894805630-64809-63b8c809-0a9f-41f3-951d-7de2d805eee5/`
- Controlled-RED evidence: `packages/web/test-results/regression-psychicbook-hea-f10b8-es-account-settings-DC-001--chromium/`

Two accepted gates created the following exact execution paths and then removed
them through the gate's normal success cleanup:

- Baseline: `packages/web/.ai-runs/gate-1785894256790-63078-4a87e94c-838a-4c70-865c-f1e9e973a185-psychicbook-healing-experiment/gate-execution-1785894256791-63078-312bb45b-1967-4f8c-aad0-352d406ad180`
- Final: `packages/web/.ai-runs/gate-1785913122282-75823-750598b6-5f5e-42a6-b3d6-d459f2c1d7a5-psychicbook-healing-experiment/gate-execution-1785913122283-75823-5cd9345d-d3ee-4869-83a2-41225d6972d9`

Their success counts and paths remain in the Task 3 and Task 6 reports; no raw gate
JSON receipt remains. Retained failed-run evidence may contain live values and is not
a publishable success receipt.

## Fresh generation result

The old target was removed and the spec lifecycle was changed to
`pending-generation` before creating the new task. The task manifest bound mode
`single`, the expected spec and target paths, behavioral spec SHA-256
`23e012214461a1475c9fc8ef54fb1ceee84924d1f35778afba3a816d32b59911`,
and provider-input SHA-256
`44352692434d32555895de0372bcfa7065a9fd904fcb42ca5e3db6d7081a25b7`.

Run `28c38fbf-fca8-4432-8db6-ad34d4c2d288` used one successful Codex CLI provider
attempt with exact-result reuse disabled. The generated source passed the pre-runtime
static acceptance boundary, but the verified promotion gate rejected it at
`runtime-test` with reason `gate-rejected`. The generation manifest status is
`failed`; the `verified-promotion-gate/v3` policy requested two repeats and reports
`fastGatePassed: false`. The framework failed closed: it archived the rejected source
and did not write it to the target.

The retained fresh failure evidence shows the earliest bounded application-level
divergence after registration initialization: `POST /profile/user/web/registration/init`
returned 200, then `POST /profile/user/web/registration/code` returned 400 and the UI
displayed a registration-by-code error. The test subsequently timed out waiting for
the final account-settings control. No request payload, response body, identity, or
authorization data was inspected or copied here. This fresh evidence does not
establish a backend root cause.

After archive review and focused lint passed, the rejected source was materialized
only as diagnostic input. Its archive and target SHA-256 were both
`f64ff406c68889d8e42662d6c098076b0e7f73d26e4e167e36a3bb2f4fd95744`;
byte comparison matched. The spec lifecycle was then returned to `generated`, and
generated-test review, TypeScript, and focused lint passed.

## Baseline result

The unchanged diagnostic target passed the full independent gate immediately after
materialization: Chromium, one worker, zero retries, and `repeat-each=3` produced
`expected=3`, `unexpected=0`, `skipped=0`, and `flaky=0`. The gate exited 0 and
reported `Generated test gate passed.` The target SHA-256 remained
`f64ff406c68889d8e42662d6c098076b0e7f73d26e4e167e36a3bb2f4fd95744`.

This is a valid 3/3 live baseline for the materialized bytes. It does not retroactively
turn the earlier promotion rejection into an accepted generation run or explain why
that run diverged.

## Controlled RED

Exactly one locator string was changed in the inline Page Object:

```diff
-    this.getStartedLink = page.getByRole('link', { name: 'Get Started' });
+    this.getStartedLink = page.getByRole('link', { name: 'Get Started BROKEN' });
```

The target SHA-256 became
`e8905c8b9c65df861aea631180c6a5c1f889c42af6993bef904663cece86f60b`.
One isolated Chromium run with one worker, zero retries, and one repeat failed at the
intended action with a 30-second locator-click timeout while waiting for the broken
accessible name. The captured page state contained the real `Get Started` link.
Execution stopped in `start()` before email submission and before either registration
endpoint was reached. The RED was therefore valid and isolated from the later
registration flow.

## Healer result

The proposal-only healer run was
`1785894805630-64809-63b8c809-0a9f-41f3-951d-7de2d805eee5`. It used
`AI_AUTOHEAL_ENABLED=true`, disabled exact-result reuse, `max-attempts=3`, and
requested `verify-runs=2`, with `apply=false` and `allowDirty=false` persisted in
`heal-summary.json`.

Triage classified the known accessible-name mismatch as repairable
`synchronization` with reason code `ACTIONABILITY_TIMEOUT` and evidence fingerprint
`d58df3c2337214eaadbe745bd3aa73e32db1e23f0c003bfd1926d22fad0d1de4`.
That matches the broad classification seen on 2026-08-04; it does not distinguish a
zero-match locator from genuine timing behavior.

All three Codex CLI healer provider attempts were rejected by the deterministic
policy guard. Each retained attempt record exposes only `attempt`, outcome
`rejected-policy`, and its schema. TypeScript, lint, generated-test review, candidate
integrity, diff review, and live candidate verification were never reached. The
configured two verification runs were requested but **zero** candidate verification
runs executed.

Terminal status was `exhausted`, process exit was 1, and public output ended with
`HEAL_EXHAUSTED: Diagnostic details were omitted.` The archive contains
`original.ts`, `evidence.json`, `heal-summary.json`, and three policy-rejection
records, but no `candidate.ts`, `candidate.diff`, or candidate digest.

Candidate diff summary: **unavailable — every attempt was policy-rejected before a
candidate could be retained or verified.** No proposal was accepted or promoted.
The broken target SHA-256 was identical before and after healer execution, proving
proposal-only mutation safety.

Only after explicit user authorization, a controller applied the one-line
`Get Started BROKEN` to `Get Started` restoration as cleanup outside the healer.
That manual restoration is not healer success, proposal promotion, or evidence for
the unexecuted two-run candidate gate. Healer `--apply` was not exercised.

## Final verification

After the authorized cleanup, the actual target had no broken locator and returned
to SHA-256
`f64ff406c68889d8e42662d6c098076b0e7f73d26e4e167e36a3bb2f4fd95744`,
exactly matching the pre-break diagnostic baseline.

Fresh generated-test review, TypeScript, focused ESLint, and spec drift all exited
0. The final live gate was run once against the restored target with Chromium, one
worker, zero retries, and three repeats. It exited 0 with `expected=3`,
`unexpected=0`, `skipped=0`, and `flaky=0`; Playwright reported 3 passed.

The accepted gate cleaned its transient JSON, HTML, and test-results directory, as
did the earlier accepted baseline gate. Successful evidence is retained in the Task
3 and Task 6 reports and their recorded snapshots, not as durable raw gate JSON.
The retained generation, controlled-RED, and healer failures remain historical
diagnostics and were not deleted.

## Comparison with 2026-08-04

| Aspect | 2026-08-04 | 2026-08-05 rerun |
| --- | --- | --- |
| Fresh generation | Cache-disabled Codex CLI candidate failed closed at the live promotion gate. | Same safety result: one cache-disabled Codex CLI provider attempt; status `failed`, stage `runtime-test`, reason `gate-rejected`; source archived, not promoted. |
| Fresh external-flow evidence | Registration-by-code returned 400 with a reported database constraint failure; later runs varied. | Registration initialization returned 200, registration-by-code returned 400, and the UI showed a registration-by-code error. The fresh evidence does not establish the response-body or backend cause. |
| Independent unchanged baseline | Later repeats sometimes passed, but no separate accepted 3/3 baseline was reported. | Independent unchanged baseline passed 3/3 with zero retries, failures, skips, or flakiness. |
| Controlled RED | The intentional accessible-name mismatch failed before registration work. | Same valid early RED. |
| Triage | `synchronization` / `ACTIONABILITY_TIMEOUT`. | Same classification and reason despite the known zero-match locator. |
| Healer attempts and proposal | One accepted candidate restored the locator, passed policy/static checks and two live verification runs, and became `proposal-ready`. | Three attempts were policy-rejected; no candidate, diff, digest, static candidate check, or live candidate verification exists; terminal status `exhausted`. |
| Proposal-only mutation safety | Broken target remained unchanged; controller promoted the reviewed line. | Broken target again remained unchanged; later controller restoration was authorized cleanup only because no proposal existed. |
| Public diagnostics | A useful preflight condition became generic `HEAL_ERROR`. | Exhaustion became generic `HEAL_EXHAUSTED` with omitted details; attempt archives likewise omit rule/reason visibility. |
| Final gate | Three-repeat gate rejected the target after one pass and one registration-code failure; third repeat did not run. Final status was not GREEN. | Restored target passed a fresh independent 3/3 final gate. This does not explain the earlier generation-promotion failure. |
| Successful receipts | The failed final gate was retainable evidence. | Both successful gates cleaned their raw execution directories; success survives only in task reports/snapshots. |

The strongest current inference is limited: one promotion run failed at the
registration-by-code path, then the byte-identical target passed an independent 3/3
baseline and a later restored-byte 3/3 final gate. This is run-to-run uncertainty in
the external journey, not proof of a test fix, permanent product defect, healed
candidate, or specific backend root cause.

## What worked well

1. **Generator fail-closed safety held.** Static acceptance did not override the live
   promotion rejection; the generator archived the source and left the target absent.
2. **Proposal-only mutation safety held.** Even after three failed healer attempts,
   the broken target digest was unchanged. No unverified source reached the target.
3. **The controlled RED was causal and early.** It failed on the intentionally
   mismatched locator before identity submission and registration requests.
4. **Acceptance checks remained meaningful.** Static checks passed without weakening
   the final assertion, while independent three-repeat gates provided stronger live
   evidence than a single promotion failure.
5. **Artifact boundaries were mostly clear.** Manifest, triage, attempt outcomes, and
   source digests support audit without publishing raw browser content.
6. **Source, prompt, and report boundaries excluded live credentials and identity.**
   Sensitive values were confined to process runtime and raw Playwright diagnostics;
   no authentication state was promoted or committed.

## Improvement candidates

### Framework-owned

#### 1. P0 — Make healer policy rejection actionable

- **Owner:** Framework healer/policy diagnostics.
- **Observed evidence:** All three attempts were `rejected-policy`, but both public
  output and immutable attempt records omit violated rule IDs and operator-safe
  reasons. No candidate, diff, or digest was retained, so the intended one-line fix
  could not be audited. The healer exhausted a clearly reproducible, repairable RED.
- **Expected behavior:** Retain stable policy reason codes, a redacted issue list,
  and enough candidate identity or bounded diff metadata to determine why a proposal
  was rejected without disclosing source secrets. Never promote a rejected candidate.
- **Reproducible next check:** Run the controlled zero-match fixture with one healer
  output that violates a known policy. Assert the CLI, `heal-summary.json`, and attempt
  record name the same allowlisted rule code and archive path while the target digest
  remains unchanged.

#### 2. P1 — Classify persistent zero-match locators as locator drift

- **Owner:** Framework triage/classification.
- **Observed evidence:** On both dates, a deliberately changed accessible name that
  resolved to zero elements for the full action timeout was classified
  `synchronization` / `ACTIONABILITY_TIMEOUT`.
- **Expected behavior:** Distinguish a persistent zero-match locator with a visible
  near-match from an element that exists but is not yet actionable. Emit
  `locator-drift` when bounded evidence supports that distinction and fall back to
  synchronization when it does not.
- **Reproducible next check:** Use two local fixtures: one with a permanently wrong
  accessible name and one with a correctly named link inserted after a delay. Assert
  different classifications while preserving the same repairability boundary.

#### 3. P1 — Replace generic terminal diagnostics with safe reason chains

- **Owner:** Framework healer CLI and redaction layer.
- **Observed evidence:** The earlier preflight failure surfaced only generic
  `HEAL_ERROR`; this rerun surfaced `HEAL_EXHAUSTED: Diagnostic details were omitted.`
  The safe run path, triage result, policy-rejection count, and failed stage could all
  have been reported without live values.
- **Expected behavior:** Public output should include a stable terminal code, last
  completed stage, safe nested reason codes, attempt counts, and archive path, while
  continuing to redact candidate content and runtime data.
- **Reproducible next check:** Exercise pending-spec, policy-rejected, and exhausted
  fixtures and snapshot their public output. Confirm each is distinguishable and
  secret-free.

#### 4. P1 — Preserve durable redacted receipts for accepted gates

- **Owner:** Framework generated-test gate/artifact lifecycle.
- **Observed evidence:** Both independent 3/3 accepted gates deleted their execution
  directories, including raw JSON. Exact counts survive only in task reports, whereas
  failed gates retain rich raw evidence.
- **Expected behavior:** Continue cleaning sensitive browser artifacts by default,
  but retain a small immutable receipt containing target/spec digests, project,
  repeat count, retry policy, verdict counts, timestamps, and gate reason code.
- **Reproducible next check:** Run a passing three-repeat local fixture, confirm raw
  trace/media cleanup, and validate a secret-free receipt against the known JSON
  verdict before cleanup.

#### 5. P1 — Produce a redacted failure digest beside sensitive Playwright evidence

- **Owner:** Framework gate reporting and secret-boundary controls.
- **Observed evidence:** Raw Playwright failure artifacts retained live-identity
  matches. A username-shaped substring also matched public product-name text, so that
  substring alone cannot establish credential exposure. Source, provider input, and
  this report have a stricter no-live-value boundary, requiring careful bounded
  extraction from sensitive diagnostics.
- **Expected behavior:** Mark raw failure bundles as sensitive and uncommittable, and
  generate a separate allowlisted digest containing only step, safe endpoint path,
  method, status, error category, and run correlation metadata. Payloads, headers,
  cookies, storage, identity, screenshots, and trace content must stay out.
- **Reproducible next check:** Run a failing local fixture with seeded sentinel values.
  Assert the raw bundle is excluded from source/report publication, the digest contains
  the safe status sequence, and an exact sentinel scan of the digest is clean.

#### 6. P2 — Report promotion uncertainty across independent gates

- **Owner:** Framework generation/gate summaries.
- **Observed evidence:** One generation promotion run rejected the unchanged source,
  followed by two independent 3/3 successful gates on identical/restored-identical
  bytes. The retained failure shows an application-level 400, but accepted gate raw
  receipts were cleaned.
- **Expected behavior:** Keep fail-closed promotion, while making the failed repeat,
  target digest, safe divergence point, and later independent receipt IDs easy to
  compare. Summaries should label this as inconsistent external execution rather than
  inventing a test or backend cause.
- **Reproducible next check:** Use a deterministic fixture that returns one injected
  application 400 followed by six successes. Verify promotion rejects, both later
  gates accept, and the comparison layer reports the conflicting receipts without
  relabeling the initial rejection.

### PsychicBook product/backend-owned

#### 7. P1 — Make the registration-by-code journey reproducible

- **Owner:** PsychicBook product/backend stage environment.
- **Observed evidence:** In the fresh promotion failure, registration initialization
  returned 200, registration-by-code returned 400, the UI showed a registration error,
  and the final account control never appeared. The unchanged journey then passed all
  six runs across two independent 3/3 gates. The fresh evidence does not identify why.
- **Expected behavior:** For the reviewed returning-user precondition and deterministic
  stage code, registration-by-code should produce one stable documented outcome and
  the UI should reach the reviewed account control on every repeat.
- **Reproducible next check:** Run a product-owned, payload-redacted repeated stage
  probe for the same reviewed precondition and correlate each initialization/code
  status with server-side request IDs and logs. Compare failing and passing requests
  without publishing identity, device data, headers, or bodies.

## Conclusion

The rerun ended with a restored target that passed all static checks and a fresh 3/3
live gate, but the healer itself did not heal anything. Generation failed closed,
the controlled RED was valid, proposal-only mode preserved the broken target, and
all three healer attempts were policy-rejected before candidate verification. The
manual one-line restoration was authorized cleanup outside the healer.

The highest-value framework work is to make policy rejection auditable, distinguish
locator drift from synchronization, publish safe terminal reasons, and retain small
redacted success/failure receipts. Product-side follow-up should investigate the
fresh registration-by-code 400 as an intermittent stage symptom. The two later 3/3
passes narrow the claim to unresolved variability; they do not establish its cause.
