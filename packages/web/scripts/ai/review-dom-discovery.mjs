#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { specSha256 } from './lib/spec-parser.mjs';
import { hasForbiddenAgentRef, hasForbiddenLocatorPattern } from './lib/selector-policy.mjs';

export function reviewDomDiscoveryArtifact(artifactPath) {
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
    artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  } catch (error) {
    return { passed: false, issues: [`Discovery artifact is not valid JSON: ${error.message}`], warnings };
  }

  if (artifact.source !== 'agent-browser') {
    issues.push('Discovery artifact source must be "agent-browser".');
  }

  if (!artifact.specPath || !fs.existsSync(artifact.specPath)) {
    issues.push(`Discovery artifact references a missing specPath: ${artifact.specPath ?? '(blank)'}`);
  } else if (artifact.specSha256 && artifact.specSha256 !== specSha256(artifact.specPath)) {
    issues.push(`Discovery artifact spec hash is stale for ${artifact.specPath}. Re-run ai:dom:discover.`);
  }

  if (artifact.selectorOwnership !== 'framework') {
    issues.push('Discovery artifact must declare selectorOwnership: "framework".');
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

      for (const candidate of element.candidateLocators) {
        const locator = String(candidate.locator ?? '');
        if (hasForbiddenAgentRef(locator)) {
          issues.push(`${context} candidate contains an agent-browser ref: ${locator}`);
        }
        if (hasForbiddenLocatorPattern(locator)) {
          issues.push(`${context} candidate contains a forbidden locator pattern: ${locator}`);
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

function latestArtifactForSpec(specPath) {
  const root = path.join('.ai-runs', 'dom-discovery');
  if (!fs.existsSync(root)) {
    return undefined;
  }

  const expectedHash = specSha256(specPath);
  const candidates = [];
  for (const dirent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dirent.isDirectory()) {
      continue;
    }
    const artifactPath = path.join(root, dirent.name, 'selector-candidates.json');
    if (!fs.existsSync(artifactPath)) {
      continue;
    }
    try {
      const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
      if (artifact.specPath === specPath && artifact.specSha256 === expectedHash) {
        candidates.push({ artifactPath, mtimeMs: fs.statSync(artifactPath).mtimeMs });
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

  const artifactPath = args.artifact ?? (args.spec ? latestArtifactForSpec(args.spec) : undefined);
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

Reviews a DOM discovery artifact and rejects agent-browser refs, XPath, nth-child, and raw CSS locator candidates.`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli();
}
