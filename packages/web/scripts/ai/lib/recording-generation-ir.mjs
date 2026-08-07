import crypto from 'node:crypto';

export const RECORDING_GENERATION_IR_SCHEMA = 'recording-generation-ir/v1';
export const RECORDING_GENERATION_POLICY_VERSION = 'recording-generation-policy/v1';
export const RECORDING_GENERATION_POLICY = `Policy ${RECORDING_GENERATION_POLICY_VERSION}

Generate one complete compilable Playwright TypeScript file from the recording IR.
- Preserve target.exactHeader and every RSTEP-###/ASSERT-### in test.step titles.
- Import test/expect from the repository fixtures/test module. Use urlForTest, deterministic fake values, bestLocator evidence, and meaningful expect assertions for assertion steps.
- Prefer stable test id, role/name, label, placeholder, text, then CSS with // locator-policy:exception <reason>.
- Never invent or weaken recorded behavior. Never use Puppeteer replay, XPath, nth-child chains, page.waitForTimeout, networkidle, focused/skipped tests, credentials, tokens, cookies, session IDs, or storage state.`;

function compactStep(step) {
  return Object.fromEntries([
    ['id', step.id],
    ['type', step.type],
    ['action', step.action],
    ['urlForTest', step.urlForTest],
    ['bestLocator', step.bestLocator],
    ['value', step.value],
    ['assertionId', step.assertionId],
    ['operator', step.operator],
    ['count', step.count]
  ].filter(([, value]) => value !== undefined));
}

export function compileRecordingGenerationIr(normalized, { targetTestFile } = {}) {
  if (!normalized || !Array.isArray(normalized.steps) || !/^[a-f0-9]{64}$/.test(normalized.sha256 ?? '')) {
    throw new Error('Recording generation IR requires a validated normalized recording.');
  }
  const testFile = String(targetTestFile ?? normalized.targetTestFile ?? '').trim();
  if (!testFile) throw new Error('Recording generation IR requires a target test file.');
  const exactHeader = `/* recording: ${normalized.recordingPath} title:${normalized.title} sha256:${normalized.sha256} */`;
  const base = {
    schemaVersion: RECORDING_GENERATION_IR_SCHEMA,
    policyVersion: RECORDING_GENERATION_POLICY_VERSION,
    target: {
      recordingPath: normalized.recordingPath,
      title: normalized.title,
      testFile,
      sha256: normalized.sha256,
      exactHeader
    },
    steps: normalized.steps.map(compactStep),
    assertions: (normalized.assertions ?? []).map((assertion) => ({
      id: assertion.id,
      stepId: assertion.stepId,
      expected: assertion.expected
    }))
  };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(base)).digest('hex');
  return { ...base, fingerprint };
}

export function renderRecordingGenerationIr(ir) {
  if (!ir || ir.schemaVersion !== RECORDING_GENERATION_IR_SCHEMA || !/^[a-f0-9]{64}$/.test(ir.fingerprint ?? '')) {
    throw new Error('Cannot render an invalid recording generation IR.');
  }
  return `# Playwright Recording Generation Input\n\nIR fingerprint: sha256:${ir.fingerprint}\n\n${JSON.stringify(ir)}\n`;
}
