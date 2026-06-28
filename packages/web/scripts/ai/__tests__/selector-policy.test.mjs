import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  buildSelectorCandidates,
  createDiscoveryElement,
  hasForbiddenAgentRef,
  hasForbiddenLocatorPattern,
  isStableTestId,
  selectBestLocator
} from '../lib/selector-policy.mjs';
import { reviewDomDiscoveryArtifact } from '../review-dom-discovery.mjs';

test('selector policy prefers stable data-testid over user-facing locator fallbacks', () => {
  const candidates = buildSelectorCandidates({
    role: 'button',
    accessibleName: 'Place order',
    text: 'Place order',
    testId: 'place-order'
  });

  assert.equal(candidates[0].locator, 'page.getByTestId("place-order")');
  assert.equal(selectBestLocator({ role: 'button', accessibleName: 'Place order', testId: 'place-order' }).type, 'testId');
  assert.equal(selectBestLocator({ role: 'button', accessibleName: 'Place order' }).type, 'role');
});

test('selector policy emits test id label and placeholder candidates without raw CSS', () => {
  const element = createDiscoveryElement(
    {
      role: 'textbox',
      accessibleName: 'Email',
      label: 'Email',
      placeholder: 'name@example.com',
      attributes: {
        'data-testid': 'email-input'
      }
    },
    0
  );

  const locators = element.candidateLocators.map((candidate) => candidate.locator);
  assert.deepEqual(locators, [
    'page.getByTestId("email-input")',
    'page.getByRole("textbox", { name: "Email" })',
    'page.getByLabel("Email")',
    'page.getByPlaceholder("name@example.com")'
  ]);
  assert.match(element.elementId, /^el-[a-f0-9]{10}$/);
});

test('selector policy ignores unstable test ids and falls back to role/name', () => {
  const candidates = buildSelectorCandidates({
    role: 'button',
    accessibleName: 'Save',
    testId: '8b7f3a2c9e10'
  });

  assert.equal(isStableTestId('save-button'), true);
  assert.equal(isStableTestId('8b7f3a2c9e10'), false);
  assert.equal(candidates[0].locator, 'page.getByRole("button", { name: "Save" })');
  assert.equal(candidates.some((candidate) => candidate.type === 'testId'), false);
});

test('selector policy detects forbidden agent-browser refs and locator patterns', () => {
  assert.equal(hasForbiddenAgentRef('click @e12'), true);
  assert.equal(hasForbiddenLocatorPattern('page.locator("xpath=//button")'), true);
  assert.equal(hasForbiddenLocatorPattern('page.locator("div:nth-child(2)")'), true);
});

test('DOM discovery reviewer rejects persisted agent-browser refs', async () => {
  const artifactPath = new URL('./tmp-dom-discovery-artifact.json', import.meta.url);
  const artifact = {
    specPath: 'specs/example-flow.md',
    specSha256: 'stale',
    source: 'agent-browser',
    selectorOwnership: 'framework',
    elements: [
      {
        elementId: 'el-bad',
        role: 'button',
        accessibleName: 'Submit',
        candidateLocators: [{ type: 'role', locator: 'page.getByRole("button", { name: "@e1" })' }]
      }
    ]
  };

  await fs.writeFile(artifactPath, `${JSON.stringify(artifact)}\n`);
  const result = reviewDomDiscoveryArtifact(artifactPath.pathname);

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /@e ref|spec hash is stale/);

  await fs.rm(artifactPath);
});

test('generated guidance documents the locator priority order', async () => {
  const prompt = await fs.readFile(new URL('../../../ai/prompts/02-generate-test.md', import.meta.url), 'utf8');
  const policy = await fs.readFile(new URL('../../../ai/policies/locator-policy.md', import.meta.url), 'utf8');
  const taskScript = await fs.readFile(new URL('../create-generation-task.mjs', import.meta.url), 'utf8');

  for (const content of [prompt, policy, taskScript]) {
    const priority = [
      content.indexOf('page.getByTestId'),
      content.indexOf('page.getByRole'),
      content.indexOf('page.getByLabel'),
      content.indexOf('page.getByPlaceholder'),
      content.indexOf('page.getByText'),
      content.indexOf('locator-policy:exception')
    ];

    assert.equal(priority.every((index) => index >= 0), true);
    assert.deepEqual(priority, [...priority].sort((left, right) => left - right));
  }
});
