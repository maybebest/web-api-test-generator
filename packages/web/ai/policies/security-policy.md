# Security Policy

- Never commit secrets.
- Never commit storageState JSON.
- Never use production accounts.
- Mask PII in screenshots and videos where possible.
- Do not log passwords, cookies, bearer tokens, or session IDs.
- Treat traces as sensitive artifacts.

Store credentials in local environment variables or CI secrets. Keep `.env`, auth state, reports, traces, screenshots, and videos out of source control unless the team has explicitly sanitized and approved them.

## Auth State

- Auth state must only be generated after login success is asserted.
- Auth projects must be separate from unauthenticated projects.
- Do not upload auth state as CI artifacts.
- Do not log passwords, cookies, bearer tokens, session IDs, or storage state.

## Supply Chain

Known accepted risk: the `agent-browser` devDependency runs a `postinstall` script
that downloads a prebuilt native binary from GitHub releases **without checksum
verification**. A compromised release asset or a redirected download would execute
on developer machines and CI runners.

Why this is accepted for now:

- The version is pinned exactly (`agent-browser@0.27.0`, no `^`/`~` range), so a
  routine `npm install` cannot silently pull a newer release artifact.
- The tool is a devDependency used only for local DOM discovery and optional CI
  diagnostics (`ai:browser:*` scripts); it is not part of the shipped test code.

Mitigation options if the risk posture changes:

- `npm ci --ignore-scripts` blocks the download, but it breaks `agent-browser`
  (the binary is never fetched) and may break other lifecycle scripts — only use
  it in jobs that do not run `ai:browser:install` / `ai:browser:doctor`.
- Vendor the binary internally and verify its checksum before install.
- Drop the dependency where DOM discovery is not needed.

Review this note whenever `agent-browser` is upgraded: confirm the new version
still pins exactly and check whether upstream has added checksum or signature
verification to the postinstall download.
