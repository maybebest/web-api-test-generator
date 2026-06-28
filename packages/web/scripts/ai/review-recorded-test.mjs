#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { normalizeRecordingFile } from './lib/recording-parser.mjs';
import {
  classifyLocatorSelector,
  collectConstLiteralIdentifiers,
  collectConstStringIdentifiers,
  collectLocatorIdentifiers,
  collectStringIdentifiers,
  foldStringExpression,
  isCallNamed,
  isConstDeclaration,
  isLiteralExpression,
  isLocatorLikeExpression,
  isStringLiteralLike,
  isTestDefiningSkip,
  nodeText,
  normalizedCallText,
  parseSourceFile,
  propertyName,
  stringValue,
  walk
} from './lib/ts-ast.mjs';

const HEADER_PATTERN = /\/\*\s*recording:\s+([^\s]+)\s+title:(.*?)\s+sha256:([a-f0-9]{64})\s*\*\//i;
const SEMANTIC_LOCATOR_NAMES = new Set(['getByRole', 'getByLabel', 'getByPlaceholder', 'getByText', 'getByTestId']);
// String-selector APIs that exist only on Page/Frame and always take a raw
// selector. They bypass the locator policy entirely, so they are forbidden
// outright in recorded tests.
const PAGE_ONLY_SELECTOR_APIS = new Set(['waitForSelector', '$', '$$']);
// Action APIs whose locator-object form never takes a string first argument
// (locator.click() takes only an options object). A foldable string first
// argument therefore proves the deprecated page.click('selector') form.
const STRING_SELECTOR_ONLY_ACTION_APIS = new Set(['click', 'dblclick', 'check', 'uncheck', 'hover']);
// Action APIs whose locator-object form takes a value string first
// (locator.fill('value')). The page form takes (selector, value), so two
// foldable string arguments or a bare `page` receiver proves the bypass.
const STRING_SELECTOR_VALUE_ACTION_APIS = new Set(['fill', 'type', 'press', 'selectOption', 'setInputFiles']);
// Minimum action fidelity per recorded step type. Tolerant of equivalent
// Playwright idioms (e.g. a recorder click on a checkbox emitted as check()).
const STEP_ACTION_METHODS = new Map([
  ['navigate', ['goto']],
  ['click', ['click', 'check', 'uncheck', 'selectOption']],
  ['doubleClick', ['dblclick']],
  ['change', ['fill', 'type', 'pressSequentially', 'selectOption']],
  ['hover', ['hover']],
  ['keyDown', ['press']],
  ['keyUp', ['press']]
]);
// Matches the locator strings produced by classifyRecorderSelector, e.g.
// page.getByRole("heading", { name: "Checkout" }) or page.getByTestId("x").
const CONTRACT_LOCATOR_PATTERN = /^page\.([A-Za-z]\w*)\(("(?:[^"\\]|\\.)*")(?:,\s*\{\s*name:\s*("(?:[^"\\]|\\.)*")\s*\}\s*)?\)$/;
// Non-defining test-control calls (test.skip(), test.fixme(), test.fail(),
// including condition forms and the describe variants) make Playwright exit 0
// without verifying anything, so the executed gate silently turns green.
const RUNTIME_TEST_CONTROL_PATTERN = /^(?:test|it)(?:\.describe(?:\.serial|\.parallel)?)?\.(?:skip|fixme|fail)$/;
// Alias targets must resolve to dotted identifier paths (test, test.skip,
// it.describe) before they participate in test-control resolution.
const DOTTED_IDENTIFIER_PATH_PATTERN = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const SECRET_PATTERNS = [
  /\bbearer\s+[a-z0-9._-]{10,}/i,
  /\bbasic\s+[A-Za-z0-9+/=]{12,}/i,
  /\b(?:password|passwd|pwd)\s*[:=]\s*['"`][^'"`]{4,}/i,
  /\b(?:api[_-]?key|apikey|client[_-]?secret|secret|access[_-]?token|refresh[_-]?token)\s*[:=]\s*['"`][^'"`]{8,}/i,
  /\btoken\s*[:=]\s*['"`][^'"`]{8,}/i,
  /\bsession(?:id)?\s*[:=]\s*['"`][^'"`]{8,}/i,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  /AKIA[0-9A-Z]{16}/,
  /\bgh[opsur]_[A-Za-z0-9]{20,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/
];

export function reviewRecordedTest({ recordingPath, testPath }) {
  const issues = [];
  const warnings = [];

  let normalized;
  try {
    normalized = normalizeRecordingFile(recordingPath);
  } catch (error) {
    return {
      passed: false,
      issues: [error.message],
      warnings
    };
  }

  const absoluteTestPath = path.resolve(testPath);
  if (!fs.existsSync(absoluteTestPath)) {
    return {
      passed: false,
      issues: [`Recorded test file does not exist: ${testPath}`],
      warnings
    };
  }

  const { content, sourceFile } = parseSourceFile(absoluteTestPath);
  const constLiteralIdentifiers = collectConstLiteralIdentifiers(sourceFile);
  const constStringIdentifiers = collectConstStringIdentifiers(sourceFile);
  const locatorIdentifiers = collectLocatorIdentifiers(sourceFile);
  const stringIdentifiers = collectStringIdentifiers(sourceFile);
  const expectCalls = collectExpectCalls(sourceFile);
  const stepCalls = collectTestStepCalls(sourceFile);
  const stringLiterals = collectFoldedStringLiterals(sourceFile, constStringIdentifiers);
  const context = {
    sourceFile,
    locatorIdentifiers,
    constLiteralIdentifiers,
    stringIdentifiers,
    memberStrings: collectConstObjectStringMembers(sourceFile, constStringIdentifiers),
    variableInitializers: collectVariableInitializers(sourceFile)
  };

  checkHeader(content, normalized, issues);
  checkFixtureImport(sourceFile, issues);
  checkRequiredRecordingSteps(normalized, stepCalls, context, issues);
  checkRequiredAssertions(normalized, stepCalls, context, issues);
  checkExpectCalls(expectCalls, sourceFile, locatorIdentifiers, constLiteralIdentifiers, issues);
  checkTypedValues(normalized, stringLiterals, issues);
  checkForbiddenRuntimePatterns(sourceFile, issues);
  checkForbiddenRecorderArtifacts(content, issues);
  checkLocatorSelectors(sourceFile, stringIdentifiers, locatorIdentifiers, issues, warnings);
  checkStringSelectorActionApis(sourceFile, context, issues);
  checkSemanticLocatorPresence(sourceFile, issues);
  checkSecretAndUrlLiterals(sourceFile, constStringIdentifiers, issues);

  return {
    passed: issues.length === 0,
    issues,
    warnings
  };
}

function checkHeader(content, normalized, issues) {
  const match = content.match(HEADER_PATTERN);
  if (!match) {
    issues.push(
      `Recorded test must include /* recording: ${normalized.recordingPath} title:${normalized.title} sha256:${normalized.sha256} */.`
    );
    return;
  }

  const [, recordingPath, title, hash] = match;
  if (recordingPath !== normalized.recordingPath) {
    issues.push(`Recorded test header references ${recordingPath}, expected ${normalized.recordingPath}.`);
  }

  if (title.trim() !== normalized.title) {
    issues.push(`Recorded test header title is "${title.trim()}", expected "${normalized.title}".`);
  }

  if (hash !== normalized.sha256) {
    issues.push(`Recording drift detected for ${normalized.recordingPath}. expected ${hash}, actual ${normalized.sha256}.`);
  }
}

function checkFixtureImport(sourceFile, issues) {
  let hasFixtureImport = false;

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }

    if (!statement.moduleSpecifier.text.includes('fixtures/test')) {
      continue;
    }

    const namedBindings = statement.importClause.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) {
      continue;
    }

    const names = namedBindings.elements.map((element) => element.name.text);
    hasFixtureImport = names.includes('test') && names.includes('expect');
  }

  if (!hasFixtureImport) {
    issues.push('Recorded test must import test and expect from fixtures/test.');
  }
}

function checkRequiredRecordingSteps(normalized, stepCalls, context, issues) {
  for (const step of normalized.steps) {
    const matching = stepCalls.filter((testStep) => testStep.title.startsWith(`${step.id}:`) || testStep.title.startsWith(`${step.id} `));
    if (matching.length === 0) {
      issues.push(`Missing test.step covering required recording step ${step.id}: ${step.action}.`);
      continue;
    }

    const expectedMethods = STEP_ACTION_METHODS.get(step.type);
    if (!expectedMethods) {
      // waitForElement steps are assertion steps; checkRequiredAssertions owns
      // their body fidelity.
      continue;
    }

    const actionCalls = matching.flatMap((testStep) => collectActionCalls(testStep.body, expectedMethods));
    if (actionCalls.length === 0) {
      issues.push(
        `${step.id} step must perform the recorded ${step.type} action (${expectedMethods
          .map((method) => `.${method}(...)`)
          .join(' / ')}). Title-only test.step bodies are rejected.`
      );
      continue;
    }

    if (step.type === 'change' && step.value !== undefined && step.value !== '') {
      const valueMatched = actionCalls.some((call) => callArgumentsContainValue(call, step.value, context));
      if (!valueMatched) {
        issues.push(
          `${step.id} step must pass the recorded value to its ${expectedMethods.join('/')} call (after const folding).`
        );
      }
    }
  }
}

function checkRequiredAssertions(normalized, stepCalls, context, issues) {
  for (const assertion of normalized.assertions) {
    const matching = stepCalls.filter((step) => step.title.includes(assertion.id));
    if (matching.length === 0) {
      issues.push(`Missing test.step covering required recording assertion ${assertion.id}.`);
      continue;
    }

    const hasValidAssertion = matching.some((step) => {
      const expects = collectExpectCalls(step.body);
      return expects.some((expectCall) =>
        isValidExpectReceiver(expectCall.arguments[0], context.sourceFile, context.locatorIdentifiers, context.constLiteralIdentifiers)
      );
    });

    if (!hasValidAssertion) {
      issues.push(`${assertion.id} step must contain at least one expect(...) on a Locator or Page expression.`);
      continue;
    }

    const contracts = contractLocatorsForAssertion(normalized, assertion);
    if (contracts.length === 0) {
      continue;
    }

    const matchesContractLocator = matching.some((step) => {
      const expects = collectExpectCalls(step.body);
      return expects.some(
        (expectCall) =>
          expectCall.arguments[0] &&
          contracts.some((contract) => expressionTargetsContractLocator(expectCall.arguments[0], contract, context))
      );
    });

    if (!matchesContractLocator) {
      issues.push(
        `${assertion.id} step must assert the recorded locator ${assertion.bestLocator} (same getBy*/locator method and primary argument).`
      );
    }
  }
}

function contractLocatorsForAssertion(normalized, assertion) {
  const step = normalized.steps.find((candidate) => candidate.id === assertion.stepId);
  const locators = [assertion.bestLocator, ...(step?.selectorCandidates ?? []).map((candidate) => candidate.locator)];
  const contracts = [];
  const seen = new Set();

  for (const locator of locators) {
    if (typeof locator !== 'string' || seen.has(locator)) {
      continue;
    }
    seen.add(locator);
    const contract = parseContractLocator(locator);
    if (contract) {
      contracts.push(contract);
    }
  }

  return contracts;
}

function parseContractLocator(locator) {
  const match = locator.match(CONTRACT_LOCATOR_PATTERN);
  if (!match) {
    return undefined;
  }

  try {
    return {
      method: match[1],
      argument: JSON.parse(match[2]),
      name: match[3] === undefined ? undefined : JSON.parse(match[3])
    };
  } catch {
    return undefined;
  }
}

function expressionTargetsContractLocator(expression, contract, context, visitedIdentifiers = new Set()) {
  let found = false;

  walk(expression, (node) => {
    if (found) {
      return;
    }

    // Follow stored locators (const heading = page.getByRole(...)) so the
    // contract check tolerates the variable-binding idiom.
    if (ts.isIdentifier(node) && !visitedIdentifiers.has(node.text)) {
      const initializer = context.variableInitializers.get(node.text);
      if (initializer) {
        visitedIdentifiers.add(node.text);
        if (expressionTargetsContractLocator(initializer, contract, context, visitedIdentifiers)) {
          found = true;
          return;
        }
      }
    }

    if (!ts.isCallExpression(node) || propertyName(node.expression) !== contract.method) {
      return;
    }

    if (foldArgumentString(node.arguments[0], context) !== contract.argument) {
      return;
    }

    if (contract.name !== undefined && !callHasMatchingNameOption(node, contract.name, context)) {
      return;
    }

    found = true;
  });

  return found;
}

function callHasMatchingNameOption(callExpression, expectedName, context) {
  const options = callExpression.arguments[1];
  if (!options || !ts.isObjectLiteralExpression(options)) {
    return false;
  }

  return options.properties.some((property) => {
    if (!ts.isPropertyAssignment(property)) {
      return false;
    }

    const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : undefined;
    if (name !== 'name') {
      return false;
    }

    if (foldArgumentString(property.initializer, context) === expectedName) {
      return true;
    }

    // Tolerate regex name options whose source contains the recorded name.
    return ts.isRegularExpressionLiteral(property.initializer) && property.initializer.text.includes(expectedName);
  });
}

function collectActionCalls(node, methods) {
  const calls = [];
  walk(node, (child) => {
    if (ts.isCallExpression(child) && methods.includes(propertyName(child.expression))) {
      calls.push(child);
    }
  });
  return calls;
}

function callArgumentsContainValue(callExpression, value, context) {
  return callExpression.arguments.some((argument) => {
    const elements = ts.isArrayLiteralExpression(argument) ? argument.elements : [argument];
    return elements.some((element) => {
      const folded = foldArgumentString(element, context);
      return folded !== undefined && folded.includes(value);
    });
  });
}

function checkExpectCalls(expectCalls, sourceFile, locatorIdentifiers, constLiteralIdentifiers, issues) {
  if (expectCalls.length === 0) {
    issues.push('Recorded test must contain meaningful expect assertions.');
    return;
  }

  for (const expectCall of expectCalls) {
    const argument = expectCall.arguments[0];
    if (!argument) {
      issues.push('expect(...) must receive an assertion target.');
      continue;
    }

    if (isExpectPollCall(expectCall)) {
      checkExpectPollCall(expectCall, argument, sourceFile, issues);
      continue;
    }

    if (isLiteralExpression(argument)) {
      issues.push(`Tautological assertion rejected: expect(${nodeText(sourceFile, argument)}).`);
      continue;
    }

    if (ts.isIdentifier(argument) && constLiteralIdentifiers.has(argument.text)) {
      issues.push(`Tautological assertion rejected: expect(${argument.text}) where ${argument.text} is a constant literal.`);
      continue;
    }

    if (!isValidExpectReceiver(argument, sourceFile, locatorIdentifiers, constLiteralIdentifiers)) {
      issues.push(`expect(${nodeText(sourceFile, argument)}) must target a Locator or Page expression.`);
    }
  }
}

function checkTypedValues(normalized, stringLiterals, issues) {
  for (const step of normalized.steps) {
    if (step.type !== 'change' || step.value === undefined || step.value === '') {
      continue;
    }

    if (!stringLiterals.some((literal) => literal.includes(step.value))) {
      issues.push(`Typed recording value for ${step.id} must appear in the generated test data or actions.`);
    }
  }
}

function checkForbiddenRuntimePatterns(sourceFile, issues) {
  const testAliases = collectIdentifierAliases(sourceFile);

  walk(sourceFile, (node) => {
    if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword) {
      issues.push(
        `Forbidden "as any" cast in recorded test: ${nodeText(sourceFile, node)}. Recorded code must be fully typed.`
      );
    }

    if (!ts.isCallExpression(node)) {
      return;
    }

    const callText = normalizedCallText(node.expression, sourceFile);
    // Aliased forms (const t = test; t.skip()) resolve back to their dotted
    // origin so renaming the fixture cannot dodge the test-control screen.
    const resolvedCallText = resolveAliasedCallText(callText, testAliases);
    if (callText === 'setTimeout') {
      issues.push('Forbidden runtime pattern found: setTimeout.');
    }

    if (callText === 'Promise.race') {
      issues.push('Forbidden runtime pattern found: Promise.race.');
    }

    if (callText === 'page.waitForTimeout' || callText.endsWith('.waitForTimeout')) {
      issues.push('Forbidden runtime pattern found: waitForTimeout.');
    }

    if ((callText === 'page.waitForLoadState' || callText.endsWith('.waitForLoadState')) && stringValue(node.arguments[0]) === 'networkidle') {
      issues.push("Forbidden runtime pattern found: waitForLoadState('networkidle').");
    }

    if (/(^|\.)(only)$/.test(resolvedCallText)) {
      issues.push(`Forbidden focused test pattern found: ${callText}.`);
    }

    if (isTestDefiningSkip(node)) {
      issues.push(`Forbidden test-defining control found: ${callText} used to define a test or describe block.`);
    } else if (RUNTIME_TEST_CONTROL_PATTERN.test(resolvedCallText)) {
      // Runtime self-skip bypass: test.skip(), test.skip(condition, reason),
      // test.fixme(), test.fail() inside a body make Playwright exit 0 without
      // verifying anything. Only the test-defining (title + callback) form is
      // even recognizable — and that form is rejected above.
      issues.push(
        `Forbidden runtime test control found: ${callText}. test.skip/test.fixme/test.fail may not be called at runtime (zero-arg or condition forms silently turn the executed gate green); remove the call and fix the test instead.`
      );
    }

    if (isTestUseStorageStateLiteral(node)) {
      issues.push('test.use({ storageState: <literal> }) is forbidden. Bind storage state via a Playwright project.');
    }
  });
}

// Collects identifier aliases (const t = test; let s = test.skip; s = it)
// whose initializer or assignment normalizes to a dotted identifier path.
// First binding wins, mirroring collectStringIdentifiers: a later reassignment
// cannot relabel an already-recorded alias to something benign.
function collectIdentifierAliases(sourceFile) {
  const aliases = new Map();

  const record = (name, target) => {
    if (!aliases.has(name) && name !== target && DOTTED_IDENTIFIER_PATH_PATTERN.test(target)) {
      aliases.set(name, target);
    }
  };

  walk(sourceFile, (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      record(node.name.text, normalizedCallText(node.initializer, sourceFile));
      return;
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      record(node.left.text, normalizedCallText(node.right, sourceFile));
    }
  });

  return aliases;
}

// Rewrites the head identifier of a dotted call path through the alias map
// until it reaches a non-aliased root (t.skip -> test.skip; s -> test.skip).
// The visited set guards alias cycles (const a = b; const b = a;).
function resolveAliasedCallText(callText, aliases) {
  let resolved = callText;
  const visited = new Set();

  for (;;) {
    const [head, ...rest] = resolved.split('.');
    if (!aliases.has(head) || visited.has(head)) {
      return resolved;
    }

    visited.add(head);
    resolved = [aliases.get(head), ...rest].join('.');
  }
}

function checkForbiddenRecorderArtifacts(content, issues) {
  const agentRefs = [...content.matchAll(/@e\d+\b/g)].map((match) => match[0]);
  if (agentRefs.length > 0) {
    issues.push(`Recorded tests must not contain transient browser refs (${[...new Set(agentRefs)].join(', ')}).`);
  }

  if (/@puppeteer\/replay|PuppeteerReplay|puppeteer/i.test(content)) {
    issues.push('Recorded tests must be translated to Playwright Test code, not Puppeteer or raw Recorder replay.');
  }
}

function checkLocatorSelectors(sourceFile, constStringIdentifiers, locatorIdentifiers, issues, warnings) {
  const sourceText = sourceFile.getFullText();
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) {
      return;
    }

    checkPositionalLocatorPick(node, sourceFile, sourceText, locatorIdentifiers, issues, warnings);

    if (propertyName(node.expression) !== 'locator') {
      return;
    }

    const argument = node.arguments[0];
    if (!argument) {
      return;
    }

    const folded = foldStringExpression(argument, constStringIdentifiers);
    if (folded === undefined) {
      // Fail closed (parity with the generated reviewer): a selector the
      // reviewer cannot fold to a static string could be anything — e.g.
      // ['//','button'].join('') resolves to XPath only at runtime. It needs
      // the same explicit exception a raw CSS selector needs.
      if (hasLocatorPolicyException(sourceText, sourceFile, node.getStart(sourceFile))) {
        warnings.push(
          `Unfoldable selector exception accepted for .locator(${nodeText(sourceFile, argument)}). Keep the justification current.`
        );
      } else {
        issues.push(
          `Unresolvable selector argument in .locator(${nodeText(sourceFile, argument)}): the selector must fold to a static string or carry // locator-policy:exception <reason> on the previous line.`
        );
      }
      return;
    }

    const classification = classifyLocatorSelector(folded);
    if (classification === 'xpath') {
      issues.push(`XPath selector forbidden: ${nodeText(sourceFile, argument)}.`);
      return;
    }

    if (classification === 'nth-child') {
      issues.push(`nth-child selector chain forbidden: ${nodeText(sourceFile, argument)}.`);
      return;
    }

    if (classification === 'css') {
      if (hasLocatorPolicyException(sourceText, sourceFile, node.getStart(sourceFile))) {
        warnings.push(
          `CSS selector exception accepted for page.locator(${nodeText(sourceFile, argument)}). Keep the justification current.`
        );
      } else {
        issues.push(
          `CSS selector via page.locator(${nodeText(sourceFile, argument)}) requires // locator-policy:exception <reason> on the previous line. Prefer policy-approved locators.`
        );
      }
    }
  });
}

// Positional picks (.nth(<numeric>), .first(), .last()) on locator-like
// expressions encode DOM order instead of identity and need the same explicit
// // locator-policy:exception justification as raw CSS (locator-policy.md).
function checkPositionalLocatorPick(node, sourceFile, sourceText, locatorIdentifiers, issues, warnings) {
  if (!ts.isPropertyAccessExpression(node.expression) && !ts.isElementAccessExpression(node.expression)) {
    return;
  }

  const name = propertyName(node.expression);
  if (!['nth', 'first', 'last'].includes(name)) {
    return;
  }

  if (name === 'nth' && !(node.arguments[0] && ts.isNumericLiteral(node.arguments[0]))) {
    return;
  }

  const receiver = node.expression.expression;
  if (!isLocatorLikeExpression(receiver, locatorIdentifiers)) {
    return;
  }

  const pickText = `${nodeText(sourceFile, node.expression)}(${node.arguments.map((argument) => nodeText(sourceFile, argument)).join(', ')})`;
  if (hasLocatorPolicyException(sourceText, sourceFile, node.getStart(sourceFile))) {
    warnings.push(`Positional locator pick exception accepted for ${pickText}. Keep the justification current.`);
  } else {
    issues.push(
      `Positional locator pick ${pickText} requires // locator-policy:exception <reason> on the previous line. Prefer a locator that uniquely identifies the element.`
    );
  }
}

function checkStringSelectorActionApis(sourceFile, context, issues) {
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) {
      return;
    }

    const method = propertyName(node.expression);
    if (!method) {
      return;
    }

    if (PAGE_ONLY_SELECTOR_APIS.has(method)) {
      issues.push(
        `String-selector API forbidden: ${nodeText(sourceFile, node)}. Use locator objects and web-first assertions instead of ${method}.`
      );
      return;
    }

    const isSelectorOnlyAction = STRING_SELECTOR_ONLY_ACTION_APIS.has(method);
    const isValueAction = STRING_SELECTOR_VALUE_ACTION_APIS.has(method);
    if (!isSelectorOnlyAction && !isValueAction) {
      return;
    }

    const receiverText = normalizedCallText(receiverExpression(node.expression), sourceFile);
    const firstFolded = foldArgumentString(node.arguments[0], context);
    const secondFolded = foldArgumentString(node.arguments[1], context);

    const stringSelectorForm =
      receiverText === 'page' ||
      (isSelectorOnlyAction && firstFolded !== undefined) ||
      (isValueAction && firstFolded !== undefined && secondFolded !== undefined) ||
      (isValueAction && ['xpath', 'nth-child'].includes(classifyLocatorSelector(firstFolded)));

    if (stringSelectorForm) {
      issues.push(
        `String-selector action API forbidden: ${nodeText(sourceFile, node)}. Recorded tests must call actions on locator objects (e.g. page.getByRole(...).${method}(...)).`
      );
    }
  });
}

function receiverExpression(expression) {
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return expression.expression;
  }

  return undefined;
}

function checkSemanticLocatorPresence(sourceFile, issues) {
  let found = false;
  walk(sourceFile, (node) => {
    if (ts.isCallExpression(node) && SEMANTIC_LOCATOR_NAMES.has(propertyName(node.expression))) {
      found = true;
    }
  });

  if (!found) {
    issues.push('Recorded test must use at least one policy-approved locator.');
  }
}

function checkSecretAndUrlLiterals(sourceFile, constStringIdentifiers, issues) {
  const reportLiteral = (value) => {
    if (isProductionUrl(value)) {
      issues.push(`Hardcoded production URL is forbidden: ${value}`);
    }

    if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
      issues.push('Obvious secret, token, password, bearer token, or session ID detected in recorded test.');
    }

    if (isHighEntropySecretLike(value)) {
      issues.push('High-entropy string literal detected in recorded test.');
    }
  };

  walk(sourceFile, (node) => {
    if (isStringLiteralLike(node)) {
      const value = stringValue(node);
      if (value) {
        reportLiteral(value);
      }
      return;
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const folded = foldStringExpression(node, constStringIdentifiers);
      if (folded) {
        reportLiteral(folded);
      }
      return;
    }

    if (ts.isTemplateExpression(node)) {
      const folded = foldStringExpression(node, constStringIdentifiers);
      if (folded) {
        reportLiteral(folded);
      }
    }
  });
}

function collectExpectCalls(node) {
  const calls = [];
  walk(node, (child) => {
    if (!ts.isCallExpression(child)) {
      return;
    }

    if (isCallNamed(child, 'expect')) {
      calls.push(child);
      return;
    }

    if (
      ts.isPropertyAccessExpression(child.expression) &&
      ts.isIdentifier(child.expression.expression) &&
      child.expression.expression.text === 'expect' &&
      ['poll', 'soft'].includes(child.expression.name.text)
    ) {
      calls.push(child);
    }
  });
  return calls;
}

function collectTestStepCalls(sourceFile) {
  const steps = [];
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || node.expression.getText(sourceFile) !== 'test.step') {
      return;
    }

    const title = stringValue(node.arguments[0]) ?? '';
    const callback = node.arguments[1];
    if (!callback || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
      return;
    }

    steps.push({
      title,
      body: callback.body
    });
  });
  return steps;
}

// Folds an argument expression into a string when possible: literals,
// concatenations, const identifiers (via foldStringExpression), plus member
// access on const object literals (recordedInput.email).
function foldArgumentString(node, context) {
  if (!node) {
    return undefined;
  }

  const folded = foldStringExpression(node, context.stringIdentifiers);
  if (folded !== undefined) {
    return folded;
  }

  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return context.memberStrings.get(normalizedCallText(node, context.sourceFile));
  }

  return undefined;
}

function collectVariableInitializers(sourceFile) {
  const initializers = new Map();
  walk(sourceFile, (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name) && !initializers.has(node.name.text)) {
      initializers.set(node.name.text, node.initializer);
    }
  });
  return initializers;
}

// Collects string members of const object literals so test-data objects like
// `const recordedInput = { email: '...' } as const` fold during fidelity checks.
function collectConstObjectStringMembers(sourceFile, constStringIdentifiers) {
  const members = new Map();

  walk(sourceFile, (node) => {
    if (!ts.isVariableDeclaration(node) || !node.initializer || !ts.isIdentifier(node.name)) {
      return;
    }

    if (!isConstDeclaration(node)) {
      return;
    }

    const initializer = unwrapExpression(node.initializer);
    if (ts.isObjectLiteralExpression(initializer)) {
      addObjectStringMembers(members, node.name.text, initializer, constStringIdentifiers);
    }
  });

  return members;
}

function addObjectStringMembers(members, prefix, objectLiteral, constStringIdentifiers) {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }

    const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : undefined;
    if (!name) {
      continue;
    }

    const value = unwrapExpression(property.initializer);
    if (ts.isObjectLiteralExpression(value)) {
      addObjectStringMembers(members, `${prefix}.${name}`, value, constStringIdentifiers);
      continue;
    }

    const folded = foldStringExpression(value, constStringIdentifiers);
    if (typeof folded === 'string') {
      members.set(`${prefix}.${name}`, folded);
    }
  }
}

function unwrapExpression(node) {
  let current = node;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      (ts.isSatisfiesExpression && ts.isSatisfiesExpression(current)) ||
      ts.isNonNullExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function collectFoldedStringLiterals(sourceFile, constStringIdentifiers) {
  const values = [];
  walk(sourceFile, (node) => {
    if (isStringLiteralLike(node) || ts.isTemplateExpression(node) || ts.isBinaryExpression(node)) {
      const folded = foldStringExpression(node, constStringIdentifiers);
      if (folded !== undefined) {
        values.push(folded);
      }
    }
  });
  return values;
}

function isValidExpectReceiver(argument, sourceFile, locatorIdentifiers, constLiteralIdentifiers) {
  if (!argument) {
    return false;
  }

  if (ts.isIdentifier(argument) && constLiteralIdentifiers.has(argument.text)) {
    return false;
  }

  if (isLiteralExpression(argument)) {
    return false;
  }

  return isLocatorLikeExpression(argument, locatorIdentifiers);
}

function isExpectPollCall(callExpression) {
  const expression = callExpression.expression;
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'expect' &&
    expression.name.text === 'poll'
  );
}

function checkExpectPollCall(expectCall, argument, sourceFile, issues) {
  if (!isPollProducerSuspicious(argument)) {
    return;
  }

  const matcherCall = findMatcherCall(expectCall);
  const matcherArg = matcherCall?.arguments[0];
  if (matcherArg && isLiteralExpression(matcherArg)) {
    issues.push(
      `Tautological expect.poll rejected: producer returns a constant and matcher compares to a literal: ${nodeText(sourceFile, expectCall)}.`
    );
  }
}

function isPollProducerSuspicious(argument) {
  if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
    if (ts.isArrowFunction(argument) && argument.body && !ts.isBlock(argument.body)) {
      return isLiteralExpression(argument.body);
    }

    if (argument.body && ts.isBlock(argument.body)) {
      const statements = argument.body.statements;
      return statements.length === 1 && ts.isReturnStatement(statements[0]) && Boolean(statements[0].expression) && isLiteralExpression(statements[0].expression);
    }
  }

  return false;
}

function findMatcherCall(expectCall) {
  let current = expectCall.parent;
  while (current && !ts.isSourceFile(current)) {
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      isExpectChainRoot(current.expression.expression, expectCall)
    ) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

function isExpectChainRoot(node, expectCall) {
  if (node === expectCall) {
    return true;
  }

  if (ts.isPropertyAccessExpression(node)) {
    return isExpectChainRoot(node.expression, expectCall);
  }

  if (ts.isAwaitExpression(node)) {
    return isExpectChainRoot(node.expression, expectCall);
  }

  if (ts.isCallExpression(node)) {
    return isExpectChainRoot(node.expression, expectCall);
  }

  return false;
}

function isTestUseStorageStateLiteral(callExpression) {
  if (!ts.isPropertyAccessExpression(callExpression.expression)) {
    return false;
  }

  if (callExpression.expression.expression.getText() !== 'test' || callExpression.expression.name.text !== 'use') {
    return false;
  }

  const config = callExpression.arguments[0];
  if (!config || !ts.isObjectLiteralExpression(config)) {
    return false;
  }

  return config.properties.some((property) => {
    if (!ts.isPropertyAssignment(property)) {
      return false;
    }

    const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : undefined;
    return name === 'storageState' && isStringLiteralLike(property.initializer);
  });
}

function hasLocatorPolicyException(sourceText, sourceFile, position) {
  const line = sourceFile.getLineAndCharacterOfPosition(position).line;
  const lines = sourceText.split(/\r?\n/);
  for (let index = line - 1; index >= 0; index -= 1) {
    const candidate = lines[index] ?? '';
    if (!candidate.trim()) {
      continue;
    }
    return /^\s*\/\/\s*locator-policy:exception\s+\S+/i.test(candidate);
  }
  return false;
}

function isProductionUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol.startsWith('http') && !['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname);
  } catch {
    return false;
  }
}

function isHighEntropySecretLike(value) {
  if (value.length < 24 || /\s/.test(value) || !/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/\d/.test(value)) {
    return false;
  }

  const counts = new Map();
  for (const character of value) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }

  return entropy >= 4;
}

function parseArgs(args) {
  const parsed = {
    recording: undefined,
    test: undefined
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--recording') {
      parsed.recording = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--test') {
      parsed.test = args[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return parsed;
}

function printResult(result, testPath) {
  if (result.passed) {
    console.log(`Recorded test review passed: ${testPath}`);
  } else {
    console.error(`Recorded test review failed: ${testPath}`);
    for (const issue of result.issues) {
      console.error(`- ${issue}`);
    }
  }

  if (result.warnings.length > 0) {
    console.warn('Warnings:');
    for (const warning of result.warnings) {
      console.warn(`- ${warning}`);
    }
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/review-recorded-test.mjs --recording <recording.json> --test <test-file>

Reviews a generated Playwright test against a Chrome DevTools Recorder JSON contract.`);
}

function runCli() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    printHelp();
    process.exit(1);
  }

  if (!args.recording || !args.test) {
    printHelp();
    process.exit(1);
  }

  const result = reviewRecordedTest({
    recordingPath: args.recording,
    testPath: args.test
  });
  printResult(result, args.test);

  if (!result.passed) {
    process.exit(1);
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli();
}
