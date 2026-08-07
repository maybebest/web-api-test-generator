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
  } else if (ts.isElementAccessExpression(access) && staticString(access.argumentExpression) === 'getByRole') {
    receiver = unwrapExpression(access.expression);
    unsupportedAccess = true;
  } else {
    return undefined;
  }
  if (unsupportedAccess) return { invalid: true, receiver };
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
  let invalid = false;
  const visit = (node) => {
    const outer = roleCall(node);
    if (outer) {
      const scope = roleCall(outer.receiver);
      if (scope) {
        const grandScope = roleCall(scope.receiver);
        if (outer.invalid || scope.invalid || grandScope) {
          invalid = true;
        } else if (outer.name === null) {
          identities.add(JSON.stringify({
            scope: { role: scope.role, accessibleName: scope.name },
            target: { role: outer.role, accessibleName: null }
          }));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { identities, invalid };
}

export function verifyScopedRoleEvidence({ previousSource, healedSource, repositoryContext = {} }) {
  const before = introducedRoleOnlyScopes(String(previousSource ?? ''));
  const after = introducedRoleOnlyScopes(String(healedSource ?? ''));
  if (after.invalid) return { passed: false, reasonCodes: [UNVERIFIED], warningCodes: [] };
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
