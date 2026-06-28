# agent-browser DOM Discovery

`agent-browser` is integrated as a pre-generation discovery tool. It gives the AI workflow current UI evidence before a Playwright test is generated, but it does not replace Playwright Test and does not own selector decisions.

## Ownership Model

- Playwright Test remains the deterministic runner.
- The Markdown spec remains the behavior contract.
- `agent-browser` captures current DOM/accessibility evidence.
- The framework selector policy chooses final Playwright locators.
- Generated tests must never contain `agent-browser` refs such as `@e1` or `@e2`.

## Workflow

Start the app under test first — discovery does not start it for you. For the bundled demo app run `npm run demo:start` (serves `http://localhost:3000`):

```bash
npm run demo:start &
npm run ai:browser:doctor
npm run ai:dom:discover -- --spec specs/example-flow.md --url http://localhost:3000/ai-example/checkout
npm run ai:dom:discover:review -- --spec specs/example-flow.md
npm run ai:generate-test -- specs/example-flow.md
```

Discovery writes an ignored artifact under `.ai-runs/dom-discovery/<run>/selector-candidates.json`.

## Install And Run Notes

- The `agent-browser` CLI is resolved from `<repo-root>/node_modules/.bin` regardless of cwd. If it is missing, the scripts fall back to `npx agent-browser@<exact version from package.json>` (currently `0.27.0`) — never `npx latest` — and fail with a "run npm ci" message when no exact version is pinned. Keep the `package.json` entry an exact version.
- Note: agent-browser's postinstall downloads a native binary without checksum verification — see `ai/policies/security-policy.md`, Supply Chain, for the accepted risk and mitigations.

## Artifact Contract

The artifact records:

- spec path, spec hash, flow ID, spec version
- target URL and capture time
- source commands
- selector ownership marker
- normalized elements from the accessibility snapshot
- framework-scored `candidateLocators`

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
      "reason": "Role plus accessible name is the most user-facing stable selector."
    }
  ]
}
```

The artifact is evidence only. It can help generation choose between candidates, but it must not override acceptance criteria, data cases, business rules, mocks, or variants from the spec.

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
npm run ai:dom:discover -- --spec specs/example-flow.md --url http://localhost:3000/ai-example/checkout
npm run ai:dom:discover:review -- --artifact .ai-runs/dom-discovery/<run>/selector-candidates.json
```

Use `--screenshot` only when visual evidence is needed. Screenshots stay under `.ai-runs/` and must not be committed.

## Troubleshooting

- If discovery fails before navigation, run `npm run ai:browser:doctor`.
- If Chrome is missing, run `npm run ai:browser:install`.
- If the artifact review says the spec hash is stale, re-run discovery after updating the spec.
- If no selector candidates are produced for an element, improve the application accessibility or add a stable test id rather than inventing brittle CSS.
- If `agent-browser.json` blocks a host, update `allowedDomains` deliberately and document the assumption.

## Security

Do not persist secrets, cookies, storage state, browser profiles, HAR files, videos, or screenshots outside ignored artifact directories. Keep discovery pointed at non-production or local environments unless a human explicitly approves otherwise.
