#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import { loadAiConfig } from './lib/spec-parser.mjs';

function parseArgs(args) {
  const parsed = {
    input: undefined,
    text: undefined,
    out: undefined,
    flowId: undefined,
    title: undefined,
    testType: 'regression',
    auth: 'optional',
    basePath: '/',
    force: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--input') {
      parsed.input = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--text') {
      parsed.text = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--out') {
      parsed.out = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--flow-id') {
      parsed.flowId = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--title') {
      parsed.title = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--test-type') {
      parsed.testType = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--auth') {
      parsed.auth = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--base-path') {
      parsed.basePath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--force') {
      parsed.force = true;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return parsed;
}

function readSource(args) {
  if (args.text && args.input) {
    throw new Error('Use either --input or --text, not both.');
  }

  if (args.text) {
    return args.text;
  }

  if (args.input) {
    if (!fs.existsSync(args.input)) {
      throw new Error(`Input file does not exist: ${args.input}`);
    }
    return fs.readFileSync(args.input, 'utf8');
  }

  throw new Error('Missing source. Provide --input <file> or --text "<manual scenario>".');
}

function inferTitle(text, fallback) {
  if (fallback) {
    return fallback;
  }

  const scenario = text.match(/^\s*Scenario\s*\d*\s*:\s*(.+?)\s*$/im)?.[1]?.trim();
  if (scenario) {
    return sentenceCase(scenario);
  }

  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return sentenceCase(firstLine ?? 'Imported manual flow');
}

function extractGherkin(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(given|when|then|and|but)\b/i.test(line))
    .map((line) => {
      const [, keyword, value] = line.match(/^(given|when|then|and|but)\b\s*(.*)$/i) ?? [];
      return { keyword: keyword?.toUpperCase() ?? 'STEP', value: value?.trim() ?? line };
    });
}

function extractExpectedOutcomes(text) {
  const bullets = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim());

  const thenLines = [];
  let activePhase = undefined;
  for (const line of extractGherkin(text)) {
    if (['GIVEN', 'WHEN', 'THEN'].includes(line.keyword)) {
      activePhase = line.keyword;
    }

    const isThenOutcome = line.keyword === 'THEN' || (['AND', 'BUT'].includes(line.keyword) && activePhase === 'THEN');
    if (isThenOutcome && !/^the system must:?$/i.test(line.value)) {
      thenLines.push(line.value);
    }
  }

  const combined = [...bullets, ...thenLines].filter(Boolean);
  return combined.length > 0 ? [...new Set(combined)] : ['User-visible expected result is confirmed'];
}

function inferWhenAction(text) {
  const whenLine = extractGherkin(text).find((line) => line.keyword === 'WHEN')?.value;
  return whenLine ? sentenceCase(whenLine) : 'Perform primary user action';
}

function inferBusinessRule(text) {
  const normalized = text.toLowerCase();
  if (isValidationRuleText(normalized)) {
    return {
      id: 'RULE-001',
      rule: inferRuleLabel(normalized),
      formula: 'NEEDS_REVIEW: confirm inclusive/exclusive calculation and date/timezone rules',
      blocking: 'Block progression and show a user-visible validation error when the rule is not met'
    };
  }

  return undefined;
}

function inferDataCases(text) {
  const normalized = text.toLowerCase();
  if (normalized.includes('channel') || normalized.includes('duration') || normalized.includes('minimum')) {
    return inferDurationBoundaryCases(text);
  }

  return [
    {
      caseId: 'DC-001',
      inputs: { primaryInput: 'NEEDS_REVIEW' },
      expected: { result: 'Primary expected result is visible' },
      notes: 'Imported from manual doc; replace with deterministic test data'
    }
  ];
}

function buildSpec({ text, args }) {
  validateImportOptions(args);
  const title = inferTitle(text, args.title);
  const slug = slugify(title);
  const flowId = args.flowId ?? `FLOW-${slug.toUpperCase().replace(/-/g, '-').slice(0, 40)}`;
  const testType = args.testType;
  const target = targetFor(testType, slug, args.auth);
  const outcomes = extractExpectedOutcomes(text).slice(0, 6);
  const rule = inferBusinessRule(text);
  const dataCases = inferDataCases(text);
  const whenAction = inferWhenAction(text);
  const acIds = outcomes.map((_, index) => `AC-${String(index + 2).padStart(3, '0')}`);
  const variantAxes = loadAiConfig().variantAxes;
  const variantDefaults = variantAxes.map((axis) => defaultVariantValue(axis));

  return `# Flow: ${title}

## Metadata

| Field | Value |
|---|---|
| Flow ID | ${flowId} |
| Spec Version | 0.1.0 |
| Owner | NEEDS_REVIEW |
| Priority | P2 |
| Test Type | ${testType} |
| Auth | ${args.auth} |
| Target Test File | ${target} |
| Base Path | ${args.basePath} |
| Tags | @generated @manual-import |
| Generation Mode | single |
| Review Status | ai-draft |
| Generation Source | manual-doc-import |

## User Story

As a NEEDS_REVIEW user,
I want to ${whenAction.toLowerCase()},
So that NEEDS_REVIEW business value is verified.

## Preconditions

- Imported from manual documentation; review and replace NEEDS_REVIEW values before promotion.
- Source scenario must be confirmed against the current product behavior.

## Out-of-scope

- NEEDS_REVIEW: add behaviors that should not be covered by this generated flow.

## Stability Requirements

| Field | Value |
|---|---|
| Parallel Safe | yes |
| Data Isolation | per-test |
| Allowed Retries | 0 |

## Variants

| ${variantAxes.join(' | ')} |
|${variantAxes.map(() => '---').join('|')}|
| ${variantDefaults.join(' | ')} |

## Includes

- none

## Business Rules

${rule ? `| Rule ID | Rule | Formula | Blocking Behavior |
|---|---|---|---|
| ${rule.id} | ${rule.rule} | ${rule.formula} | ${rule.blocking} |` : '- none'}

## Data Cases

| Case ID | Inputs | Expected Result | Notes |
|---|---|---|---|
${dataCases.map((dataCase) => `| ${dataCase.caseId} | ${escapeTableCell(formatObjectInline(dataCase.inputs))} | ${escapeTableCell(formatObjectInline(dataCase.expected))} | ${escapeTableCell(dataCase.notes)} |`).join('\n')}

## Data Cases as JSON

\`\`\`json
${JSON.stringify(dataCases, null, 2)}
\`\`\`

## Test Data

| Name | Value | Notes |
|---|---|---|
| primaryUser | test@example.com | fake user only |
| importedSource | manual scenario | no production data |

## Mocks

| API/Route | Scenario | Response |
|---|---|---|
| none | No API mock identified from source | [] |

## Mocks as JSON

\`\`\`json
[]
\`\`\`

## Flow Steps

| Step | AC IDs | Action | Target | Input | Expected Result | Assertion Hint |
|---:|---|---|---|---|---|---|
| 1 | AC-001 | Open flow entry page | ${args.basePath} | n/a | Flow entry page is visible | Heading or main landmark is visible |
| 2 | ${acIds[0] ?? 'AC-002'} | ${whenAction} | NEEDS_REVIEW target control | ${escapeTableCell(formatObjectInline(dataCases[0]?.inputs ?? {}))} | Primary action is accepted | Form fields or selected values are visible |
${outcomes
  .map(
    (outcome, index) =>
      `| ${index + 3} | AC-${String(index + 2).padStart(3, '0')} | Verify expected outcome | User-visible page state | n/a | ${escapeTableCell(outcome)} | Assert the exact user-visible result |`
  )
  .join('\n')}

## Negative Cases

| Case ID | Scenario | Expected Result |
|---|---|---|
| NEG-001 | Invalid or below-threshold input from the manual scenario | User is blocked and a clear error is visible |

## Acceptance Criteria

- AC-001: Flow entry page is visible.
${outcomes
  .map((outcome, index) => `- AC-${String(index + 2).padStart(3, '0')}: ${outcome}.`)
  .join('\n')}

## Locator Hints

- Prefer \`page.getByTestId(...)\` when Playwright CLI exploration confirms a meaningful stable \`data-testid\`.
- Prefer role/name locators when no stable \`data-testid\` exists.
- Prefer labels for form fields.
- Promote locator hints from aspirational to exact only after snapshot evidence exists.

## Generated Test Requirements

- Must import from fixtures/test.
- Must use test.step.
- Must use policy-preferred locators.
- Must include meaningful expect assertions.
- Default generation mode is single-test mode.
- Generate a suite only when the spec declares \`Generation Mode | suite\` or a suite is explicitly requested.
- In single-test mode, must generate one requested-scenario test with one primary final assertion step.
- In suite mode, must cover every AC ID from this spec.
- Default generated-test execution target is Chromium only.
- Cross-browser generated-test execution is opt-in.
- Must annotate or comment AC coverage.
- Must not use page.waitForTimeout.
- Must not use XPath.
- Must not use test.only.
- Must not silently skip.
- Must not use real credentials.
- Must not commit auth state.

## Notes

- Imported source:

\`\`\`text
${sanitizeEmbeddedSource(text)}
\`\`\`
- This draft intentionally fails strict validation until Review Status is changed from ai-draft after human review.
`;
}

// Untrusted manual-doc text is embedded inside a fenced ```text block. Without
// sanitization, a payload containing its own closing fence followed by Markdown
// (e.g. a second `## Metadata` with `Review Status | human-reviewed`) would break
// out of the block and inject real spec structure, defeating the ai-draft
// human-review firewall. Neutralize any fence-closing backtick runs and stray
// heading markers so the source can only ever be inert quoted text.
function sanitizeEmbeddedSource(text) {
  return String(text)
    .trim()
    .replace(/`{3,}/g, (run) => "'".repeat(run.length))
    .replace(/^(\s*)#(#+\s)/gm, '$1\\#$2');
}

function isValidationRuleText(normalizedText) {
  return ['minimum', 'maximum', 'at least', 'at most', 'duration', 'range', 'must be'].some((keyword) =>
    normalizedText.includes(keyword)
  );
}

function inferRuleLabel(normalizedText) {
  if (normalizedText.includes('duration')) {
    return 'Validate configured campaign duration rule';
  }

  if (normalizedText.includes('minimum') || normalizedText.includes('at least')) {
    return 'Validate configured minimum threshold rule';
  }

  if (normalizedText.includes('maximum') || normalizedText.includes('at most')) {
    return 'Validate configured maximum threshold rule';
  }

  return 'Validate configured range or threshold rule';
}

function inferDurationBoundaryCases(text) {
  const placeholders = extractBracketPlaceholders(text);
  const channel = placeholderValue(findPlaceholder(placeholders, /channel/i) ?? 'Channel Name');
  const minDays = placeholderValue(findPlaceholder(placeholders, /^x$/i) ?? 'X');
  const expectedError = `The campaign duration for ${channel} must be at least ${minDays} days.`;
  const commonInputs = {
    channelName: channel,
    minDurationDays: minDays,
    startDate: 'NEEDS_REVIEW: campaign start date',
    endDate: 'NEEDS_REVIEW: campaign end date'
  };

  return [
    {
      caseId: 'DC-001',
      inputs: {
        ...commonInputs,
        boundary: 'below-minimum',
        expectedDurationDays: 'NEEDS_REVIEW: X - 1'
      },
      expected: {
        result: 'blocked',
        message: expectedError
      },
      notes: 'below-minimum boundary; user cannot proceed'
    },
    {
      caseId: 'DC-002',
      inputs: {
        ...commonInputs,
        boundary: 'at-minimum',
        expectedDurationDays: 'NEEDS_REVIEW: X'
      },
      expected: {
        result: 'allowed',
        message: 'No minimum duration error is shown'
      },
      notes: 'at-minimum boundary; user can proceed'
    },
    {
      caseId: 'DC-003',
      inputs: {
        ...commonInputs,
        boundary: 'above-minimum',
        expectedDurationDays: 'NEEDS_REVIEW: X + 1'
      },
      expected: {
        result: 'allowed',
        message: 'No minimum duration error is shown'
      },
      notes: 'above-minimum boundary; user can proceed'
    }
  ];
}

function extractBracketPlaceholders(text) {
  return [...text.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1].trim()).filter(Boolean);
}

function findPlaceholder(placeholders, pattern) {
  return placeholders.find((placeholder) => pattern.test(placeholder));
}

function placeholderValue(label) {
  return `NEEDS_REVIEW: ${label}`;
}

function defaultVariantValue(axis) {
  if (/locale/i.test(axis)) {
    return 'en-US';
  }

  if (/channel/i.test(axis)) {
    return 'NEEDS_REVIEW: channel';
  }

  if (/role/i.test(axis)) {
    return 'NEEDS_REVIEW: role';
  }

  if (/plan/i.test(axis)) {
    return 'NEEDS_REVIEW: plan';
  }

  return `NEEDS_REVIEW: ${axis}`;
}

function formatObjectInline(value) {
  if (!value || typeof value !== 'object') {
    return String(value ?? '');
  }

  return Object.entries(value)
    .map(([key, entry]) => `${key}=${entry}`)
    .join('; ');
}

function validateImportOptions(args) {
  if (!['smoke', 'regression', 'accessibility', 'visual'].includes(args.testType)) {
    throw new Error(`--test-type must be one of smoke, regression, accessibility, visual. Found: ${args.testType}`);
  }

  if (!['none', 'optional', 'required'].includes(args.auth)) {
    throw new Error(`--auth must be one of none, optional, required. Found: ${args.auth}`);
  }

  if (!args.basePath.startsWith('/')) {
    throw new Error(`--base-path must start with "/". Found: ${args.basePath}`);
  }
}

function targetFor(testType, slug, auth) {
  const directoryByType = {
    smoke: 'tests/smoke',
    regression: 'tests/regression',
    accessibility: 'tests/accessibility',
    visual: 'tests/visual'
  };
  const directory = directoryByType[testType] ?? 'tests/regression';
  // Auth=required specs must target *.authenticated.spec.ts so the
  // chromium-auth project picks them up; validate-flow-spec rejects the
  // mismatch as soon as the draft is promoted past --allow-draft, so the
  // imported draft must be born with the correct suffix.
  const suffix = auth === 'required' ? '.authenticated.spec.ts' : '.spec.ts';
  return `${directory}/${slug}${suffix}`;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'imported-flow';
}

function sentenceCase(value) {
  const trimmed = String(value).trim().replace(/\.$/, '');
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : 'Imported manual flow';
}

function escapeTableCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/import-spec.mjs --input <manual-doc.md> [--out specs/flow.md]
  node scripts/ai/import-spec.mjs --text "<scenario text>" [--out specs/flow.md]

Options:
  --flow-id <FLOW-ID>        Override inferred Flow ID.
  --title <title>            Override inferred flow title.
  --test-type <type>         smoke, regression, accessibility, or visual. Default: regression.
  --auth <mode>              none, optional, or required. Default: optional.
  --base-path <path>         Flow entry path. Default: /.
  --force                    Overwrite existing output file.

Creates a draft strict flow spec from raw manual QA text. Draft specs are marked
Review Status=ai-draft and must be human-reviewed before the normal gate passes.`);
}

function runCli() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printHelp();
    return;
  }

  let args;
  try {
    args = parseArgs(rawArgs);
    const text = readSource(args);
    const title = inferTitle(text, args.title);
    const out = args.out ?? path.join('specs', `${slugify(title)}.draft.md`);
    const content = buildSpec({ text, args: { ...args, out } });

    if (fs.existsSync(out) && !args.force) {
      throw new Error(`Output already exists: ${out}. Use --force to overwrite.`);
    }

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, content);
    console.log(`Draft flow spec written to ${out}`);
    console.log('');
    console.log('Next step: review NEEDS_REVIEW fields, set Review Status to human-reviewed, then run:');
    console.log(`npm run ai:spec:validate -- ${out}`);
  } catch (error) {
    console.error(error.message);
    printHelp();
    process.exit(1);
  }
}

runCli();
