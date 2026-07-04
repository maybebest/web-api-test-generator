# Test Generator UI

Local browser shell for the repository's existing generators:

- API Playwright tests from HAR captures (`packages/api`).
- Web Playwright tasks/tests from reviewed Markdown specs (`packages/web`).
- Web Playwright tasks/tests from Chrome DevTools Recorder JSON (`packages/web`).
- Local Xray-like test management: test cases, suites, runs, and per-case run results.

Run it from the repository root:

```bash
npm run ui:dev
```

The server binds to `127.0.0.1:4317` by default. Override with `UI_HOST` and `UI_PORT`.

## Local-tool security

The server is loopback-only by design and rejects requests whose `Host` header is not loopback (this blocks DNS-rebinding attacks from a page you visit in a browser). Set `UI_ALLOW_REMOTE=true` only to intentionally expose it on a trusted network.

The file preview endpoint (`/api/file`) is restricted to the generator's own input/output directories (`examples/`, `specs/`, `recordings/`, `tests/`, `.ai-runs/`) and to safe extensions. It cannot read `.env`, `playwright/.auth/*`, or the UI's own `.ui-runs/` settings, so stored API keys are never reachable through it.

A long-running generator or AI action can be stopped with the **Cancel** button (or `POST /api/cancel`); the child process tree is terminated. A per-command timeout also terminates a hung run — override it with `UI_COMMAND_TIMEOUT_MS` (default 15 minutes).

## Environment

- `UI_HOST` / `UI_PORT` — listen address (default `127.0.0.1:4317`).
- `UI_ALLOW_REMOTE=true` — allow non-loopback binding and Host headers.
- `UI_COMMAND_TIMEOUT_MS` — kill a spawned generator/AI run after this many ms.
- `UI_RUNS_DIR` — redirect local state (settings, test management, history) to another directory; used by tests to avoid touching real state.

Uploaded HAR/spec/recording inputs are written to package-local `.ui-uploads/` folders, which are ignored by git because captures can contain secrets or PII.

The Web Spec editor has a `Fit to Template` action. It sends the current editor text to the selected AI brain (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `claude`, or `codex`, using the same resolver as `packages/web`) and replaces the editor text with a template-shaped draft. It does not write a file until `Save Spec` is clicked.

The Settings dialog can store local AI settings and API keys for this UI. Values are written to `packages/ui/.ui-runs/settings.json`, which is ignored by git, and are injected into the environment for UI-launched AI actions such as `Fit to Template`, `Run AI`, and `Brain Check`. Saved keys are never returned to the browser; the UI only receives configured/not-configured status and the last four characters.

Test management data is stored locally in `packages/ui/.ui-runs/test-management.json`, also ignored by git. It is intentionally local-first for now; Jira/Xray sync can be added later as an adapter once project keys, issue types, and credentials are defined.
