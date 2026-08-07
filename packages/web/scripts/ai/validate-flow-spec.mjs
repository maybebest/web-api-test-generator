#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GENERATION_MODES,
  REQUIRED_METADATA_FIELDS,
  REQUIRED_SECTIONS,
  STABILITY_DATA_ISOLATION_VALUES,
  STABILITY_PARALLEL_SAFE_VALUES,
  TEST_TYPE_TO_DIR,
  findDuplicateMetadataFields,
  findDuplicateSectionHeadings,
  isPlaceholderOnly,
  isPlaceholderValue,
  listSpecFiles,
  loadAiConfig,
  parseMarkdownTable,
  parseFlowSpec,
  readSpecFile,
  specGenerationMode
} from './lib/spec-parser.mjs';

const AUTH_VALUES = new Set(['none', 'required', 'optional']);
const TEST_TYPE_VALUES = new Set(Object.keys(TEST_TYPE_TO_DIR));
const GENERATION_STATUS_VALUES = new Set(['generated', 'pending-generation', 'verified']);
const NARRATIVE_PLACEHOLDER_SECTIONS = new Set(['User Story', 'Preconditions', 'Out-of-scope', 'Acceptance Criteria', 'Notes']);

function isRendererDraftSentinel(value) {
  return String(value ?? '').trim() === 'NEEDS_REVIEW';
}

function isUnresolvedValue(value) {
  const text = String(value ?? '');
  return isRendererDraftSentinel(text) || /^needs_review$/i.test(text.trim()) || isPlaceholderValue(text);
}

function permitsDraftSentinel(value, options) {
  return options.allowDraft === true && isRendererDraftSentinel(value);
}

function containsNonSentinelNeedsReview(value) {
  return [...String(value ?? '').matchAll(/needs_review/ig)].some((match) => match[0] !== 'NEEDS_REVIEW');
}

function isUnambiguousUnresolvedMarker(value) {
  // Renderer-owned table cells escape angle brackets exactly once. Decode only
  // that layer for marker classification; do not turn this into a general HTML
  // decoder or alter the public Markdown representation.
  const normalized = String(value ?? '').trim().replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/^["'`]+|["'`]+$/g, '').toLowerCase();
  return ['todo', 'tbd', 'placeholder', 'needs_review'].includes(normalized)
    || /^<(?:pending|todo|tbd|unknown|placeholder|needs_review)>$/i.test(normalized);
}

function validateSemanticValues(parsed, options) {
  const values = [];
  const tableSections = ['Metadata', 'Stability Requirements', 'Variants', 'Business Rules', 'Data Cases', 'Test Data', 'Mocks', 'Flow Steps', 'Negative Cases'];
  for (const section of tableSections) {
    for (const row of parseMarkdownTable(parsed.sections[section] ?? '').slice(1)) values.push(...row);
  }
  for (const section of ['Preconditions', 'Out-of-scope', 'Includes', 'Notes']) {
    for (const line of String(parsed.sections[section] ?? '').split(/\r?\n/)) {
      if (/^\s*[-*]\s+/.test(line)) values.push(line.replace(/^\s*[-*]\s+/, '').trim());
    }
  }
  for (const line of String(parsed.sections['User Story'] ?? '').split(/\r?\n/)) {
    const match = line.match(/^(?:As a|I want to|So that)\s+(.+?)[,.]?\s*$/i);
    if (match) values.push(match[1]);
  }
  for (const line of String(parsed.sections['Acceptance Criteria'] ?? '').split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*AC-\d{3}:\s*(.+)$/i);
    if (match) values.push(match[1]);
  }
  const visitJson = (value) => {
    if (typeof value === 'string') values.push(value);
    else if (Array.isArray(value)) value.forEach(visitJson);
    else if (value && typeof value === 'object') Object.values(value).forEach(visitJson);
  };
  if (!parsed.mocksJson.error) visitJson(parsed.mocksJson.value);
  if (!parsed.dataCasesJson.error) visitJson(parsed.dataCasesJson.value);
  return values.flatMap((value) => isUnambiguousUnresolvedMarker(value) && !permitsDraftSentinel(value, options)
    ? [`Unresolved semantic marker is not allowed: ${String(value).trim()}.`]
    : []);
}

function validateCanonicalTable(section, sectionContent, expectedHeader) {
  const rows = parseMarkdownTable(sectionContent);
  const [header, ...dataRows] = rows;
  const issues = [];
  if (!header || header.length !== expectedHeader.length || header.some((cell, index) => cell !== expectedHeader[index])) {
    issues.push(`Section "${section}" must contain the canonical table header: ${expectedHeader.join(' | ')}.`);
    return issues;
  }
  if (dataRows.length === 0) {
    issues.push(`Section "${section}" must contain at least one table data row.`);
  }
  for (const [index, row] of dataRows.entries()) {
    if (row.length !== expectedHeader.length) {
      issues.push(`Section "${section}" row ${index + 1} must contain exactly ${expectedHeader.length} cells.`);
    }
  }
  return issues;
}

function tableFieldValue(sectionContent, field) {
  const normalizedField = field.toLowerCase();
  const row = parseMarkdownTable(sectionContent ?? '').find(([name]) => String(name).toLowerCase() === normalizedField);
  return row?.[1];
}

export function isPendingGenerationSpec(metadata) {
  return (metadata['Generation Status'] ?? 'generated').toLowerCase() === 'pending-generation';
}

export function validateSpecFile(specPath, options = {}) {
  const issues = [];
  const absolutePath = path.resolve(specPath);

  if (!fs.existsSync(absolutePath)) {
    return {
      valid: false,
      issues: [`Spec file does not exist: ${specPath}`],
      metadata: {},
      acceptanceCriteria: [],
      flowSteps: [],
      content: ''
    };
  }

  const content = readSpecFile(absolutePath);
  const parsed = parseFlowSpec(content);

  const duplicateHeadings = findDuplicateSectionHeadings(content);
  if (duplicateHeadings.length > 0) {
    issues.push(
      `Duplicate section heading(s) found: ${duplicateHeadings.join(', ')}. Each "## Section" must appear once (duplicates can silently overwrite metadata).`
    );
  }

  const duplicateMetadataFields = findDuplicateMetadataFields(parsed.sections.Metadata ?? '');
  if (duplicateMetadataFields.length > 0) {
    issues.push(
      `Duplicate Metadata field(s) found: ${duplicateMetadataFields.join(', ')}. Each field may appear only once.`
    );
  }

  if (!parsed.title) {
    issues.push('Missing top-level title in the form "# Flow: <flow name>".');
  } else if (isUnresolvedValue(parsed.title) && !permitsDraftSentinel(parsed.title, options)) {
    issues.push('Flow title must not be a placeholder.');
  }

  for (const section of REQUIRED_SECTIONS) {
    const sectionContent = parsed.sections[section];
    if (sectionContent === undefined) {
      issues.push(`Missing required section: ${section}`);
      continue;
    }

    if (NARRATIVE_PLACEHOLDER_SECTIONS.has(section) && (isPlaceholderOnly(sectionContent) || containsNonSentinelNeedsReview(sectionContent))) {
      issues.push(`Section "${section}" is empty or placeholder-only.`);
    }
  }

  for (const [section, header] of [
    ['Metadata', ['Field', 'Value']],
    ['Stability Requirements', ['Field', 'Value']],
    ['Variants', loadAiConfig().variantAxes],
    ['Business Rules', ['Rule ID', 'Rule', 'Formula', 'Blocking Behavior']],
    ['Data Cases', ['Case ID', 'Inputs', 'Expected Result', 'Notes']],
    ['Test Data', ['Name', 'Value', 'Notes']],
    ['Mocks', ['API/Route', 'Scenario', 'Response']],
    ['Flow Steps', ['Step', 'AC IDs', 'Action', 'Target', 'Input', 'Expected Result', 'Assertion Hint']],
    ['Negative Cases', ['Case ID', 'Scenario', 'Expected Result']]
  ]) {
    if (parsed.sections[section] !== undefined) {
      if ((section === 'Business Rules' || section === 'Data Cases') && /^\s*[-*]\s*none\s*$/im.test(parsed.sections[section])) {
        const tableRows = parseMarkdownTable(parsed.sections[section]);
        if (tableRows.length === 0) continue;
        issues.push(`Section "${section}" must use either exactly "- none" or the canonical table, not both.`);
      }
      if (section === 'Business Rules' && parsed.businessRules.none) continue;
      if (section === 'Data Cases' && parsed.dataCases.none) continue;
      issues.push(...validateCanonicalTable(section, parsed.sections[section], header));
    }
  }

  issues.push(...validateSemanticValues(parsed, options));

  for (const field of REQUIRED_METADATA_FIELDS) {
    const value = parsed.metadata[field];
    if (!value) {
      issues.push(`Metadata field is missing: ${field}`);
    } else if (isUnresolvedValue(value) && !permitsDraftSentinel(value, options)) {
      issues.push(`Metadata field "${field}" must not be a placeholder.`);
    }
  }

  if (!options.allowDraft && /\bNEEDS_REVIEW\b/.test(content)) {
    issues.push('Spec still contains NEEDS_REVIEW markers. Resolve them before automated validation.');
  }

  const auth = parsed.metadata.Auth?.toLowerCase();
  const authValue = parsed.metadata.Auth;
  if (auth && !permitsDraftSentinel(authValue, options) && !AUTH_VALUES.has(auth)) {
    issues.push('Metadata field "Auth" must be one of: none, required, optional.');
  }

  const testType = parsed.metadata['Test Type']?.toLowerCase();
  const testTypeValue = parsed.metadata['Test Type'];
  if (testType && !permitsDraftSentinel(testTypeValue, options) && !TEST_TYPE_VALUES.has(testType)) {
    issues.push('Metadata field "Test Type" must be one of: smoke, regression, accessibility, visual.');
  }

  const generationStatus = parsed.metadata['Generation Status']?.toLowerCase();
  const generationStatusValue = parsed.metadata['Generation Status'];
  if (generationStatus && !permitsDraftSentinel(generationStatusValue, options) && !GENERATION_STATUS_VALUES.has(generationStatus)) {
    issues.push('Metadata field "Generation Status" must be one of: generated, pending-generation, verified.');
  }

  const generationMode = specGenerationMode(parsed.metadata);
  const generationModeValue = parsed.metadata['Generation Mode'];
  if (generationMode !== undefined && !permitsDraftSentinel(generationModeValue, options) && !GENERATION_MODES.has(generationMode)) {
    issues.push('Metadata field "Generation Mode" must be "single" or "suite".');
  }

  const targetTestFile = parsed.metadata['Target Test File'];
  const targetIsDraftPlaceholder = permitsDraftSentinel(targetTestFile, options);
  if (targetTestFile && !targetIsDraftPlaceholder) {
    const normalizedTarget = String(targetTestFile).replace(/\\/g, '/');
    if (path.isAbsolute(targetTestFile) || normalizedTarget.startsWith('/')) {
      issues.push('Metadata field "Target Test File" must be a relative path under tests/.');
    }
    if (normalizedTarget.split('/').includes('..')) {
      issues.push('Metadata field "Target Test File" must not contain path traversal segments.');
    }
    if (!normalizedTarget.startsWith('tests/')) {
      issues.push('Metadata field "Target Test File" must live under tests/.');
    }
    if (!normalizedTarget.endsWith('.spec.ts')) {
      issues.push('Metadata field "Target Test File" must end with .spec.ts.');
    }
  }

  // Auth/test-file naming contract: the chromium-auth project only picks up
  // *.authenticated.spec.ts files, so an auth-required spec without the
  // suffix silently runs unauthenticated, and a non-auth spec with the
  // suffix silently runs in the wrong project. Drafts (--allow-draft) are
  // tolerated like other placeholder fields. Automated validation hard-fails
  // a routing mismatch before generation.
  if (targetTestFile && auth && !(targetIsDraftPlaceholder || permitsDraftSentinel(authValue, options))) {
    const usesAuthSuffix = /\.authenticated\.spec\.ts$/.test(targetTestFile);
    if (auth === 'required' && !usesAuthSuffix) {
      issues.push(
        `Metadata Auth is "required", so Target Test File must end with .authenticated.spec.ts (chromium-auth project pattern). Found: ${targetTestFile}.`
      );
    }

    if (auth !== 'required' && usesAuthSuffix) {
      issues.push(
        `Target Test File uses the .authenticated.spec.ts suffix, but metadata Auth is "${parsed.metadata.Auth ?? '(missing)'}". Reserve the suffix for Auth=required specs so the chromium-auth project routing stays accurate. Found: ${targetTestFile}.`
      );
    }
  }

  if (targetTestFile && testType && !(targetIsDraftPlaceholder || permitsDraftSentinel(testTypeValue, options))) {
    const expectedPrefix = TEST_TYPE_TO_DIR[testType];
    if (expectedPrefix && !targetTestFile.startsWith(expectedPrefix)) {
      issues.push(
        `Target Test File must live under ${expectedPrefix} for Test Type "${testType}". Found: ${targetTestFile}.`
      );
    }
  }

  if (parsed.flowSteps.length < 3) {
    issues.push(`Flow Steps must contain at least 3 data rows. Found: ${parsed.flowSteps.length}.`);
  }

  if (parsed.acceptanceCriteria.length < 2) {
    issues.push(
      `Acceptance Criteria must contain at least 2 AC IDs in the form AC-001. Found: ${parsed.acceptanceCriteria.length}.`
    );
  }

  const acceptanceSection = parsed.sections['Acceptance Criteria'] ?? '';
  for (const line of acceptanceSection.split('\n').filter((line) => /^\s*-\s+/.test(line))) {
    if (!/^\s*-\s+AC-\d{3}:\s+\S/.test(line)) {
      issues.push(`Acceptance Criteria contains a malformed ID or row: ${line.trim()}`);
    }
  }

  const specVersion = parsed.metadata['Spec Version'];
  if (specVersion && !permitsDraftSentinel(specVersion, options) && !/^\d+\.\d+\.\d+$/.test(specVersion)) {
    issues.push('Metadata field "Spec Version" must be a semver value like 1.0.0.');
  }

  const mappedAcIds = new Set(parsed.flowSteps.flatMap((step) => step.acIds));
  for (const acId of parsed.acceptanceCriteria) {
    if (!mappedAcIds.has(acId)) {
      issues.push(`Acceptance criterion ${acId} is not mapped from any Flow Steps row AC IDs cell.`);
    }
  }

  if (parsed.mocksJson.error) {
    issues.push(parsed.mocksJson.error);
  } else {
    const mockIssues = validateMocksJson(parsed.mocksJson.value);
    issues.push(...mockIssues);
  }

  issues.push(...validateStability(parsed.stability, options, {
    parallelSafe: tableFieldValue(parsed.sections['Stability Requirements'], 'Parallel Safe'),
    dataIsolation: tableFieldValue(parsed.sections['Stability Requirements'], 'Data Isolation'),
    allowedRetries: tableFieldValue(parsed.sections['Stability Requirements'], 'Allowed Retries')
  }));
  issues.push(...validateVariants(parsed.variants));
  issues.push(...validateIncludes(parsed.includes, options.knownFlowIds));
  issues.push(...validateBusinessRules(parsed.businessRules, options));
  issues.push(...validateDataCases(parsed.dataCases));
  if (parsed.dataCasesJson.error) {
    issues.push(parsed.dataCasesJson.error);
  } else {
    issues.push(...validateDataCasesJson(parsed.dataCasesJson.value, parsed.dataCases, parsed.businessRules));
  }

  if (parsed.negativeCases.length === 0) {
    issues.push('Negative Cases must contain at least one NEG-### row.');
  } else {
    const seen = new Set();
    for (const negative of parsed.negativeCases) {
      if (seen.has(negative.caseId)) {
        issues.push(`Duplicate negative case ID within spec: ${negative.caseId}.`);
      }
      seen.add(negative.caseId);
    }
  }

  if (
    options.strict &&
    targetTestFile &&
    !isPendingGenerationSpec(parsed.metadata) &&
    !fs.existsSync(path.resolve(targetTestFile))
  ) {
    issues.push(
      `Target Test File does not exist (strict mode): ${targetTestFile}. If this spec is awaiting live generation, set "Generation Status | pending-generation".`
    );
  }

  if (
    options.strict &&
    targetTestFile &&
    isPendingGenerationSpec(parsed.metadata) &&
    fs.existsSync(path.resolve(targetTestFile))
  ) {
    issues.push(
      `Stale Generation Status (strict mode): the spec is marked pending-generation but ${targetTestFile} already exists. Set "Generation Status | generated" so the test is gated, or remove the stale test file.`
    );
  }

  return {
    valid: issues.length === 0,
    issues,
    metadata: parsed.metadata,
    acceptanceCriteria: parsed.acceptanceCriteria,
    flowSteps: parsed.flowSteps,
    locatorHints: parsed.locatorHints,
    mocksJson: parsed.mocksJson.value,
    stability: parsed.stability,
    variants: parsed.variants,
    includes: parsed.includes,
    businessRules: parsed.businessRules,
    dataCases: parsed.dataCases,
    dataCasesJson: parsed.dataCasesJson.value,
    negativeCases: parsed.negativeCases,
    content
  };
}

function validateStability(stability, options = {}, raw = {}) {
  const issues = [];

  if (!stability.parallelSafe) {
    issues.push('Stability Requirements must include "Parallel Safe".');
  } else if (!permitsDraftSentinel(raw.parallelSafe, options) && !STABILITY_PARALLEL_SAFE_VALUES.has(stability.parallelSafe)) {
    issues.push(
      `Stability Requirements field "Parallel Safe" must be yes or no. Found: ${stability.parallelSafe}.`
    );
  }

  if (!stability.dataIsolation) {
    issues.push('Stability Requirements must include "Data Isolation".');
  } else if (!permitsDraftSentinel(raw.dataIsolation, options) && !STABILITY_DATA_ISOLATION_VALUES.has(stability.dataIsolation)) {
    issues.push(
      `Stability Requirements field "Data Isolation" must be per-test, shared, or external. Found: ${stability.dataIsolation}.`
    );
  }

  if (stability.allowedRetries === undefined) {
    issues.push('Stability Requirements must include "Allowed Retries".');
  } else if (!permitsDraftSentinel(raw.allowedRetries, options) && !/^\d+$/.test(String(stability.allowedRetries))) {
    issues.push(
      `Stability Requirements field "Allowed Retries" must be a non-negative integer. Found: ${stability.allowedRetries}.`
    );
  } else if (!permitsDraftSentinel(raw.allowedRetries, options) && Number(stability.allowedRetries) !== 0) {
    issues.push(
      `Stability Requirements field "Allowed Retries" must be 0; retries can hide flaky generated tests. Found: ${stability.allowedRetries}.`
    );
  }

  return issues;
}

function validateVariants(variants) {
  if (variants.header.length === 0) {
    return ['Variants section must contain a table matching ai/config.json variantAxes.'];
  }

  const issues = [];
  const variantAxes = loadAiConfig().variantAxes;
  if (variants.header.join('|') !== variantAxes.join('|')) {
    issues.push(
      `Variants header must be ${variantAxes.join(' | ')}. Found: ${variants.header.join(' | ')}.`
    );
  }

  if (variants.rows.length === 0) {
    issues.push('Variants table must contain at least one data row.');
  }

  return issues;
}

function validateBusinessRules(businessRules, options = {}) {
  if (businessRules.none) {
    return [];
  }

  if (businessRules.header.length === 0) {
    return ['Business Rules must contain a table or a single "- none" bullet.'];
  }

  const issues = [];
  for (const column of ['Rule ID', 'Rule', 'Formula', 'Blocking Behavior']) {
    if (!businessRules.header.includes(column)) {
      issues.push(`Business Rules table must include "${column}".`);
    }
  }

  if (businessRules.rows.length === 0) {
    issues.push('Business Rules table must contain at least one data row, or use "- none".');
  }

  const seen = new Set();
  for (const row of businessRules.rows) {
    const id = row['Rule ID'];
    if (!/^RULE-\d{3}$/i.test(id ?? '')) {
      issues.push(`Business Rules row must use Rule ID format RULE-###. Found: ${id || '(blank)'}.`);
      continue;
    }

    const normalized = id.toUpperCase();
    if (seen.has(normalized)) {
      issues.push(`Duplicate business rule ID within spec: ${normalized}.`);
    }
    seen.add(normalized);

    for (const column of ['Rule', 'Formula', 'Blocking Behavior']) {
      const value = row[column];
      if (!value || (isUnresolvedValue(value) && !permitsDraftSentinel(value, options))) {
        issues.push(`Business Rules ${normalized} field "${column}" must be non-placeholder.`);
      }
    }

    const ruleText = `${row.Rule ?? ''} ${row.Formula ?? ''} ${row['Blocking Behavior'] ?? ''}`.toLowerCase();
    if (
      !permitsDraftSentinel(row.Formula, options) &&
      /minimum|maximum|duration|range|threshold|at least|at most|must be/.test(ruleText) &&
      isUnresolvedValue(row.Formula)
    ) {
      issues.push(`Business Rules ${normalized} must include a concrete Formula for validation/calculation rules.`);
    }
  }

  return issues;
}

function validateDataCases(dataCases) {
  if (dataCases.none) {
    return [];
  }

  if (dataCases.header.length === 0) {
    return ['Data Cases must contain a table or a single "- none" bullet.'];
  }

  const issues = [];
  for (const column of ['Case ID', 'Inputs', 'Expected Result']) {
    if (!dataCases.header.includes(column)) {
      issues.push(`Data Cases table must include "${column}".`);
    }
  }

  if (dataCases.rows.length === 0) {
    issues.push('Data Cases table must contain at least one data row, or use "- none".');
  }

  const seen = new Set();
  for (const row of dataCases.rows) {
    const id = row['Case ID'];
    if (!/^DC-\d{3}$/i.test(id ?? '')) {
      issues.push(`Data Cases row must use Case ID format DC-###. Found: ${id || '(blank)'}.`);
      continue;
    }

    const normalized = id.toUpperCase();
    if (seen.has(normalized)) {
      issues.push(`Duplicate data case ID within spec: ${normalized}.`);
    }
    seen.add(normalized);
  }

  return issues;
}

function validateDataCasesJson(value, dataCases, businessRules) {
  const issues = [];
  if (!Array.isArray(value)) {
    return ['Data Cases as JSON must be an array.'];
  }

  const tableIds = new Set((dataCases.rows ?? []).map((row) => String(row['Case ID'] ?? '').toUpperCase()));
  const jsonIds = new Set();

  value.forEach((dataCase, index) => {
    const prefix = `Data Cases as JSON item ${index + 1}`;
    if (!dataCase || typeof dataCase !== 'object' || Array.isArray(dataCase)) {
      issues.push(`${prefix} must be an object.`);
      return;
    }

    const caseId = String(dataCase.caseId ?? '').toUpperCase();
    if (!/^DC-\d{3}$/.test(caseId)) {
      issues.push(`${prefix} must include caseId in DC-### format.`);
    } else if (jsonIds.has(caseId)) {
      issues.push(`Duplicate Data Cases as JSON caseId: ${caseId}.`);
    } else {
      jsonIds.add(caseId);
    }

    if (!dataCase.inputs || typeof dataCase.inputs !== 'object' || Array.isArray(dataCase.inputs)) {
      issues.push(`${prefix} must include inputs object.`);
    }

    if (!dataCase.expected || typeof dataCase.expected !== 'object' || Array.isArray(dataCase.expected)) {
      issues.push(`${prefix} must include expected object.`);
    }

    if (Object.hasOwn(dataCase, 'notes') && typeof dataCase.notes !== 'string') {
      issues.push(`${prefix} notes must be a string when present.`);
    }
  });

  for (const caseId of jsonIds) {
    if (!tableIds.has(caseId)) {
      issues.push(`Data Cases as JSON caseId ${caseId} is missing from the Data Cases table.`);
    }
  }

  for (const caseId of tableIds) {
    if (!jsonIds.has(caseId)) {
      issues.push(`Data Cases table caseId ${caseId} is missing from Data Cases as JSON.`);
    }
  }

  if (hasMinimumDurationRule(businessRules)) {
    const corpus = JSON.stringify(value).toLowerCase();
    for (const boundary of ['below-minimum', 'at-minimum', 'above-minimum']) {
      if (!corpus.includes(boundary)) {
        issues.push(`Minimum/duration business rules require a ${boundary} Data Cases as JSON boundary case.`);
      }
    }
  }

  return issues;
}

function hasMinimumDurationRule(businessRules) {
  if (businessRules.none) {
    return false;
  }

  return (businessRules.rows ?? []).some((row) =>
    /minimum|at least|duration/.test(
      `${row.Rule ?? ''} ${row.Formula ?? ''} ${row['Blocking Behavior'] ?? ''}`.toLowerCase()
    )
  );
}

function validateIncludes(includes, knownFlowIds) {
  if (includes.length === 0) {
    return ['Includes section must contain at least one bullet (or "none").'];
  }

  const noneOnly = includes.length === 1 && includes[0].toLowerCase() === 'none';
  if (noneOnly) {
    return [];
  }

  const issues = [];
  for (const reference of includes) {
    if (reference.toLowerCase() === 'none') {
      issues.push('Includes mixes "none" with concrete flow IDs.');
      continue;
    }

    if (!/^FLOW-[A-Z0-9-]+$/i.test(reference)) {
      issues.push(`Includes entry must be "none" or a Flow ID matching FLOW-... Found: ${reference}.`);
      continue;
    }

    if (knownFlowIds && !knownFlowIds.has(reference.toUpperCase())) {
      issues.push(`Includes references unknown Flow ID: ${reference}.`);
    }
  }

  return issues;
}

function validateMocksJson(value) {
  const issues = [];
  if (!Array.isArray(value)) {
    return ['Mocks as JSON must be an array.'];
  }

  value.forEach((mock, index) => {
    const prefix = `Mocks as JSON item ${index + 1}`;
    if (!mock || typeof mock !== 'object' || Array.isArray(mock)) {
      issues.push(`${prefix} must be an object.`);
      return;
    }

    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(mock.method)) {
      issues.push(`${prefix} must include method GET, POST, PUT, PATCH, or DELETE.`);
    }

    if (typeof mock.url !== 'string' || !mock.url.startsWith('/')) {
      issues.push(`${prefix} must include a relative url string starting with "/".`);
    }

    if (!Number.isInteger(mock.status) || mock.status < 100 || mock.status > 599) {
      issues.push(`${prefix} must include an integer HTTP status.`);
    }

    if (!Object.hasOwn(mock, 'body')) {
      issues.push(`${prefix} must include body.`);
    }
  });

  return issues;
}

export function validateSpecDirectory(specDir, options = {}) {
  const files = listSpecFiles(specDir);
  const issues = [];
  const flowIds = new Map();
  const results = [];

  if (!fs.existsSync(specDir)) {
    issues.push(`Spec directory not found: ${specDir}.`);
  } else if (files.length === 0) {
    issues.push(`No flow specs found in ${specDir}; refusing a zero-spec validation pass.`);
  }

  const knownFlowIds = new Set();
  for (const specPath of files) {
    const flowId = parseFlowSpec(readSpecFile(specPath)).metadata['Flow ID'];
    if (flowId) {
      knownFlowIds.add(flowId.toUpperCase());
    }
  }

  for (const specPath of files) {
    const result = validateSpecFile(specPath, { ...options, knownFlowIds });
    results.push({ specPath, result });

    if (!result.valid) {
      issues.push(...result.issues.map((issue) => `${specPath}: ${issue}`));
    }

    const flowId = result.metadata['Flow ID'];
    if (flowId) {
      if (flowIds.has(flowId)) {
        issues.push(`Duplicate Flow ID "${flowId}" in ${flowIds.get(flowId)} and ${specPath}.`);
      } else {
        flowIds.set(flowId, specPath);
      }
    }

    // result.acceptanceCriteria is already deduplicated by the parser, so
    // duplicates must be detected on the raw Acceptance Criteria bullets.
    const acSection = parseFlowSpec(result.content ?? '').sections?.['Acceptance Criteria'] ?? '';
    const rawAcIds = [...acSection.matchAll(/^\s*[-*]\s*(AC-\d{3})\b/gm)].map((match) => match[1]);
    const seenAcIds = new Set();
    for (const acId of rawAcIds) {
      if (seenAcIds.has(acId)) {
        issues.push(`Duplicate AC ID "${acId}" within ${specPath}.`);
      }
      seenAcIds.add(acId);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    results
  };
}

function printFileResult(specPath, result) {
  if (result.valid) {
    console.log(`Flow spec validation passed: ${specPath}`);
    console.log(`Flow ID: ${result.metadata['Flow ID']}`);
    console.log(`Target Test File: ${result.metadata['Target Test File']}`);
    console.log(`Acceptance Criteria: ${result.acceptanceCriteria.join(', ')}`);
    return;
  }

  console.error(`Flow spec validation failed: ${specPath}`);
  for (const issue of result.issues) {
    console.error(`- ${issue}`);
  }
}

function printDirResult(specDir, result) {
  if (result.valid) {
    console.log(`Flow spec directory validation passed: ${specDir}`);
    console.log(`Specs validated: ${result.results.length}`);
    return;
  }

  console.error(`Flow spec directory validation failed: ${specDir}`);
  for (const issue of result.issues) {
    console.error(`- ${issue}`);
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/validate-flow-spec.mjs [<spec-path>] [--strict]
  node scripts/ai/validate-flow-spec.mjs --dir <spec-directory> [--strict]

Validates flow specs against the generated-test contract.
Without arguments, validates every spec under specs/.
--strict additionally requires Target Test File to exist on disk for generated
specs and flags pending-generation specs whose Target Test File already exists.
--allow-draft permits unresolved placeholders for structural checks only.`);
}

function runCli() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const strict = args.includes('--strict');
  const allowDraft = args.includes('--allow-draft');
  const positional = args.filter((arg) => arg !== '--strict' && arg !== '--allow-draft');

  if (positional[0] === '--dir') {
    if (positional.length !== 2) {
      printHelp();
      process.exit(1);
    }

    const result = validateSpecDirectory(positional[1], { strict, allowDraft });
    printDirResult(positional[1], result);
    if (!result.valid) {
      process.exit(1);
    }
    return;
  }

  // Bare "ai:spec:validate" defaults to the standard spec directory, matching
  // the recording validator's directory default.
  if (positional.length === 0) {
    const result = validateSpecDirectory('specs', { strict, allowDraft });
    printDirResult('specs', result);
    if (!result.valid) {
      process.exit(1);
    }
    return;
  }

  if (positional.length !== 1) {
    printHelp();
    process.exit(1);
  }

  const [specPath] = positional;
  const result = validateSpecFile(specPath, { strict, allowDraft });
  printFileResult(specPath, result);

  if (!result.valid) {
    process.exit(1);
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli();
}
