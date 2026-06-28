#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GENERATION_MODES, resolveGenerationMode, specGenerationMode, specSha256 } from './lib/spec-parser.mjs';
import { reviewDomDiscoveryArtifact } from './review-dom-discovery.mjs';
import { validateSpecFile } from './validate-flow-spec.mjs';

export { GENERATION_MODES };

export function parseArgs(args) {
  const result = {
    specPath: undefined,
    target: undefined,
    domArtifact: undefined,
    mode: undefined
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--target') {
      result.target = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--dom-artifact') {
      result.domArtifact = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--mode') {
      result.mode = args[index + 1];
      if (!GENERATION_MODES.has(result.mode)) {
        throw new Error(`Unsupported generation mode: ${result.mode}. Use "single" or "suite".`);
      }
      index += 1;
      continue;
    }

    if (!result.specPath) {
      result.specPath = arg;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return result;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'flow';
}

function generationModeInstructions(generationMode, acIds) {
  if (generationMode === 'suite') {
    return `Suite generation mode was explicitly requested.
Generate multiple focused tests only where needed to cover the full spec.
Split broad flows into focused tests that each verify one clear functionality or business outcome.
Add final assertion-step coverage for every AC ID: ${acIds.map((id) => `\`${id}\``).join(', ')}.
Each generated test still gets one final assertion step only.`;
  }

  return `Default generation mode is single-test mode.
Generate exactly one primary \`test(...)\` block for the requested scenario/business outcome, plus optionally one test per spec Negative Case.
Do not split every AC into separate tests unless suite mode is explicitly requested.
The primary test must declare a \`covered-ac-ids\` annotation (\`test.info().annotations.push({ type: 'covered-ac-ids', description: '${acIds.join(' ')}' })\`).
Every \`test.step\` title in the primary test must name the AC ID(s) it exercises as \`AC-###\` tokens (e.g. \`Arrange AC-001: open auth entry screen\`); the union of step-title AC IDs must equal the annotation set.
Optional NEG tests must contain their \`NEG-###\` ID in the test title and every step title, and end with an \`Assert NEG-###: ...\` step containing at least one meaningful expect.
The final assertion step must name the primary \`AC-###\` or \`NEG-###\` ID.`;
}

export function createTaskContent({ specPath, targetTestFile, validation, domArtifactPath, generationMode = 'single' }) {
  const flowId = validation.metadata['Flow ID'];
  const specVersion = validation.metadata['Spec Version'];
  const specTags = String(validation.metadata.Tags ?? '').split(/\s+/).filter(Boolean);
  const acIds = validation.acceptanceCriteria;
  const sha256 = specSha256(specPath);

  return `# Codex Generation Task: ${flowId}

## Target

- Spec path: \`${specPath}\`
- Target test file: \`${targetTestFile}\`
- Flow ID: \`${flowId}\`
- Spec version: \`${specVersion}\`
- Generation mode: \`${generationMode}\`
- AC IDs to cover: ${acIds.map((id) => `\`${id}\``).join(', ')}
- Spec hash: \`sha256:${sha256}\`
- Spec hash scope: behavioral sections only

## Contract

The Markdown spec is the contract.
The generated Playwright test is the implementation.
The gate is the acceptance check.
Default generation mode is single-test mode.
Generation mode resolved from spec metadata/--mode: \`${generationMode}\`; generate a suite only when the resolved mode is \`suite\`.
Default generated-test execution target is Chromium only.
Cross-browser generated-test execution is opt-in.

## Required Test Style

- Generate or update the target Playwright test.
- Add this exact header comment near the top of the test:

\`\`\`ts
/* spec: ${specPath} version:${specVersion} sha256:${sha256} */
\`\`\`

- Import from \`fixtures/test\`.
- Use \`test.step\`.
- Declare the spec metadata Tags exactly on the describe block or test via the Playwright tag option: \`{ tag: [${specTags.map((tag) => `'${tag}'`).join(', ')}] }\`.
- ${generationModeInstructions(generationMode, acIds).split('\n').join('\n- ')}
- Use setup/action steps for navigation and inputs, then one final assertion step.
- Title final assertion steps \`Assert AC-###: ...\` or \`Assert NEG-###: ...\` and name exactly one AC or negative-case ID.
- Do not put \`expect(...)\` in every \`test.step\`; assertions belong only in the final assertion step for that test.
- Put all locators in Page Objects or Component Objects. Generated test bodies must not call \`page.getByTestId\`, \`page.getByRole\`, \`page.getByLabel\`, \`page.getByPlaceholder\`, \`page.getByText\`, or \`page.locator\` directly.
- Add meaningful \`expect\` assertions for user-visible behavior in final assertion steps.
- Keep the test independently runnable.
- Use \`Data Cases as JSON\` as the machine-readable case contract.
- If the spec has multiple Data Cases or Variants, enumerate them by looping over the case rows (\`for (const dataCase of dataCases) { test(\\\`\${dataCase.caseId} ...\\\`, ...) }\`) so each \`caseId\` defines its own \`test(...)\`; \`@playwright/test\` has no \`.each\`. Include every \`caseId\` in the test titles or data rows.
- Implement declared Business Rules with direct user-visible assertions.
- Use the declared Mocks as JSON contract in the test route/mock setup.

## Locator Policy Summary

- Locator priority order inside Page Objects/Component Objects:
  1. \`this.page.getByTestId(...)\` when a meaningful \`data-testid\` exists and is stable.
  2. \`this.page.getByRole(...)\` with accessible name.
  3. \`this.page.getByLabel(...)\`.
  4. \`this.page.getByPlaceholder(...)\`.
  5. \`this.page.getByText(...)\` only for stable visible copy.
  6. Raw CSS only with \`// locator-policy:exception <reason>\`.
- Use the DOM discovery artifact only as selector evidence, not as the source of truth.
- Do not copy agent-browser refs such as \`@e1\` or \`@e2\` into generated tests.
- The framework selector policy chooses final Playwright locators.
- CSS selectors require \`// locator-policy:exception <reason>\` immediately before the fallback.

## DOM Discovery Evidence

${domArtifactPath
  ? `A pre-generation agent-browser discovery artifact is available at:

- \`${domArtifactPath}\`

Read it before choosing locators. Treat it as evidence from the current UI only. Use its \`candidateLocators\` as framework-scored candidates, but keep the Markdown spec as the behavioral contract.`
  : `No matching DOM discovery artifact was found for this spec hash.

Recommended first step before implementation:

\`\`\`bash
npm run ai:dom:discover -- --spec ${specPath} --url <target-url>
\`\`\`

Then re-run \`npm run ai:generate-test -- ${specPath}\` so this task links the artifact.`}

## Page Object and Reuse Policy

- Use existing fixtures, Page Objects, components, helpers, and data builders before adding new ones.
- Use Page Object Model for generated locator ownership.
- Keep Page Objects simple: constructors should normally receive \`page\` and initialize locators.
- Expose user-level actions and meaningful locators, not vague helpers like \`doFlow()\`.
- Keep scenario-specific assertions in the test's final assertion step, not inside Page Object methods.
- Prefer composition over inheritance. Do not create large generic utility classes or deep inheritance trees.

## Security Policy Summary

- Do not use production credentials.
- Do not log passwords, cookies, bearer tokens, session IDs, or storage state.
- Do not commit auth state, traces, screenshots, or videos containing sensitive data.

## Test Quality Gate Summary

- The generated test must pass \`ai:test:review\`.
- The generated test must pass \`ai:test:gate\`.
- In single-test mode, it must generate exactly one \`test(...)\` block with one primary final verification.
- In suite mode, it must cover every AC ID from the spec.
- Each generated test must verify one business outcome in one final assertion step.
- Generated locators must be owned by Page Objects or Component Objects.
- It must not be TODO-only.
- It must verify a business outcome.
- Declared mock URLs, response values, and non-GET methods must be used by the generated test.
- Expected values from Data Cases as JSON must appear in generated assertions or parameterized rows.

## Exact Implementation Instructions

1. Read the original flow spec below.
2. Generate or update \`${targetTestFile}\`.
3. Import \`test\` and \`expect\` from the shared fixture.
4. Use \`test.step\` for arrange/action/final assertion steps.
5. Create or reuse Page Objects/Component Objects for all locators.
6. Follow generation mode \`${generationMode}\`: single mode produces one focused test, suite mode may produce multiple focused tests.
7. Add meaningful assertions only in final assertion steps.
8. Apply existing POM/reuse patterns where they make the test clearer.
9. Run \`npm run ai:test:review -- --spec ${specPath} --test ${targetTestFile} --mode ${generationMode}\`.
10. Run \`npm run ai:test:gate -- --spec ${specPath} --test ${targetTestFile} --mode ${generationMode}\`.
11. Run the target test and fix only verified issues.

## Forbidden Patterns

- \`page.waitForTimeout\`
- XPath
- \`test.only\`
- \`describe.only\`
- \`it.only\`
- Deleting assertions just to pass
- Real credentials
- Committed storage state
- Ignoring Data Cases, Business Rules, Variants, or Mocks declared by the spec
- Omitting Data Cases as JSON case IDs from parameterized tests
- Copying \`@eN\` agent-browser refs into tests
- Letting DOM discovery override the Markdown spec

## Original Flow Spec

${validation.content}
`;
}

export function createManifest({
  specPath,
  sha256,
  flowId,
  specVersion,
  domArtifactPath,
  validation,
  generationMode,
  createdAt
}) {
  return {
    specPath,
    specSha256: sha256,
    specHashScope: 'behavioral',
    flowId,
    specVersion,
    generationMode,
    domDiscoveryArtifact: domArtifactPath,
    acIds: validation.acceptanceCriteria,
    dataCaseIds: (validation.dataCasesJson ?? []).map((dataCase) => dataCase.caseId),
    createdAt
  };
}

function findLatestDomDiscoveryArtifact(specPath) {
  const discoveryRoot = path.join('.ai-runs', 'dom-discovery');
  if (!fs.existsSync(discoveryRoot)) {
    return undefined;
  }

  const expectedHash = specSha256(specPath);
  const candidates = [];
  for (const entry of fs.readdirSync(discoveryRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const artifactPath = path.join(discoveryRoot, entry.name, 'selector-candidates.json');
    if (!fs.existsSync(artifactPath)) {
      continue;
    }

    try {
      const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
      if (artifact.specPath === specPath && artifact.specSha256 === expectedHash) {
        candidates.push({ artifactPath, mtimeMs: fs.statSync(artifactPath).mtimeMs });
      }
    } catch {
      // Ignore malformed artifacts here; explicit review reports those issues.
    }
  }

  return candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.artifactPath;
}

function resolveDomArtifactPath(specPath, explicitPath) {
  const artifactPath = explicitPath ?? findLatestDomDiscoveryArtifact(specPath);
  if (!artifactPath) {
    return undefined;
  }

  const review = reviewDomDiscoveryArtifact(artifactPath);
  if (!review.passed) {
    throw new Error(
      [
        `DOM discovery artifact did not pass review: ${artifactPath}`,
        ...review.issues.map((issue) => `- ${issue}`)
      ].join('\n')
    );
  }

  return artifactPath;
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
    console.error('Usage: node scripts/ai/create-generation-task.mjs <spec-path> [--target <test-file>]');
    process.exit(1);
  }

  if (!args.specPath) {
    printHelp();
    process.exit(1);
  }

  const validation = validateSpecFile(args.specPath);
  if (!validation.valid) {
    console.error(`Cannot create generation task because spec validation failed: ${args.specPath}`);
    for (const issue of validation.issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  // Explicit --mode wins; a flag that contradicts the spec's Generation Mode
  // metadata is a hard error; otherwise the spec metadata (default single).
  let generationMode;
  try {
    generationMode = resolveGenerationMode({ cliMode: args.mode, specMode: specGenerationMode(validation.metadata) });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  let domArtifactPath;
  try {
    domArtifactPath = resolveDomArtifactPath(args.specPath, args.domArtifact);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const targetTestFile = args.target ?? validation.metadata['Target Test File'];
  const flowId = validation.metadata['Flow ID'];
  const specVersion = validation.metadata['Spec Version'];
  const sha256 = specSha256(args.specPath);
  const createdAt = new Date().toISOString();
  const timestamp = createdAt.replace(/[:.]/g, '-');
  const runDir = path.join('.ai-runs', `${timestamp}-${slugify(flowId)}`);
  const taskPath = path.join(runDir, 'generation-task.md');
  const manifestPath = path.join(runDir, 'manifest.json');

  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    taskPath,
    createTaskContent({
      specPath: args.specPath,
      targetTestFile,
      validation,
      domArtifactPath,
      generationMode
    })
  );
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      createManifest({
        specPath: args.specPath,
        sha256,
        flowId,
        specVersion,
        domArtifactPath,
        validation,
        generationMode,
        createdAt
      }),
      null,
      2
    )}\n`
  );

  console.log('Created generation task:');
  console.log(taskPath);
  console.log('');
  console.log('Next step:');
  console.log('Paste this task into Codex or ask Codex to implement the generated task file.');
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/create-generation-task.mjs <spec-path> [--mode single|suite]
  node scripts/ai/create-generation-task.mjs <spec-path> --target <test-file> [--mode single|suite]
  node scripts/ai/create-generation-task.mjs <spec-path> --dom-artifact <selector-candidates.json> [--mode single|suite]

Creates a deterministic Codex generation task and manifest from a valid flow spec.`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli();
}
