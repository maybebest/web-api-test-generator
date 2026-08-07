import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const REQUIRED_SECTIONS = [
  'Metadata',
  'User Story',
  'Preconditions',
  'Out-of-scope',
  'Stability Requirements',
  'Variants',
  'Includes',
  'Business Rules',
  'Data Cases',
  'Data Cases as JSON',
  'Test Data',
  'Mocks',
  'Mocks as JSON',
  'Flow Steps',
  'Negative Cases',
  'Acceptance Criteria',
  'Locator Hints',
  'Generated Test Requirements',
  'Notes'
];

export const REQUIRED_METADATA_FIELDS = [
  'Flow ID',
  'Spec Version',
  'Owner',
  'Priority',
  'Test Type',
  'Auth',
  'Target Test File',
  'Base Path',
  'Tags'
];

export const STABILITY_PARALLEL_SAFE_VALUES = new Set(['yes', 'no']);
export const STABILITY_DATA_ISOLATION_VALUES = new Set(['per-test', 'shared', 'external']);

export const GENERATION_MODES = new Set(['single', 'suite']);

// Single source of truth for the generated spec header comment:
//   /* spec: specs/<flow>.md version:1.2.0 sha256:<hex> */
// check-spec-drift, spec-catalog, run-generated-ui, and the reviewer all parse
// the same shape; divergent local regexes previously accepted different headers.
export const SPEC_HEADER_PATTERN =
  /\/\*\s*spec:\s*([^\s]+)\s+version:\s*([^\s]+)\s+sha256:\s*([a-f0-9]{64})\s*\*\//i;

export function parseSpecHeader(content) {
  const match = String(content ?? '').match(SPEC_HEADER_PATTERN);
  if (!match) {
    return undefined;
  }

  return {
    specPath: match[1],
    specVersion: match[2],
    sha256: match[3].toLowerCase()
  };
}

// Reads the optional "Generation Mode" Metadata row (single | suite).
// Returns undefined when the spec does not declare one.
export function specGenerationMode(metadata) {
  const value = metadata?.['Generation Mode'];
  if (value === undefined || value === null || String(value).trim() === '') {
    return undefined;
  }

  return String(value).trim().toLowerCase();
}

// Mode resolution contract shared by review/gate/generation-task:
// an explicit --mode flag wins; a --mode flag that contradicts the spec's
// Generation Mode metadata is a hard error (prevents local-pass/CI-fail
// divergence); otherwise the spec metadata applies; otherwise 'single'.
export function resolveGenerationMode({ cliMode, specMode } = {}) {
  if (cliMode !== undefined && !GENERATION_MODES.has(cliMode)) {
    throw new Error(`Unsupported generation mode: ${cliMode}. Use "single" or "suite".`);
  }

  if (specMode !== undefined && !GENERATION_MODES.has(specMode)) {
    throw new Error(`Spec metadata "Generation Mode" must be "single" or "suite". Found: ${specMode}.`);
  }

  if (cliMode && specMode && cliMode !== specMode) {
    throw new Error(
      `--mode ${cliMode} conflicts with spec metadata Generation Mode "${specMode}". Remove the flag or update the spec so local runs and CI resolve the same mode.`
    );
  }

  return cliMode ?? specMode ?? 'single';
}

export const DEFAULT_VARIANTS_HEADER = ['Locale', 'Role', 'Plan'];

export const BEHAVIORAL_METADATA_FIELDS = [
  'Flow ID',
  'Spec Version',
  'Priority',
  'Test Type',
  'Auth',
  'Target Test File',
  'Base Path',
  'Tags'
];

export const BEHAVIORAL_SECTIONS = [
  'Stability Requirements',
  'Variants',
  'Includes',
  'Business Rules',
  'Data Cases',
  'Data Cases as JSON',
  'Test Data',
  'Mocks as JSON',
  'Flow Steps',
  'Negative Cases',
  'Acceptance Criteria',
  'Locator Hints'
];

export const TEST_TYPE_TO_DIR = {
  smoke: 'tests/smoke/',
  regression: 'tests/regression/',
  accessibility: 'tests/accessibility/',
  visual: 'tests/visual/'
};

const TABLE_HEADER_ALIASES = {
  'AC IDs': 'acIds',
  Step: 'step',
  Action: 'action',
  Target: 'target',
  Input: 'input',
  'Expected Result': 'expectedResult',
  'Assertion Hint': 'assertionHint'
};

export function readSpecFile(specPath) {
  return fs.readFileSync(path.resolve(specPath), 'utf8');
}

export function fullSpecSha256(contentOrPath) {
  const content = fs.existsSync(contentOrPath) ? readSpecFile(contentOrPath) : contentOrPath;
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function specSha256(contentOrPath) {
  const content = fs.existsSync(contentOrPath) ? readSpecFile(contentOrPath) : contentOrPath;
  return crypto.createHash('sha256').update(behavioralSpecContent(content)).digest('hex');
}

export function behavioralSpecContent(content) {
  const parsed = parseFlowSpec(content);
  const lines = [];

  lines.push(`# Flow: ${parsed.title}`);
  lines.push('## Metadata');
  for (const field of BEHAVIORAL_METADATA_FIELDS) {
    lines.push(`${field}: ${parsed.metadata[field] ?? ''}`);
  }

  for (const section of BEHAVIORAL_SECTIONS) {
    lines.push(`## ${section}`);
    lines.push((parsed.sections[section] ?? '').trim());
  }

  return lines.join('\n').replace(/\r\n/g, '\n').trim() + '\n';
}

export function loadAiConfig(configPath = 'ai/config.json') {
  const defaults = {
    variantAxes: DEFAULT_VARIANTS_HEADER
  };

  const absolute = path.resolve(configPath);
  if (!fs.existsSync(absolute)) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(absolute, 'utf8'));
    const variantAxes = Array.isArray(parsed.variantAxes)
      ? parsed.variantAxes.map((axis) => String(axis).trim()).filter(Boolean)
      : defaults.variantAxes;

    return {
      ...defaults,
      ...parsed,
      variantAxes: variantAxes.length > 0 ? variantAxes : defaults.variantAxes
    };
  } catch {
    return defaults;
  }
}

export function parseFlowSpec(content) {
  const title = content.match(/^#\s+Flow:\s*(.+?)\s*$/m)?.[1]?.trim() ?? '';
  const sections = extractSections(content);
  const metadata = parseMetadataTable(sections.Metadata ?? '');
  const acceptanceCriteria = parseAcceptanceCriteria(sections['Acceptance Criteria'] ?? '');
  const flowSteps = parseFlowSteps(sections['Flow Steps'] ?? '');
  const locatorHints = parseLocatorHints(sections['Locator Hints'] ?? '');
  const mocksJson = parseMocksJson(sections['Mocks as JSON'] ?? '');
  const stability = parseStability(sections['Stability Requirements'] ?? '');
  const variants = parseVariants(sections.Variants ?? '');
  const includes = parseIncludes(sections.Includes ?? '');
  const businessRules = parseBusinessRules(sections['Business Rules'] ?? '');
  const dataCases = parseDataCases(sections['Data Cases'] ?? '');
  const dataCasesJson = parseDataCasesJson(sections['Data Cases as JSON'] ?? '');
  const negativeCases = parseNegativeCases(sections['Negative Cases'] ?? '');

  return {
    title,
    sections,
    metadata,
    acceptanceCriteria,
    flowSteps,
    locatorHints,
    mocksJson,
    stability,
    variants,
    includes,
    businessRules,
    dataCases,
    dataCasesJson,
    negativeCases
  };
}

export function extractSections(content) {
  const sections = {};
  const headingPattern = /^##\s+(.+?)\s*$/gm;
  const headings = [...content.matchAll(headingPattern)];

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const name = heading[1].trim();
    const start = heading.index + heading[0].length;
    const end = headings[index + 1]?.index ?? content.length;
    sections[name] = content.slice(start, end).trim();
  }

  return sections;
}

// Returns section heading names that appear more than once. A duplicate
// heading (especially Metadata) lets a later section silently overwrite an
// earlier contract value. Validation treats duplicates as an error.
export function findDuplicateSectionHeadings(content) {
  const counts = new Map();
  for (const heading of content.matchAll(/^##\s+(.+?)\s*$/gm)) {
    const name = heading[1].trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
}

export function parseMetadataTable(sectionContent) {
  const rows = parseMarkdownTable(sectionContent);
  const metadata = {};

  for (const row of rows) {
    const [field, value] = row;
    if (!field || !value || field.toLowerCase() === 'field') {
      continue;
    }

    metadata[field] = value;
  }

  return metadata;
}

export function findDuplicateMetadataFields(sectionContent) {
  const counts = new Map();
  for (const [field, value] of parseMarkdownTable(sectionContent)) {
    if (!field || !value || field.toLowerCase() === 'field') {
      continue;
    }
    counts.set(field, (counts.get(field) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([field]) => field);
}

export function parseMarkdownTable(sectionContent) {
  return sectionContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'))
    .map((line) => splitMarkdownTableRow(line.slice(1, -1)).map((cell) => cell.trim()))
    .filter((cells) => !cells.every((cell) => /^:?-{3,}:?$/.test(cell)));
}

function splitMarkdownTableRow(row) {
  const cells = [];
  let cell = '';
  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    if (character === '\\' && row[index + 1] === '|') {
      cell += '|';
      index += 1;
    } else if (character === '|') {
      cells.push(cell);
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell);
  return cells;
}

export function parseFlowSteps(sectionContent) {
  const rows = parseMarkdownTable(sectionContent);
  const [header, ...dataRows] = rows;

  if (!header) {
    return [];
  }

  return dataRows
    .filter((row) => row[0] && /^\d+$/.test(row[0]))
    .map((row) => {
      const step = {};
      for (let index = 0; index < header.length; index += 1) {
        const key = TABLE_HEADER_ALIASES[header[index]] ?? camelCase(header[index]);
        step[key] = row[index] ?? '';
      }

      step.acIds = parseAcIds(step.acIds ?? '');
      return step;
    });
}

export function parseAcceptanceCriteria(sectionContent) {
  return parseAcIds(sectionContent);
}

export function parseAcIds(value) {
  const ids = [...String(value).matchAll(/\bAC-\d{3}\b/g)].map((match) => match[0]);
  return [...new Set(ids)];
}

export function parseLocatorHints(sectionContent) {
  return sectionContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
}

export function parseStability(sectionContent) {
  const rows = parseMarkdownTable(sectionContent);
  const result = { parallelSafe: undefined, dataIsolation: undefined, allowedRetries: undefined };

  for (const row of rows) {
    const [field, value] = row;
    if (!field || !value || field.toLowerCase() === 'field') {
      continue;
    }

    const normalized = field.toLowerCase();
    if (normalized === 'parallel safe') {
      result.parallelSafe = value.toLowerCase();
    } else if (normalized === 'data isolation') {
      result.dataIsolation = value.toLowerCase();
    } else if (normalized === 'allowed retries') {
      result.allowedRetries = value;
    }
  }

  return result;
}

export function parseVariants(sectionContent) {
  const rows = parseMarkdownTable(sectionContent);
  const [header, ...dataRows] = rows;

  if (!header) {
    return { header: [], rows: [] };
  }

  return {
    header,
    rows: dataRows
      .filter((row) => row.some((cell) => cell.length > 0))
      .map((row) => Object.fromEntries(header.map((column, index) => [column, row[index] ?? ''])))
  };
}

export function parseBusinessRules(sectionContent) {
  if (isNoneSection(sectionContent)) {
    return { none: true, header: [], rows: [] };
  }

  return parseGenericTable(sectionContent);
}

export function parseDataCases(sectionContent) {
  if (isNoneSection(sectionContent)) {
    return { none: true, header: [], rows: [] };
  }

  return parseGenericTable(sectionContent);
}

export function parseDataCasesJson(sectionContent) {
  return parseJsonBlock(sectionContent, 'Data Cases as JSON');
}

export function parseGenericTable(sectionContent) {
  const rows = parseMarkdownTable(sectionContent);
  const [header, ...dataRows] = rows;

  if (!header) {
    return { none: false, header: [], rows: [] };
  }

  return {
    none: false,
    header,
    rows: dataRows
      .filter((row) => row.some((cell) => cell.length > 0))
      .map((row) => Object.fromEntries(header.map((column, index) => [column, row[index] ?? ''])))
  };
}

export function isNoneSection(sectionContent) {
  return sectionContent
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, '').toLowerCase())
    .filter(Boolean)
    .every((line) => line === 'none');
}

export function parseIncludes(sectionContent) {
  return sectionContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
}

export function parseNegativeCases(sectionContent) {
  const rows = parseMarkdownTable(sectionContent);
  const [header, ...dataRows] = rows;

  if (!header) {
    return [];
  }

  return dataRows
    .filter((row) => row[0] && /^NEG-\d{3}$/i.test(row[0]))
    .map((row) => ({
      caseId: row[0].toUpperCase(),
      scenario: row[1] ?? '',
      expectedResult: row[2] ?? ''
    }));
}

export function parseMocksJson(sectionContent) {
  return parseJsonBlock(sectionContent, 'Mocks as JSON');
}

export function parseJsonBlock(sectionContent, label) {
  const jsonBlock = sectionContent.match(/```json\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (!jsonBlock) {
    return {
      value: undefined,
      error: `${label} must contain a fenced json block.`
    };
  }

  try {
    return {
      value: JSON.parse(jsonBlock),
      error: undefined
    };
  } catch (error) {
    return {
      value: undefined,
      error: `${label} is not valid JSON: ${error.message}`
    };
  }
}

export function listSpecFiles(specDir) {
  // Recursive: specs may be organised into subdirectories (e.g.
  // specs/special-preconditions/). Only strict documents with a top-level
  // "# Flow:" heading belong to this pipeline. The specs tree also contains
  // narrative knowledge/QA documents and raw YAML catalogues; treating every
  // Markdown file as a strict Flow makes validation fail on legitimate source
  // material and still misses the YAML. Returned paths stay relative to
  // specDir's parent, matching the shape callers expect.
  const root = path.resolve(specDir);
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.name.endsWith('.md') && entry.name !== '_template.md' && entry.name !== 'README.md') {
        const content = fs.readFileSync(absolute, 'utf8');
        if (/^#\s+Flow:\s*.+$/m.test(content)) {
          found.push(path.join(specDir, path.relative(root, absolute)));
        }
      }
    }
  };
  walk(root);
  return found.sort();
}

export function isPlaceholderOnly(sectionContent) {
  const significantLines = sectionContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^```/.test(line))
    .filter((line) => !/^\|[-:\s|]+\|?$/.test(line))
    .map((line) =>
      line
        .replace(/^[-*]\s*/, '')
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .replace(/\|/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)
    .filter((line) => !/^(field value|name value notes|api\/route scenario response|step ac ids action target input expected result assertion hint|step action target input expected result assertion hint|case id scenario expected result|case id inputs expected result notes|rule id rule formula blocking behavior|locale role plan)$/i.test(line));

  return significantLines.length === 0 || significantLines.every(isPlaceholderValue);
}

export function isPlaceholderValue(value) {
  const normalized = value
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim()
    .toLowerCase();

  return (
    normalized === '' ||
    normalized === 'todo' ||
    normalized === 'tbd' ||
    normalized === 'placeholder' ||
    normalized === 'to be defined' ||
    normalized === 'n/a' ||
    normalized === '...' ||
    /^<[^>]+>$/.test(normalized)
  );
}

function camelCase(value) {
  return value
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, character) => character.toUpperCase())
    .replace(/^[A-Z]/, (character) => character.toLowerCase());
}
