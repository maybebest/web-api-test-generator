import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { GENERATION_POLICY_VERSION, PLAYWRIGHT_GENERATION_POLICY } from '../lib/generation-policy.mjs';
import { buildGenerationInput } from '../lib/generation-input.mjs';
import { collectSpecSalientTokens, salientExpectedTokens } from '../lib/salient-tokens.mjs';
import { parseFlowSpec } from '../lib/spec-parser.mjs';

const complexSpec = 'specs/complex-catalog-filter-sort-modal.md';

// Iteration-1 static-review rejections were all mechanical: the model was never
// told the exact contracts the reviewer enforces. These substrings pin the
// corrected policy lines so the provider-facing system prompt states them.
test('policy states the exact mechanical covered-ac-ids annotation form', () => {
  assert.ok(
    PLAYWRIGHT_GENERATION_POLICY.includes(
      "test.info().annotations.push({ type: 'covered-ac-ids', description: 'AC-001 AC-002 ...' })"
    ),
    'policy must show the only accepted covered-ac-ids call form'
  );
  assert.ok(
    PLAYWRIGHT_GENERATION_POLICY.includes('details-object annotation: option is not recognized'),
    'policy must warn that the Playwright details-object annotation option is rejected'
  );
});

test('policy states the Page/Component/Object receiver-suffix naming contract', () => {
  assert.ok(
    PLAYWRIGHT_GENERATION_POLICY.includes(
      'Page/Component/Object suffix; expect receivers are validated by that suffix'
    ),
    'policy must state the expect-receiver naming contract'
  );
});

test('policy states the corrected import contract instead of the misleading one', () => {
  assert.ok(
    PLAYWRIGHT_GENERATION_POLICY.includes(
      'type-only imports from @playwright/test are allowed; the playwright package is forbidden'
    ),
    'policy must state the real import contract'
  );
  assert.ok(
    !PLAYWRIGHT_GENERATION_POLICY.includes('never import @playwright/test directly'),
    'the misleading blanket wording steered a candidate into importing from the forbidden playwright package'
  );
});

test('policy requires every supplied salient token verbatim', () => {
  assert.ok(
    PLAYWRIGHT_GENERATION_POLICY.includes('Salient expected tokens'),
    'policy must reference the provider-input salient token list by its label'
  );
  assert.ok(
    PLAYWRIGHT_GENERATION_POLICY.includes(
      'appear verbatim in an assertion, a step/test title, or an iterated data row'
    ),
    'policy must state where each salient token must appear'
  );
});

// Iteration-4: the browser-eval fault class recurred twice in two iterations
// while the policy's Forbidden line never mentioned the evaluate family at
// all. Policy v2 must name the whole family, the sanctioned web-first
// alternative, and the single reviewed waitForFunction exception marker.
test('policy forbids the full browser-evaluate family on the Forbidden line', () => {
  assert.equal(GENERATION_POLICY_VERSION, 'playwright-generation-policy/v3');
  const forbiddenLine = PLAYWRIGHT_GENERATION_POLICY
    .split('\n')
    .find((line) => line.startsWith('Forbidden:'));
  assert.ok(forbiddenLine, 'policy must keep a single Forbidden: line');
  for (const phrase of ['page.evaluate', 'evaluateHandle', '$eval', '$$eval', 'waitForFunction', 'in-page JS execution']) {
    assert.ok(forbiddenLine.includes(phrase), `Forbidden line must name: ${phrase}`);
  }
  assert.ok(
    forbiddenLine.includes('expect(locator).toHaveAttribute') && forbiddenLine.includes('toHaveText'),
    'Forbidden line must spell out the retrying web-first matcher alternative'
  );
  assert.ok(
    forbiddenLine.includes('reviewed Page Object method'),
    'Forbidden line must offer the reviewed Page Object method alternative'
  );
  assert.ok(
    forbiddenLine.includes('// locator-policy:exception <reason>'),
    'Forbidden line must mirror the reviewer gate waitForFunction exception marker'
  );
});

test('salientExpectedTokens derives the reviewer-enforced tokens', () => {
  assert.deepEqual(salientExpectedTokens('The Price header carries `aria-sort="ascending"`'), ['aria-sort=']);
  assert.deepEqual(salientExpectedTokens('An alert with `role=alert` appears'), ['role=alert']);
  assert.deepEqual(salientExpectedTokens('NEEDS_REVIEW: `role=alert`'), []);
});

test('collectSpecSalientTokens derives the complex catalog spec token list', () => {
  const parsed = parseFlowSpec(fs.readFileSync(complexSpec, 'utf8'));
  const tokens = collectSpecSalientTokens(parsed);

  assert.ok(tokens.includes('aria-sort='), `expected aria-sort= in ${JSON.stringify(tokens)}`);
  assert.ok(tokens.includes('Filters applied: 1 active'), `expected filter status in ${JSON.stringify(tokens)}`);
  assert.ok(tokens.includes('Page 2 of 3'), `expected page indicator in ${JSON.stringify(tokens)}`);
});

test('provider input carries a labeled salient token section derived by the shared function', () => {
  const input = buildGenerationInput({ specPath: complexSpec });
  const parsed = parseFlowSpec(input.validation.content);
  const tokens = collectSpecSalientTokens(parsed);

  assert.ok(tokens.length > 0, 'complex spec must derive at least one salient token');
  assert.ok(
    input.prompt.includes('Salient expected tokens'),
    'provider input must contain the labeled salient token section'
  );
  for (const token of tokens) {
    assert.ok(
      input.prompt.includes(`- ${token}`),
      `provider input must list salient token verbatim: ${token}`
    );
  }
  assert.deepEqual(input.ir.behavior.salientExpectedTokens, tokens);
});
