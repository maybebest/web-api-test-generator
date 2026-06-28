# Playwright CLI Workflow

## Install CLI And Skills

Recommended local developer setup:

```bash
npm install -g @playwright/cli@latest
playwright-cli install --skills
playwright-cli --help
```

If global installation is unavailable (the package is `@playwright/cli`; the old unscoped `playwright-cli` npm package is deprecated and must not be used):

```bash
npx @playwright/cli --help
```

## Explore A Flow

```bash
export PLAYWRIGHT_CLI_SESSION=qa-ai
PLAYWRIGHT_CLI_SESSION=qa-ai playwright-cli open "$PLAYWRIGHT_TEST_BASE_URL" --headed
playwright-cli snapshot --filename=home.yml
playwright-cli click e15
playwright-cli fill e20 "test@example.com"
playwright-cli screenshot --filename=evidence.png
playwright-cli console error
playwright-cli network
playwright-cli show
```

## Practices

- Start a named session per flow.
- Capture a snapshot before interacting.
- Interact by snapshot refs, not guessed selectors.
- Re-snapshot after navigation and DOM-changing actions.
- Capture screenshots for evidence.
- Check console and network when the UI behaves unexpectedly.
- Save storage state only for non-production test accounts and keep it ignored.
- Use the dashboard with `playwright-cli show` when reviewing session evidence.

## Convert Findings Into Tests

1. Save the explored behavior in `specs/<flow-name>.md`.
2. Review expected user-visible outcomes.
3. Generate deterministic Playwright Test code under `tests/smoke` or `tests/regression`.
4. Run the test locally.
5. Fix only verified failures.

