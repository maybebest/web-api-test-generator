# Test Generation Gates and Telemetry Design

## Purpose

Reduce time-to-green by removing repeated process, compiler, and browser work while preserving the existing deterministic reviewer and three-repeat final acceptance standard.

## Scope

- Single-candidate and all-spec generated-test gates.
- UI command orchestration and queueing.
- End-to-end generation telemetry, offline/online evaluation, and CI wiring.

## Gate architecture

There are two explicit lanes:

- **Fast acceptance:** validate once, run the in-process AST reviewer, typecheck/collect with reusable global results, and execute the candidate once with fail-fast behavior. This is used before candidate promotion and during repair.
- **Full acceptance:** run the accepted target three times and reject failed, skipped, or flaky results. This remains the stability gate for final acceptance and CI-capable environments.

All-spec orchestration validates the directory once, performs full-project TypeScript checking and Playwright collection once per repository revision, reviews spec/test pairs in-process with bounded concurrency, then executes independent targets with bounded concurrency and isolated report/evidence directories. Per-spec child gates do not repeat global checks already completed by the parent.

The UI replaces the global single-flight lock with scoped coordination: writes to the same target serialize, independent targets may proceed within a configured provider/browser concurrency cap, and read-only validation is not blocked by an unrelated generation.

## Telemetry

A run identifier spans fit, spec validation, context assembly, cache lookup, provider attempts, response parsing, candidate review, typecheck, execution, promotion, and final acceptance. Every attempt is recorded in a sanitized append-only run manifest, including failures.

The reporter aggregates:

- success/failure counts and failure stages;
- first-pass review and runtime pass rates;
- uncached input, cache writes, cache reads, output, reasoning, retries, and unknown token counts;
- exact/provider cache hit ratios;
- provider, stage, and end-to-end p50/p95 latency; and
- total attempts and tokens-to-green.

Successful gate outcomes are persisted with their policy/context fingerprints rather than deleted. Prompt text and secrets are never recorded.

## CI and evaluation

Normal verification must not describe static review as runtime acceptance. CI runs the complete deterministic local generated-candidate lane where the local fixture supports it; authenticated external regression remains a separate opt-in job. Offline golden evaluation remains hermetic, while a separate explicit paid online evaluation supports pinned provider/model/settings and multiple samples.

## Error handling and isolation

- Each execution uses unique report, result, and evidence directories.
- A failing global check prevents redundant child execution.
- Fast-gate failure preserves the candidate and diagnostics but never replaces the known-good target.
- Bounded concurrency avoids provider, browser, and auth-state contention.
- Cancellation propagates to provider backoff, child processes, and queued work.

## Acceptance criteria

- One all-spec run performs directory validation, whole-project typecheck, and whole-suite collection no more than once.
- Fast acceptance runs one repeat; full acceptance retains three repeats.
- Normal CI makes no false runtime claim and executes locally supported generated candidates.
- Every paid attempt, including failures, is reportable and joinable to quality outcomes.
- Reporter output includes p50/p95 latency and trustworthy disjoint token totals.
