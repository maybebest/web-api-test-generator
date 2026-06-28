#!/usr/bin/env node
import 'dotenv/config';
import { mergeConfig } from '../config/defaultConfig.js';
import { generateFromHar } from '../generator/orchestrator.js';
import { loadUserConfig, parseCliArgs } from './options.js';

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const config = mergeConfig(await loadUserConfig(options.configPath));
  const summary = await generateFromHar(options, config);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
