import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectHealContext } from '../lib/test-heal-context.mjs';

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
    '{"button":"Save","authorization":"Bearer abcdefghijklmnop","note":"ordinary-pass"}'
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
  assert.match(context.domSnapshot.content, /Save/);
  assert.doesNotMatch(context.domSnapshot.content, /abcdefghijklmnop|ordinary-pass/);
  assert.equal(context.manualChangeRequired, true);
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
