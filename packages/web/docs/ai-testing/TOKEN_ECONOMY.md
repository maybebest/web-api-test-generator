# Token Economy and Generation Telemetry

The generation path controls provider work without treating lower prompt size as a quality result:

1. **Semantic flow fitting** asks the provider for one strict `flow-spec-draft/v2` object. Application code renders the Markdown deterministically, including the human and JSON data-case projections and the stable locator/test policies. The human `_template.md` is not included in provider input.
2. **Canonical generation input** contains the generation IR plus one bounded, redacted context pack. The separately saved human task is never substituted for the manifest-bound `provider-input.md`.
3. **Task-specific structured output** uses the semantic flow-draft schema for fitting and a strict `{ "code": "..." }` schema for Playwright source when the selected transport supports it. Codex CLI always uses `--json --output-schema`.
4. **Provider prompt caching is opt-in.** It controls provider-side prefix caching only; it is separate from the local exact-result cache.
5. **Accepted-only exact-result caching** keeps a fresh Playwright response in memory until one Playwright command proves two clean retry-zero executions of its isolated candidate. Every logical execution must pass before atomic target promotion and exact-cache acceptance/promotion. Rejected, interrupted, refused, truncated, empty, malformed, or merely parseable output is not persisted.

These controls are instrumented so a later benchmark can compare tokens, latency, cache behavior, and unchanged gate quality. They are not evidence of a measured saving by themselves.

## Deterministic work before a provider

Verified Playwright generation performs input assembly and a readiness `preflight` before calling a REST or CLI brain. A missing or invalid flow, invalid project routing, unavailable Chromium executable, missing external `PLAYWRIGHT_TEST_BASE_URL`, or incomplete authentication setup rejects the run with zero provider attempts and leaves the requested target unchanged.

Saved flow tasks are also fail-closed. Their manifest binds the human task, canonical provider input, source spec and behavioral hash, target, generation mode, policy version, generation IR fingerprint, and context fingerprint. Drift or tampering is rejected before provider dispatch.

Flow fitting has its own provider-free boundary: the source is treated as untrusted data, recognized credential/token-shaped material is rejected without rejecting ordinary security prose or identifiers, and the complete fit transport (system contract, semantic suffix, separator where applicable, and source prompt) must fit the configured character budget before the fit brain is called.

## Defaults and controls

```dotenv
AI_STRUCTURED_OUTPUT=true
AI_COMPACT_REST_PROMPT=true
AI_PROMPT_CACHE=false
ANTHROPIC_PROMPT_CACHE_TTL=5m
OPENAI_PROMPT_CACHE_KEY=
AI_RESULT_CACHE=true
AI_RESULT_CACHE_EPOCH=
AI_CODEX_CLI_MODEL=
AI_MAX_PROMPT_CHARS=200000
AI_SPEC_FIT_MAX_PROMPT_CHARS=160000
OPENAI_REASONING_EFFORT=none
OPENAI_VERBOSITY=low
OPENAI_SERVICE_TIER=
```

- `AI_PROMPT_CACHE` controls provider-side prompt caching. `AI_RESULT_CACHE` independently controls the local accepted-result cache.
- Set `AI_RESULT_CACHE_EPOCH` to a new value when a behavior change must invalidate every exact-cache key. Set `AI_RESULT_CACHE=false` for a forced fresh generation.
- `AI_MAX_PROMPT_CHARS=200000` is a provider-independent fail-fast character limit for the actual REST or CLI payload, not a token estimate. `AI_<STAGE>_MAX_PROMPT_CHARS` takes precedence, and an explicit value cannot exceed the 2,000,000-character hard ceiling.
- `AI_SPEC_FIT_MAX_PROMPT_CHARS=160000` is the fit-specific default in `.env.example`; the fit runner also enforces a 160,000-character default when neither the stage nor global setting is present.
- `AI_STRUCTURED_OUTPUT=false` can opt older REST Playwright routes out of provider-enforced JSON schema. It does not allow a flow-fit provider to return Markdown, and Codex CLI remains schema-constrained.
- `AI_COMPACT_REST_PROMPT` affects Playwright REST prompts only. CLI brains receive the canonical task payload required by their transport.
- Keep GPT-5.6 reasoning and verbosity at their defaults until a quality evaluation justifies a change. A service-tier setting changes scheduling, not the acceptance criteria.

## Stage-aware routing

The routing stages are `SPEC_FIT`, `TEST_GENERATION`, `RECORDING_GENERATION`, and `REPAIR`. Each inherits the global route by default. A non-empty stage setting overrides only that stage:

```dotenv
AI_BRAIN=openai
AI_OPENAI_MODEL=gpt-global

AI_SPEC_FIT_BRAIN=anthropic
AI_SPEC_FIT_ANTHROPIC_MODEL=claude-fit
AI_SPEC_FIT_ANTHROPIC_MAX_TOKENS=2048

AI_TEST_GENERATION_OPENAI_MODEL=gpt-code
AI_TEST_GENERATION_OPENAI_MAX_TOKENS=12000
AI_TEST_GENERATION_OPENAI_REASONING_EFFORT=none
AI_TEST_GENERATION_OPENAI_VERBOSITY=low
```

Every stage accepts these suffixes:

- `BRAIN`, `ANTHROPIC_MODEL`, `OPENAI_MODEL`
- `ANTHROPIC_MAX_TOKENS`, `OPENAI_MAX_TOKENS`, `PROMPT_CACHE`, `MAX_PROMPT_CHARS`
- `OPENAI_REASONING_EFFORT`, `OPENAI_VERBOSITY`, `OPENAI_SERVICE_TIER`

For example, the repair cache switch is `AI_REPAIR_PROMPT_CACHE`, and the recording-generation OpenAI model is `AI_RECORDING_GENERATION_OPENAI_MODEL`. `AI_CODEX_CLI_MODEL` is global rather than stage-specific. Run `npm run ai:brain:doctor` to see the effective brain/model and setting source for every stage. The doctor reports sources without printing key material or calling a model.

`AI_REPAIR_ENABLED=false` is the default. When explicitly enabled, verified generation allows one repair orchestration attempt only after a machine-classified deterministic static-review failure. Its provider transport can still retry transient HTTP 429/5xx failures under the bounded retry policy, so physical requests and orchestration attempts remain separate telemetry concepts. The repair request contains the previous TypeScript source plus bounded, redacted diagnostics, not the original full task. `AI_REPAIR_MAX_SOURCE_BYTES=131072` rejects a larger source before provider work; the absolute ceiling is 2 MiB. Runtime/environment failures, provider refusals or truncations, target conflicts, and integrity failures are not repairable.

## Provider prompt-cache behavior

`AI_PROMPT_CACHE=false` is the project default. A stage-specific `AI_<STAGE>_PROMPT_CACHE` can override it.

- **Anthropic:** enabling it adds `cache_control` only to the stable system content block. `ANTHROPIC_PROMPT_CACHE_TTL` accepts `5m` (default) or `1h`.
- **GPT-5.6:** disabled mode sends explicit cache mode with no breakpoint. Enabled mode adds one explicit breakpoint to the stable system content, uses a stable routing key, and requests the supported `30m` TTL.
- **Other OpenAI models:** enabled mode supplies a stable `prompt_cache_key`; the provider still decides which eligible prefix is cached. Disabled mode supplies no application routing key or breakpoint, but automatic provider caching can still be possible.
- **CLI brains:** these REST prompt-cache controls are not sent to Claude or Codex CLI.

`OPENAI_PROMPT_CACHE_KEY` is optional. When prompt caching is enabled and the setting is empty, the client derives a non-secret stable key from the selected model, system prefix, and output contract. Provider-reported cache-read/cache-write fields are the evidence of actual caching; the configuration switch alone is not a hit or a saving.

## Accepted-only exact-result cache

The local cache is exact, not similarity-based. For Playwright generation it is available to Anthropic REST, OpenAI REST, and Codex CLI. Flow-spec fitting is outside this cache lifecycle, and Claude CLI caching is disabled because it has no trustworthy version/model identity.

The semantic key covers provider, cache model identity, system prefix, canonical task identity, output contract, stage, policy and generation/context fingerprints, relevant runtime knobs, and cache epoch. It does **not** include mutable target contents. Target safety is a separate precondition:

- a lowercase SHA-256 means the target is known to exist;
- explicit `null` means the target is proven missing;
- an omitted target state means unknown and disables exact-cache lookup, candidate creation, and exact single-flight joining;
- a stored entry is reusable only when the current target equals the cached input target state or the verified generated output digest. An unrelated current target is a miss.

An accepted entry stores the exact response, normalized usage, input/output target digests, fixed metadata, and an immutable version reference. It stores neither prompts nor API keys. Writes are atomic under `.ai-cache/generations` with owner-only permissions. A stale reference cannot invalidate a newer replacement.

A hit still becomes an isolated candidate and must pass the `verified-promotion-gate/v3` lane in one `--repeat-each=2 --retries=0` Playwright invocation before replacing the target. `npm run ai:test:gate:fast` remains the compatibility name for this two-repeat candidate/promotion lane. Promotion-gate rejection invalidates the exact hit; historical v2 one-repeat evidence is reporting-only and cannot authorize target or cache promotion. A successful run records only its response-free cache reference. The separate subject-matched full gate remains `--repeat-each=3 --retries=0`; a later quality rejection (`fullGatePassed === false`, for static-review or runtime-test failure) invalidates that exact entry, while a pass retains it. This includes Playwright's normal exit-0 all-skipped case: the bounded report proves a test-quality rejection even though the process succeeded. Unreadable/incomplete report envelopes, top-level setup/teardown/configuration errors, abnormal exits, input, global-static, or other runtime-environment outcomes have unknown full-gate quality and do not trigger cache invalidation.

## Codex CLI identity and usage

`AI_CODEX_CLI_MODEL` is optional. A non-empty value is passed to `codex exec --model` and is the public model label. Without it, the framework does not discover the CLI's implicit model; public telemetry uses `codex-cli-default`. With the exact-result cache enabled, the private cache identity combines the explicit model (or a literal default label) with the locally probed `codex --version`. Changing either invalidates reuse. The version probe runs locally in a disposable read-only directory with a restricted, credential-free environment. If a trustworthy version cannot be obtained, caching fails with guidance to repair the CLI or set `AI_RESULT_CACHE=false`.

Codex `exec --json` output is decoded fail-closed: exactly one completed assistant message must match the selected schema. If a `turn.completed.usage` event is present, its input, cached-input, cache-write, output, reasoning, and total fields are normalized. If the event is absent, input/output/total usage remains unknown; it is not inferred from prompt characters or reported as measured zero. Claude CLI token usage and failed CLI attempts likewise remain unknown.

## Bounded redacted context pack

The ordinary flow-generation path renders exactly one `generation-context-pack/v1` with a 3,500-character cap. The cap covers the warning, fingerprint, and serialized JSON actually sent to the provider.

The pack can contain only reviewed and bounded evidence:

- DOM/accessibility candidates bound to the exact spec path and behavioral hash, or an explicit unavailable status;
- fixture import/export names;
- positively relevant Page Object class, constructor, and public method signatures;
- the target path, full-file digest, and AST-derived imports/top-level signatures.

It does not include target function bodies, arbitrary Page Object fallback methods, raw DOM bodies, credentials, URL credentials/query/fragment data, or secret-like strings. Evidence strings are redacted, normalized, capped, and ordered by a locale-independent comparator. Files and directories are read through bounded, non-symlink, containment-checked paths; the target digest covers the full accepted file while provider-visible AST extraction stays bounded.

Immutable DOM/fixture/relevant-Page-Object evidence is budgeted independently from mutable target evidence. The context fingerprint and exact-cache identity keep only the normalized target path from the mutable target; current target state still appears in the real provider context and is enforced separately by the cache precondition above.

## Factual stage and subject telemetry

Verified generation writes one private `.ai-runs/generation/<run-id>/` directory. Its owner-only `events.jsonl` is an append-only `generation-run-event/v1` stream, and its atomically replaced `manifest.json` is a `generation-run/v1` lifecycle summary. Prompt text, source/DOM bodies, credentials, cookies, provider response bodies, and arbitrary failure text are not telemetry fields.

Provider attempts—including failures, refusals, truncations, empty or malformed output—are recorded separately from exact-cache events and deterministic gate stages. Known usage uses disjoint uncached-input, cache-read, cache-write, output, and reasoning-detail buckets. `inputTokens` is the logical sum of the three input buckets, not a second cost bucket.

Rows retain only allowlisted stage values (`spec-fit`, `test-generation`, `recording-generation`, and `repair`) and a normalized lowercase SHA-256 `subjectFingerprint` when the run has one. Unallowlisted and legacy stages aggregate under `unknown`. An event with an explicit invalid/prototype-like stage becomes `unknown`; it does not inherit a trusted-looking manifest stage. Legacy or otherwise unbound identity remains `null`. For verified flow generation, the subject fingerprint binds the behavioral spec hash to the normalized `tests/**/*.spec.ts` target identity.

`generation-usage-report/v2` includes a deterministic `summary.byStage` map. Each stage summary reconciles attempts, known/unknown usage, failures and unknown status, disjoint token buckets, unknown totals, retry accounting, exact-cache hits/misses/joins, saved requests, prompt characters/compaction, provider-cache controls, and available latency percentiles with the overall summary. Per-attempt rows retain the subject fingerprint for subject-level filtering. The overall summary also exposes `promotionGatePolicyDistribution` and `promotionGateRepeatEachDistribution`. Use both distributions to segment historical `verified-fast-gate/v2` / repeat-1 runs from current `verified-promotion-gate/v3` / repeat-2 runs. Historical v2 evidence remains visible for reporting, but the two populations have different acceptance strength and must not be pooled in quality comparisons.

Unknown and corrupt evidence remains visible:

- absent usage produces an unknown-usage attempt rather than a zero-token paid attempt;
- a schema-valid attempt with corrupt or unallowlisted usage/identity fields is sanitized into explicit unknown fields; arbitrary values do not enter rows or counters;
- a terminal manifest that declares more provider attempts than survive validation contributes one bounded weighted unknown row for the missing delta;
- that row has unknown provider/model/status/token/cache data, and unknown status is not counted as a failure;
- malformed manifests/events are counted and make the report command fail;
- nonterminal runs are reported as incomplete with unknown in-flight usage;
- `--require` fails when there are no runs, paid attempts with unknown usage, or incomplete runs.

Numeric totals therefore summarize known buckets only and must be read with `unknownUsageAttempts`, `attemptsWithUnknownTotalTokens`, incomplete-run counts, and invalid-event counts. Character compaction is reported separately and is never presented as token reduction.

Aggregate local runs:

```bash
npm run ai:tokens:report
npm run ai:tokens:report -- --json
```

Budget enforcement should use a measured project baseline rather than a copied example:

```bash
npm run ai:tokens:report -- \
  --require \
  --max-tokens-per-generation <measured-limit> \
  --max-retries 0
```

Track token/cache metrics with first-pass review, candidate-promotion/full-gate rates, repair count, and latency. Before comparing quality or efficiency, inspect `promotionGatePolicyDistribution` and `promotionGateRepeatEachDistribution` and segment results by the exact policy/repeat pair. Compare historical `verified-fast-gate/v2` / repeat 1 separately from current `verified-promotion-gate/v3` / repeat 2; never pool those populations into one acceptance or quality rate. A smaller prompt is not an optimization when accepted quality changes.

## Cost formula

Do not hard-code provider prices in the framework. Apply a selected price sheet only to the disjoint buckets:

```text
cost = uncached_input_tokens × uncached_input_price
     + cache_write_tokens × cache_write_price
     + cache_read_tokens × cache_read_price
     + output_tokens × output_price
```

`reasoningTokens` is normally a diagnostic subset of `outputTokens`; do not add it again. If a provider gives reasoning a distinct rate, split the output bucket first:

```text
non_reasoning_output_tokens = output_tokens - reasoning_tokens

output_cost = non_reasoning_output_tokens × output_price
            + reasoning_tokens × reasoning_price
```

Never charge both `inputTokens` and its three input components, or both `outputTokens` and `reasoningTokens`. Unknown usage remains unknown rather than being converted to zero.

Provider references:

- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
