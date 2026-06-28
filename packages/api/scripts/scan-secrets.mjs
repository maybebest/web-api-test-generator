#!/usr/bin/env node
// Fails the build if COMMITTED tests/fixtures/sources contain anything that looks like a real
// secret or PII. This is a backstop against masking regressions — generated artifacts are
// committed, so a leak here would be published.
//
// Enumeration is GIT-AWARE: only files tracked by git (respecting .gitignore) are scanned, via
// `git ls-files`. That is deliberate — the raw WebInspector captures under examples/*.md are
// gitignored (they contain real tokens/cookies/PII) and must NEVER be scanned or committed; only
// the sanitized examples/*.har is tracked. Scanning the working tree directly (fs.readdir) would
// wrongly trip on those gitignored captures.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const targetDirs = process.argv.slice(2);
if (targetDirs.length === 0) {
  targetDirs.push('tests/generated');
}

const patterns = [
  { name: 'email address', regex: /[A-Za-z0-9._%+-]+@(?!example\.(?:com|test)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { name: 'JWT', regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g },
  { name: 'bearer token', regex: /Bearer\s+(?!\$\{)[A-Za-z0-9._~+/=-]{16,}/g },
  { name: 'AWS ALB cookie', regex: /AWSALB(?:CORS)?=[A-Za-z0-9+/=]{20,}/g },
  { name: 'long hex secret', regex: /\b[a-f0-9]{40,}\b/g }
];

// Sanitized placeholders that are committed ON PURPOSE (demo fixtures). A match equal to one of
// these is not a leak. Keep this list tiny and specific so real secrets are never whitelisted.
const allowlist = [/\bdemo-token-that-should-never-be-generated\b/];

// .example covers the committed .env.generated.example; .jsonl covers calibration results
// redirected into a scanned tree; .md covers --ai prompt output; .har covers committed sample
// captures (sanitized; raw .md captures are gitignored and never reach git ls-files).
const scannableExtension = /\.(ts|js|mjs|cjs|json|jsonl|md|example|har)$/;

function trackedFiles(root) {
  let output;
  try {
    output = execFileSync('git', ['ls-files', '-z', '--', root], { encoding: 'utf8' });
  } catch {
    return [];
  }
  return output.split('\0').filter((file) => file && scannableExtension.test(file));
}

const findings = [];
const scanned = new Set();
for (const file of targetDirs.flatMap(trackedFiles)) {
  if (scanned.has(file)) {
    continue;
  }
  scanned.add(file);
  const content = fs.readFileSync(file, 'utf8');
  for (const { name, regex } of patterns) {
    for (const match of content.matchAll(regex)) {
      const value = match[0];
      if (allowlist.some((allowed) => allowed.test(value))) {
        continue;
      }
      const redacted = value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-2)}` : value;
      findings.push({ file, name, redacted });
    }
  }
}

if (findings.length > 0) {
  console.error(`✗ Potential secrets/PII found in ${targetDirs.join(', ')}:`);
  for (const f of findings.slice(0, 50)) {
    console.error(`  - [${f.name}] ${f.file}: ${f.redacted}`);
  }
  if (findings.length > 50) {
    console.error(`  …and ${findings.length - 50} more`);
  }
  process.exit(1);
}

console.log(`✓ No secrets or PII detected in ${scanned.size} tracked file(s) under ${targetDirs.join(', ')}`);
