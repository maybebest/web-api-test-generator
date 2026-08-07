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

The deterministic local suite needs no target URL or credentials:

```bash
npm run test:e2e:local
```

For the opt-in external authenticated suite, copy `.env.example` to `.env`
(gitignored) and set the target + auth explicitly:

```ini
PLAYWRIGHT_TEST_BASE_URL=https://www.dev.pollen.js-devops.co.uk/
E2E_AUTH_ENABLED=true
E2E_AUTH_REUSE_STATE=true
E2E_AUTH_STATE_PATH=playwright/.auth/user.json
```

Restrict the local file before running authenticated tests: `chmod 600 .env`. The authenticated
runner rejects group/world-readable or symlinked environment files.

The authenticated project rejects HTTP, credential-bearing URLs, non-standard ports, and hosts
that are not clearly non-production. A hostname label such as `dev`, `test`, `stage`, `qa`, or
`uat` is accepted automatically. Otherwise add only the exact reviewed non-production hostname to
`E2E_AUTH_ALLOWED_HOSTS` (comma-separated, no wildcards).

Put a captured Playwright `storageState` at `playwright/.auth/user.json`
(gitignored — never commit it). See `docs/ai-testing/AGENT_BROWSER.md` for capture.
Mutating tests that use planning-session helpers also require a disposable,
QA-owned `NECTAR_PLANNING_SESSION_ID`; automatic creation is disabled because no
session-delete contract is available. If the API helper must refresh an expired MSAL
token, also set `NECTAR_AUTH_ALLOWED_ISSUERS` to the exact trusted issuer/tenant `iss`
URL. Bearer requests use HTTPS and only configured/default non-production hosts;
additional explicit hosts must be listed in `NECTAR_API_ALLOWED_HOSTS`.

### Optional external test-data write contracts

`fixtures/test-data-manager.ts` implements every public helper, but it does not invent backend
mutations that are absent from the captured traffic. The captured `planning_getCategories` query
backs `listBrandLinkedSkus`; `ensureBrandLinkedSkus` is read-only when the requested links already
exist. The Playwright fixture supplies the browser-localStorage implementation of `setFeatureFlags`.

To enable catalogue or disposable media-plan writes in a target environment, implement
`TestDataContracts` and pass it to `createTestDataManager`. A writable adapter is accepted only when
cleanup is also available:

- catalogue mutation requires both `linkSkuToBrand` and `unlinkSkuFromBrand`;
- plan creation requires `createMediaPlan` and `deleteMediaPlan`;
- channel seeding additionally requires `assignChannelToPlan`;
- assignment and deletion are restricted to plan IDs created by that manager instance.

Read-only introspection of the authenticated non-production schema verified these candidate plan
operations:

- `planning_savePartialCampaignDetailsAndBudget(planId?: ID, advertiserId?: ID, brandIds?: [ID], briefId?: ID, stepData?: planning_PartialCampaignDetailsAndBudgetInput, qualifyingQuestions?: planning_PartialBriefQualifyingQuestionsInput, isCampaignSkipped?: Boolean) -> planning_PartialPlanDocument`;
- `planning_saveCompleteCampaignDetailsAndBudget`;
- `planning_savePartialChannelsAndMedia` and `planning_saveCompleteChannelsAndMedia`;
- `planning_deletePlan(planId: ID!, briefId: ID!, advertiserId: ID!) -> Boolean`.

When partial campaign `stepData` is supplied, required fields include `campaignName: String!` and
`campaignStartDate: String!`. The returned plan document guarantees `id`, but `briefId` and
`advertiserId` are nullable. That is not yet a reversible create contract: deletion requires all
three IDs, the current helper receives advertiser/brand names rather than verified IDs, and the
schema alone does not prove whether save creates a fresh disposable plan or updates an existing
one. Introspection exposes `onsite`, `offsite`, `athome`, and `instore` lists whose partial channel
items include `id`, `mediaId`, `mediaName`, required `mediaType`, `budget`, `liveDates`, and
`heroSKUs`. The schema still does not establish the environment's enum/domain mapping, budget units,
date format, required optional-looking fields, merge-versus-replace behavior, or rollback behavior.
Delete idempotency and the meaning of a `false` result are also unverified.

No per-SKU brand link or unlink operation exists among the 189 introspected mutations; `BrandInput`
contains no SKU link list. Catalogue writes therefore have no schema candidate at present.

Do not wire or execute these plan mutations until an approved non-production capture proves that
creation always yields every deletion key and that assignment can be reversed. Supplying only a
schema mutation name is intentionally unsupported.

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
