# Agent Ground Rules

Canonical ground rules for the AI test-generation agent (prompt → browser → Playwright test).
Adopted 2026-07-09. Every new pipeline change must be checked against this document; the
compliance matrix below records where the repo genuinely stands (verdicts are evidence-based —
`file:line` — not aspirational). Update the matrix in the same PR that closes a gap.

Verdict legend: **follows** = mechanism exists AND is enforced by a gate · **partial** = exists
but advisory/incomplete · **missing** = does not exist.

---

## 1. Snapshots & drivers

**R1 — Snapshot after action = accessibility tree with element refs, not screenshots.**
Snapshot-after-action means the AX tree (Playwright-MCP / agent-browser style) with refs.
Screenshots are a vision-only fallback for genuine ambiguity, never the primary capture.

**R2 — Token economy: snapshot diffs + scoped snapshots.**
Diff consecutive snapshots instead of resending the full tree; scope the snapshot to the
relevant container, not the whole page.

**R3 — Drivers hide behind a `BrowserAdapter` interface with a normalized snapshot model.**
The pipeline consumes one normalized element shape regardless of driver.

**R4 — Real anti-block = stealth config + persistent context with logged-in storageState.**
Not driver switching: agent-browser and Playwright are both Chromium/CDP — an anti-bot that
bans one bans the other. For our own staging this is rarely needed at all.

**R5 — Formalized fallback triggers.**
Fallback (vision / authenticated profile / retry) fires on explicit classified signals:
HTTP 403, cf-challenge markers, captcha iframe, empty snapshot, timeout. Never silent aborts.

## 2. Prompt parsing & policy

**R6 — Prompt/task parsing = structured output against a JSON schema.**
Steps array `{action: enum(goto|click|fill|select|expect…), target_description, data, expected}`.
A bounded, validatable DSL — not free-form "which function fits".

**R7 — Deterministic machine policy gate on the plan** before execution/generation. The gate validates the structured plan, target allowlists, mutation scope, evidence, and output contract without an interactive approval step.

## 3. Locators

**R8 — Candidate generation + scoring.**
LLM picks the ref from the snapshot → generate candidate locators → score:
`testid > id > getByRole+name > getByLabel > getByText > CSS`, with penalties for
auto-generated classes (`css-x1y2`), `nth-child`, positional indices.

**R9 — Strict-mode validation: every resolved locator must match exactly one element**
(`count() === 1`) before it is accepted.

**R10 — Resolved locators live in a locator repository (POM)** for dedup and reuse; feeds the
Navigation Graph (pages as nodes, transitions as edges).

## 4. Codegen & verification

**R11 — Act-first codegen.** The agent executes the steps first and writes a trace
(action + validated locator + value); code is generated from the trace via templates; the LLM
only polishes names and asserts. This guarantees compilable code by construction.

**R12 — Verification gate before saving:** `tsc` + `eslint` + run the test 2–3 times
(flakiness check).

**R13 — Asserts from snapshot diffs; web-first assertions only.** What changed after an action
is an `expect` candidate. No value-based or timing-based assertions.

## 5. Quality, guardrails, architecture

**R14 — Eval harness.** Golden set of prompts + reference tests, re-run on every prompt or
model change — otherwise generation quality drifts silently.

**R15 — Guardrails.** Domain allowlist, max-steps cap, confirmation for destructive actions,
token/cost logging per generated test.

**R16 — Playwright Agents (planner/generator/healer, shipped since v1.56).** Microsoft ships
exactly this loop; the repo must hold an explicit, documented compete-or-wrap decision.

**R17 — Core engine + two facades.** (a) an MCP server (tools: `plan`, `act_step`,
`generate_test`) usable from both Codex CLI and Claude Code; (b) a standalone CLI with an
`LLMProvider` adapter. MVP = CLI facade + one driver.

---

## Compliance matrix (audited 2026-07-11)

| # | Verdict | What exists (evidence) | Gap → fix |
|---|---|---|---|
| R1 | partial | AX-first capture is enforced in `dom-discover.mjs`; the bounded MCP `act_step` path executes one action and returns a fresh interactive accessibility snapshot/ref set after every successful step (`lib/mcp-tools.mjs`). Screenshots remain opt-in. | The legacy prompt-first generation path does not yet require the MCP interaction trace, so after-each-action evidence is enforced only in the MCP facade. |
| R2 | partial | `-i` interactive-only filter + element dedupe (`dom-discover.mjs:103,240-258`) | No diffing, whole-page only → diff helper in `lib/agent-browser-runner.mjs` + container-scope argument |
| R3 | partial | Normalized element model (`dom-discover.mjs:169-216` → `selector-policy.mjs`) | One hardwired driver; reviewer rejects other sources (`review-dom-discovery.mjs:29-31`) → extract `BrowserAdapter`, register sources |
| R4 | partial | `lib/discovery-auth.mjs:8-40` validates `E2E_AUTH_STATE_PATH` as a regular file and orders agent-browser's global `--state` before `open`; `dom-discover.mjs:108-139` reuses that same approved path for the Playwright uniqueness audit. Authenticated test projects and MSAL refresh remain enforced by `playwright.config.ts:126-139`, `auth.fixture.ts:97-110`, and `fixtures/nectar-api.ts:50-156`. | No stealth or persistent-profile discovery mode. Keep the default for the repository's own staging environment; add an approved persistent profile only if a classified anti-block failure demonstrates the need. |
| R5 | **follows** | Process timeout + SIGKILL are enforced in `lib/agent-browser-runner.mjs`; failures are classified as timeout, 401, 403, challenge, CAPTCHA, empty snapshot, or process failure with a documented fallback. `dom-discover.mjs` persists the machine-readable fallback result without raw output or default screenshots. | Keep marker detection and fallback documentation covered by `agent-browser-hardening.test.mjs` when agent-browser output formats change. |
| R6 | partial | Hand-rolled validated DSL: required sections + metadata enums (`spec-parser.mjs:5-37`), Data Cases/Mocks as JSON validated field-by-field (`validate-flow-spec.mjs:388-519`), gate-all fails on violations | Flow-Step `Action` is free prose (no enum), no ajv/zod, `ai-generate.mjs:164-176` feeds raw markdown to the LLM → add action enum or `Flow Steps as JSON` + pass parsed steps as the machine contract |
| R7 | **follows** | Imports emit unresolved `NEEDS_REVIEW` markers; normal validation rejects markers, invalid schemas, duplicate metadata, unmapped ACs, and stale behavioral hashes. Generation manifests record a deterministic machine-policy verdict. | Keep the validator and drift inputs versioned and covered by golden evaluations. |
| R8 | partial | Real scoring exists and is unit-tested: `lib/selector-policy.mjs:3-7` (TEST_ID 100 > ROLE 90 > LABEL 80 > PLACEHOLDER 70 > TEXT 60), auto-generated-id rejection (`:117-136`), xpath/nth bans enforced at review (`review-generated-test.mjs:1114-1168`) | Advisory at generation (discovery artifact optional; emitted locators never cross-checked against scored candidates); no `id` tier → make artifact a hard precondition + cross-check + add id tier |
| R9 | **follows** | Discovery records diagnostic snapshot counts, then rebuilds every typed candidate in a bounded headless Playwright context and records the real `locator.count()` result (`playwright-locator-audit.mjs` + `dom-discover.mjs`). `review-dom-discovery.mjs` requires `matchEvidence: playwright-live` and fails when the preferred candidate does not have `matchCount === 1`; generation-task creation already invokes that reviewer. | Re-run discovery after material DOM changes so live uniqueness evidence remains current; runtime Playwright strict mode remains defense-in-depth. |
| R10 | partial | POM ownership hard-enforced (`checkPomLocatorOwnership`, `review-generated-test.mjs:1170-1228`); `PlanningPage.ts` is the de-facto repository with CONFIRMED/VERIFIED/INFERRED audit annotations | Dedup warning-only (`checkReuseGuidance:1894`), `ai:locators:audit` not wired into gate-all; no Navigation Graph (NectarFlow is linear chains) → gate the audit; add a navigation-graph module |
| R11 | partial | Trace/template codegen exists on side paths: recording path (human DevTools trace as contract, `RECORDING_GENERATION_FLOW.md:48`), `gen-sku-suites.mjs` deterministic emitter, `packages/api` HAR→template. Playwright's act-first generator agent ships unused in `node_modules/playwright/lib/agents/` | Flagship spec→test path is prompt-first (`ai-generate.mjs:164-176` LLM writes the whole file; execution only at the gate) → act-first step log → template emit → LLM polish-only |
| R12 | **follows** | Web verification runs `tsc`, ESLint 9 with TypeScript and Playwright rules, static review/list gates, and executed gates with `--retries=0 --repeat-each=3`. Playwright config also disables retries globally, and CI runs the lint stage. | Keep lint and repeated execution mandatory as generated-test rules evolve. |
| R13 | partial | Web-first half mechanically enforced: expect only on PO locators (`review-generated-test.mjs:715-717`), weak-matcher/tautology bans (`:697-799`), no waitForTimeout/networkidle (`:931-944`) | No diff-derived assert candidates (single pre-generation snapshot, zero actions) → per-action snapshots + diff → ranked expect candidates into the generation task |
| R14 | partial | `scripts/ai/evals/` contains reviewed single/suite golden specs and reference tests. `ai:eval` fails closed on reviewer/semantic drift and pins the prompt, model-contract, parser, validator, and reviewer inputs with a path-and-content fingerprint; CI runs it for every web change. | The evaluator is deliberately offline and never invokes a model. Complete R14 only after an approved pinned-provider, multi-sample baseline records sanitized outputs and quality distributions. |
| R15 | partial | Domain allowlists and drift tests remain enforced. The MCP facade adds a hard 25-step/session cap, fresh-ref actions, sensitive-value rejection, bounded output, and a deny-by-default destructive-action policy with an exact machine allowlist. | Non-MCP paths still need the shared destructive-action policy, CLI providers report no token/cost usage, and there is no maintained USD pricing table. |
| R16 | **follows** | `ARCHITECTURE.md:79-105` records the accepted compete-at-generation-boundary decision: the spec-gated pipeline remains authoritative, upstream agents are optional aids, and wrapping is allowed only through stable repository contracts. The ADR includes security/evidence requirements and measurable revisit criteria. | Revisit only when Playwright exposes a stable agent API and golden evaluations demonstrate an improvement without weakening repository gates. |
| R17 | partial | `mcp-server.mjs` is a bounded stdio MCP facade exposing exactly `plan`, real allowlisted/ref-bound `act_step`, and `generate_test`; the CLI/provider facade and local UI also remain. Protocol, privacy, lifecycle, failure-injection, and real local-browser checks cover it. | `generate_test` honestly emits the reviewed generation task/manifest, not Playwright code, and MCP actions are not persisted into a shared act-first trace/core service. Extract that shared service before calling the full rule complete. |

## Priority backlog (highest leverage first)

1. **R8** — make the scored discovery artifact a hard generation precondition and cross-check
   emitted Page Object locators against it.
2. **R6 + R11** — bounded step DSL (`Flow Steps as JSON` + action enum) and the act-first trace
   path; together they convert the flagship pipeline from prompt-first to trace-first.
3. **R14** — run and approve a real pinned-provider, multi-sample baseline without weakening the offline gate.
4. **R10 + R13** — persist the bounded action trace, navigation graph, and diff-derived assertion candidates.
5. **R17** — extract the shared generation service and make task-to-code generation an explicit, separately approved capability.

## Maintenance

- Close a gap → update the verdict + evidence in the matrix in the same PR.
- New pipeline capability → check it against R1–R17 before merging; extend the rules if a new
  principle emerges (append, don't rewrite history — note the adoption date).
- Full re-audit cadence: on major pipeline changes or quarterly, whichever comes first.
