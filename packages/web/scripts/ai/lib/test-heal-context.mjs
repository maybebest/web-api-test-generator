import path from 'node:path';

import ts from 'typescript';

import { knownSecretEnvValues } from './gate-environment.mjs';
import { hasForbiddenAgentRef, hasForbiddenLocatorPattern } from './selector-policy.mjs';
import { containsSecretLikeValue, redactSecretMaterial } from './secret-safety.mjs';
import { normalizeScopedRoleCandidate } from './scoped-role-locator.mjs';
import { readVerifiedFile } from './verified-file-read.mjs';

const MAX_IMPORTED_FILES = 4;
const MAX_IMPORTED_FILE_BYTES = 32 * 1024;
const MAX_IMPORTED_CONTEXT_CHARS = 12_000;
const MAX_DOM_SNAPSHOT_BYTES = 64 * 1024;
const MAX_CONTEXT_PATH_CHARS = 512;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ALLOWED_LOCATOR_METHOD = Object.freeze({
  testId: 'getByTestId',
  role: 'getByRole',
  label: 'getByLabel',
  placeholder: 'getByPlaceholder',
  text: 'getByText'
});
const SENSITIVE_ARTIFACT_KEYS = new Set([
  'auth',
  'authentication',
  'authorization',
  'authcookie',
  'authstate',
  'cookie',
  'cookies',
  'extrahttpheaders',
  'har',
  'header',
  'headers',
  'localstorage',
  'screenshot',
  'screenshotpath',
  'screenshots',
  'sessionstorage',
  'storage',
  'storagestate',
  'trace',
  'tracepath',
  'traces',
  'video',
  'videos'
]);
const LOCATOR_METHODS = new Set([
  'getByRole',
  'getByTestId',
  'getByLabel',
  'getByPlaceholder',
  'getByText',
  'locator'
]);

function redactKnownValues(text, secretValues = []) {
  let result = String(text ?? '');
  const ordered = [...new Set(secretValues.filter((value) => typeof value === 'string' && value.length >= 4))]
    .sort((left, right) => right.length - left.length);
  for (const value of ordered) result = result.split(value).join('<redacted>');
  return result;
}

function sanitizedContextString(value, secretValues) {
  if (value === null) return null;
  return redactSecretMaterial(redactKnownValues(value, secretValues));
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireObject(value, label) {
  if (!isPlainObject(value)) throw new Error(`${label} must be a plain object.`);
  return value;
}

function requireOnlyKeys(value, allowed, label) {
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length > 0) throw new Error(`${label} contains unsupported field(s): ${extras.join(', ')}.`);
}

function requireString(value, label, { nullable = false, maxChars } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be a string${nullable ? ' or null' : ''}.`);
  if (maxChars !== undefined && value.length > maxChars) {
    throw new Error(`${label} exceeds the ${maxChars}-character limit.`);
  }
  return value;
}

function containsSensitiveArtifactStructure(value, location = 'artifact') {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = containsSensitiveArtifactStructure(value[index], `${location}[${index}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (!isPlainObject(value)) return undefined;
  for (const [key, entry] of Object.entries(value)) {
    const supportedScreenshotMetadata = location === 'artifact' && key === 'screenshotPath';
    if (supportedScreenshotMetadata) continue;
    const canonical = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (SENSITIVE_ARTIFACT_KEYS.has(canonical)
      || canonical.startsWith('auth')
      || canonical.includes('cookie')
      || canonical.includes('header')
      || canonical.includes('storage')
      || canonical.startsWith('trace')
      || canonical.includes('screenshot')) {
      return `${location}.${key}`;
    }
    const found = containsSensitiveArtifactStructure(entry, `${location}.${key}`);
    if (found) return found;
  }
  return undefined;
}

function normalizeLocatorAudit(value, label) {
  const audit = requireObject(value, label);
  requireOnlyKeys(
    audit,
    new Set(['method', 'snapshotDiagnostics', 'requiredMatchCount']),
    label
  );
  if (audit.method !== 'playwright-locator-count'
    || audit.snapshotDiagnostics !== 'accessibility-snapshot-candidate-equivalence'
    || audit.requiredMatchCount !== 1) {
    throw new Error(`${label} must describe the live Playwright locator-count audit.`);
  }
  return {
    method: 'playwright-locator-count',
    snapshotDiagnostics: 'accessibility-snapshot-candidate-equivalence',
    requiredMatchCount: 1
  };
}

function validateLocatorIdentity(candidate, label) {
  const method = ALLOWED_LOCATOR_METHOD[candidate.type];
  if (!method) throw new Error(`${label}.type is not an allowed selector discovery locator type.`);
  const locator = requireString(candidate.locator, `${label}.locator`);
  if (!new RegExp(`^page\\.${method}\\(`).test(locator.trim())) {
    throw new Error(`${label}.locator does not match its typed Playwright locator method.`);
  }
  if (hasForbiddenAgentRef(locator) || hasForbiddenLocatorPattern(locator)) {
    throw new Error(`${label}.locator contains a forbidden selector-discovery pattern.`);
  }
  return locator;
}

function projectedCandidate(candidate, secretValues) {
  if (candidate.type !== 'scopedRole') {
    if (candidate.scope !== undefined || candidate.target !== undefined || candidate.warningCodes !== undefined) {
      throw new Error('Flat heal locator candidates cannot carry scoped-role fields.');
    }
    return {
      type: candidate.type,
      locator: sanitizedContextString(validateLocatorIdentity(candidate, 'Heal locator candidate'), secretValues),
      preferred: candidate.preferred,
      matchCount: 1,
      matchEvidence: 'playwright-live'
    };
  }
  const normalized = normalizeScopedRoleCandidate(candidate);
  const serializedIdentity = JSON.stringify({
    locator: normalized.locator,
    scope: normalized.scope,
    target: normalized.target
  });
  if (sanitizedContextString(serializedIdentity, secretValues) !== serializedIdentity) {
    throw new Error('Scoped role candidate contains secret-like material.');
  }
  return {
    type: normalized.type,
    locator: normalized.locator,
    scope: normalized.scope,
    target: normalized.target,
    preferred: normalized.preferred,
    matchCount: 1,
    matchEvidence: 'playwright-live',
    warningCodes: normalized.warningCodes
  };
}

function projectSelectorDiscoveryArtifact(artifactValue, secretValues) {
  const artifact = requireObject(artifactValue, 'Heal DOM selector discovery artifact');
  const sensitiveLocation = containsSensitiveArtifactStructure(artifact);
  if (sensitiveLocation) {
    throw new Error(`Heal DOM selector discovery artifact contains sensitive storage/auth/trace data at ${sensitiveLocation}.`);
  }
  requireOnlyKeys(artifact, new Set([
    'specPath', 'specSha256', 'flowId', 'specVersion', 'url', 'capturedAt', 'source',
    'sourceCommands', 'selectorOwnership', 'locatorAudit', 'screenshotPath', 'elements'
  ]), 'Heal DOM selector discovery artifact');
  if (artifact.source !== 'agent-browser' || artifact.selectorOwnership !== 'framework') {
    throw new Error('Heal DOM selector discovery artifact has invalid source or selector ownership.');
  }
  const requiredIdentityStrings = ['specPath', 'flowId', 'specVersion', 'url', 'capturedAt'];
  for (const key of requiredIdentityStrings) {
    if (!requireString(artifact[key], `Heal DOM selector discovery artifact.${key}`).trim()) {
      throw new Error(`Heal DOM selector discovery artifact.${key} must not be empty.`);
    }
  }
  if (!SHA256_PATTERN.test(artifact.specSha256)) {
    throw new Error('Heal DOM selector discovery artifact.specSha256 must be a lowercase SHA-256 digest.');
  }
  try {
    new URL(artifact.url);
  } catch {
    throw new Error('Heal DOM selector discovery artifact.url must be an absolute URL.');
  }
  if (!Number.isFinite(Date.parse(artifact.capturedAt))) {
    throw new Error('Heal DOM selector discovery artifact.capturedAt must be a valid timestamp.');
  }
  if (!Array.isArray(artifact.sourceCommands)
    || artifact.sourceCommands.length === 0
    || artifact.sourceCommands.some((command) => typeof command !== 'string' || !command.trim())) {
    throw new Error('Heal DOM selector discovery artifact.sourceCommands must contain command provenance.');
  }
  if (artifact.screenshotPath !== undefined) {
    const screenshotPath = requireString(
      artifact.screenshotPath,
      'Heal DOM selector discovery artifact.screenshotPath',
      { maxChars: 1_024 }
    );
    if (/[\u0000-\u001f\u007f]/.test(screenshotPath)
      || !/\.(?:png|jpe?g|webp)$/i.test(screenshotPath)
      || /^data:/i.test(screenshotPath)
      || /;base64,/i.test(screenshotPath)) {
      throw new Error('Heal DOM selector discovery artifact.screenshotPath must be image-file metadata only.');
    }
  }
  const locatorAudit = normalizeLocatorAudit(artifact.locatorAudit, 'Heal DOM selector discovery artifact.locatorAudit');
  if (!Array.isArray(artifact.elements)) {
    throw new Error('Heal DOM selector discovery artifact.elements must be an array.');
  }
  const elements = artifact.elements.map((elementValue, elementIndex) => {
    const label = `Heal DOM selector discovery artifact.elements[${elementIndex}]`;
    const element = requireObject(elementValue, label);
    requireOnlyKeys(element, new Set([
      'elementId', 'role', 'accessibleName', 'label', 'placeholder', 'text', 'href', 'testId',
      'attributes', 'snapshotOccurrences', 'candidateLocators'
    ]), label);
    const elementId = requireString(element.elementId, `${label}.elementId`);
    if (!elementId.trim()) throw new Error(`${label}.elementId must not be empty.`);
    if (!isPlainObject(element.attributes)) throw new Error(`${label}.attributes must be a plain object.`);
    for (const [attribute, attributeValue] of Object.entries(element.attributes)) {
      if (typeof attributeValue !== 'string') throw new Error(`${label}.attributes.${attribute} must be a string.`);
    }
    for (const key of ['role', 'accessibleName', 'label', 'placeholder', 'text', 'href', 'testId']) {
      requireString(element[key], `${label}.${key}`, { nullable: true });
    }
    if (!Number.isInteger(element.snapshotOccurrences) || element.snapshotOccurrences < 1) {
      throw new Error(`${label}.snapshotOccurrences must be a positive integer.`);
    }
    if (!Array.isArray(element.candidateLocators)) {
      throw new Error(`${label}.candidateLocators must be an array.`);
    }
    const candidates = element.candidateLocators.map((candidateValue, candidateIndex) => {
      const candidateLabel = `${label}.candidateLocators[${candidateIndex}]`;
      const candidate = requireObject(candidateValue, candidateLabel);
      requireOnlyKeys(candidate, new Set([
        'type', 'locator', 'score', 'reason', 'preferred', 'matchCount', 'unique',
        'snapshotMatchCount', 'snapshotUnique', 'matchEvidence', 'scope', 'target', 'warningCodes'
      ]), candidateLabel);
      if (!Number.isFinite(candidate.score) || typeof candidate.reason !== 'string' || !candidate.reason.trim()) {
        throw new Error(`${candidateLabel} is missing selector-policy score or reason evidence.`);
      }
      if (candidate.preferred !== (candidateIndex === 0)) {
        throw new Error(`${candidateLabel}.preferred is inconsistent with candidate order.`);
      }
      if (!Number.isInteger(candidate.matchCount) || candidate.matchCount < 0
        || candidate.unique !== (candidate.matchCount === 1)
        || !Number.isInteger(candidate.snapshotMatchCount) || candidate.snapshotMatchCount !== 1
        || candidate.snapshotUnique !== true
        || candidate.matchEvidence !== 'playwright-live') {
        throw new Error(`${candidateLabel} is missing consistent live and snapshot uniqueness evidence.`);
      }
      if (candidateIndex === 0 && candidate.matchCount !== 1) {
        throw new Error(`${candidateLabel} is preferred but not unique.`);
      }
      if (candidate.matchCount !== 1) return undefined;
      return projectedCandidate(candidate, secretValues);
    }).filter(Boolean);
    return {
      elementId: sanitizedContextString(elementId, secretValues),
      role: sanitizedContextString(requireString(element.role, `${label}.role`, { nullable: true }), secretValues),
      accessibleName: sanitizedContextString(
        requireString(element.accessibleName, `${label}.accessibleName`, { nullable: true }),
        secretValues
      ),
      label: sanitizedContextString(requireString(element.label, `${label}.label`, { nullable: true }), secretValues),
      placeholder: sanitizedContextString(
        requireString(element.placeholder, `${label}.placeholder`, { nullable: true }),
        secretValues
      ),
      candidateLocators: candidates
    };
  });
  return { source: 'agent-browser', selectorOwnership: 'framework', locatorAudit, elements };
}

function normalizeProjectedSelectorContext(value, secretValues) {
  const context = requireObject(value, 'Heal repository context DOM content');
  requireOnlyKeys(context, new Set(['source', 'selectorOwnership', 'locatorAudit', 'elements']), 'Heal repository context DOM content');
  if (context.source !== 'agent-browser' || context.selectorOwnership !== 'framework') {
    throw new Error('Heal repository context DOM content has invalid source or selector ownership.');
  }
  const locatorAudit = normalizeLocatorAudit(context.locatorAudit, 'Heal repository context DOM content.locatorAudit');
  if (!Array.isArray(context.elements)) throw new Error('Heal repository context DOM content.elements must be an array.');
  const elements = context.elements.map((elementValue, elementIndex) => {
    const label = `Heal repository context DOM content.elements[${elementIndex}]`;
    const element = requireObject(elementValue, label);
    requireOnlyKeys(element, new Set([
      'elementId', 'role', 'accessibleName', 'label', 'placeholder', 'candidateLocators'
    ]), label);
    if (!Array.isArray(element.candidateLocators)) throw new Error(`${label}.candidateLocators must be an array.`);
    const candidateLocators = element.candidateLocators.map((candidateValue, candidateIndex) => {
      const candidateLabel = `${label}.candidateLocators[${candidateIndex}]`;
      const candidate = requireObject(candidateValue, candidateLabel);
      requireOnlyKeys(candidate, new Set([
        'type', 'locator', 'preferred', 'matchCount', 'matchEvidence', 'scope', 'target', 'warningCodes'
      ]), candidateLabel);
      if (typeof candidate.preferred !== 'boolean'
        || candidate.matchCount !== 1
        || candidate.matchEvidence !== 'playwright-live') {
        throw new Error(`${candidateLabel} is not a unique live-audited locator.`);
      }
      return projectedCandidate(candidate, secretValues);
    });
    return {
      elementId: sanitizedContextString(requireString(element.elementId, `${label}.elementId`), secretValues),
      role: sanitizedContextString(requireString(element.role, `${label}.role`, { nullable: true }), secretValues),
      accessibleName: sanitizedContextString(
        requireString(element.accessibleName, `${label}.accessibleName`, { nullable: true }),
        secretValues
      ),
      label: sanitizedContextString(requireString(element.label, `${label}.label`, { nullable: true }), secretValues),
      placeholder: sanitizedContextString(
        requireString(element.placeholder, `${label}.placeholder`, { nullable: true }),
        secretValues
      ),
      candidateLocators
    };
  });
  return { source: 'agent-browser', selectorOwnership: 'framework', locatorAudit, elements };
}

function validContextPath(value, pattern, label, secretValues) {
  const candidate = requireString(value, label, { maxChars: MAX_CONTEXT_PATH_CHARS });
  if (candidate.includes('\\') || candidate.includes('\0') || path.posix.normalize(candidate) !== candidate || !pattern.test(candidate)) {
    throw new Error(`${label} is outside the allowed repository context path.`);
  }
  if (sanitizedContextString(candidate, secretValues) !== candidate) {
    throw new Error(`${label} contains known or secret-like material.`);
  }
  return candidate;
}

export function normalizeHealRepositoryContext(repositoryContext, { secretValues = knownSecretEnvValues() } = {}) {
  const context = requireObject(repositoryContext, 'Heal repository context');
  if (Object.keys(context).length === 0) return {};
  requireOnlyKeys(context, new Set(['importedSources', 'domSnapshot', 'manualChangeRequired']), 'Heal repository context');
  if (!Array.isArray(context.importedSources)) throw new Error('Heal repository context.importedSources must be an array.');
  if (context.importedSources.length > MAX_IMPORTED_FILES) {
    throw new Error(`Heal repository context exceeds the ${MAX_IMPORTED_FILES}-file limit.`);
  }
  let aggregateCharacters = 0;
  let normalizedAggregateCharacters = 0;
  const importedSources = context.importedSources.map((sourceValue, index) => {
    const label = `Heal repository context.importedSources[${index}]`;
    const imported = requireObject(sourceValue, label);
    requireOnlyKeys(imported, new Set(['path', 'sha256', 'excerpt']), label);
    const sourcePath = validContextPath(
      imported.path,
      /^(?:pages|components)\/(?!.*(?:^|\/)\.\.?(?:\/|$)).+\.ts$/,
      `${label}.path`,
      secretValues
    );
    if (!SHA256_PATTERN.test(imported.sha256)) throw new Error(`${label}.sha256 must be a lowercase SHA-256 digest.`);
    const excerpt = requireString(imported.excerpt, `${label}.excerpt`);
    if (Buffer.byteLength(excerpt, 'utf8') > MAX_IMPORTED_FILE_BYTES) {
      throw new Error(`${label}.excerpt exceeds the ${MAX_IMPORTED_FILE_BYTES}-byte per-file limit.`);
    }
    aggregateCharacters += excerpt.length;
    if (aggregateCharacters > MAX_IMPORTED_CONTEXT_CHARS) {
      throw new Error(`Heal repository context exceeds the ${MAX_IMPORTED_CONTEXT_CHARS}-character aggregate limit.`);
    }
    const sanitizedExcerpt = sanitizedContextString(excerpt, secretValues);
    if (Buffer.byteLength(sanitizedExcerpt, 'utf8') > MAX_IMPORTED_FILE_BYTES) {
      throw new Error(`${label}.excerpt exceeds the per-file limit after secret redaction.`);
    }
    normalizedAggregateCharacters += sanitizedExcerpt.length;
    if (normalizedAggregateCharacters > MAX_IMPORTED_CONTEXT_CHARS) {
      throw new Error('Heal repository context exceeds the aggregate limit after secret redaction.');
    }
    return {
      path: sourcePath,
      sha256: imported.sha256,
      excerpt: sanitizedExcerpt
    };
  });
  if (typeof context.manualChangeRequired !== 'boolean') {
    throw new Error('Heal repository context.manualChangeRequired must be boolean.');
  }
  let domSnapshot;
  if (context.domSnapshot !== undefined) {
    const dom = requireObject(context.domSnapshot, 'Heal repository context.domSnapshot');
    requireOnlyKeys(dom, new Set(['path', 'sha256', 'content']), 'Heal repository context.domSnapshot');
    const domPath = validContextPath(
      dom.path,
      /^\.ai-runs\/dom-discovery\/.+\.json$/,
      'Heal repository context.domSnapshot.path',
      secretValues
    );
    if (!SHA256_PATTERN.test(dom.sha256)) {
      throw new Error('Heal repository context.domSnapshot.sha256 must be a lowercase SHA-256 digest.');
    }
    const content = requireString(dom.content, 'Heal repository context.domSnapshot.content');
    if (Buffer.byteLength(content, 'utf8') > MAX_DOM_SNAPSHOT_BYTES) {
      throw new Error(`Heal repository context.domSnapshot.content exceeds the ${MAX_DOM_SNAPSHOT_BYTES}-byte limit.`);
    }
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(`Heal repository context.domSnapshot.content must be valid projected JSON: ${error.message}`);
    }
    const normalizedContent = JSON.stringify(normalizeProjectedSelectorContext(parsed, secretValues));
    if (Buffer.byteLength(normalizedContent, 'utf8') > MAX_DOM_SNAPSHOT_BYTES) {
      throw new Error('Heal repository context.domSnapshot.content exceeds the byte limit after secret redaction.');
    }
    domSnapshot = {
      path: domPath,
      sha256: dom.sha256,
      content: normalizedContent
    };
  }
  return { importedSources, domSnapshot, manualChangeRequired: context.manualChangeRequired };
}

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
      redactKnownValues(String(item ?? '').replace(/\\/g, '/'), secretValues)
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
    if (redactKnownValues(verified.content, secretValues) !== verified.content
      || containsSecretLikeValue(verified.content)) {
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
    let artifact;
    try {
      artifact = JSON.parse(verified.content);
    } catch (error) {
      throw new Error(`Heal DOM snapshot must contain valid JSON: ${error.message}`);
    }
    const content = JSON.stringify(projectSelectorDiscoveryArtifact(artifact, secretValues));
    domSnapshot = {
      path: portableRelative(resolvedWebRoot, resolvedDomSnapshotPath),
      sha256: verified.sha256,
      content
    };
  }

  const locations = evidenceLocations(evidence, secretValues);
  return normalizeHealRepositoryContext({
    importedSources,
    domSnapshot,
    manualChangeRequired: locations.some((value) => /^(?:pages|components)\//.test(value))
  }, { secretValues });
}
