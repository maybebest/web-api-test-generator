#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { listSpecFiles, parseSpecHeader, specSha256 } from './lib/spec-parser.mjs';
import { isPendingGenerationSpec, validateSpecFile } from './validate-flow-spec.mjs';

export function collectGeneratedUiPlan(options = {}) {
  const hasExplicitSpecs = options.specPaths?.length > 0;
  const specPaths = hasExplicitSpecs ? options.specPaths : listSpecFiles(options.specDir ?? 'specs');
  const issues = [];
  const warnings = [];
  const pending = [];
  const seenTests = new Set();
  const entries = [];

  for (const specPath of specPaths) {
    const validation = validateSpecFile(specPath);
    if (!validation.valid) {
      issues.push(`Spec validation failed: ${specPath}\n${validation.issues.map((issue) => `- ${issue}`).join('\n')}`);
      continue;
    }

    if (isPendingGenerationSpec(validation.metadata)) {
      pending.push(`${specPath}: awaiting live generation (Generation Status = pending-generation).`);
      continue;
    }

    const targetTestFile = normalizePath(validation.metadata['Target Test File']);
    if (!targetTestFile) {
      issues.push(`${specPath}: missing Target Test File metadata.`);
      continue;
    }

    if (seenTests.has(targetTestFile)) {
      continue;
    }

    if (!fs.existsSync(path.resolve(targetTestFile))) {
      const message = `${specPath}: target generated test does not exist: ${targetTestFile}`;
      if (hasExplicitSpecs) {
        issues.push(message);
      } else {
        warnings.push(message);
      }
      continue;
    }

    const headerIssue = verifySpecHeader({
      specPath,
      specVersion: validation.metadata['Spec Version'],
      testPath: targetTestFile
    });
    if (headerIssue) {
      issues.push(headerIssue);
      continue;
    }

    seenTests.add(targetTestFile);
    entries.push({
      specPath,
      flowId: validation.metadata['Flow ID'],
      testPath: targetTestFile
    });
  }

  const playwrightArgs = ['playwright', 'test', '--ui'];
  if (options.project) {
    playwrightArgs.push(`--project=${options.project}`);
  }
  playwrightArgs.push(...entries.map((entry) => entry.testPath));

  return {
    entries,
    issues,
    warnings,
    pending,
    command: 'npx',
    args: playwrightArgs
  };
}

function verifySpecHeader({ specPath, specVersion, testPath }) {
  const content = fs.readFileSync(path.resolve(testPath), 'utf8');
  const header = parseSpecHeader(content);

  if (!header) {
    return `${testPath}: missing generated spec header. Expected /* spec: ${specPath} version:${specVersion} sha256:<hex> */.`;
  }

  if (normalizePath(header.specPath) !== normalizePath(specPath)) {
    return `${testPath}: generated spec header references ${header.specPath}, expected ${specPath}.`;
  }

  if (header.specVersion !== specVersion) {
    return `${testPath}: generated spec header version ${header.specVersion}, expected ${specVersion}.`;
  }

  const expectedHash = specSha256(specPath);
  if (header.sha256 !== expectedHash) {
    return `${testPath}: generated spec header hash is stale for ${specPath}. expected ${expectedHash}, actual ${header.sha256}.`;
  }

  return undefined;
}

function parseArgs(args) {
  const parsed = {
    specDir: 'specs',
    specPaths: [],
    project: undefined,
    dryRun: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--dir') {
      parsed.specDir = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--spec') {
      parsed.specPaths.push(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg === '--project') {
      parsed.project = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!parsed.specDir) {
    throw new Error('--dir requires a value.');
  }

  if (parsed.specPaths.some((specPath) => !specPath)) {
    throw new Error('--spec requires a value.');
  }

  if (parsed.project !== undefined && !parsed.project) {
    throw new Error('--project requires a value.');
  }

  return parsed;
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}

function normalizePath(value) {
  return String(value ?? '').split(path.sep).join('/');
}

function printPlan(plan, dryRun) {
  if (plan.warnings.length > 0) {
    console.warn('Skipped specs without generated tests:');
    for (const warning of plan.warnings) {
      console.warn(`- ${warning}`);
    }
    console.warn('');
  }

  if (plan.pending?.length > 0) {
    console.warn('Skipped specs awaiting live generation:');
    for (const note of plan.pending) {
      console.warn(`- ${note}`);
    }
    console.warn('');
  }

  console.log('Generated/spec-bound tests selected for Playwright UI mode:');
  for (const entry of plan.entries) {
    console.log(`- ${entry.testPath} (${entry.flowId}, ${entry.specPath})`);
  }
  console.log('');
  console.log(`Command: ${[plan.command, ...plan.args].map(shellQuote).join(' ')}`);

  if (dryRun) {
    console.log('');
    console.log('Dry run only. UI mode was not launched.');
  }
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

  const plan = collectGeneratedUiPlan(args);
  if (plan.issues.length > 0) {
    console.error('Cannot open generated tests in Playwright UI mode:');
    for (const issue of plan.issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  if (plan.entries.length === 0) {
    console.error('No generated/spec-bound tests found. Check specs/*.md Target Test File metadata.');
    process.exit(1);
  }

  printPlan(plan, args.dryRun);
  if (args.dryRun) {
    return;
  }

  const result = spawnSync(plan.command, plan.args, {
    stdio: 'inherit',
    shell: false,
    env: process.env
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/run-generated-ui.mjs [--dir specs] [--project <project>] [--dry-run]
  node scripts/ai/run-generated-ui.mjs --spec specs/<flow>.md [--project <project>] [--dry-run]

Opens Playwright UI mode for generated/spec-bound tests only. Test files are discovered
from valid Markdown specs via Target Test File metadata and verified against generated
spec headers. Framework healthcheck tests are not included unless a valid spec targets them.

Examples:
  npm run ai:test:ui:generated
  npm run ai:test:ui:generated -- --dir specs
  npm run ai:test:ui:generated -- --spec specs/<flow>.md
  npm run ai:test:ui:generated -- --project chromium
  npm run ai:test:ui:generated -- --dry-run`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli();
}
