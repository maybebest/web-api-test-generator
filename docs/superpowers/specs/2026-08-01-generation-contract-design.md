# Test Generation Contract Design

## Purpose

Make every prompt-to-Playwright path produce the same validated, context-complete generation request before any provider call. Eliminate the raw-spec shortcut, the Markdown/TypeScript structured-output collision, and REST requests that reference local evidence the provider cannot read.

## Scope

- Web/Playwright generation only. The HAR/API generator remains deterministic and makes no provider calls.
- The UI "Fit to Template" and "Generate" actions, `ai-generate --spec`, REST providers, and CLI providers.
- Existing spec validation, generated-test review rules, locator policy, and security rules remain authoritative.

## Architecture

### Task-specific output contracts

`runBrain` accepts an explicit output contract instead of assuming that every structured response contains Playwright TypeScript. A contract owns:

- a stable identifier and schema version;
- the provider JSON schema;
- the system-prompt suffix;
- response decoding and validation; and
- cache-output validation.

The TypeScript contract returns a complete test file. The flow-spec contract returns a structured draft containing the flow title, metadata rows, and ordered section bodies. The UI renders that draft into Markdown deterministically, then runs the existing flow-spec shape checks. CLI requests receive the same complete system instructions as REST requests.

### One generation-input builder

Both task-file creation and direct `--spec` generation call one exported builder. The builder validates the spec, resolves generation mode, computes the behavioral hash and exact header, resolves reviewed DOM evidence, resolves the output path, and assembles the same dynamic request. The UI may still show a saved task, but it cannot bypass this builder.

### Bounded repository and DOM context

REST context contains data, not unreadable local paths:

- DOM artifact hash, captured URL/time, and only reviewed locator candidates with a unique live match;
- shared fixture import path and exported fixture names;
- bounded page/component class and method signatures relevant to the target/spec;
- existing target-file contents when present, subject to a strict size limit; and
- a context fingerprint used by generation telemetry and cache keys.

The complete artifact and repository are never dumped into the prompt. Missing evidence is represented explicitly; the model is never told it read a file that was not supplied.

## Data flow

1. Raw notes optionally become a structured flow-spec draft.
2. A deterministic renderer produces Markdown and existing validation approves or rejects it.
3. The generation-input builder validates the saved spec and creates canonical dynamic context.
4. The provider produces a candidate TypeScript file under the target directory so relative imports remain correct.
5. Static review and the fast acceptance gate run against the candidate.
6. Only an accepted candidate atomically replaces the target; the previous target remains intact on failure.
7. The full three-repeat gate remains the final acceptance/CI stability check.

## Error handling

- Contract/schema mismatches fail before file writes.
- Missing or stale DOM evidence is explicit and cannot masquerade as supplied selector evidence.
- Candidate failures retain the previous target and persist a sanitized failure record.
- Provider, extraction, review, typecheck, and runtime failures share one run identifier.
- No prompt text, API key, secret, auth state, or full DOM content is persisted in telemetry.

## Testing

- Provider request-shape tests for both output contracts.
- A regression test proving the fit request never mentions TypeScript.
- Tests proving raw `--spec` and saved-task generation create equivalent dynamic input.
- Context-pack tests for unique-locator filtering, bounds, hashes, fixture signatures, and existing-target inclusion.
- Candidate promotion tests proving failures preserve the previous target and success uses an atomic replacement.

## Acceptance criteria

- No UI or CLI path sends an unvalidated raw spec directly to a provider.
- Markdown fitting and TypeScript generation use different schemas and decoders.
- A REST request contains every locator/import fact it requires the provider to use.
- Generated output is not promoted before deterministic acceptance.
- Existing security and generated-test reviewer rules remain unchanged or stricter.
