#!/usr/bin/env node
// Fails the build if generated tests/fixtures contain anything that looks like a real secret or
// PII. This is a backstop against masking regressions — generated artifacts are committed, so a
// leak here would be published.
import fs from 'node:fs';
import path from 'node:path';

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

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|js|mjs|cjs|json|jsonl|md|example)$/.test(entry.name)) {
      // .example covers the committed .env.generated.example; .jsonl covers calibration results
      // redirected into a scanned tree; .md covers --ai prompt output.
      out.push(full);
    }
  }
  return out;
}

const findings = [];
for (const file of targetDirs.flatMap(walk)) {
  const content = fs.readFileSync(file, 'utf8');
  for (const { name, regex } of patterns) {
    for (const match of content.matchAll(regex)) {
      const value = match[0];
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

console.log(`✓ No secrets or PII detected in ${targetDirs.join(', ')}`);
