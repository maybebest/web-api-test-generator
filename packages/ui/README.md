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

A long-running generator, AI action, or browser upload can be stopped with the **Cancel** button. Server clients identify the exact command with `X-UI-Command-Id`, so cancellation cannot terminate an unrelated concurrent run. A per-command timeout also terminates a hung run — override it with `UI_COMMAND_TIMEOUT_MS` (default 15 minutes).

## Environment

- `UI_HOST` / `UI_PORT` — listen address (default `127.0.0.1:4317`; the port must be a whole number from `0` to `65535`).
- `UI_ALLOW_REMOTE=true` — allow non-loopback binding and Host headers.
- `UI_COMMAND_TIMEOUT_MS` — kill a spawned generator/AI run after this many ms (a positive whole number no larger than Node's `2147483647` ms timer limit).
- `UI_PROVIDER_CONCURRENCY` — independent paid-provider actions allowed at once (default `1`).
- `UI_BROWSER_CONCURRENCY` — independent browser gates allowed at once (default `1`).
- `UI_READONLY_CONCURRENCY` — independent validation/review actions allowed at once (default `4`).
- `UI_WRITE_CONCURRENCY` — independent non-provider writers allowed at once (default `2`).
- `UI_RUNS_DIR` — redirect local state (settings, test management, history) to another directory; used by tests to avoid touching real state.

Commands that can write or gate the same target remain mutually exclusive even when a class limit is higher. Read-only review is scoped separately, so it is not blocked by an unrelated generation.

Uploaded HAR/spec/recording inputs are written with private permissions to package-local `.ui-uploads/` folders, which are ignored by git because captures can contain secrets or PII. Uploaded specs remain available in the selector after a reload.

The Web Spec editor has a `Fit to Template` action. It sends the current editor text to the selected AI brain (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `claude`, or `codex`, using the same resolver as `packages/web`) and replaces the editor text with a template-shaped draft. It does not write a file until `Save Spec` is clicked. To prevent unexpectedly large paid requests, combined fit input is capped at 160,000 characters by default; set `AI_SPEC_FIT_MAX_PROMPT_CHARS` to a positive integer to choose a different limit (it takes precedence over the shared `AI_MAX_PROMPT_CHARS`).

The Settings dialog can store local AI settings and API keys for this UI. Values are written with owner-only permissions to `packages/ui/.ui-runs/settings.json`, which is ignored by git, and are injected into the environment for UI-launched AI actions such as `Fit to Template`, `Run AI`, and `Brain Check`. Saved keys are never returned to the browser; the UI only receives configured/not-configured status and the last four characters.

Child-process stdout and stderr are each capped to the most recent 1 MiB. The UI marks truncated output explicitly, preventing a noisy tool from growing the server process without bound while retaining the final diagnostic lines.

Test management data is stored locally in `packages/ui/.ui-runs/test-management.json`, also ignored by git. Importing a repository flow spec records it as read-only provenance; saving the case creates a distinct managed spec under `packages/web/specs/test-management/` and never overwrites the source file. It is intentionally local-first for now; Jira/Xray sync can be added later as an adapter once project keys, issue types, and credentials are defined.
