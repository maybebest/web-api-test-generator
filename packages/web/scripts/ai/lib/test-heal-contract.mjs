import fs from 'node:fs';
import path from 'node:path';

import { isPendingGenerationSpec, validateSpecDirectory } from '../validate-flow-spec.mjs';

const RECORDING_HEADER = /\/\*\s*recording:\s+([^\s]+)\s+title:(.*?)\s+sha256:([a-f0-9]{64})\s*\*\//i;
const ALLOWLIST_PATH = path.join('tests', '.no-header-allowlist');
const SPEC_BOUND_DIRS = ['tests/regression', 'tests/smoke', 'tests/accessibility', 'tests/visual'];

function normalizePortablePath(value) {
  return String(value ?? '').replace(/\\/g, '/');
}

function assertPortableRepoPath(value, label) {
  const raw = String(value ?? '');
  const normalized = normalizePortablePath(raw);
  if (!raw || raw !== raw.trim() || raw !== normalized || raw.startsWith('-') || normalized.startsWith('/') || path.win32.isAbsolute(raw)) {
    throw new Error(`${label} must be a non-empty, portable repository-relative path.`);
  }
  if (normalized.split('/').includes('..') || path.posix.normalize(normalized) !== normalized) {
    throw new Error(`${label} must be a normalized portable repository-relative path.`);
  }
  return normalized;
}

function resolveExplicitOrDiscoveredSpec({
  testPath,
  explicitSpecPath,
  specDir = 'specs',
  discoverSpec,
  validateDirectory = validateSpecDirectory
}) {
  if (explicitSpecPath === undefined) return discoverSpec(testPath, specDir);

  const directoryResult = validateDirectory(specDir);
  const explicitPath = assertPortableRepoPath(explicitSpecPath, '--spec path');
  const match = directoryResult.valid
    ? directoryResult.results.find((entry) => normalizePortablePath(entry.specPath) === explicitPath)
    : undefined;
  if (!match) {
    throw new Error(`--spec ${explicitSpecPath} was not found in the validated spec directory ${specDir}.`);
  }
  if (isPendingGenerationSpec(match.result.metadata)) {
    throw new Error(`--spec ${explicitSpecPath} is marked pending generation; generate its test before healing.`);
  }
  const declaredTarget = normalizePortablePath(match.result.metadata['Target Test File']);
  if (declaredTarget !== testPath) {
    throw new Error(
      `--spec ${explicitSpecPath} declares Target Test File ${declaredTarget}, which does not match --test ${testPath}.`
    );
  }
  return { specPath: match.specPath, validation: match.result };
}

function isSpecBoundDirectory(testPath) {
  return SPEC_BOUND_DIRS.some((directory) => testPath === directory || testPath.startsWith(`${directory}/`));
}

function readAllowlist(webRoot) {
  const allowlistPath = path.join(webRoot, ALLOWLIST_PATH);
  if (!fs.existsSync(allowlistPath)) return new Set();
  return new Set(
    fs.readFileSync(allowlistPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
  );
}

function assertHandwrittenTargetAllowed(testPath, webRoot) {
  if (!isSpecBoundDirectory(testPath)) return;
  if (readAllowlist(webRoot).has(testPath)) return;
  throw new Error(
    `${testPath} has no spec contract and is not listed in the no-header allowlist (${ALLOWLIST_PATH}).`
  );
}

export function resolveHealContract(options) {
  const testPath = assertPortableRepoPath(options.testPath, 'Test path');
  const recording = String(options.source ?? '').match(RECORDING_HEADER);
  const specBinding = resolveExplicitOrDiscoveredSpec({ ...options, testPath });
  if (recording && specBinding) throw new Error('Heal target declares both recording and spec contracts.');
  if (recording) {
    const recordingPath = assertPortableRepoPath(recording[1], 'Recording path');
    return Object.freeze({ kind: 'recording', testPath, recordingPath });
  }
  if (specBinding) return Object.freeze({ kind: 'spec', testPath, ...specBinding });
  assertHandwrittenTargetAllowed(testPath, options.webRoot);
  return Object.freeze({ kind: 'handwritten', testPath });
}

export function reviewHealContract({ contract, candidatePath, generatedReviewer, recordedReviewer }) {
  if (contract.kind === 'spec') {
    return generatedReviewer({
      specPath: contract.specPath,
      testPath: candidatePath,
      validation: contract.validation
    });
  }
  if (contract.kind === 'recording') {
    return recordedReviewer({ recordingPath: contract.recordingPath, testPath: candidatePath });
  }
  return { passed: true, issues: [] };
}
