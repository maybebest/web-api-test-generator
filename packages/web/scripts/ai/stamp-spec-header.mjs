#!/usr/bin/env node

// Recompute and write the spec version + behavioral sha256 into a generated
// test's `/* spec: <path> version:<v> sha256:<hex> */` header, from the spec the
// header references. Run after editing a spec's behavioral sections so
// `ai:spec:drift` and `ai:test:review` pass without hand-computing the hash.
//
//   node scripts/ai/stamp-spec-header.mjs tests/regression/foo.authenticated.spec.ts [more...]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SPEC_HEADER_PATTERN, parseSpecHeader, specSha256 } from './lib/spec-parser.mjs';
import { validateSpecFile } from './validate-flow-spec.mjs';

export function stampSpecHeader(testPath) {
  const content = fs.readFileSync(testPath, 'utf8');
  const header = parseSpecHeader(content);
  if (!header) {
    throw new Error(`No /* spec: ... */ header found in ${testPath}.`);
  }

  const specPath = header.specPath;
  if (!fs.existsSync(path.resolve(specPath))) {
    throw new Error(`Spec referenced by ${testPath} does not exist: ${specPath}.`);
  }

  const version = validateSpecFile(specPath).metadata?.['Spec Version'] ?? header.specVersion;
  const sha256 = specSha256(specPath);
  const stamped = `/* spec: ${specPath} version:${version} sha256:${sha256} */`;
  const updated = content.replace(SPEC_HEADER_PATTERN, stamped);

  if (updated === content) {
    return { testPath, specPath, version, sha256, changed: false };
  }

  fs.writeFileSync(testPath, updated);
  return { testPath, specPath, version, sha256, changed: true };
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai/stamp-spec-header.mjs <test-file.spec.ts> [more test files...]

Rewrites each test's /* spec: ... */ header with the current Spec Version and the
behavioral sha256 of the spec it references. Use it after changing a spec's
behavioral sections instead of hand-computing the hash.`);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(args.length === 0 ? 1 : 0);
  }

  let failed = false;
  for (const arg of args) {
    try {
      const result = stampSpecHeader(arg);
      console.log(
        result.changed
          ? `Stamped ${result.testPath} -> version:${result.version} sha256:${result.sha256}`
          : `Up to date ${result.testPath} (sha256:${result.sha256})`
      );
    } catch (error) {
      console.error(`Error stamping ${arg}: ${error.message}`);
      failed = true;
    }
  }
  process.exit(failed ? 1 : 0);
}
