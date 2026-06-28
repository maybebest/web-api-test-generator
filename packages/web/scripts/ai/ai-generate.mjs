#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractCodeBlock, resolveEnv, runBrain, selectBrain } from './lib/ai-client.mjs';

export function parseArgs(args) {
  const parsed = {
    task: undefined,
    spec: undefined,
    out: undefined
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--out') {
      parsed.out = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--spec') {
      parsed.spec = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    if (!parsed.task) {
      parsed.task = arg;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return parsed;
}

// Records the generation outcome (brain, model, token usage) into the run manifest
// that create-generation-task.mjs wrote next to the task file, when one exists.
// Adding the `generation` key is additive: the gates only read specPath/specSha256.
export function recordGenerationInManifest({ promptPath, outPath, brain, usage, now = () => new Date() }) {
  const manifestPath = path.join(path.dirname(path.resolve(promptPath)), 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return false;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.generation = {
      brain: brain.kind,
      model: brain.model ?? null,
      outPath,
      completedAt: now().toISOString(),
      usage: usage ? { inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null } : null
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return true;
  } catch (error) {
    console.error(`Warning: could not update run manifest ${manifestPath}: ${error.message}`);
    return false;
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/ai-generate.mjs <generation-task.md> --out <target.spec.ts>
  node scripts/ai/ai-generate.mjs --spec <spec.md> --out <target.spec.ts>

Reads the generation-task (or spec) markdown as the prompt, runs the selected AI brain,
extracts the fenced \`\`\`ts code block, and writes it to --out (creating parent
directories). REST brains (Anthropic/OpenAI API keys) receive a pinned output contract;
CLI brains (claude/codex) receive the raw task. Environment variables are read from the
real environment first, then <repo>/.env (real environment wins).
Run \`npm run ai:brain:doctor\` to see which brain is selected and why.`);
}

async function runCli() {
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

  const promptPath = args.task ?? args.spec;
  if (!promptPath || !args.out) {
    printHelp();
    process.exit(1);
  }

  if (!fs.existsSync(promptPath)) {
    console.error(`Input file does not exist: ${promptPath}`);
    process.exit(1);
  }

  const resolved = resolveEnv();

  let brain;
  try {
    brain = selectBrain(resolved.env);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  if (brain.kind === 'none') {
    console.error(
      'No AI brain available: set ANTHROPIC_API_KEY or OPENAI_API_KEY (environment or .env), or install the claude or codex CLI.'
    );
    process.exit(1);
  }

  const prompt = fs.readFileSync(promptPath, 'utf8');

  let result;
  try {
    result = await runBrain(prompt, { env: resolved.env });
  } catch (error) {
    console.error(`AI generation failed: ${error.message}`);
    process.exit(1);
  }

  let code;
  try {
    code = extractCodeBlock(result.text);
  } catch (error) {
    console.error(`AI generation failed: ${error.message}`);
    console.error('No file was written. Re-run generation or adjust the task/model settings.');
    process.exit(1);
  }

  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, code.endsWith('\n') ? code : `${code}\n`);

  recordGenerationInManifest({
    promptPath,
    outPath: args.out,
    brain: result.brain,
    usage: result.usage
  });

  console.log(`Generated test written via ${result.brain.kind}: ${args.out}`);
  console.log('');
  console.log('Next steps:');
  console.log('- Run `npm run ai:test:review` to review the generated test against its spec.');
  console.log('- Run `npm run ai:test:gate` to run the full quality gate.');
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli();
}
