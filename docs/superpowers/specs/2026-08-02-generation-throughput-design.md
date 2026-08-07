# Test Generation Throughput and Cost Design

## Purpose

Finish the generation-efficiency work by preventing model calls that cannot pass the local gate, extending the same cost controls to CLI brains, reducing fit-stage formatting output, making accepted-cache reuse safe, and removing repeated verification processes.

## Global constraints

- Preserve every existing generated-test policy and the one-repeat fast gate plus three-repeat full gate.
- Work in the current dirty `sains` checkout because its uncommitted generation stack is the implementation base.
- Do not run paid providers, authenticated tests, or browser tests while implementing.
- Use deterministic Node tests, static review, Playwright listing, and TypeScript compilation for verification.
- Never report character savings as measured token savings.
- Never persist prompts, credentials, auth state, DOM bodies, or provider response bodies in telemetry.

## Pre-provider readiness

Verified generation assembles and validates the canonical input, resolves the target Playwright project with the already-resolved package environment, and performs a side-effect-free readiness check before invoking a model. Readiness checks the selected browser executable, authenticated target configuration, and reusable auth-state or login configuration. A failed readiness check is recorded as a preflight failure with zero provider attempts.

Project planning receives an explicit environment rather than consulting ambient `process.env`. The UI treats verified generation as consuming both provider and browser capacity, so its internal fast gate cannot overlap a UI browser operation that assumes exclusive browser/auth ownership.

## CLI transport parity

Prompt preparation, validation, exact-cache lookup, single-flight joining, and attempt accounting wrap every transport. Codex CLI invocations use JSONL output and a task-specific output schema. The final-message event is decoded into the existing output contract, and token usage is normalized when the CLI emits it; absent usage remains unknown.

CLI cache identity includes the selected explicit CLI model, or the CLI version plus its isolated default-model identity when no explicit model is configured. A CLI version/model change invalidates exact entries. Stage routing remains configurable and no cheaper model becomes a silent default.

## Semantic flow fitting

The fit model returns a semantic flow draft rather than Markdown section bodies. The draft contains typed metadata, stability, variants, business rules, canonical data cases, test data, mocks, steps, negative cases, acceptance criteria, and list-valued narrative sections. The renderer owns headings, Markdown tables, JSON fences, default generated-test requirements, and the human Data Cases projection.

The fit prompt sends a concise schema/version instruction instead of the full Markdown template. Unknown facts remain `NEEDS_REVIEW`. Existing saved Markdown remains unchanged as the public artifact.

## Cache lifecycle and context

Every accepted hit carries a removable cache reference. A failed fast or linked full gate invalidates or quarantines that exact entry. The cache key uses immutable semantic generation input plus repository/DOM context; mutable target state is enforced as a separate precondition:

- reuse is allowed when the current target hash equals the entry's input-target hash; or
- reuse is allowed when the current target hash equals the cached output hash, making an idempotent rerun cheap.

Any other target hash is a miss. The context pack records a full target hash while provider-visible target content remains bounded.

Context selection reserves explicit quotas for fixtures, DOM evidence, target imports/helpers, and page objects. Target context is AST-derived rather than a raw prefix. Page-object entries include constructor and relevant public method signatures; files with no meaningful match do not receive the arbitrary 24-method fallback.

## Verification and telemetry

Review-only means validation plus in-process AST review and does not run Playwright collection or TypeScript compilation. Full batch gates review all pairs, perform global collection/typecheck once, and execute compatible paths in one Playwright process per project/environment/repeat group with per-target JSON verdicts.

Generation and fit run identifiers are returned by the UI. A subsequent three-repeat UI gate passes the generation run identifier so full-gate quality joins the original attempt. Usage rows preserve stage and subject identity, and reports include per-stage summaries while unknown CLI usage remains unknown.

## Acceptance criteria

- A missing selected browser or invalid auth setup fails before any provider/CLI attempt.
- Codex CLI generation can use structured output, exact-cache reads, and single-flight; usage is parsed when present and otherwise remains unknown.
- Fit requests do not include the full Markdown template and the model does not emit duplicate human and JSON Data Cases representations.
- Exact-cache hits can be invalidated and cannot overwrite a target whose full hash is unrelated to the cached input or output.
- Context retains target imports/helpers and constructors within the 3,500-character default budget.
- Review-only performs no Playwright listing or TypeScript compilation.
- Compatible full-gate pairs share a Playwright process without weakening per-target verdicts or repeat counts.
- UI full gates update the originating generation run; reports can aggregate by stage and subject.
