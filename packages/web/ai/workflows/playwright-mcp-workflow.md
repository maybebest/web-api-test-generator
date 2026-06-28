# Playwright MCP Workflow

Playwright MCP is secondary. Use it when CLI snapshots are not enough for exploratory or debugging work.

## When To Use MCP

- Structured accessibility snapshots.
- Long exploratory sessions.
- Debugging persistent browser state.
- Console and network investigation.
- Complex flows where tool-assisted browser state is helpful.

## Example MCP Config

The MCP server must enforce the same domain boundary as the agent-browser CLI. Pass `--allowed-origins` with the origins derived from `agent-browser.json` `allowedDomains` (host + dev-server port); the browser then refuses to load anything else.

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@playwright/mcp@latest",
        "--allowed-origins",
        "http://localhost:3000;http://127.0.0.1:3000;http://0.0.0.0:3000;https://www.dev.rtd.js-devops.co.uk;https://www.dev.pollen.js-devops.co.uk"
      ]
    }
  }
}
```

This origin list MUST mirror `agent-browser.json` `allowedDomains` (and `PLAYWRIGHT_TEST_BASE_URL`): when one changes, update the other in the same commit. The same list is kept in `.playwright/cli.config.json` under `allowedOrigins`. Never widen it to production hosts.

## Codex-Specific Note

- If the Codex environment supports MCP config, add Playwright MCP there.
- If it does not, use the Playwright CLI workflow instead.

## Safety Configuration

MCP exploration must hold to the same boundaries as the CLI/agent-browser path:

- Drive MCP only against `PLAYWRIGHT_TEST_BASE_URL` or a host on the `agent-browser.json` `allowedDomains` allowlist (localhost plus the documented dev host). Do not point MCP at production.
- Use non-production accounts. Never paste passwords, bearer tokens, OTPs, cookies, or storage-state JSON into MCP prompts or transcripts; load credentials from environment variables.
- Treat MCP snapshots/screenshots as sensitive artifacts: do not commit them, and do not copy transient element refs into generated tests (the framework selector policy owns final locators).
- MCP is a read/explore aid. Any test change it suggests must go through `ai:test:review`/`ai:test:gate` (or the recording gates) before landing.

## Boundaries

- MCP is not required for CI and CI never invokes it.
- MCP does not replace deterministic Playwright Test specs.
- MCP must not use real production sessions.
- MCP should not silently modify tests without a reviewed change.

