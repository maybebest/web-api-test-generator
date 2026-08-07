import assert from 'node:assert/strict';
import test from 'node:test';

import { createTaskContent } from '../create-generation-task.mjs';
import {
  compileGenerationIr,
  renderGenerationIr
} from '../lib/generation-ir.mjs';
import { buildGenerationInput } from '../lib/generation-input.mjs';
import {
  GENERATION_POLICY_VERSION,
  PLAYWRIGHT_GENERATION_POLICY
} from '../lib/generation-policy.mjs';
import {
  listSpecFiles,
  resolveGenerationMode,
  specGenerationMode,
  specSha256
} from '../lib/spec-parser.mjs';
import { compactRestGenerationTask } from '../lib/rest-prompt.mjs';
import { validateSpecFile } from '../validate-flow-spec.mjs';

const representativeSpec = 'specs/special-preconditions/media-planner-minimum-campaign-duration.md';

function compileSpec(specPath) {
  const validation = validateSpecFile(specPath);
  assert.equal(validation.valid, true, validation.issues.join('\n'));
  const generationMode = resolveGenerationMode({ specMode: specGenerationMode(validation.metadata) });
  const targetTestFile = validation.metadata['Target Test File'];
  return {
    validation,
    generationMode,
    targetTestFile,
    ir: compileGenerationIr(validation, {
      specPath,
      targetTestFile,
      generationMode,
      specSha256: specSha256(specPath)
    })
  };
}

test('canonical generation IR preserves behavioral semantics without duplicate human data tables', () => {
  const { validation, ir } = compileSpec(representativeSpec);
  const rendered = renderGenerationIr(ir);

  assert.equal(ir.schemaVersion, 'playwright-generation-ir/v1');
  assert.equal(ir.policyVersion, GENERATION_POLICY_VERSION);
  assert.equal(ir.target.flowId, validation.metadata['Flow ID']);
  assert.equal(ir.target.mode, 'suite');
  assert.equal(ir.target.specSha256, specSha256(representativeSpec));
  assert.match(ir.target.exactHeader, /^\/\* spec: .* sha256:[a-f0-9]{64} \*\/$/);
  assert.match(ir.behavior.userStory, /media planner/i);
  assert.match(ir.behavior.preconditions, /authenticated Playwright storage state/i);
  assert.deepEqual(ir.behavior.variants, validation.variants.rows);
  assert.deepEqual(ir.behavior.businessRules, validation.businessRules.rows);
  assert.deepEqual(ir.behavior.includes, []);
  assert.deepEqual(ir.behavior.dataCases, validation.dataCasesJson);
  assert.deepEqual(ir.behavior.mocks, validation.mocksJson);
  assert.deepEqual(ir.behavior.steps, validation.flowSteps);
  assert.deepEqual(ir.behavior.negativeCases, validation.negativeCases);
  assert.deepEqual(ir.behavior.locatorHints, validation.locatorHints);
  assert.match(ir.behavior.acceptanceCriteria, /AC-001/);
  assert.match(ir.behavior.generatedTestRequirements, /compute end dates/i);
  assert.doesNotMatch(ir.behavior.generatedTestRequirements, /Must use Page Objects|Must use test\.step/i);
  assert.equal(ir.behavior.testData[0].Name, 'advertiser');
  assert.doesNotMatch(rendered, /"dataCasesTable"|"Data Cases"/);
  assert.match(rendered, /DC-001/);
});

test('canonical IR is at least 25% smaller than legacy compacted tasks across the valid spec corpus', () => {
  let legacyChars = 0;
  let irChars = 0;
  let boundedPromptChars = 0;
  let validSpecs = 0;

  for (const specPath of listSpecFiles('specs')) {
    const validation = validateSpecFile(specPath);
    if (!validation.valid) continue;
    validSpecs += 1;
    const generationMode = resolveGenerationMode({ specMode: specGenerationMode(validation.metadata) });
    const targetTestFile = validation.metadata['Target Test File'];
    const legacyTask = createTaskContent({
      specPath,
      targetTestFile,
      validation,
      generationMode
    });
    legacyChars += compactRestGenerationTask(legacyTask).length;
    irChars += renderGenerationIr(compileGenerationIr(validation, {
      specPath,
      targetTestFile,
      generationMode,
      specSha256: specSha256(specPath)
    })).length;
    boundedPromptChars += buildGenerationInput({
      specPath,
      targetTestFile,
      mode: generationMode
    }).prompt.length;
  }

  assert.ok(validSpecs > 0, 'expected the repository to contain at least one valid flow spec');
  assert.ok(
    irChars <= legacyChars * 0.75,
    `canonical IR must save >=25% characters: legacy=${legacyChars}, ir=${irChars}, saved=${((1 - irChars / legacyChars) * 100).toFixed(1)}%`
  );
  assert.ok(
    boundedPromptChars <= legacyChars * 0.9,
    `bounded provider prompts must save >=10% characters after repository/DOM context: legacy=${legacyChars}, bounded=${boundedPromptChars}, saved=${((1 - boundedPromptChars / legacyChars) * 100).toFixed(1)}%`
  );
});

test('stable policy retains every mandatory generation rule removed from dynamic prompts', () => {
  assert.match(GENERATION_POLICY_VERSION, /^playwright-generation-policy\/v\d+$/);
  const requiredPhrases = [
    'fixtures/test',
    'test.step',
    'Page Objects',
    'final assertion',
    'covered-ac-ids',
    'Data Cases',
    'Mocks',
    'page.waitForTimeout',
    'XPath',
    'test.only',
    'production credentials',
    'locator-policy:exception',
    'Never invent'
  ];
  for (const phrase of requiredPhrases) {
    assert.ok(PLAYWRIGHT_GENERATION_POLICY.includes(phrase), `stable policy is missing: ${phrase}`);
  }
});

test('canonical IR refuses neutral high-entropy spec values before provider input is rendered', () => {
  const { validation, generationMode, targetTestFile } = compileSpec(representativeSpec);
  const unsafeValidation = structuredClone(validation);
  unsafeValidation.dataCasesJson[0].value = 'aB3dE5fG7hI9jK1lM2nO3pQ4';

  assert.throws(
    () => compileGenerationIr(unsafeValidation, {
      specPath: representativeSpec,
      targetTestFile,
      generationMode,
      specSha256: specSha256(representativeSpec)
    }),
    /secret-bearing.*generation IR/i
  );
});
