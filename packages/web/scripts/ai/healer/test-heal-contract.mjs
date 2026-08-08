import fs from 'node:fs';
import path from 'node:path';

import { isPendingGenerationSpec, validateSpecDirectory } from '../validate-flow-spec.mjs';
import { canonicalContractTestPath } from '../lib/test-suite-root.mjs';

const RECORDING_HEADER = /\/\*\s*recording:\s+([^\s]+)\s+title:(.*?)\s+sha256:([a-f0-9]{64})\s*\*\//i;
const RECORDING_MARKER = /\/\*\s*recording\s*:/gi;
const SPEC_HEADER = /^\/\*\s*spec:\s*([^\s]+)\s+version:\s*([^\s]+)\s+sha256:\s*([a-f0-9]{64})\s*\*\/$/i;
const SPEC_MARKER_START = /(?:\/\*+|\/\/+)[\t ]*spec\b/gi;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const ALLOWLIST_PATH = path.join('tests', '.no-header-allowlist');
const SPEC_BOUND_DIRS = ['tests/regression', 'tests/smoke', 'tests/accessibility', 'tests/visual'];
const RECORDED_TEST_DIR = 'tests/recorded';

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
  if (explicitSpecPath === undefined) {
    const binding = discoverSpec(testPath, specDir);
    if (!binding) return null;
    return { ...binding, specPath: assertPortableRepoPath(binding.specPath, 'Spec path') };
  }

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
  return { specPath: assertPortableRepoPath(match.specPath, 'Spec path'), validation: match.result };
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
  if (testPath.startsWith(`${RECORDED_TEST_DIR}/`)) {
    throw new Error(`${testPath} requires a recording contract and cannot be treated as handwritten.`);
  }
  if (!isSpecBoundDirectory(testPath)) return;
  if (readAllowlist(webRoot).has(testPath)) return;
  throw new Error(
    `${testPath} has no spec contract and is not listed in the no-header allowlist (${ALLOWLIST_PATH}).`
  );
}

function parseStrictSpecMarker(source) {
  const text = String(source ?? '');
  const markerStarts = [...text.matchAll(SPEC_MARKER_START)];
  if (markerStarts.length > 1) throw new Error('Heal target declares duplicate or ambiguous spec headers.');
  if (markerStarts.length === 0) return null;
  const markers = [...text.matchAll(BLOCK_COMMENT)]
    .map((match) => match[0])
    .filter((comment) => /^\/\*\s*spec\b/i.test(comment));
  if (markers.length !== 1) throw new Error('Heal target declares a malformed spec header.');
  const parsed = markers[0].match(SPEC_HEADER);
  if (!parsed) throw new Error('Heal target declares a malformed spec header.');
  return Object.freeze({
    specPath: assertPortableRepoPath(parsed[1], 'Spec header path'),
    version: parsed[2],
    sha256: parsed[3].toLowerCase()
  });
}

export function resolveHealContract(options) {
  const actualTestPath = assertPortableRepoPath(options.testPath, 'Test path');
  const contractTestPath = canonicalContractTestPath(actualTestPath);
  const source = String(options.source ?? '');
  const recordingMarkers = [...source.matchAll(RECORDING_MARKER)];
  const specMarker = parseStrictSpecMarker(source);
  if (recordingMarkers.length > 1) throw new Error('Heal target declares ambiguous recording headers.');
  if (recordingMarkers.length > 0 && specMarker) {
    throw new Error('Heal target declares both recording and spec contracts.');
  }
  const recording = source.match(RECORDING_HEADER);
  if (recordingMarkers.length > 0 && !recording) throw new Error('Heal target declares a malformed recording header.');
  const specBinding = resolveExplicitOrDiscoveredSpec({ ...options, testPath: contractTestPath });
  if (recording && specBinding) throw new Error('Heal target declares both recording and spec contracts.');
  if (recording) {
    const recordingPath = assertPortableRepoPath(recording[1], 'Recording path');
    return Object.freeze({ kind: 'recording', testPath: actualTestPath, recordingPath });
  }
  if (specMarker && !specBinding) {
    throw new Error(`Heal target spec header ${specMarker.specPath} has no validated spec binding.`);
  }
  if (specBinding && !specMarker) {
    throw new Error(`Heal target is bound to ${specBinding.specPath} but is missing its spec header.`);
  }
  if (specBinding && specMarker.specPath !== specBinding.specPath) {
    throw new Error(
      `Heal target spec header ${specMarker.specPath} does not match validated spec binding ${specBinding.specPath}.`
    );
  }
  if (specBinding) return Object.freeze({ kind: 'spec', testPath: actualTestPath, ...specBinding });
  assertHandwrittenTargetAllowed(contractTestPath, options.webRoot);
  return Object.freeze({ kind: 'handwritten', testPath: actualTestPath });
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
