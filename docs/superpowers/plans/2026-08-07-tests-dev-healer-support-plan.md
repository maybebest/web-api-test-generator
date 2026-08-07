# Tests-Dev Healer Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Create a complete packages/web/tests-dev mirror and make the existing single-file healer safely repair and apply changes there without modifying or double-running packages/web/tests.

**Architecture:** A shared root-policy module recognizes only tests and tests-dev, maps dev paths to canonical tests paths for contracts, and selects Playwright testDir through one healer-owned environment value. The healer continues to review, verify, archive, and replace the actual dev file while normal Playwright and CI runs default to tests.

**Tech Stack:** Node.js 22, JavaScript ES modules, TypeScript, Playwright Test 1.59.1, Node test runner, ESLint, existing generated-test reviewer/gate/healer.

## Global Constraints

- Copy all 43 Git-tracked files below packages/web/tests into the same relative paths below packages/web/tests-dev.
- Do not copy ignored or runtime content such as .tmp, reports, traces, screenshots, videos, or auth state.
- Accept only the exact roots tests and tests-dev; reject traversal, sibling lookalikes, and symlink escapes.
- Map tests-dev/<relative> to tests/<relative> only for spec, recording, allowlist, test-type, and project contracts.
- Keep the actual dev path as the file read, linted, typechecked, executed, archived, and atomically replaced.
- Normal package scripts and CI continue to collect only packages/web/tests.
- Keep the healer single-file; do not grant it shared Page Object write access.
- Do not change canonical PsychicBook tests or packages/web/pages/PsychicBookLoginPage.ts.
- Run live healing against https://user.dev.psychicbook.net/ with private environment values, one worker, zero retries, and three consecutive candidate verification runs.
- Do not weaken typecheck, lint, review, policy reporting, runtime, integrity, dirty-target, or concurrent-edit gates.

---

### Task 1: Add the exact two-root policy

**Files:**
- Create: packages/web/scripts/ai/lib/test-suite-root.mjs
- Create: packages/web/scripts/ai/__tests__/test-suite-root.test.mjs

**Interfaces:**
- Consumes: portable repository-relative test paths and environment-like objects.
- Produces: TEST_SUITE_ROOT_ENV, CANONICAL_TEST_ROOT, DEV_TEST_ROOT, testSuiteRootForPath(), canonicalContractTestPath(), resolveConfiguredTestDir(), and withTestSuiteRoot().

- [ ] **Step 1: Write failing root-policy tests**

~~~js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalContractTestPath,
  resolveConfiguredTestDir,
  testSuiteRootForPath,
  withTestSuiteRoot
} from '../lib/test-suite-root.mjs';

test('recognizes canonical and dev roots exactly', () => {
  assert.equal(testSuiteRootForPath('tests/regression/a.spec.ts'), 'tests');
  assert.equal(testSuiteRootForPath('tests-dev/regression/a.spec.ts'), 'tests-dev');
  assert.equal(
    canonicalContractTestPath('tests-dev/regression/a.spec.ts'),
    'tests/regression/a.spec.ts'
  );
});

test('rejects traversal and sibling lookalikes', () => {
  for (const value of [
    'tests-devil/a.spec.ts',
    'tests-shadow/a.spec.ts',
    'tests-dev//a.spec.ts',
    'tests-dev/./a.spec.ts',
    'tests-dev/',
    'tests-dev/../tests/a.spec.ts',
    '../tests-dev/a.spec.ts',
    '/tmp/a.spec.ts'
  ]) assert.throws(() => testSuiteRootForPath(value), /safe test suite root/i);
});

test('testDir defaults to tests and accepts only tests-dev', () => {
  assert.equal(resolveConfiguredTestDir({}), './tests');
  assert.equal(resolveConfiguredTestDir({ PLAYWRIGHT_TEST_SUITE_ROOT: 'tests' }), './tests');
  assert.equal(resolveConfiguredTestDir({ PLAYWRIGHT_TEST_SUITE_ROOT: 'tests-dev' }), './tests-dev');
  assert.throws(
    () => resolveConfiguredTestDir({ PLAYWRIGHT_TEST_SUITE_ROOT: '../tests' }),
    /PLAYWRIGHT_TEST_SUITE_ROOT/
  );
  assert.throws(
    () => resolveConfiguredTestDir({ PLAYWRIGHT_TEST_SUITE_ROOT: ' tests-dev ' }),
    /PLAYWRIGHT_TEST_SUITE_ROOT/
  );
});

test('healer-owned selection overwrites a caller root', () => {
  assert.deepEqual(
    withTestSuiteRoot(
      { PLAYWRIGHT_TEST_SUITE_ROOT: 'tests', KEEP: 'value' },
      'tests-dev/regression/a.spec.ts'
    ),
    { PLAYWRIGHT_TEST_SUITE_ROOT: 'tests-dev', KEEP: 'value' }
  );
});
~~~

- [ ] **Step 2: Run the new test and observe the expected red state**

~~~bash
cd packages/web
node --test scripts/ai/__tests__/test-suite-root.test.mjs
~~~

Expected: ERR_MODULE_NOT_FOUND for lib/test-suite-root.mjs.

- [ ] **Step 3: Implement the policy module**

~~~js
const ROOTS = new Set(['tests', 'tests-dev']);

export const TEST_SUITE_ROOT_ENV = 'PLAYWRIGHT_TEST_SUITE_ROOT';
export const CANONICAL_TEST_ROOT = 'tests';
export const DEV_TEST_ROOT = 'tests-dev';

function portablePath(value) {
  const raw = String(value ?? '');
  const normalized = raw.replaceAll('\\', '/');
  if (
    !raw
    || raw !== raw.trim()
    || raw !== normalized
    || normalized.startsWith('/')
    || normalized.startsWith('-')
    || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
    || normalized === '.'
  ) throw new Error('Path must remain under a safe test suite root.');
  return normalized;
}

export function testSuiteRootForPath(testPath) {
  const normalized = portablePath(testPath);
  const root = normalized.split('/')[0];
  if (!ROOTS.has(root) || normalized === root) {
    throw new Error('Path must remain under a safe test suite root.');
  }
  return root;
}

export function canonicalContractTestPath(testPath) {
  const normalized = portablePath(testPath);
  if (testSuiteRootForPath(normalized) !== DEV_TEST_ROOT) return normalized;
  return CANONICAL_TEST_ROOT + '/' + normalized.slice((DEV_TEST_ROOT + '/').length);
}

export function resolveConfiguredTestDir(env = process.env) {
  const root = String(env[TEST_SUITE_ROOT_ENV] ?? CANONICAL_TEST_ROOT);
  if (!ROOTS.has(root)) throw new Error(TEST_SUITE_ROOT_ENV + ' must be tests or tests-dev.');
  return './' + root;
}

export function withTestSuiteRoot(env, testPath) {
  return { ...env, [TEST_SUITE_ROOT_ENV]: testSuiteRootForPath(testPath) };
}
~~~

- [ ] **Step 4: Verify the focused test**

~~~bash
node --test scripts/ai/__tests__/test-suite-root.test.mjs
~~~

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

~~~bash
git add packages/web/scripts/ai/lib/test-suite-root.mjs packages/web/scripts/ai/__tests__/test-suite-root.test.mjs
git commit -m "feat(web): define canonical and dev test roots"
~~~

---

### Task 2: Route Playwright subprocesses without changing defaults

**Files:**
- Modify: packages/web/playwright.config.ts
- Modify: packages/web/scripts/ai/lib/gate-environment.mjs
- Modify: packages/web/scripts/ai/__tests__/gate-environment.test.mjs

**Interfaces:**
- Consumes: resolveConfiguredTestDir() and PLAYWRIGHT_TEST_SUITE_ROOT from Task 1.
- Produces: default testDir ./tests, healer-selected ./tests-dev, and subprocess propagation.

- [ ] **Step 1: Add a failing gate-environment test**

~~~js
test('suite-root selection reaches static and runtime subprocesses', () => {
  const source = { PLAYWRIGHT_TEST_SUITE_ROOT: 'tests-dev' };
  assert.equal(
    buildGateEnvironment(source, { profile: 'static' }).PLAYWRIGHT_TEST_SUITE_ROOT,
    'tests-dev'
  );
  assert.equal(
    buildGateEnvironment(source, { profile: 'external-runtime' }).PLAYWRIGHT_TEST_SUITE_ROOT,
    'tests-dev'
  );
});
~~~

- [ ] **Step 2: Run the focused tests and confirm the new assertion fails**

~~~bash
node --test scripts/ai/__tests__/test-suite-root.test.mjs scripts/ai/__tests__/gate-environment.test.mjs
~~~

Expected: the new assertion receives undefined.

- [ ] **Step 3: Select testDir through the exact policy**

Add to playwright.config.ts:

~~~ts
import { resolveConfiguredTestDir } from './scripts/ai/lib/test-suite-root.mjs';

const configuredTestDir = resolveConfiguredTestDir(process.env);
const localFixtureSpecPattern =
  /(?:tests|tests-dev)[\\/](?:smoke|accessibility|visual|recorded)[\\/]/;
~~~

Use testDir: configuredTestDir in defineConfig and remove the older localFixtureSpecPattern declaration.

- [ ] **Step 4: Propagate the selector**

Add PLAYWRIGHT_TEST_SUITE_ROOT to BASE_ENVIRONMENT_NAMES.

- [ ] **Step 5: Verify focused behavior and fail-closed configuration**

~~~bash
node --test scripts/ai/__tests__/test-suite-root.test.mjs scripts/ai/__tests__/gate-environment.test.mjs
npm run typecheck
PLAYWRIGHT_TEST_SUITE_ROOT=outside npx playwright test --list
~~~

Expected: tests/typecheck pass; invalid root exits nonzero with an exact configuration error.

- [ ] **Step 6: Commit**

~~~bash
git add packages/web/playwright.config.ts packages/web/scripts/ai/lib/gate-environment.mjs packages/web/scripts/ai/__tests__/gate-environment.test.mjs
git commit -m "feat(web): route Playwright to the dev test mirror"
~~~

---

### Task 3: Extend healer containment and canonical contract mapping

**Files:**
- Modify: packages/web/scripts/ai/heal-test.mjs
- Modify: packages/web/scripts/ai/lib/test-heal-contract.mjs
- Modify: packages/web/scripts/ai/__tests__/test-heal.test.mjs
- Modify: packages/web/scripts/ai/__tests__/test-heal-contract.test.mjs

**Interfaces:**
- Consumes: canonicalContractTestPath(), testSuiteRootForPath(), and withTestSuiteRoot().
- Produces: dev-root containment, canonical contract decisions, correct project inference, and healer-owned runtime root selection.

- [ ] **Step 1: Add failing contract tests**

~~~js
test('dev mirror uses the canonical no-header allowlist identity', () => {
  const webRoot = makeWebRoot();
  fs.mkdirSync(path.join(webRoot, 'tests-dev', 'regression'), { recursive: true });
  fs.writeFileSync(
    path.join(webRoot, 'tests', '.no-header-allowlist'),
    'tests/regression/handwritten.spec.ts\n'
  );
  const contract = resolveHealContract({
    testPath: 'tests-dev/regression/handwritten.spec.ts',
    source: 'import { test } from "@playwright/test";',
    webRoot,
    discoverSpec: () => null
  });
  assert.equal(contract.kind, 'handwritten');
  assert.equal(contract.testPath, 'tests-dev/regression/handwritten.spec.ts');
});

test('explicit spec compares with the canonical dev identity', () => {
  const webRoot = makeWebRoot();
  const validation = { metadata: { 'Target Test File': 'tests/regression/save.spec.ts' } };
  const contract = resolveHealContract({
    testPath: 'tests-dev/regression/save.spec.ts',
    source: '/* spec: specs/save.md version:1.0.0 sha256:' + 'b'.repeat(64) + ' */',
    explicitSpecPath: 'specs/save.md',
    specDir: 'specs',
    webRoot,
    validateDirectory: () => ({
      valid: true,
      results: [{ specPath: 'specs/save.md', result: validation }]
    })
  });
  assert.equal(contract.kind, 'spec');
  assert.equal(contract.testPath, 'tests-dev/regression/save.spec.ts');
});

test('dev recorded layout keeps the canonical recording requirement', () => {
  const webRoot = makeWebRoot();
  assert.throws(() => resolveHealContract({
    testPath: 'tests-dev/recorded/save.spec.ts',
    source: 'import { test } from "@playwright/test";',
    webRoot,
    discoverSpec: () => null
  }), /recording contract/i);

  const contract = resolveHealContract({
    testPath: 'tests-dev/recorded/save.spec.ts',
    source: `/* recording: recordings/save.json title:Save sha256:${'a'.repeat(64)} */`,
    webRoot,
    discoverSpec: () => null
  });
  assert.equal(contract.kind, 'recording');
  assert.equal(contract.testPath, 'tests-dev/recorded/save.spec.ts');
});
~~~

- [ ] **Step 2: Add failing healer tests**

Create a temporary tests-dev/regression/flow.spec.ts and assert that healSingleTest:

~~~js
assert.equal(calls[0].testPath, 'tests-dev/regression/flow.spec.ts');
assert.equal(calls[0].env.PLAYWRIGHT_TEST_SUITE_ROOT, 'tests-dev');
assert.equal(result.target, 'tests-dev/regression/flow.spec.ts');
~~~

Also assert:

~~~js
assert.equal(inferStandaloneProject('tests-dev/recorded/flow.spec.ts'), 'local-chromium');
assert.equal(inferStandaloneProject('tests-dev/regression/flow.spec.ts'), 'chromium');
~~~

Add separate cases proving tests-shadow/flow.spec.ts and a symlink escaping tests-dev fail before browser/provider work.

- [ ] **Step 3: Confirm focused tests are red**

~~~bash
node --test scripts/ai/__tests__/test-heal-contract.test.mjs scripts/ai/__tests__/test-heal.test.mjs
~~~

Expected: dev cases fail because current containment and contract lookup assume tests.

- [ ] **Step 4: Canonicalize contract-only decisions**

In test-heal-contract.mjs, import canonicalContractTestPath(). Keep both actualTestPath and contractTestPath inside resolveHealContract(). Use contractTestPath for spec discovery, explicit Target Test File comparison, recorded-directory enforcement, spec-bound-directory classification, and the canonical no-header allowlist. Preserve actualTestPath in returned contract.testPath and keep candidate review pointed at the actual dev candidate file.

In heal-test.mjs:
- map testPath before discoverSpecForTest compares spec metadata;
- map testPath inside inferStandaloneProject;
- derive the exact target root before realpath containment;
- verify the target remains inside webRoot/<derived root>.

- [ ] **Step 5: Make healer own the Playwright root**

After target validation:

~~~js
const verificationEnv = withTestSuiteRoot(env, target);
~~~

Pass verificationEnv to executeGeneratedPair and executeStandaloneTarget. Keep the original env for provider selection and secret redaction.

- [ ] **Step 6: Verify the healer surface**

~~~bash
node --test \
  scripts/ai/__tests__/test-suite-root.test.mjs \
  scripts/ai/__tests__/test-heal-contract.test.mjs \
  scripts/ai/__tests__/test-heal-policy.test.mjs \
  scripts/ai/__tests__/test-heal-context.test.mjs \
  scripts/ai/__tests__/test-heal.test.mjs
~~~

Expected: all tests pass, including unchanged canonical-root cases.

- [ ] **Step 7: Commit**

~~~bash
git add packages/web/scripts/ai/heal-test.mjs packages/web/scripts/ai/lib/test-heal-contract.mjs packages/web/scripts/ai/__tests__/test-heal.test.mjs packages/web/scripts/ai/__tests__/test-heal-contract.test.mjs
git commit -m "feat(web): heal tests in the dev mirror"
~~~

---

### Task 4: Create the complete mirror and keep the account-menu repair single-file

**Files:**
- Create: packages/web/tests-dev/** from every tracked packages/web/tests/** file
- Modify after copy: packages/web/tests-dev/regression/psychicbook-account-menu.spec.ts
- Modify: packages/web/package.json
- Modify: packages/web/tsconfig.json
- Preserve: packages/web/tests/**
- Preserve: packages/web/pages/PsychicBookLoginPage.ts

**Interfaces:**
- Consumes: the tracked canonical suite and Tasks 1-3.
- Produces: a 43-file mirror with unchanged relative layout and a red, self-contained account-menu target.

- [ ] **Step 1: Copy tracked files only**

From repository root:

~~~bash
git diff --exit-code -- packages/web/tests packages/web/pages/PsychicBookLoginPage.ts
git ls-files packages/web/tests |
  sed 's#^packages/web/tests/##' |
  rsync -a --files-from=- packages/web/tests/ packages/web/tests-dev/
~~~

Expected: tests-dev/.tmp does not exist.

- [ ] **Step 2: Verify exact file-set parity**

~~~bash
test "$(git ls-files packages/web/tests | wc -l | tr -d ' ')" = "43"
test "$(find packages/web/tests-dev -type f | wc -l | tr -d ' ')" = "43"
comm -3 \
  <(git ls-files packages/web/tests | sed 's#^packages/web/tests/##' | sort) \
  <(find packages/web/tests-dev -type f | sed 's#^packages/web/tests-dev/##' | sort)
~~~

Expected: counts are 43 and comm prints nothing.

- [ ] **Step 3: Inline the behavior-identical shared Page Object in the dev account-menu spec**

Remove the import from ../../pages/PsychicBookLoginPage, add the type import below, and insert this class before dataCases. The only intentional difference from the shared class is removal of the export because the copy is local to this spec; locators and methods remain unchanged:

~~~ts
import type { Locator, Page } from '@playwright/test';

class PsychicBookLoginPage {
  private readonly getStartedLink: Locator;
  private readonly emailField: Locator;
  private readonly continueButton: Locator;
  private readonly verificationCodeAlternativeButton: Locator;
  private readonly verificationCodeInputs: Locator;
  private readonly accountSettingsLink: Locator;
  private readonly accountSettingsButton: Locator;

  constructor(private readonly page: Page) {
    this.getStartedLink = page.getByRole('link', { name: 'Get Started' });
    this.emailField = page.getByRole('textbox', { name: /email/i });
    this.continueButton = page.getByRole('button', { name: 'Continue' });
    this.verificationCodeAlternativeButton = page.getByRole('button', {
      name: /have a verification code/i
    });
    // locator-policy:exception the reviewed verification fields are anonymous numeric inputs without semantic names
    this.verificationCodeInputs = page.locator('input[inputmode="numeric"][maxlength="1"]');
    this.accountSettingsLink = page.getByRole('link', { name: /^account settings$/i });
    this.accountSettingsButton = page.getByRole('button', { name: /^account settings$/i });
  }

  async gotoLanding(): Promise<void> {
    await this.page.goto('/');
  }

  async start(): Promise<void> {
    await this.getStartedLink.click();
  }

  async submitEmail(email: string): Promise<void> {
    await this.emailField.fill(email);
    await this.continueButton.click();
  }

  async chooseVerificationCode(): Promise<void> {
    await this.verificationCodeAlternativeButton.click();
  }

  async submitVerificationCode(code: string): Promise<void> {
    if (!/^[0-9]{4}$/.test(code)) {
      throw new Error('PsychicBookLoginPage: verification code must contain exactly four ASCII digits.');
    }
    for (const [index, digit] of [...code].entries()) {
      // locator-policy:exception the reviewed four anonymous digit inputs must be filled in their rendered order
      await this.verificationCodeInputs.nth(index).fill(digit);
    }
  }

  accountSettingsControl(): Locator {
    return this.accountSettingsLink.or(this.accountSettingsButton);
  }
}
~~~

Expected: ownership becomes single-file but behavior remains red.

- [ ] **Step 4: Include the now-existing mirror in static tooling**

Change package.json lint to:

~~~json
"lint": "eslint playwright.config.ts tests tests-dev pages fixtures data automation --max-warnings=0"
~~~

Add to tsconfig.json include:

~~~json
"tests-dev/**/*.ts"
~~~

- [ ] **Step 5: Prove default and dev collection remain isolated**

From packages/web:

~~~bash
npx playwright test --list tests/regression/psychicbook-account-menu.spec.ts --project=chromium
PLAYWRIGHT_TEST_SUITE_ROOT=tests-dev npx playwright test --list tests-dev/regression/psychicbook-account-menu.spec.ts --project=chromium
~~~

Expected: each command lists only its requested root.

- [ ] **Step 6: Run static checks and confirm canonical paths are unchanged**

~~~bash
npm run typecheck
npm run lint
git diff --exit-code -- tests pages/PsychicBookLoginPage.ts
~~~

- [ ] **Step 7: Commit the clean mirror before apply mode**

~~~bash
git add packages/web/tests-dev packages/web/package.json packages/web/tsconfig.json
git commit -m "test(web): add isolated development test mirror"
~~~

---

### Task 5: Reproduce and heal both PsychicBook dev tests

**Files:**
- Modify through healer apply only: packages/web/tests-dev/regression/psychicbook-account-menu.spec.ts
- Modify through healer apply only: packages/web/tests-dev/regression/psychicbook-healing-experiment.spec.ts
- Read private values: .env and packages/web/.env
- Preserve: packages/web/tests/** and packages/web/pages/PsychicBookLoginPage.ts

**Interfaces:**
- Consumes: dev URL, private email/Basic Auth, healer root auto-detection, AI brain selection, and the red copies.
- Produces: two healer-applied files and private audit summaries with verifyRuns=3.

- [ ] **Step 1: Create one exact secret-safe launcher command and reproduce each dev failure once**

Run this command from repository root. It reads private files without printing values and supports both baseline and healer modes:

~~~bash
TARGET='tests-dev/regression/psychicbook-account-menu.spec.ts' \
MODE='baseline' \
REPEAT_EACH='1' \
node - <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');

const rootValues = dotenv.parse(fs.readFileSync('.env'));
const webValues = dotenv.parse(fs.readFileSync('packages/web/.env'));
const webRoot = path.resolve('packages/web');
const target = process.env.TARGET;
const mode = process.env.MODE;
const repeatEach = process.env.REPEAT_EACH || '1';
if (!target || !['baseline', 'heal'].includes(mode)) process.exit(64);

const env = {
  ...webValues,
  ...process.env,
  PLAYWRIGHT_TEST_BASE_URL: 'https://user.dev.psychicbook.net/',
  PLAYWRIGHT_TEST_SUITE_ROOT: 'tests-dev',
  E2E_AUTH_ENABLED: 'true',
  E2E_AUTH_REUSE_STATE: 'false',
  E2E_USER_EMAIL: rootValues.ADMIN_EMAIL,
  E2E_HTTP_BASIC_USERNAME: rootValues.WEB_BASIC_AUTH_USER,
  E2E_HTTP_BASIC_PASSWORD: rootValues.WEB_BASIC_AUTH_PASSWORD,
  AI_AUTOHEAL_ENABLED: 'true',
  ALLURE_ENABLED: 'false'
};

let args;
if (mode === 'baseline') {
  const requireFromWeb = createRequire(path.join(webRoot, 'package.json'));
  const playwrightCli = requireFromWeb.resolve('@playwright/test/cli');
  args = [
    playwrightCli,
    'test', target,
    '--project=chromium',
    '--workers=1',
    '--retries=0',
    '--repeat-each=' + repeatEach
  ];
} else {
  args = [
    'scripts/ai/heal-test.mjs',
    '--test', target,
    '--max-attempts', '3',
    '--verify-runs', '3',
    '--apply'
  ];
}

const result = spawnSync(process.execPath, args, { cwd: webRoot, env, stdio: 'inherit' });
process.exit(result.status ?? 1);
NODE
~~~

Repeat the command with TARGET set to tests-dev/regression/psychicbook-healing-experiment.spec.ts and keep MODE=baseline, REPEAT_EACH=1.

Expected: both fail only at AC-004; the post-login banner exposes profile button Q while locators still search for Account settings or T.

- [ ] **Step 2: Apply healer to account-menu**

Run the exact launcher from Step 1 with:

~~~text
TARGET=tests-dev/regression/psychicbook-account-menu.spec.ts
MODE=heal
REPEAT_EACH=1
~~~

Expected: status healed. A nonzero warning exit is acceptable only if heal-summary.json records an applied healed result with policy warnings. manual-change-required, not-repairable, environment-failure, and brain-error remain failures.

- [ ] **Step 3: Apply healer to the healing experiment**

Run the exact launcher from Step 1 with:

~~~text
TARGET=tests-dev/regression/psychicbook-healing-experiment.spec.ts
MODE=heal
REPEAT_EACH=1
~~~

Expected: the target is replaced only after three consecutive passing candidate runs.

- [ ] **Step 4: Inspect outcomes and prove canonical isolation**

~~~bash
git diff -- packages/web/tests-dev/regression/psychicbook-account-menu.spec.ts
git diff -- packages/web/tests-dev/regression/psychicbook-healing-experiment.spec.ts
git diff --exit-code -- packages/web/tests packages/web/pages/PsychicBookLoginPage.ts
find packages/web/.ai-runs/heal -name heal-summary.json -type f -print | tail -2
~~~

Expected: only dev specs differ; newest summaries show applied healing and verifyRuns 3.

- [ ] **Step 5: Independently repeat each healed target three times**

Run the exact launcher from Step 1 twice with MODE=baseline and REPEAT_EACH=3, once for each exact dev target.

Expected: 3/3 pass per target, with zero failed, flaky, retried, or skipped results.

- [ ] **Step 6: Re-run static reviewers**

From packages/web:

~~~bash
PLAYWRIGHT_TEST_SUITE_ROOT=tests-dev node scripts/ai/review-generated-test.mjs \
  --spec specs/psychicbook-account-menu.md \
  --test tests-dev/regression/psychicbook-account-menu.spec.ts
PLAYWRIGHT_TEST_SUITE_ROOT=tests-dev node scripts/ai/review-generated-test.mjs \
  --spec specs/psychicbook-healing-experiment.md \
  --test tests-dev/regression/psychicbook-healing-experiment.spec.ts
~~~

Expected: both pass; the known uncovered NEG-001 single-mode warning may remain non-blocking.

- [ ] **Step 7: Commit verified repairs**

~~~bash
git add \
  packages/web/tests-dev/regression/psychicbook-account-menu.spec.ts \
  packages/web/tests-dev/regression/psychicbook-healing-experiment.spec.ts
git commit -m "test(web): heal PsychicBook dev mirror locators"
~~~

---

### Task 6: Run full regression, security, and isolation verification

**Files:**
- Verify all implementation files from Tasks 1-5.
- Do not add runtime artifacts to Git.

**Interfaces:**
- Consumes: the complete implementation.
- Produces: evidence that normal CI, canonical tests, security boundaries, and dev healing remain intact.

- [ ] **Step 1: Run focused checks**

~~~bash
npm run -w packages/web typecheck
npm run -w packages/web lint
node --test \
  packages/web/scripts/ai/__tests__/test-suite-root.test.mjs \
  packages/web/scripts/ai/__tests__/gate-environment.test.mjs \
  packages/web/scripts/ai/__tests__/test-heal-contract.test.mjs \
  packages/web/scripts/ai/__tests__/test-heal-policy.test.mjs \
  packages/web/scripts/ai/__tests__/test-heal-context.test.mjs \
  packages/web/scripts/ai/__tests__/test-heal.test.mjs
~~~

- [ ] **Step 2: Run the complete web framework checks**

~~~bash
npm run -w packages/web ai:test:self
npm run -w packages/web ai:spec:validate
npm run -w packages/web ai:spec:drift
npm run -w packages/web ai:eval
~~~

Expected: all self-tests pass, 27 specs validate, canonical drift remains green, and golden evaluation passes.

- [ ] **Step 3: Prove ordinary local execution ignores tests-dev**

~~~bash
npm run -w packages/web test:e2e:local
~~~

Expected: canonical local tests run once and no tests-dev path executes.

- [ ] **Step 4: Run repository and security checks**

~~~bash
npm test
npm run api:secrets
npm audit --audit-level=high
/private/tmp/gitleaks-8.30.1-arm64/gitleaks git . \
  --log-opts='216060a8c470cf8be08dd71153333f34003ac239..HEAD' \
  --config .gitleaks.toml \
  --gitleaks-ignore-path .gitleaksignore \
  --redact --no-banner --no-color --exit-code 1
~~~

Expected: tests pass, scans find no secrets, and npm reports zero high vulnerabilities.

- [ ] **Step 5: Check isolation and cleanliness**

~~~bash
git diff --exit-code -- packages/web/tests packages/web/pages/PsychicBookLoginPage.ts
git diff --check
git status --short
git log --oneline --decorate -8
~~~

Expected: canonical paths have no diff, runtime artifacts are ignored, and only intentional implementation changes exist.

- [ ] **Step 6: Commit only deterministic corrections discovered by final verification**

If a deterministic correction was required, stage its exact files, rerun its focused checks, and commit:

~~~bash
git commit -m "test(web): complete tests-dev healer verification"
~~~

If no correction was required, create no empty commit.
