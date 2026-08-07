# PsychicBook generation and healer feedback — 2026-08-04

## Scope

The experiment exercised the repository's real spec-bound generation and proposal-only healing workflow against the external PsychicBook stage flow. Live identity and HTTP Basic values were supplied only through environment variables and are not recorded here or in the generated source.

Requested flow:

1. Open the stage landing page through HTTP Basic authentication.
2. Activate **Get Started**.
3. Submit the runtime email.
4. Select **Have a verification code instead?**.
5. Submit the deterministic code `1234`.
6. Verify the account control in the authenticated top menu.

## Artifacts

- Flow spec: `specs/psychicbook-healing-experiment.md`
- Restored generated target: `tests/regression/psychicbook-healing-experiment.spec.ts`
- Fresh generation task: `.ai-runs/2026-08-04T18-20-51-358Z-flow-psy-heal-001/`
- Failed verified-generation run: `.ai-runs/generation/16e32e1e-b13c-40e3-aa9b-e0cf7ac6300c/`
- Rejected generated candidate: `.ai-runs/rejected/16e32e1e-b13c-40e3-aa9b-e0cf7ac6300c/candidate.ts`
- Successful healer proposal: `.ai-runs/heal/1785868007372-40592-d156e58e-04b0-4c4a-a521-46e0e9004317/`
- Final three-repeat gate evidence: `.ai-runs/gate-1785868126996-41219-8f0422de-5734-43f5-a90e-2f15a33b3438-psychicbook-healing-experiment/`

## Observed results

### Fresh generation

- The previous experiment target was removed before generation.
- Strict spec validation initially rejected a `generated` spec whose target had just been removed. Changing `Generation Status` to `pending-generation` made the contract valid.
- A new manifest-bound task was created and the Codex CLI brain was invoked with the result cache disabled.
- The brain produced a statically valid test. Review, listing, and TypeScript checks passed.
- The fast live promotion gate failed, so verified generation correctly did not write the target and archived the candidate as rejected.
- Generation run status: `failed`, stage `runtime-test`, reason `gate-rejected`, fast gate `false`.

### External stage behavior

The failing browser state remained on **Verify your Email** and displayed:

`An error occurred while registration by code.`

The corresponding request was:

`POST /profile/user/web/registration/code -> 400`

The response identified a backend data-integrity failure:

`constraint [device__device_id__brand_key]`

The preceding registration-init request and the code request used the same device identifier. An independent control run reproduced the same HTTP 400. Later repeats sometimes passed, proving that the external flow is currently nondeterministic rather than permanently unavailable.

### Controlled RED and healer

The fresh candidate was materialized only for the bounded healer experiment. Exactly one semantic locator was changed:

`Get Started` -> `Get Started BROKEN`

The isolated run failed at that locator before reaching the registration APIs.

The first healer invocation stopped before browser work because the spec was still marked `pending-generation`. The public CLI output was only:

`HEAL_ERROR: Diagnostic details were omitted.`

After temporarily marking the materialized diagnostic target `generated`, the real healer run:

- reproduced the locator timeout;
- classified it as repairable `synchronization` with reason `ACTIONABILITY_TIMEOUT`;
- invoked the Codex CLI heal brain once;
- changed only `Get Started BROKEN` back to `Get Started`;
- passed policy, typecheck, lint, generated-test review, candidate integrity, and diff checks;
- passed two consecutive live Chromium verification runs;
- returned `proposal-ready`;
- left the deliberately broken target unchanged, as required in proposal-only mode.

The one-line proposal was then applied through the controller rather than healer `--apply`.

### Final verification

Static verification passed:

- generated-test review;
- TypeScript;
- focused ESLint;
- spec drift for all 27 header-linked tests.

The default full gate used three repeats with retries disabled. Its result was:

- repeat 1: passed;
- repeat 2: failed with the same `/registration/code` HTTP 400 and database constraint error;
- repeat 3: not run because the gate stopped on the first failure.

The full gate correctly rejected the target as nondeterministic. Final status is **not GREEN**.

## What worked well

1. Verified generation failed closed: the live-rejected candidate never replaced the target.
2. Runtime credentials and identity stayed out of the spec, generated test, provider input, and this report.
3. The controlled locator failure was repairable and the healer proposed the exact intended one-line change.
4. Proposal-only mode preserved the broken target and retained a bounded audit archive and diff.
5. The three-repeat acceptance gate detected stage flakiness that two consecutive healer verification runs did not expose.
6. Static gates rejected neither the intentional assertion nor the locator policy, and the healer did not weaken the assertion.

## Improvement candidates

### P0 — PsychicBook stage registration must be deterministic

Make `/profile/user/web/registration/code` idempotent for the device created or registered during `/registration/init`, or correct the transaction/state transition that intermittently attempts to insert the same `deviceId + brand` twice. Until this is fixed, the requested test cannot be a deterministic regression gate.

### P1 — Align healer verification with the final promotion gate

`proposal-ready` was emitted after two live passes, but the mandatory three-repeat gate failed immediately afterward. For external targets, use three healer verification runs by default or require the same full-gate receipt before reporting a proposal as promotion-ready.

### P1 — Preserve actionable preflight errors

The healer converted the useful `pending-generation` contract error into the generic `HEAL_ERROR`. Public redaction should preserve allowlisted operator-safe diagnostics or emit a stable reason code such as `SPEC_PENDING_GENERATION` plus the audit/run path.

### P2 — Clarify spec status transitions

Removing a generated target requires manually changing the spec to `pending-generation`, and healer then requires changing it back to `generated` once a diagnostic target exists. Provide an explicit regeneration command or an atomic status transition so operators do not have to coordinate this state manually.

### P2 — Improve failure classification

A known non-matching accessible name was classified as `synchronization / ACTIONABILITY_TIMEOUT`. Distinguish a locator that resolves to zero elements for the entire action timeout from genuine synchronization failures and classify it as `locator-drift`.

### P2 — Surface downstream product evidence in gate summaries

The top-level failure reports only the missing final account-control locator. The trace clearly shows the preceding registration error and HTTP 400. Add bounded console/network/UI-error evidence so the first summary points to the product failure rather than the consequential final assertion.

## Conclusion

The framework's safety boundaries behaved well: generation and the full gate rejected bad or flaky outcomes, and proposal-only healing made a minimal auditable repair without mutating the target. The main correctness gap is that a two-run healer verification can label a proposal ready on an intermittently failing external flow that the standard three-run gate subsequently rejects.
