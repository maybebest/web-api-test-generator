#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { specSha256 } from './lib/spec-parser.mjs';
import { hasForbiddenAgentRef, hasForbiddenLocatorPattern } from './lib/selector-policy.mjs';
import { readBoundedDirectoryEntries, readVerifiedFile, verifiedDirectory } from './lib/verified-file-read.mjs';

const MAX_DOM_ARTIFACT_BYTES = 4 * 1024 * 1024;
export const MAX_DOM_DISCOVERY_ENTRIES = 2_048;

function resolvedSpecIdentity(rootDir, candidate) {
  return path.isAbsolute(String(candidate ?? ''))
    ? path.resolve(String(candidate))
    : path.resolve(rootDir, String(candidate ?? ''));
}

export function reviewDomDiscoveryArtifact(artifactPath, {
  rootDir = artifactPath ? path.dirname(path.resolve(artifactPath)) : process.cwd(),
  expectedSpecPath,
  expectedSpecSha256
} = {}) {
  const issues = [];
  const warnings = [];

  if (!artifactPath) {
    return { passed: false, issues: ['Missing discovery artifact path.'], warnings };
  }

  if (!fs.existsSync(artifactPath)) {
    return { passed: false, issues: [`Discovery artifact does not exist: ${artifactPath}`], warnings };
  }

  let artifact;
  try {
    artifact = JSON.parse(readVerifiedFile({
      filePath: artifactPath,
      rootPath: rootDir,
      maxBytes: MAX_DOM_ARTIFACT_BYTES,
      label: 'DOM discovery artifact review source'
    }).content);
  } catch (error) {
    return { passed: false, issues: [`Discovery artifact is not valid JSON: ${error.message}`], warnings };
  }

  return reviewDomDiscoveryArtifactObject(artifact, {
    rootDir,
    expectedSpecPath,
    expectedSpecSha256
  });
}

export function reviewDomDiscoveryArtifactObject(artifact, {
  rootDir = process.cwd(),
  expectedSpecPath,
  expectedSpecSha256
} = {}) {
  const issues = [];
  const warnings = [];

  if (artifact === null || typeof artifact !== 'object' || Array.isArray(artifact)) {
    return { passed: false, issues: ['Discovery artifact must be a JSON object.'], warnings };
  }

  if (artifact.source !== 'agent-browser') {
    issues.push('Discovery artifact source must be "agent-browser".');
  }

  if (expectedSpecPath !== undefined || expectedSpecSha256 !== undefined) {
    const artifactSpec = typeof artifact.specPath === 'string' && artifact.specPath.trim()
      ? resolvedSpecIdentity(rootDir, artifact.specPath)
      : null;
    if (artifactSpec !== resolvedSpecIdentity(rootDir, expectedSpecPath) || artifact.specSha256 !== expectedSpecSha256) {
      issues.push('Discovery artifact spec identity or behavioral hash does not match the requested generation spec.');
    }
  } else if (!artifact.specPath || !fs.existsSync(artifact.specPath)) {
    issues.push(`Discovery artifact references a missing specPath: ${artifact.specPath ?? '(blank)'}`);
  } else if (artifact.specSha256 && artifact.specSha256 !== specSha256(artifact.specPath)) {
    issues.push(`Discovery artifact spec hash is stale for ${artifact.specPath}. Re-run ai:dom:discover.`);
  }

  if (artifact.selectorOwnership !== 'framework') {
    issues.push('Discovery artifact must declare selectorOwnership: "framework".');
  }
  if (
    artifact.locatorAudit?.method !== 'playwright-locator-count' ||
    artifact.locatorAudit?.snapshotDiagnostics !== 'accessibility-snapshot-candidate-equivalence' ||
    artifact.locatorAudit?.requiredMatchCount !== 1
  ) {
    issues.push('Discovery artifact must include the live Playwright locator.count() audit with requiredMatchCount: 1.');
  }

  if (!Array.isArray(artifact.elements)) {
    issues.push('Discovery artifact must contain an elements array.');
  } else {
    artifact.elements.forEach((element, index) => {
      const context = `elements[${index}]`;
      if (!element.elementId) {
        issues.push(`${context} is missing elementId.`);
      }

      const serializedElement = JSON.stringify(element);
      if (hasForbiddenAgentRef(serializedElement)) {
        issues.push(`${context} contains an agent-browser @e ref. Refs are session-only evidence and must not be persisted.`);
      }

      if (!Array.isArray(element.candidateLocators) || element.candidateLocators.length === 0) {
        warnings.push(`${context} has no selector candidates; generation should not invent a selector from this element.`);
        return;
      }

      for (const [candidateIndex, candidate] of element.candidateLocators.entries()) {
        const candidateContext = `${context}.candidateLocators[${candidateIndex}]`;
        const locator = String(candidate.locator ?? '');
        if (hasForbiddenAgentRef(locator)) {
          issues.push(`${context} candidate contains an agent-browser ref: ${locator}`);
        }
        if (hasForbiddenLocatorPattern(locator)) {
          issues.push(`${context} candidate contains a forbidden locator pattern: ${locator}`);
        }
        if (!Number.isInteger(candidate.matchCount) || candidate.matchCount < 0) {
          issues.push(`${candidateContext} is missing a valid snapshot matchCount.`);
          continue;
        }
        if (candidate.matchEvidence !== 'playwright-live') {
          issues.push(`${candidateContext} must declare matchEvidence: "playwright-live".`);
        }
        if (!Number.isInteger(candidate.snapshotMatchCount) || candidate.snapshotMatchCount < 0) {
          issues.push(`${candidateContext} is missing its diagnostic snapshotMatchCount.`);
        } else if (candidate.snapshotUnique !== (candidate.snapshotMatchCount === 1)) {
          issues.push(`${candidateContext} has inconsistent snapshotUnique/snapshotMatchCount evidence.`);
        }
        if (candidate.unique !== (candidate.matchCount === 1)) {
          issues.push(`${candidateContext} has inconsistent unique/matchCount evidence.`);
        }

        const isPreferred = candidateIndex === 0;
        if (candidate.preferred !== isPreferred) {
          issues.push(`${candidateContext} has an invalid preferred flag; only the highest-scored candidate may be preferred.`);
        }
        if (isPreferred && candidate.matchCount !== 1) {
          issues.push(
            `${candidateContext} preferred locator is not unique (matchCount=${candidate.matchCount}): ${locator}`
          );
        } else if (!isPreferred && candidate.matchCount !== 1) {
          warnings.push(`${candidateContext} is non-unique and must not be selected: ${locator}`);
        }
      }
    });
  }

  return { passed: issues.length === 0, issues, warnings };
}

function parseArgs(args) {
  const parsed = {
    artifact: undefined,
    spec: undefined
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--artifact') {
      parsed.artifact = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--spec') {
      parsed.spec = args[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return parsed;
}

export function findLatestDomDiscoveryArtifactForReview(specPath, rootDir = process.cwd()) {
  const root = path.join(rootDir, '.ai-runs', 'dom-discovery');
  if (!fs.existsSync(root)) {
    return undefined;
  }
  verifiedDirectory(root, 'DOM discovery root');

  const expectedHash = specSha256(specPath);
  const expectedSpec = resolvedSpecIdentity(rootDir, specPath);
  const candidates = [];
  const entries = readBoundedDirectoryEntries({
    directory: root,
    maxEntries: MAX_DOM_DISCOVERY_ENTRIES,
    label: 'DOM discovery review scan'
  });
  for (const dirent of entries) {
    if (dirent.isSymbolicLink() || !dirent.isDirectory()) {
      continue;
    }
    const artifactPath = path.join(root, dirent.name, 'selector-candidates.json');
    if (!fs.existsSync(artifactPath)) {
      continue;
    }
    try {
      const read = readVerifiedFile({
        filePath: artifactPath,
        rootPath: root,
        maxBytes: MAX_DOM_ARTIFACT_BYTES,
        label: 'DOM discovery candidate'
      });
      const artifact = JSON.parse(read.content);
      if (resolvedSpecIdentity(rootDir, artifact.specPath) === expectedSpec && artifact.specSha256 === expectedHash) {
        candidates.push({ artifactPath, mtimeMs: read.mtimeMs });
      }
    } catch {
      // Ignore malformed candidates here; direct review will report the JSON issue.
    }
  }

  return candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.artifactPath;
}

function runCli() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    printHelp();
    process.exit(1);
  }

  const artifactPath = args.artifact ?? (args.spec ? findLatestDomDiscoveryArtifactForReview(args.spec) : undefined);
  const result = reviewDomDiscoveryArtifact(artifactPath);

  if (!result.passed) {
    console.error(`DOM discovery review failed: ${artifactPath ?? '(none)'}`);
    for (const issue of result.issues) {
      console.error(`- ${issue}`);
    }
  } else {
    console.log(`DOM discovery review passed: ${artifactPath}`);
  }

  if (result.warnings.length > 0) {
    console.warn('Warnings:');
    for (const warning of result.warnings) {
      console.warn(`- ${warning}`);
    }
  }

  if (!result.passed) {
    process.exit(1);
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/review-dom-discovery.mjs --artifact <selector-candidates.json>
  node scripts/ai/review-dom-discovery.mjs --spec <spec-path>

Reviews a DOM discovery artifact and rejects agent-browser refs, forbidden locator patterns, and
preferred candidates whose live Playwright locator.count() result is not exactly one.`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli();
}
