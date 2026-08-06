import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const packageManifest = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));

test('web package declares every tool required by its flat ESLint configuration', () => {
  const expected = {
    '@eslint/js': '9.39.5',
    eslint: '9.39.5',
    'eslint-plugin-playwright': '2.10.5',
    globals: '16.4.0',
    'typescript-eslint': '8.62.1'
  };

  for (const [name, version] of Object.entries(expected)) {
    assert.equal(packageManifest.devDependencies?.[name], version, `${name} must be pinned in packages/web/package.json`);
  }
});
