#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { sanitizeGenerationContext } from './lib/generation-context.mjs';
import { extractSections, parseFlowSpec, parseMarkdownTable } from './lib/spec-parser.mjs';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_OUTPUT_DIRECTORY = path.join(WEB_ROOT, 'docs', 'ai-testing');

const YAML_CASE_SOURCES = [
  'specs/test-cases.yaml',
  'specs/test-cases-skus-2.yaml',
  'specs/secondary-space/test-cases.yaml',
  'specs/secondary-space/test-cases-feature-flag.yaml'
];
const YAML_JOURNEY_SOURCE = 'specs/secondary-space/critical-user-journeys.yaml';
const NARRATIVE_CASE_SOURCES = [
  'specs/sains/nectar-ai-test-cases-by-module.md',
  'specs/sains/sains-project-qa-notes.md'
];

const PRODUCT_DECISION_BLOCKED_IDS = new Set([
  ...rangeIds('TC-SPI-', 1, 13),
  ...rangeIds('TC-SPI-', 15, 18),
  'TC-SPI-022',
  'TC-CHL-016',
  'TC-CHL-025',
  'TC-CHL-028',
  'TC-ABL-024',
  'TC-ABL-025',
  'TC-GHM-033',
  'TC-XJ-020'
]);

const FICTIONAL_DATA_BLOCKED_IDS = new Set([
  ...rangeIds('TC-VAL-', 1, 4),
  'TC-ABL-013',
  'TC-ABL-014',
  'TC-ABL-015',
  'TC-ABL-029'
]);

const PRECONDITION_BUNDLES = {
  BASE_URL: {
    availability: 'available-this-assessment',
    requirement: 'Exact allowlisted HTTPS non-production Pollen URL.'
  },
  UI_AUTH: {
    availability: 'available-this-assessment',
    requirement: 'Fresh owner-only Playwright storage state for the exact non-production origin.'
  },
  API_AUTH: {
    availability: 'missing',
    requirement:
      'API-capable bearer token or refreshable auth plus an exact NECTAR_AUTH_ALLOWED_ISSUERS allowlist.'
  },
  DISPOSABLE_SESSION: {
    availability: 'missing',
    requirement:
      'QA-owned NECTAR_PLANNING_SESSION_ID or a verified conversation create/read/delete lifecycle.'
  },
  MUTATION_POLICY: {
    availability: 'missing',
    requirement:
      'Exact machine allowlist for non-production mutation targets plus bounded ownership checks.'
  },
  VERIFIED_CLEANUP: {
    availability: 'missing',
    requirement:
      'Idempotent cleanup/restore with ownership checks for every created or changed record.'
  },
  ROLE_SESSIONS: {
    availability: 'missing',
    requirement: 'Separate stable internal, external, and admin/Channel Management auth states.'
  },
  REAL_CATALOGUE_DATA: {
    availability: 'partial',
    requirement:
      'Stable advertiser, brand, and real brand-linked SKU identifiers with enough rows for each boundary.'
  },
  CATALOGUE_MUTATION: {
    availability: 'missing',
    requirement: 'Verified reversible per-SKU brand link and unlink adapters.'
  },
  PLAN_LIFECYCLE: {
    availability: 'missing',
    requirement:
      'Verified disposable media-plan create, channel assignment, readback, and delete adapters.'
  },
  CHANNEL_FIXTURES: {
    availability: 'partial',
    requirement:
      'Exclusive real channels for every group with known eligibility, deadlines, durations, store bounds, rates, and Hero limits.'
  },
  CHANNEL_CONFIG_ADMIN: {
    availability: 'missing',
    requirement:
      'Admin-capable API identity, exclusive channel ownership, safe admin_editMedia writes, and independently verified restoration.'
  },
  STORE_CHANNEL_ENV: {
    availability: 'missing',
    requirement:
      'Exact Cost-per-store, Cost-per-unit, Base-rate, and unbounded channel environment mappings.'
  },
  PARSER_ORACLE: {
    availability: 'missing',
    requirement:
      'Deployed single-prompt feature, deterministic assistant completion signal, stable parsed-state UI, and singular unknown/empty-Hero behavior.'
  },
  SECONDARY_SPACE_FIXTURES: {
    availability: 'missing',
    requirement:
      'Channels with controlled piggyBackAssetTypes, mandatory/optional/internalOnly combinations, role fixtures, Base/Pollen source control, and persistence readback.'
  },
  FAILURE_INJECTION: {
    availability: 'missing',
    requirement:
      'Run-scoped clock, cache flush, network/backend fault, latency, and autosave-failure controls with cleanup.'
  },
  EXTERNAL_READBACK: {
    availability: 'missing',
    requirement:
      'Authorized read access to saved-plan state, export/CSV, MongoDB, Base/Pollen diagnostics, CRM, activation, or booking as applicable.'
  },
  ATTACHMENT_VOICE_FIXTURES: {
    availability: 'missing',
    requirement:
      'Versioned machine-readable MIME/size matrix, fixture uploads, virtual microphone audio, permissions, locale matrix, and transcript oracle.'
  },
  PRODUCT_DECISION: {
    availability: 'missing',
    requirement: 'One authoritative expected behavior and a record of superseded/obsolete cases.'
  },
  PRODUCTION_AUTHORITY: {
    availability: 'missing',
    requirement:
      'Machine-issued read-only production policy, deployment/config evidence, bounded target allowlist, and rollback plan.'
  }
};

function rangeIds(prefix, start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) =>
    `${prefix}${String(start + index).padStart(3, '0')}`
  );
}

function parseArgs(args) {
  const result = {
    outputDirectory: DEFAULT_OUTPUT_DIRECTORY,
    check: false,
    baseUrl: undefined,
    authVerified: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--out-dir') {
      result.outputDirectory = path.resolve(args[index + 1]);
      index += 1;
    } else if (arg === '--check') {
      result.check = true;
    } else if (arg === '--base-url') {
      result.baseUrl = args[index + 1];
      index += 1;
    } else if (arg === '--auth-verified') {
      result.authVerified = true;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return result;
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/generate-e2e-inventory.mjs [options]

Options:
  --out-dir <directory>  Output directory (default: docs/ai-testing)
  --base-url <url>       Record the non-secret target URL used for this assessment
  --auth-verified        Record that a page-load-only auth check succeeded
  --check                Fail when committed generated outputs are stale

The command reads every explicit YAML/Markdown test-case source under specs/, merges
strict-flow projections by sourceCaseId, and writes a Markdown catalogue, a detailed
JSON catalogue, and a blocked-preconditions report. It never reads auth-state content.`);
}

function absolute(relativePath) {
  return path.join(WEB_ROOT, relativePath);
}

function read(relativePath) {
  return fs.readFileSync(absolute(relativePath), 'utf8');
}

function normalizeList(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap(normalizeList);
  if (typeof value === 'object') return [sanitizeGenerationContext(JSON.stringify(value)).trim()].filter(Boolean);
  return [sanitizeGenerationContext(String(value)).trim()].filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function lineOf(text, pattern) {
  const match = typeof pattern === 'string' ? text.indexOf(pattern) : text.search(pattern);
  if (match < 0) return 1;
  return text.slice(0, match).split(/\r?\n/).length;
}

function yamlCaseLine(text, id) {
  return lineOf(text, new RegExp(`^\\s*- id:\\s*["']?${escapeRegExp(id)}["']?\\s*$`, 'm'));
}

function markdownCaseLine(text, id) {
  return lineOf(text, new RegExp(`^\\|\\s*${escapeRegExp(id)}\\s*\\|`, 'm'));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sourceReference(sourcePath, line, kind) {
  return { path: sourcePath, line, kind };
}

function emptyCase({ id, title, source, kind = 'atomic' }) {
  return {
    id,
    title: title || id,
    kind,
    declaredType: undefined,
    priority: undefined,
    area: undefined,
    preconditions: [],
    steps: [],
    expected: [],
    assumptions: [],
    openQuestions: [],
    sourceReferences: [source],
    formalMappings: [],
    composedCaseIds: [],
    duplicateTitleCandidates: [],
    implementation: { status: 'not-implemented', testFiles: [] },
    automation: { status: 'automatable', blockerCodes: [], blockerDetails: [], requiredPreconditions: [] }
  };
}

function addOrMergeCase(caseMap, incoming) {
  const existing = caseMap.get(incoming.id);
  if (!existing) {
    caseMap.set(incoming.id, incoming);
    return incoming;
  }

  existing.sourceReferences = uniqueObjects([...existing.sourceReferences, ...incoming.sourceReferences]);
  existing.preconditions = unique([...existing.preconditions, ...incoming.preconditions]);
  existing.steps = unique([...existing.steps, ...incoming.steps]);
  existing.expected = unique([...existing.expected, ...incoming.expected]);
  existing.assumptions = unique([...existing.assumptions, ...incoming.assumptions]);
  existing.openQuestions = unique([...existing.openQuestions, ...incoming.openQuestions]);
  existing.formalMappings = uniqueObjects([...existing.formalMappings, ...incoming.formalMappings]);
  existing.composedCaseIds = unique([...existing.composedCaseIds, ...incoming.composedCaseIds]);
  if (!existing.title || existing.title === existing.id) existing.title = incoming.title;
  existing.declaredType ??= incoming.declaredType;
  existing.priority ??= incoming.priority;
  existing.area ??= incoming.area;
  return existing;
}

function uniqueObjects(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function loadYaml(relativePath) {
  const content = read(relativePath);
  let parsed;
  try {
    parsed = yaml.load(content);
  } catch (error) {
    const line = error?.mark?.line === undefined ? 'unknown' : error.mark.line + 1;
    throw new Error(`Invalid YAML in ${relativePath}:${line}: ${error.reason ?? error.message}`);
  }
  return { content, parsed };
}

function collectYamlCases(caseMap, relativePath) {
  const { content, parsed } = loadYaml(relativePath);
  const rows = Array.isArray(parsed?.testCases) ? parsed.testCases : [];
  for (const row of rows) {
    if (!row?.id) continue;
    const source = sourceReference(relativePath, yamlCaseLine(content, row.id), 'yaml-case');
    const candidate = emptyCase({ id: String(row.id), title: String(row.title ?? row.id), source });
    candidate.declaredType = row.type ? String(row.type) : undefined;
    candidate.priority = row.priority ? String(row.priority) : undefined;
    candidate.area = String(row.area ?? row.module ?? parsed.module ?? '').trim() || undefined;
    candidate.preconditions = normalizeList(row.preconditions);
    candidate.steps = normalizeList(row.steps);
    candidate.expected = normalizeList(row.expected ?? row.expectedResult);
    candidate.assumptions = normalizeList(row.assumptions);
    candidate.openQuestions = normalizeList(row.openQuestions);
    candidate.testData = normalizeList(row.testData ?? row.testDataNotes);
    candidate.automationNotes = normalizeList(row.automationNotes);
    addOrMergeCase(caseMap, candidate);
  }
  return rows.length;
}

function collectYamlJourneys(caseMap) {
  const { content, parsed } = loadYaml(YAML_JOURNEY_SOURCE);
  const rows = Array.isArray(parsed?.journeys) ? parsed.journeys : [];
  for (const row of rows) {
    if (!row?.id) continue;
    const source = sourceReference(
      YAML_JOURNEY_SOURCE,
      yamlCaseLine(content, row.id),
      'yaml-composite-journey'
    );
    const candidate = emptyCase({
      id: String(row.id),
      title: String(row.title ?? row.id),
      source,
      kind: 'composite-journey'
    });
    candidate.declaredType = row.type ? String(row.type) : 'e2e';
    candidate.priority = row.priority ? String(row.priority) : undefined;
    candidate.area = normalizeList(row.modules).join(', ') || undefined;
    candidate.composedCaseIds = normalizeList(row.testCases);
    candidate.openQuestions = normalizeList(row.openQuestions);
    addOrMergeCase(caseMap, candidate);
  }
  return rows.length;
}

function splitMarkdownRow(line) {
  const cells = [];
  let current = '';
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] === '\\' && trimmed[index + 1] === '|') {
      current += '|';
      index += 1;
    } else if (trimmed[index] === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += trimmed[index];
    }
  }
  cells.push(current.trim());
  return cells;
}

function collectNarrativeCases(caseMap, relativePath) {
  const content = read(relativePath);
  const lines = content.split(/\r?\n/);
  let heading = '';
  let collected = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = lines[index].match(/^#{2,3}\s+(.+?)\s*$/);
    if (headingMatch) heading = headingMatch[1];
    if (!lines[index].trim().startsWith('|')) continue;

    const tableStart = index;
    const tableLines = [];
    while (index < lines.length && lines[index].trim().startsWith('|')) {
      tableLines.push(lines[index]);
      index += 1;
    }
    index -= 1;

    const rows = tableLines.map(splitMarkdownRow).filter((row) => row.length > 0);
    if (rows.length < 3) continue;
    const headers = rows[0].map((value) => value.toLowerCase());
    const idIndex = headers.indexOf('id');
    const scenarioIndex = headers.indexOf('scenario');
    const expectedIndex = headers.findIndex((value) => value === 'expected result' || value === 'expected');
    if (idIndex < 0 || scenarioIndex < 0 || expectedIndex < 0) continue;

    const priorityIndex = headers.indexOf('priority');
    const preconditionsIndex = headers.indexOf('preconditions');
    const stepsIndex = headers.indexOf('steps');
    for (const row of rows.slice(2)) {
      const id = row[idIndex]?.trim();
      if (!id || !/^[A-Z][A-Z0-9-]*(?:\s*\/\s*[A-Z][A-Z0-9-]*)?$/.test(id)) continue;
      const source = sourceReference(relativePath, tableStart + rows.indexOf(row) + 1, 'markdown-case-table');
      const candidate = emptyCase({ id, title: row[scenarioIndex] || id, source });
      candidate.priority = priorityIndex >= 0 ? row[priorityIndex] || undefined : undefined;
      candidate.area = heading;
      candidate.preconditions = preconditionsIndex >= 0 ? normalizeList(row[preconditionsIndex]) : [];
      candidate.steps = stepsIndex >= 0 ? normalizeList(row[stepsIndex]) : [];
      candidate.expected = normalizeList(row[expectedIndex]);
      candidate.declaredType = 'e2e-candidate';
      addOrMergeCase(caseMap, candidate);
      collected += 1;
    }
  }

  return collected;
}

function listStrictFlowSpecs() {
  const result = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (entry.name.endsWith('.md') && entry.name !== '_template.md') {
        const content = fs.readFileSync(absolutePath, 'utf8');
        if (/^#\s+Flow:\s*.+$/m.test(content)) {
          result.push(path.relative(WEB_ROOT, absolutePath));
        }
      }
    }
  };
  walk(path.join(WEB_ROOT, 'specs'));
  return result.sort();
}

function parseBulletSection(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter((line) => line && line.toLowerCase() !== 'none');
}

function flattenExpected(value, prefix = '') {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap((item) => flattenExpected(item, prefix));
  if (typeof value !== 'object') return [`${prefix}${String(value)}`];
  return Object.entries(value).flatMap(([key, child]) =>
    flattenExpected(child, prefix ? `${prefix}${key}=` : `${key}=`)
  );
}

function pendingAutomationMap(parsed) {
  const entry = Object.entries(parsed.sections).find(([name]) => name.startsWith('Pending Automation'));
  if (!entry) return new Map();
  const rows = parseMarkdownTable(entry[1]);
  const [, ...dataRows] = rows;
  return new Map(
    dataRows
      .filter((row) => /^TC-[A-Z0-9-]+/.test(row[0] ?? ''))
      .map((row) => [row[0].match(/^(TC-[A-Z0-9-]+)/)?.[1], row[1] ?? ''])
      .filter(([id]) => id)
  );
}

function collectStrictFlowCases(caseMap) {
  const flowSummary = [];
  for (const relativePath of listStrictFlowSpecs()) {
    const content = read(relativePath);
    const parsed = parseFlowSpec(content);
    const metadata = parsed.metadata;
    const flowId = metadata['Flow ID'];
    const targetTestFile = metadata['Target Test File'];
    const generationStatus = metadata['Generation Status'] ?? 'unknown';
    const flowPreconditions = parseBulletSection(parsed.sections.Preconditions);
    const dataCases = Array.isArray(parsed.dataCasesJson?.value) ? parsed.dataCasesJson.value : [];
    const pending = pendingAutomationMap(parsed);

    for (const dataCase of dataCases) {
      const sourceId = dataCase?.inputs?.sourceCaseId;
      const id = sourceId || `${flowId}:${dataCase.caseId}`;
      const source = sourceReference(
        relativePath,
        lineOf(content, new RegExp(`"caseId"\\s*:\\s*"${escapeRegExp(dataCase.caseId)}"`)),
        'strict-flow-data-case'
      );
      const titleSuffix =
        dataCase?.inputs?.title ?? dataCase?.inputs?.boundary ?? dataCase?.expected?.result ?? dataCase.caseId;
      const candidate = emptyCase({
        id,
        title: sourceId ? String(dataCase.inputs.title ?? sourceId) : `${parsed.title} — ${titleSuffix}`,
        source
      });
      candidate.declaredType = metadata['Test Type'];
      candidate.priority = metadata.Priority;
      candidate.area = parsed.title;
      candidate.preconditions = unique([
        ...flowPreconditions,
        ...normalizeList(dataCase?.inputs?.preconditions)
      ]);
      candidate.steps = normalizeList(dataCase?.inputs?.steps);
      if (candidate.steps.length === 0) {
        candidate.steps = parsed.flowSteps.map((step) => `${step.acIds.join(', ')} ${step.action}`).filter(Boolean);
      }
      candidate.expected = unique([
        ...normalizeList(dataCase?.inputs?.expectedText),
        ...flattenExpected(dataCase?.expected)
      ]);
      candidate.formalMappings = [
        {
          flowId,
          dataCaseId: dataCase.caseId,
          specPath: relativePath,
          targetTestFile,
          generationStatus,
          pendingBlocker: sourceId ? pending.get(sourceId) : undefined
        }
      ];
      addOrMergeCase(caseMap, candidate);
    }

    for (const negative of parsed.negativeCases) {
      const id = `${flowId}:${negative.caseId}`;
      const source = sourceReference(
        relativePath,
        markdownCaseLine(content, negative.caseId),
        'strict-flow-negative-case'
      );
      const candidate = emptyCase({
        id,
        title: `${parsed.title} — ${negative.scenario}`,
        source,
        kind: 'negative'
      });
      candidate.declaredType = metadata['Test Type'];
      candidate.priority = metadata.Priority;
      candidate.area = parsed.title;
      candidate.preconditions = flowPreconditions;
      candidate.steps = [negative.scenario];
      candidate.expected = [negative.expectedResult];
      candidate.formalMappings = [
        {
          flowId,
          negativeCaseId: negative.caseId,
          specPath: relativePath,
          targetTestFile,
          generationStatus
        }
      ];
      addOrMergeCase(caseMap, candidate);
    }

    flowSummary.push({
      flowId,
      specPath: relativePath,
      targetTestFile,
      generationStatus,
      acceptanceCriteria: parsed.acceptanceCriteria,
      dataCaseCount: dataCases.length,
      negativeCaseCount: parsed.negativeCases.length
    });
  }
  return flowSummary;
}

function collectTestFiles() {
  const root = path.join(WEB_ROOT, 'tests');
  const files = [];
  const walk = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolutePath);
      else if (entry.name.endsWith('.spec.ts')) {
        files.push({
          path: path.relative(WEB_ROOT, absolutePath),
          content: fs.readFileSync(absolutePath, 'utf8')
        });
      }
    }
  };
  walk(root);
  return files;
}

function missingHeaderSpecs(testFiles) {
  return unique(
    testFiles
      .map((file) => file.content.match(/\/\*\s*spec:\s*([^\s]+)/)?.[1])
      .filter(Boolean)
      .filter((specPath) => !fs.existsSync(path.resolve(WEB_ROOT, specPath)))
  ).sort();
}

function implementationFor(candidate, testFiles) {
  const matched = new Set();
  for (const mapping of candidate.formalMappings) {
    if (!mapping.targetTestFile) continue;
    const target = testFiles.find((file) => file.path === mapping.targetTestFile);
    if (!target) continue;
    const marker = mapping.dataCaseId ?? mapping.negativeCaseId ?? candidate.id;
    if (target.content.includes(marker) || target.content.includes(candidate.id)) matched.add(target.path);
  }
  for (const file of testFiles) {
    if (file.content.includes(candidate.id)) matched.add(file.path);
  }

  const pendingMapping = candidate.formalMappings.find(
    (mapping) => mapping.generationStatus === 'pending-generation'
  );
  const orphaned = [...matched].some((testPath) => {
    const file = testFiles.find((entry) => entry.path === testPath);
    const headerSpec = file?.content.match(/\/\*\s*spec:\s*([^\s]+)/)?.[1];
    return headerSpec && !fs.existsSync(path.join(WEB_ROOT, headerSpec));
  });

  if (pendingMapping && matched.size > 0) {
    return { status: 'present-status-conflict', testFiles: [...matched].sort() };
  }
  if (pendingMapping) return { status: 'not-generated-by-contract', testFiles: [] };
  if (orphaned) return { status: 'implemented-orphaned', testFiles: [...matched].sort() };
  if (matched.size > 0 && candidate.formalMappings.length > 0) {
    return { status: 'implemented-contract-bound', testFiles: [...matched].sort() };
  }
  if (matched.size > 0) return { status: 'referenced-in-unbound-test', testFiles: [...matched].sort() };
  return { status: 'not-implemented', testFiles: [] };
}

function combinedText(candidate) {
  return [
    candidate.id,
    candidate.title,
    candidate.area,
    candidate.declaredType,
    ...candidate.preconditions,
    ...candidate.steps,
    ...candidate.expected,
    ...candidate.assumptions,
    ...candidate.openQuestions,
    ...(candidate.testData ?? []),
    ...(candidate.automationNotes ?? [])
  ]
    .filter(Boolean)
    .join(' ');
}

function behavioralText(candidate) {
  return [
    candidate.id,
    candidate.title,
    ...candidate.preconditions,
    ...candidate.steps,
    ...candidate.expected,
    ...candidate.assumptions,
    ...candidate.openQuestions,
    ...(candidate.testData ?? []),
    ...(candidate.automationNotes ?? [])
  ]
    .filter(Boolean)
    .join(' ');
}

function looksStateful(candidate) {
  const text = `${candidate.steps.join(' ')} ${candidate.title}`;
  return /\b(start|create|enter|type|provide|submit|click|send|select|choose|confirm|add|assign|edit|change|set|toggle|deselect|remove|delete|save|discard|reopen|upload|book|proceed|attempt|hover|refresh.*(?:draft|flow)|expire)\b/i.test(
    text
  );
}

function classifyAutomation(candidate, options) {
  const text = combinedText(candidate);
  const behavior = behavioralText(candidate);
  const blockerCodes = new Set(['BASE_URL']);
  const blockerDetails = [];

  if (!/unauthenticated|logged[- ]out|clean\/incognito/i.test(text)) blockerCodes.add('UI_AUTH');
  if (candidate.kind === 'composite-journey') {
    return finalizeAutomation('duplicate-or-composite', blockerCodes, blockerDetails, candidate, options);
  }

  for (const mapping of candidate.formalMappings) {
    if (mapping.pendingBlocker) {
      blockerDetails.push(mapping.pendingBlocker);
      if (/no-assertable|ui-flow-expectation|contract-mismatch/i.test(mapping.pendingBlocker)) {
        blockerCodes.add('PARSER_ORACLE');
      }
      if (/channel-config/i.test(mapping.pendingBlocker)) blockerCodes.add('CHANNEL_CONFIG_ADMIN');
      if (/warning-needs-channel/i.test(mapping.pendingBlocker)) blockerCodes.add('PLAN_LIFECYCLE');
    }
  }

  if (PRODUCT_DECISION_BLOCKED_IDS.has(candidate.id)) {
    blockerCodes.add('PRODUCT_DECISION');
    blockerDetails.push('Existing automation triage marks this source case blocked pending an authoritative product rule.');
  }
  if (FICTIONAL_DATA_BLOCKED_IDS.has(candidate.id)) {
    blockerCodes.add('REAL_CATALOGUE_DATA');
    blockerDetails.push('Existing automation triage identifies fictional/nonexistent brands, SKUs, or channels.');
  }

  if (/\b(internal|external|admin|channel management)\b/i.test(text)) blockerCodes.add('ROLE_SESSIONS');
  if (/brand[- ]linked|link(?:ed|ing)?\s+sku|unlink|switch brand|change advertiser/i.test(text)) {
    blockerCodes.add('REAL_CATALOGUE_DATA');
    if (/auto-add|not (?:initially )?in measurement|unlink|switch brand|change advertiser/i.test(text)) {
      blockerCodes.add('CATALOGUE_MUTATION');
    }
  }
  if (/secondary space|piggyback|piggyBackAssetTypes|mandatory element|optional element/i.test(text)) {
    blockerCodes.add('SECONDARY_SPACE_FIXTURES');
  }
  if (/booking deadline|minimum duration|min(?:imum)? store|max(?:imum)? store|cost per store|cost per unit|base rate|fixed cost/i.test(text)) {
    blockerCodes.add('CHANNEL_FIXTURES');
  }
  if (/maxHeroSkus|minHeroSkus|hero sku (?:max|min)|configured max|configured min/i.test(text)) {
    blockerCodes.add('CHANNEL_CONFIG_ADMIN');
  }
  if (/cost per store|cost per unit|base rate|unbounded channel/i.test(text)) blockerCodes.add('STORE_CHANNEL_ENV');
  if (/single[- ]prompt|parse(?:r|d|s| outcome)?|ambiguous prompt|clarif(?:y|ication)|unknown sku/i.test(text)) {
    blockerCodes.add('PARSER_ORACLE');
  }
  if (/session exp|expire session|invalidate token|cache|stale config|network.*fail|api.*fail|timeout|latency|autosave fail|clock|midnight/i.test(text)) {
    blockerCodes.add('FAILURE_INJECTION');
  }
  if (/attachment|microphone|voice|audio|transcript/i.test(behavior)) {
    blockerCodes.add('ATTACHMENT_VOICE_FIXTURES');
  }
  if (/mongodb|crm|activation|downstream|pollen handoff|base unavailable|pollen fallback|export|csv|download|booking integration|future booking/i.test(behavior)) {
    blockerCodes.add('EXTERNAL_READBACK');
  }
  if (/feature flag.*production|production deployment|in production|production environment|check production/i.test(behavior)) {
    blockerCodes.add('PRODUCTION_AUTHORITY');
  }
  if (/save plan|saved plan|discard plan|reopen|delete plan|confirm delete|delete channel|plan persist|conversation history|conversation route|existing conversation|autosave|booking/i.test(behavior)) {
    blockerCodes.add('PLAN_LIFECYCLE');
  }

  if (candidate.implementation.testFiles.some((testFile) => {
    const content = fs.readFileSync(absolute(testFile), 'utf8');
    return /\b(?:dataManager|nectarApi)\b/.test(content);
  })) {
    blockerCodes.add('API_AUTH');
  }

  if (looksStateful(candidate)) {
    blockerCodes.add('DISPOSABLE_SESSION');
    blockerCodes.add('MUTATION_POLICY');
    blockerCodes.add('VERIFIED_CLEANUP');
  }

  let status;
  if (blockerCodes.has('PRODUCTION_AUTHORITY') || blockerCodes.has('EXTERNAL_READBACK')) {
    status = 'blocked-production-or-integration-policy';
  } else if (blockerCodes.has('PRODUCT_DECISION')) {
    status = 'blocked-product-decision';
  } else if (
    blockerCodes.has('PARSER_ORACLE') ||
    blockerCodes.has('FAILURE_INJECTION') ||
    blockerCodes.has('ATTACHMENT_VOICE_FIXTURES')
  ) {
    status = 'blocked-observability-or-contract';
  } else if (
    blockerCodes.has('ROLE_SESSIONS') ||
    blockerCodes.has('CATALOGUE_MUTATION') ||
    blockerCodes.has('PLAN_LIFECYCLE') ||
    blockerCodes.has('CHANNEL_CONFIG_ADMIN') ||
    blockerCodes.has('SECONDARY_SPACE_FIXTURES') ||
    blockerCodes.has('STORE_CHANNEL_ENV')
  ) {
    status = 'blocked-test-data';
  } else if (looksStateful(candidate)) {
    status = 'automatable-execution-blocked';
  } else if (candidate.implementation.status !== 'not-implemented') {
    status = 'automated-live-unverified';
  } else {
    status = 'automatable';
  }

  return finalizeAutomation(status, blockerCodes, blockerDetails, candidate, options);
}

function finalizeAutomation(status, blockerCodes, blockerDetails, candidate, options) {
  const requirements = [];
  for (const code of blockerCodes) {
    const bundle = PRECONDITION_BUNDLES[code];
    if (bundle) requirements.push(`[${code}] ${bundle.requirement}`);
  }
  requirements.push(...candidate.preconditions.map((value) => `[SOURCE] ${value}`));

  const missingCodes = [...blockerCodes].filter((code) => {
    if (code === 'BASE_URL') return !options.baseUrl;
    if (code === 'UI_AUTH') return !options.authVerified;
    return PRECONDITION_BUNDLES[code]?.availability !== 'available-this-assessment';
  });

  return {
    status,
    blockerCodes: [...blockerCodes].sort(),
    missingCodes: missingCodes.sort(),
    blockerDetails: unique(blockerDetails),
    requiredPreconditions: unique(requirements)
  };
}

function addDuplicateCandidates(cases) {
  const groups = new Map();
  for (const candidate of cases) {
    const normalized = candidate.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    if (!normalized) continue;
    const group = groups.get(normalized) ?? [];
    group.push(candidate);
    groups.set(normalized, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const candidate of group) {
      candidate.duplicateTitleCandidates = group.filter((other) => other !== candidate).map((other) => other.id);
    }
  }
}

export function buildInventory(options = {}) {
  const resolvedOptions = {
    baseUrl: options.baseUrl,
    authVerified: Boolean(options.authVerified)
  };
  const caseMap = new Map();
  const sourceCounts = {};
  for (const source of YAML_CASE_SOURCES) sourceCounts[source] = collectYamlCases(caseMap, source);
  sourceCounts[YAML_JOURNEY_SOURCE] = collectYamlJourneys(caseMap);
  for (const source of NARRATIVE_CASE_SOURCES) sourceCounts[source] = collectNarrativeCases(caseMap, source);
  const flows = collectStrictFlowCases(caseMap);
  const testFiles = collectTestFiles();
  const cases = [...caseMap.values()].sort((left, right) => left.id.localeCompare(right.id));

  for (const candidate of cases) candidate.implementation = implementationFor(candidate, testFiles);
  for (const candidate of cases) candidate.automation = classifyAutomation(candidate, resolvedOptions);
  addDuplicateCandidates(cases);

  const exactTitleDuplicateGroups = new Set(
    cases
      .filter((candidate) => candidate.duplicateTitleCandidates.length > 0)
      .map((candidate) => [candidate.id, ...candidate.duplicateTitleCandidates].sort().join('|'))
  ).size;
  const statusCounts = countBy(cases, (candidate) => candidate.automation.status);
  const implementationCounts = countBy(cases, (candidate) => candidate.implementation.status);
  const explicitSourceRows = Object.entries(sourceCounts)
    .filter(([source]) => source !== YAML_JOURNEY_SOURCE)
    .reduce((total, [, count]) => total + count, 0);

  return sanitizeInventoryValues({
    schemaVersion: 1,
    scope: {
      definition:
        'Every explicit atomic case row in the four YAML case catalogs and two Markdown case tables, plus formal flow data/negative cases that are not already linked by sourceCaseId. Composite journeys are retained but not counted as additional atomic coverage.',
      handling:
        'Internal QA material derived from NUP project sources. Keep within authorized project access; do not publish externally.',
      explicitSourceRows,
      normalizedCaseCount: cases.filter((candidate) => candidate.kind !== 'composite-journey').length,
      compositeJourneyCount: cases.filter((candidate) => candidate.kind === 'composite-journey').length,
      strictFlowCount: flows.length,
      formalDataCaseCount: flows.reduce((total, flow) => total + flow.dataCaseCount, 0),
      formalNegativeCaseCount: flows.reduce((total, flow) => total + flow.negativeCaseCount, 0),
      acceptanceCriteriaCount: flows.reduce(
        (total, flow) => total + flow.acceptanceCriteria.length,
        0
      ),
      exactTitleDuplicateGroups,
      sourceCounts
    },
    assessmentEvidence: {
      baseUrl: resolvedOptions.baseUrl ?? null,
      authenticatedPageLoadVerified: resolvedOptions.authVerified,
      limitation:
        'Page-load access does not prove role, API authorization, disposable ownership, mutation-policy eligibility, cleanup, or downstream access.'
    },
    statusCounts,
    implementationCounts,
    preconditionBundles: Object.fromEntries(
      Object.entries(PRECONDITION_BUNDLES).map(([code, bundle]) => [
        code,
        {
          ...bundle,
          availability:
            code === 'BASE_URL'
              ? resolvedOptions.baseUrl
                ? 'available-this-assessment'
                : 'not-recorded'
              : code === 'UI_AUTH'
                ? resolvedOptions.authVerified
                  ? 'available-this-assessment'
                  : 'not-recorded'
                : bundle.availability
        }
      ])
    ),
    missingFlowSpecs: missingHeaderSpecs(testFiles),
    flows,
    cases
  });
}

function sanitizeInventoryValues(value) {
  if (Array.isArray(value)) return value.map(sanitizeInventoryValues);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, sanitizeInventoryValues(child)])
    );
  }
  return typeof value === 'string' ? sanitizeGenerationContext(value) : value;
}

function countBy(values, selector) {
  return Object.fromEntries(
    [...values.reduce((map, value) => {
      const key = selector(value);
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map())].sort(([left], [right]) => left.localeCompare(right))
  );
}

function markdownCell(value, maximum = 160) {
  const normalized = String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > maximum ? `${normalized.slice(0, maximum - 1)}…` : normalized;
}

function sourceLink(reference) {
  const relativeFromDocs = path.relative(path.join(WEB_ROOT, 'docs', 'ai-testing'), absolute(reference.path));
  return `[${reference.path}:${reference.line}](${relativeFromDocs}#L${reference.line})`;
}

function renderInventoryMarkdown(inventory) {
  const generationStatusConflicts = inventory.flows
    .filter(
      (flow) =>
        flow.generationStatus === 'pending-generation' &&
        flow.targetTestFile &&
        fs.existsSync(absolute(flow.targetTestFile))
    )
    .map((flow) => flow.flowId);
  const pipelineConflictRows = [];
  if (generationStatusConflicts.length > 0) {
    pipelineConflictRows.push(
      `- Specs marked \`pending-generation\` despite an existing target test: ${generationStatusConflicts
        .map((value) => `\`${value}\``)
        .join(', ')}.`
    );
  }
  if (inventory.missingFlowSpecs.length > 0) {
    pipelineConflictRows.push(
      `- Test headers refer to missing strict specs: ${inventory.missingFlowSpecs
        .map((value) => `\`${value}\``)
        .join(', ')}.`
    );
  }
  if (pipelineConflictRows.length === 0) {
    pipelineConflictRows.push(
      '- No target-test generation-status conflicts or missing header-linked strict specs were detected.'
    );
  }
  const caseRows = inventory.cases.map((candidate) => {
    const declared = [candidate.declaredType, candidate.priority].filter(Boolean).join(' / ');
    const source = candidate.sourceReferences.map(sourceLink).join('<br>');
    const duplicates = candidate.duplicateTitleCandidates.join(', ');
    return `| ${markdownCell(candidate.id, 55)} | ${markdownCell(candidate.title, 150)} | ${markdownCell(declared, 50)} | ${markdownCell(candidate.implementation.status, 45)} | ${markdownCell(candidate.automation.status, 48)} | ${markdownCell(candidate.automation.missingCodes.join(', '), 120)} | ${markdownCell(duplicates, 100)} | ${source} |`;
  });

  return `# E2E Test Case Inventory

Generated by \`npm run ai:test:inventory -- --base-url ${inventory.assessmentEvidence.baseUrl ?? '<allowlisted-non-production-url>'} --auth-verified\`. Do not edit manually.

> Internal QA material derived from NUP project sources. Keep within authorized project access; do not publish externally.

## Scope

${inventory.scope.definition}

This is a finite inventory of explicit source cases, not every theoretical permutation. Exact-title duplicates are retained and linked; broader semantic overlaps are retained unless deterministic matching proves equivalence.

| Metric | Count |
|---|---:|
| Explicit source rows (excluding composite journeys) | ${inventory.scope.explicitSourceRows} |
| Normalized atomic cases after exact-ID merging | ${inventory.scope.normalizedCaseCount} |
| Composite journeys (not additional atomic coverage) | ${inventory.scope.compositeJourneyCount} |
| Strict flow specs | ${inventory.scope.strictFlowCount} |
| Formal data cases | ${inventory.scope.formalDataCaseCount} |
| Formal negative cases | ${inventory.scope.formalNegativeCaseCount} |
| Formal acceptance criteria | ${inventory.scope.acceptanceCriteriaCount} |
| Exact-title duplicate groups | ${inventory.scope.exactTitleDuplicateGroups} |

## Assessment evidence

- Target URL: ${inventory.assessmentEvidence.baseUrl ? `\`${inventory.assessmentEvidence.baseUrl}\`` : 'not supplied'}
- Authenticated page-load-only check: ${inventory.assessmentEvidence.authenticatedPageLoadVerified ? 'verified' : 'not verified'}
- Limitation: ${inventory.assessmentEvidence.limitation}

## Automation status totals

| Status | Cases |
|---|---:|
${Object.entries(inventory.statusCounts)
  .map(([status, count]) => `| ${status} | ${count} |`)
  .join('\n')}

Implementation status and execution readiness are intentionally separate. A present test is not called automated when its spec says pending-generation, its source is missing, deterministic validation is incomplete, or safe live prerequisites are absent.

## Known source and contract constraints

${pipelineConflictRows.join('\n')}
- \`FLOW-SKU-MAX\` conflicts on null maximum behavior and on whether an over-limit channel is added or rejected.
- \`FLOW-SKU-PARSE:DC-012\` allows two different outcomes (empty Hero set or clarification), so it has no singular oracle.
- Secondary Space source cases conflict on whether Base or Pollen is the primary configuration source.
- The save flow uses both Campaign SKU and Measurement SKU terminology, and its plan-name month contract conflicts with the QA observation.
- Exact-title and broader semantic duplicates are preserved in the catalogue instead of being guessed away.

## Full normalized list

| ID | Test case | Declared | Implementation | Automation readiness | Missing prerequisite codes | Exact-title candidates | Source |
|---|---|---|---|---|---|---|---|
${caseRows.join('\n')}

## Detailed records

The complete steps, expected results, source preconditions, formal mappings, matched test files, blocker details, and required preconditions are in \`e2e-test-case-inventory.json\`. The blocker-oriented view is in \`e2e-test-case-preconditions.md\`.
`;
}

function renderPreconditionsMarkdown(inventory) {
  const bundleRows = Object.entries(inventory.preconditionBundles).map(([code, bundle]) => {
    const cases = inventory.cases.filter((candidate) => candidate.automation.blockerCodes.includes(code));
    return `| ${code} | ${bundle.availability} | ${markdownCell(bundle.requirement, 220)} | ${cases.length} |`;
  });

  const blocked = inventory.cases.filter((candidate) => /blocked/.test(candidate.automation.status));
  const caseRows = blocked.map((candidate) => {
    const sourcePreconditions = candidate.preconditions.length
      ? candidate.preconditions.join('; ')
      : 'No case-specific precondition supplied.';
    const details = candidate.automation.blockerDetails.join('; ');
    return `| ${markdownCell(candidate.id, 55)} | ${markdownCell(candidate.automation.status, 48)} | ${markdownCell(candidate.automation.missingCodes.join(', '), 150)} | ${markdownCell(sourcePreconditions, 260)} | ${markdownCell(details, 220)} |`;
  });

  return `# E2E Automation Preconditions and Blockers

Generated by \`npm run ai:test:inventory -- --base-url ${inventory.assessmentEvidence.baseUrl ?? '<allowlisted-non-production-url>'} --auth-verified\`. Do not edit manually.

> Internal QA material derived from NUP project sources. Keep within authorized project access; do not publish externally.

## Shared prerequisite bundles

| Code | Current availability | Required precondition | Cases |
|---|---|---|---:|
${bundleRows.join('\n')}

\`available-this-assessment\` means only that the supplied dev URL and fresh browser state passed a non-mutating page-load check. It does not grant mutation or downstream authority.

## Machine-policy blocked cases

| ID | Status | Missing prerequisite codes | Case-specific source preconditions | Confirmed blocker detail |
|---|---|---|---|---|
${caseRows.join('\n')}

The JSON inventory is authoritative when a cell is truncated for readability.
`;
}

function outputsFor(inventory, outputDirectory) {
  return new Map([
    [path.join(outputDirectory, 'e2e-test-case-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`],
    [path.join(outputDirectory, 'e2e-test-case-inventory.md'), renderInventoryMarkdown(inventory)],
    [path.join(outputDirectory, 'e2e-test-case-preconditions.md'), renderPreconditionsMarkdown(inventory)]
  ]);
}

function writeOrCheck(outputs, check) {
  const stale = [];
  for (const [filePath, content] of outputs) {
    if (check) {
      if (!fs.existsSync(filePath) || fs.readFileSync(filePath, 'utf8') !== content) stale.push(filePath);
      continue;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  if (stale.length > 0) {
    throw new Error(`Generated E2E inventory is stale:\n${stale.map((file) => `- ${file}`).join('\n')}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const inventory = buildInventory(args);
  const outputs = outputsFor(inventory, args.outputDirectory);
  writeOrCheck(outputs, args.check);
  console.log(
    `${args.check ? 'Verified' : 'Generated'} ${inventory.scope.normalizedCaseCount} normalized atomic cases, ` +
      `${inventory.scope.compositeJourneyCount} composite journeys, and ${inventory.scope.formalNegativeCaseCount} formal negative cases.`
  );
  console.log(`Explicit source rows: ${inventory.scope.explicitSourceRows}; strict flows: ${inventory.scope.strictFlowCount}.`);
  for (const filePath of outputs.keys()) console.log(`- ${path.relative(WEB_ROOT, filePath)}`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
