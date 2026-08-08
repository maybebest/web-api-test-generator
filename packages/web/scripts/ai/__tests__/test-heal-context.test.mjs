import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectHealContext } from '../healer/test-heal-context.mjs';
import { createScopedRoleCandidate } from '../lib/scoped-role-locator.mjs';
import { reviewDomDiscoveryArtifactObject } from '../review-dom-discovery.mjs';

function makeWorkspace() {
  const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-context-'));
  fs.mkdirSync(path.join(webRoot, 'tests', 'regression'), { recursive: true });
  fs.mkdirSync(path.join(webRoot, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(webRoot, 'components'), { recursive: true });
  fs.mkdirSync(path.join(webRoot, '.ai-runs', 'dom-discovery', 'run'), { recursive: true });
  return {
    webRoot,
    testPath: 'tests/regression/save.spec.ts'
  };
}

function selectorDiscoveryArtifact() {
  return {
    specPath: 'specs/save.md',
    specSha256: 'a'.repeat(64),
    flowId: 'FLOW-SAVE-1',
    specVersion: '1.0.0',
    url: 'https://example.test/save?token=must-not-project',
    capturedAt: '2026-08-03T10:00:00.000Z',
    source: 'agent-browser',
    sourceCommands: ['agent-browser snapshot -i --json'],
    selectorOwnership: 'framework',
    locatorAudit: {
      method: 'playwright-locator-count',
      snapshotDiagnostics: 'accessibility-snapshot-candidate-equivalence',
      requiredMatchCount: 1
    },
    elements: [{
      elementId: 'el-save',
      role: 'button',
      accessibleName: 'Save ordinary-pass',
      label: 'Bearer abcdefghijklmnop',
      placeholder: null,
      text: 'raw text must not project',
      href: '/private',
      testId: 'save-button',
      attributes: { 'data-debug': 'ordinary-pass' },
      snapshotOccurrences: 1,
      candidateLocators: [{
        type: 'role',
        locator: 'page.getByRole("button", { name: "Save ordinary-pass" })',
        score: 90,
        reason: 'role evidence',
        preferred: true,
        matchCount: 1,
        unique: true,
        snapshotMatchCount: 1,
        snapshotUnique: true,
        matchEvidence: 'playwright-live'
      }, {
        type: 'label',
        locator: 'page.getByLabel("Bearer abcdefghijklmnop")',
        score: 80,
        reason: 'label evidence',
        preferred: false,
        matchCount: 1,
        unique: true,
        snapshotMatchCount: 1,
        snapshotUnique: true,
        matchEvidence: 'playwright-live'
      }]
    }, {
      elementId: 'el-banner-button',
      role: 'button',
      accessibleName: null,
      label: null,
      placeholder: null,
      text: null,
      href: null,
      testId: null,
      attributes: {},
      snapshotOccurrences: 1,
      candidateLocators: [{
        ...createScopedRoleCandidate({ scopeRole: 'banner', targetRole: 'button' }),
        preferred: true,
        matchCount: 1,
        unique: true,
        snapshotMatchCount: 1,
        snapshotUnique: true,
        matchEvidence: 'playwright-live'
      }]
    }]
  };
}

test('collectHealContext includes locator-bearing page object members and a redacted DOM snapshot', () => {
  const { webRoot, testPath } = makeWorkspace();
  fs.writeFileSync(path.join(webRoot, 'pages', 'SavePage.ts'), `
export class SavePage {
  constructor(private readonly page: Page) {}

  async save() {
    await this.page.getByRole('button', { name: 'Save' }).click();
  }

  helper() {
    return 'not provider context';
  }
}
`);
  fs.writeFileSync(path.join(webRoot, 'fixtures.ts'), 'export const fixtureSecret = "not included";\n');
  const domSnapshotRelativePath = '.ai-runs/dom-discovery/run/selector-candidates.json';
  const domSnapshotPath = path.join(webRoot, domSnapshotRelativePath);
  fs.writeFileSync(
    domSnapshotPath,
    JSON.stringify(selectorDiscoveryArtifact())
  );
  const source = `
import { test } from '@playwright/test';
import { fixtureSecret } from '../../fixtures';
import { SavePage } from '../../pages/SavePage';
`;

  const context = collectHealContext({
    testPath,
    source,
    evidence: ['flow: Error\n    at pages/SavePage.ts:12:7'],
    webRoot,
    domSnapshotPath: domSnapshotRelativePath,
    secretValues: ['ordinary-pass']
  });

  assert.equal(context.importedSources.length, 1);
  assert.equal(context.importedSources[0].path, 'pages/SavePage.ts');
  assert.match(context.importedSources[0].sha256, /^[a-f0-9]{64}$/);
  assert.match(context.importedSources[0].excerpt, /constructor\(/);
  assert.match(context.importedSources[0].excerpt, /async save\(/);
  assert.doesNotMatch(context.importedSources[0].excerpt, /not provider context/);
  assert.equal(context.domSnapshot.path, '.ai-runs/dom-discovery/run/selector-candidates.json');
  assert.match(context.domSnapshot.sha256, /^[a-f0-9]{64}$/);
  const projectedDom = JSON.parse(context.domSnapshot.content);
  assert.deepEqual(Object.keys(projectedDom).sort(), ['elements', 'locatorAudit', 'selectorOwnership', 'source']);
  assert.deepEqual(Object.keys(projectedDom.elements[0]).sort(), [
    'accessibleName', 'candidateLocators', 'elementId', 'label', 'placeholder', 'role'
  ]);
  assert.deepEqual(Object.keys(projectedDom.elements[0].candidateLocators[0]).sort(), [
    'locator', 'matchCount', 'matchEvidence', 'preferred', 'type'
  ]);
  assert.deepEqual(projectedDom.elements[1].candidateLocators[0], {
    type: 'scopedRole',
    locator: 'page.getByRole("banner").getByRole("button")',
    scope: { role: 'banner', accessibleName: null },
    target: { role: 'button', accessibleName: null },
    preferred: true,
    matchCount: 1,
    matchEvidence: 'playwright-live',
    warningCodes: ['SCOPED_ROLE_TARGET_UNNAMED']
  });
  assert.doesNotMatch(context.domSnapshot.content, /raw text|data-debug|must-not-project|sourceCommands/);
  assert.doesNotMatch(context.domSnapshot.content, /abcdefghijklmnop|ordinary-pass/);
  assert.equal(context.manualChangeRequired, true);
});

test('collectHealContext accepts an officially reviewed flat artifact and filters its non-unique alternative', () => {
  const { webRoot, testPath } = makeWorkspace();
  const artifact = selectorDiscoveryArtifact();
  artifact.elements = [artifact.elements[0]];
  const alternative = artifact.elements[0].candidateLocators[1];
  alternative.matchCount = 2;
  alternative.unique = false;
  alternative.snapshotMatchCount = 2;
  alternative.snapshotUnique = false;

  const review = reviewDomDiscoveryArtifactObject(artifact, {
    rootDir: webRoot,
    expectedSpecPath: artifact.specPath,
    expectedSpecSha256: artifact.specSha256
  });
  assert.equal(review.passed, true, review.issues.join('\n'));
  assert.equal(review.warnings.length, 1);
  assert.match(review.warnings[0], /non-unique and must not be selected/i);

  const domSnapshotPath = path.join(webRoot, '.ai-runs', 'dom-discovery', 'run', 'flat-warnings.json');
  fs.writeFileSync(domSnapshotPath, JSON.stringify(artifact));
  const context = collectHealContext({
    testPath,
    source: '',
    evidence: [],
    webRoot,
    domSnapshotPath
  });
  const [element] = JSON.parse(context.domSnapshot.content).elements;
  assert.deepEqual(element.candidateLocators, [{
    type: 'role',
    locator: 'page.getByRole("button", { name: "Save ordinary-pass" })',
    preferred: true,
    matchCount: 1,
    matchEvidence: 'playwright-live'
  }]);
});

test('collectHealContext rejects malformed scoped-role discovery candidates and flat scoped fields', () => {
  const cases = [
    {
      label: 'changed locator',
      mutate(candidate) {
        candidate.locator = 'page.getByRole("main").getByRole("button")';
      },
      pattern: /Scoped role candidate\.locator is not canonical/i
    },
    {
      label: 'extra scope key',
      mutate(candidate) {
        candidate.scope.extra = 'nope';
      },
      pattern: /Scoped role scope contains unsupported field/i
    },
    {
      label: 'extra target key',
      mutate(candidate) {
        candidate.target.extra = 'nope';
      },
      pattern: /Scoped role target contains unsupported field/i
    },
    {
      label: 'unsupported scope role',
      mutate(candidate) {
        candidate.scope.role = 'article';
      },
      pattern: /Unsupported scoped role container/i
    },
    {
      label: 'unsupported target role',
      mutate(candidate) {
        candidate.target.role = 'not-a-role';
      },
      pattern: /Unsupported scoped role target/i
    },
    {
      label: 'non-unique count',
      mutate(candidate) {
        candidate.matchCount = 0;
        candidate.unique = false;
      },
      pattern: /preferred but not unique/i
    },
    {
      label: 'non-unique snapshot count',
      mutate(candidate) {
        candidate.snapshotMatchCount = 0;
        candidate.snapshotUnique = false;
      },
      pattern: /missing consistent live and snapshot uniqueness evidence/i
    },
    {
      label: 'missing warning code',
      mutate(candidate) {
        candidate.warningCodes = [];
      },
      pattern: /Scoped role candidate\.warningCodes is not canonical/i
    },
    {
      label: 'flat scoped fields',
      mutate(candidate, artifact) {
        artifact.elements[0].candidateLocators[0].scope = { role: 'banner', accessibleName: null };
      },
      pattern: /Flat heal locator candidates cannot carry scoped-role fields/i
    }
  ];

  for (const [index, scenario] of cases.entries()) {
    const { webRoot, testPath } = makeWorkspace();
    const artifact = selectorDiscoveryArtifact();
    scenario.mutate(artifact.elements[1].candidateLocators[0], artifact);
    const domSnapshotPath = path.join(webRoot, '.ai-runs', 'dom-discovery', 'run', `invalid-scoped-role-${index}.json`);
    fs.writeFileSync(domSnapshotPath, JSON.stringify(artifact));
    assert.throws(
      () => collectHealContext({ testPath, source: '', evidence: [], webRoot, domSnapshotPath }),
      scenario.pattern,
      scenario.label
    );
  }
});

test('collectHealContext ignores bare and unrelated in-workspace imports', () => {
  const { webRoot, testPath } = makeWorkspace();
  fs.writeFileSync(path.join(webRoot, 'fixtures.ts'), 'export const fixture = 1;\n');
  const context = collectHealContext({
    testPath,
    source: `import { test } from '@playwright/test';\nimport { fixture } from '../../fixtures';\n`,
    evidence: [],
    webRoot
  });
  assert.deepEqual(context.importedSources, []);
  assert.equal(context.domSnapshot, undefined);
  assert.equal(context.manualChangeRequired, false);
});

test('collectHealContext rejects outside, symlinked, oversized, and secret-bearing imported sources', () => {
  const cases = [
    {
      label: 'outside',
      prepare(webRoot) {
        const outsidePath = path.join(path.dirname(webRoot), 'OutsidePage.ts');
        fs.writeFileSync(outsidePath, 'export class OutsidePage {}\n');
        return `import { OutsidePage } from '../../../OutsidePage';\n`;
      },
      pattern: /outside|workspace|pages|components/i
    },
    {
      label: 'symlink',
      prepare(webRoot) {
        fs.writeFileSync(path.join(webRoot, 'pages', 'RealPage.ts'), 'export class RealPage {}\n');
        fs.symlinkSync('RealPage.ts', path.join(webRoot, 'pages', 'LinkedPage.ts'));
        return `import { RealPage } from '../../pages/LinkedPage';\n`;
      },
      pattern: /symbolic|symlink/i
    },
    {
      label: 'oversized',
      prepare(webRoot) {
        fs.writeFileSync(path.join(webRoot, 'pages', 'LargePage.ts'), `export class LargePage {}\n// ${'x'.repeat(33 * 1024)}`);
        return `import { LargePage } from '../../pages/LargePage';\n`;
      },
      pattern: /32|size limit|exceeds/i
    },
    {
      label: 'secret-bearing',
      prepare(webRoot) {
        fs.writeFileSync(
          path.join(webRoot, 'pages', 'SecretPage.ts'),
          `export class SecretPage { password = 'super-secret-value'; }\n`
        );
        return `import { SecretPage } from '../../pages/SecretPage';\n`;
      },
      pattern: /secret/i
    }
  ];

  for (const scenario of cases) {
    const { webRoot, testPath } = makeWorkspace();
    const source = scenario.prepare(webRoot);
    assert.throws(
      () => collectHealContext({ testPath, source, evidence: [], webRoot }),
      scenario.pattern,
      scenario.label
    );
  }
});

test('collectHealContext rejects imported sources containing a runner-known secret value', () => {
  const { webRoot, testPath } = makeWorkspace();
  fs.writeFileSync(
    path.join(webRoot, 'pages', 'KnownSecretPage.ts'),
    `export class KnownSecretPage { label = 'ordinary-pass'; }\n`
  );
  assert.throws(
    () => collectHealContext({
      testPath,
      source: `import { KnownSecretPage } from '../../pages/KnownSecretPage';\n`,
      evidence: [],
      webRoot,
      secretValues: ['ordinary-pass']
    }),
    /secret/i
  );
});

test('collectHealContext rejects known secret values in imported and DOM artifact paths', () => {
  const importedWorkspace = makeWorkspace();
  const secretPageDirectory = path.join(importedWorkspace.webRoot, 'pages', 'ordinary-pass');
  fs.mkdirSync(secretPageDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(secretPageDirectory, 'SecretPathPage.ts'),
    `export class SecretPathPage { constructor(private readonly page: Page) {} }\n`
  );
  assert.throws(
    () => collectHealContext({
      testPath: importedWorkspace.testPath,
      source: `import { SecretPathPage } from '../../pages/ordinary-pass/SecretPathPage';\n`,
      evidence: [],
      webRoot: importedWorkspace.webRoot,
      secretValues: ['ordinary-pass']
    }),
    /path|secret/i
  );

  const domWorkspace = makeWorkspace();
  const secretDomDirectory = path.join(
    domWorkspace.webRoot,
    '.ai-runs',
    'dom-discovery',
    'ordinary-pass'
  );
  fs.mkdirSync(secretDomDirectory, { recursive: true });
  const domSnapshotPath = path.join(secretDomDirectory, 'selector-candidates.json');
  fs.writeFileSync(domSnapshotPath, JSON.stringify(selectorDiscoveryArtifact()));
  assert.throws(
    () => collectHealContext({
      testPath: domWorkspace.testPath,
      source: '',
      evidence: [],
      webRoot: domWorkspace.webRoot,
      domSnapshotPath,
      secretValues: ['ordinary-pass']
    }),
    /path|secret/i
  );
});

test('collectHealContext caps imported files and truncates only at method boundaries', () => {
  const { webRoot, testPath } = makeWorkspace();
  const imports = [];
  for (let index = 1; index <= 5; index += 1) {
    const className = `Page${index}`;
    fs.writeFileSync(path.join(webRoot, 'pages', `${className}.ts`), `
export class ${className} {
  constructor(private readonly page: Page) {}
  small() { return this.page.getByTestId('${className.toLowerCase()}'); }
  enormousMethod() { return this.page.getByText('${'z'.repeat(11_900)}'); }
}
`);
    imports.push(`import { ${className} } from '../../pages/${className}';`);
  }

  const context = collectHealContext({
    testPath,
    source: imports.join('\n'),
    evidence: [],
    webRoot
  });

  assert.equal(context.importedSources.length, 4);
  assert.ok(context.importedSources.reduce((total, item) => total + item.excerpt.length, 0) <= 12_000);
  assert.match(context.importedSources[0].excerpt, /small\(/);
  assert.doesNotMatch(context.importedSources[0].excerpt, /enormousMethod|z{100}/);
});

test('collectHealContext rejects DOM snapshots outside the discovery root or above 64 KiB', () => {
  const { webRoot, testPath } = makeWorkspace();
  const outside = path.join(webRoot, 'outside-dom.json');
  fs.writeFileSync(outside, '{}');
  assert.throws(
    () => collectHealContext({ testPath, source: '', evidence: [], webRoot, domSnapshotPath: outside }),
    /inside|Heal DOM snapshot/i
  );

  const oversized = path.join(webRoot, '.ai-runs', 'dom-discovery', 'run', 'large.json');
  fs.writeFileSync(oversized, 'x'.repeat((64 * 1024) + 1));
  assert.throws(
    () => collectHealContext({ testPath, source: '', evidence: [], webRoot, domSnapshotPath: oversized }),
    /65536|size limit|exceeds/i
  );

  const screenshot = path.join(webRoot, '.ai-runs', 'dom-discovery', 'run', 'screenshot.png');
  fs.writeFileSync(screenshot, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  assert.throws(
    () => collectHealContext({ testPath, source: '', evidence: [], webRoot, domSnapshotPath: screenshot }),
    /DOM snapshot|JSON|text artifact/i
  );
});

test('collectHealContext rejects storage, cookie, header, auth, and trace-shaped JSON artifacts', () => {
  const nestedHeaderElement = selectorDiscoveryArtifact().elements[0];
  const scenarios = [
    { cookies: [{ name: 'sid', value: 'ordinary-cookie-value', domain: 'example.test', path: '/' }] },
    { headers: { 'x-user': 'ordinary-header-value' } },
    { elements: [{ ...nestedHeaderElement, attributes: { requestHeaders: { 'x-user': 'ordinary-header-value' } } }] },
    { storageState: { origins: [{ origin: 'https://example.test', localStorage: [] }] } },
    { authState: { user: 'person@example.test' } },
    { trace: { events: [] } },
    { screenshotData: 'data:image/png;base64,iVBORw0KGgo=' }
  ];
  for (const [index, artifact] of scenarios.entries()) {
    const { webRoot, testPath } = makeWorkspace();
    const domSnapshotPath = path.join(
      webRoot,
      '.ai-runs',
      'dom-discovery',
      'run',
      `selector-candidates-${index}.json`
    );
    fs.writeFileSync(domSnapshotPath, JSON.stringify({ ...selectorDiscoveryArtifact(), ...artifact }));
    assert.throws(
      () => collectHealContext({ testPath, source: '', evidence: [], webRoot, domSnapshotPath }),
      /selector discovery|cookie|header|storage|auth|trace|sensitive/i
    );
  }
});

test('collectHealContext accepts genuine screenshotPath metadata but never projects it', () => {
  const { webRoot, testPath } = makeWorkspace();
  const artifact = selectorDiscoveryArtifact();
  artifact.screenshotPath = '.ai-runs/dom-discovery/run/page.png';
  const domSnapshotPath = path.join(webRoot, '.ai-runs', 'dom-discovery', 'run', 'with-screenshot.json');
  fs.writeFileSync(domSnapshotPath, JSON.stringify(artifact));

  const context = collectHealContext({ testPath, source: '', evidence: [], webRoot, domSnapshotPath });

  assert.doesNotMatch(context.domSnapshot.content, /screenshot|page\.png/i);
  assert.equal(JSON.parse(context.domSnapshot.content).source, 'agent-browser');
});

test('collectHealContext rejects artifacts without genuine discovery identity or with forbidden locators', () => {
  const scenarios = [
    (artifact) => {
      delete artifact.specSha256;
    },
    (artifact) => {
      artifact.elements[0].candidateLocators[0].locator = 'page.getByRole("button", { name: "@e1" })';
    },
    (artifact) => {
      artifact.elements[0].candidateLocators[0].locator = 'page.getByRole("button").locator("xpath=//button")';
    }
  ];
  for (const [index, mutate] of scenarios.entries()) {
    const { webRoot, testPath } = makeWorkspace();
    const artifact = selectorDiscoveryArtifact();
    mutate(artifact);
    const domSnapshotPath = path.join(webRoot, '.ai-runs', 'dom-discovery', 'run', `invalid-${index}.json`);
    fs.writeFileSync(domSnapshotPath, JSON.stringify(artifact));
    assert.throws(
      () => collectHealContext({ testPath, source: '', evidence: [], webRoot, domSnapshotPath }),
      /selector discovery|specSha256|forbidden|locator/i
    );
  }
});
