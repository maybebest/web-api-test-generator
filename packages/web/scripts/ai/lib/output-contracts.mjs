import { PLAYWRIGHT_GENERATION_POLICY } from './generation-policy.mjs';
import { loadAiConfig } from './spec-parser.mjs';

// Task-specific provider output contracts. Each contract owns the schema sent
// to REST providers and the deterministic conversion back to the text shape
// expected by existing callers.

export const OUTPUT_KINDS = Object.freeze({
  playwright: 'playwright-typescript',
  flowSpecDraft: 'flow-spec-draft'
});

export const REST_OUTPUT_CONTRACT = `${PLAYWRIGHT_GENERATION_POLICY}

Output contract (mandatory):
- Respond with EXACTLY ONE fenced \`\`\`ts code block containing the COMPLETE contents of the test file.
- No commentary before or after the code block. No other fenced code blocks of any kind.
- No commentary before or after the code block. No other fenced code blocks of any kind.`;

export const CODE_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    code: { type: 'string', description: 'Complete contents of one Playwright TypeScript test file.' }
  },
  required: ['code'],
  additionalProperties: false
});

export const STRUCTURED_REST_OUTPUT_CONTRACT = `${PLAYWRIGHT_GENERATION_POLICY}

The response is constrained by a JSON schema. Put the complete file contents in the code field and nothing else. Do not put Markdown fences or commentary in the code field.`;

export const FLOW_SPEC_DRAFT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    flowTitle: { type: 'string' },
    metadataRows: { type: 'array', items: fieldValueSchema() },
    userStory: { type: 'object', properties: { asA: { type: 'string' }, iWantTo: { type: 'string' }, soThat: { type: 'string' } }, required: ['asA', 'iWantTo', 'soThat'], additionalProperties: false },
    preconditions: stringArraySchema(),
    outOfScope: stringArraySchema(),
    stabilityRows: { type: 'array', items: fieldValueSchema() },
    variants: { type: 'object', properties: { columns: stringArraySchema(), rows: { type: 'array', items: { type: 'object', properties: { values: stringArraySchema() }, required: ['values'], additionalProperties: false } } }, required: ['columns', 'rows'], additionalProperties: false },
    includes: stringArraySchema(),
    businessRules: { type: 'array', items: { type: 'object', properties: { ruleId: { type: 'string' }, rule: { type: 'string' }, formula: { type: 'string' }, blockingBehavior: { type: 'string' } }, required: ['ruleId', 'rule', 'formula', 'blockingBehavior'], additionalProperties: false } },
    dataCases: { type: 'array', items: { type: 'object', properties: { caseId: { type: 'string' }, inputs: { type: 'array', items: namedValueSchema() }, expected: { type: 'array', items: namedValueSchema() }, notes: { type: 'string' } }, required: ['caseId', 'inputs', 'expected', 'notes'], additionalProperties: false } },
    testData: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' }, notes: { type: 'string' } }, required: ['name', 'value', 'notes'], additionalProperties: false } },
    mocks: { type: 'array', items: { type: 'object', properties: { method: { type: 'string' }, url: { type: 'string' }, scenario: { type: 'string' }, status: { type: 'integer' }, bodyJson: { type: 'string' } }, required: ['method', 'url', 'scenario', 'status', 'bodyJson'], additionalProperties: false } },
    flowSteps: { type: 'array', items: { type: 'object', properties: { step: { type: 'string' }, acIds: stringArraySchema(), action: { type: 'string' }, target: { type: 'string' }, input: { type: 'string' }, expectedResult: { type: 'string' }, assertionHint: { type: 'string' } }, required: ['step', 'acIds', 'action', 'target', 'input', 'expectedResult', 'assertionHint'], additionalProperties: false } },
    negativeCases: { type: 'array', items: { type: 'object', properties: { caseId: { type: 'string' }, scenario: { type: 'string' }, expectedResult: { type: 'string' } }, required: ['caseId', 'scenario', 'expectedResult'], additionalProperties: false } },
    acceptanceCriteria: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'], additionalProperties: false } },
    notes: stringArraySchema()
  },
  required: ['flowTitle', 'metadataRows', 'userStory', 'preconditions', 'outOfScope', 'stabilityRows', 'variants', 'includes', 'businessRules', 'dataCases', 'testData', 'mocks', 'flowSteps', 'negativeCases', 'acceptanceCriteria', 'notes'],
  additionalProperties: false
});

const FLOW_STRUCTURED_SUFFIX = `Return only the flow-spec-draft/v2 semantic JSON object required by the response schema.

- Do not write Markdown, section bodies, or fenced JSON strings.
- dataCases is the only source of data-case values; its named inputs and expected arrays are rendered into both local projections.
- Preserve only supported facts and use NEEDS_REVIEW for unknown values.
- Do not put commentary, credentials, tokens, cookies, or secrets in any field.`;

function namedValueSchema() {
  return {
    type: 'object',
    properties: { name: { type: 'string' }, value: { type: 'string' } },
    required: ['name', 'value'],
    additionalProperties: false
  };
}

function fieldValueSchema() {
  return {
    type: 'object',
    properties: { field: { type: 'string' }, value: { type: 'string' } },
    required: ['field', 'value'],
    additionalProperties: false
  };
}

function stringArraySchema() {
  return { type: 'array', items: { type: 'string' } };
}

function objectWithExactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function requiredText(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new Error(`${label} must be ${allowEmpty ? 'a string' : 'a non-empty string'}.`);
  }
  return value.trim();
}

function escapeTableCell(value) {
  return safeText(value).replace(/\r\n|\r|\n/g, '<br>').replace(/\|/g, '\\|');
}

const FLOW_DRAFT_KEYS = [
  'flowTitle', 'metadataRows', 'userStory', 'preconditions', 'outOfScope',
  'stabilityRows', 'variants', 'includes', 'businessRules', 'dataCases',
  'testData', 'mocks', 'flowSteps', 'negativeCases', 'acceptanceCriteria', 'notes'
];
const METADATA_DEFAULTS = ['Flow ID', 'Spec Version', 'Owner', 'Priority', 'Test Type', 'Auth', 'Target Test File', 'Base Path', 'Tags', 'Generation Mode', 'Generation Source', 'Generation Status'];
const METADATA_FALLBACKS = Object.freeze({
  'Generation Mode': 'single',
  'Generation Source': 'ai-template-fit',
  'Generation Status': 'pending-generation'
});
const STABILITY_DEFAULTS = ['Parallel Safe', 'Data Isolation', 'Allowed Retries'];
const STABILITY_FALLBACKS = Object.freeze({ 'Allowed Retries': '0' });
export const DEFAULT_LOCATOR_HINTS = Object.freeze([
  'Prefer Page Object or Component Object locators using `this.page.getByTestId(...)` when a meaningful `data-testid` exists and is stable.',
  'Prefer role/name locators when no stable `data-testid` exists.',
  'Prefer labels for form fields.',
  'Use placeholder locators only when no label exists.',
  'Use visible text locators only for stable visible copy.'
]);
export const DEFAULT_GENERATED_TEST_REQUIREMENTS = Object.freeze([
  'Must import from fixtures/test.',
  'Must use test.step.',
  'Must use Page Objects or Component Objects for all locators.',
  'Must not create direct `page.getBy*` or `page.locator(...)` locators in the generated test body.',
  'Default generation mode is single-test mode; the optional `Generation Mode` metadata row overrides it.',
  'Generate a suite only when the spec declares `Generation Mode | suite` or a suite is explicitly requested.',
  'In single-test mode, must generate exactly one primary requested-scenario test with one primary final assertion step, plus optionally one test per spec `NEG-###` case.',
  'The single-mode primary test must declare a `covered-ac-ids` annotation (`test.info().annotations.push({ type: \'covered-ac-ids\', description: \'AC-### ...\' })`) whose set equals the AC ids named in its step titles.',
  'In the single-mode primary test, every `test.step` title must carry at least one `AC-###` token.',
  'Must declare the spec metadata `Tags` exactly via the Playwright `{ tag: [...] }` option.',
  'In suite mode, must split broad flows into focused tests that verify one functionality or business outcome.',
  'Must put `expect(...)` only in the final assertion step for each test.',
  'Must title assertion steps `Assert AC-###: ...` or `Assert NEG-###: ...`.',
  'Must include meaningful expect assertions for user-visible behavior.',
  'In suite mode, must cover every AC ID from this spec with a final assertion step; NEG coverage is required in suite mode and a non-blocking warning in single mode.',
  'Default generated-test execution target is Chromium only.',
  'Cross-browser generated-test execution is opt-in.',
  'Must not use page.waitForTimeout.',
  'Must not use XPath.',
  'Must not use test.only.',
  'Must not silently skip: `test.skip`, `test.fixme`, and `test.fail` are forbidden in all forms, including runtime calls inside test bodies.',
  'Must not use real credentials.',
  'Must not commit auth state.'
]);

function safeText(value) {
  return String(value ?? 'NEEDS_REVIEW').trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/`/g, '&#96;').replace(/\r\n|\r|\n/g, '<br>') || 'NEEDS_REVIEW';
}

function strictArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function strictObject(value, label, keys) {
  if (!objectWithExactKeys(value, keys)) throw new Error(`${label} must contain only ${keys.join(', ')}.`);
  return value;
}

function text(value, label) {
  return requiredText(value, label, { allowEmpty: true }) || 'NEEDS_REVIEW';
}

function namedRows(value, label, key = 'field') {
  return strictArray(value, label).map((row, index) => {
    strictObject(row, `${label}[${index}]`, [key, 'value']);
    return { [key]: text(row[key], `${label}[${index}].${key}`), value: text(row.value, `${label}[${index}].value`) };
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  return value;
}

function json(value) {
  return JSON.stringify(canonicalJson(value), null, 2);
}

function valuesObject(entries, label) {
  const result = {};
  for (const entry of namedRows(entries, label, 'name')) {
    if (Object.hasOwn(result, entry.name)) throw new Error(`${label} contains duplicate name ${entry.name}.`);
    result[entry.name] = entry.value;
  }
  return result;
}

function defaultRows(rows, fields) {
  const known = new Map(rows.map((row) => [row.field, row.value]));
  return [...fields.map((field) => ({ field, value: known.get(field) ?? METADATA_FALLBACKS[field] ?? 'NEEDS_REVIEW' })), ...rows.filter((row) => !fields.includes(row.field)).sort((a, b) => codePointCompare(a.field, b.field))];
}

function defaultStabilityRows(rows) {
  const known = new Map(rows.map((row) => [row.field, row.value]));
  return STABILITY_DEFAULTS.map((field) => ({ field, value: known.get(field) ?? STABILITY_FALLBACKS[field] ?? 'NEEDS_REVIEW' }));
}

function codePointCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalMetadataRows(rows) {
  const providerRows = new Map();
  let declaredGenerationMode = null;
  for (const row of rows) {
    const normalizedField = row.field.trim().toLowerCase();
    if (normalizedField === 'review status' || normalizedField === 'review sign-off') continue;
    const canonicalField = METADATA_DEFAULTS.find((field) => field.toLowerCase() === normalizedField) ?? row.field;
    // The renderer owns every reserved metadata field.  Treating aliases
    // case-insensitively prevents a provider from preserving a conflicting
    // duplicate such as "generation source" next to the canonical row.
    if (canonicalField === 'Generation Mode') {
      const candidate = String(row.value ?? '').trim().toLowerCase();
      if (declaredGenerationMode === null && (candidate === 'single' || candidate === 'suite')) {
        declaredGenerationMode = candidate;
      }
      continue;
    }
    providerRows.set(canonicalField, row.value);
  }
  providerRows.set('Generation Mode', declaredGenerationMode ?? 'single');
  providerRows.set('Generation Source', 'ai-template-fit');
  providerRows.set('Generation Status', 'pending-generation');
  return defaultRows([...providerRows.entries()].map(([field, value]) => ({ field, value })), METADATA_DEFAULTS);
}

function table(lines, header, rows) {
  lines.push(`| ${header.map(escapeTableCell).join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`);
  for (const row of rows) lines.push(`| ${row.map(escapeTableCell).join(' | ')} |`);
}

function bullets(lines, values) {
  for (const value of values.length ? values : ['NEEDS_REVIEW']) lines.push(`- ${safeText(value)}`);
}

function literalBullets(lines, values) {
  for (const value of values) lines.push(`- ${value}`);
}

function validateFlowDraft(draft) {
  strictObject(draft, 'Flow-spec semantic output', FLOW_DRAFT_KEYS);
  return {
    flowTitle: text(draft.flowTitle, 'flowTitle').replace(/^#?\s*Flow:\s*/i, '') || 'NEEDS_REVIEW',
    metadataRows: namedRows(draft.metadataRows, 'metadataRows'),
    userStory: strictObject(draft.userStory, 'userStory', ['asA', 'iWantTo', 'soThat']),
    preconditions: strictArray(draft.preconditions, 'preconditions').map((item, index) => text(item, `preconditions[${index}]`)),
    outOfScope: strictArray(draft.outOfScope, 'outOfScope').map((item, index) => text(item, `outOfScope[${index}]`)),
    stabilityRows: namedRows(draft.stabilityRows, 'stabilityRows'),
    variants: strictObject(draft.variants, 'variants', ['columns', 'rows']),
    includes: strictArray(draft.includes, 'includes').map((item, index) => text(item, `includes[${index}]`)),
    businessRules: strictArray(draft.businessRules, 'businessRules'),
    dataCases: strictArray(draft.dataCases, 'dataCases'),
    testData: strictArray(draft.testData, 'testData'),
    mocks: strictArray(draft.mocks, 'mocks'),
    flowSteps: strictArray(draft.flowSteps, 'flowSteps'),
    negativeCases: strictArray(draft.negativeCases, 'negativeCases'),
    acceptanceCriteria: strictArray(draft.acceptanceCriteria, 'acceptanceCriteria'),
    notes: strictArray(draft.notes, 'notes').map((item, index) => text(item, `notes[${index}]`))
  };
}

export function renderFlowSpecDraft(draft) {
  const data = validateFlowDraft(draft);
  const lines = [`# Flow: ${safeText(data.flowTitle)}`, '', '## Metadata', ''];
  table(lines, ['Field', 'Value'], canonicalMetadataRows(data.metadataRows).map((row) => [row.field, row.value]));
  lines.push('', '## User Story', '', `As a ${safeText(data.userStory.asA)},`, `I want to ${safeText(data.userStory.iWantTo)},`, `So that ${safeText(data.userStory.soThat)}.`, '', '## Preconditions', '');
  bullets(lines, data.preconditions);
  lines.push('', '## Out-of-scope', ''); bullets(lines, data.outOfScope);
  lines.push('', '## Stability Requirements', ''); table(lines, ['Field', 'Value'], defaultStabilityRows(data.stabilityRows).map((row) => [row.field, row.value]));
  const declaredColumns = strictArray(data.variants.columns, 'variants.columns').map((column, index) => text(column, `variants.columns[${index}]`));
  const columns = declaredColumns.length ? declaredColumns : loadAiConfig().variantAxes;
  const variants = strictArray(data.variants.rows, 'variants.rows').map((row, index) => { strictObject(row, `variants.rows[${index}]`, ['values']); const values = strictArray(row.values, `variants.rows[${index}].values`).map((value, column) => text(value, `variants.rows[${index}].values[${column}]`)); return columns.map((_, column) => values[column] ?? 'NEEDS_REVIEW'); });
  lines.push('', '## Variants', ''); table(lines, columns, variants.length ? variants : [columns.map(() => 'NEEDS_REVIEW')]);
  lines.push('', '## Includes', ''); bullets(lines, data.includes.length ? data.includes : ['none']);
  const rules = data.businessRules.map((row, index) => { strictObject(row, `businessRules[${index}]`, ['ruleId', 'rule', 'formula', 'blockingBehavior']); return [text(row.ruleId, `businessRules[${index}].ruleId`), text(row.rule, `businessRules[${index}].rule`), text(row.formula, `businessRules[${index}].formula`), text(row.blockingBehavior, `businessRules[${index}].blockingBehavior`)]; });
  lines.push('', '## Business Rules', ''); table(lines, ['Rule ID', 'Rule', 'Formula', 'Blocking Behavior'], rules.length ? rules : [['RULE-001', 'NEEDS_REVIEW', 'NEEDS_REVIEW', 'NEEDS_REVIEW']]);
  const cases = data.dataCases.map((row, index) => { strictObject(row, `dataCases[${index}]`, ['caseId', 'inputs', 'expected', 'notes']); return { caseId: text(row.caseId, `dataCases[${index}].caseId`), inputs: valuesObject(row.inputs, `dataCases[${index}].inputs`), expected: valuesObject(row.expected, `dataCases[${index}].expected`), notes: text(row.notes, `dataCases[${index}].notes`) }; });
  const renderedCases = cases.length ? cases : [{ caseId: 'DC-001', inputs: { NEEDS_REVIEW: 'NEEDS_REVIEW' }, expected: { NEEDS_REVIEW: 'NEEDS_REVIEW' }, notes: 'NEEDS_REVIEW' }];
  lines.push('', '## Data Cases', ''); table(lines, ['Case ID', 'Inputs', 'Expected Result', 'Notes'], renderedCases.map((row) => [row.caseId, JSON.stringify(canonicalJson(row.inputs)), JSON.stringify(canonicalJson(row.expected)), row.notes]));
  lines.push('', '## Data Cases as JSON', '', '```json', json(renderedCases), '```');
  const testData = data.testData.map((row, index) => { strictObject(row, `testData[${index}]`, ['name', 'value', 'notes']); return [text(row.name, `testData[${index}].name`), text(row.value, `testData[${index}].value`), text(row.notes, `testData[${index}].notes`)]; });
  lines.push('', '## Test Data', ''); table(lines, ['Name', 'Value', 'Notes'], testData.length ? testData : [['NEEDS_REVIEW', 'NEEDS_REVIEW', 'NEEDS_REVIEW']]);
  const mocks = data.mocks.map((row, index) => { strictObject(row, `mocks[${index}]`, ['method', 'url', 'scenario', 'status', 'bodyJson']); if (!Number.isInteger(row.status)) throw new Error(`mocks[${index}].status must be an integer.`); let body; try { body = JSON.parse(text(row.bodyJson, `mocks[${index}].bodyJson`)); } catch { throw new Error(`mocks[${index}].bodyJson must be valid JSON.`); } return { method: text(row.method, `mocks[${index}].method`), url: text(row.url, `mocks[${index}].url`), scenario: text(row.scenario, `mocks[${index}].scenario`), status: row.status, body: canonicalJson(body) }; });
  const renderedMocks = mocks.length ? mocks : [{ method: 'GET', url: '/NEEDS_REVIEW', scenario: 'NEEDS_REVIEW', status: 200, body: {} }];
  lines.push('', '## Mocks', ''); table(lines, ['API/Route', 'Scenario', 'Response'], renderedMocks.map((row) => [`${row.method} ${row.url}`, row.scenario, JSON.stringify(row.body)]));
  lines.push('', '## Mocks as JSON', '', '```json', json(renderedMocks.map(({ scenario, ...mock }) => mock)), '```');
  const steps = data.flowSteps.map((row, index) => { strictObject(row, `flowSteps[${index}]`, ['step', 'acIds', 'action', 'target', 'input', 'expectedResult', 'assertionHint']); return [text(row.step, `flowSteps[${index}].step`), strictArray(row.acIds, `flowSteps[${index}].acIds`).map((id, idIndex) => text(id, `flowSteps[${index}].acIds[${idIndex}]`)).join(', '), text(row.action, `flowSteps[${index}].action`), text(row.target, `flowSteps[${index}].target`), text(row.input, `flowSteps[${index}].input`), text(row.expectedResult, `flowSteps[${index}].expectedResult`), text(row.assertionHint, `flowSteps[${index}].assertionHint`)]; });
  lines.push('', '## Flow Steps', ''); table(lines, ['Step', 'AC IDs', 'Action', 'Target', 'Input', 'Expected Result', 'Assertion Hint'], steps.length ? steps : [
    ['1', 'AC-001', 'NEEDS_REVIEW', 'NEEDS_REVIEW', 'NEEDS_REVIEW', 'NEEDS_REVIEW', 'NEEDS_REVIEW'],
    ['2', 'AC-002', 'NEEDS_REVIEW', 'NEEDS_REVIEW', 'NEEDS_REVIEW', 'NEEDS_REVIEW', 'NEEDS_REVIEW'],
    ['3', 'AC-002', 'NEEDS_REVIEW', 'NEEDS_REVIEW', 'NEEDS_REVIEW', 'NEEDS_REVIEW', 'NEEDS_REVIEW']
  ]);
  const negatives = data.negativeCases.map((row, index) => { strictObject(row, `negativeCases[${index}]`, ['caseId', 'scenario', 'expectedResult']); return [text(row.caseId, `negativeCases[${index}].caseId`), text(row.scenario, `negativeCases[${index}].scenario`), text(row.expectedResult, `negativeCases[${index}].expectedResult`)]; });
  lines.push('', '## Negative Cases', ''); table(lines, ['Case ID', 'Scenario', 'Expected Result'], negatives.length ? negatives : [['NEG-001', 'NEEDS_REVIEW', 'NEEDS_REVIEW']]);
  lines.push('', '## Acceptance Criteria', '');
  const acceptance = data.acceptanceCriteria.map((row, index) => { strictObject(row, `acceptanceCriteria[${index}]`, ['id', 'text']); return `- ${safeText(text(row.id, `acceptanceCriteria[${index}].id`))}: ${safeText(text(row.text, `acceptanceCriteria[${index}].text`))}`; });
  lines.push(...(acceptance.length ? acceptance : ['- AC-001: NEEDS_REVIEW', '- AC-002: NEEDS_REVIEW']));
  lines.push('', '## Locator Hints', ''); literalBullets(lines, DEFAULT_LOCATOR_HINTS);
  lines.push('', '## Generated Test Requirements', ''); literalBullets(lines, DEFAULT_GENERATED_TEST_REQUIREMENTS);
  lines.push('', '## Notes', ''); bullets(lines, data.notes);
  return `${lines.join('\n').trim()}\n`;
}

function parseStructuredJson(raw, contract) {
  try {
    return JSON.parse(String(raw ?? ''));
  } catch (error) {
    throw new Error(`${contract.label} structured output was not valid JSON: ${error.message}`);
  }
}

const PLAYWRIGHT_CONTRACT = Object.freeze({
  kind: OUTPUT_KINDS.playwright,
  id: 'playwright-typescript/v1',
  label: 'Playwright TypeScript',
  schemaName: 'playwright_test_file',
  schema: CODE_OUTPUT_SCHEMA,
  unstructuredSystemPrompt(systemPrompt) {
    if (systemPrompt === REST_OUTPUT_CONTRACT) return systemPrompt;
    return `${systemPrompt}\n\nRespond with exactly one fenced \`\`\`ts block containing the complete file and no commentary.`;
  },
  structuredSystemPrompt(systemPrompt) {
    if (systemPrompt === REST_OUTPUT_CONTRACT) {
      return STRUCTURED_REST_OUTPUT_CONTRACT;
    }
    return `${systemPrompt}\n\nReturn only the complete TypeScript source in the JSON schema's code field.`;
  },
  decode(value) {
    if (!objectWithExactKeys(value, ['code']) || typeof value.code !== 'string' || !value.code.trim()) {
      throw new Error('Playwright TypeScript structured output did not contain a non-empty code string.');
    }
    return `\`\`\`ts\n${value.code.trim()}\n\`\`\``;
  }
});

const FLOW_SPEC_CONTRACT = Object.freeze({
  kind: OUTPUT_KINDS.flowSpecDraft,
  id: 'flow-spec-draft/v2',
  label: 'Flow spec',
  schemaName: 'flow_spec_draft',
  schema: FLOW_SPEC_DRAFT_SCHEMA,
  unstructuredSystemPrompt(systemPrompt) {
    return `${systemPrompt}\n\n${FLOW_STRUCTURED_SUFFIX}`;
  },
  structuredSystemPrompt(systemPrompt) {
    return `${systemPrompt}\n\n${FLOW_STRUCTURED_SUFFIX}`;
  },
  decode(value) {
    return renderFlowSpecDraft(value);
  }
});

const CONTRACTS = new Map([
  [OUTPUT_KINDS.playwright, PLAYWRIGHT_CONTRACT],
  [PLAYWRIGHT_CONTRACT.id, PLAYWRIGHT_CONTRACT],
  [OUTPUT_KINDS.flowSpecDraft, FLOW_SPEC_CONTRACT],
  [FLOW_SPEC_CONTRACT.id, FLOW_SPEC_CONTRACT]
]);

/**
 * @param {string} [kind]
 */
export function getOutputContract(kind = OUTPUT_KINDS.playwright) {
  const contract = CONTRACTS.get(kind);
  if (!contract) {
    throw new Error(`Unsupported output kind ${JSON.stringify(kind)}. Expected ${[...new Set([...CONTRACTS.values()].map((item) => item.kind))].join(' or ')}.`);
  }
  return contract;
}

export function flowSpecDraftTransportChars({ prompt, systemPrompt, isCli = false } = {}) {
  const contract = getOutputContract(OUTPUT_KINDS.flowSpecDraft);
  // Structured and unstructured flow routes share the same semantic suffix.
  // CLI transport additionally joins system and user content with two newlines.
  return contract.structuredSystemPrompt(String(systemPrompt ?? '')).length + String(prompt ?? '').length + (isCli ? 2 : 0);
}

export function decodeStructuredOutput(raw, contractOrKind = OUTPUT_KINDS.playwright) {
  const contract = typeof contractOrKind === 'string' ? getOutputContract(contractOrKind) : contractOrKind;
  return contract.decode(parseStructuredJson(raw, contract));
}

export function validateContractOutput(text, contractOrKind = OUTPUT_KINDS.playwright) {
  const contract = typeof contractOrKind === 'string' ? getOutputContract(contractOrKind) : contractOrKind;
  const output = String(text ?? '').trim();
  if (!output) {
    throw new Error(`${contract.label} output was empty.`);
  }
  if (contract.kind === OUTPUT_KINDS.flowSpecDraft && !/^#\s*Flow:/i.test(output)) {
    throw new Error('Flow spec output must start with "# Flow:".');
  }
  if (contract.kind === OUTPUT_KINDS.playwright && !/```(?:ts|typescript)\s*[\s\S]+```/i.test(output)) {
    throw new Error('Playwright TypeScript output must contain one complete TypeScript code fence.');
  }
  return output.endsWith('\n') ? output : `${output}\n`;
}
