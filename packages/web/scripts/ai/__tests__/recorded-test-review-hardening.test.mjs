import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { normalizeRecordingFile } from '../lib/recording-parser.mjs';
import { reviewRecordedTest } from '../review-recorded-test.mjs';

function createWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'recorded-review-hardening-'));
}

function writeRecording(workspace, overrides = {}) {
  const recordingPath = path.join(workspace, 'flow.json');
  const recording = {
    title: 'Hardening flow',
    steps: [
      { type: 'navigate', url: 'http://localhost:3000/flow' },
      { type: 'change', selectors: [['aria/[role="textbox"][name="Email"]']], value: 'hardening@example.com' },
      { type: 'click', selectors: [['aria/[role="button"][name="Submit"]']] },
      { type: 'waitForElement', selectors: [['aria/[role="heading"][name="Done"]']], operator: '>=', count: 1 }
    ],
    ...overrides
  };

  fs.writeFileSync(recordingPath, `${JSON.stringify(recording, null, 2)}\n`);
  return recordingPath;
}

function writeTest(workspace, recordingPath, options = {}) {
  const normalized = normalizeRecordingFile(recordingPath);
  const testPath = path.join(workspace, 'flow.spec.ts');
  const navigateBody = options.navigateBody ?? "await page.goto('/flow');";
  const changeBody = options.changeBody ?? "await page.getByRole('textbox', { name: 'Email' }).fill(email);";
  const clickBody = options.clickBody ?? "await page.getByRole('button', { name: 'Submit' }).click();";
  const assertBody = options.assertBody ?? "await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible();";
  const prelude = options.prelude ?? "const email = 'hardening@example.com';";

  fs.writeFileSync(
    testPath,
    `/* recording: ${recordingPath} title:Hardening flow sha256:${normalized.sha256} */
import { test, expect } from '../../fixtures/test';

${prelude}

test('recorded flow', async ({ page }) => {
  await test.step('RSTEP-001: navigate', async () => {
    ${navigateBody}
  });
  await test.step('RSTEP-002: fill email', async () => {
    ${changeBody}
  });
  await test.step('RSTEP-003: submit', async () => {
    ${clickBody}
  });
  await test.step('RSTEP-004 ASSERT-001: done heading', async () => {
    ${assertBody}
  });
});
`
  );
  return testPath;
}

function review(workspace, recordingPath, options = {}) {
  const testPath = writeTest(workspace, recordingPath, options);
  return reviewRecordedTest({ recordingPath, testPath });
}

test('string-selector page.click with xpath is rejected (original probe)', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);

  const result = review(workspace, recordingPath, {
    clickBody: "await page.click('xpath=//input[1]');"
  });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /String-selector action API forbidden: page\.click\('xpath=\/\/input\[1\]'\)/);
});

test('string-selector page.fill and page.waitForSelector are rejected', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);

  const result = review(workspace, recordingPath, {
    changeBody: "await page.fill('//input[1]', email);",
    clickBody: [
      "await page.getByRole('button', { name: 'Submit' }).click();",
      "await page.waitForSelector('#done');",
      "await page.$('#done');"
    ].join('\n    ')
  });

  assert.equal(result.passed, false);
  const text = result.issues.join('\n');
  assert.match(text, /String-selector action API forbidden: page\.fill\(/);
  assert.match(text, /String-selector API forbidden: page\.waitForSelector\(/);
  assert.match(text, /String-selector API forbidden: page\.\$\(/);
});

test('obfuscated string-selector calls are rejected (bracket access, casts, const folding)', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);

  const result = review(workspace, recordingPath, {
    prelude: ["const email = 'hardening@example.com';", "const sel = 'button:nth-child(3)';"].join('\n'),
    clickBody: ["await page['click'](sel);", "await (page as any).hover('//main/button');"].join('\n    ')
  });

  assert.equal(result.passed, false);
  const text = result.issues.join('\n');
  assert.match(text, /String-selector action API forbidden: page\['click'\]\(sel\)/);
  assert.match(text, /String-selector action API forbidden: \(page as any\)\.hover\(/);
});

test('two-string page.press form and aliased xpath fill are rejected', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);

  const result = review(workspace, recordingPath, {
    prelude: ["const email = 'hardening@example.com';", 'const p = page;'].join('\n'),
    clickBody: ["await page.press('#email', 'Enter');", "await p.fill('xpath=//input[1]', email);"].join('\n    ')
  });

  assert.equal(result.passed, false);
  const text = result.issues.join('\n');
  assert.match(text, /String-selector action API forbidden: page\.press\(/);
  assert.match(text, /String-selector action API forbidden: p\.fill\(/);
});

test('locator-object actions, keyboard.press, and locator.fill values are not flagged as string-selector APIs', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace, {
    steps: [
      { type: 'navigate', url: 'http://localhost:3000/flow' },
      { type: 'change', selectors: [['aria/[role="textbox"][name="Email"]']], value: 'hardening@example.com' },
      { type: 'keyDown', key: 'Enter' },
      { type: 'waitForElement', selectors: [['aria/[role="heading"][name="Done"]']], operator: '>=', count: 1 }
    ]
  });

  const testPath = path.join(workspace, 'flow.spec.ts');
  const normalized = normalizeRecordingFile(recordingPath);
  fs.writeFileSync(
    testPath,
    `/* recording: ${recordingPath} title:Hardening flow sha256:${normalized.sha256} */
import { test, expect } from '../../fixtures/test';

const recordedInput = {
  email: 'hardening@example.com'
} as const;

test('recorded flow', async ({ page }) => {
  await test.step('RSTEP-001: navigate', async () => {
    await page.goto('/flow');
  });
  await test.step('RSTEP-002: fill email', async () => {
    await page.getByRole('textbox', { name: 'Email' }).fill(recordedInput.email);
  });
  await test.step('RSTEP-003: confirm with Enter', async () => {
    await page.keyboard.press('Enter');
  });
  await test.step('RSTEP-004 ASSERT-001: done heading', async () => {
    const doneHeading = page.getByRole('heading', { name: 'Done' });
    await expect(doneHeading).toBeVisible();
  });
});
`
  );

  const result = reviewRecordedTest({ recordingPath, testPath });

  assert.equal(result.passed, true, result.issues.join('\n'));
});

test('recorded reviewer shares the generated-test capability boundary before execution', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);
  const result = review(workspace, recordingPath, {
    prelude: [
      "import dotenv from 'dotenv';",
      "const email = 'hardening@example.com';",
      'const parsedEnvironment = dotenv.config().parsed;'
    ].join('\n'),
    navigateBody: [
      'const dynamicTarget = process.env.E2E_MP_ONSITE_CHANNEL;',
      'await page.goto(dynamicTarget);'
    ].join('\n    '),
    clickBody: [
      "await page.getByRole('button', { name: 'Submit' }).click();",
      "await page.request.post('/credential-sink', { data: parsedEnvironment });"
    ].join('\n    ')
  });

  const joined = result.issues.join('\n');
  assert.equal(result.passed, false);
  assert.match(joined, /Unapproved package import is forbidden.*dotenv/);
  assert.match(joined, /Playwright API request capability is forbidden/);
  assert.match(joined, /Direct page navigation must use a static relative path/);
});

test('title-only step bodies are rejected', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);

  const result = review(workspace, recordingPath, {
    clickBody: '// click happens here, trust me'
  });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /RSTEP-003 step must perform the recorded click action .*Title-only test\.step bodies are rejected/);
});

test('step body with the wrong action type is rejected', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);

  const result = review(workspace, recordingPath, {
    navigateBody: "await expect(page.getByRole('main')).toBeVisible();"
  });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /RSTEP-001 step must perform the recorded navigate action \(\.goto\(\.\.\.\)\)/);
});

test('change step must pass the recorded value to its fill call, not just mention it elsewhere', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);

  const result = review(workspace, recordingPath, {
    prelude: [
      "const email = 'hardening@example.com'; // satisfies the global typed-value scan",
      'void email;'
    ].join('\n'),
    changeBody: "await page.getByRole('textbox', { name: 'Email' }).fill('attacker@example.com');"
  });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /RSTEP-002 step must pass the recorded value to its fill\/type\/pressSequentially\/selectOption call/);
});

test('assertion step must target the contract locator, not a different one', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);

  const result = review(workspace, recordingPath, {
    assertBody: "await expect(page.getByRole('heading', { name: 'Wrong' })).toBeVisible();"
  });

  assert.equal(result.passed, false);
  assert.match(
    result.issues.join('\n'),
    /ASSERT-001 step must assert the recorded locator page\.getByRole\("heading", \{ name: "Done" \}\)/
  );
});

test('assertion step with only a page-level expect no longer satisfies the contract locator', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);

  const result = review(workspace, recordingPath, {
    assertBody: 'await expect(page).toHaveURL(/done/);'
  });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /ASSERT-001 step must assert the recorded locator/);
});

test('runtime test.skip() inside the recorded test body is rejected (original probe)', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);

  const result = review(workspace, recordingPath, {
    clickBody: ['test.skip();', "await page.getByRole('button', { name: 'Submit' }).click();"].join('\n    ')
  });

  assert.equal(result.passed, false);
  assert.match(
    result.issues.join('\n'),
    /Forbidden runtime test control found: test\.skip\. .*may not be called at runtime/
  );
});

test('runtime test.fixme, test.fail, and conditional test.skip are rejected', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);

  const result = review(workspace, recordingPath, {
    navigateBody: ["test.skip(process.env.CI === '1', 'flaky on CI');", "await page.goto('/flow');"].join('\n    '),
    changeBody: ['test.fixme();', "await page.getByRole('textbox', { name: 'Email' }).fill(email);"].join('\n    '),
    clickBody: ['test.fail();', "await page.getByRole('button', { name: 'Submit' }).click();"].join('\n    ')
  });

  assert.equal(result.passed, false);
  const text = result.issues.join('\n');
  assert.match(text, /Forbidden runtime test control found: test\.skip\./);
  assert.match(text, /Forbidden runtime test control found: test\.fixme\./);
  assert.match(text, /Forbidden runtime test control found: test\.fail\./);
});

test('aliased runtime test controls are rejected (const t = test; t.skip())', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);

  const result = review(workspace, recordingPath, {
    prelude: ["const email = 'hardening@example.com';", 'const t = test;', 'const s = test.fixme;'].join('\n'),
    clickBody: ['t.skip();', 's();', "await page.getByRole('button', { name: 'Submit' }).click();"].join('\n    ')
  });

  assert.equal(result.passed, false);
  const text = result.issues.join('\n');
  assert.match(text, /Forbidden runtime test control found: t\.skip\./);
  assert.match(text, /Forbidden runtime test control found: s\./);
});

test('test-defining skip keeps its dedicated message and test.step is not a false-positive control', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);

  const result = review(workspace, recordingPath, {
    prelude: ["const email = 'hardening@example.com';", "test.skip('legacy flow', async () => {});"].join('\n')
  });

  assert.equal(result.passed, false);
  const text = result.issues.join('\n');
  assert.match(text, /Forbidden test-defining control found: test\.skip used to define a test or describe block\./);
  // The legitimate test.step calls in the body must not be reported as controls.
  assert.doesNotMatch(text, /Forbidden runtime test control found: test\.step/);
});

test('unfoldable .locator() argument fails closed (original probe: XPath via join)', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);

  const result = review(workspace, recordingPath, {
    clickBody: [
      "await page.locator(['//', 'button'].join('')).click();",
      "await page.getByRole('button', { name: 'Submit' }).click();"
    ].join('\n    ')
  });

  assert.equal(result.passed, false);
  assert.match(
    result.issues.join('\n'),
    /Unresolvable selector argument in \.locator\(\['\/\/', 'button'\]\.join\(''\)\): the selector must fold to a static string or carry \/\/ locator-policy:exception/
  );
});

test('unfoldable .locator() argument with a locator-policy exception comment is accepted as a warning', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);

  const result = review(workspace, recordingPath, {
    clickBody: [
      '// locator-policy:exception dynamic selector audited by review',
      'await page.locator(`#row-${1 + 1}`).click();',
      "await page.getByRole('button', { name: 'Submit' }).click();"
    ].join('\n    ')
  });

  assert.equal(result.passed, true, result.issues.join('\n'));
  assert.match(result.warnings.join('\n'), /Unfoldable selector exception accepted for \.locator\(/);
});

test('positional locator picks (.first/.last/.nth(n)) require a locator-policy exception', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);

  const result = review(workspace, recordingPath, {
    clickBody: [
      "await page.getByRole('listitem').first().click();",
      "await page.getByRole('listitem').last().hover();",
      "await page.getByRole('listitem').nth(2).hover();",
      "await page.getByRole('button', { name: 'Submit' }).click();"
    ].join('\n    ')
  });

  assert.equal(result.passed, false);
  const text = result.issues.join('\n');
  assert.match(text, /Positional locator pick page\.getByRole\('listitem'\)\.first\(\) requires \/\/ locator-policy:exception/);
  assert.match(text, /Positional locator pick page\.getByRole\('listitem'\)\.last\(\) requires \/\/ locator-policy:exception/);
  assert.match(text, /Positional locator pick page\.getByRole\('listitem'\)\.nth\(2\) requires \/\/ locator-policy:exception/);
});

test('positional pick with a locator-policy exception comment is accepted as a warning', () => {
  const workspace = createWorkspace();
  const recordingPath = writeRecording(workspace);

  const result = review(workspace, recordingPath, {
    clickBody: [
      '// locator-policy:exception recorder captured the first duplicate submit button',
      "await page.getByRole('button', { name: 'Submit' }).first().click();"
    ].join('\n    ')
  });

  assert.equal(result.passed, true, result.issues.join('\n'));
  assert.match(
    result.warnings.join('\n'),
    /Positional locator pick exception accepted for page\.getByRole\('button', \{ name: 'Submit' \}\)\.first\(\)/
  );
});
