import path from 'node:path';

import ts from 'typescript';

import { knownSecretEnvValues } from './gate-environment.mjs';
import { containsSecretLikeValue, redactSecretMaterial } from './secret-safety.mjs';
import { redactKnownSecretValues } from './test-heal.mjs';
import { readVerifiedFile } from './verified-file-read.mjs';

const MAX_IMPORTED_FILES = 4;
const MAX_IMPORTED_FILE_BYTES = 32 * 1024;
const MAX_IMPORTED_CONTEXT_CHARS = 12_000;
const MAX_DOM_SNAPSHOT_BYTES = 64 * 1024;
const LOCATOR_METHODS = new Set([
  'getByRole',
  'getByTestId',
  'getByLabel',
  'getByPlaceholder',
  'getByText',
  'locator'
]);

function pathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function portableRelative(root, candidate) {
  return path.relative(root, candidate).split(path.sep).join('/');
}

function exportedClass(node) {
  return ts.isClassDeclaration(node)
    && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function methodContainsLocator(method) {
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (LOCATOR_METHODS.has(node.expression.name.text)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(method);
  return found;
}

function selectedClassMembers(classNode) {
  return classNode.members.filter((member) => (
    ts.isConstructorDeclaration(member)
    || (ts.isMethodDeclaration(member) && methodContainsLocator(member))
  ));
}

// Each member is appended whole. When the next member would cross the budget,
// the excerpt stops instead of slicing executable text in the middle.
function extractPageObjectExcerpt(source, fileName, maxChars) {
  if (maxChars <= 0) return '';
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let excerpt = '';
  for (const classNode of sourceFile.statements.filter(exportedClass)) {
    const members = selectedClassMembers(classNode);
    if (members.length === 0) continue;
    const prefix = `${source.slice(classNode.getStart(sourceFile), classNode.members.pos).trimEnd()}\n`;
    const suffix = '\n}';
    const separator = excerpt ? '\n\n' : '';
    if (excerpt.length + separator.length + prefix.length + suffix.length > maxChars) break;

    let classExcerpt = prefix;
    let addedMembers = 0;
    for (const member of members) {
      const memberText = member.getFullText(sourceFile).trimEnd();
      if (excerpt.length + separator.length + classExcerpt.length + memberText.length + suffix.length > maxChars) break;
      classExcerpt += memberText;
      addedMembers += 1;
    }
    if (addedMembers === 0) break;
    classExcerpt += suffix;
    excerpt += `${separator}${classExcerpt}`;
    if (excerpt.length >= maxChars) break;
  }
  return excerpt;
}

function relativeImportSpecifiers(source, testPath) {
  const sourceFile = ts.createSourceFile(testPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specifiers = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (specifier.startsWith('./') || specifier.startsWith('../')) specifiers.push(specifier);
  }
  return specifiers;
}

function resolveImportedTypeScript(specifier, containingFile) {
  const compilerOptions = {
    allowImportingTsExtensions: true,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext
  };
  const resolution = ts.resolveModuleName(specifier, containingFile, compilerOptions, ts.sys).resolvedModule;
  const resolved = resolution?.resolvedFileName ? path.resolve(resolution.resolvedFileName) : undefined;
  if (!resolved || !resolved.endsWith('.ts') || resolved.endsWith('.d.ts')) return undefined;
  return resolved;
}

function evidenceLocations(evidence, secretValues) {
  const locations = new Set();
  const pattern = /(?:^|\s)((?:pages|components)\/[^:\s]+\.ts):\d+:\d+/g;
  for (const item of Array.isArray(evidence) ? evidence : []) {
    const sanitized = redactSecretMaterial(
      redactKnownSecretValues(String(item ?? '').replace(/\\/g, '/'), secretValues)
    );
    for (const match of sanitized.matchAll(pattern)) locations.add(match[1]);
  }
  return [...locations];
}

export function collectHealContext({
  testPath,
  source,
  evidence,
  webRoot,
  domSnapshotPath,
  secretValues = knownSecretEnvValues()
}) {
  const resolvedWebRoot = path.resolve(webRoot);
  const containingFile = path.resolve(resolvedWebRoot, String(testPath ?? ''));
  const importedSources = [];
  const seenFiles = new Set();
  let remainingCharacters = MAX_IMPORTED_CONTEXT_CHARS;

  for (const specifier of relativeImportSpecifiers(String(source ?? ''), String(testPath ?? ''))) {
    const resolvedFile = resolveImportedTypeScript(specifier, containingFile);
    if (!resolvedFile || seenFiles.has(resolvedFile)) continue;
    seenFiles.add(resolvedFile);

    if (!pathInside(resolvedFile, resolvedWebRoot)) {
      throw new Error(`Heal imported source resolves outside the workspace: ${resolvedFile}`);
    }
    const relativeFile = portableRelative(resolvedWebRoot, resolvedFile);
    const rootName = relativeFile.split('/', 1)[0];
    if (rootName !== 'pages' && rootName !== 'components') continue;
    if (importedSources.length >= MAX_IMPORTED_FILES) break;

    const verified = readVerifiedFile({
      filePath: resolvedFile,
      rootPath: path.join(resolvedWebRoot, rootName),
      maxBytes: MAX_IMPORTED_FILE_BYTES,
      captureBytes: MAX_IMPORTED_FILE_BYTES,
      label: 'Heal imported source'
    });
    if (containsSecretLikeValue(verified.content)) {
      throw new Error(`Heal imported source contains secret-like material: ${relativeFile}`);
    }
    const excerpt = extractPageObjectExcerpt(verified.content, relativeFile, remainingCharacters);
    importedSources.push({ path: relativeFile, sha256: verified.sha256, excerpt });
    remainingCharacters -= excerpt.length;
  }

  let domSnapshot;
  if (domSnapshotPath) {
    const resolvedDomSnapshotPath = path.isAbsolute(domSnapshotPath)
      ? path.resolve(domSnapshotPath)
      : path.resolve(resolvedWebRoot, domSnapshotPath);
    if (path.extname(resolvedDomSnapshotPath).toLowerCase() !== '.json') {
      throw new Error('Heal DOM snapshot must be a JSON text artifact, not a trace or screenshot.');
    }
    const verified = readVerifiedFile({
      filePath: resolvedDomSnapshotPath,
      rootPath: path.join(resolvedWebRoot, '.ai-runs', 'dom-discovery'),
      maxBytes: MAX_DOM_SNAPSHOT_BYTES,
      captureBytes: MAX_DOM_SNAPSHOT_BYTES,
      label: 'Heal DOM snapshot'
    });
    try {
      JSON.parse(verified.content);
    } catch (error) {
      throw new Error(`Heal DOM snapshot must contain valid JSON: ${error.message}`);
    }
    const content = redactSecretMaterial(redactKnownSecretValues(verified.content, secretValues));
    domSnapshot = {
      path: portableRelative(resolvedWebRoot, resolvedDomSnapshotPath),
      sha256: verified.sha256,
      content
    };
  }

  const locations = evidenceLocations(evidence, secretValues);
  return {
    importedSources,
    domSnapshot,
    manualChangeRequired: locations.some((value) => /^(?:pages|components)\//.test(value))
  };
}
