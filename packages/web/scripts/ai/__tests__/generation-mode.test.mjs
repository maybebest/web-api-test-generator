import assert from 'node:assert/strict';
import test from 'node:test';

import { createManifest, createTaskContent, parseArgs as parseGenerationArgs } from '../create-generation-task.mjs';
import { parseArgs as parseGateArgs, projectPlanForSpec } from '../generated-test-gate.mjs';
import { resolveGenerationMode, specGenerationMode } from '../lib/spec-parser.mjs';
import { validateSpecFile } from '../validate-flow-spec.mjs';

test('generation task leaves mode unset so spec metadata can win, resolving to single by default', () => {
  const args = parseGenerationArgs(['specs/example-flow.md']);

  assert.equal(args.mode, undefined);
  assert.equal(resolveGenerationMode({ cliMode: args.mode, specMode: undefined }), 'single');
});

test('spec Generation Mode metadata wins when no --mode flag is passed', () => {
  assert.equal(specGenerationMode({ 'Generation Mode': 'Suite' }), 'suite');
  assert.equal(specGenerationMode({}), undefined);
  assert.equal(resolveGenerationMode({ cliMode: undefined, specMode: 'suite' }), 'suite');
});

test('a --mode flag that contradicts spec Generation Mode is a hard error', () => {
  assert.throws(
    () => resolveGenerationMode({ cliMode: 'single', specMode: 'suite' }),
    /--mode single conflicts with spec metadata Generation Mode "suite"/
  );
  // Agreement is not a conflict.
  assert.equal(resolveGenerationMode({ cliMode: 'suite', specMode: 'suite' }), 'suite');
});

test('resolveGenerationMode rejects bogus cli and spec mode values', () => {
  assert.throws(() => resolveGenerationMode({ cliMode: 'parallel' }), /Unsupported generation mode: parallel/);
  assert.throws(
    () => resolveGenerationMode({ specMode: 'multi' }),
    /Spec metadata "Generation Mode" must be "single" or "suite"/
  );
});

test('generation task accepts suite mode', () => {
  const args = parseGenerationArgs(['specs/example-flow.md', '--mode', 'suite']);

  assert.equal(args.mode, 'suite');
});

test('generation manifest includes generation mode', () => {
  const manifest = createManifest({
    specPath: 'specs/example-flow.md',
    sha256: 'abc123',
    flowId: 'FLOW-EXAMPLE-001',
    specVersion: '1.0.0',
    domArtifactPath: undefined,
    validation: {
      acceptanceCriteria: ['AC-001'],
      dataCasesJson: [{ caseId: 'DC-001' }]
    },
    generationMode: 'single',
    createdAt: '2026-05-12T00:00:00.000Z'
  });

  assert.equal(manifest.generationMode, 'single');
});

test('generation task contract wording is mode-resolution-accurate', () => {
  const specPath = 'specs/media-plan-save-via-nectar-ai.md';
  const validation = validateSpecFile(specPath);
  assert.equal(validation.valid, true, validation.issues.join('\n'));

  for (const generationMode of ['single', 'suite']) {
    const content = createTaskContent({
      specPath,
      targetTestFile: validation.metadata['Target Test File'],
      validation,
      domArtifactPath: undefined,
      generationMode
    });

    assert.match(
      content,
      new RegExp(
        `Generation mode resolved from spec metadata/--mode: \`${generationMode}\`; generate a suite only when the resolved mode is \`suite\`\\.`
      )
    );
    // The stale "only when explicitly requested" wording contradicted the
    // metadata-driven mode resolution. Only the embedded original spec text
    // (below "## Original Flow Spec") may still carry legacy phrasing.
    const contractSection = content.split('## Original Flow Spec')[0];
    assert.doesNotMatch(contractSection, /Generate a suite only when explicitly requested/);
  }
});

test('gate defaults to spec-resolved single mode and Chromium only', () => {
  const args = parseGateArgs(['--spec', 'specs/example-flow.md', '--test', 'tests/regression/example-flow.spec.ts']);
  const plan = projectPlanForSpec({ 'Test Type': 'regression', Auth: 'none' });

  assert.equal(args.mode, undefined);
  assert.equal(resolveGenerationMode({ cliMode: args.mode, specMode: undefined }), 'single');
  assert.deepEqual(plan.map((entry) => entry.project), ['chromium']);
});

test('gate accepts explicit suite mode', () => {
  const args = parseGateArgs([
    '--spec',
    'specs/example-flow.md',
    '--test',
    'tests/regression/example-flow.spec.ts',
    '--mode',
    'suite'
  ]);

  assert.equal(args.mode, 'suite');
});

test('gate uses all configured regression projects only when requested', () => {
  const plan = projectPlanForSpec(
    { 'Test Type': 'regression', Auth: 'none' },
    { allProjects: true }
  );

  assert.deepEqual(plan.map((entry) => entry.project), ['chromium', 'firefox', 'webkit']);
});

test('gate uses an explicit project list when requested', () => {
  const args = parseGateArgs([
    '--spec',
    'specs/example-flow.md',
    '--test',
    'tests/regression/example-flow.spec.ts',
    '--projects',
    'chromium,webkit'
  ]);
  const plan = projectPlanForSpec(
    { 'Test Type': 'regression', Auth: 'none' },
    { projects: args.projects }
  );

  assert.deepEqual(plan.map((entry) => entry.project), ['chromium', 'webkit']);
});
