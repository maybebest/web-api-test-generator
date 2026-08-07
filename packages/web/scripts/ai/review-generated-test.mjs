#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import {
  GENERATION_MODES,
  parseFlowSpec,
  parseSpecHeader,
  readSpecFile,
  resolveGenerationMode,
  specGenerationMode,
  specSha256
} from './lib/spec-parser.mjs';
import {
  canonicalizeTestCallText,
  classifyLocatorSelector,
  collectConstLiteralIdentifiers,
  collectConstStringIdentifiers,
  collectLocatorIdentifiers,
  collectStringIdentifiers,
  collectTestAliasIdentifiers,
  foldStringExpression,
  isCallNamed,
  isLiteralExpression,
  isLocatorLikeExpression,
  isStringLiteralLike,
  isTestDefiningSkip,
  nodeText,
  normalizeCode,
  normalizedCallText,
  parseSourceFile,
  propertyName,
  stringValue,
  walk
} from './lib/ts-ast.mjs';
import { validateSpecFile } from './validate-flow-spec.mjs';
import { containsSecretLikeValue } from './lib/secret-safety.mjs';
import { checkGeneratedRuntimeCapabilities } from './lib/generated-capability-policy.mjs';

const SEMANTIC_LOCATOR_NAMES = new Set(['getByRole', 'getByLabel', 'getByPlaceholder', 'getByText', 'getByTestId']);
// Precondition helpers whose arrangement is NOT yet achievable against the live environment, so a
// generated test referencing them can never execute for real. History: setPlanHeroSkus and
// setPlanMeasurementSkus were removed from this set on 2026-07-03 after being implemented against
// captured GraphQL contracts AND live-proven (every emitted E2E data case passes against dev — real
// catalogue skuIds, live planningAI session via ensurePlanningSession, healed locators, no-op
// SET_SKUS guard). setChannelMaxHeroSkus stays: its arrange needs channel-media resolution that this
// dev catalogue cannot satisfy (no 'Offsite Display' media; E2E_MP_*_CHANNEL unset) plus an
// admin_editMedia write to shared config — verified failing live. The check is reference-based
// (below) so no alias/indirection dodges it; delist a helper only with live green proof.
const CRITICAL_PRECONDITION_HELPERS = new Set([
  'setChannelMaxHeroSkus'
]);
// Deprecated string-selector action/query APIs on the Page receiver. The
// page.* form of these methods always takes a raw selector string, bypassing
// the locator policy entirely (page.click('xpath=//button') sails past the
// .locator() classification). Generated tests must own locators in Page
// Objects, so any page-receiver call of these APIs is forbidden outright —
// mirroring the recorded reviewer's checkStringSelectorActionApis.
const PAGE_STRING_SELECTOR_ACTION_APIS = new Set([
  'click',
  'dblclick',
  'fill',
  'type',
  'press',
  'check',
  'uncheck',
  'selectOption',
  'hover',
  'setInputFiles',
  'waitForSelector',
  '$',
  '$$'
]);
export function reviewGeneratedTest({ specPath, testPath, mode = undefined, validation: providedValidation = undefined }) {
  const issues = [];
  const warnings = [];
  const validation = providedValidation ?? validateSpecFile(specPath);

  if (!validation.valid) {
    return {
      passed: false,
      issues: [`Spec validation failed: ${specPath}`, ...validation.issues],
      warnings
    };
  }

  // Explicit --mode wins; a flag that contradicts the spec's Generation Mode
  // metadata is a hard error; otherwise the spec metadata (default single).
  let generationMode;
  try {
    generationMode = resolveGenerationMode({ cliMode: mode, specMode: specGenerationMode(validation.metadata) });
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
      issues: [`Generated test file does not exist: ${testPath}`],
      warnings
    };
  }

  const parsedSpec = parseFlowSpec(readSpecFile(specPath));
  const { content, sourceFile } = parseSourceFile(absoluteTestPath);
  const constLiteralIdentifiers = collectConstLiteralIdentifiers(sourceFile);
  const constStringIdentifiers = collectConstStringIdentifiers(sourceFile);
  const stringIdentifiers = collectStringIdentifiers(sourceFile);
  const locatorIdentifiers = collectLocatorIdentifiers(sourceFile);
  const expectCalls = collectExpectCalls(sourceFile);
  const stepCalls = collectTestStepCalls(sourceFile);
  const testCases = collectTestCaseCalls(sourceFile);
  // Live literals only: a string parked in a declaration nothing reads must
  // not satisfy data-case, mock, or salient-token coverage.
  const countableStringLiterals = collectCountableStringLiterals(sourceFile, constStringIdentifiers);

  checkHeader(content, specPath, validation, issues);
  checkFixtureImport(sourceFile, issues);
  checkGeneratedRuntimeCapabilities(sourceFile, issues, { constStringIdentifiers });
  checkGenerationModeShape(generationMode, parsedSpec, testCases, sourceFile, locatorIdentifiers, issues, warnings);
  if (generationMode === 'suite') {
    checkPerAcceptanceCriteria(parsedSpec, stepCalls, sourceFile, locatorIdentifiers, constLiteralIdentifiers, issues);
    checkPerNegativeCase(parsedSpec.negativeCases, stepCalls, sourceFile, issues);
    checkDataCaseAssertionStrength(sourceFile, issues);
  }
  checkSpecTagDeclarations(parsedSpec, sourceFile, constStringIdentifiers, issues);
  checkDataCaseCoverage(parsedSpec.dataCasesJson.value, countableStringLiterals, issues);
  checkSingleResponsibilityAssertions(testCases, sourceFile, issues);
  checkExpectCalls(expectCalls, sourceFile, locatorIdentifiers, constLiteralIdentifiers, issues);
  checkForbiddenRuntimePatterns(sourceFile, issues);
  checkUnimplementedTestDataHelpers(sourceFile, issues);
  checkForbiddenAgentBrowserRefs(content, issues);
  checkPomLocatorOwnership(sourceFile, content, issues);
  checkStringSelectorActionApis(sourceFile, issues);
  checkLocatorSelectors(sourceFile, stringIdentifiers, locatorIdentifiers, issues, warnings);
  checkSemanticLocatorPresence(sourceFile, content, issues);
  checkLocatorHints(parsedSpec.locatorHints, sourceFile, content, issues);
  checkMockContract(parsedSpec.mocksJson.value, sourceFile, countableStringLiterals, constStringIdentifiers, issues);
  checkExpectedTokens(parsedSpec, countableStringLiterals, issues);
  checkSecretAndUrlLiterals(sourceFile, constStringIdentifiers, issues);
  checkPageObjectHint(parsedSpec.metadata['Base Path'], content, warnings);
  checkReuseGuidance(sourceFile, content, warnings);
  checkStabilityAndVariantsAlignment(parsedSpec, sourceFile, issues, warnings);

  return {
    passed: issues.length === 0,
    issues,
    warnings
  };
}

function checkHeader(content, specPath, validation, issues) {
  const specVersion = validation.metadata['Spec Version'];
  const escapedSpec = escapeRegExp(specPath);
  const pattern = new RegExp(
    `/\\*\\s*spec:\\s+${escapedSpec}\\s+version:${escapeRegExp(specVersion)}\\s+sha256:[a-f0-9]{64}\\s*\\*/`,
    'i'
  );
  if (!pattern.test(content)) {
    issues.push(`Generated test must include spec version/hash header for ${specPath} version ${specVersion}.`);
    return;
  }

  // Any 64-hex value used to pass; verify the header hash against the actual
  // behavioral spec hash so a stale or fabricated header fails review.
  const header = parseSpecHeader(content);
  const expectedHash = specSha256(specPath);
  if (header && header.sha256 !== expectedHash) {
    issues.push(
      `Generated test header hash does not match ${specPath}: header sha256:${header.sha256}, actual sha256:${expectedHash}. Regenerate the header via the drift/import workflow (npm run ai:spec:drift, then re-run ai:generate-test).`
    );
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
    if (names.includes('test') && names.includes('expect')) {
      hasFixtureImport = true;
    }
  }

  if (!hasFixtureImport) {
    issues.push('Generated test must import test and expect from fixtures/test.');
  }
}

function checkPerAcceptanceCriteria(parsedSpec, stepCalls, sourceFile, locatorIdentifiers, constLiteralIdentifiers, issues) {
  const acStepRegistry = new Map();
  for (const step of stepCalls) {
    const dedicatedAcIds = extractDedicatedAcIds(step.title);
    if (dedicatedAcIds.length === 0) {
      continue;
    }

    if (dedicatedAcIds.length > 1) {
      issues.push(
        `test.step title "${step.title}" must name at most one AC ID. Combined steps are forbidden.`
      );
      continue;
    }

    const acId = dedicatedAcIds[0];
    if (!acStepRegistry.has(acId)) {
      acStepRegistry.set(acId, []);
    }
    acStepRegistry.get(acId).push(step);
  }

  for (const acId of parsedSpec.acceptanceCriteria) {
    const matching = acStepRegistry.get(acId) ?? [];
    if (matching.length === 0) {
      issues.push(
        `Missing dedicated assertion test.step for ${acId}. Use a final step such as "Assert ${acId}: <single outcome>".`
      );
      continue;
    }

    const hasValidAssertion = matching.some((step) => {
      const expects = collectExpectCalls(step.body);
      return expects.some((expectCall) =>
        isExpectPollCall(expectCall) ||
        isValidExpectReceiver(expectCall.arguments[0], sourceFile, locatorIdentifiers, constLiteralIdentifiers)
      );
    });

    if (!hasValidAssertion) {
      issues.push(`${acId} must be verified by a final assertion step containing expect(...) on a Page or Page Object locator.`);
    }
  }
}

function extractDedicatedAcIds(title) {
  const matches = [...title.matchAll(/\bAC-\d{3}\b/g)].map((match) => match[0]);
  return [...new Set(matches)];
}

function checkPerNegativeCase(negativeCases, stepCalls, sourceFile, issues) {
  for (const negative of negativeCases) {
    const matching = stepCalls.filter((step) => step.title.includes(negative.caseId));
    if (matching.length === 0) {
      issues.push(
        `Missing test.step covering negative case ${negative.caseId} ("${negative.scenario}").`
      );
      continue;
    }

    const hasAssertion = matching.some((step) => collectExpectCalls(step.body).length > 0);
    if (!hasAssertion) {
      issues.push(`${negative.caseId} must be verified by a final assertion step.`);
    }
  }
}

// Single-mode shape contract: exactly one primary test (its title carries the
// primary data-case id) plus optionally one test per spec Negative Case. NEG
// tests must title-reference their NEG-### id and end in an
// "Assert NEG-###: ..." step with at least one expect. Uncovered NEG ids are a
// non-blocking warning in single mode (they stay required in suite mode).
function checkGenerationModeShape(generationMode, parsedSpec, testCases, sourceFile, locatorIdentifiers, issues, warnings) {
  if (generationMode !== 'single') {
    return;
  }

  const negativeIds = parsedSpec.negativeCases.map((negative) => negative.caseId);
  const negativeTests = [];
  const primaryTests = [];

  for (const testCase of testCases) {
    const matchedNegIds = negativeIds.filter((negId) => testCase.title.includes(negId));
    if (matchedNegIds.length > 1) {
      issues.push(
        `Negative test title "${testCase.title}" must name exactly one spec NEG-### id. Found: ${matchedNegIds.join(', ')}.`
      );
    }

    if (matchedNegIds.length > 0) {
      negativeTests.push({ testCase, negId: matchedNegIds[0] });
    } else {
      primaryTests.push(testCase);
    }
  }

  if (primaryTests.length !== 1) {
    issues.push(
      `Single mode must contain exactly one primary test(...) block (plus optionally one test per spec NEG-### case). Found ${primaryTests.length} primary test(s). Use --mode suite only for explicit suite generation.`
    );
  }

  if (primaryTests.length === 1) {
    checkPrimaryAcCoverage(parsedSpec, primaryTests[0], sourceFile, locatorIdentifiers, issues);
  }

  for (const { testCase, negId } of negativeTests) {
    checkSingleModeNegativeTest(testCase, negId, issues);
  }

  const coveredNegIds = new Set(negativeTests.map((entry) => entry.negId));
  const uncovered = parsedSpec.negativeCases.filter((negative) => !coveredNegIds.has(negative.caseId));
  if (uncovered.length > 0) {
    warnings.push(
      `Negative cases without dedicated NEG tests in single mode (non-blocking): ${uncovered
        .map((negative) => `${negative.caseId} ("${negative.scenario}")`)
        .join(', ')}. Add per-NEG tests or generate in suite mode for required coverage.`
    );
  }
}

function checkSingleModeNegativeTest(testCase, negId, issues) {
  const steps = collectTestStepCalls(testCase.body);
  if (steps.length === 0) {
    issues.push(`Negative test "${testCase.title}" must use test.step and end with an "Assert ${negId}: ..." step.`);
    return;
  }

  for (const step of steps) {
    if (!step.title.includes(negId)) {
      issues.push(
        `Negative test step title "${step.title}" must include the ${negId} token (e.g. "Arrange ${negId}: ...").`
      );
    }
  }

  const finalStep = steps[steps.length - 1];
  if (!new RegExp(`^\\s*Assert\\s+${escapeRegExp(negId)}\\s*:`, 'i').test(finalStep.title)) {
    issues.push(
      `Negative test "${testCase.title}" must end with a final step titled "Assert ${negId}: ...". Found final step "${finalStep.title}".`
    );
    return;
  }

  if (collectExpectCalls(finalStep.body).length === 0) {
    issues.push(
      `Negative test "${testCase.title}" must verify ${negId} with at least one meaningful expect in its final "Assert ${negId}: ..." step.`
    );
  }
}

// Contract for the covered-ac-ids annotation in the single-mode primary test:
// (a) every annotated id exists in the spec's Acceptance Criteria;
// (b) the union of AC-### tokens in the primary test's step titles EQUALS the
//     annotation set (every step title names the AC id(s) it exercises);
// (c) the final assertion step's AC id is in the annotation set;
// (d) every AC-titled step has an observable body — at least one awaited
//     locator action, page navigation, or Page-Object method call, or an
//     expect. Titles alone cannot claim coverage with empty/no-op bodies.
function checkPrimaryAcCoverage(parsedSpec, primaryTest, sourceFile, locatorIdentifiers, issues) {
  const annotationIds = collectCoveredAcIdAnnotationIds(primaryTest.body);
  if (annotationIds === undefined) {
    issues.push(
      `Primary test "${primaryTest.title}" must declare a covered-ac-ids annotation via test.info().annotations.push({ type: 'covered-ac-ids', description: 'AC-### ...' }).`
    );
    return;
  }

  const specAcIds = new Set(parsedSpec.acceptanceCriteria);
  for (const acId of annotationIds) {
    if (!specAcIds.has(acId)) {
      issues.push(`covered-ac-ids annotation names ${acId}, which is not in the spec's Acceptance Criteria.`);
    }
  }

  const steps = collectTestStepCalls(primaryTest.body);
  const stepAcIds = new Set();
  for (const step of steps) {
    const acIds = extractDedicatedAcIds(step.title);
    if (acIds.length === 0) {
      issues.push(
        `Primary test step title "${step.title}" must name the AC id(s) it exercises as AC-### tokens (e.g. "Arrange AC-001: open auth entry screen").`
      );
      continue;
    }

    for (const acId of acIds) {
      stepAcIds.add(acId);
    }

    // Empty-body bypass: a step titled "Arrange AC-001: ..." with a no-op
    // body would otherwise satisfy the covered-ac-ids equality check while
    // exercising nothing. Thin arrange steps stay legitimate — one awaited
    // Page-Object call is enough.
    if (!stepBodyHasObservableWork(step.body, sourceFile, locatorIdentifiers)) {
      issues.push(
        `Primary test step "${step.title}" names ${acIds.join(', ')} but its body performs no awaited locator action, page navigation, or Page Object method call and contains no expect. Step titles alone cannot claim AC coverage.`
      );
    }
  }

  const annotationSet = new Set(annotationIds);
  const unproven = annotationIds.filter((acId) => !stepAcIds.has(acId));
  if (unproven.length > 0) {
    issues.push(
      `covered-ac-ids annotation claims ${unproven.join(', ')}, but no test.step title in the primary test exercises ${unproven.length === 1 ? 'it' : 'them'}. The annotation set must equal the AC ids named in step titles.`
    );
  }

  const undeclared = [...stepAcIds].filter((acId) => !annotationSet.has(acId));
  if (undeclared.length > 0) {
    issues.push(
      `Primary test step titles name ${undeclared.join(', ')}, but the covered-ac-ids annotation does not declare ${undeclared.length === 1 ? 'it' : 'them'}. The annotation set must equal the AC ids named in step titles.`
    );
  }

  if (steps.length > 0) {
    const finalStep = steps[steps.length - 1];
    const finalAcIds = extractDedicatedAcIds(finalStep.title);
    if (finalAcIds.length > 0 && !finalAcIds.some((acId) => annotationSet.has(acId))) {
      issues.push(
        `Final assertion step "${finalStep.title}" names ${finalAcIds.join(', ')}, which is not in the covered-ac-ids annotation.`
      );
    }
  }
}

// Returns the AC-### ids declared by covered-ac-ids annotations inside the
// test body, or undefined when no such annotation exists.
function collectCoveredAcIdAnnotationIds(node) {
  let found = false;
  const ids = new Set();

  walk(node, (child) => {
    if (!ts.isCallExpression(child) || normalizedCallText(child.expression) !== 'test.info.annotations.push') {
      return;
    }

    for (const argument of child.arguments) {
      if (!ts.isObjectLiteralExpression(argument)) {
        continue;
      }

      let type;
      let description;
      for (const property of argument.properties) {
        if (!ts.isPropertyAssignment(property) || !property.name) {
          continue;
        }

        const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined;
        if (name === 'type') {
          type = stringValue(property.initializer);
        } else if (name === 'description') {
          description = stringValue(property.initializer);
        }
      }

      if (type === 'covered-ac-ids') {
        found = true;
        for (const acId of extractDedicatedAcIds(description ?? '')) {
          ids.add(acId);
        }
      }
    }
  });

  return found ? [...ids] : undefined;
}

// True when the step body observably does something: at least one expect, or
// an awaited call that is a locator action, a page/page-member call (goto,
// route, ...), or a Page Object/Component Object method call. Bare awaited
// helper expressions like `await Promise.resolve()` do not count.
function stepBodyHasObservableWork(stepBody, sourceFile, locatorIdentifiers) {
  if (collectExpectCalls(stepBody).length > 0) {
    return true;
  }

  let found = false;
  walk(stepBody, (node) => {
    if (found || !ts.isAwaitExpression(node)) {
      return;
    }

    walk(node.expression, (child) => {
      if (!found && ts.isCallExpression(child) && isQualifyingActionCall(child, sourceFile, locatorIdentifiers)) {
        found = true;
      }
    });
  });
  return found;
}

function isQualifyingActionCall(callExpression, sourceFile, locatorIdentifiers) {
  const callee = callExpression.expression;
  if (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) {
    return false;
  }

  const receiver = callee.expression;
  const receiverPath = normalizedCallText(receiver, sourceFile);
  if (
    receiverPath === 'page' ||
    receiverPath === 'this.page' ||
    receiverPath.startsWith('page.') ||
    receiverPath.startsWith('this.page.')
  ) {
    return true;
  }

  if (isLocatorLikeExpression(receiver, locatorIdentifiers)) {
    return true;
  }

  return isPageObjectLocatorExpression(callExpression);
}

// Spec metadata Tags must be declared verbatim on the generated describe block
// or test(...) via the Playwright { tag: [...] } option (set equality).
function checkSpecTagDeclarations(parsedSpec, sourceFile, constStringIdentifiers, issues) {
  const specTags = String(parsedSpec.metadata.Tags ?? '')
    .split(/\s+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (specTags.length === 0) {
    return;
  }

  const declarations = collectPlaywrightTagDeclarations(sourceFile, constStringIdentifiers, issues);
  if (declarations.length === 0) {
    issues.push(
      `Spec metadata Tags (${specTags.join(' ')}) must be declared on the generated describe block or test(...) via the Playwright { tag: [...] } option.`
    );
    return;
  }

  const specTagSet = new Set(specTags);
  for (const declaration of declarations) {
    const declaredSet = new Set(declaration.tags);
    const missing = specTags.filter((tag) => !declaredSet.has(tag));
    const unexpected = declaration.tags.filter((tag) => !specTagSet.has(tag));
    if (missing.length > 0 || unexpected.length > 0) {
      issues.push(
        `Playwright tag declaration on ${declaration.ownerText} must equal spec metadata Tags exactly. Expected [${specTags.join(', ')}]; found [${declaration.tags.join(', ')}].`
      );
    }
  }
}

function collectPlaywrightTagDeclarations(sourceFile, constStringIdentifiers, issues) {
  const declarations = [];

  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) {
      return;
    }

    const callText = normalizedCallText(node.expression, sourceFile);
    const isTagOwner = callText === 'test' || callText === 'it' || /^(?:test|it)\.describe(?:\.[a-z]+)?$/i.test(callText);
    if (!isTagOwner) {
      return;
    }

    const details = node.arguments[1];
    if (!details || !ts.isObjectLiteralExpression(details)) {
      return;
    }

    for (const property of details.properties) {
      if (!ts.isPropertyAssignment(property) || !property.name) {
        continue;
      }

      const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined;
      if (name !== 'tag') {
        continue;
      }

      const tagNodes = ts.isArrayLiteralExpression(property.initializer)
        ? [...property.initializer.elements]
        : [property.initializer];
      const tags = [];
      let foldable = true;
      for (const tagNode of tagNodes) {
        const folded = foldStringExpression(tagNode, constStringIdentifiers);
        if (folded === undefined) {
          foldable = false;
          break;
        }
        tags.push(folded);
      }

      if (!foldable) {
        issues.push(
          `Playwright tag declaration on ${callText} must use static string literals so the reviewer can compare it to spec metadata Tags.`
        );
        continue;
      }

      declarations.push({ ownerText: callText, tags });
    }
  });

  return declarations;
}

function checkSingleResponsibilityAssertions(testCases, sourceFile, issues) {
  for (const testCase of testCases) {
    const steps = collectTestStepCalls(testCase.body);
    if (steps.length === 0) {
      issues.push(`Test "${testCase.title}" must use test.step for arrange/action/final assertion steps.`);
      continue;
    }

    const assertionSteps = steps.filter((step) => collectExpectCalls(step.body).length > 0);
    if (assertionSteps.length > 1) {
      issues.push(
        `Test "${testCase.title}" has expect(...) assertions in ${assertionSteps.length} test.step blocks. Generated tests must verify one business outcome in a single final assertion step.`
      );
    }

    const expectCalls = collectExpectCalls(testCase.body);
    for (const expectCall of expectCalls) {
      if (!steps.some((step) => isNodeInside(expectCall, step.body, sourceFile))) {
        issues.push(
          `Test "${testCase.title}" has expect(...) outside test.step. Put assertions in the single final "Assert AC-###" or "Assert NEG-###" step.`
        );
      }
    }

    if (assertionSteps.length !== 1) {
      if (assertionSteps.length === 0) {
        issues.push(
          `Test "${testCase.title}" must contain exactly one final assertion test.step named "Assert AC-###" or "Assert NEG-###".`
        );
      }
      continue;
    }

    const assertionStep = assertionSteps[0];
    const lastStep = steps[steps.length - 1];
    if (assertionStep !== lastStep) {
      issues.push(
        `Test "${testCase.title}" must put expect(...) assertions only in the final test.step.`
      );
    }

    const acIds = extractDedicatedAcIds(assertionStep.title);
    const negativeIds = [...assertionStep.title.matchAll(/\bNEG-\d{3}\b/g)].map((match) => match[0]);
    const uniqueAssertionIds = [...new Set([...acIds, ...negativeIds])];
    if (!/^\s*Assert\b/i.test(assertionStep.title) || uniqueAssertionIds.length !== 1) {
      issues.push(
        `Assertion step "${assertionStep.title}" must start with "Assert" and name exactly one AC-### or NEG-### ID.`
      );
    }
  }
}

function checkExpectCalls(expectCalls, sourceFile, locatorIdentifiers, constLiteralIdentifiers, issues) {
  if (expectCalls.length === 0) {
    issues.push('Generated test must contain meaningful expect assertions.');
    return;
  }

  for (const expectCall of expectCalls) {
    const argument = expectCall.arguments[0];
    if (!argument) {
      issues.push('expect(...) must receive an assertion target.');
      continue;
    }

    const isPoll = isExpectPollCall(expectCall);

    if (!isPoll && isLiteralExpression(argument)) {
      issues.push(`Tautological assertion rejected: expect(${nodeText(sourceFile, argument)}).`);
      continue;
    }

    if (!isPoll && ts.isIdentifier(argument) && constLiteralIdentifiers.has(argument.text)) {
      issues.push(`Tautological assertion rejected: expect(${argument.text}) where ${argument.text} is a constant literal.`);
    }

    if (containsDateNow(argument)) {
      issues.push('Date.now() must not be used inside expect(...).');
    }

    if (isPoll) {
      checkExpectPollCall(expectCall, argument, sourceFile, constLiteralIdentifiers, issues);
      continue;
    }

    if (!isValidExpectReceiver(argument, sourceFile, locatorIdentifiers, constLiteralIdentifiers)) {
      issues.push(`expect(${nodeText(sourceFile, argument)}) must target a Page or Page Object locator expression.`);
    }

    checkWeakMatcher(expectCall, argument, sourceFile, issues);
  }
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

function checkExpectPollCall(expectCall, argument, sourceFile, constLiteralIdentifiers, issues) {
  if (!isPollProducerSuspicious(argument, constLiteralIdentifiers)) {
    return;
  }

  const matcherCall = findMatcherCall(expectCall);
  if (!matcherCall) {
    return;
  }

  const matcherArg = matcherCall.arguments[0];
  if (!matcherArg) {
    return;
  }

  if (isLiteralExpression(matcherArg)) {
    issues.push(
      `Tautological expect.poll rejected: producer returns a constant and matcher compares to a literal: ${nodeText(sourceFile, expectCall)}.`
    );
  }
}

function checkWeakMatcher(expectCall, argument, sourceFile, issues) {
  const matcherCall = findMatcherCall(expectCall);
  if (!matcherCall || !ts.isPropertyAccessExpression(matcherCall.expression)) {
    return;
  }

  const matcherName = matcherCall.expression.name.text;
  if (matcherName === 'toHaveURL' && isBroadUrlMatcher(matcherCall.arguments[0])) {
    issues.push(
      `Weak URL assertion rejected: ${nodeText(sourceFile, matcherCall)}. Assert an exact path or business-specific URL pattern.`
    );
  }

  if (matcherName === 'toBeVisible' && isGenericFallbackVisibilityTarget(argument, sourceFile)) {
    issues.push(
      `Weak visibility assertion rejected: expect(${nodeText(sourceFile, argument)}).toBeVisible() targets a generic fallback locator. Assert a business-specific page object locator or text signal.`
    );
  }
}

function isBroadUrlMatcher(argument) {
  if (!argument) {
    return false;
  }

  if (ts.isRegularExpressionLiteral(argument)) {
    return /^\/\^?\.?\*?\$?\/[a-z]*$/i.test(argument.getText()) || /^\/\.\*\/[a-z]*$/i.test(argument.getText());
  }

  if (isStringLiteralLike(argument)) {
    const value = stringValue(argument)?.trim() ?? '';
    return value === '' || value === '/' || value === '*' || value === '.*';
  }

  return false;
}

function isGenericFallbackVisibilityTarget(argument, sourceFile) {
  const text = nodeText(sourceFile, argument);
  return (
    /\.locator\(\s*['"`](?:body|html|main|\[role=['"`]?main['"`]?\])['"`]\s*\)/.test(text) ||
    /getByRole\(\s*['"`](?:main|document)['"`]\s*\)/.test(text) ||
    /getByText\(\s*\/(?:error|failed|invalid|success|continue)\//i.test(text)
  );
}

// A poll producer is suspicious when the value it produces is a compile-time
// constant. The single-statement direct-literal check was laundered through a
// multi-statement body (`() => { const v = 1; return v; }`), so block bodies
// are folded through the const-literal map: when every return at the
// producer's own scope folds to a constant, the produced value can never
// reflect application state.
function isPollProducerSuspicious(argument, constLiteralIdentifiers = new Set()) {
  if (!ts.isArrowFunction(argument) && !ts.isFunctionExpression(argument)) {
    return false;
  }

  const body = argument.body;
  if (!body) {
    return false;
  }

  if (!ts.isBlock(body)) {
    return foldsToCompileTimeConstant(body, constLiteralIdentifiers);
  }

  const returns = collectOwnReturnStatements(body);
  if (returns.length === 0) {
    return false;
  }

  return returns.every(
    (statement) => statement.expression && foldsToCompileTimeConstant(statement.expression, constLiteralIdentifiers)
  );
}

function foldsToCompileTimeConstant(node, constLiteralIdentifiers) {
  if (!node) {
    return false;
  }

  if (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node)) {
    return foldsToCompileTimeConstant(node.expression, constLiteralIdentifiers);
  }

  if (ts.isPrefixUnaryExpression(node)) {
    return foldsToCompileTimeConstant(node.operand, constLiteralIdentifiers);
  }

  if (isLiteralExpression(node)) {
    return true;
  }

  return ts.isIdentifier(node) && constLiteralIdentifiers.has(node.text);
}

// Return statements belonging to this function body only — returns inside
// nested function-like nodes produce values for those functions, not for the
// poll producer.
function collectOwnReturnStatements(body) {
  const returns = [];
  const visit = (node) => {
    if (
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node)
    ) {
      return;
    }

    if (ts.isReturnStatement(node)) {
      returns.push(node);
    }

    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return returns;
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

function checkForbiddenRuntimePatterns(sourceFile, issues) {
  // Aliases of test/it (const t = test; const { skip } = test; import
  // renames) so runtime-control checks cannot be evaded via `t.skip()`.
  const testAliases = collectTestAliasIdentifiers(sourceFile);

  walk(sourceFile, (node) => {
    if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword) {
      issues.push(
        `Forbidden "as any" cast in generated test: ${nodeText(sourceFile, node)}. Generated code must be fully typed; "as any" is used to smuggle forbidden calls past review.`
      );
    }

    if (!ts.isCallExpression(node)) {
      return;
    }

    // Normalized so bracket access, casts (page["waitForTimeout"],
    // (page as any).waitForTimeout), and test/it aliases resolve to the same
    // dotted form.
    const callText = canonicalizeTestCallText(normalizedCallText(node.expression, sourceFile), testAliases);
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

    if (/(^|\.)(only)$/.test(callText)) {
      issues.push(`Forbidden focused test pattern found: ${callText}.`);
    }

    if (isTestDefiningSkip(node, testAliases)) {
      issues.push(`Forbidden test-defining control found: ${callText} used to define a test or describe block.`);
    } else if (/^(?:test|it)(?:\.describe(?:\.serial|\.parallel)?)?\.(?:skip|fixme|fail)$/.test(callText)) {
      // Runtime self-skip bypass: test.skip(), test.skip(condition, reason),
      // test.fixme(), test.fail() inside a body make Playwright exit 0 without
      // verifying anything. Only the test-defining (title + callback) form is
      // even recognizable — and that form is rejected above.
      issues.push(
        `Forbidden runtime test control found: ${callText}. test.skip/test.fixme/test.fail may not be called at runtime (zero-arg or condition forms silently turn the executed gate green); remove the call and fix the test instead.`
      );
    }

    if ((callText === 'test' || callText === 'it') && node.arguments.length === 0) {
      issues.push(`Zero-argument ${callText}() call found. Test-family calls must declare a title and a callback.`);
    }

    if (isTestUseStorageStateLiteral(node)) {
      issues.push('test.use({ storageState: <literal> }) is forbidden. Bind storage state via the chromium-auth Playwright project.');
    }
  });
}

// Local identifiers that alias a critical precondition helper, so a call routed through
// destructuring or a saved reference cannot dodge the property-access check below. Maps the local
// name -> the ORIGINAL helper name so the reported message names the real blocked helper.
// REFERENCE-based detection (not call-based): flag ANY mention of a critical precondition helper —
// property access (called or not), computed string access, or destructuring key. A call cannot exist
// without at least one such reference, so alias chains (`const f = dm.setX; const g = f; g()`),
// array/object holders (`[dm.setX][0]()`), and callback indirection all reduce to a flagged
// reference at the point where the helper name appears. This deliberately replaces an earlier
// alias-tracking map (a strictly weaker re-implementation of lib/ts-ast.mjs's
// collectTestAliasIdentifiers) — referencing an unimplemented helper in a generated test is itself
// the defect, whether or not the reviewer can prove the call.
function checkUnimplementedTestDataHelpers(sourceFile, issues) {
  const referencedHelpers = new Set();
  let dynamicAccess = false;

  walk(sourceFile, (node) => {
    // dataManager.setX / anyReceiver.setX (called or stored)
    if (ts.isPropertyAccessExpression(node) && CRITICAL_PRECONDITION_HELPERS.has(node.name.text)) {
      referencedHelpers.add(node.name.text);
      return;
    }
    if (ts.isElementAccessExpression(node)) {
      const argument = node.argumentExpression;
      // receiver['setX']
      if (argument && isStringLiteralLike(argument) && CRITICAL_PRECONDITION_HELPERS.has(argument.text)) {
        referencedHelpers.add(argument.text);
        return;
      }
      // dataManager[<computed>] with a non-literal key: statically unresolvable — the one indirection
      // the reference scan cannot see through, so it is rejected outright.
      if (
        argument &&
        !isStringLiteralLike(argument) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'dataManager'
      ) {
        dynamicAccess = true;
      }
      return;
    }
    // const { setX } = dataManager  /  const { setX: alias } = ...
    if (ts.isObjectBindingPattern(node)) {
      for (const element of node.elements) {
        const sourceKey =
          element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : ts.isIdentifier(element.name)
              ? element.name.text
              : undefined;
        if (CRITICAL_PRECONDITION_HELPERS.has(sourceKey)) {
          referencedHelpers.add(sourceKey);
        }
      }
    }
  });

  for (const helperName of [...referencedHelpers].sort()) {
    issues.push(
      `Generated test references critical precondition helper "${helperName}", whose precondition ` +
        'cannot be arranged against the live environment (channel-media resolution + a shared ' +
        'admin_editMedia write — verified failing live). A test that can never arrange its own ' +
        'precondition is not an executable E2E test: move the case to the spec\'s Pending Automation ' +
        'section instead of emitting it, or make the arrange achievable and prove it live.'
    );
  }
  if (dynamicAccess) {
    issues.push(
      'Generated test accesses dataManager with a computed, non-literal key (dataManager[expr]). ' +
        'Dynamic member access defeats static review of critical precondition helpers — use a literal member access instead.'
    );
  }
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

  for (const property of config.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }

    const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : undefined;
    if (name !== 'storageState') {
      continue;
    }

    if (isStringLiteralLike(property.initializer)) {
      return true;
    }
  }

  return false;
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
      // Fail closed: a selector the reviewer cannot fold to a static string
      // could be anything (XPath, nth-child chains). It needs the same
      // explicit exception a raw CSS selector needs.
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
// // locator-policy:exception justification as raw CSS.
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
  if (!isLocatorLikeExpression(receiver, locatorIdentifiers) && !isPageObjectLocatorExpression(receiver)) {
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

function checkPomLocatorOwnership(sourceFile, content, issues) {
  const hasPomOwner = hasPageObjectImport(content) || hasLocalPomClassWithLocators(sourceFile);
  if (!hasPomOwner) {
    issues.push(
      'Generated tests must use Page Object or Component Object locator ownership. Import or define a focused Page Object/Component Object instead of locating directly in tests.'
    );
  }

  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !isLocatorCreationCall(node, sourceFile)) {
      return;
    }

    if (isInsidePomClass(node)) {
      return;
    }

    issues.push(
      `Direct page locator creation is forbidden in generated tests: ${nodeText(sourceFile, node)}. Move the locator into a Page Object or Component Object.`
    );
  });
}

function hasPageObjectImport(content) {
  return /from\s+['"][^'"]*(?:\/pages\/|\/components\/|\.\.\/pages\/|\.\.\/components\/|\.\.\/\.\.\/pages\/|\.\.\/\.\.\/components\/)[^'"]*['"]/.test(
    content
  );
}

function hasLocalPomClassWithLocators(sourceFile) {
  let found = false;
  walk(sourceFile, (node) => {
    if (!ts.isClassDeclaration(node) || !node.name || !isPomClassName(node.name.text)) {
      return;
    }

    walk(node, (child) => {
      if (ts.isCallExpression(child) && isLocatorCreationCall(child, sourceFile)) {
        found = true;
      }
    });
  });
  return found;
}

function isPomClassName(name) {
  return /(Page|Component|Object)$/.test(name);
}

function isInsidePomClass(node) {
  let current = node.parent;
  while (current) {
    if (ts.isClassDeclaration(current) && current.name && isPomClassName(current.name.text)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function isLocatorCreationCall(callExpression, sourceFile) {
  if (!ts.isPropertyAccessExpression(callExpression.expression)) {
    return false;
  }

  const name = callExpression.expression.name.text;
  if (name !== 'locator' && !SEMANTIC_LOCATOR_NAMES.has(name)) {
    return false;
  }

  const receiverText = callExpression.expression.expression.getText(sourceFile);
  return receiverText === 'page' || receiverText === 'this.page';
}

// Page-receiver string-selector action/query APIs (page.click('selector'),
// page.waitForSelector(...), page.$ / page.$$) are forbidden outright in
// generated tests: the page.* form always takes a raw selector string, so it
// bypasses both the locator policy and Page Object ownership. The receiver is
// normalized, so bracket access and casts ((page as any)['click']) resolve to
// the same dotted form.
function checkStringSelectorActionApis(sourceFile, issues) {
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) {
      return;
    }

    const method = propertyName(node.expression);
    if (!method || !PAGE_STRING_SELECTOR_ACTION_APIS.has(method)) {
      return;
    }

    const receiver =
      ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)
        ? normalizedCallText(node.expression.expression, sourceFile)
        : undefined;
    if (receiver !== 'page' && receiver !== 'this.page') {
      return;
    }

    issues.push(
      `String-selector action API forbidden in generated tests: ${nodeText(sourceFile, node)}. Call actions on Page Object locator objects (e.g. this.page.getByRole(...).${method}(...)) instead of page.${method}('selector').`
    );
  });
}

function checkForbiddenAgentBrowserRefs(content, issues) {
  const matches = [...content.matchAll(/@e\d+\b/g)].map((match) => match[0]);
  if (matches.length > 0) {
    issues.push(
      `Generated tests must not contain agent-browser snapshot refs (${[...new Set(matches)].join(', ')}). Use framework-selected Playwright locators instead.`
    );
  }
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

function checkSemanticLocatorPresence(sourceFile, content, issues) {
  let found = false;
  walk(sourceFile, (node) => {
    if (ts.isCallExpression(node) && SEMANTIC_LOCATOR_NAMES.has(propertyName(node.expression))) {
      found = true;
    }
  });

  if (!found && hasPageObjectImport(content) && /getBy(?:Role|Label|Placeholder|Text|TestId)\s*\(/.test(readPageObjectCorpus())) {
    found = true;
  }

  if (!found) {
    issues.push('Generated test must use at least one policy-approved locator.');
  }
}

function checkLocatorHints(locatorHints, sourceFile, content, issues) {
  const searchCorpus = `${content}\n${readPageObjectCorpus()}`;
  const normalizedCorpus = normalizeCode(searchCorpus);

  for (const hint of locatorHints) {
    const expectedLocators = [...hint.matchAll(/(getBy(?:Role|Label|Placeholder|Text|TestId)\([^`]+?\))/g)].map(
      (match) => match[1]
    );

    for (const locator of expectedLocators) {
      if (!normalizedCorpus.includes(normalizeCode(locator))) {
        issues.push(`Locator hint requires exact locator usage or Page Object wrapper: ${locator}`);
      }
    }
  }
}

function checkDataCaseCoverage(dataCases, stringLiterals, issues) {
  if (!Array.isArray(dataCases) || dataCases.length <= 1) {
    return;
  }

  for (const dataCase of dataCases) {
    const caseId = String(dataCase?.caseId ?? '');
    // Substring matching per the documented contract: "DC-001" inside a title
    // such as "DC-001 AC-003: ..." counts. Literals are pre-filtered for
    // liveness, so a dead constant cannot satisfy coverage.
    if (caseId && !stringLiterals.some((literal) => literal.includes(caseId))) {
      issues.push(`Data case ${caseId} must appear in a test title, step title, or parameterized row string literal.`);
    }
  }
}

// A data-driven suite that loops over an embedded array of cases is only as strong as the
// expectations those cases carry. A case whose `expected` object is entirely empty (every field
// null / false / "" / []) has nothing case-specific to assert: at runtime it can only fall through
// to a generic visibility check ("the page rendered"), which is the "scaffolding presented as
// coverage" anti-pattern. Fail the review when more than this fraction of the suite's data cases
// are non-asserting. Tunable — lower is stricter.
const MAX_NONASSERTING_DATACASE_RATIO = 0.4;

function propAssignmentName(property) {
  const name = property.name;
  if (!name) {
    return undefined;
  }
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

// An expected value is "empty" (carries no checkable expectation) when it is null, false, the empty
// string, or the empty array. Anything else — a number, true, a non-empty string/array — is a real,
// assertable expectation.
function isEmptyExpectedValue(node) {
  if (node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
    return true;
  }
  if (ts.isStringLiteral(node) && node.text === '') {
    return true;
  }
  if (ts.isArrayLiteralExpression(node) && node.elements.length === 0) {
    return true;
  }
  return false;
}

function expectedObjectLiteralOf(objectLiteral) {
  for (const property of objectLiteral.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      propAssignmentName(property) === 'expected' &&
      ts.isObjectLiteralExpression(property.initializer)
    ) {
      return property.initializer;
    }
  }
  return undefined;
}

function expectedIsAsserting(expectedLiteral) {
  for (const property of expectedLiteral.properties) {
    if (ts.isPropertyAssignment(property) && !isEmptyExpectedValue(property.initializer)) {
      return true;
    }
  }
  return false;
}

// Recognize a data-case parameterization array: an array literal with >=2 object-literal elements
// where AT LEAST ONE carries an `expected` object property. Detection is deliberately decoupled
// from expected-density: an earlier ">= half must carry expected" rule meant an attacker could hide
// the array from this gate by padding it with expected-LESS junk rows (6 junk + 5 weak rows -> the
// array vanished). Now a single expected-bearing element makes the array a candidate, and every
// element without `expected` counts as non-asserting below — padding only makes coverage look
// weaker, never invisible. Arrays with zero `expected` keys (config/tag lists) are still ignored.
function collectExpectedBearingArrays(sourceFile) {
  const arrays = [];
  walk(sourceFile, (node) => {
    if (!ts.isVariableDeclaration(node) || !node.initializer || !ts.isArrayLiteralExpression(node.initializer)) {
      return;
    }
    const objects = node.initializer.elements.filter((element) => ts.isObjectLiteralExpression(element));
    if (objects.length < 2) {
      return;
    }
    const withExpected = objects.filter((object) => expectedObjectLiteralOf(object));
    if (withExpected.length === 0) {
      return;
    }
    arrays.push({ name: node.name.getText(), objects });
  });
  return arrays;
}

function checkDataCaseAssertionStrength(sourceFile, issues) {
  const candidates = collectExpectedBearingArrays(sourceFile);
  if (candidates.length === 0) {
    return;
  }
  // The suite's parameterization source is the largest such array.
  const target = candidates.sort((a, b) => b.objects.length - a.objects.length)[0];
  const total = target.objects.length;
  if (total <= 1) {
    return;
  }
  // An element is non-asserting if it has no `expected` object at all, or its `expected` is all-empty.
  const nonAsserting = target.objects.filter((object) => {
    const expected = expectedObjectLiteralOf(object);
    return !expected || !expectedIsAsserting(expected);
  }).length;
  const ratio = nonAsserting / total;
  if (ratio > MAX_NONASSERTING_DATACASE_RATIO) {
    issues.push(
      `Weak data-case coverage: ${nonAsserting}/${total} (${Math.round(ratio * 100)}%) of \`${target.name}\` ` +
        `entries have an empty \`expected\` (every field null/false/empty), so they can only assert generic ` +
        `visibility — not the case's behaviour. Threshold is ${Math.round(MAX_NONASSERTING_DATACASE_RATIO * 100)}%. ` +
        `Give these cases a checkable expected value (count, exact text, or a dedicated structural/negative ` +
        `assertion), or drop them from the suite so coverage is not overstated.`
    );
  }
}

function checkMockContract(mocks, sourceFile, stringLiterals, constStringIdentifiers, issues) {
  if (!Array.isArray(mocks) || mocks.length === 0) {
    return;
  }

  const mockRegistrations = collectMockRegistrations(sourceFile, constStringIdentifiers);
  if (mockRegistrations.urls.length === 0) {
    issues.push('Spec declares Mocks as JSON entries, but the generated test does not register any route/mock fulfillment.');
  }

  for (const mock of mocks) {
    if (!mock || typeof mock !== 'object') {
      continue;
    }

    const url = String(mock.url ?? '');
    if (url && !mockRegistrations.urls.some((value) => value.includes(url))) {
      issues.push(`Declared mock URL is not registered by the generated test: ${url}`);
    }

    const method = String(mock.method ?? '').toUpperCase();
    if (method && method !== 'GET' && !stringLiterals.some((literal) => literal.includes(method))) {
      issues.push(`Declared mock method is not referenced by the generated test: ${method} ${url}`);
    }

    if (Number.isInteger(mock.status) && !mockRegistrations.statuses.has(mock.status)) {
      issues.push(`Declared mock status is not referenced by the generated test: ${mock.status} ${url}`);
    }

    for (const value of primitiveMockValues(mock.body)) {
      const expected = String(value);
      if (expected.length > 0 && !stringLiterals.some((literal) => literal.includes(expected))) {
        issues.push(`Declared mock response value is not asserted or referenced by the generated test: ${expected}`);
      }
    }
  }
}

function collectMockRegistrations(sourceFile, constStringIdentifiers) {
  const urls = [];
  const statuses = new Set();

  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) {
      return;
    }

    const callName = node.expression.getText(sourceFile);
    const property = propertyName(node.expression);

    if (property === 'route') {
      const url = foldStringExpression(node.arguments[0], constStringIdentifiers);
      if (url) {
        urls.push(url);
      }
      return;
    }

    if (['mockJsonResponse', 'mockJsonError'].includes(callName)) {
      const url = foldStringExpression(node.arguments[1], constStringIdentifiers);
      if (url) {
        urls.push(url);
      }

      // mockJsonError(page, url, status) takes a numeric status positionally;
      // mockJsonResponse(page, url, body, { status }) takes an options object.
      const statusArg = callName === 'mockJsonError' ? node.arguments[2] : node.arguments[3];
      if (statusArg && ts.isNumericLiteral(statusArg)) {
        statuses.add(Number(statusArg.text));
      } else if (statusArg && ts.isObjectLiteralExpression(statusArg)) {
        for (const property of statusArg.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            property.name &&
            (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
            property.name.text === 'status' &&
            ts.isNumericLiteral(property.initializer)
          ) {
            statuses.add(Number(property.initializer.text));
          }
        }
      }
      return;
    }

    if (callName.endsWith('.fulfill')) {
      const options = node.arguments[0];
      if (options && ts.isObjectLiteralExpression(options)) {
        for (const propertyAssignment of options.properties) {
          if (!ts.isPropertyAssignment(propertyAssignment)) {
            continue;
          }

          const name =
            propertyAssignment.name && (ts.isIdentifier(propertyAssignment.name) || ts.isStringLiteral(propertyAssignment.name))
              ? propertyAssignment.name.text
              : undefined;
          if (name === 'status' && ts.isNumericLiteral(propertyAssignment.initializer)) {
            statuses.add(Number(propertyAssignment.initializer.text));
          }
        }
      }
    }
  });

  return { urls, statuses };
}

function checkExpectedTokens(parsedSpec, countableLiterals, issues) {
  const extracted = [
    ...parsedSpec.flowSteps.map((step) => step.expectedResult ?? ''),
    ...primitiveExpectedValues(parsedSpec.dataCasesJson.value)
  ].flatMap((value) => salientExpectedTokens(String(value)));

  // The spec author can declare exactly which salient values must be asserted
  // via a "Must assert the salient expected values ..." requirement. That
  // explicit contract is authoritative and harder to game than heuristics.
  const declared = parseDeclaredSalientValues(parsedSpec);

  const tokens = [...new Set([...extracted, ...declared])];

  for (const token of tokens) {
    if (!countableLiterals.some((literal) => literal.includes(token))) {
      issues.push(
        `Salient expected value must be asserted in the test (inside an assertion, a step/test title, or an iterated data row): ${token}`
      );
    }
  }
}

// Reads "Must assert the salient expected values A, B, and C." from the spec's
// Generated Test Requirements and returns the listed phrases verbatim.
function parseDeclaredSalientValues(parsedSpec) {
  const requirements = parsedSpec.sections?.['Generated Test Requirements'] ?? '';
  const match = requirements.match(/must assert the salient expected values?\s+(.+?)\.?$/im);
  if (!match) {
    return [];
  }

  return match[1]
    .split(/\s*,\s*|\s+and\s+/i)
    .map((part) => part.replace(/^["'`]|["'`]$/g, '').trim())
    .filter((part) => part.length > 0 && !/^and$/i.test(part));
}

function primitiveExpectedValues(dataCases) {
  if (!Array.isArray(dataCases)) {
    return [];
  }

  return dataCases.flatMap((dataCase) => primitiveMockValues(dataCase.expected));
}

// Conservative: only genuinely salient fragments — IDs (REQ-1001), "N days",
// "must be at least/most" phrases, and quoted substrings. The previous
// blanket "any capitalized word" rule was satisfiable by token-stuffing a dead
// constant, so it has been removed in favor of the explicit declared list above.
function salientExpectedTokens(value) {
  if (!value || /NEEDS_REVIEW/i.test(value)) {
    return [];
  }

  const tokens = new Set();
  for (const match of value.matchAll(/\b[A-Z]{2,}-\d+\b/g)) {
    tokens.add(match[0]);
  }
  for (const match of value.matchAll(/\b\d+\s+days?\b/gi)) {
    tokens.add(match[0]);
  }
  if (/must be at least/i.test(value)) {
    tokens.add('must be at least');
  }
  if (/must be at most/i.test(value)) {
    tokens.add('must be at most');
  }
  for (const match of value.matchAll(/["'`]([^"'`]{3,})["'`]/g)) {
    tokens.add(match[1].trim());
  }

  return [...tokens];
}

// String literals that count as "really used": those reachable without passing
// through a declaration that nothing reads. A literal stuffed into a property
// (e.g. `salientExpectedTokens: [...]`) that is never accessed, or a const array
// that is never referenced, does not count — closing the salient-token gaming.
function collectCountableStringLiterals(sourceFile, constStringIdentifiers) {
  const readIds = new Set();
  const accessedProps = new Set();

  walk(sourceFile, (node) => {
    if (ts.isPropertyAccessExpression(node)) {
      accessedProps.add(node.name.text);
    }

    if (ts.isElementAccessExpression(node)) {
      const arg = node.argumentExpression;
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
        accessedProps.add(arg.text);
      }
    }

    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isDeclName =
        (ts.isVariableDeclaration(parent) ||
          ts.isParameter(parent) ||
          ts.isBindingElement(parent) ||
          ts.isFunctionDeclaration(parent) ||
          ts.isClassDeclaration(parent)) &&
        parent.name === node;
      const isPropKey = ts.isPropertyAssignment(parent) && parent.name === node;
      const isPropName = ts.isPropertyAccessExpression(parent) && parent.name === node;
      if (!isDeclName && !isPropKey && !isPropName) {
        readIds.add(node.text);
      }
    }
  });

  // An object literal that flows into a call (or new) argument escapes to the
  // callee, which may read any property — e.g. mockJsonResponse(page, url,
  // body, { method: 'POST' }). Such properties stay live even when nothing in
  // this file accesses them by name.
  const escapesIntoCallArgument = (node) => {
    let current = node;
    while (current && !ts.isSourceFile(current)) {
      const parent = current.parent;
      if (
        parent &&
        (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
        (parent.arguments ?? []).includes(current)
      ) {
        return true;
      }
      current = parent;
    }
    return false;
  };

  const isLive = (node) => {
    let current = node.parent;
    while (current && !ts.isSourceFile(current)) {
      if (
        ts.isPropertyAssignment(current) &&
        current.name &&
        (ts.isIdentifier(current.name) || ts.isStringLiteral(current.name)) &&
        !accessedProps.has(current.name.text) &&
        !escapesIntoCallArgument(current)
      ) {
        return false;
      }

      if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name) && !readIds.has(current.name.text)) {
        return false;
      }

      current = current.parent;
    }
    return true;
  };

  const values = [];
  walk(sourceFile, (node) => {
    if (isStringLiteralLike(node) || ts.isTemplateExpression(node) || ts.isBinaryExpression(node)) {
      const folded = foldStringExpression(node, constStringIdentifiers);
      if (folded !== undefined && isLive(node)) {
        values.push(folded);
      }
    }
  });

  return values;
}

function primitiveMockValues(value) {
  if (value === null || value === undefined) {
    return [];
  }

  if (['string', 'number', 'boolean'].includes(typeof value)) {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => primitiveMockValues(entry));
  }

  if (typeof value === 'object') {
    return Object.values(value).flatMap((entry) => primitiveMockValues(entry));
  }

  return [];
}

function checkSecretAndUrlLiterals(sourceFile, constStringIdentifiers, issues) {
  const reportedUrls = new Set();
  const reportLiteral = (value) => {
    if (isProductionUrl(value)) {
      issues.push(`Hardcoded production URL is forbidden: ${value}`);
    }

    if (/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value)) {
      issues.push('JWT-shaped token detected in generated test.');
    }

    if (/AKIA[0-9A-Z]{16}/.test(value)) {
      issues.push('AWS access key detected in generated test.');
    }

    if (containsSecretLikeValue(value)) {
      issues.push('High-entropy string literal detected in generated test.');
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
      if (folded && isProductionUrl(folded) && !reportedUrls.has(folded)) {
        reportedUrls.add(folded);
        issues.push(`Hardcoded production URL is forbidden (folded): ${folded}`);
      }
      return;
    }

    if (ts.isTemplateExpression(node)) {
      const folded = foldStringExpression(node, constStringIdentifiers);
      if (folded && isProductionUrl(folded) && !reportedUrls.has(folded)) {
        reportedUrls.add(folded);
        issues.push(`Hardcoded production URL is forbidden (template): ${folded}`);
      }
    }
  });
}

function checkStabilityAndVariantsAlignment(parsedSpec, sourceFile, issues, warnings) {
  const sourceText = sourceFile.getText();

  if (parsedSpec.stability?.parallelSafe === 'no' && !/test\.describe\.serial\s*\(/.test(sourceText)) {
    issues.push(
      'Spec declares Parallel Safe = no, but the test does not use test.describe.serial(...).'
    );
  }

  const allowedRetries = Number(parsedSpec.stability?.allowedRetries ?? 0);
  if (allowedRetries > 0 && !/test\.describe\.configure\s*\(\s*\{\s*retries\s*:/.test(sourceText)) {
    warnings.push(
      `Spec allows ${allowedRetries} retries; consider test.describe.configure({ retries }) to opt in explicitly.`
    );
  }

  const parameterized = hasParameterizedTestEnumeration(sourceFile);

  const variantRows = parsedSpec.variants?.rows ?? [];
  if (variantRows.length > 1 && !parameterized) {
    issues.push(
      `Spec declares ${variantRows.length} variants; the test must enumerate them by looping over the cases (for...of / forEach / map) so each variant defines its own test(...).`
    );
  }

  const dataCaseRows = parsedSpec.dataCases?.rows ?? [];
  if (dataCaseRows.length > 1 && !parameterized) {
    issues.push(
      `Spec declares ${dataCaseRows.length} data cases; the test must enumerate them by looping over the case rows (for...of / forEach / map) so each caseId defines its own test(...).`
    );
  }
}

// Detects the Playwright-native parameterization idiom: a loop (for...of / for /
// forEach / map) whose body defines test(...) blocks. `@playwright/test` has no
// `.each`, so detection is AST-only — the previous raw-source fallback matched
// `.each(` inside comments, letting a comment satisfy the enumeration contract.
function hasParameterizedTestEnumeration(sourceFile) {
  let found = false;
  walk(sourceFile, (node) => {
    if (found) {
      return;
    }

    if (ts.isForOfStatement(node) || ts.isForStatement(node) || ts.isForInStatement(node)) {
      if (containsTestDefinition(node.statement)) {
        found = true;
      }
      return;
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ['forEach', 'map'].includes(node.expression.name.text)
    ) {
      const callback = node.arguments.find((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument));
      if (callback && callback.body && containsTestDefinition(callback.body)) {
        found = true;
      }
    }
  });

  return found;
}

function containsTestDefinition(node) {
  let found = false;
  walk(node, (child) => {
    if (ts.isCallExpression(child) && isTestCaseCall(child, child.getSourceFile())) {
      found = true;
    }
  });
  return found;
}

function checkPageObjectHint(basePath, content, warnings) {
  if (!basePath) {
    return;
  }

  const pageFiles = fs.existsSync('pages') ? fs.readdirSync('pages').filter((file) => file.endsWith('Page.ts')) : [];
  const segments = basePath.split('/').filter(Boolean).map((segment) => segment.toLowerCase());
  const matchingPage = pageFiles.find((file) => segments.some((segment) => file.toLowerCase().includes(segment)));

  if (matchingPage && !content.includes(matchingPage.replace(/\.ts$/, ''))) {
    warnings.push(`Base Path appears to have a Page Object (${matchingPage}); consider using it in the generated test.`);
  }
}

function checkReuseGuidance(sourceFile, content, warnings) {
  const semanticLocators = collectSemanticLocatorExpressions(sourceFile);
  const counts = new Map();
  for (const locator of semanticLocators) {
    counts.set(locator, (counts.get(locator) ?? 0) + 1);
  }

  for (const [locator, count] of counts.entries()) {
    if (count >= 3) {
      warnings.push(
        `Locator ${locator} is repeated ${count} times; consider a Page Object field or focused helper if this flow is reused.`
      );
    }
  }

  const hasPageObjectImport = /from\s+['"][^'"]*\/pages\//.test(content);
  const inlineActionCount = countInlineLocatorActions(sourceFile);
  if (!hasPageObjectImport && inlineActionCount >= 12) {
    warnings.push(
      `Generated test has ${inlineActionCount} inline locator actions and no Page Object import; consider a simple POM if this page/flow will grow.`
    );
  }
}

function collectSemanticLocatorExpressions(sourceFile) {
  const locators = [];
  walk(sourceFile, (node) => {
    if (ts.isCallExpression(node) && SEMANTIC_LOCATOR_NAMES.has(propertyName(node.expression))) {
      locators.push(normalizeCode(nodeText(sourceFile, node)));
    }
  });
  return locators;
}

function countInlineLocatorActions(sourceFile) {
  let count = 0;
  const actionNames = new Set(['click', 'fill', 'press', 'check', 'uncheck', 'selectOption', 'hover', 'focus']);

  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !actionNames.has(propertyName(node.expression))) {
      return;
    }

    const receiverText = ts.isPropertyAccessExpression(node.expression)
      ? node.expression.expression.getText(sourceFile)
      : '';
    if (/getBy(Role|Label|Placeholder|Text|TestId)\s*\(/.test(receiverText)) {
      count += 1;
    }
  });

  return count;
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

function collectTestStepCalls(node, sourceFile = node.getSourceFile()) {
  const steps = [];
  walk(node, (child) => {
    if (!ts.isCallExpression(child) || child.expression.getText(sourceFile) !== 'test.step') {
      return;
    }

    const title = stringValue(child.arguments[0]) ?? '';
    const callback = child.arguments[1];
    if (!callback || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
      return;
    }

    steps.push({
      title,
      body: callback.body,
      node: child
    });
  });
  return steps;
}

function collectTestCaseCalls(sourceFile) {
  const tests = [];
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !isTestCaseCall(node, sourceFile)) {
      return;
    }

    const title = stringValue(node.arguments[0]) ?? nodeText(sourceFile, node.arguments[0] ?? node.expression);
    const callback = node.arguments.find((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument));
    if (!callback) {
      return;
    }

    tests.push({
      title,
      body: callback.body,
      node
    });
  });
  return tests;
}

function isTestCaseCall(callExpression, sourceFile) {
  const expression = callExpression.expression;
  if (ts.isIdentifier(expression) && expression.text === 'test') {
    return true;
  }

  if (!ts.isPropertyAccessExpression(expression)) {
    return false;
  }

  const owner = expression.expression.getText(sourceFile);
  const name = expression.name.text;
  return owner === 'test' && ['skip', 'fixme', 'fail'].includes(name);
}

function isNodeInside(node, parent, sourceFile) {
  const nodeStart = node.getStart(sourceFile);
  const nodeEnd = node.getEnd();
  const parentStart = parent.getStart(sourceFile);
  const parentEnd = parent.getEnd();
  return nodeStart >= parentStart && nodeEnd <= parentEnd;
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

  return isLocatorLikeExpression(argument, locatorIdentifiers) || isPageObjectLocatorExpression(argument);
}

function isPageObjectLocatorExpression(argument) {
  if (ts.isPropertyAccessExpression(argument)) {
    const root = leftmostIdentifier(argument);
    return Boolean(root && root.text !== 'page' && /(?:Page|Component|Object)$/i.test(root.text));
  }

  if (ts.isCallExpression(argument)) {
    return isPageObjectLocatorExpression(argument.expression);
  }

  return false;
}

function leftmostIdentifier(node) {
  if (ts.isIdentifier(node)) {
    return node;
  }

  if (ts.isPropertyAccessExpression(node)) {
    return leftmostIdentifier(node.expression);
  }

  if (ts.isCallExpression(node)) {
    return leftmostIdentifier(node.expression);
  }

  return undefined;
}

function containsDateNow(node) {
  let found = false;
  walk(node, (child) => {
    if (ts.isCallExpression(child) && child.expression.getText() === 'Date.now') {
      found = true;
    }
  });
  return found;
}

function isProductionUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol.startsWith('http') && !['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname);
  } catch {
    return false;
  }
}

function readPageObjectCorpus() {
  if (!fs.existsSync('pages')) {
    return '';
  }

  return fs
    .readdirSync('pages')
    .filter((file) => file.endsWith('.ts'))
    .map((file) => fs.readFileSync(path.join('pages', file), 'utf8'))
    .join('\n');
}

function parseArgs(args) {
  const parsed = {
    spec: undefined,
    test: undefined,
    mode: undefined
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--spec') {
      parsed.spec = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--test') {
      parsed.test = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--mode') {
      parsed.mode = args[index + 1];
      if (!GENERATION_MODES.has(parsed.mode)) {
        throw new Error(`Unsupported generation mode: ${parsed.mode}. Use "single" or "suite".`);
      }
      index += 1;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return parsed;
}

function printResult(result, testPath) {
  if (result.passed) {
    console.log(`Generated test review passed: ${testPath}`);
  } else {
    console.error(`Generated test review failed: ${testPath}`);
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
  node scripts/ai/review-generated-test.mjs --spec <spec-path> --test <test-file> [--mode single|suite]

Reviews a generated Playwright test against its flow spec using the TypeScript compiler API.
Without --mode, the spec's optional "Generation Mode" metadata applies (default single).
A --mode flag that contradicts the spec's Generation Mode is a hard error.
The deterministic spec validator is the only pre-generation policy gate.`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  if (!args.spec || !args.test) {
    printHelp();
    process.exit(1);
  }

  const result = reviewGeneratedTest({
    specPath: args.spec,
    testPath: args.test,
    mode: args.mode
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
