import crypto from 'node:crypto';

import { sanitizeGenerationContext } from './generation-context.mjs';
import { GENERATION_POLICY_VERSION } from './generation-policy.mjs';
import { parseFlowSpec, parseGenericTable } from './spec-parser.mjs';
import { containsProviderUnsafeSecret } from './secret-safety.mjs';

export const GENERATION_IR_SCHEMA = 'playwright-generation-ir/v1';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function section(parsed, name) {
  const value = parsed.sections[name];
  return value === undefined ? undefined : sanitizeGenerationContext(value).trim();
}

function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Generation IR requires ${name}.`);
  return value.trim();
}

function dynamicGeneratedRequirements(value) {
  const stableRulePatterns = [
    /Must import from fixtures\/test/i,
    /Must use test\.step/i,
    /Must use Page Objects or Component Objects/i,
    /Must not create direct `?page\./i,
    /Must put `?expect/i,
    /Must title assertion steps/i,
    /Must include meaningful expect assertions/i,
    /In suite mode, must cover every AC ID/i,
    /Default generated-test execution target/i,
    /Cross-browser generated-test execution/i,
    /Must enumerate every Data Cases/i,
    /Must not use page\.waitForTimeout/i,
    /Must not use page\.waitForLoadState\(['"]networkidle/i,
    /Must not use XPath/i,
    /Must not use test\.only/i,
    /Must not silently skip/i,
    /Must not use real credentials/i,
    /Must not commit auth state/i
  ];
  return String(value ?? '').split(/\r?\n/)
    .filter((line) => !stableRulePatterns.some((pattern) => pattern.test(line)))
    .join('\n').trim();
}

function tableRows(value) {
  return value?.none === true || !Array.isArray(value?.rows) ? [] : value.rows;
}

function assertProviderSafe(value, trail = 'generation IR') {
  if (typeof value === 'string') {
    if (containsProviderUnsafeSecret(value)) {
      throw new Error(`Refusing secret-bearing provider generation IR at ${trail}.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertProviderSafe(entry, `${trail}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) assertProviderSafe(entry, `${trail}.${key}`);
  }
}

export function compileGenerationIr(validation, {
  specPath,
  targetTestFile,
  generationMode,
  specSha256
}) {
  if (!validation?.valid) {
    throw new Error('Generation IR can only be compiled from a valid flow spec.');
  }
  const parsed = parseFlowSpec(validation.content);
  const metadata = validation.metadata ?? {};
  const normalizedSpecPath = requireText(specPath, 'specPath');
  const normalizedTarget = requireText(targetTestFile, 'targetTestFile');
  const normalizedHash = requireText(specSha256, 'specSha256');
  if (!/^[a-f0-9]{64}$/.test(normalizedHash)) throw new Error('Generation IR specSha256 must be a SHA-256 hex digest.');
  if (!['single', 'suite'].includes(generationMode)) throw new Error('Generation IR mode must be single or suite.');

  const specVersion = requireText(metadata['Spec Version'], 'Spec Version');
  const base = {
    schemaVersion: GENERATION_IR_SCHEMA,
    policyVersion: GENERATION_POLICY_VERSION,
    target: {
      specPath: normalizedSpecPath,
      testFile: normalizedTarget,
      flowId: requireText(metadata['Flow ID'], 'Flow ID'),
      title: requireText(parsed.title, 'flow title'),
      specVersion,
      specSha256: normalizedHash,
      exactHeader: `/* spec: ${normalizedSpecPath} version:${specVersion} sha256:${normalizedHash} */`,
      mode: generationMode,
      acIds: [...(validation.acceptanceCriteria ?? [])],
      tags: String(metadata.Tags ?? '').split(/\s+/).filter(Boolean),
      basePath: String(metadata['Base Path'] ?? ''),
      auth: String(metadata.Auth ?? ''),
      testType: String(metadata['Test Type'] ?? ''),
      priority: String(metadata.Priority ?? '')
    },
    behavior: {
      userStory: section(parsed, 'User Story'),
      preconditions: section(parsed, 'Preconditions'),
      outOfScope: section(parsed, 'Out-of-scope'),
      stability: canonicalize(validation.stability),
      variants: canonicalize(validation.variants?.rows ?? []),
      includes: canonicalize((validation.includes ?? []).filter((item) => String(item).trim().toLowerCase() !== 'none')),
      businessRules: canonicalize(tableRows(validation.businessRules)),
      dataCases: canonicalize(
        Array.isArray(validation.dataCasesJson) && validation.dataCasesJson.length > 0
          ? validation.dataCasesJson
          : validation.dataCases
      ),
      testData: canonicalize(tableRows(parseGenericTable(parsed.sections['Test Data'] ?? ''))),
      mocks: canonicalize(validation.mocksJson),
      steps: canonicalize(validation.flowSteps),
      negativeCases: canonicalize(validation.negativeCases),
      acceptanceCriteria: section(parsed, 'Acceptance Criteria'),
      locatorHints: canonicalize(validation.locatorHints),
      generatedTestRequirements: dynamicGeneratedRequirements(section(parsed, 'Generated Test Requirements'))
    }
  };
  assertProviderSafe({
    target: {
      flowId: base.target.flowId,
      title: base.target.title,
      tags: base.target.tags,
      basePath: base.target.basePath,
      auth: base.target.auth,
      testType: base.target.testType,
      priority: base.target.priority
    },
    behavior: base.behavior
  });
  const canonical = canonicalize(base);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  return { ...canonical, fingerprint };
}

export function renderGenerationIr(ir) {
  if (!ir || ir.schemaVersion !== GENERATION_IR_SCHEMA || !/^[a-f0-9]{64}$/.test(ir.fingerprint ?? '')) {
    throw new Error('Cannot render an invalid generation IR.');
  }
  return `# Playwright Generation Input\n\nIR fingerprint: sha256:${ir.fingerprint}\n\n${JSON.stringify(ir)}\n`;
}
