#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import { normalizeRecordingFile, slugify } from './lib/recording-parser.mjs';

function parseArgs(args) {
  const parsed = {
    recordingPath: undefined,
    target: undefined
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--target') {
      parsed.target = args[index + 1];
      index += 1;
      continue;
    }

    if (!parsed.recordingPath) {
      parsed.recordingPath = arg;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return parsed;
}

function createTaskContent({ normalized, targetTestFile }) {
  const requiredSteps = normalized.steps
    .map((step) => {
      const assertion = step.assertionId ? `, assertion ${step.assertionId}` : '';
      return `- ${step.id}${assertion}: ${step.action}`;
    })
    .join('\n');

  const assertions = normalized.assertions.length
    ? normalized.assertions.map((assertion) => `- ${assertion.id}: ${assertion.expected}`).join('\n')
    : '- none';

  const ignoredSteps = normalized.ignoredSteps.length
    ? normalized.ignoredSteps.map((step) => `- Source step ${step.sourceIndex} ${step.type}: ${step.reason}`).join('\n')
    : '- none';

  return `# Codex Recording Generation Task: ${normalized.title}

## Target

- Recording path: \`${normalized.recordingPath}\`
- Recording title: \`${normalized.title}\`
- Target test file: \`${targetTestFile}\`
- Recording hash: \`sha256:${normalized.sha256}\`
- Input authority: Chrome DevTools Recorder JSON

## Contract

The Chrome DevTools Recorder JSON is the authoritative input.
The normalized recording contract maps Recorder steps to deterministic Playwright Test code.
The gate is the acceptance check.

## Required Recording Steps

${requiredSteps}

## Required Assertions

${assertions}

## Ignored Non-Behavioral Recorder Steps

${ignoredSteps}

## Required Test Style

- Add this exact header near the top of the test:

\`\`\`ts
/* recording: ${normalized.recordingPath} title:${normalized.title} sha256:${normalized.sha256} */
\`\`\`

- Import \`test\` and \`expect\` from \`fixtures/test\`.
- Use Playwright Test, not Puppeteer or raw Recorder replay.
- Use \`test.step\` titles that include each required \`RSTEP-###\`.
- For assertion steps, include the matching \`ASSERT-###\` in the step title and add a meaningful \`expect(...)\`.
- Use \`baseURL\`-relative navigation paths from \`urlForTest\` where available.
- Translate Recorder selectors to Playwright locators using priority order: stable meaningful \`data-testid\`, role/name, label, placeholder, stable visible text, then raw CSS fallback.
- Use raw CSS only with \`// locator-policy:exception <reason>\` immediately before the fallback.
- Keep typed values deterministic and fake; replace credentials or tokens with environment-backed fixtures before recording.
- Do not commit auth state, cookies, storage state, traces, screenshots, videos, HAR files, or secrets.

## Forbidden Patterns

- Generating tests without this validated recording.
- Blindly replaying the JSON with Puppeteer.
- XPath.
- \`:nth-child\` selector chains.
- \`page.waitForTimeout\`.
- \`waitForLoadState('networkidle')\`.
- \`test.only\`, \`describe.only\`, or \`it.only\`.
- Real credentials, OTPs, bearer tokens, cookies, session IDs, or storage-state literals.

## Normalized Recording Contract

\`\`\`json
${JSON.stringify(normalized, null, 2)}
\`\`\`

## Commands To Run

\`\`\`bash
npm run ai:recording:review -- --recording ${normalized.recordingPath} --test ${targetTestFile}
npm run ai:recording:gate -- --recording ${normalized.recordingPath} --test ${targetTestFile}
npm run ai:recording:drift
\`\`\`
`;
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/create-recording-generation-task.mjs <recording.json> [--target tests/recorded/name.spec.ts]

Creates a deterministic generation task from a validated Chrome DevTools Recorder JSON file.`);
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

  if (!args.recordingPath) {
    printHelp();
    process.exit(1);
  }

  let normalized;
  try {
    normalized = normalizeRecordingFile(args.recordingPath);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const targetTestFile = args.target ?? normalized.targetTestFile;
  const createdAt = new Date().toISOString();
  const timestamp = createdAt.replace(/[:.]/g, '-');
  const runDir = path.join('.ai-runs', `${timestamp}-${slugify(normalized.title)}`);
  const taskPath = path.join(runDir, 'generation-task.md');
  const normalizedPath = path.join(runDir, 'normalized-recording.json');
  const manifestPath = path.join(runDir, 'manifest.json');

  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(taskPath, createTaskContent({ normalized, targetTestFile }));
  fs.writeFileSync(normalizedPath, `${JSON.stringify(normalized, null, 2)}\n`);
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        createdAt,
        recordingPath: normalized.recordingPath,
        recordingTitle: normalized.title,
        recordingSha256: normalized.sha256,
        targetTestFile,
        taskPath,
        normalizedPath
      },
      null,
      2
    )}\n`
  );

  console.log(`Recording generation task created: ${taskPath}`);
  console.log(`Target test file: ${targetTestFile}`);
  console.log(`Recording hash: sha256:${normalized.sha256}`);
}

runCli();
