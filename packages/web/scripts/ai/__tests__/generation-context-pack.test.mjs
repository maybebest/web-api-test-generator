import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildGenerationContextPack,
  renderGenerationContextPack
} from '../lib/generation-context-pack.mjs';
import { specSha256 } from '../lib/spec-parser.mjs';

function write(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

function createWorkspace(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generation-context-pack-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const specPath = write(root, 'specs/checkout.md', '# Flow: Checkout\n');
  write(root, 'fixtures/test.ts', `
import { test as base, expect } from '@playwright/test';
type Fixtures = { checkoutUser: { id: string }; api: { get(path: string): Promise<unknown> } };
export const test = base.extend<Fixtures>({});
export { expect };
`);
  write(root, 'pages/CheckoutPage.ts', `
export class CheckoutPage {
  constructor(private readonly page: unknown) {}
  async goto(orderId: string): Promise<void> {}
  confirmation(): unknown { return undefined; }
  private secretHelper(password: string): void {}
}
`);
  write(root, 'pages/CheckoutNoiseComponent.ts', `
export class CheckoutNoiseComponent {
  unrelatedNoise(): unknown { return undefined; }
}
`);
  const targetTestFile = 'tests/regression/checkout.spec.ts';
  write(root, targetTestFile, [
    'const apiToken = "token-that-must-not-leak";',
    'const clientSecret = "client-secret-must-not-leak";',
    'const sessionId = "session-id-must-not-leak";',
    'const authCookie = "cookie-must-not-leak";',
    'const value = "aB3dE5fG7hI9jK1lM2nO3pQ4";',
    'export const existing = true;',
    'x'.repeat(8000)
  ].join('\n'));
  const domArtifactPath = write(root, '.ai-runs/dom/selector-candidates.json', JSON.stringify({
    specPath,
    specSha256: specSha256(specPath),
    flowId: 'FLOW-CHECKOUT-1',
    specVersion: '1.0.0',
    url: 'https://example.test/checkout?token=secret-value#private',
    capturedAt: '2026-08-01T10:00:00.000Z',
    source: 'agent-browser',
    selectorOwnership: 'framework',
    locatorAudit: {
      method: 'playwright-locator-count',
      snapshotDiagnostics: 'accessibility-snapshot-candidate-equivalence',
      requiredMatchCount: 1
    },
    authCookie: 'must-not-leak',
    elements: [
      {
        elementId: 'el-submit',
        role: 'button',
        accessibleName: 'Place order',
        rawHtml: '<button data-secret="must-not-leak">',
        candidateLocators: [
          {
            type: 'testId',
            locator: 'page.getByTestId("place-order")',
            preferred: true,
            matchCount: 1,
            unique: true,
            snapshotMatchCount: 1,
            snapshotUnique: true,
            matchEvidence: 'playwright-live'
          },
          {
            type: 'role',
            locator: 'page.getByRole("button")',
            preferred: false,
            matchCount: 3,
            unique: false,
            snapshotMatchCount: 3,
            snapshotUnique: false,
            matchEvidence: 'playwright-live'
          }
        ]
      }
    ]
  }));

  return { root, specPath, targetTestFile, domArtifactPath };
}

test('context pack includes only bounded, reviewed facts and public repository signatures', (context) => {
  const workspace = createWorkspace(context);
  const pack = buildGenerationContextPack({
    webRoot: workspace.root,
    specPath: workspace.specPath,
    targetTestFile: workspace.targetTestFile,
    domArtifactPath: workspace.domArtifactPath,
    validation: {
      content: '# Flow: Checkout\nUse CheckoutPage goto and confirmation to place an order.',
      metadata: { 'Base Path': '/checkout', Auth: 'none' }
    },
    maxChars: 5000
  });
  const rendered = renderGenerationContextPack(pack);

  assert.equal(pack.schemaVersion, 'generation-context-pack/v1');
  assert.match(pack.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(pack.dom.elements[0].candidateLocators.length, 1);
  assert.equal(pack.dom.elements[0].candidateLocators[0].matchCount, 1);
  assert.equal(pack.dom.url, 'https://example.test/checkout');
  assert.equal(pack.fixtures.importPath, '../../fixtures/test');
  assert.deepEqual(pack.fixtures.exports, ['expect', 'test']);
  assert.deepEqual(pack.fixtures.fixtureNames, ['api', 'checkoutUser']);
  assert.match(JSON.stringify(pack.pageObjects), /CheckoutPage/);
  assert.equal(pack.pageObjects[0].className, 'CheckoutPage');
  assert.match(JSON.stringify(pack.pageObjects), /goto\(orderId: string\): Promise<void>/);
  assert.doesNotMatch(JSON.stringify(pack.pageObjects), /secretHelper|password/);
  assert.match(pack.existingTarget.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(pack.existingTarget.imports));
  assert.ok(Array.isArray(pack.existingTarget.signatures));
  assert.ok(JSON.stringify(pack).length <= 5000);
  assert.match(rendered, /page\.getByTestId/);
  assert.doesNotMatch(rendered, /must-not-leak|secret-value|token-that-must-not-leak|aB3dE5fG7hI9jK1lM2nO3pQ4/);
  assert.doesNotMatch(rendered, /IGNORE POLICY|```/);
});

test('mutable target hash is recorded without changing immutable context identity', (context) => {
  const workspace = createWorkspace(context);
  const options = {
    webRoot: workspace.root,
    specPath: workspace.specPath,
    targetTestFile: workspace.targetTestFile,
    domArtifactPath: workspace.domArtifactPath,
    validation: { content: 'Checkout flow', metadata: { 'Base Path': '/checkout', Auth: 'none' } },
    maxChars: 5000
  };
  const before = buildGenerationContextPack(options);
  write(workspace.root, workspace.targetTestFile, 'export const changed = true;\n');
  const after = buildGenerationContextPack(options);

  assert.equal(after.fingerprint, before.fingerprint);
  assert.notEqual(after.existingTarget.sha256, before.existingTarget.sha256);
  assert.match(after.existingTarget.sha256, /^[a-f0-9]{64}$/);
});

test('3,500-character context keeps reserved relevant signatures without target bodies or arbitrary page-object fallback', (context) => {
  const workspace = createWorkspace(context);
  const dom = JSON.parse(fs.readFileSync(workspace.domArtifactPath, 'utf8'));
  dom.elements = [{
    elementId: 'checkout-submit',
    role: 'button',
    accessibleName: `Place checkout order ${'evidence'.repeat(18)}`,
    candidateLocators: Array.from({ length: 30 }, (_, index) => ({
      type: 'testId', locator: `page.getByTestId("checkout-${index}")`, preferred: index === 0,
      matchCount: 1, unique: true, snapshotMatchCount: 1, snapshotUnique: true,
      matchEvidence: 'playwright-live'
    }))
  }];
  fs.writeFileSync(workspace.domArtifactPath, JSON.stringify(dom));
  write(workspace.root, workspace.targetTestFile, `
import { test, expect } from '../../fixtures/test';
type CheckoutCase = { orderId: string };
function checkoutLabel(value: CheckoutCase): string { return 'SECRET_BODY_' + value.orderId; }
const helper = (orderId: string): boolean => orderId.length > 0;
`);
  const first = buildGenerationContextPack({
    webRoot: workspace.root, specPath: workspace.specPath, targetTestFile: workspace.targetTestFile,
    domArtifactPath: workspace.domArtifactPath,
    validation: { content: 'CheckoutPage goto checkout confirmation place order', metadata: { 'Base Path': '/checkout' } },
    maxChars: 3500
  });
  const rendered = renderGenerationContextPack(first);
  const second = buildGenerationContextPack({
    webRoot: workspace.root, specPath: workspace.specPath, targetTestFile: workspace.targetTestFile,
    domArtifactPath: workspace.domArtifactPath,
    validation: { content: 'CheckoutPage goto checkout confirmation place order', metadata: { 'Base Path': '/checkout' } },
    maxChars: 3500
  });

  assert.ok(rendered.length <= 3500);
  assert.match(first.existingTarget.sha256, /^[a-f0-9]{64}$/);
  assert.match(rendered, /import \{ test, expect \}/);
  assert.match(rendered, /CheckoutCase|checkoutLabel/);
  assert.match(rendered, /constructor\(page: unknown\)/);
  assert.match(rendered, /goto\(orderId: string\)/);
  assert.match(rendered, /fixtureNames|checkoutUser/);
  assert.match(rendered, /page\.getByTestId/);
  assert.doesNotMatch(rendered, /SECRET_BODY_|unrelatedNoise|CheckoutNoiseComponent/);
  assert.equal(renderGenerationContextPack(second), rendered);
});

test('target digest covers bytes beyond the bounded AST window without emitting a truncated declaration', (context) => {
  const workspace = createWorkspace(context);
  const prefix = [
    "import { test } from '../../fixtures/test';",
    'function safeHelper(value: string): string { return value; }',
    'function incompleteHelper(value: string): string {',
    '  return value + "'
  ].join('\n');
  const firstSource = `${prefix}${'x'.repeat(70_000)}";\n}\n`;
  write(workspace.root, workspace.targetTestFile, firstSource);
  const canonicalTargetPath = fs.realpathSync(path.resolve(workspace.root, workspace.targetTestFile));
  const options = {
    webRoot: workspace.root, specPath: workspace.specPath, targetTestFile: workspace.targetTestFile,
    validation: { content: 'CheckoutPage goto checkout', metadata: { 'Base Path': '/checkout' } }, maxChars: 3500
  };
  const originalReadFileSync = fs.readFileSync;
  const originalOpenSync = fs.openSync;
  const targetOpenFlags = [];
  fs.readFileSync = function guardedRead(filePath, ...args) {
    if (path.resolve(String(filePath)) === canonicalTargetPath) {
      throw new Error('target must not use full-file read');
    }
    return originalReadFileSync.call(this, filePath, ...args);
  };
  fs.openSync = function trackedOpen(filePath, flags, ...args) {
    if (path.resolve(String(filePath)) === canonicalTargetPath) {
      targetOpenFlags.push(flags);
    }
    return originalOpenSync.call(this, filePath, flags, ...args);
  };
  let before;
  let after;
  const changedSource = `${firstSource.slice(0, -3)}y\n`;
  try {
    before = buildGenerationContextPack(options);
    write(workspace.root, workspace.targetTestFile, changedSource);
    after = buildGenerationContextPack(options);
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.openSync = originalOpenSync;
  }

  assert.equal(before.existingTarget.sha256, crypto.createHash('sha256').update(firstSource).digest('hex'));
  assert.notEqual(after.existingTarget.sha256, before.existingTarget.sha256);
  assert.equal(targetOpenFlags.length, 2);
  if (fs.constants.O_NOFOLLOW) {
    assert.ok(targetOpenFlags.every((flags) => (flags & fs.constants.O_NOFOLLOW) === fs.constants.O_NOFOLLOW));
  }
  assert.match(JSON.stringify(before.existingTarget), /safeHelper/);
  assert.doesNotMatch(JSON.stringify(before.existingTarget), /incompleteHelper/);
});

test('context ordering never depends on host localeCompare behavior', (context) => {
  const workspace = createWorkspace(context);
  write(workspace.root, 'pages/ÜCheckoutPage.ts', 'export class ÜCheckoutPage { constructor(page: unknown) {} gotoCheckout(): void {} }');
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = () => { throw new Error('localeCompare must not be used'); };
  try {
    const pack = buildGenerationContextPack({
      webRoot: workspace.root, specPath: workspace.specPath, targetTestFile: workspace.targetTestFile,
      domArtifactPath: workspace.domArtifactPath,
      validation: { content: 'ÜCheckoutPage CheckoutPage goto checkout', metadata: { 'Base Path': '/checkout' } }, maxChars: 3500
    });
    assert.ok(renderGenerationContextPack(pack).length <= 3500);
  } finally {
    String.prototype.localeCompare = original;
  }
});

test('page-object signatures are individually bounded and secret-redacted before budgeting', (context) => {
  const workspace = createWorkspace(context);
  write(workspace.root, 'pages/SecureCheckoutPage.ts', `
export class SecureCheckoutPage {
  constructor(page: unknown, options: { apiToken: "sk-test-must-not-leak"; padding: "${'x'.repeat(5000)}" }) {}
  gotoSecureCheckout(payload: { clientSecret: "client-secret-must-not-leak"; padding: "${'y'.repeat(5000)}" }): Promise<void> { return Promise.resolve(); }
}
`);
  const pack = buildGenerationContextPack({
    webRoot: workspace.root, specPath: workspace.specPath, targetTestFile: workspace.targetTestFile,
    domArtifactPath: workspace.domArtifactPath,
    validation: { content: 'SecureCheckoutPage goto secure checkout', metadata: { 'Base Path': '/checkout' } }, maxChars: 3500
  });
  const rendered = renderGenerationContextPack(pack);
  const secure = pack.pageObjects.find((item) => item.className === 'SecureCheckoutPage');

  assert.ok(rendered.length <= 3500);
  assert.ok(secure.constructors.every((signature) => signature.length <= 500));
  assert.ok(secure.methods.every((signature) => signature.length <= 500));
  assert.match(rendered, /constructor\(page: unknown/);
  assert.match(rendered, /gotoSecureCheckout/);
  assert.doesNotMatch(rendered, /must-not-leak|x{450}|y{450}/);
});

test('worst-case 3,500 budget preserves fixture, target, DOM, and relevant page-object evidence', (context) => {
  const workspace = createWorkspace(context);
  write(workspace.root, 'fixtures/test.ts', `
import { test as base, expect } from '@playwright/test';
type Fixtures = { ${Array.from({ length: 20 }, (_, index) => `checkoutFixture${index}${'VeryLong'.repeat(12)}: string`).join('; ')} };
export const test = base.extend<Fixtures>({});
export { expect };
`);
  write(workspace.root, workspace.targetTestFile, `
import { test, expect } from '../../fixtures/test';
import { CheckoutPage } from '../../pages/CheckoutPage';
type CheckoutCase = { orderId: string; note: '${'target'.repeat(120)}' };
function checkoutLabel(value: CheckoutCase): string { return 'SECRET_BODY_' + value.orderId; }
`);
  write(workspace.root, 'pages/CheckoutPage.ts', `
export class CheckoutPage {
  constructor(page: unknown, options: { note: '${'constructor'.repeat(100)}' }) {}
  gotoCheckout(orderId: string, note: '${'method'.repeat(100)}'): Promise<void> { return Promise.resolve(); }
  confirmCheckout(note: '${'confirm'.repeat(100)}'): Promise<void> { return Promise.resolve(); }
}
`);
  const dom = JSON.parse(fs.readFileSync(workspace.domArtifactPath, 'utf8'));
  dom.elements[0].accessibleName = `Place order ${'reviewed'.repeat(100)}`;
  dom.elements[0].candidateLocators.push({ type: 'role', locator: `page.getByRole("button", { name: "${'locator'.repeat(100)}" })`,
    preferred: false, matchCount: 1, unique: true, snapshotMatchCount: 1, snapshotUnique: true,
    matchEvidence: 'playwright-live' });
  fs.writeFileSync(workspace.domArtifactPath, JSON.stringify(dom));
  const options = { webRoot: workspace.root, specPath: workspace.specPath, targetTestFile: workspace.targetTestFile,
    domArtifactPath: workspace.domArtifactPath,
    validation: { content: 'CheckoutPage goto confirm checkout', metadata: { 'Base Path': '/checkout' } }, maxChars: 3500 };

  const first = buildGenerationContextPack(options);
  const rendered = renderGenerationContextPack(first);
  const second = renderGenerationContextPack(buildGenerationContextPack(options));
  assert.ok(rendered.length <= 3500);
  assert.ok(first.fixtures.fixtureNames.length > 0);
  assert.ok(first.existingTarget.imports.length > 0 && first.existingTarget.signatures.length > 0);
  assert.ok(first.dom.elements.length > 0 && first.dom.elements[0].candidateLocators.length > 0);
  assert.ok(first.pageObjects.length > 0 && first.pageObjects[0].constructors.length > 0 && first.pageObjects[0].methods.length > 0);
  assert.equal(second, rendered);
  assert.doesNotMatch(rendered, /SECRET_BODY_|must-not-leak/);
});

test('long mandatory identifiers and in-root paths stay capped while every evidence category survives', (context) => {
  const workspace = createWorkspace(context);
  const secretCanary = 'AKIAABCDEFGHIJKLMNOP';
  const longSegment = (label) => `${label}-${'path'.repeat(42)}`;
  const targetTestFile = `tests/${longSegment('target-a')}/${longSegment('target-b')}/${longSegment('target-c')}/checkout.spec.ts`;
  const className = `Checkout${'Identity'.repeat(240)}$${secretCanary}$Page`;
  const pageObjectPath = `pages/${longSegment('page-a')}/${longSegment(`page-${secretCanary}`)}/LongCheckoutPage.ts`;
  const domArtifactPath = path.join(
    workspace.root,
    '.ai-runs',
    longSegment('dom-a'),
    longSegment('dom-b'),
    'selector-candidates.json'
  );
  write(workspace.root, 'pages/CheckoutPage.ts', 'export class UnrelatedPage { ignored(): void {} }\n');
  write(workspace.root, targetTestFile, `
import { test } from '${'../'.repeat(30)}fixtures/test';
type CheckoutTarget = { ${secretCanary}: string };
function checkoutTarget(value: CheckoutTarget): string { return 'TARGET_BODY_MUST_NOT_LEAK_' + value.id; }
`);
  write(workspace.root, 'fixtures/test.ts', `
import { test as base, expect } from '@playwright/test';
type Fixtures = { ${secretCanary}: string; checkoutUser: { id: string } };
export const test = base.extend<Fixtures>({});
export { expect };
`);
  write(workspace.root, pageObjectPath, `
export class ${className} {
  constructor(page: unknown) {}
  gotoCheckout(orderId: string): Promise<void> { return Promise.resolve(); }
}
`);
  fs.mkdirSync(path.dirname(domArtifactPath), { recursive: true });
  fs.writeFileSync(domArtifactPath, JSON.stringify({
    specPath: workspace.specPath,
    specSha256: specSha256(workspace.specPath),
    source: 'agent-browser',
    selectorOwnership: 'framework',
    locatorAudit: {
      method: 'playwright-locator-count',
      snapshotDiagnostics: 'accessibility-snapshot-candidate-equivalence',
      requiredMatchCount: 1
    },
    url: `https://example.test/${'safe-path/'.repeat(90)}?token=DOM_SECRET_MUST_NOT_LEAK`,
    capturedAt: '2026-08-02T00:00:00.000Z',
    elements: [{
      elementId: `token=${secretCanary}-${'identifier'.repeat(80)}`,
      role: `authorization: Bearer ${secretCanary}-${'role'.repeat(80)}`,
      accessibleName: `Place order ${'reviewed'.repeat(80)}`,
      candidateLocators: [{
        type: 'testId', locator: `page.getByTestId("checkout-${'locator'.repeat(90)}")`, preferred: true,
        matchCount: 1, unique: true, snapshotMatchCount: 1, snapshotUnique: true,
        matchEvidence: 'playwright-live'
      }]
    }]
  }));

  const pack = buildGenerationContextPack({
    webRoot: workspace.root,
    specPath: workspace.specPath,
    targetTestFile,
    domArtifactPath,
    validation: { content: `${className} goto checkout`, metadata: { 'Base Path': `/${'base/'.repeat(100)}` } },
    maxChars: 3500
  });
  const rendered = renderGenerationContextPack(pack);

  assert.ok(rendered.length <= 3500);
  assert.ok(pack.fixtures.fixtureNames.length > 0);
  assert.ok(pack.existingTarget.imports.length > 0 && pack.existingTarget.signatures.length > 0);
  assert.ok(pack.dom.elements.length > 0 && pack.dom.elements[0].candidateLocators.length > 0);
  assert.ok(pack.pageObjects.length > 0 && pack.pageObjects[0].constructors.length > 0 && pack.pageObjects[0].methods.length > 0);
  assert.ok(pack.pageObjects[0].className.length < className.length);
  assert.match(pack.pageObjects[0].className, /^CheckoutIdentity/);
  assert.match(pack.pageObjects[0].className, /Page$/);
  assert.doesNotMatch(rendered, new RegExp(`MUST_NOT_LEAK|TARGET_BODY|${secretCanary}`));
});

test('context pack represents missing DOM evidence explicitly', (context) => {
  const workspace = createWorkspace(context);
  const pack = buildGenerationContextPack({
    webRoot: workspace.root,
    specPath: workspace.specPath,
    targetTestFile: workspace.targetTestFile,
    validation: { content: 'Checkout flow', metadata: { 'Base Path': '/checkout', Auth: 'none' } },
    maxChars: 5000
  });

  assert.deepEqual(pack.dom, { status: 'missing', basePath: '/checkout' });
});

test('context pack rejects target symlinks and non-test output paths', (context) => {
  const workspace = createWorkspace(context);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'generation-context-outside-'));
  context.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const outsideFile = write(outside, 'external.spec.ts', 'const externalSecret = "do-not-read";\n');
  const symlinkPath = path.join(workspace.root, 'tests/regression/symlink.spec.ts');
  try {
    fs.symlinkSync(outsideFile, symlinkPath, 'file');
  } catch (error) {
    if (error.code === 'EPERM') {
      context.skip('Creating symlinks is not permitted on this platform.');
      return;
    }
    throw error;
  }
  const base = {
    webRoot: workspace.root,
    specPath: workspace.specPath,
    validation: { content: 'Checkout flow', metadata: { 'Base Path': '/checkout', Auth: 'none' } },
    maxChars: 5000
  };

  assert.throws(
    () => buildGenerationContextPack({ ...base, targetTestFile: 'tests/regression/symlink.spec.ts' }),
    /symlink|outside/i
  );
  assert.throws(
    () => buildGenerationContextPack({ ...base, targetTestFile: 'pages/not-a-test.spec.ts' }),
    /under.*tests/i
  );
  assert.throws(
    () => buildGenerationContextPack({ ...base, targetTestFile: 'tests/regression/not-typescript.txt' }),
    /\.spec\.ts/i
  );
});

test('context roots reject symlinked tests, fixtures, and page-object directories', (context) => {
  for (const rootName of ['tests', 'fixtures', 'pages']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `generation-context-${rootName}-root-`));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), `generation-context-${rootName}-outside-`));
    context.after(() => fs.rmSync(root, { recursive: true, force: true }));
    context.after(() => fs.rmSync(outside, { recursive: true, force: true }));
    write(root, 'specs/checkout.md', '# Flow: Checkout\n');
    if (rootName !== 'tests') write(root, 'tests/regression/checkout.spec.ts', 'type CheckoutTarget = { id: string };\n');
    if (rootName !== 'fixtures') write(root, 'fixtures/test.ts', 'export const test = true;\n');
    if (rootName !== 'pages') write(root, 'pages/CheckoutPage.ts', 'export class CheckoutPage { gotoCheckout(): void {} }\n');
    if (rootName === 'tests') write(outside, 'regression/checkout.spec.ts', 'type OutsideTarget = { id: string };\n');
    if (rootName === 'fixtures') write(outside, 'test.ts', 'export const outsideFixture = true;\n');
    if (rootName === 'pages') write(outside, 'CheckoutPage.ts', 'export class CheckoutPage { gotoCheckout(): void {} }\n');
    fs.symlinkSync(outside, path.join(root, rootName), 'dir');

    assert.throws(
      () => buildGenerationContextPack({
        webRoot: root,
        specPath: path.join(root, 'specs/checkout.md'),
        targetTestFile: 'tests/regression/checkout.spec.ts',
        validation: { content: 'CheckoutPage goto checkout', metadata: { 'Base Path': '/checkout' } },
        maxChars: 3500
      }),
      /symlink|symbolic link|outside/i,
      rootName
    );
  }
});

test('fixture replacement between pathname check and open fails closed', (context) => {
  const workspace = createWorkspace(context);
  const fixturePath = path.join(workspace.root, 'fixtures/test.ts');
  const canonicalFixturePath = fs.realpathSync(fixturePath);
  const movedPath = path.join(workspace.root, 'fixtures/test.original.ts');
  const outsidePath = write(workspace.root, 'outside-fixture.ts', 'export const OUTSIDE_FIXTURE_MUST_NOT_BE_READ = true;\n');
  const originalReadFileSync = fs.readFileSync;
  const originalOpenSync = fs.openSync;
  let swapped = false;
  const swap = () => {
    if (swapped) return;
    swapped = true;
    fs.renameSync(fixturePath, movedPath);
    fs.symlinkSync(outsidePath, fixturePath, 'file');
  };
  fs.readFileSync = function swapBeforePathRead(filePath, ...args) {
    if (path.resolve(String(filePath)) === canonicalFixturePath) swap();
    return originalReadFileSync.call(this, filePath, ...args);
  };
  fs.openSync = function swapBeforeDescriptorOpen(filePath, flags, ...args) {
    if (path.resolve(String(filePath)) === canonicalFixturePath) swap();
    return originalOpenSync.call(this, filePath, flags, ...args);
  };
  try {
    assert.throws(
      () => buildGenerationContextPack({
        webRoot: workspace.root,
        specPath: workspace.specPath,
        targetTestFile: workspace.targetTestFile,
        validation: { content: 'CheckoutPage goto checkout', metadata: { 'Base Path': '/checkout' } },
        maxChars: 3500
      }),
      /changed|symlink|symbolic link|too many levels/i
    );
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.openSync = originalOpenSync;
  }
});

test('target size and page-object traversal have explicit fail-closed limits', (context) => {
  const oversized = createWorkspace(context);
  write(oversized.root, oversized.targetTestFile, `${'x'.repeat(8 * 1024 * 1024 + 1)}\n`);
  assert.throws(
    () => buildGenerationContextPack({
      webRoot: oversized.root,
      specPath: oversized.specPath,
      targetTestFile: oversized.targetTestFile,
      validation: { content: 'CheckoutPage goto checkout', metadata: { 'Base Path': '/checkout' } },
      maxChars: 3500
    }),
    /target.*exceeds|exceeds.*target|8388608/i
  );

  const traversed = createWorkspace(context);
  for (let index = 0; index < 2_049; index += 1) {
    write(traversed.root, `pages/noise-${String(index).padStart(4, '0')}.txt`, 'noise\n');
  }
  assert.throws(
    () => buildGenerationContextPack({
      webRoot: traversed.root,
      specPath: traversed.specPath,
      targetTestFile: traversed.targetTestFile,
      validation: { content: 'CheckoutPage goto checkout', metadata: { 'Base Path': '/checkout' } },
      maxChars: 3500
    }),
    /page-object traversal.*2048|traversal limit/i
  );

  const nestedTraversal = createWorkspace(context);
  for (let index = 0; index < 2_045; index += 1) {
    write(nestedTraversal.root, `pages/noise-${String(index).padStart(4, '0')}.txt`, 'noise\n');
  }
  write(nestedTraversal.root, 'pages/000-nested/one-more-entry.txt', 'noise\n');
  assert.throws(
    () => buildGenerationContextPack({
      webRoot: nestedTraversal.root,
      specPath: nestedTraversal.specPath,
      targetTestFile: nestedTraversal.targetTestFile,
      validation: { content: 'CheckoutPage goto checkout', metadata: { 'Base Path': '/checkout' } },
      maxChars: 3500
    }),
    /page-object traversal.*(?:0|2048).*entries exceeded|traversal limit/i
  );
});
