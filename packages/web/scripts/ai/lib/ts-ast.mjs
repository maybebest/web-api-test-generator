import fs from 'node:fs';

import ts from 'typescript';

export function parseSourceFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return {
    content,
    sourceFile: ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  };
}

export function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

export function nodeText(sourceFile, node) {
  return node.getText(sourceFile);
}

export function propertyName(expression) {
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  if (ts.isElementAccessExpression(expression)) {
    return elementAccessName(expression);
  }

  return undefined;
}

export function elementAccessName(expression) {
  const arg = expression.argumentExpression;
  if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
    return arg.text;
  }

  return undefined;
}

// Resolves a call/member expression into a normalized dotted path, stripping
// parentheses and `as`/`satisfies`/non-null casts and resolving string-literal
// element access (`page["waitForTimeout"]` -> `page.waitForTimeout`). This is
// what makes forbidden-pattern checks resistant to obfuscation via bracket
// access or `as any` casts.
export function normalizedCallText(node, sourceFile) {
  if (!node) {
    return '';
  }

  if (ts.isParenthesizedExpression(node)) {
    return normalizedCallText(node.expression, sourceFile);
  }

  if (ts.isAsExpression(node) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(node))) {
    return normalizedCallText(node.expression, sourceFile);
  }

  if (ts.isTypeAssertionExpression && ts.isTypeAssertionExpression(node)) {
    return normalizedCallText(node.expression, sourceFile);
  }

  if (ts.isNonNullExpression(node)) {
    return normalizedCallText(node.expression, sourceFile);
  }

  if (ts.isIdentifier(node)) {
    return node.text;
  }

  if (node.kind === ts.SyntaxKind.ThisKeyword) {
    return 'this';
  }

  if (ts.isPropertyAccessExpression(node)) {
    return `${normalizedCallText(node.expression, sourceFile)}.${node.name.text}`;
  }

  if (ts.isElementAccessExpression(node)) {
    const left = normalizedCallText(node.expression, sourceFile);
    const name = elementAccessName(node);
    return name === undefined ? `${left}.[computed]` : `${left}.${name}`;
  }

  if (ts.isCallExpression(node)) {
    return normalizedCallText(node.expression, sourceFile);
  }

  return sourceFile ? node.getText(sourceFile) : node.getText();
}

export function isCallNamed(callExpression, name) {
  return propertyName(callExpression.expression) === name || nodeIdentifierName(callExpression.expression) === name;
}

export function nodeIdentifierName(node) {
  if (ts.isIdentifier(node)) {
    return node.text;
  }

  return undefined;
}

// All literal helpers tolerate undefined/null nodes: zero-arg test-family
// calls such as test() or test.skip() reach them with node.arguments[0]
// missing, and a reviewer crash (TypeError) would mask the real issue.
export function isStringLiteralLike(node) {
  return Boolean(node) && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
}

export function stringValue(node) {
  if (isStringLiteralLike(node)) {
    return node.text;
  }

  return undefined;
}

export function isLiteralExpression(node) {
  if (!node) {
    return false;
  }

  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  );
}

export function collectConstLiteralIdentifiers(sourceFile) {
  const identifiers = new Set();

  walk(sourceFile, (node) => {
    if (!ts.isVariableDeclaration(node) || !node.initializer || !ts.isIdentifier(node.name)) {
      return;
    }

    if (!isConstDeclaration(node)) {
      return;
    }

    if (isLiteralExpression(node.initializer)) {
      identifiers.add(node.name.text);
    }
  });

  return identifiers;
}

export function collectLocatorIdentifiers(sourceFile) {
  const identifiers = new Set();

  walk(sourceFile, (node) => {
    if (!ts.isVariableDeclaration(node) || !node.initializer || !ts.isIdentifier(node.name)) {
      return;
    }

    if (isLocatorLikeExpression(node.initializer, identifiers)) {
      identifiers.add(node.name.text);
    }
  });

  return identifiers;
}

export function isConstDeclaration(variableDeclaration) {
  const declarationList = variableDeclaration.parent;
  return Boolean(declarationList.flags & ts.NodeFlags.Const);
}

export function isLocatorLikeExpression(expression, locatorIdentifiers = new Set()) {
  if (ts.isIdentifier(expression)) {
    return expression.text === 'page' || locatorIdentifiers.has(expression.text);
  }

  if (ts.isCallExpression(expression)) {
    const expressionText = expression.expression.getText();
    if (/\.(getByRole|getByLabel|getByPlaceholder|getByText|getByTestId|locator)\s*$/.test(expressionText)) {
      return true;
    }

    return isLocatorLikeExpression(expression.expression, locatorIdentifiers);
  }

  if (ts.isPropertyAccessExpression(expression)) {
    if (expression.expression.getText() === 'page') {
      return true;
    }

    return isLocatorLikeExpression(expression.expression, locatorIdentifiers);
  }

  return false;
}

export function normalizeCode(value) {
  return value.replace(/\s+/g, '').replace(/;$/, '');
}

export function foldStringExpression(node, constStringIdentifiers = new Map()) {
  if (!node) {
    return undefined;
  }

  if (isStringLiteralLike(node)) {
    return node.text;
  }

  if (ts.isIdentifier(node) && constStringIdentifiers.has(node.text)) {
    return constStringIdentifiers.get(node.text);
  }

  if (ts.isParenthesizedExpression(node)) {
    return foldStringExpression(node.expression, constStringIdentifiers);
  }

  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = foldStringExpression(node.left, constStringIdentifiers);
    const right = foldStringExpression(node.right, constStringIdentifiers);
    if (left === undefined || right === undefined) {
      return undefined;
    }
    return left + right;
  }

  if (ts.isTemplateExpression(node)) {
    let result = node.head.text;
    for (const span of node.templateSpans) {
      const part = foldStringExpression(span.expression, constStringIdentifiers);
      if (part === undefined) {
        return undefined;
      }
      result += part + span.literal.text;
    }
    return result;
  }

  return undefined;
}

export function collectConstStringIdentifiers(sourceFile) {
  const map = new Map();

  walk(sourceFile, (node) => {
    if (!ts.isVariableDeclaration(node) || !node.initializer || !ts.isIdentifier(node.name)) {
      return;
    }

    if (!isConstDeclaration(node)) {
      return;
    }

    const folded = foldStringExpression(node.initializer, map);
    if (typeof folded === 'string') {
      map.set(node.name.text, folded);
    }
  });

  return map;
}

// Like collectConstStringIdentifiers but also captures let/var declarations and
// plain `x = '...'` assignments. Used for selector classification so a forbidden
// selector cannot be smuggled past the policy by holding it in a non-const
// variable, parameter default, or later assignment.
export function collectStringIdentifiers(sourceFile) {
  const map = collectConstStringIdentifiers(sourceFile);

  walk(sourceFile, (node) => {
    if (ts.isParameter(node) && node.initializer && ts.isIdentifier(node.name)) {
      const folded = foldStringExpression(node.initializer, map);
      if (typeof folded === 'string' && !map.has(node.name.text)) {
        map.set(node.name.text, folded);
      }
      return;
    }

    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      const folded = foldStringExpression(node.initializer, map);
      if (typeof folded === 'string' && !map.has(node.name.text)) {
        map.set(node.name.text, folded);
      }
      return;
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      const folded = foldStringExpression(node.right, map);
      if (typeof folded === 'string' && !map.has(node.left.text)) {
        map.set(node.left.text, folded);
      }
    }
  });

  return map;
}

const SUSPICIOUS_CSS_SUBSTRINGS = [':nth-child(', ':nth-of-type(', ':nth-last-child('];
const XPATH_PREFIXES = ['xpath=', '//', '..', './'];

export function classifyLocatorSelector(value) {
  if (typeof value !== 'string') {
    return 'unknown';
  }

  const trimmed = value.trim();
  if (XPATH_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return 'xpath';
  }

  if (SUSPICIOUS_CSS_SUBSTRINGS.some((substr) => trimmed.includes(substr))) {
    return 'nth-child';
  }

  if (trimmed.length === 0) {
    return 'unknown';
  }

  return 'css';
}

// Local aliases of the test/it runner objects (and of their members), so the
// skip/fixme/fail/only checks cannot be evaded by `const t = test; t.skip()`,
// `const { skip } = test; skip()`, or `import { test as t } ...`. Returns a
// Map from local identifier name to its canonical dotted path (e.g.
// `t` -> `test`, `s` -> `test.skip`). Aliases resolve transitively in
// document order, so `const u = t;` after `const t = test;` also maps.
export function collectTestAliasIdentifiers(sourceFile) {
  const roots = new Set(['test', 'it']);
  const aliases = new Map();

  const resolveCanonicalPath = (node) => {
    const text = normalizedCallText(node, sourceFile);
    if (!text) {
      return undefined;
    }

    const segments = text.split('.');
    const root = segments[0];
    const canonicalRoot = roots.has(root) ? root : aliases.get(root);
    if (!canonicalRoot) {
      return undefined;
    }

    return [canonicalRoot, ...segments.slice(1)].join('.');
  };

  walk(sourceFile, (node) => {
    // import { test as t } from '...': `t` behaves exactly like `test`.
    if (ts.isImportSpecifier(node)) {
      const importedName = (node.propertyName ?? node.name).text;
      if (roots.has(importedName) && node.name.text !== importedName) {
        aliases.set(node.name.text, importedName);
      }
      return;
    }

    if (!ts.isVariableDeclaration(node) || !node.initializer) {
      return;
    }

    if (ts.isIdentifier(node.name)) {
      const canonical = resolveCanonicalPath(node.initializer);
      if (canonical && !roots.has(node.name.text)) {
        aliases.set(node.name.text, canonical);
      }
      return;
    }

    // const { skip } = test; / const { skip: s } = test;
    if (ts.isObjectBindingPattern(node.name)) {
      const base = resolveCanonicalPath(node.initializer);
      if (!base) {
        return;
      }

      for (const element of node.name.elements) {
        if (!ts.isBindingElement(element) || !ts.isIdentifier(element.name)) {
          continue;
        }

        const propertyNode = element.propertyName ?? element.name;
        const property =
          ts.isIdentifier(propertyNode) || ts.isStringLiteral(propertyNode) ? propertyNode.text : undefined;
        if (property) {
          aliases.set(element.name.text, `${base}.${property}`);
        }
      }
    }
  });

  return aliases;
}

// Rewrites the leading segment of a normalized dotted call path through the
// alias map (`t.skip` -> `test.skip`, `s` -> `test.skip`). Identity when the
// root is not an alias.
export function canonicalizeTestCallText(callText, aliases = new Map()) {
  if (!callText) {
    return callText;
  }

  const segments = callText.split('.');
  const mapped = aliases.get(segments[0]);
  if (!mapped) {
    return callText;
  }

  return [mapped, ...segments.slice(1)].join('.');
}

export function isTestDefiningSkip(callExpression, aliases = new Map()) {
  if (!ts.isCallExpression(callExpression)) {
    return false;
  }

  // Canonicalized dotted path: resolves bracket access, casts, and local
  // aliases (`const t = test; t.skip('title', cb)`).
  const canonical = canonicalizeTestCallText(normalizedCallText(callExpression.expression), aliases);
  const segments = canonical.split('.');
  if (segments.length < 2) {
    return false;
  }

  const memberName = segments[segments.length - 1];
  if (!['skip', 'fixme', 'fail', 'only'].includes(memberName)) {
    return false;
  }

  const receiverText = segments.slice(0, -1).join('.');
  if (receiverText !== 'test' && receiverText !== 'it' && !receiverText.endsWith('.describe')) {
    return false;
  }

  if (callExpression.arguments.length < 2) {
    return false;
  }

  const titleArgument = callExpression.arguments[0];
  const callbackArgument = callExpression.arguments[callExpression.arguments.length - 1];
  return (
    isStringLiteralLike(titleArgument) &&
    (ts.isArrowFunction(callbackArgument) || ts.isFunctionExpression(callbackArgument))
  );
}

