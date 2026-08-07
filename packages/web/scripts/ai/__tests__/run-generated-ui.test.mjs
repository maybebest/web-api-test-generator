import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { collectGeneratedUiPlan } from '../run-generated-ui.mjs';
import { specSha256 } from '../lib/spec-parser.mjs';

test('generated UI runner selects delivered generated specs and skips pending-generation ones', () => {
  withGeneratedUiFixtures(({ generatedSpecPath, generatedTestPath, pendingSpecPath }) => {
    const plan = collectGeneratedUiPlan({
      specPaths: [generatedSpecPath, pendingSpecPath]
    });

    assert.deepEqual(plan.entries, [
      {
        specPath: generatedSpecPath,
        flowId: 'FLOW-RUN-GENERATED-001',
        testPath: generatedTestPath
      }
    ]);
    assert.deepEqual(plan.issues, []);
    assert.match(plan.pending.join('\n'), /pending-generation/);
  });
});

test('generated UI runner skips a pending-generation spec requested explicitly', () => {
  withGeneratedUiFixtures(({ pendingSpecPath }) => {
    const plan = collectGeneratedUiPlan({
      specPaths: [pendingSpecPath],
      project: 'chromium'
    });

    assert.deepEqual(plan.entries, []);
    assert.deepEqual(plan.issues, []);
    assert.match(plan.pending.join('\n'), /awaiting live generation/);
  });
});

test('generated UI runner threads the project filter into the playwright args', () => {
  withGeneratedUiFixtures(({ pendingSpecPath }) => {
    const plan = collectGeneratedUiPlan({
      specPaths: [pendingSpecPath],
      project: 'chromium'
    });

    assert.deepEqual(plan.issues, []);
    // The spec is pending-generation, so no test paths are appended, but the
    // --project filter is still threaded into the Playwright UI args.
    assert.deepEqual(plan.entries, []);
    assert.deepEqual(plan.args, ['playwright', 'test', '--ui', '--project=chromium']);
  });
});

function withGeneratedUiFixtures(assertions) {
  const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const specDir = path.join('tests', '.tmp', `run-generated-ui-${runId}`);
  const generatedTestDir = path.join('tests', 'regression', `.tmp-run-generated-ui-${runId}`);
  const generatedSpecPath = path.join(specDir, 'generated-flow.md');
  const pendingSpecPath = path.join(specDir, 'pending-flow.md');
  const generatedTestPath = path.join(generatedTestDir, 'generated-flow.authenticated.spec.ts');

  fs.mkdirSync(specDir, { recursive: true });
  fs.mkdirSync(generatedTestDir, { recursive: true });

  try {
    fs.writeFileSync(
      generatedSpecPath,
      buildFlowSpec({
        flowId: 'FLOW-RUN-GENERATED-001',
        flowName: 'Generated UI runner generated fixture',
        generationStatus: 'generated',
        targetTestFile: generatedTestPath
      })
    );
    fs.writeFileSync(
      pendingSpecPath,
      buildFlowSpec({
        flowId: 'FLOW-RUN-GENERATED-002',
        flowName: 'Generated UI runner pending fixture',
        generationStatus: 'pending-generation',
        targetTestFile: path.join(generatedTestDir, 'pending-flow.authenticated.spec.ts')
      })
    );
    fs.writeFileSync(
      generatedTestPath,
      [
        `/* spec: ${generatedSpecPath} version:1.0.0 sha256:${specSha256(generatedSpecPath)} */`,
        "import { test } from '@playwright/test';",
        '',
        "test('fixture', async () => {});",
        ''
      ].join('\n')
    );

    assertions({ generatedSpecPath, generatedTestPath, pendingSpecPath });
  } finally {
    fs.rmSync(specDir, { recursive: true, force: true });
    fs.rmSync(generatedTestDir, { recursive: true, force: true });
  }
}

function buildFlowSpec({ flowId, flowName, generationStatus, targetTestFile }) {
  let content = `# Flow: ${flowName}

## Metadata

| Field | Value |
|---|---|
| Flow ID | ${flowId} |
| Spec Version | 1.0.0 |
| Owner | aqa-team@example.com |
| Priority | P2 |
| Test Type | regression |
| Auth | required |
| Target Test File | ${targetTestFile} |
| Base Path | /planning |
| Tags | @generated @regression @fixture @authenticated |
| Generation Source | test-fixture |
| Generation Status | ${generationStatus} |

## User Story

As an automation engineer,
I want a deterministic generated UI runner fixture,
So that runner selection can be tested without depending on repository specs.

## Preconditions

- Test fixture data is local and deterministic.

## Out-of-scope

- Live browser execution is out of scope.

## Stability Requirements

| Field | Value |
|---|---|
| Parallel Safe | yes |
| Data Isolation | per-test |
| Allowed Retries | 0 |

## Variants

| Locale | Role | Plan |
|---|---|---|
| en-GB | automation engineer | fixture |

## Includes

- none

## Business Rules

| Rule ID | Rule | Formula | Blocking Behavior |
|---|---|---|---|
| RULE-001 | The fixture action reaches the expected state | expectedState = visible | Missing visible state blocks the flow |

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
| DC-001 | fixtureInput=primary | expectedState=visible | Primary fixture case |

## Data Cases as JSON

\`\`\`json
[
  {
    "caseId": "DC-001",
    "inputs": {
      "fixtureInput": "primary"
    },
    "expected": {
      "expectedState": "visible"
    },
    "notes": "Primary fixture case"
  }
]
\`\`\`

## Test Data

| Name | Value | Notes |
|---|---|---|
| fixtureInput | primary | Local deterministic value |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | The local fixture does not use mocked network traffic | [] |

## Mocks as JSON

\`\`\`json
[]
\`\`\`

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---|---|---|---|---|---|---|
| 1 | AC-001 | Open fixture page | Fixture route | /planning | Fixture page is visible | Assert fixture page visible |
| 2 | AC-002 | Submit fixture input | Fixture input | primary | Fixture result is visible | Assert fixture result visible |
| 3 | AC-001, AC-002 | Confirm fixture result | Fixture result | expectedState=visible | Fixture result remains visible | Assert final state visible |

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | Submit an empty fixture input | Submit remains blocked |

## Acceptance Criteria

- AC-001: Fixture page can be opened.
- AC-002: Fixture input produces a visible result.

## Locator Hints

| Element | Preferred Locator | Fallback Locator | Notes |
|---|---|---|---|
| Fixture page | getByTestId('fixture-page') | getByRole('main') | Stable fixture locator |

## Generated Test Requirements

- Must not silently skip.
- Must assert the mapped acceptance criteria.

## Notes

- This spec is generated only inside unit tests and is deleted after each run.
`;
  content = content.replace('__BEHAVIORAL_HASH__', specSha256(content));
  return content;
}
