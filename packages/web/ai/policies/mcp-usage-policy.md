# Playwright MCP Usage Policy

MCP is secondary and should be used for:

- Complex exploratory flows.
- Long multi-page journeys.
- Debugging persistent browser state.
- Accessibility-tree inspection.
- Console/network investigation.

MCP should not be used for:

- CI execution.
- Replacing deterministic Playwright Test specs.
- Silently modifying tests.
- Using real production sessions.

Playwright CLI plus local SKILLS is the primary AI/browser automation aid. Playwright Test remains the deterministic execution truth.

