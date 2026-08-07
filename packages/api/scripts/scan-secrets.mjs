#!/usr/bin/env node
// Fails the build if COMMITTED tests/fixtures/sources contain anything that looks like a real
// secret or PII. This is a backstop against masking regressions — generated artifacts are
// committed, so a leak here would be published.
//
// Enumeration is GIT-AWARE: tracked files plus non-ignored untracked candidates are scanned via
// `git ls-files -co --exclude-standard`. That catches freshly generated artifacts before staging,
// while raw WebInspector captures ignored by git remain outside the scan.
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
  { name: 'cookie header', regex: /\b(?:Cookie|Set-Cookie)\s*:\s*(?!\$\{)[^\r\n]{8,}/gi },
  { name: 'AWS ALB cookie', regex: /AWSALB(?:CORS)?=[A-Za-z0-9+/=]{20,}/g },
  { name: 'GitHub token', regex: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { name: 'Slack token', regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { name: 'live Stripe secret', regex: /\bsk_live_[A-Za-z0-9]{16,}\b/g },
  { name: 'private key', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'long hex secret', regex: /\b[a-f0-9]{40,}\b/g }
];

// Sanitized placeholders that are committed ON PURPOSE (demo fixtures). A match equal to one of
// these is not a leak. Keep this list tiny and specific so real secrets are never whitelisted.
const allowlist = [/\bdemo-token-that-should-never-be-generated\b/];

// .example covers the committed .env.generated.example; .jsonl covers calibration results
// redirected into a scanned tree; .md covers --ai prompt output; .har covers committed sample
// captures (sanitized; raw .md captures are gitignored and never reach git ls-files).
const scannableExtension = /\.(ts|js|mjs|cjs|json|jsonl|md|example|har)$/;

function eligibleFiles(root) {
  try {
    const output = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z', '--', root], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return output
      .split('\0')
      .filter((file) => file && scannableExtension.test(file) && fs.existsSync(file));
  } catch (error) {
    const detail = error && typeof error === 'object' && 'stderr' in error
      ? String(error.stderr).trim()
      : error instanceof Error
        ? error.message
        : String(error);
    console.error(`✗ Unable to enumerate tracked files for secret scanning (${root}): ${detail || 'git ls-files failed'}`);
    process.exit(2);
  }
}

const findings = [];
const scanned = new Set();
const filesByRoot = targetDirs.map((root) => ({ root, files: eligibleFiles(root) }));
const emptyRoots = filesByRoot.filter(({ files }) => files.length === 0).map(({ root }) => root);
if (emptyRoots.length > 0) {
  console.error(
    `✗ Secret scan matched no tracked or non-ignored untracked scannable files for configured root(s): ${emptyRoots.join(', ')}; ` +
      'refusing to pass an incomplete scan.'
  );
  process.exit(2);
}

for (const file of filesByRoot.flatMap(({ files }) => files)) {
  if (scanned.has(file)) {
    continue;
  }
  scanned.add(file);
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    console.error(`✗ Refusing to secret-scan a symlink or non-regular file: ${file}`);
    process.exit(2);
  }
  const content = fs.readFileSync(file, 'utf8');
  for (const { name, regex } of patterns) {
    for (const match of content.matchAll(regex)) {
      const value = match[0];
      // The generated-output ownership marker deliberately stores a SHA-256 inventory digest.
      // Allow only that named JSON field, not arbitrary long hex elsewhere in the marker.
      if (
        name === 'long hex secret' &&
        (file === '.har-api-tests-generated.json' || file.endsWith('/.har-api-tests-generated.json')) &&
        content.includes(`"inventorySha256": "${value}"`)
      ) {
        continue;
      }
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

console.log(`✓ No secrets or PII detected in ${scanned.size} eligible file(s) under ${targetDirs.join(', ')}`);
