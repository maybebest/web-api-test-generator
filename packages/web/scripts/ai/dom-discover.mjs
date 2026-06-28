#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import { specSha256 } from './lib/spec-parser.mjs';
import { runAgentBrowser, parseJsonOutput } from './lib/agent-browser-runner.mjs';
import { createDiscoveryElement } from './lib/selector-policy.mjs';
import { validateSpecFile } from './validate-flow-spec.mjs';

function parseArgs(args) {
  const parsed = {
    spec: undefined,
    url: undefined,
    out: undefined,
    screenshot: false,
    session: undefined
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--spec') {
      parsed.spec = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--url') {
      parsed.url = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--out') {
      parsed.out = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--session') {
      parsed.session = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--screenshot') {
      parsed.screenshot = true;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return parsed;
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

  if (!args.spec) {
    printHelp();
    process.exit(1);
  }

  const validation = validateSpecFile(args.spec);
  if (!validation.valid) {
    console.error(`Cannot run DOM discovery because spec validation failed: ${args.spec}`);
    for (const issue of validation.issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  const specPath = normalizePath(args.spec);
  const url = args.url ?? inferUrl(validation.metadata['Base Path']);
  const flowId = validation.metadata['Flow ID'];
  const createdAt = new Date().toISOString();
  const runDir = args.out
    ? path.dirname(args.out)
    : path.join('.ai-runs', 'dom-discovery', `${createdAt.replace(/[:.]/g, '-')}-${slugify(flowId)}`);
  const artifactPath = args.out ?? path.join(runDir, 'selector-candidates.json');
  const session = args.session ?? `dom-${slugify(flowId)}-${Date.now()}`;
  const screenshotPath = args.screenshot ? path.join(runDir, 'page.png') : undefined;

  fs.mkdirSync(runDir, { recursive: true });

  try {
    runOrExit(['--session', session, 'open', url], 'agent-browser open failed');
    const snapshotResult = runOrExit(
      ['--session', session, 'snapshot', '-i', '--json'],
      'agent-browser snapshot failed',
      true
    );
    const snapshot = parseJsonOutput(snapshotResult.stdout);
    const rawElements = collectSnapshotElements(snapshot);
    const elements = rawElements.map((element, index) => createDiscoveryElement(element, index));

    if (screenshotPath) {
      runOrExit(['--session', session, 'screenshot', screenshotPath], 'agent-browser screenshot failed');
    }

    const artifact = {
      specPath,
      specSha256: specSha256(specPath),
      flowId,
      specVersion: validation.metadata['Spec Version'],
      url,
      capturedAt: createdAt,
      source: 'agent-browser',
      sourceCommands: ['agent-browser open <url>', 'agent-browser snapshot -i --json'],
      selectorOwnership: 'framework',
      screenshotPath: screenshotPath ? normalizePath(screenshotPath) : undefined,
      elements
    };

    fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(`DOM discovery artifact written: ${artifactPath}`);
    console.log(`Elements captured: ${elements.length}`);
    console.log('Review with:');
    console.log(`npm run ai:dom:discover:review -- --artifact ${artifactPath}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    runAgentBrowser(['--session', session, 'close']);
  }
}

function runOrExit(args, label, capture = false) {
  const result = runAgentBrowser(args, { stdio: capture ? 'pipe' : 'inherit' });
  if (result.status !== 0) {
    if (capture) {
      console.error(result.stderr || result.stdout);
    }
    throw new Error(label);
  }
  return result;
}

function inferUrl(basePath) {
  const baseUrl = process.env.PLAYWRIGHT_TEST_BASE_URL;
  if (!baseUrl) {
    throw new Error('Pass --url or set PLAYWRIGHT_TEST_BASE_URL so DOM discovery can resolve the spec Base Path.');
  }

  return new URL(basePath || '/', baseUrl).toString();
}

function collectSnapshotElements(snapshot) {
  const root = snapshot?.data ?? snapshot;
  const elements = [];
  visitSnapshotNode(root, elements);
  return dedupeElements(elements);
}

function visitSnapshotNode(node, elements) {
  if (Array.isArray(node)) {
    for (const entry of node) {
      visitSnapshotNode(entry, elements);
    }
    return;
  }

  if (!node || typeof node !== 'object') {
    return;
  }

  const attributes = collectAttributes(node);
  const role = firstString(node.role, node.type, node.tagName);
  const accessibleName = firstString(node.accessibleName, node.name, node.title);
  const text = firstString(node.text, node.value, node.description);
  const hasElementSignal = Boolean(
    role ||
      accessibleName ||
      text ||
      attributes.placeholder ||
      attributes['aria-label'] ||
      attributes['data-testid'] ||
      attributes.href
  );

  if (hasElementSignal) {
    elements.push({
      role,
      accessibleName,
      label: firstString(node.label, attributes['aria-label']),
      placeholder: firstString(node.placeholder, attributes.placeholder),
      text,
      href: firstString(node.href, attributes.href),
      testId: firstString(node.testId, attributes['data-testid'], attributes['data-test-id']),
      attributes
    });
  }

  for (const [key, value] of Object.entries(node)) {
    if (['parent', 'ownerDocument'].includes(key)) {
      continue;
    }
    if (value && typeof value === 'object') {
      visitSnapshotNode(value, elements);
    }
  }
}

function collectAttributes(node) {
  const attributes = {};
  const sourceAttributes = node.attributes ?? node.attrs ?? {};

  if (sourceAttributes && typeof sourceAttributes === 'object' && !Array.isArray(sourceAttributes)) {
    for (const [key, value] of Object.entries(sourceAttributes)) {
      if (value !== undefined && value !== null && !/^ref$/i.test(key)) {
        attributes[key] = String(value);
      }
    }
  }

  for (const key of ['placeholder', 'href', 'aria-label', 'aria-disabled', 'data-testid', 'data-test-id']) {
    const value = node[key] ?? node[camelCaseAttribute(key)];
    if (value !== undefined && value !== null) {
      attributes[key] = String(value);
    }
  }

  return attributes;
}

function dedupeElements(elements) {
  const seen = new Set();
  return elements.filter((element) => {
    const key = JSON.stringify([
      element.role,
      element.accessibleName,
      element.label,
      element.placeholder,
      element.text,
      element.href,
      element.testId
    ]);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function firstString(...values) {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }

    const text = String(value).replace(/\s+/g, ' ').trim();
    if (text) {
      return text;
    }
  }

  return undefined;
}

function camelCaseAttribute(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function slugify(value) {
  return String(value ?? 'flow')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'flow';
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/dom-discover.mjs --spec <spec-path> [--url <url>] [--out <artifact>] [--screenshot]

Runs agent-browser before test generation, captures an accessibility snapshot, and writes a
selector-candidate artifact. The artifact is evidence only; generated tests must use the
framework selector policy and must never copy agent-browser @e refs.`);
}

runCli();
