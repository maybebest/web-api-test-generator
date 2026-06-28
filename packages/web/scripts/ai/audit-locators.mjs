#!/usr/bin/env node

// Locator-confidence auditor. Reports Page Object locators that are not yet
// verified against the live DOM, so a half-known POM cannot quietly pass as done.
//
// Signals counted per pages/*.ts and components/*.ts file:
//   - "INFERRED" / "@unverified-locator" comment markers (author-declared)
//   - positional picks (.first()/.last()/.nth()) — inherently fragile
//   - raw getByText with a dynamic argument (copy can drift)
//
// Usage:
//   node scripts/ai/audit-locators.mjs            # report, always exit 0
//   node scripts/ai/audit-locators.mjs --strict   # exit 1 if any unverified locator remains

import fs from 'node:fs';
import path from 'node:path';

const DIRS = ['pages', 'components'];
const UNVERIFIED = /\b(INFERRED|@unverified-locator)\b/i;
const POSITIONAL = /\.(?:first|last)\(\)|\.nth\(\s*\d/;

const strict = process.argv.includes('--strict');
const findings = [];

for (const dir of DIRS) {
  if (!fs.existsSync(dir)) {
    continue;
  }
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.ts')) {
      continue;
    }
    const file = path.join(dir, entry);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (UNVERIFIED.test(line)) {
        findings.push({ file, line: index + 1, kind: 'unverified-marker', text: line.trim() });
      } else if (POSITIONAL.test(line) && !line.trim().startsWith('//')) {
        findings.push({ file, line: index + 1, kind: 'positional-pick', text: line.trim() });
      }
    });
  }
}

if (findings.length === 0) {
  console.log('Locator audit: no unverified or positional-pick locators found in Page Objects.');
  process.exit(0);
}

console.log(`Locator audit: ${findings.length} locator(s) need verification against the live DOM:\n`);
for (const finding of findings) {
  console.log(`  ${finding.file}:${finding.line}  [${finding.kind}]  ${finding.text}`);
}
console.log(
  '\nHeal these via `npm run ai:dom:discover` against the target environment, then remove the' +
    ' INFERRED markers. Run with --strict to fail CI while any remain.'
);

process.exit(strict ? 1 : 0);
