import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import ts from 'typescript';

import {
  TEMPLATE_INTERPOLATION_WILDCARD,
  parseSourceFile,
  stringValue,
  stringValueWithTemplatePlaceholders,
  walk
} from '../lib/ts-ast.mjs';

function firstTitleArgument(code) {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ts-ast-')), 'sample.ts');
  fs.writeFileSync(filePath, code);
  const { sourceFile } = parseSourceFile(filePath);
  let argument;
  walk(sourceFile, (node) => {
    if (!argument && ts.isCallExpression(node) && node.arguments.length > 0) {
      argument = node.arguments[0];
    }
  });
  return argument;
}

test('stringValueWithTemplatePlaceholders folds template static spans around a neutral wildcard', () => {
  const argument = firstTitleArgument('test.step(`Act AC-002: submit for ${dataCase.email} now`, async () => {});');

  const folded = stringValueWithTemplatePlaceholders(argument);

  assert.equal(folded, `Act AC-002: submit for ${TEMPLATE_INTERPOLATION_WILDCARD} now`);
  // The static parts stay intact for substring and AC-### token checks.
  assert.match(folded, /\bAC-\d{3}\b/);
  assert.ok(folded.includes('Act AC-002: submit for '));
  // Baseline stringValue still refuses template expressions (unchanged semantics).
  assert.equal(stringValue(argument), undefined);
});

test('the interpolation wildcard cannot fake or complete an AC id', () => {
  const interpolatedId = firstTitleArgument('test.step(`Arrange ${acId}: open page`, async () => {});');
  assert.doesNotMatch(stringValueWithTemplatePlaceholders(interpolatedId), /\bAC-\d{3}\b/);

  const splitId = firstTitleArgument('test.step(`Arrange AC-${part}001: open page`, async () => {});');
  assert.doesNotMatch(stringValueWithTemplatePlaceholders(splitId), /\bAC-\d{3}\b/);

  assert.doesNotMatch(TEMPLATE_INTERPOLATION_WILDCARD, /[A-Za-z0-9-]/);
});

test('stringValueWithTemplatePlaceholders keeps plain literal behavior identical to stringValue', () => {
  const literal = firstTitleArgument("test.step('Assert AC-003: outcome', async () => {});");
  assert.equal(stringValueWithTemplatePlaceholders(literal), 'Assert AC-003: outcome');
  assert.equal(stringValueWithTemplatePlaceholders(undefined), undefined);
});
