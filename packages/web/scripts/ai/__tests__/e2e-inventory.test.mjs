import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildInventory } from '../generate-e2e-inventory.mjs';
import { listSpecFiles } from '../lib/spec-parser.mjs';

const DEV_URL = 'https://www.dev.pollen.js-devops.co.uk/planning/nectar-ai';
const SPEC_DIRECTORY = fileURLToPath(new URL('../../../specs', import.meta.url));

test('inventory covers every supported source format and merges strict source ids', () => {
  const inventory = buildInventory({ baseUrl: DEV_URL, authVerified: true });

  assert.equal(inventory.scope.sourceCounts['specs/test-cases.yaml'], 200);
  assert.equal(inventory.scope.sourceCounts['specs/test-cases-skus-2.yaml'], 138);
  assert.equal(inventory.scope.sourceCounts['specs/secondary-space/test-cases.yaml'], 24);
  assert.equal(inventory.scope.sourceCounts['specs/secondary-space/test-cases-feature-flag.yaml'], 1);
  assert.equal(inventory.scope.sourceCounts['specs/secondary-space/critical-user-journeys.yaml'], 8);
  assert.equal(inventory.scope.sourceCounts['specs/sains/nectar-ai-test-cases-by-module.md'], 219);
  assert.equal(inventory.scope.sourceCounts['specs/sains/sains-project-qa-notes.md'], 80);
  assert.equal(inventory.scope.strictFlowCount, 27);
  assert.equal(inventory.scope.formalDataCaseCount, 196);
  assert.equal(inventory.scope.formalNegativeCaseCount, 42);
  assert.equal(inventory.scope.acceptanceCriteriaCount, 143);
  assert.deepEqual(inventory.missingFlowSpecs, []);

  const channelCase = inventory.cases.find((candidate) => candidate.id === 'TC-CHAN-001');
  assert.ok(channelCase);
  assert.ok(channelCase.sourceReferences.some((source) => source.path.endsWith('test-cases-skus-2.yaml')));
  assert.ok(channelCase.formalMappings.some((mapping) => mapping.flowId === 'FLOW-SKU-CHAN'));
  assert.equal(inventory.cases.filter((candidate) => candidate.id === 'TC-CHAN-001').length, 1);

  const journey = inventory.cases.find((candidate) => candidate.id === 'JOURNEY-001');
  assert.equal(journey?.kind, 'composite-journey');
  assert.ok(journey?.composedCaseIds.includes('CHANNELM-E2E-001'));
  assert.equal(journey?.automation.status, 'duplicate-or-composite');
});

test('inventory distinguishes present code from safe executable automation', () => {
  const inventory = buildInventory({ baseUrl: DEV_URL, authVerified: true });
  const maxCase = inventory.cases.find((candidate) => candidate.id === 'TC-MAX-001');
  assert.ok(maxCase);
  assert.equal(maxCase.implementation.status, 'implemented-contract-bound');
  assert.equal(maxCase.automation.status, 'blocked-test-data');
  assert.ok(maxCase.automation.missingCodes.includes('CHANNEL_CONFIG_ADMIN'));

  const productionCase = inventory.cases.find((candidate) => candidate.id === 'SECONDAR-E2E-001');
  assert.ok(productionCase);
  assert.equal(productionCase.automation.status, 'blocked-production-or-integration-policy');
  assert.ok(productionCase.automation.missingCodes.includes('PRODUCTION_AUTHORITY'));

  const directAccess = inventory.cases.find((candidate) => candidate.id === 'AUTH-001');
  assert.ok(directAccess);
  assert.ok(!directAccess.automation.missingCodes.includes('BASE_URL'));
  assert.ok(!directAccess.automation.missingCodes.includes('UI_AUTH'));
});

test('inventory projects legacy source notes into machine-policy terminology', () => {
  const inventory = buildInventory({ baseUrl: DEV_URL, authVerified: true });
  const serialized = JSON.stringify(inventory);

  assert.doesNotMatch(
    serialized,
    /pending-review|human review|human sign-?off|manual review|MUTATION_APPROVAL|manual-release-or-integration/i
  );
  assert.match(serialized, /MUTATION_POLICY/);
  assert.match(serialized, /blocked-production-or-integration-policy/);
});

test('strict flow discovery ignores narrative Markdown sources', () => {
  const files = listSpecFiles(SPEC_DIRECTORY);
  assert.equal(files.length, 27);
  assert.ok(files.some((file) => file.endsWith('sains/entry-and-persistence.md')));
  assert.ok(files.some((file) => file.endsWith('sains/entry-shell-responsive-accessibility.md')));
  assert.ok(files.every((file) => !file.includes('nectar-ai-test-cases-by-module.md')));
  assert.ok(files.every((file) => !file.includes('sains-project-qa-notes.md')));
  assert.ok(files.every((file) => !file.includes('nectar-ai-knowledge.md')));
});
