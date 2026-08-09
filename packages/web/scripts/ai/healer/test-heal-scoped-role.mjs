import crypto from 'node:crypto';

import ts from 'typescript';

import { renderScopedRoleLocator } from '../lib/scoped-role-locator.mjs';

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

// The repository's canonical getByRole option shapes are { name } and
// { name, exact: <boolean literal> } (see the committed generated tests and
// generation guidance). Anything else — dynamic names, shorthand properties,
// spreads, extra options — stays an invalid scoped-role form. Iteration 3
// falsely hard-rejected { name, exact: true } drift heals because only the
// single-property { name } shape parsed as a named call.
function staticRoleOptions(node) {
  if (!ts.isObjectLiteralExpression(node)) return undefined;
  let name;
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) return undefined;
    const key = property.name.getText();
    if (key === 'name') {
      name = staticString(property.initializer);
      if (name === undefined) return undefined;
    } else if (key === 'exact') {
      const kind = property.initializer.kind;
      if (kind !== ts.SyntaxKind.TrueKeyword && kind !== ts.SyntaxKind.FalseKeyword) return undefined;
    } else {
      return undefined;
    }
  }
  return name === undefined ? undefined : { name };
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
  if (node.arguments.length !== 2) return { invalid: true, receiver };
  const options = staticRoleOptions(node.arguments[1]);
  if (!options) return { invalid: true, receiver };
  return { role, name: options.name, receiver };
}

function introducedRoleOnlyScopes(source) {
  const file = ts.createSourceFile('heal-scoped-role.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const identities = new Map();
  const namedIdentities = new Map();
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
    } else if (typeof target?.name === 'string') {
      increment(namedIdentities, JSON.stringify({ role: target.role, name: target.name }));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { identities, namedIdentities, invalidFingerprints };
}

// Accessible (role, name) pairs the heal evidence actually observed. Two
// grounding sources exist: dom-discovery snapshot elements handed to the heal
// as repositoryContext.domSnapshot, and the sanitized baseline-failure DOM
// evidence (accessibility-snapshot lines such as `- button "Details"`).
function evidenceNamePairs({ projected, domEvidence }) {
  const pairs = new Set();
  let available = false;
  const add = (role, name) => {
    if (typeof role === 'string' && role.trim() && typeof name === 'string' && name.trim()) {
      pairs.add(JSON.stringify({ role: role.trim(), name: name.trim() }));
    }
  };
  if (Array.isArray(projected?.elements)) {
    available = true;
    for (const element of projected.elements) {
      add(element?.role, element?.accessibleName);
      for (const candidate of Array.isArray(element?.candidateLocators) ? element.candidateLocators : []) {
        add(candidate?.scope?.role, candidate?.scope?.accessibleName);
        add(candidate?.target?.role, candidate?.target?.accessibleName);
      }
    }
  }
  const snapshotLines = Array.isArray(domEvidence?.pageSnapshot) ? domEvidence.pageSnapshot : [];
  if (snapshotLines.length > 0) {
    available = true;
    for (const line of snapshotLines) {
      if (typeof line !== 'string') continue;
      for (const match of line.matchAll(/([A-Za-z]+)\s+"((?:[^"\\]|\\.)*)"/g)) {
        add(match[1], match[2]);
      }
    }
  }
  return { pairs, available };
}

export function verifyScopedRoleEvidence({
  previousSource,
  healedSource,
  repositoryContext = {},
  domEvidence = undefined
}) {
  const before = introducedRoleOnlyScopes(String(previousSource ?? ''));
  const after = introducedRoleOnlyScopes(String(healedSource ?? ''));
  const introducedInvalid = [...after.invalidFingerprints].some(
    ([fingerprint, count]) => count > (before.invalidFingerprints.get(fingerprint) ?? 0)
  );
  if (introducedInvalid) return { passed: false, reasonCodes: [UNVERIFIED], warningCodes: [] };
  let projected;
  try { projected = JSON.parse(repositoryContext.domSnapshot?.content ?? '{}'); } catch { projected = {}; }

  // Anti-fabrication for named role locators: whenever the heal has observed
  // page evidence, a newly introduced getByRole(role, { name }) must name a
  // (role, accessible name) pair that evidence contains. Without any observed
  // evidence the legacy leniency stands — the runtime verify still executes
  // the candidate against the live page.
  const introducedNamed = [...after.namedIdentities]
    .filter(([identity, count]) => count > (before.namedIdentities.get(identity) ?? 0))
    .map(([identity]) => identity);
  if (introducedNamed.length > 0) {
    const named = evidenceNamePairs({ projected, domEvidence });
    if (named.available && introducedNamed.some((identity) => !named.pairs.has(identity))) {
      return { passed: false, reasonCodes: [UNVERIFIED], warningCodes: [] };
    }
  }

  const introduced = [...after.identities]
    .filter(([identity, count]) => count > (before.identities.get(identity) ?? 0))
    .map(([identity]) => identity);
  if (!introduced.length) return { passed: true, reasonCodes: [], warningCodes: [] };
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
