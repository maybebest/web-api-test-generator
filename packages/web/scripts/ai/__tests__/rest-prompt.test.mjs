import assert from 'node:assert/strict';
import test from 'node:test';

import { compactRestGenerationTask } from '../lib/rest-prompt.mjs';

const task = `# Codex Generation Task: FLOW-CHECKOUT-001

## Target

- Target test file: \`tests/regression/checkout.spec.ts\`
- Generation mode: \`single\`
- AC IDs to cover: \`AC-001\`, \`AC-002\`

## Contract

The Markdown spec is the contract.
The generated Playwright test is the implementation.

## Required Test Style

- Add this exact header comment near the top of the test:

\`\`\`ts
/* spec: specs/checkout.md version:1.2.0 sha256:${'a'.repeat(64)} */
\`\`\`

- Import from fixtures/test.
- Use test.step.
- Declare the spec metadata Tags exactly on the describe block or test via the Playwright tag option: \`{ tag: ['@generated', '@regression'] }\`.
- Default generation mode is single-test mode.
- Generate exactly one primary \`test(...)\` block for the requested scenario/business outcome, plus optionally one test per spec Negative Case.
- The primary test must declare a \`covered-ac-ids\` annotation for AC-001 AC-002.
- Every \`test.step\` title in the primary test must name the AC ID(s) it exercises.
- Optional NEG tests must contain their \`NEG-###\` ID in every step title.
- The final assertion step must name the primary \`AC-###\` or \`NEG-###\` ID.

## Locator Policy Summary

- Use framework-scored candidates.

## DOM and Repository Context

Context fingerprint: sha256:${'b'.repeat(64)}

\`\`\`json
{"dom":{"artifactPath":".ai-runs/dom-discovery/selector-candidates.json","elements":[{"candidateLocators":[{"locator":"getByRole('button', { name: 'Pay' })"}]}]},"fixtures":{"importPath":"../../fixtures/test"}}
\`\`\`

## Security Policy Summary

- Do not use production credentials.

## Test Quality Gate Summary

- Run every quality gate.

## Exact Implementation Instructions

1. Run npm commands that a REST model cannot execute.

## Forbidden Patterns

- XPath

## Original Flow Spec

# Flow: Checkout

## Metadata

| Field | Value |
|---|---|
| Flow ID | FLOW-CHECKOUT-001 |

## Acceptance Criteria

- AC-001: Checkout opens.
- AC-002: Confirmation is shown.
`;

test('REST task compaction keeps dynamic contract data and removes repeated policy boilerplate', () => {
  const compacted = compactRestGenerationTask(task);

  assert.match(compacted, /# Codex Generation Task: FLOW-CHECKOUT-001/);
  assert.match(compacted, /tests\/regression\/checkout\.spec\.ts/);
  assert.match(compacted, /AC-001.*,.*AC-002/);
  assert.match(compacted, /selector-candidates\.json/);
  assert.match(compacted, /getByRole\('button'/);
  assert.match(compacted, /Context fingerprint: sha256:b{64}/);
  assert.match(compacted, /\.\.\/\.\.\/fixtures\/test/);
  assert.match(compacted, /## Dynamic Generation Requirements/);
  assert.match(compacted, /spec: specs\/checkout\.md version:1\.2\.0 sha256:/);
  assert.match(compacted, /Import from `?fixtures\/test`?/);
  assert.match(compacted, /@generated.*@regression/);
  assert.match(compacted, /covered-ac-ids/);
  assert.match(compacted, /Optional NEG tests/);
  assert.match(compacted, /## Original Flow Spec[\s\S]*## Metadata[\s\S]*## Acceptance Criteria/);
  assert.doesNotMatch(compacted, /## Contract/);
  assert.doesNotMatch(compacted, /## Required Test Style/);
  assert.doesNotMatch(compacted, /## Exact Implementation Instructions/);
  assert.doesNotMatch(compacted, /## Test Quality Gate Summary/);
  assert.ok(compacted.length < task.length * 0.8, `expected meaningful compaction: ${compacted.length}/${task.length}`);
});

test('REST task compaction fails open for ad-hoc and recording prompts', () => {
  const adHoc = 'Generate one test for GET /health.';

  assert.equal(compactRestGenerationTask(adHoc), adHoc);
});

test('REST compaction extracts canonical recording IR instead of sending the full agent playbook', () => {
  const recording = `# Codex Recording Generation Task: checkout

## Target

- target

## Required Test Style

- lots of repeated policy

## Canonical Recording Generation IR

# Playwright Recording Generation Input

{"schemaVersion":"recording-generation-ir/v1","target":{"testFile":"tests/recorded/checkout.spec.ts"}}

## Commands To Run

npm run expensive-command
`;
  const compacted = compactRestGenerationTask(recording);

  assert.match(compacted, /recording-generation-ir\/v1/);
  assert.match(compacted, /tests\/recorded\/checkout\.spec\.ts/);
  assert.doesNotMatch(compacted, /Required Test Style|repeated policy|Commands To Run|expensive-command/);
  assert.ok(compacted.length < recording.length * 0.65);
});
