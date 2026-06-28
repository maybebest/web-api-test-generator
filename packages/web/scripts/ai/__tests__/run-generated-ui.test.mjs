import assert from 'node:assert/strict';
import test from 'node:test';

import { collectGeneratedUiPlan } from '../run-generated-ui.mjs';

const MEDIA_PLAN_SAVE_TEST = 'tests/regression/media-plan-save-via-nectar-ai.authenticated.spec.ts';
const PENDING_SUBDIR_SPEC = 'specs/special-preconditions/media-planner-minimum-campaign-duration.md';

test('generated UI runner selects delivered generated specs and skips pending-generation ones', () => {
  const plan = collectGeneratedUiPlan({ specDir: 'specs' });

  // The delivered media-plan-save spec is generated with a matching header, so it
  // is selected; pending-generation specs (e.g. the special-preconditions set)
  // are skipped into `pending`, never selected.
  const selected = plan.entries.map((entry) => entry.testPath);
  assert.ok(
    selected.includes(MEDIA_PLAN_SAVE_TEST),
    `expected ${MEDIA_PLAN_SAVE_TEST} to be selected; got: ${selected.join(', ') || '(none)'}`
  );
  assert.match(plan.pending.join('\n'), /pending-generation/);
});

test('generated UI runner skips a pending-generation spec requested explicitly', () => {
  const plan = collectGeneratedUiPlan({
    specPaths: [PENDING_SUBDIR_SPEC],
    project: 'chromium'
  });

  assert.deepEqual(plan.entries, []);
  assert.deepEqual(plan.issues, []);
  assert.match(plan.pending.join('\n'), /awaiting live generation/);
});

test('generated UI runner threads the project filter into the playwright args', () => {
  const plan = collectGeneratedUiPlan({
    specPaths: [PENDING_SUBDIR_SPEC],
    project: 'chromium'
  });

  assert.deepEqual(plan.issues, []);
  // The spec is pending-generation, so no test paths are appended — but the
  // --project filter is still threaded into the Playwright UI args.
  assert.deepEqual(plan.entries, []);
  assert.deepEqual(plan.args, ['playwright', 'test', '--ui', '--project=chromium']);
});
