import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  classifyRecorderSelector,
  normalizeRecordingFile,
  recordingSha256,
  validateRecordingFile
} from '../lib/recording-parser.mjs';
import { checkRecordingDrift } from '../check-recording-drift.mjs';
import { reviewRecordedTest } from '../review-recorded-test.mjs';

test('recording validator accepts and normalizes a Chrome Recorder JSON flow', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);

  const result = validateRecordingFile(recordingPath);

  assert.equal(result.valid, true, result.issues.join('\n'));
  assert.equal(result.normalized.steps[0].id, 'RSTEP-001');
  assert.equal(result.normalized.assertions[0].id, 'ASSERT-001');
  assert.equal(result.normalized.steps[0].urlForTest, '/recorded');
  assert.match(result.normalized.sha256, /^[a-f0-9]{64}$/);
});

test('recording validator rejects malformed steps unsupported types and missing assertions', () => {
  const workspace = createWorkspace();
  const recordingPath = path.join(workspace, 'bad.json');
  fs.writeFileSync(
    recordingPath,
    `${JSON.stringify({
      title: 'Bad recording',
      steps: [
        {
          type: 'navigate',
          url: 'http://localhost:3000/bad'
        },
        {
          type: 'dragAndDrop',
          selectors: [['aria/[role="button"][name="Drag"]']]
        }
      ]
    })}\n`
  );

  const result = validateRecordingFile(recordingPath);

  assert.equal(result.valid, false);
  assert.match(result.issues.join('\n'), /Unsupported recording step type/);
  assert.match(result.issues.join('\n'), /waitForElement/);
});

test('recording validator rejects recordings with only forbidden selectors', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace, {
    steps: [
      {
        type: 'navigate',
        url: 'http://localhost:3000/recorded'
      },
      {
        type: 'waitForElement',
        selectors: [['xpath=//main/div:nth-child(2)']],
        operator: '>=',
        count: 1
      }
    ]
  });

  const result = validateRecordingFile(recordingPath);

  assert.equal(result.valid, false);
  assert.match(result.issues.join('\n'), /no usable selector|XPath/);
});

test('recording selector classification translates role name and test id selectors', () => {
  const role = classifyRecorderSelector('aria/[role="button"][name="Submit"]');
  const testId = classifyRecorderSelector('pierce/[data-testid="submit-recording"]');

  assert.equal(role.locator, 'page.getByRole("button", { name: "Submit" })');
  assert.equal(testId.locator, 'page.getByTestId("submit-recording")');
  assert.equal(testId.score > role.score, true);
});

test('recording normalizer prefers stable data-testid when multiple selectors exist', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace, {
    steps: [
      {
        type: 'navigate',
        url: 'http://localhost:3000/recorded'
      },
      {
        type: 'change',
        selectors: [['aria/[role="textbox"][name="Email"]', 'pierce/[data-testid="email-input"]']],
        value: 'recorded@example.com'
      },
      {
        type: 'waitForElement',
        selectors: [['aria/[role="heading"][name="Done"]', 'pierce/[data-testid="done-heading"]']],
        operator: '>=',
        count: 1
      }
    ]
  });

  const normalized = normalizeRecordingFile(recordingPath);

  assert.equal(normalized.steps[1].bestLocator, 'page.getByTestId("email-input")');
  assert.equal(normalized.steps[2].bestLocator, 'page.getByTestId("done-heading")');
});

test('recorded test reviewer accepts a generated test that covers recording steps and assertions', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);
  const normalized = normalizeRecordingFile(recordingPath);
  const testPath = writeRecordedTest(workspace, recordingPath, normalized.sha256);

  const result = reviewRecordedTest({ recordingPath, testPath });

  assert.equal(result.passed, true, result.issues.join('\n'));
});

test('recorded test reviewer rejects missing assertion coverage', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);
  const normalized = normalizeRecordingFile(recordingPath);
  const testPath = writeRecordedTest(workspace, recordingPath, normalized.sha256, {
    assertionTitle: 'RSTEP-003: missing assertion id'
  });

  const result = reviewRecordedTest({ recordingPath, testPath });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /ASSERT-001/);
});

test('recording drift checker reports stale hashes', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);
  const testDir = path.join(workspace, 'recorded');
  fs.mkdirSync(testDir, { recursive: true });
  writeRecordedTest(testDir, recordingPath, '0'.repeat(64), { fileName: 'stale.spec.ts' });

  const result = checkRecordingDrift({ testDir });

  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0], /recording drift detected/);
});

test('recording behavior hash changes when user actions change', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);
  const before = recordingSha256(recordingPath);
  const recording = JSON.parse(fs.readFileSync(recordingPath, 'utf8'));
  recording.steps[1].value = 'changed@example.com';
  fs.writeFileSync(recordingPath, `${JSON.stringify(recording, null, 2)}\n`);

  assert.notEqual(recordingSha256(recordingPath), before);
});

function createWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'recording-framework-'));
}

function writeRecording(workspace, overrides = {}) {
  const recordingPath = path.join(workspace, 'recorded-flow.json');
  const recording = {
    title: 'Recorded flow',
    steps: [
      {
        type: 'navigate',
        url: 'http://localhost:3000/recorded'
      },
      {
        type: 'change',
        selectors: [['aria/[role="textbox"][name="Email"]']],
        value: 'recorded@example.com'
      },
      {
        type: 'waitForElement',
        selectors: [['aria/[role="heading"][name="Done"]']],
        operator: '>=',
        count: 1
      }
    ],
    ...overrides
  };

  fs.writeFileSync(recordingPath, `${JSON.stringify(recording, null, 2)}\n`);
  return recordingPath;
}

function writeRecordedTest(workspace, recordingPath, hash, options = {}) {
  const fileName = options.fileName ?? 'recorded-flow.spec.ts';
  const testPath = path.join(workspace, fileName);
  const assertionTitle = options.assertionTitle ?? 'RSTEP-003 ASSERT-001: verify done heading';
  fs.writeFileSync(
    testPath,
    `/* recording: ${recordingPath} title:Recorded flow sha256:${hash} */
import { test, expect } from '../../fixtures/test';

const email = 'recorded@example.com';

test('recorded flow', async ({ page }) => {
  await test.step('RSTEP-001: navigate', async () => {
    await page.goto('/recorded');
    await expect(page).toHaveURL(/\\/recorded/);
  });
  await test.step('RSTEP-002: fill email', async () => {
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await expect(page.getByRole('textbox', { name: 'Email' })).toHaveValue(email);
  });
  await test.step('${assertionTitle}', async () => {
    await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible();
  });
});
`
  );
  return testPath;
}
