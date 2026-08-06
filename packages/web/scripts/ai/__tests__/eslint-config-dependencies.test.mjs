import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const packageManifest = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
const eslintConfig = fs.readFileSync(new URL('../../../eslint.config.mjs', import.meta.url), 'utf8');

function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

test('web package declares every tool required by its flat ESLint configuration', () => {
  const sourceFile = ts.createSourceFile('eslint.config.mjs', eslintConfig, ts.ScriptTarget.Latest, false);
  const importedPackages = sourceFile.statements
    .filter(ts.isImportDeclaration)
    .map((statement) => statement.moduleSpecifier.text)
    .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('node:'))
    .map(packageName);
  assert.ok(importedPackages.length > 0, 'eslint.config.mjs must expose its imported package dependencies');
  const requiredPackages = new Set(['eslint', ...importedPackages]);

  for (const name of requiredPackages) {
    const version = packageManifest.devDependencies?.[name];
    assert.match(version ?? '', /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, `${name} must be pinned in packages/web/package.json`);
  }
});
