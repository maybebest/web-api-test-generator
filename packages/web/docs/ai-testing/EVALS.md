# Golden Evaluations

The golden evaluator is a deterministic, offline regression gate for the spec-to-Playwright-test pipeline. It checks committed reference tests and, optionally, candidate tests produced elsewhere.

It does **not** call an AI provider, generate a test, run Playwright, or make a network request. A green result means the checked files still satisfy the repository reviewer and the pinned structural/semantic contract. It does not prove that a model can produce those files.

## Run It

From `packages/web`:

```bash
node scripts/ai/evals/golden-eval.mjs
node scripts/ai/evals/golden-eval.mjs --json
node --test scripts/ai/__tests__/golden-eval.test.mjs
```

The normal package entry point is:

```bash
npm run ai:eval
```

The evaluator exits nonzero on every validation, review, or comparison failure.

## Reference Mode

With no arguments, the evaluator checks the committed cases in `scripts/ai/evals/golden-cases.json`:

```bash
node scripts/ai/evals/golden-eval.mjs
```

For each case it:

1. Verifies the exact spec and reference file hashes.
2. Builds and verifies the pinned semantic profile and explicit metrics.
3. Runs the existing static generated-test reviewer in the declared `single` or `suite` mode.
4. Treats the committed reference as the comparison target.

This mode proves that the baseline is internally consistent. It does not regenerate the reference.

## Candidate Mode

Use `--candidate-dir` to evaluate files produced by a separate, explicit process:

```bash
node scripts/ai/evals/golden-eval.mjs --candidate-dir /absolute/path/to/candidates
```

Each manifest case declares a `candidate` path relative to that directory. The committed cases currently expect this shape:

```text
/absolute/path/to/candidates/
  single-checkout.spec.ts
  suite-checkout.spec.ts
```

Every candidate must:

- exist as a regular, non-symlink file;
- contain the correct spec version/hash header;
- pass the normal generated-test reviewer in the case's mode; and
- have the same deterministic semantic profile as its committed reference.

The candidate does not need byte-for-byte equality. Formatting and comments may differ when the parsed behavior is unchanged.

## Manifest Version 2

`golden-cases.json` uses `schemaVersion: 2` and fails closed on missing or unknown fields.

The root fields are:

- `schemaVersion`: currently `2`.
- `pipelineInputs`: a sorted, duplicate-free list of generation, review, and model-contract files relative to `packages/web`.
- `pipelineFingerprintSha256`: the expected path-and-content fingerprint of `pipelineInputs`.
- `cases`: a non-empty list containing at least one `single` and one `suite` case.

Each case contains:

- a unique lowercase kebab-case `id`;
- `mode`, which is `single` or `suite`;
- spec, reference, and candidate relative paths;
- exact `specFileSha256` and `referenceFileSha256` values;
- `referenceSemanticSha256`; and
- explicit `expectedMetrics` for test, step, assertion, AC, negative-case, and data-case coverage.

Duplicate IDs, candidate paths, or spec/reference pairs are rejected. Metric ID lists must be sorted and duplicate-free.

## Semantic Profile

The evaluator parses TypeScript and compares explicit, deterministic fields rather than relying on source bytes alone:

- test count and static test titles;
- `test.step` count and static step titles;
- Playwright tags;
- AC, NEG, and DC identifiers found in executable string contracts;
- assertion count and matcher counts;
- semantic locator method/argument contracts;
- interaction call counts;
- navigation and route targets; and
- mocked response status values.

Malformed TypeScript and dynamic test or step titles fail closed because they cannot produce a stable golden profile.

The manifest exposes a small human-readable metric subset. `referenceSemanticSha256` pins the complete profile, and candidate comparison reports the exact top-level profile field that diverged.

## Pipeline Fingerprint

The pipeline fingerprint is an evaluation-baseline update trigger. It covers, at minimum:

- `ai/prompts/02-generate-test.md`
- `ai/prompts/05-review-ai-test.md`
- `scripts/ai/create-generation-task.mjs`
- `scripts/ai/lib/ai-client.mjs`
- `scripts/ai/lib/spec-parser.mjs`
- `scripts/ai/review-generated-test.mjs`
- `scripts/ai/validate-flow-spec.mjs`

The digest is computed over a versioned, ordered stream containing each relative path, its byte length, and its exact bytes. Changing content or renaming a listed file changes the fingerprint. A missing input also fails.

This mechanism does not say whether a pipeline change is good or bad. It prevents prompt, model-contract, generation, or review changes from passing without an explicit look at the golden baseline.

## Update Procedure

Do not blindly replace a stale digest. Treat it as a review request:

1. Inspect the diff in every changed pipeline input, spec, and reference.
2. Run the existing spec validation and generated-test reviewer for each affected case.
3. Run reference mode and read every reported old/actual hash or metric difference.
4. If behavior changed intentionally, update the spec/reference fixture and its test header first.
5. Update the exact file hashes, semantic hash, expected metrics, and pipeline fingerprint in `golden-cases.json` to the reviewed values.
6. Run the focused evaluator tests and reference evaluator again.
7. Commit the pipeline change and baseline update together so reviewers can judge the acceptance explicitly.

Useful checks from `packages/web`:

```bash
node scripts/ai/evals/golden-eval.mjs --json
node --test scripts/ai/__tests__/golden-eval.test.mjs
```

The evaluator reports the actual pipeline digest when it is stale. Hash refresh is intentionally not an automatic write operation: automatically accepting the current tree would defeat the drift gate.

## Path And Symlink Boundary

All manifest paths must be normalized relative paths. Absolute paths, `..` escapes, backslashes, NULs, unsafe normalization, and duplicate paths are rejected.

Resolution boundaries are:

- pipeline inputs: relative to `packages/web`;
- specs and references: relative to the manifest directory; and
- candidates: relative to `--candidate-dir`.

The manifest itself and the candidate directory cannot be symbolic links. Specs, references, candidates, and pipeline inputs must be regular files, and no intermediate path component may be a symlink. These checks prevent a syntactically contained path from resolving outside its trusted base.

## What It Catches

The gate fails on:

- malformed JSON, an unsupported schema, missing/unknown fields, or duplicate cases;
- missing single- or suite-mode coverage in the manifest;
- unsafe paths and symlink indirection;
- missing specs, references, candidates, or pipeline inputs;
- stale spec, reference, semantic, metric, or pipeline pins;
- reference or candidate reviewer failures;
- malformed TypeScript;
- zero/changed tests, steps, assertions, coverage IDs, locators, routes, actions, tags, or mock statuses; and
- candidate/reference semantic divergence even when both files otherwise pass static review.

## Honest R14 Status

This harness is only the deterministic offline half of R14. It never invokes a model, so it cannot measure model quality, sampling variance, prompt-to-output reliability, latency, token usage, or provider regressions.

R14 remains **partial** until the project produces a real, approved baseline using a pinned provider, pinned model/version, pinned generation settings, and multiple samples per golden case. That future run must retain sanitized outputs and aggregate pass/quality distributions without weakening the current reviewer, security boundaries, or offline gate. Provider credentials and paid/network execution must remain explicit opt-in inputs; they must never be embedded in the manifest or fixtures.
