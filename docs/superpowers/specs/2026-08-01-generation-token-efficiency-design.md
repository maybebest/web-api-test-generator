# Test Generation Token-Efficiency Design

## Purpose

Reduce total paid tokens-to-green without weakening generated-test correctness. Optimize the canonical input, deterministic output, cache policy, and stage routing rather than relying on a lower output ceiling.

## Scope

- REST and CLI prompt construction for flow-spec and recording-driven Playwright generation.
- Provider prompt caching and local exact-result caching.
- Stage-specific provider/model configuration and opt-in escalation.
- Token/cost reporting. No provider prices are hard-coded.

## Canonical generation IR

Validated specs compile to a versioned JSON-compatible generation IR. It contains behavioral metadata, user story, preconditions, variants, business rules, canonical JSON data cases, mocks, flow steps, negative cases, acceptance criteria, and locator hints. It omits governance prose, duplicated human Data Cases when canonical JSON exists, shell commands, and repeated policy text.

A complete versioned policy is placed in the stable system prefix. Dynamic IR and bounded repository/DOM context follow it. Semantic-equivalence tests prove every mandatory generation rule exists in either the stable contract or dynamic IR.

Deterministic code generation owns values that do not require model judgment: the spec header, tag/annotation scaffolding, normalized data constants, and other mechanically derivable metadata. The model remains responsible for actions, page-object integration, mocks, and meaningful assertions.

## Cache policy

- Provider prompt caching defaults off until measured reuse is demonstrated for the selected stage/model.
- When enabled on providers with billable writes, only a stable prefix is explicitly cacheable; changing task context is never placed behind an implicit write breakpoint.
- Cache telemetry records disjoint uncached-input, cache-write, cache-read, output, and reasoning buckets.
- Local exact-result entries are keyed by provider/model, output contract, all output-affecting settings, generation IR fingerprint, repository/DOM context fingerprint, and policy version.
- Syntax-valid output may be retained as an unverified candidate, but only statically/runtime accepted entries are served as reusable accepted results. A failed review/gate invalidates or quarantines the entry.
- Concurrent identical misses use single-flight deduplication.

## Stage routing

The fit stage and test-generation stage have independent provider/model settings. Defaults remain behavior-preserving until an approved online evaluation exists. The framework supports a cheaper first route and a stronger escalation route, but escalation occurs only after deterministic diagnostics identify a failed candidate; it is never a blind retry.

Mode-aware output limits are guardrails against runaway responses, not claimed savings. Single, suite, recording, and fit stages can use separate configured limits.

## Measurement and rollout

The baseline and every experiment record first-pass static pass rate, fast/full runtime pass rate, attempts, input/output/cache/reasoning tokens, total tokens-to-green, provider latency, and end-to-end p50/p95. Experiments disable exact-result caching, pin provider/model/settings, use multiple samples, and compare one factor at a time.

Changes roll out behind configuration flags. A default changes only after executed correctness is non-inferior and median or p95 tokens/latency improve materially.

## Acceptance criteria

- Canonical IR is materially smaller than current compact prompts on the checked-in corpus and preserves required semantics.
- Duplicate human/JSON data-case payloads are not both sent to the provider.
- Cost calculation uses disjoint token categories and never treats unknown usage as zero.
- Failed/refused/truncated calls appear in usage reports.
- Cache defaults cannot create repeated billable writes for unique one-shot tasks without explicit opt-in.
- Stage routing is configurable and measurable without changing provider defaults silently.
