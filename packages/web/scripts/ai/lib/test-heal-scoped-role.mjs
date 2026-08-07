import crypto from 'node:crypto';

import ts from 'typescript';

import { renderScopedRoleLocator } from './scoped-role-locator.mjs';

const UNVERIFIED = 'UNVERIFIED_SCOPED_ROLE_LOCATOR';
const UNNAMED = 'SCOPED_ROLE_TARGET_UNNAMED';

function staticString(node) {
  return node && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function unwrapCallee(node) {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
    || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)
    || ts.isSatisfiesExpression(node)) node = node.expression;
  return node;
}

function roleCall(node) {
  if (!ts.isCallExpression(node)) return undefined;
  const expression = node.expression;
  const access = unwrapCallee(expression);
  let receiver;
  if (ts.isPropertyAccessExpression(access) && access.name.text === 'getByRole') {
    receiver = access.expression;
    if (access !== expression) return { invalid: true, receiver, strict: true };
  } else if (ts.isElementAccessExpression(access)) {
    const key = staticString(access.argumentExpression);
    if (key !== undefined && key !== 'getByRole') return undefined;
    return { invalid: true, receiver: access.expression, strict: true };
  } else {
    return undefined;
  }
  if (node.questionDotToken || access.questionDotToken) {
    return { invalid: true, receiver, strict: true };
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
  const identities = new Map();
  const invalidFingerprints = new Map();
  const printer = ts.createPrinter({ removeComments: true });
  const printed = (node) => printer.printNode(ts.EmitHint.Unspecified, node, file);
  const increment = (counts, key) => counts.set(key, (counts.get(key) ?? 0) + 1);
  const addInvalid = (node) => {
    const fingerprint = crypto.createHash('sha256')
      .update(printed(node))
      .digest('hex');
    increment(invalidFingerprints, fingerprint);
  };
  const isPage = (node) => ts.isIdentifier(node) && node.text === 'page';
  const visit = (node) => {
    const target = roleCall(node);
    if (target?.invalid) {
      if (target.strict || !isPage(target.receiver)) addInvalid(node);
    } else if (target?.name === null && !isPage(target.receiver)) {
      const scope = roleCall(target.receiver);
      if (!scope || scope.invalid || !isPage(scope.receiver)) {
        addInvalid(node);
      } else {
        increment(identities, renderScopedRoleLocator({
          scope: { role: scope.role, accessibleName: scope.name },
          target: { role: target.role, accessibleName: null }
        }));
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
  const introduced = [...after.identities]
    .filter(([identity, count]) => count > (before.identities.get(identity) ?? 0))
    .map(([identity]) => identity);
  if (!introduced.length) return { passed: true, reasonCodes: [], warningCodes: [] };
  let projected;
  try { projected = JSON.parse(repositoryContext.domSnapshot?.content ?? '{}'); } catch { projected = {}; }
  const audited = new Set((projected.elements ?? []).flatMap((element) =>
    (element.candidateLocators ?? [])
      .filter((candidate) => candidate.type === 'scopedRole'
        && candidate.matchCount === 1
        && candidate.matchEvidence === 'playwright-live')
      .map((candidate) => candidate.locator)));
  if (introduced.some((identity) => !audited.has(identity))) {
    return { passed: false, reasonCodes: [UNVERIFIED], warningCodes: [] };
  }
  return { passed: true, reasonCodes: [], warningCodes: [UNNAMED] };
}
