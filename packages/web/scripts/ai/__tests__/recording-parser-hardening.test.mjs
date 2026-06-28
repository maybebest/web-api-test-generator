import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  classifyRecorderSelector,
  listRecordingFiles,
  normalizeRecordingFile,
  recordingSha256,
  validateRecordingFile
} from '../lib/recording-parser.mjs';

function createWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-recording-hardening-'));
}

function writeNavigateRecording(workspace, navigateStep, extraSteps = []) {
  const recordingPath = path.join(workspace, 'flow.json');
  fs.writeFileSync(
    recordingPath,
    `${JSON.stringify({
      title: 'Navigate hardening',
      steps: [
        navigateStep,
        ...extraSteps,
        { type: 'waitForElement', selectors: [['aria/[role="heading"][name="Done"]']], operator: '>=', count: 1 }
      ]
    })}\n`
  );
  return recordingPath;
}

test('listRecordingFiles skips underscore-prefixed template recordings', () => {
  const workspace = createWorkspace();
  fs.writeFileSync(path.join(workspace, '_example.json'), '{}');
  fs.writeFileSync(path.join(workspace, 'checkout.json'), '{}');

  const files = listRecordingFiles(workspace);

  assert.deepEqual(
    files.map((file) => path.basename(file)),
    ['checkout.json']
  );
});

test('protocol-relative navigate URLs are rejected (allowlist bypass)', () => {
  const workspace = createWorkspace();
  const recordingPath = path.join(workspace, 'evil.json');
  fs.writeFileSync(
    recordingPath,
    JSON.stringify({
      title: 'Protocol relative',
      steps: [
        { type: 'navigate', url: '//evil.example.com/checkout' },
        { type: 'waitForElement', selectors: [['aria/[role="heading"][name="Checkout"]']], operator: '>=', count: 1 }
      ]
    })
  );

  const result = validateRecordingFile(recordingPath);

  assert.equal(result.valid, false);
  assert.match(result.issues.join('\n'), /Protocol-relative URL is not allowed/);
});

test('compound CSS containing a data-testid is not collapsed to a bare getByTestId', () => {
  const compound = classifyRecorderSelector('.wrapper [data-testid="submit"]');
  assert.equal(compound.usable, false);

  const standalone = classifyRecorderSelector('[data-testid="submit"]');
  assert.equal(standalone.locator, 'page.getByTestId("submit")');

  const tagQualified = classifyRecorderSelector('button[data-testid="submit"]');
  assert.equal(tagQualified.locator, 'page.getByTestId("submit")');
});

test('ARIA selector with a free-text accessible name keeps the name', () => {
  const result = classifyRecorderSelector('aria/Submit recording[role="button"]');

  assert.equal(result.type, 'role');
  assert.equal(result.locator, 'page.getByRole("button", { name: "Submit recording" })');
});

test('navigate URL with a 32-hex sid query value is rejected (original probe)', () => {
  const workspace = createWorkspace();
  const recordingPath = writeNavigateRecording(workspace, {
    type: 'navigate',
    url: 'http://localhost:3000/checkout?sid=0123456789abcdef0123456789abcdef'
  });

  const result = validateRecordingFile(recordingPath);

  assert.equal(result.valid, false);
  assert.match(
    result.issues.join('\n'),
    /RSTEP-001 navigate URL appears to contain a secret, credential, OTP, token, or session value: parameter name "sid"/
  );
});

test('navigate URL suspicious parameter names are rejected even with benign-looking values', () => {
  const workspace = createWorkspace();
  for (const parameter of ['token=abc', 'otp=12', 'auth=x', 'code=ok', 'bearer=1', 'session_id=2']) {
    const recordingPath = writeNavigateRecording(workspace, {
      type: 'navigate',
      url: `http://localhost:3000/page?${parameter}`
    });

    const result = validateRecordingFile(recordingPath);

    assert.equal(result.valid, false, `expected rejection for ?${parameter}`);
    assert.match(result.issues.join('\n'), /navigate URL appears to contain a secret/);
  }
});

test('navigate URL secret-shaped query and hash values are rejected', () => {
  const workspace = createWorkspace();
  const cases = [
    'http://localhost:3000/page?tracking=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c',
    'http://localhost:3000/page?confirm=123456',
    'http://localhost:3000/page#access_token=0123456789abcdef0123456789abcdef'
  ];

  for (const url of cases) {
    const result = validateRecordingFile(writeNavigateRecording(workspace, { type: 'navigate', url }));
    assert.equal(result.valid, false, `expected rejection for ${url}`);
    assert.match(result.issues.join('\n'), /navigate URL appears to contain a secret/);
  }
});

test('navigate URL with an SPA hash-route token parameter is rejected (original probe)', () => {
  const workspace = createWorkspace();
  const recordingPath = writeNavigateRecording(workspace, {
    type: 'navigate',
    url: 'http://localhost:3000/#/login?token=abcdef1234567890abcdef'
  });

  const result = validateRecordingFile(recordingPath);

  assert.equal(result.valid, false);
  assert.match(
    result.issues.join('\n'),
    /navigate URL appears to contain a secret.*parameter name "token" indicates a credential/
  );
});

test('navigate URL hash-route path before the fragment query is screened for secret shapes', () => {
  const workspace = createWorkspace();
  const recordingPath = writeNavigateRecording(workspace, {
    type: 'navigate',
    url: 'http://localhost:3000/#eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c?tab=details'
  });

  const result = validateRecordingFile(recordingPath);

  assert.equal(result.valid, false);
  assert.match(result.issues.join('\n'), /URL fragment looks like a credential or token/);
});

test('navigate URL with a benign SPA hash route is accepted', () => {
  const workspace = createWorkspace();
  for (const url of ['http://localhost:3000/#/section', 'http://localhost:3000/#/login?next=/dashboard&tab=details']) {
    const recordingPath = writeNavigateRecording(workspace, { type: 'navigate', url });

    const result = validateRecordingFile(recordingPath);

    assert.equal(result.valid, true, `${url}: ${result.issues.join('\n')}`);
  }
});

test('navigate URL with benign query, path-valued redirect, and route fragment is accepted', () => {
  const workspace = createWorkspace();
  const recordingPath = writeNavigateRecording(workspace, {
    type: 'navigate',
    url: 'http://localhost:3000/page?tab=details&redirect=/account/settings/profile/preferences#/checkout/confirmation/details'
  });

  const result = validateRecordingFile(recordingPath);

  assert.equal(result.valid, true, result.issues.join('\n'));
});

test('waitForElement operator outside the Chrome Recorder set is rejected', () => {
  const workspace = createWorkspace();
  const recordingPath = path.join(workspace, 'operator.json');
  fs.writeFileSync(
    recordingPath,
    `${JSON.stringify({
      title: 'Operator hardening',
      steps: [
        { type: 'navigate', url: 'http://localhost:3000/page' },
        { type: 'waitForElement', selectors: [['aria/[role="heading"][name="Done"]']], operator: '>', count: 1 }
      ]
    })}\n`
  );

  const result = validateRecordingFile(recordingPath);

  assert.equal(result.valid, false);
  assert.match(result.issues.join('\n'), /RSTEP-002 waitForElement operator must be one of >=, ==, <= \(got ">"\)/);
});

test('waitForElement count must be a non-negative integer', () => {
  const workspace = createWorkspace();
  for (const count of [-1, 2.5, 'abc']) {
    const recordingPath = path.join(workspace, 'count.json');
    fs.writeFileSync(
      recordingPath,
      `${JSON.stringify({
        title: 'Count hardening',
        steps: [
          { type: 'navigate', url: 'http://localhost:3000/page' },
          { type: 'waitForElement', selectors: [['aria/[role="heading"][name="Done"]']], operator: '>=', count }
        ]
      })}\n`
    );

    const result = validateRecordingFile(recordingPath);

    assert.equal(result.valid, false, `expected rejection for count ${JSON.stringify(count)}`);
    assert.match(result.issues.join('\n'), /waitForElement count must be a non-negative integer/);
  }

  const validPath = path.join(workspace, 'count-valid.json');
  fs.writeFileSync(
    validPath,
    `${JSON.stringify({
      title: 'Count hardening',
      steps: [
        { type: 'navigate', url: 'http://localhost:3000/page' },
        { type: 'waitForElement', selectors: [['aria/[role="heading"][name="Done"]']], operator: '==', count: 0 }
      ]
    })}\n`
  );

  const validResult = validateRecordingFile(validPath);
  assert.equal(validResult.valid, true, validResult.issues.join('\n'));
});

test('navigation assertedEvents surface in ignoredEvents without changing the behavior hash', () => {
  const workspace = createWorkspace();
  const steps = [
    { type: 'navigate', url: 'http://localhost:3000/page' },
    { type: 'waitForElement', selectors: [['aria/[role="heading"][name="Done"]']], operator: '>=', count: 1 }
  ];

  const plainPath = path.join(workspace, 'plain.json');
  fs.writeFileSync(plainPath, `${JSON.stringify({ title: 'Asserted events', steps })}\n`);

  const withEventsPath = path.join(workspace, 'with-events.json');
  const stepsWithEvents = structuredClone(steps);
  stepsWithEvents[0].assertedEvents = [
    { type: 'navigation', url: 'http://localhost:3000/page', title: 'Page title' }
  ];
  fs.writeFileSync(withEventsPath, `${JSON.stringify({ title: 'Asserted events', steps: stepsWithEvents })}\n`);

  const plain = normalizeRecordingFile(plainPath);
  const withEvents = normalizeRecordingFile(withEventsPath);

  assert.deepEqual(plain.ignoredEvents, []);
  assert.equal(withEvents.ignoredEvents.length, 1);
  assert.equal(withEvents.ignoredEvents[0].stepId, 'RSTEP-001');
  assert.equal(withEvents.ignoredEvents[0].type, 'navigation');
  assert.equal(withEvents.ignoredEvents[0].title, 'Page title');
  assert.match(withEvents.ignoredEvents[0].reason, /intentionally excluded from the behavior contract and hash/);

  assert.equal(recordingSha256(withEvents), recordingSha256(plain));
  assert.equal(withEvents.sha256, plain.sha256);
});
