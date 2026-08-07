import crypto from 'node:crypto';

import ts from 'typescript';

const UNVERIFIED = 'UNVERIFIED_SCOPED_ROLE_LOCATOR';
const UNNAMED = 'SCOPED_ROLE_TARGET_UNNAMED';

function staticString(node) {
  return node && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function unwrapExpression(node) {
  let current = node;
  while (current && (ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current))) {
    current = current.expression;
  }
  return current;
}

function roleCall(node) {
  if (!ts.isCallExpression(node)) return undefined;
  const access = unwrapExpression(node.expression);
  let receiver;
  let unsupportedAccess = false;
  if (ts.isPropertyAccessExpression(access) && access.name.text === 'getByRole') {
    receiver = unwrapExpression(access.expression);
  } else if (ts.isElementAccessExpression(access)) {
    receiver = unwrapExpression(access.expression);
    unsupportedAccess = true;
  } else {
    return undefined;
  }
  if (unsupportedAccess || node.questionDotToken || access.questionDotToken) {
    return { invalid: true, receiver };
  }
  const role = staticString(node.arguments[0]);
  if (!role) return { invalid: true, receiver };
  if (node.arguments.length === 1) return { role, name: null, receiver };
  if (node.arguments.length !== 2 || !ts.isObjectLiteralExpression(node.arguments[1])) {
    return { invalid: true, receiver };
  }
  const properties = node.arguments[1].properties;
  if (properties.length !== 1 || !ts.isPropertyAssignment(properties[0])
    || properties[0].name.getText() !== 'name') return { invalid: true, receiver };
  const name = staticString(properties[0].initializer);
  return name ? { role, name, receiver } : { invalid: true, receiver };
}

function introducedRoleOnlyScopes(source) {
  const file = ts.createSourceFile('heal-scoped-role.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const identities = new Set();
  const invalidFingerprints = new Map();
  const constBindings = [];
  const scopeAliases = [];
  const printer = ts.createPrinter({ removeComments: true });
  const printed = (node) => printer.printNode(ts.EmitHint.Unspecified, node, file);
  const addInvalid = (node, dependencies = []) => {
    const fingerprint = crypto.createHash('sha256')
      .update([node, ...dependencies].map(printed).join('\n'))
      .digest('hex');
    invalidFingerprints.set(fingerprint, (invalidFingerprints.get(fingerprint) ?? 0) + 1);
  };
  const lexicalContainer = (node) => {
    let current = node;
    while (current && !ts.isBlock(current) && !ts.isSourceFile(current)) current = current.parent;
    return current;
  };
  const referencedBindings = (root) => {
    const references = new Set();
    const visitReference = (node) => {
      if (ts.isIdentifier(node)) {
        const binding = constBindings.find((candidate) => candidate.name === node.text
          && candidate.container === lexicalContainer(node)
          && candidate.declaration.end < node.pos);
        if (binding) references.add(binding);
      }
      ts.forEachChild(node, visitReference);
    };
    visitReference(root);
    return [...references];
  };
  const fingerprintDependencies = (root) => {
    const direct = referencedBindings(root);
    const oneLevel = direct.flatMap((binding) => referencedBindings(binding.initializer));
    return [...new Set([...direct, ...oneLevel])]
      .sort((left, right) => left.declaration.pos - right.declaration.pos)
      .map((binding) => binding.initializer);
  };
  const collectAliases = (node) => {
    if (ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && ts.isVariableDeclarationList(node.parent)
      && (node.parent.flags & ts.NodeFlags.Const) !== 0) {
      const initializer = unwrapExpression(node.initializer);
      const binding = {
        name: node.name.text,
        declaration: node,
        initializer,
        container: lexicalContainer(node)
      };
      constBindings.push(binding);
      const call = roleCall(initializer);
      if (call) scopeAliases.push(binding);
    }
    ts.forEachChild(node, collectAliases);
  };
  collectAliases(file);
  const visit = (node) => {
    const outer = roleCall(node);
    if (outer) {
      const scope = roleCall(outer.receiver);
      const alias = ts.isIdentifier(outer.receiver)
        ? scopeAliases.find((candidate) => candidate.name === outer.receiver.text
          && candidate.container === lexicalContainer(node)
          && candidate.declaration.end < node.pos)
        : undefined;
      if (scope) {
        const grandScope = roleCall(scope.receiver);
        if (outer.invalid || scope.invalid || grandScope) {
          addInvalid(node, fingerprintDependencies(node));
        } else if (outer.name === null) {
          identities.add(JSON.stringify({
            scope: { role: scope.role, accessibleName: scope.name },
            target: { role: outer.role, accessibleName: null }
          }));
        }
      } else if (alias) {
        addInvalid(node, fingerprintDependencies(node));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { identities, invalidFingerprints };
}

export function verifyScopedRoleEvidence({ previousSource, healedSource, repositoryContext = {} }) {
  const before = introducedRoleOnlyScopes(String(previousSource ?? ''));
  const after = introducedRoleOnlyScopes(String(healedSource ?? ''));
  const introducedInvalid = [...after.invalidFingerprints].some(
    ([fingerprint, count]) => count > (before.invalidFingerprints.get(fingerprint) ?? 0)
  );
  if (introducedInvalid) return { passed: false, reasonCodes: [UNVERIFIED], warningCodes: [] };
  const introduced = [...after.identities].filter((identity) => !before.identities.has(identity));
  if (!introduced.length) return { passed: true, reasonCodes: [], warningCodes: [] };
  let projected;
  try { projected = JSON.parse(repositoryContext.domSnapshot?.content ?? '{}'); } catch { projected = {}; }
  const audited = new Set((projected.elements ?? []).flatMap((element) =>
    (element.candidateLocators ?? [])
      .filter((candidate) => candidate.type === 'scopedRole'
        && candidate.matchCount === 1
        && candidate.matchEvidence === 'playwright-live')
      .map((candidate) => JSON.stringify({ scope: candidate.scope, target: candidate.target }))));
  if (introduced.some((identity) => !audited.has(identity))) {
    return { passed: false, reasonCodes: [UNVERIFIED], warningCodes: [] };
  }
  return { passed: true, reasonCodes: [], warningCodes: [UNNAMED] };
}
