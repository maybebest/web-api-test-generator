import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_GOLDEN_MANIFEST,
  REQUIRED_PIPELINE_INPUTS,
  buildSemanticProfile,
  compareSemanticProfiles,
  computePipelineFingerprint,
  evaluateGoldenCases,
  sha256File,
  validateManifestShape
} from '../evals/golden-eval.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const evalsDir = path.resolve(here, '..', 'evals');
const fixtureDir = path.join(evalsDir, 'fixtures');

function readManifest() {
  return JSON.parse(fs.readFileSync(DEFAULT_GOLDEN_MANIFEST, 'utf8'));
}

function tempDir(prefix = 'golden-eval-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeManifest(directory, manifest) {
  const manifestPath = path.join(directory, 'golden-cases.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

function copyHarness() {
  const directory = tempDir();
  fs.cpSync(fixtureDir, path.join(directory, 'fixtures'), { recursive: true });
  return { directory, manifest: readManifest() };
}

function copyCandidates(modify = () => {}) {
  const directory = tempDir('golden-candidates-');
  const manifest = readManifest();
  for (const entry of manifest.cases) {
    const source = path.join(evalsDir, entry.reference);
    const target = path.join(directory, entry.candidate);
    fs.copyFileSync(source, target);
  }
  modify(directory, manifest);
  return directory;
}

test('committed single and suite references pass deterministic offline evaluation', () => {
  const result = evaluateGoldenCases();

  assert.equal(result.passed, true, result.issues.join('\n'));
  assert.deepEqual(
    result.cases.map((entry) => [entry.id, entry.mode, entry.metrics.testCount]),
    [
      ['single-checkout', 'single', 2],
      ['suite-checkout', 'suite', 4]
    ]
  );
  assert.ok(result.cases.every((entry) => /^[a-f0-9]{64}$/.test(entry.semanticSha256)));
});

test('candidate evaluation is semantic rather than byte equality', () => {
  const candidateDir = copyCandidates((directory, manifest) => {
    for (const entry of manifest.cases) {
      const candidate = path.join(directory, entry.candidate);
      fs.writeFileSync(candidate, `// Formatting-only candidate difference.\n\n${fs.readFileSync(candidate, 'utf8')}\n`);
      assert.notEqual(sha256File(candidate), entry.referenceFileSha256);
    }
  });

  const result = evaluateGoldenCases({ candidateDir });

  assert.equal(result.passed, true, result.issues.join('\n'));
  assert.ok(result.cases.every((entry) => entry.passed));
});

test('reviewer-valid candidate semantic divergence fails with an explicit metric', () => {
  const candidateDir = copyCandidates((directory) => {
    const candidate = path.join(directory, 'single-checkout.spec.ts');
    const content = fs.readFileSync(candidate, 'utf8');
    fs.writeFileSync(candidate, content.replace("this.page.goto('/checkout')", "this.page.goto('/checkout?golden=divergent')"));
  });

  const result = evaluateGoldenCases({ candidateDir });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /single-checkout: candidate\/reference semantic divergence in navigationTargets/);
  assert.doesNotMatch(result.issues.join('\n'), /candidate reviewer failed/);
});

test('candidate reviewer failures fail closed before semantic comparison', () => {
  const candidateDir = copyCandidates((directory) => {
    const candidate = path.join(directory, 'single-checkout.spec.ts');
    const content = fs.readFileSync(candidate, 'utf8');
    fs.writeFileSync(candidate, content.replace("test('DC-001", "test.skip('DC-001"));
  });

  const result = evaluateGoldenCases({ candidateDir });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /single-checkout: candidate reviewer failed:/);
  assert.match(result.issues.join('\n'), /test\.skip/);
});

test('malformed JSON and duplicate cases fail manifest loading closed', () => {
  const malformedDir = tempDir();
  const malformedPath = path.join(malformedDir, 'golden-cases.json');
  fs.writeFileSync(malformedPath, '{ not json');

  const malformed = evaluateGoldenCases({ manifestPath: malformedPath });
  assert.equal(malformed.passed, false);
  assert.match(malformed.issues.join('\n'), /not valid JSON/);

  const duplicateDir = tempDir();
  const duplicateManifest = readManifest();
  duplicateManifest.cases.push(structuredClone(duplicateManifest.cases[0]));
  const duplicate = evaluateGoldenCases({ manifestPath: writeManifest(duplicateDir, duplicateManifest) });
  assert.equal(duplicate.passed, false);
  assert.match(duplicate.issues.join('\n'), /Duplicate golden case id: single-checkout/);
  assert.match(duplicate.issues.join('\n'), /Duplicate golden candidate path: single-checkout\.spec\.ts/);
  assert.match(duplicate.issues.join('\n'), /Duplicate golden spec\/reference case/);
});

test('manifest shape rejects missing, unknown, unsafe, and unsorted fields', () => {
  const manifest = readManifest();
  delete manifest.cases[0].referenceFileSha256;
  manifest.cases[0].surprise = true;
  manifest.cases[0].candidate = '../escape.spec.ts';
  manifest.cases[1].expectedMetrics.acIds = ['AC-002', 'AC-001', 'AC-001'];

  const issues = validateManifestShape(manifest).join('\n');

  assert.match(issues, /missing required field "referenceFileSha256"/);
  assert.match(issues, /unsupported field "surprise"/);
  assert.match(issues, /candidate must be a normalized relative path/);
  assert.match(issues, /acIds must be sorted and contain no duplicates/);
});

test('manifest schema requires a safe sorted pipeline input set and fingerprint', () => {
  const manifest = readManifest();
  delete manifest.pipelineFingerprintSha256;
  manifest.pipelineInputs = manifest.pipelineInputs
    .filter((input) => input !== 'scripts/ai/lib/ai-client.mjs')
    .concat(['../escape.mjs', 'ai/prompts/02-generate-test.md'])
    .reverse();

  const issues = validateManifestShape(manifest).join('\n');

  assert.match(issues, /pipelineFingerprintSha256 must be a lowercase SHA-256 hex digest/);
  assert.match(issues, /pipelineInputs contains an unsafe path/);
  assert.match(issues, /pipelineInputs must be sorted and contain no duplicates/);
  assert.match(issues, /pipelineInputs is missing required generation\/review input: scripts\/ai\/lib\/ai-client\.mjs/);
});

test('committed pipeline fingerprint deterministically pins required paths and contents', () => {
  const manifest = readManifest();

  assert.deepEqual(manifest.pipelineInputs, REQUIRED_PIPELINE_INPUTS);
  assert.equal(computePipelineFingerprint(manifest.pipelineInputs), manifest.pipelineFingerprintSha256);

  const root = tempDir('golden-pipeline-');
  fs.writeFileSync(path.join(root, 'first.txt'), 'same bytes');
  fs.writeFileSync(path.join(root, 'renamed.txt'), 'same bytes');
  const first = computePipelineFingerprint(['first.txt'], root);
  const renamed = computePipelineFingerprint(['renamed.txt'], root);
  fs.writeFileSync(path.join(root, 'first.txt'), 'changed bytes');
  const changed = computePipelineFingerprint(['first.txt'], root);

  assert.notEqual(first, renamed, 'changing only the path must change the fingerprint');
  assert.notEqual(first, changed, 'changing only the content must change the fingerprint');
});

test('stale and missing pipeline fingerprints fail before golden cases run', () => {
  const staleDir = tempDir();
  const staleManifest = readManifest();
  staleManifest.pipelineFingerprintSha256 = '0'.repeat(64);
  const stale = evaluateGoldenCases({ manifestPath: writeManifest(staleDir, staleManifest) });

  assert.equal(stale.passed, false);
  assert.deepEqual(stale.cases, []);
  assert.match(stale.issues.join('\n'), /Stale pipeline fingerprint/);

  const missingDir = tempDir();
  const missingManifest = readManifest();
  missingManifest.pipelineInputs = [...missingManifest.pipelineInputs, 'scripts/ai/zzz-missing-pipeline-input.mjs'].sort();
  const missing = evaluateGoldenCases({ manifestPath: writeManifest(missingDir, missingManifest) });

  assert.equal(missing.passed, false);
  assert.deepEqual(missing.cases, []);
  assert.match(missing.issues.join('\n'), /pipeline input .* file does not exist/);
});

test('pipeline fingerprinting rejects symlink inputs, including symlinked path components', () => {
  const root = tempDir('golden-pipeline-symlink-');
  const realDir = path.join(root, 'real');
  fs.mkdirSync(realDir);
  fs.writeFileSync(path.join(realDir, 'input.mjs'), 'export const value = 1;\n');
  fs.symlinkSync(path.join(realDir, 'input.mjs'), path.join(root, 'input-link.mjs'));
  fs.symlinkSync(realDir, path.join(root, 'directory-link'), 'dir');

  assert.throws(() => computePipelineFingerprint(['input-link.mjs'], root), (error) => {
    assert.match(error.details.join('\n'), /pipeline input input-link\.mjs path must not contain symbolic links/);
    return true;
  });
  assert.throws(() => computePipelineFingerprint(['directory-link/input.mjs'], root), (error) => {
    assert.match(
      error.details.join('\n'),
      /pipeline input directory-link\/input\.mjs path must not contain symbolic links/
    );
    return true;
  });
});

test('manifest, spec, and reference symlinks are rejected without following them', () => {
  const manifestLinkDir = tempDir();
  const manifestLink = path.join(manifestLinkDir, 'golden-cases.json');
  fs.symlinkSync(DEFAULT_GOLDEN_MANIFEST, manifestLink);
  const linkedManifest = evaluateGoldenCases({ manifestPath: manifestLink });
  assert.equal(linkedManifest.passed, false);
  assert.match(linkedManifest.issues.join('\n'), /Golden manifest must not be a symbolic link/);

  const { directory, manifest } = copyHarness();
  const singleSpec = path.join(directory, manifest.cases[0].spec);
  const realSingleSpec = path.join(directory, 'real-single-spec.md');
  fs.copyFileSync(singleSpec, realSingleSpec);
  fs.rmSync(singleSpec);
  fs.symlinkSync(realSingleSpec, singleSpec);

  const suiteReference = path.join(directory, manifest.cases[1].reference);
  const realSuiteReference = path.join(directory, 'real-suite-reference.spec.ts');
  fs.copyFileSync(suiteReference, realSuiteReference);
  fs.rmSync(suiteReference);
  fs.symlinkSync(realSuiteReference, suiteReference);

  const linkedFiles = evaluateGoldenCases({ manifestPath: writeManifest(directory, manifest) });
  assert.equal(linkedFiles.passed, false);
  assert.match(linkedFiles.issues.join('\n'), /single-checkout: spec path must not contain symbolic links/);
  assert.match(linkedFiles.issues.join('\n'), /suite-checkout: reference path must not contain symbolic links/);
});

test('candidate directory, candidate file, and nested candidate symlinks are rejected', () => {
  const realCandidates = copyCandidates();
  const linkParent = tempDir();
  const linkedCandidateDir = path.join(linkParent, 'candidates');
  fs.symlinkSync(realCandidates, linkedCandidateDir, 'dir');
  const linkedDirectory = evaluateGoldenCases({ candidateDir: linkedCandidateDir });
  assert.equal(linkedDirectory.passed, false);
  assert.match(linkedDirectory.issues.join('\n'), /Candidate directory must not be a symbolic link/);

  const linkedFileCandidates = copyCandidates((directory) => {
    const candidate = path.join(directory, 'single-checkout.spec.ts');
    fs.rmSync(candidate);
    fs.symlinkSync(path.join(fixtureDir, 'single-checkout', 'reference.spec.ts'), candidate);
  });
  const linkedFile = evaluateGoldenCases({ candidateDir: linkedFileCandidates });
  assert.equal(linkedFile.passed, false);
  assert.match(linkedFile.issues.join('\n'), /single-checkout: candidate path must not contain symbolic links/);

  const { directory, manifest } = copyHarness();
  manifest.cases[0].candidate = 'nested/single-checkout.spec.ts';
  const nestedCandidates = tempDir('golden-nested-candidates-');
  const realNested = path.join(nestedCandidates, 'real-nested');
  fs.mkdirSync(realNested);
  fs.copyFileSync(
    path.join(fixtureDir, 'single-checkout', 'reference.spec.ts'),
    path.join(realNested, 'single-checkout.spec.ts')
  );
  fs.symlinkSync(realNested, path.join(nestedCandidates, 'nested'), 'dir');
  fs.copyFileSync(
    path.join(fixtureDir, 'suite-checkout', 'reference.spec.ts'),
    path.join(nestedCandidates, 'suite-checkout.spec.ts')
  );
  const nestedLink = evaluateGoldenCases({
    manifestPath: writeManifest(directory, manifest),
    candidateDir: nestedCandidates
  });
  assert.equal(nestedLink.passed, false);
  assert.match(nestedLink.issues.join('\n'), /single-checkout: candidate path must not contain symbolic links/);
});

test('missing spec, reference, and optional candidate files fail closed', () => {
  const missingDir = tempDir();
  const missing = evaluateGoldenCases({ manifestPath: writeManifest(missingDir, readManifest()) });
  assert.equal(missing.passed, false);
  assert.match(missing.issues.join('\n'), /spec file does not exist/);
  assert.match(missing.issues.join('\n'), /reference file does not exist/);

  const candidateDir = tempDir('golden-candidates-missing-');
  fs.copyFileSync(
    path.join(fixtureDir, 'single-checkout', 'reference.spec.ts'),
    path.join(candidateDir, 'single-checkout.spec.ts')
  );
  const missingCandidate = evaluateGoldenCases({ candidateDir });
  assert.equal(missingCandidate.passed, false);
  assert.match(missingCandidate.issues.join('\n'), /suite-checkout: candidate file does not exist/);
});

test('stale full-file spec and reference hashes fail before review', () => {
  const { directory, manifest } = copyHarness();
  fs.appendFileSync(path.join(directory, manifest.cases[0].spec), '\nEditorial drift.\n');
  fs.appendFileSync(path.join(directory, manifest.cases[1].reference), '\n// Reference drift.\n');

  const result = evaluateGoldenCases({ manifestPath: writeManifest(directory, manifest) });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /single-checkout: stale spec hash/);
  assert.match(result.issues.join('\n'), /suite-checkout: stale reference hash/);
});

test('stale semantic pins and explicit metrics fail closed', () => {
  const { directory, manifest } = copyHarness();
  manifest.cases[0].referenceSemanticSha256 = '0'.repeat(64);
  manifest.cases[1].expectedMetrics.assertionCount += 1;

  const result = evaluateGoldenCases({ manifestPath: writeManifest(directory, manifest) });

  assert.equal(result.passed, false);
  assert.match(result.issues.join('\n'), /single-checkout: stale reference semantic hash/);
  assert.match(result.issues.join('\n'), /suite-checkout: reference metric assertionCount is stale/);
});

test('semantic profiles ignore comments but expose deterministic contract changes', () => {
  const referencePath = path.join(fixtureDir, 'single-checkout', 'reference.spec.ts');
  const source = fs.readFileSync(referencePath, 'utf8');
  const reference = buildSemanticProfile(source, { source: true });
  const formatted = buildSemanticProfile(`// comment\n${source}\n`, { source: true });
  const divergent = buildSemanticProfile(source.replace("page.goto('/checkout')", "page.goto('/other')"), {
    source: true
  });

  assert.equal(compareSemanticProfiles(reference, formatted).equal, true);
  const comparison = compareSemanticProfiles(reference, divergent);
  assert.equal(comparison.equal, false);
  assert.ok(comparison.differences.some((entry) => entry.field === 'navigationTargets'));
});

test('semantic profiling rejects malformed TypeScript instead of producing partial metrics', () => {
  assert.throws(
    () => buildSemanticProfile("test('unterminated'", { source: true, fileName: 'broken.spec.ts' }),
    /TypeScript syntax parsing failed/
  );
});
