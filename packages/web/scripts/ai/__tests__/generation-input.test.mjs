import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildGenerationInput, buildGenerationInputFromValidatedSpec } from '../lib/generation-input.mjs';
import { specSha256 } from '../lib/spec-parser.mjs';
import { validateSpecFile } from '../validate-flow-spec.mjs';
import {
  createManifest,
  findLatestDomDiscoveryArtifact,
  writeGenerationTaskArtifacts
} from '../create-generation-task.mjs';
import { generateTestSource, loadGenerationPrompt } from '../ai-generate.mjs';
import {
  GENERATION_POLICY_VERSION,
  PLAYWRIGHT_GENERATION_POLICY
} from '../lib/generation-policy.mjs';

const validSpecPath = 'specs/special-preconditions/media-planner-minimum-campaign-duration.md';
const validTarget = 'tests/regression/generated-minimum-duration.spec.ts';

function writeFixture(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

function savedTask(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'saved-generation-task-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const generationInput = buildGenerationInput({
    specPath: validSpecPath,
    targetTestFile: validTarget,
    mode: 'suite'
  });
  const artifacts = writeGenerationTaskArtifacts({
    runDir: directory,
    specPath: validSpecPath,
    generationInput,
    createdAt: '2026-08-02T00:00:00.000Z'
  });
  return { directory, generationInput, ...artifacts };
}

test('generation manifest binds the validated source hash and exact target path', () => {
  const manifest = createManifest({
    specPath: 'specs/flow.md',
    targetTestFile: 'tests/regression/flow.spec.ts',
    sha256: 'a'.repeat(64),
    flowId: 'FLOW-1',
    specVersion: '1.0',
    domArtifactPath: undefined,
    validation: { valid: true, issues: [], content: '# Flow', acceptanceCriteria: [], dataCasesJson: [] },
    generationMode: 'single',
    contextFingerprint: 'b'.repeat(64),
    generationFingerprint: 'c'.repeat(64),
    createdAt: '2026-08-01T00:00:00.000Z'
  });

  assert.equal(manifest.specPath, 'specs/flow.md');
  assert.equal(manifest.specSha256, 'a'.repeat(64));
  assert.equal(manifest.targetTestFile, 'tests/regression/flow.spec.ts');
});

test('buildGenerationInput validates and renders the complete generation contract', () => {
  const targetTestFile = validTarget;
  const input = buildGenerationInput({
    specPath: validSpecPath,
    targetTestFile,
    mode: 'suite',
    contextMaxChars: 2000
  });

  assert.equal(input.validation.valid, true);
  assert.equal(input.generationMode, 'suite');
  assert.equal(input.specSha256, specSha256(validSpecPath));
  assert.equal(input.targetTestFile, targetTestFile);
  assert.equal(input.ir.schemaVersion, 'playwright-generation-ir/v1');
  assert.match(input.ir.fingerprint, /^[a-f0-9]{64}$/);
  assert.match(input.prompt, /^# Playwright Generation Input/);
  assert.ok(input.prompt.includes(targetTestFile));
  assert.ok(input.prompt.includes(input.specSha256));
  assert.ok(input.prompt.includes(input.ir.target.exactHeader));
  assert.match(input.prompt, /"mode":"suite"/);
  assert.match(input.agentTask, /^# Codex Generation Task:/);
  assert.match(input.prompt, /## DOM and Repository Context/);
  assert.equal(input.contextPack.schemaVersion, 'generation-context-pack/v1');
  assert.ok(JSON.stringify(input.contextPack).length <= 2000);
  assert.match(input.contextPack.fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(input.prompt.includes(`Context fingerprint: sha256:${input.contextPack.fingerprint}`));
  assert.match(input.prompt, /"importPath":"\.\.\/\.\.\/fixtures\/test"/);
  assert.doesNotMatch(input.prompt, /Read it before choosing locators/);
});

test('generation hash and headers bind the exact content captured by validation, not a path reread', (context) => {
  const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'generation-input-spec-coherence-'));
  context.after(() => fs.rmSync(webRoot, { recursive: true, force: true }));
  const targetTestFile = 'tests/regression/spec-coherence.spec.ts';
  const contentA = fs.readFileSync(validSpecPath, 'utf8')
    .replace('| Auth | required |', '| Auth | none |')
    .replace('FLOW-MP-004', 'FLOW-COHERENCE-A')
    .replace(/\| Target Test File \| [^|]+ \|/, `| Target Test File | ${targetTestFile} |`);
  const contentB = contentA.replace('FLOW-COHERENCE-A', 'FLOW-COHERENCE-B');
  const specPath = writeFixture(webRoot, 'specs/coherence.md', contentA);
  writeFixture(webRoot, 'fixtures/test.ts', 'export const test = true;\n');
  const expectedHash = specSha256(contentA);
  const replacementHash = specSha256(contentB);
  const originalReadFileSync = fs.readFileSync;
  let specReads = 0;
  fs.readFileSync = function returnDifferentContentOnPathReread(filePath, ...args) {
    if (path.resolve(String(filePath)) === path.resolve(specPath)) {
      specReads += 1;
      if (specReads > 1) return contentB;
    }
    return originalReadFileSync.call(this, filePath, ...args);
  };
  let input;
  try {
    input = buildGenerationInput({ specPath, targetTestFile, mode: 'suite', webRoot });
  } finally {
    fs.readFileSync = originalReadFileSync;
  }

  assert.equal(specReads, 1);
  assert.equal(input.specSha256, expectedHash);
  assert.notEqual(input.specSha256, replacementHash);
  assert.match(input.ir.target.exactHeader, new RegExp(expectedHash));
  assert.match(input.agentTask, new RegExp(expectedHash));
});

test('validated generation boundary rejects a digest that does not match captured content', () => {
  const validation = validateSpecFile(validSpecPath);
  const mismatchedDigest = specSha256(validation.content.replace('FLOW-MP-004', 'FLOW-MISMATCH'));
  assert.notEqual(mismatchedDigest, specSha256(validation.content));
  assert.throws(
    () => buildGenerationInputFromValidatedSpec({
      specPath: validSpecPath,
      specFilePath: validSpecPath,
      validation,
      specSha256: mismatchedDigest,
      targetTestFile: validTarget,
      mode: 'suite'
    }),
    /behavioral spec SHA-256.*captured validated content|does not match.*validated content/i
  );
});

test('3,500-character cache identity is invariant to radically different large mutable targets', (context) => {
  const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'generation-input-cache-identity-'));
  context.after(() => fs.rmSync(webRoot, { recursive: true, force: true }));
  const targetTestFile = 'tests/regression/checkout.spec.ts';
  const specPath = writeFixture(
    webRoot,
    'specs/checkout.md',
    fs.readFileSync(validSpecPath, 'utf8')
      .replace('| Auth | required |', '| Auth | none |')
      .replace(/\| Target Test File \| [^|]+ \|/, `| Target Test File | ${targetTestFile} |`)
  );
  writeFixture(webRoot, 'fixtures/test.ts', `
import { test as base, expect } from '@playwright/test';
type Fixtures = { ${Array.from({ length: 18 }, (_, index) => `checkoutFixture${index}${'Long'.repeat(20)}: string`).join('; ')} };
export const test = base.extend<Fixtures>({});
export { expect };
`);
  writeFixture(webRoot, 'pages/CheckoutPage.ts', `
export class CheckoutPage {
  constructor(page: unknown, options: { note: '${'constructor'.repeat(70)}' }) {}
  gotoCheckout(note: '${'method'.repeat(70)}'): Promise<void> { return Promise.resolve(); }
  confirmCheckout(note: '${'confirm'.repeat(70)}'): Promise<void> { return Promise.resolve(); }
}
`);
  const build = () => buildGenerationInput({
    specPath,
    targetTestFile,
    mode: 'suite',
    webRoot,
    contextMaxChars: 3500
  });
  writeFixture(webRoot, targetTestFile, `${Array.from({ length: 18 }, (_, index) => (
    `import { TargetDependency${index} } from '../../support/${'alpha'.repeat(35)}-${index}';\n`
  )).join('')}\n${Array.from({ length: 18 }, (_, index) => (
    `type AlphaTarget${index} = { note: '${'alpha'.repeat(70)}' };\n`
  )).join('')}const bodySecret = 'ALPHA_BODY_MUST_NOT_LEAK';\n`);
  const first = build();
  writeFixture(webRoot, targetTestFile, `${Array.from({ length: 3 }, (_, index) => (
    `import { OtherDependency${index} } from '../../support/${'beta'.repeat(120)}-${index}';\n`
  )).join('')}\n${Array.from({ length: 3 }, (_, index) => (
    `interface BetaTarget${index} { note: '${'beta'.repeat(180)}' }\n`
  )).join('')}const bodySecret = 'BETA_BODY_MUST_NOT_LEAK';\n`);
  const second = build();

  assert.equal(second.contextPack.fingerprint, first.contextPack.fingerprint);
  assert.equal(second.cacheIdentityPrompt, first.cacheIdentityPrompt);
  assert.notEqual(second.contextPack.existingTarget.sha256, first.contextPack.existingTarget.sha256);
  assert.notEqual(second.prompt, first.prompt);
  assert.ok(first.prompt.length > first.cacheIdentityPrompt.length);
  assert.doesNotMatch(`${first.prompt}\n${second.prompt}`, /BODY_MUST_NOT_LEAK/);
});

test('explicit DOM evidence is bound to the requested spec identity and behavioral hash before provider dispatch', async (context) => {
  const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'generation-input-dom-binding-'));
  context.after(() => fs.rmSync(webRoot, { recursive: true, force: true }));
  const targetTestFile = 'tests/regression/dom-bound.spec.ts';
  const source = fs.readFileSync(validSpecPath, 'utf8')
    .replace('| Auth | required |', '| Auth | none |')
    .replace(/\| Target Test File \| [^|]+ \|/, `| Target Test File | ${targetTestFile} |`);
  const specA = writeFixture(webRoot, 'specs/flow-a.md', source.replace('FLOW-MP-004', 'FLOW-DOM-A'));
  const specB = writeFixture(webRoot, 'specs/flow-b.md', source.replace('FLOW-MP-004', 'FLOW-DOM-B'));
  writeFixture(webRoot, 'fixtures/test.ts', `
import { test as base, expect } from '@playwright/test';
export const test = base;
export { expect };
`);
  const artifactFor = (sourceSpecPath, name, { artifactSpecPath = sourceSpecPath, artifactSpecSha256 = specSha256(sourceSpecPath) } = {}) => writeFixture(webRoot, `.ai-runs/dom/${name}.json`, JSON.stringify({
    specPath: artifactSpecPath,
    specSha256: artifactSpecSha256,
    flowId: name,
    specVersion: '1.3.0',
    url: 'https://example.test/planning',
    capturedAt: '2026-08-02T00:00:00.000Z',
    source: 'agent-browser',
    selectorOwnership: 'framework',
    locatorAudit: {
      method: 'playwright-locator-count',
      snapshotDiagnostics: 'accessibility-snapshot-candidate-equivalence',
      requiredMatchCount: 1
    },
    elements: [{
      elementId: 'planning-submit',
      role: 'button',
      accessibleName: 'Submit plan',
      candidateLocators: [{
        type: 'testId', locator: 'page.getByTestId("planning-submit")', preferred: true,
        matchCount: 1, unique: true, snapshotMatchCount: 1, snapshotUnique: true,
        matchEvidence: 'playwright-live'
      }]
    }]
  }));
  const artifactA = artifactFor(specA, 'FLOW-DOM-A', { artifactSpecPath: path.relative(webRoot, specA) });
  const artifactB = artifactFor(specB, 'FLOW-DOM-B');
  const artifactWithoutHash = artifactFor(specA, 'FLOW-DOM-NO-HASH', {
    artifactSpecPath: path.relative(webRoot, specA),
    artifactSpecSha256: null
  });
  let providerCalls = 0;
  const generate = (domArtifactPath) => generateTestSource({
    specPath: specA,
    out: targetTestFile,
    mode: 'suite',
    domArtifactPath,
    packageRoot: webRoot,
    resolvedEnv: { env: { AI_BRAIN: 'codex-cli' } },
    selectBrainImpl: () => ({ kind: 'codex-cli', model: 'codex' }),
    runBrainImpl: async () => {
      providerCalls += 1;
      return { text: '```ts\nconst generated = true;\n```', brain: { kind: 'codex-cli' } };
    }
  });

  await assert.rejects(generate(artifactB), /DOM[\s\S]*spec.*(?:does not match|mismatch)/i);
  assert.equal(providerCalls, 0);
  await assert.rejects(generate(artifactWithoutHash), /DOM[\s\S]*spec.*(?:does not match|mismatch)/i);
  assert.equal(providerCalls, 0);
  const matching = await generate(artifactA);
  assert.equal(providerCalls, 1);
  assert.match(matching.promptRequest.prompt, /page\.getByTestId/);
});

test('final DOM capture revalidates the full policy on the exact same-identity replacement', async (context) => {
  const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'generation-input-dom-policy-swap-'));
  context.after(() => fs.rmSync(webRoot, { recursive: true, force: true }));
  const targetTestFile = 'tests/regression/dom-policy-swap.spec.ts';
  const specPath = writeFixture(
    webRoot,
    'specs/flow.md',
    fs.readFileSync(validSpecPath, 'utf8')
      .replace('| Auth | required |', '| Auth | none |')
      .replace(/\| Target Test File \| [^|]+ \|/, `| Target Test File | ${targetTestFile} |`)
  );
  writeFixture(webRoot, 'fixtures/test.ts', 'export const test = true;\n');
  const validArtifact = {
    specPath: path.relative(webRoot, specPath),
    specSha256: specSha256(specPath),
    source: 'agent-browser',
    selectorOwnership: 'framework',
    locatorAudit: {
      method: 'playwright-locator-count',
      snapshotDiagnostics: 'accessibility-snapshot-candidate-equivalence',
      requiredMatchCount: 1
    },
    elements: [{
      elementId: 'planning-submit',
      candidateLocators: [{
        type: 'testId', locator: 'page.getByTestId("planning-submit")', preferred: true,
        matchCount: 1, unique: true, snapshotMatchCount: 1, snapshotUnique: true,
        matchEvidence: 'playwright-live'
      }]
    }]
  };
  const invalidReplacement = structuredClone(validArtifact);
  invalidReplacement.source = 'unreviewed-snapshot';
  invalidReplacement.selectorOwnership = 'provider';
  invalidReplacement.locatorAudit = { method: 'snapshot-only', requiredMatchCount: 2 };
  invalidReplacement.elements[0].candidateLocators[0].preferred = false;
  invalidReplacement.elements[0].candidateLocators[0].snapshotMatchCount = 2;
  invalidReplacement.elements[0].candidateLocators[0].snapshotUnique = true;
  const artifactPath = writeFixture(webRoot, '.ai-runs/dom/policy-swap.json', JSON.stringify(validArtifact));
  const canonicalArtifactPath = fs.realpathSync(artifactPath);
  const originalRealpathSync = fs.realpathSync;
  let artifactRealpathCalls = 0;
  fs.realpathSync = function replaceAfterInitialReview(candidatePath, ...args) {
    if (path.resolve(String(candidatePath)) === canonicalArtifactPath) {
      artifactRealpathCalls += 1;
      if (artifactRealpathCalls === 3) {
        fs.writeFileSync(canonicalArtifactPath, JSON.stringify(invalidReplacement));
      }
    }
    return originalRealpathSync.call(this, candidatePath, ...args);
  };
  let providerCalls = 0;
  try {
    await assert.rejects(
      generateTestSource({
        specPath,
        out: targetTestFile,
        mode: 'suite',
        domArtifactPath: artifactPath,
        packageRoot: webRoot,
        resolvedEnv: { env: { AI_BRAIN: 'codex-cli' } },
        selectBrainImpl: () => ({ kind: 'codex-cli', model: 'codex' }),
        runBrainImpl: async () => {
          providerCalls += 1;
          return { text: '```ts\nconst generated = true;\n```', brain: { kind: 'codex-cli' } };
        }
      }),
      /DOM discovery artifact.*(?:source|ownership|locator|preferred|snapshot|policy)/i
    );
  } finally {
    fs.realpathSync = originalRealpathSync;
  }
  assert.equal(artifactRealpathCalls >= 3, true);
  assert.equal(providerCalls, 0);
});

test('explicit DOM review and context capture avoid path-based artifact reads', (context) => {
  const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'generation-input-dom-descriptor-'));
  context.after(() => fs.rmSync(webRoot, { recursive: true, force: true }));
  const targetTestFile = 'tests/regression/dom-descriptor.spec.ts';
  const specPath = writeFixture(
    webRoot,
    'specs/flow.md',
    fs.readFileSync(validSpecPath, 'utf8')
      .replace('| Auth | required |', '| Auth | none |')
      .replace(/\| Target Test File \| [^|]+ \|/, `| Target Test File | ${targetTestFile} |`)
  );
  writeFixture(webRoot, 'fixtures/test.ts', 'export const test = true;\n');
  const artifactPath = writeFixture(webRoot, '.ai-runs/dom/descriptor.json', JSON.stringify({
    specPath,
    specSha256: specSha256(specPath),
    flowId: 'FLOW-DESCRIPTOR',
    specVersion: '1.3.0',
    url: 'https://example.test/planning',
    capturedAt: '2026-08-02T00:00:00.000Z',
    source: 'agent-browser',
    selectorOwnership: 'framework',
    locatorAudit: {
      method: 'playwright-locator-count',
      snapshotDiagnostics: 'accessibility-snapshot-candidate-equivalence',
      requiredMatchCount: 1
    },
    elements: [{
      elementId: 'planning-submit',
      candidateLocators: [{
        type: 'testId', locator: 'page.getByTestId("planning-submit")', preferred: true,
        matchCount: 1, unique: true, snapshotMatchCount: 1, snapshotUnique: true,
        matchEvidence: 'playwright-live'
      }]
    }]
  }));
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = function forbidArtifactPathRead(filePath, ...args) {
    if (path.resolve(String(filePath)) === artifactPath) throw new Error('DOM path-based read is forbidden');
    return originalReadFileSync.call(this, filePath, ...args);
  };
  try {
    const input = buildGenerationInput({ specPath, targetTestFile, domArtifactPath: artifactPath, mode: 'suite', webRoot });
    assert.match(input.prompt, /page\.getByTestId/);
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
});

test('automatic DOM artifact discovery is rooted and skips symlink candidates', (context) => {
  const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'generation-input-dom-finder-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'generation-input-dom-finder-outside-'));
  context.after(() => fs.rmSync(webRoot, { recursive: true, force: true }));
  context.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const specPath = writeFixture(webRoot, 'specs/flow.md', '# Flow: Finder\n');
  const expectedHash = specSha256(specPath);
  const safePath = writeFixture(webRoot, '.ai-runs/dom-discovery/001-safe/selector-candidates.json', JSON.stringify({
    specPath: path.relative(webRoot, specPath),
    specSha256: expectedHash
  }));
  const outsideArtifact = writeFixture(outside, 'selector-candidates.json', JSON.stringify({
    specPath,
    specSha256: expectedHash
  }));
  const unsafeDirectory = path.join(webRoot, '.ai-runs/dom-discovery/999-unsafe');
  fs.mkdirSync(unsafeDirectory, { recursive: true });
  fs.symlinkSync(outsideArtifact, path.join(unsafeDirectory, 'selector-candidates.json'), 'file');

  assert.equal(findLatestDomDiscoveryArtifact(specPath, webRoot, expectedHash), safePath);
});

test('automatic DOM artifact discovery fails closed above its bounded entry scan', (context) => {
  const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'generation-input-dom-finder-limit-'));
  context.after(() => fs.rmSync(webRoot, { recursive: true, force: true }));
  const specPath = writeFixture(webRoot, 'specs/flow.md', '# Flow: Finder limit\n');
  const discoveryRoot = path.join(webRoot, '.ai-runs/dom-discovery');
  fs.mkdirSync(discoveryRoot, { recursive: true });
  for (let index = 0; index <= 2_048; index += 1) {
    fs.writeFileSync(path.join(discoveryRoot, `noise-${String(index).padStart(4, '0')}`), '');
  }
  assert.throws(
    () => findLatestDomDiscoveryArtifact(specPath, webRoot, specSha256(specPath)),
    /DOM discovery.*limit.*2048|2048.*entries.*exceeded/i
  );
});

test('saved flow tasks persist the canonical provider input and bind it in the manifest', (context) => {
  const saved = savedTask(context);
  const providerInput = fs.readFileSync(saved.providerInputPath, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(saved.manifestPath, 'utf8'));

  assert.equal(providerInput, saved.generationInput.prompt);
  assert.match(manifest.agentTaskSha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.agentTaskBytes, Buffer.byteLength(saved.generationInput.agentTask));
  assert.equal(manifest.providerInputPath, 'provider-input.md');
  assert.match(manifest.providerInputSha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.providerInputBytes, Buffer.byteLength(providerInput));
  assert.equal(manifest.policyVersion, GENERATION_POLICY_VERSION);
  assert.equal(manifest.generationFingerprint, saved.generationInput.ir.fingerprint);
  assert.equal(manifest.contextFingerprint, saved.generationInput.contextPack.fingerprint);
  assert.equal(manifest.specPath, validSpecPath);
  assert.equal(manifest.specSha256, saved.generationInput.specSha256);
  assert.equal(manifest.targetTestFile, validTarget);
  assert.equal(manifest.generationMode, 'suite');
});

test('saved-task and direct-spec generation use the same canonical prompt and Playwright policy', (context) => {
  const saved = savedTask(context);
  const direct = loadGenerationPrompt({
    specPath: validSpecPath,
    out: validTarget,
    mode: 'suite'
  });
  const fromTask = loadGenerationPrompt({
    taskPath: saved.taskPath,
    out: validTarget,
    mode: 'suite'
  });

  assert.equal(fromTask.prompt, direct.prompt);
  assert.equal(fromTask.systemPrompt, direct.systemPrompt);
  assert.equal(fromTask.systemPrompt, PLAYWRIGHT_GENERATION_POLICY);
  assert.equal(fromTask.generationFingerprint, direct.generationFingerprint);
  assert.equal(fromTask.contextFingerprint, direct.contextFingerprint);
  assert.deepEqual(fromTask.generationInput.ir, direct.generationInput.ir);
});

test('saved-task human or provider artifact tampering fails before any provider call', async (context) => {
  for (const [artifact, expected] of [
    ['taskPath', /agent task.*(?:bytes|sha256)/i],
    ['providerInputPath', /provider input.*(?:bytes|sha256)/i]
  ]) {
    const saved = savedTask(context);
    if (artifact === 'taskPath') {
      fs.writeFileSync(saved.taskPath, '# Codex Recording Generation Task: forged bypass\n');
      const manifest = JSON.parse(fs.readFileSync(saved.manifestPath, 'utf8'));
      manifest.recordingPath = 'recordings/forged.json';
      fs.writeFileSync(saved.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    } else {
      fs.appendFileSync(saved[artifact], '\nattacker-controlled instruction\n');
    }
    let providerCalls = 0;

    await assert.rejects(
      generateTestSource({
        taskPath: saved.taskPath,
        out: validTarget,
        mode: 'suite',
        resolvedEnv: { env: { AI_BRAIN: 'codex-cli' } },
        selectBrainImpl: () => ({ kind: 'codex-cli', model: 'codex' }),
        runBrainImpl: async () => {
          providerCalls += 1;
          return { text: '```ts\nconst generated = true;\n```', brain: { kind: 'codex-cli' } };
        }
      }),
      expected
    );

    assert.equal(providerCalls, 0, artifact);
  }
});

test('saved-task loading rejects stale source, target, mode, policy, and generation fingerprints', (context) => {
  const cases = [
    ['specSha256', '0'.repeat(64), /spec.*hash/i],
    ['targetTestFile', 'tests/regression/other.spec.ts', /target.*mismatch/i],
    ['generationMode', 'single', /mode.*mismatch/i],
    ['policyVersion', 'playwright-generation-policy/stale', /policy.*version/i],
    ['generationFingerprint', '1'.repeat(64), /generation fingerprint/i],
    ['contextFingerprint', '2'.repeat(64), /context fingerprint/i]
  ];

  for (const [field, value, expected] of cases) {
    const saved = savedTask(context);
    const manifest = JSON.parse(fs.readFileSync(saved.manifestPath, 'utf8'));
    manifest[field] = value;
    fs.writeFileSync(saved.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(
      () => loadGenerationPrompt({ taskPath: saved.taskPath, out: validTarget, mode: 'suite' }),
      expected,
      field
    );
  }
});

test('buildGenerationInput rejects an invalid spec before a provider can be called', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'generation-input-invalid-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const specPath = path.join(directory, 'invalid.md');
  fs.writeFileSync(specPath, '# Flow: Incomplete\n');

  assert.throws(
    () => buildGenerationInput({ specPath, targetTestFile: 'tests/generated/invalid.spec.ts' }),
    /Cannot generate from invalid flow spec.*Missing required section/s
  );
});

test('buildGenerationInput rejects a mode that conflicts with spec metadata', () => {
  assert.throws(
    () => buildGenerationInput({
      specPath: validSpecPath,
      targetTestFile: 'tests/regression/conflict.spec.ts',
      mode: 'single'
    }),
    /--mode single conflicts with spec metadata Generation Mode "suite"/
  );
});

test('ai-generate --spec uses validated generation input instead of raw spec Markdown', () => {
  const rawSpec = fs.readFileSync(validSpecPath, 'utf8');
  const generated = loadGenerationPrompt({
    specPath: validSpecPath,
    out: 'tests/regression/generated-minimum-duration.spec.ts',
    mode: 'suite'
  });

  assert.notEqual(generated.prompt, rawSpec);
  assert.match(generated.prompt, /^# Playwright Generation Input/);
  assert.doesNotMatch(generated.prompt, /## Original Flow Spec/);
  assert.equal(generated.generationInput.validation.valid, true);
  assert.equal(generated.generationInput.targetTestFile, 'tests/regression/generated-minimum-duration.spec.ts');
  assert.equal(generated.systemPrompt, PLAYWRIGHT_GENERATION_POLICY);
});

test('direct-spec generation sends the stable Playwright policy to CLI-capable runBrain', async () => {
  let received;
  await generateTestSource({
    specPath: validSpecPath,
    out: 'tests/regression/generated-minimum-duration.spec.ts',
    mode: 'suite',
    resolvedEnv: { env: { AI_BRAIN: 'codex-cli' } },
    selectBrainImpl: () => ({ kind: 'codex-cli', model: 'codex' }),
    runBrainImpl: async (prompt, options) => {
      received = { prompt, options };
      return { text: '```ts\nconst generated = true;\n```', brain: { kind: 'codex-cli' } };
    }
  });

  assert.equal(received.options.systemPrompt, PLAYWRIGHT_GENERATION_POLICY);
  assert.match(received.prompt, /^# Playwright Generation Input/);
});

test('generation-task CLI delegates validation and rendering to the shared builder', () => {
  const source = fs.readFileSync(new URL('../create-generation-task.mjs', import.meta.url), 'utf8');
  assert.match(source, /import \{ buildGenerationInput \} from ['"]\.\/lib\/generation-input\.mjs['"]/);
  assert.match(source, /buildGenerationInput\(\{[\s\S]*specPath: args\.specPath/);
});

test('ai-generate rejects symlinked and oversized task files before reading provider input', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'generation-task-safety-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const realTask = path.join(directory, 'real-task.md');
  const linkedTask = path.join(directory, 'linked-task.md');
  const oversizedTask = path.join(directory, 'oversized-task.md');
  fs.writeFileSync(realTask, '# Codex Generation Task: safe\n');
  fs.symlinkSync(realTask, linkedTask);
  fs.writeFileSync(oversizedTask, 'x'.repeat(2 * 1024 * 1024 + 1));

  assert.throws(
    () => loadGenerationPrompt({ taskPath: linkedTask, out: 'tests/regression/safe.spec.ts' }),
    /symbolic link/
  );
  assert.throws(
    () => loadGenerationPrompt({ taskPath: oversizedTask, out: 'tests/regression/safe.spec.ts' }),
    /exceeds.*2097152 bytes/
  );
});
