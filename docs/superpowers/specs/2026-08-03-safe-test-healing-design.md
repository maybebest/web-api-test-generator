# Safe Test Healing Design

**Date:** 2026-08-03

**Status:** Approved direction, pending written-spec review

## Goal

Harden `packages/web` test healing so an AI-generated locator or synchronization repair cannot silently change tested behavior, bypass a source contract, overwrite deliberate local work, or be promoted without the same quality controls as the affected test type.

## Scope

This design covers the existing opt-in command:

```bash
npm run ai:test:heal -- --test <test-file>
```

It keeps healing outside CI and does not introduce runtime self-healing, retries, skipped tests, automatic assertion updates, or automatic product-contract changes.

An intentional functionality change remains a spec-first workflow. The healer is only for behavior-preserving locator drift or synchronization repair.

## Approaches Considered

### 1. Prompt-only hardening

Add stronger instructions to the existing heal prompt and keep the current whole-file promotion flow.

This is small, but unsafe. The current deterministic guard already demonstrates that prompts do not enforce title, annotation, test-data, recording-header, or assertion-operand preservation.

### 2. Deterministic safety envelope around the existing provider transport

Keep the provider-compatible complete-file response internally, but derive a bounded diff and accept it only after deterministic triage, semantic-invariant comparison, source-contract routing, static checks, and repeated execution. Default to proposal-only; require explicit apply permission and a clean target before promotion.

This is the recommended approach. It addresses the identified safety failures without introducing a multi-file patch language or a second execution framework.

### 3. General multi-file autonomous repair engine

Let the provider edit tests, Page Objects, components, fixtures, and specs through a structured patch protocol and verify the result in a copied workspace.

This could repair more failures, but it materially increases atomicity, provenance, context, and rollback risk. It is outside this change. Page Object evidence will be provided as read-only context; a failure that requires a Page Object edit becomes a human-reviewed proposal rather than an automatic promotion.

## Selected Architecture

The healer becomes a fail-closed pipeline with five explicit boundaries:

1. **Triage:** classify sanitized runtime evidence before invoking the heal model.
2. **Candidate policy:** compare immutable behavioral semantics, not only assertion counts.
3. **Source contract:** run the reviewer and drift controls belonging to a Markdown spec, Chrome recording, or handwritten test.
4. **Promotion policy:** produce a proposal by default; apply only with explicit permission and clean-target protection.
5. **Audit evidence:** persist a sanitized machine-readable record of classification, context fingerprints, model metadata, diff, checks, and outcomes.

The provider may continue returning a complete TypeScript file because that is the existing stable output contract. The system treats that response as untrusted input, computes a bounded unified diff, and permits only behavior-preserving changes.

## Failure Triage

Add a deterministic triage result with this shape:

```js
{
  schema: 'test-heal-triage/v1',
  classification: 'locator-drift' | 'synchronization' | 'environment' | 'data' | 'product-or-contract' | 'unclassified',
  repairable: boolean,
  reasonCodes: string[],
  evidenceFingerprint: string
}
```

Automatic healing is permitted only for `locator-drift` and `synchronization`.

The classifier is conservative:

- locator/action timeout, strict-mode locator violations, detached-element action failures, and missing locator targets may be `locator-drift`;
- actionability and bounded readiness timeouts may be `synchronization`;
- expected/received assertion mismatches, response/status mismatches, explicit product errors, missing test data, authentication failures, network failures, setup failures, and unknown failures are not repairable;
- contradictory evidence is `unclassified` and fails closed.

`runtime-environment` gate outcomes remain non-repairable before text classification.

The archive stores only sanitized evidence. Trace, screenshot, video, cookies, headers, and storage state are never sent to the provider or persisted by the healer.

## Immutable Behavioral Semantics

The post-provider guard must preserve these facts exactly:

- `/* spec: ... */` and `/* recording: ... */` traceability headers;
- import declarations and fixture callback bindings;
- test, describe, and `test.step` titles;
- Playwright tags and annotations;
- test data and action payloads such as `fill`, `type`, `press`, `selectOption`, request bodies, and navigation targets;
- every assertion matcher and its expected arguments;
- assertion count and assertion control-flow position;
- recording `RSTEP-###` and `ASSERT-###` coverage tokens;
- generated-test `AC-###`, `NEG-###`, and `covered-ac-ids` tokens.

Allowed differences are limited to:

- locator expressions and their semantic locator arguments;
- synchronization primitives already allowed by repository policy, such as locator/web assertion waits;
- comments directly documenting a locator-policy exception;
- formatting that does not change the facts above.

The existing bans on skip/fixme/fail/only, hard waits, XPath, `nth-child`, secret-like literals, swallowed failures, conditional assertions, and unjustified positional picks remain in force.

The guard reports stable reason codes so rejected attempts can be fed back to the model and tested without matching prose.

## Source-Contract Routing

The healer detects exactly one source contract before the baseline run:

### Markdown-spec test

- Resolve and validate the owning Markdown spec.
- Run the generated-test reviewer against the candidate.
- Verify the spec hash remains current.
- Execute the generated-test gate for the selected project.

### Recorded test

- Parse the immutable recording header to obtain the recording path.
- Validate the recording.
- Run the recorded-test reviewer against the candidate.
- Run recording drift verification.
- Execute the recorded-test gate under `local-chromium`.

### Handwritten test

- Require the target to be covered by the repository's handwritten/no-header policy where applicable.
- Run semantic policy, TypeScript, ESLint, and the selected Playwright project.
- Never auto-apply without explicit `--apply`, even when the target is clean.

Ambiguous or malformed contracts fail before provider invocation.

## Context Collection

The provider request contains bounded, secret-checked context:

- sanitized runtime error evidence;
- the target test source;
- signatures and relevant locator-bearing methods from local Page Object or Component imports;
- an optional explicitly supplied DOM/accessibility snapshot through `--dom-snapshot <path>`.

The DOM snapshot must be a regular non-symlink file inside `.ai-runs/dom-discovery`, must pass the configured byte limit, and must be redacted before use. The healer does not search for or silently select stale discovery artifacts.

Imported context is read-only. If the required fix belongs in a Page Object, the run ends as `manual-change-required` with the candidate diff and evidence; it is not promoted by editing the test around the Page Object contract.

## Proposal and Promotion

Proposal-only is the default:

```bash
AI_AUTOHEAL_ENABLED=true npm run ai:test:heal -- --test <file>
```

A verified candidate is archived and reported as `proposal-ready`; the target remains unchanged.

Promotion requires:

```bash
AI_AUTOHEAL_ENABLED=true npm run ai:test:heal -- --test <file> --apply
```

Before promotion the healer must prove:

- the target still matches the starting device/inode/content snapshot;
- the candidate still matches the verified candidate hash;
- the target is clean according to Git;
- semantic policy, source reviewer, TypeScript, ESLint, drift, and repeated Playwright execution all passed;
- verification runs were serial with `workers=1`, `retries=0`, and the configured repeat count.

`--allow-dirty` permits applying over an already-dirty target only when combined with `--apply`. The original bytes are archived first, and concurrent changes still abort promotion.

Promotion remains a single-file atomic rename. Multi-file automatic promotion is not part of this design.

## Audit Record

Each run writes private files under `.ai-runs/heal/<run-id>/` with mode `0600`:

- `original.ts`;
- sanitized `evidence.json`;
- `candidate.diff` and accepted/rejected candidate source when safe;
- `heal-summary.json`.

The summary includes:

- schema and run identifiers;
- target and source-contract kind;
- original and candidate SHA-256 hashes;
- triage classification, reason codes, and evidence fingerprint;
- prompt schema, provider kind/model, and token usage when available;
- each policy/reviewer/typecheck/lint/drift/runtime outcome;
- proposal/apply mode and final status.

Secret-bearing candidates are never archived as source. Raw browser artifacts are removed after sanitized evidence extraction.

## CLI and Status Contract

Add these flags:

- `--apply` — promote a fully verified candidate;
- `--allow-dirty` — allow promotion over a dirty starting target, valid only with `--apply`;
- `--dom-snapshot <path>` — include one verified bounded discovery artifact;
- existing `--test`, `--spec`, `--project`, `--max-attempts`, and `--verify-runs` remain.

New terminal statuses:

- `not-repairable` — triage rejected healing;
- `proposal-ready` — candidate passed all gates but was not applied;
- `manual-change-required` — evidence points to an imported Page Object/Component or another file;
- existing `healed`, `already-green`, `environment-failure`, `exhausted`, `brain-error`, and concurrent-mutation statuses remain.

The command exits zero for `already-green`, `proposal-ready`, and `healed`. Other statuses exit nonzero.

## Testing Strategy

Development follows red-green-refactor cycles.

Required regression tests include:

1. changing `toHaveText('Saved')` to `toHaveText('Save failed')` is rejected;
2. changing test/step titles, tags, annotations, imports, fixtures, or action payloads is rejected;
3. removing or changing a recording header, `RSTEP-###`, or `ASSERT-###` token is rejected;
4. a product assertion mismatch, auth/network/data error, or unknown error never invokes the provider;
5. locator and synchronization evidence can reach the provider;
6. recorded candidates run the recorded reviewer and drift checks;
7. lint failure prevents proposal and promotion;
8. default mode leaves the target unchanged and emits `proposal-ready`;
9. `--apply` rejects a dirty target unless `--allow-dirty` is present;
10. a concurrent target or candidate edit aborts promotion;
11. DOM context path, symlink, size, and secret checks fail closed;
12. sanitized audit records contain classification and provider metadata without secret material;
13. all verification runs are serial and retry-free.

Targeted unit tests, the complete AI self-test suite, TypeScript, ESLint, relevant static reviewers/drift checks, and deterministic local Playwright gates must pass before completion is claimed.

## Documentation Changes

Update the healer prompt, architecture, troubleshooting, environment example, and CLI help to state:

- healing is proposal-only by default;
- `--apply` and clean-target rules;
- only locator/synchronization failures are repairable;
- intentional functionality changes require spec-first updates;
- recorded tests use the recording reviewer/gate;
- Page Object changes require human review.

## Non-Goals

- modifying product code;
- updating expected values automatically;
- changing Markdown specs or recordings automatically;
- autonomous multi-file Page Object promotion;
- enabling healer execution in CI;
- retaining authenticated traces, screenshots, videos, or storage state;
- treating repeated green execution as proof that a behavioral change is correct.
