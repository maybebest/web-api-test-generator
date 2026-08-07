# agent-browser DOM Discovery

`agent-browser` is integrated as a pre-generation discovery tool. It gives the AI workflow current UI evidence before a Playwright test is generated, but it does not replace Playwright Test and does not own selector decisions.

## Ownership Model

- Playwright Test remains the deterministic runner.
- The Markdown spec remains the behavior contract.
- `agent-browser` captures current DOM/accessibility evidence.
- The framework selector policy chooses final Playwright locators.
- Generated tests must never contain `agent-browser` refs such as `@e1` or `@e2`.

## Workflow

Start the target first — discovery does not start it. For the deterministic fixture run:

```bash
npm run fixture:start &
npm run ai:browser:doctor
npm run ai:dom:discover -- --spec specs/example-flow.md --url http://127.0.0.1:3000/recorded-example/checkout
npm run ai:dom:discover:review -- --spec specs/example-flow.md
npm run ai:generate-test -- specs/example-flow.md
```

Discovery writes an ignored artifact under `.ai-runs/dom-discovery/<run>/selector-candidates.json`.

## Install And Run Notes

- The `agent-browser` CLI is resolved from `<repo-root>/node_modules/.bin` regardless of cwd. If it is missing, the scripts fall back to `npx agent-browser@<exact version from package.json>` (currently `0.27.0`) — never `npx latest` — and fail with a "run npm ci" message when no exact version is pinned. Keep the `package.json` entry an exact version.
- Every process call has a 45-second timeout and is force-terminated if it wedges. Set `AGENT_BROWSER_TIMEOUT_MS` to a positive value when a slower approved environment needs more time; values are capped at five minutes.
- Discovery verifies candidates in a separate headless Playwright context using the real typed locator and `locator.count()`. The audit defaults to 45 seconds, is capped at two minutes, and can be adjusted with `LOCATOR_AUDIT_TIMEOUT_MS`. Set `E2E_AUTH_STATE_PATH` to an approved storage-state file when the discovery URL requires authentication; the audit reads but never copies that file.
- Note: agent-browser's postinstall downloads a native binary without checksum verification — see `ai/policies/security-policy.md`, Supply Chain, for the accepted risk and mitigations.

## Artifact Contract

The artifact records:

- spec path, spec hash, flow ID, spec version
- target URL and capture time
- source commands
- selector ownership marker
- normalized elements from the accessibility snapshot
- framework-scored `candidateLocators`
- each candidate's live Playwright `matchCount`, `unique` verdict, preferred status, and diagnostic snapshot count
- the uniqueness-audit method and required match count (`1`)

Example candidate:

```json
{
  "elementId": "el-1234567890",
  "role": "button",
  "accessibleName": "Place order",
  "candidateLocators": [
    {
      "type": "role",
      "locator": "page.getByRole(\"button\", { name: \"Place order\" })",
      "score": 95,
      "reason": "Role plus accessible name is the most user-facing stable selector.",
      "preferred": true,
      "snapshotMatchCount": 1,
      "matchCount": 1,
      "unique": true,
      "matchEvidence": "playwright-live"
    }
  ]
}
```

The artifact is evidence only. It can help generation choose between candidates, but it must not override acceptance criteria, data cases, business rules, mocks, or variants from the spec.

The reviewer rejects an artifact when its highest-scored preferred candidate does not return exactly one from live Playwright `locator.count()`. Snapshot-equivalence counts remain diagnostic only; they are not accepted as proof of uniqueness. Non-preferred ambiguous candidates remain visible as warnings, but generation must not select them. Generation-task creation calls the same reviewer, so a non-unique preferred candidate cannot silently pass into a prompt.

## Classified Failures And Fallbacks

Discovery never silently aborts. A failed run writes an ignored `discovery-failure.json` beside the expected artifact with a machine-readable failure kind and prescribed fallback. Raw process output is not persisted. Screenshots remain disabled unless `--screenshot` was explicitly requested.

| Failure kind | Trigger | Required fallback |
|---|---|---|
| `timeout` | Process exceeds the configured timeout | Retry once, then use Playwright CLI accessibility discovery |
| `http-401` | Explicit HTTP 401/unauthorized signal | Stop agent-browser and use approved authenticated Playwright profile/storage-state evidence |
| `http-403` | Explicit HTTP 403/forbidden signal | Stop agent-browser; require configured authenticated Playwright evidence on an allowlisted non-production origin |
| `challenge` | Cloudflare/challenge-page markers | Do not bypass; mark automated discovery blocked, with visual evidence only as non-blocking opt-in evidence |
| `captcha` | CAPTCHA, reCAPTCHA, hCaptcha, or Turnstile marker | Pause for human completion or an approved test-only bypass |
| `empty-snapshot` | Successful command yields no discoverable accessibility elements | Retry after readiness, then use Playwright CLI snapshot evidence |
| `process-failure` | Any other non-zero exit or spawn failure | Run browser doctor, retry once, then use Playwright CLI discovery |

Example failure result:

```json
{
  "status": "fallback-required",
  "failure": {
    "kind": "empty-snapshot",
    "fallback": {
      "strategy": "playwright-cli-snapshot",
      "retryable": true,
      "nextStep": "Retry once after page readiness, then use a Playwright CLI accessibility snapshot; screenshots remain opt-in."
    }
  }
}
```

## Selector Policy

Preferred order:

1. `this.page.getByTestId(testId)` in a Page Object or Component Object when a meaningful `data-testid` exists and is stable
2. `this.page.getByRole(role, { name })`
3. `this.page.getByLabel(label)`
4. `this.page.getByPlaceholder(placeholder)`
5. `this.page.getByText(text)` only for stable visible copy
6. raw CSS only with `// locator-policy:exception <reason>`

Forbidden:

- `agent-browser` refs such as `@e1`
- XPath
- `:nth-child` chains
- raw CSS without a locator-policy exception
- hard waits

## Page Object Expectations

Use existing Page Objects, components, fixtures, and data builders when they make the generated test easier to read or reuse. Keep POM practical:

- constructors receive `page` and initialize locators
- methods describe user intent, such as `submitOrder()` or `waitForValidationMessage(message)`
- scenario-specific assertions stay in the final assertion step of the test
- generated test bodies do not call `page.getBy*` or `page.locator(...)` directly
- avoid deep inheritance, global mutable state, and vague helpers like `doFlow()`

## Safe Commands

```bash
npm run ai:browser:install
npm run ai:browser:doctor
npm run ai:browser:skill -- --check
npm run ai:browser:skill -- --out .ai-runs/agent-browser-core-skill.md
npm run ai:dom:discover -- --spec specs/example-flow.md --url http://127.0.0.1:3000/recorded-example/checkout
npm run ai:dom:discover:review -- --artifact .ai-runs/dom-discovery/<run>/selector-candidates.json
```

Use `--screenshot` only when visual evidence is needed. Screenshots stay under `.ai-runs/` and must not be committed.

## Troubleshooting

- If discovery fails before navigation, run `npm run ai:browser:doctor`.
- Read the classified fallback in `.ai-runs/dom-discovery/<run>/discovery-failure.json`; do not repeatedly retry 401/403, challenge, or CAPTCHA failures.
- If Chrome is missing, run `npm run ai:browser:install`.
- If the live locator audit reports a missing Playwright browser, run `npm run pw:install`.
- If the artifact review says the spec hash is stale, re-run discovery after updating the spec.
- If no selector candidates are produced for an element, improve the application accessibility or add a stable test id rather than inventing brittle CSS.
- If the preferred candidate is non-unique, scope the candidate through a Page Object/component or add a meaningful test id, re-run discovery, and require live `matchEvidence: playwright-live` with `matchCount: 1` before generation.
- If `agent-browser.json` blocks a host, update `allowedDomains` deliberately and document the assumption.

## Security

Do not persist secrets, cookies, storage state, browser profiles, HAR files, videos, or screenshots outside ignored artifact directories. Keep discovery pointed at non-production or local environments unless a human explicitly approves otherwise.
