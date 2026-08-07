#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { reviewGeneratedTest } from '../review-generated-test.mjs';

const currentFile = fileURLToPath(import.meta.url);
const evalsDir = path.dirname(currentFile);
const packageRoot = path.resolve(evalsDir, '..', '..', '..');

export const DEFAULT_GOLDEN_MANIFEST = path.join(evalsDir, 'golden-cases.json');
export const GOLDEN_SCHEMA_VERSION = 2;
export const REQUIRED_PIPELINE_INPUTS = Object.freeze([
  'ai/prompts/02-generate-test.md',
  'ai/prompts/05-review-ai-test.md',
  'playwright.config.ts',
  'scripts/ai/ai-generate.mjs',
  'scripts/ai/create-generation-task.mjs',
  'scripts/ai/gate-all.mjs',
  'scripts/ai/generated-test-gate.mjs',
  'scripts/ai/lib/ai-client.mjs',
  'scripts/ai/lib/authenticated-target.mjs',
  'scripts/ai/lib/gate-environment.mjs',
  'scripts/ai/lib/generated-capability-policy.mjs',
  'scripts/ai/lib/generated-gate-fingerprint.mjs',
  'scripts/ai/lib/generated-gate-runner.mjs',
  'scripts/ai/lib/generated-gate-verdict.mjs',
  'scripts/ai/lib/generation-cache.mjs',
  'scripts/ai/lib/generation-context-pack.mjs',
  'scripts/ai/lib/generation-context.mjs',
  'scripts/ai/lib/generation-input.mjs',
  'scripts/ai/lib/generation-ir.mjs',
  'scripts/ai/lib/generation-policy.mjs',
  'scripts/ai/lib/generation-preflight.mjs',
  'scripts/ai/lib/generation-repair.mjs',
  'scripts/ai/lib/generation-run.mjs',
  'scripts/ai/lib/output-contracts.mjs',
  'scripts/ai/lib/rest-prompt.mjs',
  'scripts/ai/lib/secret-safety.mjs',
  'scripts/ai/lib/spec-parser.mjs',
  'scripts/ai/lib/verified-file-read.mjs',
  'scripts/ai/review-generated-test.mjs',
  'scripts/ai/review-recorded-test.mjs',
  'scripts/ai/run-local-generated.mjs',
  'scripts/ai/validate-flow-spec.mjs',
  'scripts/ai/verified-generate.mjs'
]);

const CASE_FIELDS = new Set([
  'id',
  'mode',
  'spec',
  'reference',
  'candidate',
  'specFileSha256',
  'referenceFileSha256',
  'referenceSemanticSha256',
  'expectedMetrics'
]);
const METRIC_FIELDS = new Set(['testCount', 'stepCount', 'assertionCount', 'acIds', 'negativeCaseIds', 'dataCaseIds']);
const LOCATOR_METHODS = new Set(['getByRole', 'getByLabel', 'getByPlaceholder', 'getByText', 'getByTestId']);
const INTERACTION_METHODS = new Set([
  'abort',
  'check',
  'click',
  'continue',
  'dblclick',
  'fill',
  'fulfill',
  'goBack',
  'goForward',
  'goto',
  'hover',
  'press',
  'reload',
  'route',
  'selectOption',
  'setInputFiles',
  'type',
  'uncheck',
  'waitFor',
  'waitForLoadState',
  'waitForURL'
]);
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const CASE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class GoldenEvalError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'GoldenEvalError';
    this.details = details;
  }
}

export function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function semanticProfileSha256(profile) {
  return crypto.createHash('sha256').update(JSON.stringify(profile)).digest('hex');
}

// The baseline trigger deliberately covers repository inputs, not model output: a path rename or
// byte change in the generation/review/model-contract surface changes this digest and requires an
// explicit golden-baseline update. No model, network, or subprocess is involved.
export function computePipelineFingerprint(inputPaths, rootDir = packageRoot) {
  const canonicalRoot = fs.realpathSync(path.resolve(rootDir));
  const hash = crypto.createHash('sha256');
  hash.update('golden-pipeline-fingerprint-v1\0');

  for (const inputPath of inputPaths) {
    const inspected = inspectContainedRegularFile(canonicalRoot, inputPath, `pipeline input ${inputPath}`);
    if (inspected.issues.length > 0) {
      throw new GoldenEvalError('Pipeline input validation failed.', inspected.issues);
    }
    const content = fs.readFileSync(inspected.path);
    hash.update(inputPath);
    hash.update('\0');
    hash.update(String(content.length));
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }

  return hash.digest('hex');
}

export function loadGoldenManifest(manifestPath = DEFAULT_GOLDEN_MANIFEST) {
  const absoluteManifest = path.resolve(manifestPath);
  let manifestStat;
  try {
    manifestStat = fs.lstatSync(absoluteManifest);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new GoldenEvalError(`Golden manifest does not exist: ${absoluteManifest}`);
    }
    throw new GoldenEvalError(`Golden manifest cannot be inspected: ${absoluteManifest} (${error.message})`);
  }
  if (manifestStat.isSymbolicLink()) {
    throw new GoldenEvalError(`Golden manifest must not be a symbolic link: ${absoluteManifest}`);
  }
  if (!manifestStat.isFile()) {
    throw new GoldenEvalError(`Golden manifest does not exist: ${absoluteManifest}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(absoluteManifest, 'utf8'));
  } catch (error) {
    throw new GoldenEvalError(`Golden manifest is not valid JSON: ${absoluteManifest} (${error.message})`);
  }

  const issues = validateManifestShape(manifest);
  if (issues.length > 0) {
    throw new GoldenEvalError(`Golden manifest validation failed: ${absoluteManifest}`, issues);
  }

  return {
    manifestPath: fs.realpathSync(absoluteManifest),
    manifestDir: fs.realpathSync(path.dirname(absoluteManifest)),
    schemaVersion: manifest.schemaVersion,
    pipelineInputs: [...manifest.pipelineInputs],
    pipelineFingerprintSha256: manifest.pipelineFingerprintSha256,
    cases: manifest.cases.map((entry) => ({ ...entry, expectedMetrics: { ...entry.expectedMetrics } }))
  };
}

export function validateManifestShape(manifest) {
  const issues = [];
  if (!isPlainObject(manifest)) {
    return ['Manifest root must be a JSON object.'];
  }

  const rootFields = Object.keys(manifest);
  for (const field of rootFields) {
    if (!['schemaVersion', 'pipelineInputs', 'pipelineFingerprintSha256', 'cases'].includes(field)) {
      issues.push(`Manifest contains unsupported root field "${field}".`);
    }
  }

  if (manifest.schemaVersion !== GOLDEN_SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${GOLDEN_SCHEMA_VERSION}.`);
  }
  issues.push(...validatePipelineManifestFields(manifest));
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) {
    issues.push('cases must be a non-empty array.');
    return issues;
  }

  const ids = new Set();
  const candidates = new Set();
  const pairs = new Set();
  for (let index = 0; index < manifest.cases.length; index += 1) {
    const entry = manifest.cases[index];
    const label = `cases[${index}]`;
    if (!isPlainObject(entry)) {
      issues.push(`${label} must be a JSON object.`);
      continue;
    }

    for (const field of Object.keys(entry)) {
      if (!CASE_FIELDS.has(field)) {
        issues.push(`${label} contains unsupported field "${field}".`);
      }
    }
    for (const field of CASE_FIELDS) {
      if (!(field in entry)) {
        issues.push(`${label} is missing required field "${field}".`);
      }
    }

    if (typeof entry.id !== 'string' || !CASE_ID_PATTERN.test(entry.id)) {
      issues.push(`${label}.id must use lowercase kebab-case.`);
    } else if (ids.has(entry.id)) {
      issues.push(`Duplicate golden case id: ${entry.id}.`);
    } else {
      ids.add(entry.id);
    }

    if (!['single', 'suite'].includes(entry.mode)) {
      issues.push(`${label}.mode must be "single" or "suite".`);
    }

    for (const field of ['spec', 'reference', 'candidate']) {
      if (!isSafeRelativePath(entry[field])) {
        issues.push(`${label}.${field} must be a normalized relative path contained by its base directory.`);
      }
    }

    for (const field of ['specFileSha256', 'referenceFileSha256', 'referenceSemanticSha256']) {
      if (typeof entry[field] !== 'string' || !HASH_PATTERN.test(entry[field])) {
        issues.push(`${label}.${field} must be a lowercase SHA-256 hex digest.`);
      }
    }

    issues.push(...validateExpectedMetrics(entry.expectedMetrics, `${label}.expectedMetrics`));

    if (typeof entry.candidate === 'string') {
      if (candidates.has(entry.candidate)) {
        issues.push(`Duplicate golden candidate path: ${entry.candidate}.`);
      }
      candidates.add(entry.candidate);
    }
    if (typeof entry.spec === 'string' && typeof entry.reference === 'string') {
      const pair = `${entry.spec}\0${entry.reference}`;
      if (pairs.has(pair)) {
        issues.push(`Duplicate golden spec/reference case: ${entry.spec} -> ${entry.reference}.`);
      }
      pairs.add(pair);
    }
  }

  const modes = new Set(manifest.cases.map((entry) => entry?.mode));
  if (!modes.has('single')) {
    issues.push('Manifest must include at least one single-mode case.');
  }
  if (!modes.has('suite')) {
    issues.push('Manifest must include at least one suite-mode case.');
  }

  return issues;
}

function validatePipelineManifestFields(manifest) {
  const issues = [];
  const inputs = manifest.pipelineInputs;
  if (!Array.isArray(inputs) || inputs.length === 0) {
    issues.push('pipelineInputs must be a non-empty array.');
  } else {
    if (inputs.some((input) => typeof input !== 'string')) {
      issues.push('pipelineInputs must contain only strings.');
    } else {
      for (const input of inputs) {
        if (!isSafeRelativePath(input)) {
          issues.push(`pipelineInputs contains an unsafe path: ${JSON.stringify(input)}.`);
        }
      }
      const normalized = [...new Set(inputs)].sort();
      if (JSON.stringify(inputs) !== JSON.stringify(normalized)) {
        issues.push('pipelineInputs must be sorted and contain no duplicates.');
      }
      const configured = new Set(inputs);
      for (const required of REQUIRED_PIPELINE_INPUTS) {
        if (!configured.has(required)) {
          issues.push(`pipelineInputs is missing required generation/review input: ${required}.`);
        }
      }
    }
  }

  if (typeof manifest.pipelineFingerprintSha256 !== 'string' || !HASH_PATTERN.test(manifest.pipelineFingerprintSha256)) {
    issues.push('pipelineFingerprintSha256 must be a lowercase SHA-256 hex digest.');
  }
  return issues;
}

export function buildSemanticProfile(sourceOrPath, options = {}) {
  const source = options.source === true ? String(sourceOrPath) : fs.readFileSync(path.resolve(sourceOrPath), 'utf8');
  const fileName = options.fileName ?? (options.source === true ? 'candidate.spec.ts' : path.basename(sourceOrPath));
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics = sourceFile.parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    const messages = diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    throw new GoldenEvalError(`TypeScript syntax parsing failed for ${fileName}.`, messages);
  }

  const testTitles = [];
  const stepTitles = [];
  const tags = [];
  const assertionMatchers = new Map();
  const locatorContracts = new Map();
  const interactionCalls = new Map();
  const navigationTargets = [];
  const routeTargets = [];
  const mockStatuses = [];
  const coverage = { acIds: new Set(), negativeCaseIds: new Set(), dataCaseIds: new Set() };

  walk(sourceFile, (node) => {
    if (isStaticTextNode(node)) {
      collectCoverageIds(staticText(node), coverage);
    }
    if (!ts.isCallExpression(node)) {
      return;
    }

    const callName = calledName(node.expression);
    const callPath = calledPath(node.expression);

    if (callPath === 'test') {
      testTitles.push(requiredStaticText(node.arguments[0], 'test title', sourceFile));
      tags.push(...extractTags(node.arguments[1], sourceFile));
    } else if (callPath === 'test.step') {
      stepTitles.push(requiredStaticText(node.arguments[0], 'test.step title', sourceFile));
    }

    const matcher = expectationMatcher(node);
    if (matcher) {
      increment(assertionMatchers, matcher);
    }

    if (LOCATOR_METHODS.has(callName)) {
      const contract = `${callName}(${node.arguments.map((argument) => canonicalNode(argument, sourceFile)).join(',')})`;
      increment(locatorContracts, contract);
    }

    if (INTERACTION_METHODS.has(callName)) {
      increment(interactionCalls, callName);
    }
    if (['goto', 'waitForURL'].includes(callName) && node.arguments[0]) {
      navigationTargets.push(canonicalNode(node.arguments[0], sourceFile));
    }
    if (callName === 'route' && node.arguments[0]) {
      routeTargets.push(canonicalNode(node.arguments[0], sourceFile));
    }
    if (callName === 'fulfill' && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
      const status = propertyInitializer(node.arguments[0], 'status');
      if (status) {
        mockStatuses.push(canonicalNode(status, sourceFile));
      }
    }
  });

  return {
    schemaVersion: 1,
    testCount: testTitles.length,
    stepCount: stepTitles.length,
    assertionCount: sumMap(assertionMatchers),
    testTitles: [...testTitles].sort(),
    stepTitles: [...stepTitles].sort(),
    tags: [...new Set(tags)].sort(),
    coverage: {
      acIds: [...coverage.acIds].sort(),
      negativeCaseIds: [...coverage.negativeCaseIds].sort(),
      dataCaseIds: [...coverage.dataCaseIds].sort()
    },
    assertionMatchers: sortedRecord(assertionMatchers),
    locatorContracts: sortedRecord(locatorContracts),
    interactionCalls: sortedRecord(interactionCalls),
    navigationTargets: [...navigationTargets].sort(),
    routeTargets: [...routeTargets].sort(),
    mockStatuses: [...mockStatuses].sort()
  };
}

export function compareSemanticProfiles(reference, candidate) {
  const differences = [];
  for (const field of Object.keys(reference)) {
    if (JSON.stringify(reference[field]) !== JSON.stringify(candidate?.[field])) {
      differences.push({ field, reference: reference[field], candidate: candidate?.[field] });
    }
  }
  for (const field of Object.keys(candidate ?? {})) {
    if (!(field in reference)) {
      differences.push({ field, reference: undefined, candidate: candidate[field] });
    }
  }
  return { equal: differences.length === 0, differences };
}

export function evaluateGoldenCases({ manifestPath = DEFAULT_GOLDEN_MANIFEST, candidateDir } = {}) {
  let loaded;
  try {
    loaded = loadGoldenManifest(manifestPath);
  } catch (error) {
    return failureResult(error);
  }

  let actualPipelineFingerprint;
  try {
    actualPipelineFingerprint = computePipelineFingerprint(loaded.pipelineInputs);
  } catch (error) {
    return failureResult(error);
  }
  if (actualPipelineFingerprint !== loaded.pipelineFingerprintSha256) {
    return {
      passed: false,
      manifestPath: loaded.manifestPath,
      pipelineFingerprintSha256: actualPipelineFingerprint,
      issues: [
        `Stale pipeline fingerprint: manifest=${loaded.pipelineFingerprintSha256}, actual=${actualPipelineFingerprint}. Generation/review/model-contract inputs changed; review the change and update the golden baseline explicitly.`
      ],
      cases: []
    };
  }

  let absoluteCandidateDir;
  if (candidateDir !== undefined) {
    const requestedCandidateDir = path.resolve(candidateDir);
    let candidateStat;
    try {
      candidateStat = fs.lstatSync(requestedCandidateDir);
    } catch (error) {
      return {
        passed: false,
        issues: [
          error?.code === 'ENOENT'
            ? `Candidate directory does not exist or is not a directory: ${requestedCandidateDir}`
            : `Candidate directory cannot be inspected: ${requestedCandidateDir} (${error.message})`
        ],
        cases: []
      };
    }
    if (candidateStat.isSymbolicLink()) {
      return {
        passed: false,
        issues: [`Candidate directory must not be a symbolic link: ${requestedCandidateDir}`],
        cases: []
      };
    }
    if (!candidateStat.isDirectory()) {
      return {
        passed: false,
        issues: [`Candidate directory does not exist or is not a directory: ${requestedCandidateDir}`],
        cases: []
      };
    }
    absoluteCandidateDir = fs.realpathSync(requestedCandidateDir);
  }

  const caseResults = loaded.cases.map((entry) =>
    evaluateCase(entry, loaded.manifestDir, absoluteCandidateDir)
  );
  const issues = caseResults.flatMap((result) => result.issues.map((issue) => `${result.id}: ${issue}`));
  return {
    passed: issues.length === 0,
    manifestPath: loaded.manifestPath,
    candidateDir: absoluteCandidateDir,
    pipelineFingerprintSha256: actualPipelineFingerprint,
    issues,
    cases: caseResults
  };
}

function evaluateCase(entry, manifestDir, candidateDir) {
  const issues = [];
  const warnings = [];
  const specInspection = inspectContainedRegularFile(manifestDir, entry.spec, 'spec');
  const referenceInspection = inspectContainedRegularFile(manifestDir, entry.reference, 'reference');
  const candidateInspection = candidateDir
    ? inspectContainedRegularFile(candidateDir, entry.candidate, 'candidate')
    : referenceInspection;
  const specPath = specInspection.path;
  const referencePath = referenceInspection.path;
  const candidatePath = candidateInspection.path;

  issues.push(...specInspection.issues, ...referenceInspection.issues);
  if (candidateDir) {
    issues.push(...candidateInspection.issues);
  }
  if (issues.length > 0) {
    return caseResult(entry, candidatePath, issues, warnings);
  }

  const actualSpecHash = sha256File(specPath);
  if (actualSpecHash !== entry.specFileSha256) {
    issues.push(`stale spec hash: manifest=${entry.specFileSha256}, actual=${actualSpecHash}`);
  }
  const actualReferenceHash = sha256File(referencePath);
  if (actualReferenceHash !== entry.referenceFileSha256) {
    issues.push(`stale reference hash: manifest=${entry.referenceFileSha256}, actual=${actualReferenceHash}`);
  }
  if (issues.length > 0) {
    return caseResult(entry, candidatePath, issues, warnings);
  }

  let referenceProfile;
  try {
    referenceProfile = buildSemanticProfile(referencePath);
  } catch (error) {
    issues.push(...errorMessages('reference semantic profile failed', error));
    return caseResult(entry, candidatePath, issues, warnings);
  }

  const actualSemanticHash = semanticProfileSha256(referenceProfile);
  if (actualSemanticHash !== entry.referenceSemanticSha256) {
    issues.push(
      `stale reference semantic hash: manifest=${entry.referenceSemanticSha256}, actual=${actualSemanticHash}`
    );
  }
  issues.push(...expectedMetricIssues(entry.expectedMetrics, referenceProfile));
  if (issues.length > 0) {
    return caseResult(entry, candidatePath, issues, warnings, referenceProfile);
  }

  const reviewSpecPath = path.relative(packageRoot, specPath).split(path.sep).join('/');
  const referenceReview = inDirectory(packageRoot, () =>
    reviewGeneratedTest({ specPath: reviewSpecPath, testPath: referencePath, mode: entry.mode })
  );
  warnings.push(...referenceReview.warnings.map((warning) => `reference reviewer: ${warning}`));
  if (!referenceReview.passed) {
    issues.push(...referenceReview.issues.map((issue) => `reference reviewer failed: ${issue}`));
    return caseResult(entry, candidatePath, issues, warnings, referenceProfile);
  }

  let candidateProfile;
  if (candidateDir) {
    const candidateReview = inDirectory(packageRoot, () =>
      reviewGeneratedTest({ specPath: reviewSpecPath, testPath: candidatePath, mode: entry.mode })
    );
    warnings.push(...candidateReview.warnings.map((warning) => `candidate reviewer: ${warning}`));
    if (!candidateReview.passed) {
      issues.push(...candidateReview.issues.map((issue) => `candidate reviewer failed: ${issue}`));
      return caseResult(entry, candidatePath, issues, warnings, referenceProfile);
    }

    try {
      candidateProfile = buildSemanticProfile(candidatePath);
    } catch (error) {
      issues.push(...errorMessages('candidate semantic profile failed', error));
      return caseResult(entry, candidatePath, issues, warnings, referenceProfile);
    }

    const comparison = compareSemanticProfiles(referenceProfile, candidateProfile);
    for (const difference of comparison.differences) {
      issues.push(
        `candidate/reference semantic divergence in ${difference.field}: reference=${JSON.stringify(difference.reference)}, candidate=${JSON.stringify(difference.candidate)}`
      );
    }
  } else {
    candidateProfile = referenceProfile;
  }

  return caseResult(entry, candidatePath, issues, warnings, referenceProfile, candidateProfile);
}

function caseResult(entry, candidatePath, issues, warnings, referenceProfile, candidateProfile) {
  return {
    id: entry.id,
    mode: entry.mode,
    passed: issues.length === 0,
    candidatePath,
    semanticSha256: referenceProfile ? semanticProfileSha256(referenceProfile) : undefined,
    metrics: referenceProfile ? profileMetrics(referenceProfile) : undefined,
    candidateMetrics: candidateProfile ? profileMetrics(candidateProfile) : undefined,
    issues,
    warnings
  };
}

function validateExpectedMetrics(metrics, label) {
  const issues = [];
  if (!isPlainObject(metrics)) {
    return [`${label} must be a JSON object.`];
  }
  for (const field of Object.keys(metrics)) {
    if (!METRIC_FIELDS.has(field)) {
      issues.push(`${label} contains unsupported field "${field}".`);
    }
  }
  for (const field of METRIC_FIELDS) {
    if (!(field in metrics)) {
      issues.push(`${label} is missing required field "${field}".`);
    }
  }
  for (const field of ['testCount', 'stepCount', 'assertionCount']) {
    if (!Number.isInteger(metrics[field]) || metrics[field] < 0) {
      issues.push(`${label}.${field} must be a non-negative integer.`);
    }
  }
  for (const field of ['acIds', 'negativeCaseIds', 'dataCaseIds']) {
    const values = metrics[field];
    if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
      issues.push(`${label}.${field} must be an array of strings.`);
      continue;
    }
    const normalized = [...new Set(values)].sort();
    if (JSON.stringify(values) !== JSON.stringify(normalized)) {
      issues.push(`${label}.${field} must be sorted and contain no duplicates.`);
    }
  }
  return issues;
}

function expectedMetricIssues(expected, profile) {
  const actual = profileMetrics(profile);
  const issues = [];
  for (const field of METRIC_FIELDS) {
    if (JSON.stringify(expected[field]) !== JSON.stringify(actual[field])) {
      issues.push(
        `reference metric ${field} is stale: manifest=${JSON.stringify(expected[field])}, actual=${JSON.stringify(actual[field])}`
      );
    }
  }
  return issues;
}

function profileMetrics(profile) {
  return {
    testCount: profile.testCount,
    stepCount: profile.stepCount,
    assertionCount: profile.assertionCount,
    acIds: profile.coverage.acIds,
    negativeCaseIds: profile.coverage.negativeCaseIds,
    dataCaseIds: profile.coverage.dataCaseIds
  };
}

function resolveContainedPath(baseDir, relativePath) {
  const resolved = path.resolve(baseDir, relativePath);
  const relative = path.relative(path.resolve(baseDir), resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new GoldenEvalError(`Path escapes its configured base directory: ${relativePath}`);
  }
  return resolved;
}

function inspectContainedRegularFile(baseDir, relativePath, label) {
  let resolved;
  try {
    resolved = resolveContainedPath(baseDir, relativePath);
  } catch (error) {
    return { path: path.resolve(baseDir, String(relativePath ?? '')), issues: [error.message] };
  }

  const relative = path.relative(path.resolve(baseDir), resolved);
  const segments = relative.split(path.sep).filter(Boolean);
  let current = path.resolve(baseDir);
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { path: resolved, issues: [`${label} file does not exist: ${resolved}`] };
      }
      return { path: resolved, issues: [`${label} path cannot be inspected: ${current} (${error.message})`] };
    }

    if (stat.isSymbolicLink()) {
      return { path: resolved, issues: [`${label} path must not contain symbolic links: ${current}`] };
    }
    const final = index === segments.length - 1;
    if (!final && !stat.isDirectory()) {
      return { path: resolved, issues: [`${label} path component is not a directory: ${current}`] };
    }
    if (final && !stat.isFile()) {
      return { path: resolved, issues: [`${label} path is not a regular file: ${current}`] };
    }
  }

  if (segments.length === 0) {
    return { path: resolved, issues: [`${label} path is not a regular file: ${resolved}`] };
  }
  return { path: resolved, issues: [] };
}

function isSafeRelativePath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value === '.' ||
    value.includes('\0') ||
    path.isAbsolute(value) ||
    value.includes('\\')
  ) {
    return false;
  }
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== '..' && !normalized.startsWith('../');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function failureResult(error) {
  return {
    passed: false,
    issues: errorMessages(error.message ?? 'Golden evaluation failed', error),
    cases: []
  };
}

function errorMessages(prefix, error) {
  const details = error instanceof GoldenEvalError ? error.details : [];
  return [prefix, ...details.map((detail) => `- ${detail}`)];
}

function inDirectory(directory, callback) {
  const previous = process.cwd();
  process.chdir(directory);
  try {
    return callback();
  } finally {
    process.chdir(previous);
  }
}

function walk(node, visit) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function calledName(expression) {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return '';
}

function calledPath(expression) {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const parent = calledPath(expression.expression);
    return parent ? `${parent}.${expression.name.text}` : expression.name.text;
  }
  if (ts.isCallExpression(expression)) {
    return calledPath(expression.expression);
  }
  return '';
}

function expectationMatcher(call) {
  if (!ts.isPropertyAccessExpression(call.expression)) {
    return undefined;
  }
  const receiver = call.expression.expression;
  if (!ts.isCallExpression(receiver)) {
    return undefined;
  }
  const receiverPath = calledPath(receiver.expression);
  return receiverPath === 'expect' || receiverPath === 'expect.soft' || receiverPath === 'expect.poll'
    ? call.expression.name.text
    : undefined;
}

function extractTags(node, sourceFile) {
  if (!node || !ts.isObjectLiteralExpression(node)) {
    return [];
  }
  const initializer = propertyInitializer(node, 'tag');
  if (!initializer) {
    return [];
  }
  const values = ts.isArrayLiteralExpression(initializer) ? initializer.elements : [initializer];
  return values.map((value) => requiredStaticText(value, 'test tag', sourceFile));
}

function propertyInitializer(object, name) {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }
    const propertyName = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined;
    if (propertyName === name) {
      return property.initializer;
    }
  }
  return undefined;
}

function canonicalNode(node, sourceFile) {
  if (isStaticTextNode(node)) {
    return JSON.stringify(staticText(node));
  }
  if (ts.isNumericLiteral(node)) {
    return String(Number(node.text));
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return 'true';
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return 'false';
  }
  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return 'null';
  }
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  if (ts.isRegularExpressionLiteral(node)) {
    return node.text;
  }
  if (ts.isArrayLiteralExpression(node)) {
    return `[${node.elements.map((element) => canonicalNode(element, sourceFile)).join(',')}]`;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const properties = node.properties.map((property) => {
      if (ts.isPropertyAssignment(property)) {
        const name = property.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
        return `${JSON.stringify(name)}:${canonicalNode(property.initializer, sourceFile)}`;
      }
      return normalizeFallback(property.getText(sourceFile));
    });
    return `{${properties.sort().join(',')}}`;
  }
  if (ts.isPropertyAccessExpression(node)) {
    return `${canonicalNode(node.expression, sourceFile)}.${node.name.text}`;
  }
  return normalizeFallback(node.getText(sourceFile));
}

function normalizeFallback(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

function isStaticTextNode(node) {
  return Boolean(node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)));
}

function staticText(node) {
  return node.text;
}

function requiredStaticText(node, label, sourceFile) {
  if (!isStaticTextNode(node)) {
    throw new GoldenEvalError(`${label} must be a static string for deterministic golden evaluation: ${node?.getText(sourceFile) ?? '(missing)'}`);
  }
  return staticText(node);
}

function collectCoverageIds(value, coverage) {
  for (const match of value.matchAll(/\bAC-\d{3}\b/g)) {
    coverage.acIds.add(match[0]);
  }
  for (const match of value.matchAll(/\bNEG-\d{3}\b/g)) {
    coverage.negativeCaseIds.add(match[0]);
  }
  for (const match of value.matchAll(/\bDC-\d{3}\b/g)) {
    coverage.dataCaseIds.add(match[0]);
  }
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sumMap(map) {
  return [...map.values()].reduce((total, value) => total + value, 0);
}

function sortedRecord(map) {
  return Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/evals/golden-eval.mjs [--manifest <cases.json>] [--candidate-dir <directory>] [--json]

Runs deterministic offline golden evaluation. With no candidate directory, committed reference tests
are reviewed and checked against their pinned hashes and metrics. This command never invokes a model.`);
}

function parseCliArgs(args) {
  const parsed = { manifestPath: DEFAULT_GOLDEN_MANIFEST, candidateDir: undefined, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--manifest') {
      if (!args[index + 1]) {
        throw new GoldenEvalError('--manifest requires a path.');
      }
      parsed.manifestPath = args[index + 1];
      index += 1;
    } else if (arg === '--candidate-dir') {
      if (!args[index + 1]) {
        throw new GoldenEvalError('--candidate-dir requires a directory.');
      }
      parsed.candidateDir = args[index + 1];
      index += 1;
    } else if (arg === '--json') {
      parsed.json = true;
    } else {
      throw new GoldenEvalError(`Unexpected argument: ${arg}`);
    }
  }
  return parsed;
}

function runCli() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    printHelp();
    process.exit(1);
  }

  const result = evaluateGoldenCases(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.passed) {
    console.log(`Golden evaluation passed (${result.cases.length} deterministic offline case(s)).`);
    for (const entry of result.cases) {
      console.log(
        `- ${entry.id} [${entry.mode}]: tests=${entry.metrics.testCount}, steps=${entry.metrics.stepCount}, assertions=${entry.metrics.assertionCount}, semantic=${entry.semanticSha256}`
      );
    }
  } else {
    console.error('Golden evaluation failed:');
    for (const issue of result.issues) {
      console.error(`- ${issue}`);
    }
  }

  if (!result.passed) {
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli();
}
