# AQA improvements — status

Historical improvement log, updated where the current repository now has stronger
evidence. Status: ✅ done & verified · 🟡 partial / pattern provided · 🔲 needs external
input (creds / app API / dev-team). Current commands and architecture live in
`START_HERE.md`, `SETUP.md`, and `AGENT_GROUND_RULES.md`.

## 1. Locator confidence & DOM discovery
| Item | Status | Notes |
|---|---|---|
| Wire `ai:dom:discover` for Pollen | ✅ | `www.dev.pollen.js-devops.co.uk` added to `agent-browser.json`, `.playwright/cli.config.json`, and `ai/workflows/playwright-mcp-workflow.md` (the 3 mirrored files; the drift self-test enforces sync). Dead psychicbook host removed. |
| Track locator provenance | ✅ | `npm run ai:locators:audit` (`scripts/ai/audit-locators.mjs`) reports `INFERRED`/`@unverified-locator` markers + positional picks. `--strict` fails CI while any remain. POM locators are tagged `CONFIRMED`/`INFERRED`. |
| Author against a captured snapshot, never imagination | 🟡 | Documented in `SETUP.md` + `pollen-nectar-ai-selectors` notes; make it a required pre-gen step in the prompt. |

## 2. Close the static-green ≠ works gap
| Item | Status | Notes |
|---|---|---|
| Fast read-only smoke lane | ✅ | `npm run test:e2e:smoke:live` (AC-001/AC-002, navigate+assert, no mutation). Verified live against Pollen. |
| `verified` lifecycle status | ✅ | `verified` added to `GENERATION_STATUS_VALUES`; distinct from `generated`. |
| Data-safe execution + teardown for mutating tests | 🟡 | `fixtures/test-data-manager.ts` captures original values, serializes shared writes, and restores only changes still owned by the test. Entity/session/plan deletion APIs remain unavailable, so external runs require pinned disposable data and cannot claim full cleanup. |

## 3. LLM-driven UI assertion strategy
| Item | Status | Notes |
|---|---|---|
| Assert on structured testids, not chat prose | 🟡 | `PlanningPage` healed to `data-testid`s (`summary-panel`, `plan-*`, `chatbot-*`). Existing tests can adopt `summaryChannel`/summary testids further. |
| Deterministic AI-readiness wait | ✅ | `PlanningPage.waitForAssistantIdle()` waits on `nectar-lottie-icon-idle` (real testid) instead of a fixed timeout. |
| Pin deterministic validation strings | 🔲 | Needs dev-team agreement on stable error copy (or a stable error testid). |
| Contract/API tests for the rules | 🔲 | Needs the planner API; keep E2E for the journey, push rule logic down the pyramid. |

## 4. Test data & auth
| Item | Status | Notes |
|---|---|---|
| Env-overridable data registry | ✅ | `data/media-planner.ts` maps logical names → real values (defaults from live recon, e.g. `N360 \| Unilever \| MS`), overridable via `E2E_MP_*`. Includes `offsetDate`/`channelRequest` helpers. |
| Precondition guard | 🟡 | Registry exposes the values; a fail-fast guard fixture is the next step (see §2 scaffold). |
| Programmatic auth instead of pasted session | 🔲 | `tests/setup/auth.setup.ts` already does env-driven login; needs non-prod B2C creds + the login DOM selectors to replace the hand-captured `storageState`. |

## 5. Suite-mode generation ergonomics
| Item | Status | Notes |
|---|---|---|
| Canonical suite-mode example + rules | ✅ | `docs/ai-testing/SUITE_MODE_RULES.md`; the booking-deadline test is the worked example. |
| Feed suite-mode rules into the generation prompt | ✅ | `ai/prompts/02-generate-test.md` points to `SUITE_MODE_RULES.md`. |
| Sharper reviewer errors (e.g. templated step titles) | 🟡 | Deferred — changing `review-generated-test.mjs` messaging risks the now-green self-tests; do it behind a focused test. |

## 6. Framework / tooling gaps
| Item | Status | Notes |
|---|---|---|
| Discover specs in subdirectories | ✅ | `listSpecFiles` is recursive; the current catalog contains 14 specs across nested directories. Duplicate Flow IDs fail validation. |
| `ai:spec:stamp` command | ✅ | `npm run ai:spec:stamp -- <test>` rewrites the header hash from the spec (no hand-computing). |
| Spec base-URL drift | 🟡 | `.env`/runtime target Pollen (env always wins); some specs still *document* `dev.rtd` in Preconditions — harmless prose, worth normalising to "see `PLAYWRIGHT_TEST_BASE_URL`". |
| Environment reproducibility | ✅ | `docs/ai-testing/SETUP.md` (nvm + node/python Playwright browser caveat + env). |
| Green self-test suite | ✅ | `ai:test:self` is 319/319 as of 2026-07-11. |

## 7. Suite test speed
| Item | Status | Notes |
|---|---|---|
| Share setup across focused tests | 🔲 | Each AC test re-runs the full UI journey. Needs API-level plan setup or a shared serial-describe context — both depend on the planner API. |

## Top 3 to pick up next
1. Data-safe execution path + teardown → unlocks running the mutating tests in CI (§2/§4).
2. Programmatic B2C auth → repeatable runs without a 3-hour hand-captured session (§4).
3. Push rule validation to contract/API tests; keep E2E for journeys (§3/§7).
