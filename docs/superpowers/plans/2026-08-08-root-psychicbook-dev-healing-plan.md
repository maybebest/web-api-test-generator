# Root PsychicBook Dev Healing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create an isolated root PsychicBook `tests-dev` suite, run it on PsychicBook dev, and repair every proven test-owned locator or synchronization failure through the existing healer.

**Architecture:** Delete the incorrect package-level Pollen/Nectar mirror and copy the tracked root `tests` tree to root `tests-dev`. Root configuration selects an exact suite root and exact environment; the healer is launched from the repository root, receives only allowlisted PsychicBook runtime variables, treats root API/UI specs as handwritten contracts, and keeps its existing single-file safety gates.

**Tech Stack:** Node.js 22, TypeScript, Playwright Test, Node test runner, ESLint 9, existing `packages/web/scripts/ai/healer` implementation.

## Global Constraints

- Canonical source is `/Users/maybebest/Documents/web-api-test-generator/tests`.
- Development copies live only in `/Users/maybebest/Documents/web-api-test-generator/tests-dev`.
- Delete the erroneous `/Users/maybebest/Documents/web-api-test-generator/packages/web/tests-dev` mirror; do not change `packages/web/tests`.
- Stage remains the default environment; `TEST_ENV=dev` selects exact PsychicBook dev endpoints.
- Ordinary Playwright defaults to `tests`; only exact `PLAYWRIGHT_TEST_SUITE_ROOT=tests-dev` selects the copy.
- Every copied-test repair is produced and applied by the healer; do not hand-edit business assertions, payloads, data, or expected outcomes.
- Healer infrastructure changes require a failing regression test first.
- Runtime commands use one worker and zero retries; healer candidate verification uses two consecutive runs unless evidence justifies three.
- Never print, copy, commit, or archive credentials or browser auth material.
- Preserve the canonical root `tests` tree byte-for-byte throughout healing.

---

### Task 1: Replace the Incorrect Dev Mirror and Add Exact Root Selection

**Files:**
- Delete: `packages/web/tests-dev/**`
- Create: `tests-dev/**` from every Git-tracked file below `tests/**`
- Create: `config/test-suite-root.mjs`
- Create: `config/test-suite-root.d.mts`
- Create: `config/test-suite-root.test.mjs`
- Modify: `playwright.config.ts`
- Modify: `tsconfig.json`

**Interfaces:**
- Consumes: `PLAYWRIGHT_TEST_SUITE_ROOT` from an environment-like object.
- Produces: `resolveRootTestDir(env): './tests' | './tests-dev'`.

- [ ] **Step 1: Write the failing exact-root test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRootTestDir } from './test-suite-root.mjs';

test('root suite defaults to tests and accepts only tests-dev', () => {
  assert.equal(resolveRootTestDir({}), './tests');
  assert.equal(resolveRootTestDir({ PLAYWRIGHT_TEST_SUITE_ROOT: 'tests' }), './tests');
  assert.equal(resolveRootTestDir({ PLAYWRIGHT_TEST_SUITE_ROOT: 'tests-dev' }), './tests-dev');
  for (const value of [' tests-dev ', '../tests', 'tests-devil', '/tmp/tests']) {
    assert.throws(
      () => resolveRootTestDir({ PLAYWRIGHT_TEST_SUITE_ROOT: value }),
      /PLAYWRIGHT_TEST_SUITE_ROOT/
    );
  }
});
```

- [ ] **Step 2: Run the focused test and observe RED**

Run:

```bash
node --test config/test-suite-root.test.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` for `config/test-suite-root.mjs`.

- [ ] **Step 3: Implement the exact two-root resolver**

```js
const ROOTS = new Set(['tests', 'tests-dev']);

export function resolveRootTestDir(env = process.env) {
  const root = String(env.PLAYWRIGHT_TEST_SUITE_ROOT ?? 'tests');
  if (!ROOTS.has(root)) {
    throw new Error('PLAYWRIGHT_TEST_SUITE_ROOT must be tests or tests-dev.');
  }
  return `./${root}`;
}
```

Add the adjacent TypeScript declaration in `config/test-suite-root.d.mts`:

```ts
export function resolveRootTestDir(
  env?: Record<string, string | undefined>
): './tests' | './tests-dev';
```

- [ ] **Step 4: Route root Playwright and TypeScript**

In `playwright.config.ts`, import `resolveRootTestDir` and set:

```ts
testDir: resolveRootTestDir(process.env),
```

In `tsconfig.json`, add the exact include:

```json
"tests-dev/**/*.ts"
```

- [ ] **Step 5: Replace the wrong mirror with the tracked root mirror**

Resolve the destructive target first:

```bash
git ls-files packages/web/tests-dev
git ls-files tests
```

Then remove only the wrong tracked mirror and mechanically copy only tracked root tests:

```bash
git rm -r packages/web/tests-dev
mkdir tests-dev
git ls-files -z tests | while IFS= read -r -d '' source; do
  target="tests-dev/${source#tests/}"
  mkdir -p "$(dirname "$target")"
  cp "$source" "$target"
done
```

- [ ] **Step 6: Verify exact copy and collection**

Run:

```bash
node --test config/test-suite-root.test.mjs
diff -qr tests tests-dev
PLAYWRIGHT_TEST_SUITE_ROOT=tests-dev npx playwright test --list --project=api
PLAYWRIGHT_TEST_SUITE_ROOT=tests-dev npx playwright test --list --project=ui
```

Expected: focused unit test passes; `diff` is empty; API lists 8 tests in 6 files; UI lists 19 tests in 9 files.

- [ ] **Step 7: Commit**

```bash
git add config/test-suite-root.mjs config/test-suite-root.d.mts config/test-suite-root.test.mjs playwright.config.ts tsconfig.json tests-dev
git commit -m "test: mirror root PsychicBook suite for dev"
```

The `git rm` deletions are already staged and belong in this commit.

---

### Task 2: Add PsychicBook Dev Environment Without Changing Stage Defaults

**Files:**
- Modify: `config/environments.ts`
- Create: `config/environments.test.mjs`
- Modify: `.env.example`
- Modify: `docs/environment-variables.md`

**Interfaces:**
- Consumes: `TEST_ENV=stage | dev`.
- Produces: one complete `Environment` record for each environment.

- [ ] **Step 1: Write a failing integration test for config collection**

`config/environments.test.mjs` spawns the real Playwright config with safe fixture credentials:

```js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const baseEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TEST_ENV: 'dev',
  WEB_BASIC_AUTH_USER: 'fixture-user',
  WEB_BASIC_AUTH_PASSWORD: 'fixture-password',
  AGENT_PASSWORD: 'fixture-password',
  ADMIN_EMAIL: 'admin@example.test',
  ADMIN_PASSWORD: 'fixture-password'
};

test('dev environment lets the real root Playwright config collect tests', () => {
  const result = spawnSync(
    'npx',
    ['playwright', 'test', '--list', '--project=api'],
    { cwd: process.cwd(), env: baseEnv, encoding: 'utf8', shell: false }
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Total: 8 tests in 6 files/);
});
```

- [ ] **Step 2: Run the test and observe RED**

```bash
node --test config/environments.test.mjs
```

Expected: nonzero Playwright exit containing `Unknown TEST_ENV "dev"`.

- [ ] **Step 3: Add the exact dev environment**

Change `EnvironmentName` to:

```ts
export type EnvironmentName = 'stage' | 'dev';
```

Add:

```ts
dev: {
  name: 'dev',
  webUrl: 'https://user.dev.psychicbook.net',
  apiUrl: 'https://api.dev.psychicbook.net',
  helpdeskUrl: 'https://helpdesk.dev.psychicbook.net',
  generationApiUrl: 'https://agpt.dev.psychicbook.net/api',
  emailCode: '1234',
  smsCode: '1234'
}
```

- [ ] **Step 4: Document `TEST_ENV=dev`**

Update `.env.example` and `docs/environment-variables.md` so the accepted values and dev command are explicit, while stage stays the default.

- [ ] **Step 5: Verify and commit**

```bash
node --test config/environments.test.mjs
npx tsc --noEmit
git add config/environments.ts config/environments.test.mjs .env.example docs/environment-variables.md
git commit -m "feat: add PsychicBook dev environment"
```

---

### Task 3: Forward PsychicBook Runtime Secrets Safely Through the Healer

**Files:**
- Create: `config/load-dotenv-policy.mjs`
- Create: `config/load-dotenv-policy.d.mts`
- Create: `config/load-dotenv-policy.test.mjs`
- Modify: `config/load-dotenv.ts`
- Modify: `packages/web/scripts/ai/lib/gate-environment.mjs`
- Modify: `packages/web/scripts/ai/__tests__/gate-environment.test.mjs`

**Interfaces:**
- Consumes: `AI_GATE_SANITIZED_ENV`, `TEST_ENV`, and root PsychicBook credential variables.
- Produces: `shouldLoadRootDotEnv(env): boolean`; an external-runtime child environment with required PsychicBook values; complete known-secret value redaction.

- [ ] **Step 1: Write the failing dotenv-policy test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldLoadRootDotEnv } from './load-dotenv-policy.mjs';

test('sanitized healer subprocesses never reload root .env', () => {
  assert.equal(shouldLoadRootDotEnv({}), true);
  assert.equal(shouldLoadRootDotEnv({ AI_GATE_SANITIZED_ENV: 'false' }), true);
  assert.equal(shouldLoadRootDotEnv({ AI_GATE_SANITIZED_ENV: 'true' }), false);
});
```

- [ ] **Step 2: Add failing gate-environment assertions**

Extend `gate-environment.test.mjs` with an external-runtime case containing:

```js
const source = {
  TEST_ENV: 'dev',
  WEB_BASIC_AUTH_USER: 'basic-user',
  WEB_BASIC_AUTH_PASSWORD: 'basic-password',
  AGENT_PASSWORD: 'agent-password',
  ADMIN_EMAIL: 'admin@example.test',
  ADMIN_PASSWORD: 'admin-password'
};
```

Assert `TEST_ENV` reaches both profiles; all five identity/credential values reach `external-runtime`; none of those five values reach `static`; and `knownSecretEnvValues(source)` includes all five sensitive values without writing real values into snapshots or fixtures.

- [ ] **Step 3: Run both tests and observe RED**

```bash
node --test config/load-dotenv-policy.test.mjs packages/web/scripts/ai/__tests__/gate-environment.test.mjs
```

Expected: missing module plus absent PsychicBook environment fields.

- [ ] **Step 4: Implement sanitized dotenv behavior**

```js
export function shouldLoadRootDotEnv(env = process.env) {
  return env.AI_GATE_SANITIZED_ENV !== 'true';
}
```

Add the adjacent TypeScript declaration in `config/load-dotenv-policy.d.mts`:

```ts
export function shouldLoadRootDotEnv(
  env?: Record<string, string | undefined>
): boolean;
```

Use it in `config/load-dotenv.ts`:

```ts
if (shouldLoadRootDotEnv(process.env)) {
  dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
}
```

- [ ] **Step 5: Extend the healer allowlist and secret set minimally**

Add the environment selector to the base policy:

```text
TEST_ENV
```

Add only the five root values required by the current suite to external runtime and known-secret handling:

```text
WEB_BASIC_AUTH_USER
WEB_BASIC_AUTH_PASSWORD
AGENT_PASSWORD
ADMIN_EMAIL
ADMIN_PASSWORD
```

Treat every one of these identities and credentials as sensitive for value-based redaction. Keep them unavailable to static checks and provider evidence. Optional root settings continue to use their committed safe defaults, so the healer does not gain a wider environment surface than this suite needs.

- [ ] **Step 6: Verify and commit**

```bash
node --test config/load-dotenv-policy.test.mjs packages/web/scripts/ai/__tests__/gate-environment.test.mjs
npx tsc --noEmit
git add config/load-dotenv-policy.mjs config/load-dotenv-policy.d.mts config/load-dotenv-policy.test.mjs config/load-dotenv.ts packages/web/scripts/ai/lib/gate-environment.mjs packages/web/scripts/ai/__tests__/gate-environment.test.mjs
git commit -m "fix: forward PsychicBook healer environment safely"
```

---

### Task 4: Let the Healer Process Root Handwritten API/UI Specs

**Files:**
- Create: `eslint.config.mjs`
- Modify: `packages/web/scripts/ai/healer/test-heal-contract.mjs`
- Modify: `packages/web/scripts/ai/__tests__/test-heal-contract.test.mjs`

**Interfaces:**
- Consumes: root `tests-dev/api/**` and `tests-dev/ui/**` without a flow-spec directory.
- Produces: a handwritten heal contract without invoking flow-spec discovery for directories that cannot be spec-bound.

- [ ] **Step 1: Write the failing handwritten-contract regression**

```js
test('ordinary api and ui targets do not require a flow-spec directory', () => {
  for (const testPath of [
    'tests-dev/api/users/register-user.spec.ts',
    'tests-dev/ui/articles/articles-tab.spec.ts'
  ]) {
    const contract = resolveHealContract({
      testPath,
      source: 'import { test } from "@playwright/test";',
      webRoot: makeWebRoot(),
      discoverSpec: () => { throw new Error('spec discovery must not run'); }
    });
    assert.equal(contract.kind, 'handwritten');
    assert.equal(contract.testPath, testPath);
  }
});
```

- [ ] **Step 2: Run the contract test and observe RED**

```bash
node --test --test-name-pattern='ordinary api and ui targets' packages/web/scripts/ai/__tests__/test-heal-contract.test.mjs
```

Expected: `spec discovery must not run`.

- [ ] **Step 3: Skip irrelevant spec discovery**

In `resolveHealContract`, call `resolveExplicitOrDiscoveredSpec` only when at least one condition is true:

```js
options.explicitSpecPath !== undefined || specMarker !== null || isSpecBoundDirectory(contractTestPath)
```

Recorded contracts retain their current validation. Generated regression/smoke/accessibility/visual targets retain fail-closed spec lookup and allowlist behavior.

- [ ] **Step 4: Provide the existing strict ESLint policy at the root**

Create `eslint.config.mjs` as a direct configuration reuse:

```js
export { default } from './packages/web/eslint.config.mjs';
```

This lets the existing healer lint root candidates without adding a second rule set.

- [ ] **Step 5: Verify contract, lint, and a real healer baseline path**

```bash
node --test packages/web/scripts/ai/__tests__/test-heal-contract.test.mjs
npx eslint tests-dev/api/users/register-user.spec.ts --max-warnings=0
AI_DOTENV_PATH="$PWD/.env" TEST_ENV=dev AI_AUTOHEAL_ENABLED=true \
  node packages/web/scripts/ai/heal-test.mjs \
  --test tests-dev/api/users/register-user.spec.ts \
  --project api --max-attempts 1 --verify-runs 2
```

The real healer command may return `already-green`, `not-repairable`, or a proposal status depending on live dev state. It must not fail before baseline with missing specs, missing lint config, stripped runtime configuration, or wrong project selection.

- [ ] **Step 6: Commit**

```bash
git add eslint.config.mjs packages/web/scripts/ai/healer/test-heal-contract.mjs packages/web/scripts/ai/__tests__/test-heal-contract.test.mjs
git commit -m "fix: support handwritten root suites in healer"
```

---

### Task 5: Establish the Clean Dev Baseline and Feedback Log

**Files:**
- Create: `docs/ai-testing/psychicbook-root-dev-healing-feedback-2026-08-08.md`

**Interfaces:**
- Consumes: committed clean `tests-dev`, `TEST_ENV=dev`, root `.env`.
- Produces: per-file factual baseline classifications and healer telemetry.

- [ ] **Step 1: Capture canonical hashes before runtime work**

```bash
git ls-files -z tests | xargs -0 shasum -a 256 > /tmp/psychicbook-canonical-before.sha256
```

- [ ] **Step 2: Confirm inventory and environment readiness**

```bash
PLAYWRIGHT_TEST_SUITE_ROOT=tests-dev TEST_ENV=dev npx playwright test --list --project=api
PLAYWRIGHT_TEST_SUITE_ROOT=tests-dev TEST_ENV=dev npx playwright test --list --project=ui
```

Expected: 8 API tests in 6 files and 19 UI tests in 9 files.

- [ ] **Step 3: Create a factual feedback table**

Use these columns:

```markdown
| File | Project | Baseline | Classification | Provider calls | Attempts | Applied diff | Verification | Final |
|---|---|---:|---|---:|---:|---|---|---|
```

Record only observed results. Do not speculate about improvements.

- [ ] **Step 4: Commit the initial log structure**

```bash
git add docs/ai-testing/psychicbook-root-dev-healing-feedback-2026-08-08.md
git commit -m "docs: start PsychicBook root dev healing feedback"
```

---

### Task 6: Run and Heal the Six API Spec Files

**Files:**
- Modify only when healer applies: `tests-dev/api/**/*.spec.ts`
- Update: `docs/ai-testing/psychicbook-root-dev-healing-feedback-2026-08-08.md`

**Interfaces:**
- Consumes: single API spec path and project `api`.
- Produces: green file or documented non-test blocker.

- [ ] **Step 1: Run each file baseline serially**

Use this exact tracked inventory:

```text
tests-dev/api/experts/expert-booking.spec.ts
tests-dev/api/experts/expert-lifecycle.spec.ts
tests-dev/api/users/delete-user.spec.ts
tests-dev/api/users/register-user.spec.ts
tests-dev/api/users/update-user.spec.ts
tests-dev/api/users/user-lifecycle.spec.ts
```

Set `dev_test_file` to one exact path from that list, then run:

```bash
dev_test_file=tests-dev/api/experts/expert-booking.spec.ts
PLAYWRIGHT_TEST_SUITE_ROOT=tests-dev TEST_ENV=dev \
  npx playwright test "$dev_test_file" --project=api --workers=1 --retries=0
```

- [ ] **Step 2: Classify before healing**

Use the trace, JSON/list output, and stack owner. Only locator drift or synchronization owned by the spec proceeds to `--apply`. Authentication, network, data, cleanup, product, assertion-value, and shared-owner failures are recorded without test mutation.

- [ ] **Step 3: Apply the healer to a repairable file**

```bash
AI_DOTENV_PATH="$PWD/.env" TEST_ENV=dev AI_AUTOHEAL_ENABLED=true \
  node packages/web/scripts/ai/heal-test.mjs \
  --test "$dev_test_file" --project api --apply --max-attempts 3 --verify-runs 2
```

Do not pass `--allow-dirty` on the first attempt. If a verified applied candidate needs another independent healer cycle, commit the first green change before the next cycle.

- [ ] **Step 4: Verify and commit each healed API file**

```bash
PLAYWRIGHT_TEST_SUITE_ROOT=tests-dev TEST_ENV=dev \
  npx playwright test "$dev_test_file" --project=api --workers=1 --retries=0
dev_flow_name=$(basename "$dev_test_file" .spec.ts)
git add "$dev_test_file" docs/ai-testing/psychicbook-root-dev-healing-feedback-2026-08-08.md
git commit -m "test: heal ${dev_flow_name} for PsychicBook dev"
```

- [ ] **Step 5: Run the complete API dev project**

```bash
PLAYWRIGHT_TEST_SUITE_ROOT=tests-dev TEST_ENV=dev \
  npx playwright test --project=api --workers=1 --retries=0
```

---

### Task 7: Run and Heal the Nine UI Spec Files

**Files:**
- Modify only when healer applies: `tests-dev/ui/**/*.spec.ts`
- Update: `docs/ai-testing/psychicbook-root-dev-healing-feedback-2026-08-08.md`

**Interfaces:**
- Consumes: single UI spec path and project `ui`.
- Produces: green file or documented non-test blocker.

- [ ] **Step 1: Run each file baseline serially**

Use this exact tracked inventory:

```text
tests-dev/ui/articles/articles-tab.spec.ts
tests-dev/ui/booking/book-with-article-author.spec.ts
tests-dev/ui/chat/user-agent-chat.spec.ts
tests-dev/ui/coupons/discount-lifecycle.spec.ts
tests-dev/ui/horoscope/daily-horoscope.spec.ts
tests-dev/ui/match-advisor/find-your-match.spec.ts
tests-dev/ui/navigation/site-navigation.spec.ts
tests-dev/ui/profile/profile-sections.spec.ts
tests-dev/ui/sessions/my-sessions.spec.ts
```

Set `dev_test_file` to one exact path from that list, then run:

```bash
dev_test_file=tests-dev/ui/articles/articles-tab.spec.ts
PLAYWRIGHT_TEST_SUITE_ROOT=tests-dev TEST_ENV=dev \
  npx playwright test "$dev_test_file" --project=ui --workers=1 --retries=0
```

- [ ] **Step 2: Classify and invoke the healer only for repairable evidence**

```bash
AI_DOTENV_PATH="$PWD/.env" TEST_ENV=dev AI_AUTOHEAL_ENABLED=true \
  node packages/web/scripts/ai/heal-test.mjs \
  --test "$dev_test_file" --project ui --apply --max-attempts 3 --verify-runs 2
```

Never replace assertions with visibility-only checks, positional selectors, sleeps, skipped tests, retries, or exception swallowing.

- [ ] **Step 3: Verify and commit each healed UI file**

```bash
PLAYWRIGHT_TEST_SUITE_ROOT=tests-dev TEST_ENV=dev \
  npx playwright test "$dev_test_file" --project=ui --workers=1 --retries=0
dev_flow_name=$(basename "$dev_test_file" .spec.ts)
git add "$dev_test_file" docs/ai-testing/psychicbook-root-dev-healing-feedback-2026-08-08.md
git commit -m "test: heal ${dev_flow_name} for PsychicBook dev"
```

- [ ] **Step 4: Run the complete UI dev project**

```bash
PLAYWRIGHT_TEST_SUITE_ROOT=tests-dev TEST_ENV=dev \
  npx playwright test --project=ui --workers=1 --retries=0
```

---

### Task 8: Final Verification, Canonical Integrity, and Healer Feedback

**Files:**
- Update: `docs/ai-testing/psychicbook-root-dev-healing-feedback-2026-08-08.md`

**Interfaces:**
- Consumes: final dev tree and recorded cycles.
- Produces: evidence-backed completion status and observed improvement list.

- [ ] **Step 1: Run complete static verification**

```bash
node --test config/*.test.mjs packages/web/scripts/ai/__tests__/gate-environment.test.mjs packages/web/scripts/ai/__tests__/test-heal-contract.test.mjs
npx tsc --noEmit
npx eslint playwright.config.ts config tests tests-dev api components fixtures flows pages --max-warnings=0
```

- [ ] **Step 2: Run the complete dev suite**

```bash
PLAYWRIGHT_TEST_SUITE_ROOT=tests-dev TEST_ENV=dev \
  npx playwright test --workers=1 --retries=0
```

Expected only if prerequisites permit: 27/27 tests pass. If a product, data, authentication, or cleanup blocker remains, report its exact classification instead of claiming completion.

- [ ] **Step 3: Prove canonical tests stayed unchanged**

```bash
git ls-files -z tests | xargs -0 shasum -a 256 > /tmp/psychicbook-canonical-after.sha256
diff -u /tmp/psychicbook-canonical-before.sha256 /tmp/psychicbook-canonical-after.sha256
git diff --name-only -- tests
```

Expected: empty diff and no canonical test paths.

- [ ] **Step 4: Finish the feedback analysis**

Summarize only observed facts:

- correct versus incorrect healer classifications;
- unnecessary provider calls or attempts;
- policy warnings and whether they were actionable;
- runtime and verification cost;
- safe applied changes;
- blockers the healer correctly refused;
- concrete framework defects with reproduction evidence.

If no additional real defect was observed, state that the framework behaved correctly for the remaining cycles.

- [ ] **Step 5: Commit final evidence**

```bash
git add docs/ai-testing/psychicbook-root-dev-healing-feedback-2026-08-08.md
git commit -m "docs: record PsychicBook root dev healing results"
```
