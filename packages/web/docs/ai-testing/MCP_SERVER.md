# Bounded MCP Server

The web package exposes a small Model Context Protocol (MCP) facade for machine-validated flow specs and controlled browser discovery. It uses newline-delimited JSON-RPC 2.0 over standard input/output and exposes exactly three tools: `plan`, `act_step`, and `generate_test`.

The facade does not call a model and does not generate Playwright code.

## Launch

From `packages/web`:

```bash
npm run ai:mcp
```

The process reads one JSON-RPC message per input line and writes protocol JSON only to stdout. Keep stdout connected to the MCP host; bounded diagnostics go to stderr.

## Tool Contract

### `plan`

Input: `specPath`, a relative Markdown path under `specs/`.

`plan` resolves the existing spec, runs the deterministic validator, checks that its target is a `.spec.ts` file under `tests/`, and creates an in-memory session. It returns a random `sessionId`, a machine policy verdict, the bounded plan, and execution limits. It neither opens a browser nor writes a file.

### `act_step`

Every call requires the `sessionId` returned by `plan`. One call performs one allowed action and then returns a fresh, redacted interactive snapshot.

Allowed actions are:

- `goto`: open a credential-free absolute HTTP(S) URL.
- `click`, `fill`, `select`, `check`, `uncheck`: act on a ref from the latest returned snapshot.
- `press`: press one of `Enter`, `Escape`, `Tab`, `ArrowUp`, `ArrowDown`, or `Space`.
- `expect`: check `visible`, `enabled`, or `checked` on a current ref.

Refs such as `@e1` are ephemeral. Locator actions accept only refs returned by the immediately preceding snapshot; arbitrary CSS, XPath, text selectors, and stale refs are rejected. Up to 100 refs and 8,000 snapshot characters are returned per step.

Each session permits at most 25 successful actions, expires after 30 minutes of inactivity, and exists only in server memory. The server keeps at most 32 sessions. It closes a touched browser session when the MCP session expires, is pruned, or the stdio server exits.

`goto` is checked against `agent-browser.json` `allowedDomains`. Userinfo in URLs and secret-like values in paths, queries, or fragments are rejected. The underlying `agent-browser` configuration remains the enforcement layer during navigation, including subsequent browser activity.

If `E2E_AUTH_STATE_PATH` is set, it must resolve to a configured regular storage-state file. The path is validated when the facade starts and supplied to browser open operations; its contents are not copied into MCP results. The facade does not create credentials, sign in a user, or bypass CAPTCHA and anti-bot challenges.

Potentially destructive actions are denied by default. To permit a known non-production action, set `MCP_DESTRUCTIVE_ACTION_ALLOWLIST` to comma-separated exact `action:accessible-name` entries, for example `click:delete disposable plan`. Wildcards and interactive confirmation tokens are not supported. Domain, ref, secret, and action bounds still apply.

### `generate_test`

Despite its compatibility name, `generate_test` never generates test code.

- With `write` omitted or `false`, it returns a redacted preview of the existing generation-task format.
- With `write: true`, it atomically publishes the human-readable `generation-task.md`, canonical `provider-input.md`, and their bound `manifest.json` under a server-chosen `.ai-runs/mcp/<run>/` directory.
- Callers cannot choose an output path.

On newly created paths, `.ai-runs`, `.ai-runs/mcp`, and the run directory use mode `0700`; both files use mode `0600`. The two files are written in a private staging directory and renamed into place together. Existing parent-directory modes are not changed.

## Redaction Boundary

Returned snapshot text, returned ref names, task previews, and bounded error data redact:

- exact values previously submitted through `fill` or `select` in that session;
- common bearer/API-token and labeled password, token, session, and OTP forms;
- common email-address, payment-card-number, and phone-number forms.

Redaction is defensive pattern matching, not a data-loss-prevention guarantee. The submitted value still goes to the selected browser control. The source spec and written generation-task artifacts are not rewritten as sanitized documents and may contain contract metadata. Do not put secrets or unnecessary personal data in specs, URLs, element names, or task metadata. The facade does not persist an action trace, but the MCP host may log requests or responses according to its own policy.

## Host Configuration Examples

Use an absolute repository path in long-lived host configuration. These examples intentionally contain no credentials.

Codex configuration (`config.toml`):

```toml
[mcp_servers.web_test_generator]
command = "npm"
args = ["--prefix", "/absolute/path/to/repo/packages/web", "run", "ai:mcp"]
```

Claude-compatible JSON configuration:

```json
{
  "mcpServers": {
    "web-test-generator": {
      "command": "npm",
      "args": [
        "--prefix",
        "/absolute/path/to/repo/packages/web",
        "run",
        "ai:mcp"
      ]
    }
  }
}
```

If a desktop host cannot find `npm`, replace `command` with its absolute path. Configure authentication outside the checked-in host example and protect any storage-state file with least-privilege filesystem permissions.

## Local Fixture Smoke

Start the deterministic fixture in one terminal:

```bash
cd packages/web
npm run fixture:start
```

Connect an MCP host using one of the configurations above, then run this safe sequence:

1. Call `plan` with `specs/media-plan-save-via-nectar-ai.md`.
2. Call `act_step` with the returned `sessionId`, `action: "goto"`, and `url: "http://127.0.0.1:3000/"`.
3. Choose a ref from that response and call `act_step` with `action: "expect"` and `expectation: "visible"`.
4. Stop the fixture when finished.

The repository smoke check for this sequence produced an eight-step validated plan, returned local-fixture refs, and reported `expectationMet: true`.

## Known Limitations

- There is no model invocation, prompt execution, Playwright-code generation, test execution, or test-file write.
- Sessions, fresh-ref state, and submitted-value redaction state are in memory and disappear on restart.
- The facade does not persist an action trace or screenshots; retain evidence separately if an audit requires it.
- The MCP host must protect stdio, session IDs, previews, and any host-side logs. The server provides no transport encryption or client authentication of its own.
- A live target application must already be running and reachable. External authentication or other live-SUT prerequisites must be supplied by the operator.
- Destructive-action detection is a bounded heuristic, not a complete policy engine. Keep the exact machine allowlist empty unless the target is isolated, non-production, disposable, and covered by deterministic cleanup.
