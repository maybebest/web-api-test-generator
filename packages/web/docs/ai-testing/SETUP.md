# Local setup / bootstrap

Reproducible toolchain so anyone can run the gates and tests.

## 1. Node (via nvm)

This repo needs Node >= 20. The Homebrew `node`/`npx` on a shared machine may be
dangling symlinks to another user's home, so install Node per-user with nvm:

```bash
# install nvm (creates ~/.nvm and adds a block to ~/.zshrc)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.5/install.sh | PROFILE="$HOME/.zshrc" bash
# load it in this shell, then install + default Node LTS
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
nvm install --lts && nvm alias default 'lts/*'
node -v && npm -v
```

A new terminal picks up Node automatically via `~/.zshrc`. In a **non-interactive**
shell (CI step, script) it does not — prefix with:

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
```

## 2. Dependencies + browsers

```bash
npm ci
npx playwright install chromium      # node Playwright's pinned browser build
npm run ai:browser:install           # agent-browser, for DOM discovery
```

> Note: Python Playwright (used by the `webapp-testing` skill for recon) installs a
> *different* Chromium build than node Playwright. If a run errors with
> "Executable doesn't exist at .../chrome-headless-shell-<n>", run
> `npx playwright install chromium` to fetch node's matching build.

## 3. Environment

Copy `.env.example` to `.env` (gitignored) and set the target + auth:

```ini
PLAYWRIGHT_TEST_BASE_URL=https://www.dev.pollen.js-devops.co.uk/
E2E_AUTH_ENABLED=true
E2E_AUTH_REUSE_STATE=true
E2E_AUTH_STATE_PATH=playwright/.auth/user.json
```

Put a captured Playwright `storageState` at `playwright/.auth/user.json`
(gitignored — never commit it). See `docs/ai-testing/AGENT_BROWSER.md` for capture.

## 4. Verify the toolchain

```bash
npm run typecheck
npm run ai:test:self          # framework unit tests (should be all green)
npm run ai:spec:validate      # all specs (recursive)
```

## Quick reference (Nectar AI / Pollen work)

| Task | Command |
|---|---|
| Discover real selectors | `npm run ai:dom:discover -- --url https://www.dev.pollen.js-devops.co.uk/planning` |
| Audit unverified locators | `npm run ai:locators:audit` |
| Stamp a test's spec header | `npm run ai:spec:stamp -- <test.spec.ts>` |
| Static-review a generated test | `npm run ai:test:review -- --spec <spec.md> --test <test.spec.ts>` |
| Read-only live smoke | `npm run test:e2e:smoke:live` |
