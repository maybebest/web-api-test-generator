# Efficiency metrics (ai-efficiency-snapshot/v2)

One committable JSONL row per snapshot in `.ai-metrics/metrics-history.jsonl`;
`npm run ai:metrics:report -- --trend` renders the curve. Rule: every shipped
improvement = its own snapshot (`--snapshot --label <change>`), so the history
answers "did it reflect?".

## Window counters (unambiguous by design)
- `started` — all generation runs in the window
- `providerCalledRuns` — runs with >=1 provider attempt (a result-cache hit is
  started+promoted but NOT provider-called)
- `providerCalls` — total provider attempts (retries visible)
- `promoted` = `acceptedClean` + `acceptedWithWarning`
- `billedTokens`, `savedTokens`

## The metric set
1a. **Yield (started)** = promoted / started — pipeline output; cache hits
    legitimately raise it.
1b. **Yield (provider-called)** = promoted / providerCalledRuns — return on
    paid calls.
2.  **Tokens per accepted (TPA)** = billedTokens / promoted (null when 0).
3.  **First-pass static rate** = first-attempt static-review passes / runs
    reaching static review — prompt<->reviewer contract health.
4.  **Waste by stage** — snapshots store raw facts
    `{stage, reasonCode, terminalOutcome, runs, tokens}`; display classes
    (environment / static-review / runtime / other) are computed at render
    time by the versioned rule `waste-class/v1`. History is immutable; the
    classification lens is versioned.
5.  **Cache efficiency** = hits/lookups; savedShare = saved/(saved+billed).
6.  **Time-to-accepted** = e2e p50/p95 of promoted runs only.
7.  **Heal frugality** = zero-provider-call heal runs / all heal runs,
    annotated with audit trust: `overturn X% (coverage N/M)` from
    `.ai-metrics/triage-audits.jsonl` (`{healRunId, verdict, auditedAt}`).
    Zero overturn with zero coverage renders as `n/a - unaudited`.
    Append an audit after manually re-checking a zero-call triage:
    `node scripts/ai/metrics-report.mjs --audit-triage <healRunId>
    --verdict confirmed|overturned [--notes <text>]` (validates the heal run
    exists under `<runs>/heal`; the latest row per heal run wins).
8.  **Tokens per successful heal** = heal tokens / (healed + proposal-ready).

## Quality marker
`accepted_clean` vs `accepted_with_warning`: both count as success in yield;
the split is an early-warning signal of quality drift before it becomes
rejections.

Accepted-run manifests additionally persist `staticReviewWarningKinds`
(bounded, stable kind identifiers such as `ungrounded-accessible-name` —
never full warning texts) alongside `staticReviewWarningCount`. Historical
runs carry `null` (unknown). `metrics-report` does not consume the kinds yet;
they are a future metric input for warning-family trend reporting.

## Compatibility
v1 history rows are never rewritten; trend renders mixed v1+v2 (dashes for
fields v1 lacks). New snapshots are always v2.
