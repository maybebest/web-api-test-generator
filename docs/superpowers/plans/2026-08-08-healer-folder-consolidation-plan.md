# Healer Folder Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate every healer-exclusive production module under `packages/web/scripts/ai/healer/` while preserving the existing CLI path, exports, and runtime behavior.

**Architecture:** Keep one flat `healer/` implementation directory and one logic-free compatibility entry point at `scripts/ai/heal-test.mjs`. Continue consuming genuinely shared generation, review, selector, security, and gate modules from `scripts/ai/lib/`; keep tests and prompts in their existing convention-based locations.

**Tech Stack:** Node.js ESM, Node test runner, TypeScript compiler API, Playwright Test framework scripts.

## Global Constraints

- Do not change healer algorithms, defaults, statuses, exit codes, policy severity, verification behavior, prompt text, or rendered results.
- Preserve `npm run ai:test:heal` and `node scripts/ai/heal-test.mjs` unchanged.
- Preserve every existing named export from `scripts/ai/heal-test.mjs`.
- Keep the folder flat; do not introduce barrels, dependency injection, or new abstraction layers.
- Move only healer-exclusive production modules; shared modules remain in `scripts/ai/lib/`.
- Keep tests in `scripts/ai/__tests__/`, the manual prompt in `ai/prompts/`, and documentation in `docs/`.

---

### Task 1: Relocate the healer implementation behind a compatible entry point

**Files:**
- Create: `packages/web/scripts/ai/healer/heal-test.mjs` by moving the current implementation
- Create: `packages/web/scripts/ai/healer/test-heal.mjs` by moving `scripts/ai/lib/test-heal.mjs`
- Create: `packages/web/scripts/ai/healer/test-heal-context.mjs` by moving `scripts/ai/lib/test-heal-context.mjs`
- Create: `packages/web/scripts/ai/healer/test-heal-contract.mjs` by moving `scripts/ai/lib/test-heal-contract.mjs`
- Create: `packages/web/scripts/ai/healer/test-heal-scoped-role.mjs` by moving `scripts/ai/lib/test-heal-scoped-role.mjs`
- Create: `packages/web/scripts/ai/healer/test-heal-triage.mjs` by moving `scripts/ai/lib/test-heal-triage.mjs`
- Replace: `packages/web/scripts/ai/heal-test.mjs` with the compatibility entry point
- Modify: `packages/web/scripts/ai/__tests__/heal-test-cli.test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/test-heal.test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/test-heal-context.test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/test-heal-contract.test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/test-heal-policy.test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/test-heal-scoped-role.test.mjs`
- Modify: `packages/web/scripts/ai/__tests__/test-heal-triage.test.mjs`

**Interfaces:**
- Consumes: shared modules below `scripts/ai/lib/` and sibling review/gate scripts below `scripts/ai/`
- Produces: `runCli(): Promise<void>` from `healer/heal-test.mjs`, plus the unchanged legacy exports re-exported by `scripts/ai/heal-test.mjs`

- [ ] **Step 1: Establish the focused green baseline**

Run from `packages/web`:

```bash
node --test \
  scripts/ai/__tests__/heal-test-cli.test.mjs \
  scripts/ai/__tests__/test-heal-context.test.mjs \
  scripts/ai/__tests__/test-heal-contract.test.mjs \
  scripts/ai/__tests__/test-heal-policy.test.mjs \
  scripts/ai/__tests__/test-heal-scoped-role.test.mjs \
  scripts/ai/__tests__/test-heal-triage.test.mjs \
  scripts/ai/__tests__/test-heal.test.mjs
```

Expected: all focused healer tests pass before any path changes.

- [ ] **Step 2: Add a failing compatibility contract test**

Add these imports to `heal-test-cli.test.mjs`:

```js
import path from 'node:path';
import { spawnSync } from 'node:child_process';
```

Add tests that require the new implementation path while retaining the old import already used by the file:

```js
test('legacy healer entry point re-exports the implementation API', async () => {
  const legacy = await import('../heal-test.mjs');
  const implementation = await import('../healer/heal-test.mjs');

  assert.deepEqual(Object.keys(legacy).sort(), Object.keys(implementation).sort());
  for (const exportName of Object.keys(implementation)) {
    assert.equal(legacy[exportName], implementation[exportName]);
  }
});

test('healer implementation remains directly executable', () => {
  const webRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  const scriptPath = path.resolve(import.meta.dirname, '..', 'healer', 'heal-test.mjs');
  const result = spawnSync(process.execPath, [scriptPath, '--help'], {
    cwd: webRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.equal(result.stderr, '');
});
```

- [ ] **Step 3: Run the new tests and confirm the expected failure**

Run from `packages/web`:

```bash
node --test scripts/ai/__tests__/heal-test-cli.test.mjs
```

Expected: fail with `ERR_MODULE_NOT_FOUND` for `scripts/ai/healer/heal-test.mjs`.

- [ ] **Step 4: Move the six healer-exclusive files without changing their bodies**

Move the files exactly as listed in the task's **Files** section. Preserve Git rename history and do not rename any function, constant, schema, or status.

- [ ] **Step 5: Update only relative import paths required by the move**

In `healer/heal-test.mjs`:

- change top-level script imports such as `./generated-test-gate.mjs` to `../generated-test-gate.mjs`;
- change shared library imports such as `./lib/ai-client.mjs` to `../lib/ai-client.mjs`;
- change healer-owned imports such as `./lib/test-heal-context.mjs` to `./test-heal-context.mjs`.

In the five moved healer modules, point shared dependencies to `../lib/*.mjs`, point `test-heal-contract.mjs` at `../validate-flow-spec.mjs`, and retain healer-to-healer imports as sibling `./test-heal-*.mjs` imports.

In healer unit tests, replace only `../lib/test-heal*.mjs` imports with `../healer/test-heal*.mjs`. Keep CLI-facing test imports from `../heal-test.mjs` so they continue exercising compatibility.

- [ ] **Step 6: Export the single CLI implementation function**

Change only the declaration in `healer/heal-test.mjs`:

```js
export async function runCli() {
```

Retain the existing direct-execution guard at the bottom of the moved file so `node scripts/ai/healer/heal-test.mjs --help` works.

- [ ] **Step 7: Replace the old entry file with a logic-free compatibility launcher**

Use this complete content for `scripts/ai/heal-test.mjs`:

```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCli } from './healer/heal-test.mjs';

export * from './healer/heal-test.mjs';

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  await runCli();
}
```

This file owns only compatibility dispatch; all healer behavior remains in the new folder.

- [ ] **Step 8: Run the focused healer suite**

Run the Step 1 command again.

Expected: all focused tests pass, including identical old/new export identity and direct execution through the new path.

- [ ] **Step 9: Prove the old implementation paths are gone**

Run from the repository root:

```bash
test -z "$(rg -n "lib/test-heal(?:-context|-contract|-scoped-role|-triage)?\\.mjs" packages/web --glob '*.mjs')"
test ! -e packages/web/scripts/ai/lib/test-heal.mjs
test ! -e packages/web/scripts/ai/lib/test-heal-context.mjs
test ! -e packages/web/scripts/ai/lib/test-heal-contract.mjs
test ! -e packages/web/scripts/ai/lib/test-heal-scoped-role.mjs
test ! -e packages/web/scripts/ai/lib/test-heal-triage.mjs
```

Expected: every command exits zero with no stale healer-module references under `lib/`.

- [ ] **Step 10: Commit the behavior-preserving relocation**

```bash
git add packages/web/scripts/ai/heal-test.mjs \
  packages/web/scripts/ai/healer \
  packages/web/scripts/ai/lib/test-heal.mjs \
  packages/web/scripts/ai/lib/test-heal-context.mjs \
  packages/web/scripts/ai/lib/test-heal-contract.mjs \
  packages/web/scripts/ai/lib/test-heal-scoped-role.mjs \
  packages/web/scripts/ai/lib/test-heal-triage.mjs \
  packages/web/scripts/ai/__tests__
git commit -m "refactor: consolidate healer implementation"
```

---

### Task 2: Document and verify the consolidated boundary

**Files:**
- Modify: `packages/web/docs/ai-testing/ARCHITECTURE.md`

**Interfaces:**
- Consumes: the compatible `scripts/ai/heal-test.mjs` command and implementation folder from Task 1
- Produces: an explicit architecture statement that healer-owned code lives in `scripts/ai/healer/`

- [ ] **Step 1: Update the architecture description**

Keep the documented command at `scripts/ai/heal-test.mjs`, and add one sentence after the Safe Test Healing command description:

```markdown
Healer-exclusive implementation modules live together under
`scripts/ai/healer/`; the top-level `scripts/ai/heal-test.mjs` file is the
backward-compatible command entry point.
```

- [ ] **Step 2: Verify both command paths expose identical help behavior**

Run from `packages/web`:

```bash
node scripts/ai/heal-test.mjs --help > /tmp/healer-legacy-help.txt
node scripts/ai/healer/heal-test.mjs --help > /tmp/healer-direct-help.txt
cmp /tmp/healer-legacy-help.txt /tmp/healer-direct-help.txt
```

Expected: both commands exit zero and `cmp` reports no difference.

- [ ] **Step 3: Run the complete framework self-suite**

Run from `packages/web`:

```bash
npm run ai:test:self
```

Expected: all Node framework tests pass.

- [ ] **Step 4: Run static project verification**

Run from `packages/web`:

```bash
npm run typecheck
npm run lint
```

Expected: both commands exit zero.

- [ ] **Step 5: Review the final diff for accidental logic changes**

Run from the repository root:

```bash
git diff --check HEAD~1
git diff --stat HEAD~1
git diff --find-renames=90% HEAD~1 -- packages/web/scripts/ai
```

Expected: the five `test-heal*` modules are pure renames except for import paths; the main CLI implementation changes only import paths and the `runCli` export; the compatibility file contains only delegation code; tests contain path updates plus the two compatibility assertions.

- [ ] **Step 6: Commit documentation and any verification-only test adjustment**

```bash
git add packages/web/docs/ai-testing/ARCHITECTURE.md
git commit -m "docs: describe consolidated healer boundary"
```
