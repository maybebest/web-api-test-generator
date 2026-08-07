import path from 'node:path';

import ts from 'typescript';

import {
  foldStringExpression,
  normalizedCallText,
  propertyName,
  walk
} from './ts-ast.mjs';

const GENERATED_TEST_PUBLIC_ENV_NAMES = new Set([
  'E2E_ALLOW_PERSISTENT_TEST_DATA',
  'E2E_MP_ADVERTISER', 'E2E_MP_BRAND', 'E2E_MP_OBJECTIVE', 'E2E_MP_PRODUCT_SEARCH', 'E2E_MP_SKU',
  'E2E_MP_ONSITE_CHANNEL', 'E2E_MP_OFFSITE_CHANNEL', 'E2E_MP_ATHOME_CHANNEL', 'E2E_MP_INSTORE_CHANNEL',
  'E2E_MP_OFFSITE_PUBMATIC_CHANNEL', 'E2E_MP_CHANNEL_BOOKING_DEADLINE_DAYS',
  'E2E_MP_CHANNEL_MIN_DURATION_DAYS', 'E2E_MP_CHANNEL_MIN_STORES', 'E2E_MP_CHANNEL_MAX_STORES',
  'E2E_MP_ONSITE_DISPLAY_BOOKING_DEADLINE_DAYS', 'E2E_MP_DD_COMPETITION_PAGE_MIN_DURATION_DAYS',
  'E2E_MP_COST_PER_STORE_CHANNEL', 'E2E_MP_COST_PER_UNIT_CHANNEL', 'E2E_MP_BASE_RATE_CHANNEL',
  'E2E_MP_UNBOUNDED_CHANNEL', 'E2E_MP_STORE_VOLUME_MIN', 'E2E_MP_STORE_VOLUME_MAX',
  'E2E_MP_DELETION_ONSITE_CHANNEL', 'E2E_MP_DELETION_OFFSITE_CHANNEL',
  'E2E_MP_DELETION_STAGGERED_FIXTURE', 'E2E_MP_RECOMPUTE_CHANNEL_A', 'E2E_MP_RECOMPUTE_CHANNEL_B',
  'E2E_MP_TROLLEY_CHANNEL', 'E2E_MP_TROLLEY_COST_PER_UNIT', 'E2E_MP_TROLLEY_MS_PERCENT',
  'E2E_MP_PETROL_FLAT_CHANNEL', 'E2E_MP_PETROL_COST_PER_UNIT', 'E2E_MP_PETROL_MS_FLAT',
  'E2E_MP_TRAVELMONEY_CHANNEL', 'E2E_MP_TRAVELMONEY_COST_PER_STORE', 'E2E_MP_TRAVELMONEY_MS_PERCENT',
  'E2E_MP_BUDGETLED_CHANNEL', 'E2E_MP_BUDGETLED_BUDGET',
  'E2E_SECONDARY_SPACE_ADVERTISER', 'E2E_SECONDARY_SPACE_BRAND',
  'E2E_SECONDARY_SPACE_INTERNAL_CHANNEL', 'E2E_SECONDARY_SPACE_MUTATION_ENABLED',
  'E2E_SECONDARY_SPACE_PRODUCT_SEARCH', 'E2E_SECONDARY_SPACE_PUBLIC_CHANNEL'
]);

const APPROVED_RELATIVE_IMPORT_ROOTS = new Set(['automation/src', 'components', 'data', 'pages']);
const APPROVED_FIXTURE_MODULES = new Set([
  'fixtures/channel-management.fixture',
  'fixtures/csv-export',
  'fixtures/nectar-api',
  'fixtures/secondary-space.fixture',
  'fixtures/test',
  'fixtures/test-data-manager'
]);
const APPROVED_NECTAR_API_IMPORTS = new Set([
  'MediaChannel',
  'SkuSelection',
  'findMediaId',
  'getEveryMedia',
  'getMedia',
  'getMediaChannelSetup',
  'getPlan',
  'getPlanningSession',
  'getSkusBySkuId',
  'setMediaChannelSkuConfig',
  'setPlanningSkus'
]);
const FORBIDDEN_SYSTEM_MODULES = new Set([
  'axios', 'child_process', 'cluster', 'dgram', 'dns', 'fs', 'fs/promises', 'got', 'http', 'http2', 'https',
  'module', 'net', 'node-fetch', 'os', 'process', 'request', 'superagent', 'tls', 'undici', 'vm',
  'worker_threads', 'ws'
]);

function normalizedRelativeImport(moduleName) {
  if (!moduleName.startsWith('.')) return null;
  let normalized = path.posix.normalize(moduleName.replaceAll('\\', '/'));
  while (normalized.startsWith('../')) normalized = normalized.slice(3);
  if (normalized.startsWith('./')) normalized = normalized.slice(2);
  return normalized.replace(/\.(?:[cm]?[jt]s|tsx)$/, '');
}

function approvedRelativeImport(moduleName) {
  const normalized = normalizedRelativeImport(moduleName);
  if (!normalized) return false;
  if (APPROVED_FIXTURE_MODULES.has(normalized)) return true;
  for (const root of APPROVED_RELATIVE_IMPORT_ROOTS) {
    if (normalized === root || normalized.startsWith(`${root}/`)) return true;
  }
  return false;
}

function isTypeOnlyPlaywrightImport(statement) {
  if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== '@playwright/test') return false;
  const clause = statement.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return false;
  return clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((element) => element.isTypeOnly);
}

function checkStaticImports(sourceFile, report) {
  for (const statement of sourceFile.statements) {
    if (ts.isImportEqualsDeclaration(statement)) {
      const reference = statement.moduleReference;
      const expression = ts.isExternalModuleReference(reference) ? reference.expression : undefined;
      const moduleName = expression && ts.isStringLiteral(expression) ? expression.text : '[internal alias]';
      report(
        `import-equals:${moduleName}`,
        moduleName.startsWith('node:') || FORBIDDEN_SYSTEM_MODULES.has(moduleName)
          ? `System or network module import is forbidden in generated tests: ${moduleName}. Use reviewed repository fixtures instead.`
          : `Import-equals aliases are forbidden in generated tests: ${moduleName}. Use a static approved ES module import.`
      );
      continue;
    }
    if (
      !(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
      || !statement.moduleSpecifier
      || !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const moduleName = statement.moduleSpecifier.text;
    if (moduleName.startsWith('node:') || FORBIDDEN_SYSTEM_MODULES.has(moduleName)) {
      report(
        `module:${moduleName}`,
        `System or network module import is forbidden in generated tests: ${moduleName}. Use reviewed repository fixtures instead.`
      );
      continue;
    }
    if (approvedRelativeImport(moduleName)) {
      if (normalizedRelativeImport(moduleName) === 'fixtures/nectar-api' && ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
          ? clause.namedBindings.elements
          : [];
        const forbidden = named
          .map((element) => (element.propertyName ?? element.name).text)
          .filter((name) => !APPROVED_NECTAR_API_IMPORTS.has(name));
        if (clause?.name || named.length === 0 || forbidden.length > 0) {
          report(
            `sensitive-fixture:${forbidden.join(',') || 'default-or-namespace'}`,
            `Sensitive fixture export is forbidden in generated tests: ${forbidden.join(', ') || moduleName}. Import only the reviewed high-level Nectar helpers.`
          );
        }
      }
      continue;
    }
    if (isTypeOnlyPlaywrightImport(statement)) continue;
    report(
      `unapproved-module:${moduleName}`,
      `Unapproved package import is forbidden in generated tests: ${moduleName}. Runtime imports must stay inside reviewed fixtures/pages/components/data/automation modules; @playwright/test is type-only.`
    );
  }
}

function collectConstAliases(sourceFile, initialAliases) {
  const aliases = new Set(initialAliases);
  let changed = true;
  while (changed) {
    changed = false;
    walk(sourceFile, (node) => {
      if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return;
      if (!aliases.has(normalizedCallText(node.initializer, sourceFile)) || aliases.has(node.name.text)) return;
      aliases.add(node.name.text);
      changed = true;
    });
  }
  return aliases;
}

function bindingElementName(element) {
  const name = element.propertyName ?? element.name;
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
}

function reportPageCapability(member, report) {
  if (member === 'request') {
    report(
      'page-capability:request',
      'Playwright API request capability is forbidden in generated tests. Use a reviewed, host-restricted fixture.'
    );
    return;
  }
  if (member === 'context') {
    report(
      'page-capability:context',
      'Browser context access is forbidden in generated tests because it exposes authenticated cookies and transport capabilities.'
    );
    return;
  }
  if (['evaluate', 'evaluateAll', 'evaluateHandle'].includes(member)) {
    report(
      `page-capability:${member}`,
      'Browser evaluation is forbidden in generated tests. Put browser logic behind a reviewed Page Object method.'
    );
    return;
  }
  if (member === 'goto') {
    report(
      'direct-navigation',
      'Direct page navigation must use a static relative path. Put dynamic or environment-specific navigation behind a reviewed Page Object.'
    );
  }
}

export function checkGeneratedRuntimeCapabilities(
  sourceFile,
  issues,
  { constStringIdentifiers = new Map() } = {}
) {
  const reported = new Set();
  const report = (key, message) => {
    if (reported.has(key)) return;
    reported.add(key);
    issues.push(message);
  };
  const pageAliases = collectConstAliases(sourceFile, ['page', 'this.page']);

  checkStaticImports(sourceFile, report);

  walk(sourceFile, (node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isObjectBindingPattern(node.name)
      && node.initializer
      && pageAliases.has(normalizedCallText(node.initializer, sourceFile))
    ) {
      for (const element of node.name.elements) {
        if (element.dotDotDotToken) {
          report(
            'page-capability:rest',
            'Destructuring or spreading the Playwright page object is forbidden because it bypasses reviewed capability checks.'
          );
          continue;
        }
        const member = bindingElementName(element);
        if (member) reportPageCapability(member, report);
      }
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const container = normalizedCallText(node.expression, sourceFile);
      const member = propertyName(node);
      if (pageAliases.has(container) && ['context', 'request', 'evaluate', 'evaluateAll', 'evaluateHandle'].includes(member)) {
        reportPageCapability(member, report);
      }
      if (
        pageAliases.has(container)
        && member === 'goto'
        && !(ts.isCallExpression(node.parent) && node.parent.expression === node)
      ) {
        report(
          'direct-navigation',
          'Direct page navigation must use a static relative path. Put dynamic or environment-specific navigation behind a reviewed Page Object.'
        );
      }
      if (container === 'process.env' || container === 'globalThis.process.env') {
        const name = propertyName(node);
        if (!name || !GENERATED_TEST_PUBLIC_ENV_NAMES.has(name)) {
          report(
            `env:${name ?? '[computed]'}`,
            name
              ? `Sensitive environment access is forbidden in generated tests: process.env.${name}. Move credential handling into a reviewed fixture.`
              : 'Computed or bulk process.env access is forbidden in generated tests. Use one explicitly allowlisted non-secret configuration field.'
          );
        }
      }

      if (['constructor', 'prototype', '__proto__'].includes(member)) {
        report(
          `prototype-escape:${member}`,
          `Dynamic-code constructor/prototype escape is forbidden in generated tests: .${member}.`
        );
      }

      const normalized = normalizedCallText(node, sourceFile);
      if (
        (normalized === 'process.env' || normalized === 'globalThis.process.env')
        && !(
          (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent))
          && node.parent.expression === node
        )
      ) {
        report(
          'env:bulk',
          'Computed or bulk process.env access is forbidden in generated tests. Use one explicitly allowlisted non-secret configuration field.'
        );
      }
    }

    if (ts.isCallExpression(node)) {
      const callText = normalizedCallText(node.expression, sourceFile);
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        report('dynamic-import', 'Dynamic import() is forbidden in generated tests. Use static reviewed repository imports.');
      }
      if (callText === 'require' || callText.endsWith('.require')) {
        report('require', 'CommonJS require() is forbidden in generated tests. Use static reviewed repository imports.');
      }
      if (['fetch', 'globalThis.fetch', 'window.fetch'].includes(callText)) {
        report('fetch', 'Global fetch capability is forbidden in generated tests. Use a reviewed, host-restricted fixture.');
      }
      if (callText === 'navigator.sendBeacon' || callText.endsWith('.sendBeacon')) {
        report('send-beacon', 'Browser beacon/network capability is forbidden in generated tests.');
      }
      if (callText === 'eval' || callText === 'Function') {
        report('dynamic-code', 'Dynamic code execution is forbidden in generated tests.');
      }
      if (
        /^(?:Object|Reflect)\.(?:create|definePropert(?:y|ies)|getOwnPropertyDescriptor(?:s)?|getPrototypeOf|setPrototypeOf)$/.test(callText)
      ) {
        report(
          'prototype-reflection',
          'Dynamic-code constructor/prototype escape is forbidden in generated tests: reflective prototype access.'
        );
      }
      if (/\.(?:evaluate|evaluateAll|evaluateHandle)$/.test(callText)) {
        report(
          'browser-evaluate',
          'Browser evaluation is forbidden in generated tests. Put browser logic behind a reviewed Page Object method.'
        );
      }
      if ([...pageAliases].some((alias) => callText === `${alias}.context`)) {
        report(
          'browser-context',
          'Browser context access is forbidden in generated tests because it exposes authenticated cookies and transport capabilities.'
        );
      }
      if (
        callText.startsWith('request.')
        || /^(?:page|this\.page|context|browserContext)\.request(?:\.|$)/.test(callText)
        || callText === 'playwright.request.newContext'
      ) {
        report(
          'api-request',
          'Playwright API request capability is forbidden in generated tests. Use a reviewed, host-restricted fixture.'
        );
      }
      if (callText === 'route.continue' || callText === 'route.fetch') {
        report(
          'route-network',
          'Route forwarding/fetch capability is forbidden in generated tests. Generated mocks may fulfill or abort only.'
        );
      }
      if (callText.endsWith('.setInputFiles')) {
        report(
          'file-upload',
          'Direct filesystem upload capability is forbidden in generated tests. Use a reviewed fixture that exposes only approved test data.'
        );
      }

      if ([...pageAliases].some((alias) => callText === `${alias}.goto`)) {
        const target = foldStringExpression(node.arguments[0], constStringIdentifiers);
        if (target === undefined || !target.startsWith('/') || target.startsWith('//')) {
          report(
            'direct-navigation',
            'Direct page navigation must use a static relative path. Put dynamic or environment-specific navigation behind a reviewed Page Object.'
          );
        }
      }
    }

    if (ts.isNewExpression(node)) {
      const constructorName = normalizedCallText(node.expression, sourceFile);
      if (['Function', 'WebSocket', 'EventSource', 'XMLHttpRequest'].includes(constructorName)) {
        report(
          `constructor:${constructorName}`,
          `${constructorName} capability is forbidden in generated tests. Use reviewed repository fixtures.`
        );
      }
    }

    if (ts.isIdentifier(node) && node.text === 'process') {
      const parent = node.parent;
      const isApprovedRoot =
        ts.isPropertyAccessExpression(parent)
        && parent.expression === node
        && parent.name.text === 'env'
        && (ts.isPropertyAccessExpression(parent.parent) || ts.isElementAccessExpression(parent.parent))
        && parent.parent.expression === parent
        && GENERATED_TEST_PUBLIC_ENV_NAMES.has(propertyName(parent.parent));
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node)
        || (ts.isPropertyAssignment(parent) && parent.name === node);
      if (!isApprovedRoot && !isPropertyName) {
        report('process-root', 'Direct process capability is forbidden in generated tests.');
      }
    }

    if (ts.isIdentifier(node) && node.text === 'fetch') {
      const parent = node.parent;
      const isPropertyName = ts.isPropertyAccessExpression(parent) && parent.name === node;
      if (!isPropertyName) {
        report('fetch', 'Global fetch capability is forbidden in generated tests. Use a reviewed, host-restricted fixture.');
      }
    }
    if (ts.isIdentifier(node) && node.text === 'require') {
      const parent = node.parent;
      const isPropertyName = ts.isPropertyAccessExpression(parent) && parent.name === node;
      if (!isPropertyName) {
        report('require', 'CommonJS require() is forbidden in generated tests. Use static reviewed repository imports.');
      }
    }
    if (ts.isIdentifier(node) && ['eval', 'Function'].includes(node.text)) {
      const parent = node.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node)
        || (ts.isPropertyAssignment(parent) && parent.name === node)
        || (ts.isMethodDeclaration(parent) && parent.name === node);
      if (!isPropertyName) {
        report('dynamic-code', 'Dynamic code execution is forbidden in generated tests.');
      }
    }
    if (ts.isIdentifier(node) && ['Proxy', 'Reflect'].includes(node.text)) {
      report(
        `reflection:${node.text}`,
        `Dynamic-code constructor/prototype escape is forbidden in generated tests: ${node.text}.`
      );
    }
    if (ts.isIdentifier(node) && ['global', 'globalThis', 'WebSocket', 'EventSource', 'XMLHttpRequest'].includes(node.text)) {
      report(
        `global:${node.text}`,
        `Global runtime capability is forbidden in generated tests: ${node.text}. Use reviewed Page Objects and fixtures.`
      );
    }
  });
}
