# Efficiency fixes: pre-LLM environment preflight, healer triage/observability/adaptive retry

Date: 2026-08-08. Basis: framework efficiency audit (same day). Branch: audit/efficiency-20260808.

## Problem
Audit of packages/web/.ai-runs shows 180,445 tokens per accepted generated test: fast-gate yield 1/9,
with 4/8 rejections classified runtime-environment — conditions detectable without a provider call.
The healer burned 33,933 tokens on retries whose prompts were byte-identical (inputTokens 15,863 twice),
mislabels auth-400 env breakage as product-or-contract (regex only matches 401/403), records no
timings/usage in heal-summary.json, keeps providerAttempts=[] on brain-error, and writes no archive
at all on environment-failure aborts.

## Fixes (in scope)
F1 generation env-preflight (verified-generate.mjs + new lib module):
  Before the test-generation provider stage: (a) build the same sanitized gate environment the
  fast-gate will use; fail fast if the target project's config cannot load (missing env vars);
  (b) probe the target origin over HTTP (HEAD, then GET fallback; 10s timeout; one retry) using
  existing env config. Failure -> run fails with stage 'environment-preflight',
  failureReason 'environment-preflight', zero provider tokens, telemetry event recorded like other
  stages. Default ON; escape hatch AI_ENV_PREFLIGHT=false (repo flag conventions).
F2 healer triage env label (test-heal-triage.mjs):
  HTTP 400 combined with an auth context (/authorization|login|auth/i within the same evidence item)
  classifies as environment-failure (still non-repairable, still zero provider calls).
  Non-auth 400 stays product-or-contract. 401/403 behavior unchanged.
F3 healer observability (heal-test.mjs):
  - per-stage durationMs (baseline, triage, each provider attempt, verify) persisted in heal-summary.json;
  - brain-error attempts recorded in providerAttempts with error kind and null usage;
  - environment-failure aborts write a heal-summary.json archive (status not-healed, class, timings).
F4 adaptive heal retry (test-heal.mjs prompt assembly):
  Attempt N+1 prompt includes a structured digest of attempt N's rejection: policy findings /
  gate errors verbatim (sanitized via existing redaction), plus an explicit instruction that the
  previous candidate was rejected for those reasons and must differ materially. Deterministic unit
  test asserts the digest is present and differs between attempts.

## Out of scope (deferred until codex quota reset makes them verifiable live)
AI_PROMPT_CACHE / AI_REPAIR_ENABLED default flips; generation prompt-contract change for helper dedup.

## Testing
TDD per fix (failing unit test first). Full node --test self-suite green (806 baseline, 10 pre-existing
golden-eval fingerprint failures inherited from the base branch are the accepted baseline; if a touched
file is fingerprint-pinned, re-approve via the documented golden baseline procedure in the same commit).
Acceptance replays from the audit: healer on tests-dev my-sessions (dev agent-400) must now label
environment-failure with 0 provider calls and write an archive; generation preflight against a project
with missing env vars must fail pre-provider with 0 tokens.

## Landing
Two logical commits on audit/efficiency-20260808 (healer cluster F2-F4; generation F1), committed by
the coordinator after verification. Root-repo .env change (TEST_EMAIL_LOCAL_PART=aqa) applied directly.
