import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

export function computeGlobalChecksFingerprint(specDir, directoryResult, rootDir = '.') {
  const hash = crypto.createHash('sha256');
  const absoluteRoot = path.resolve(rootDir);
  hash.update('generated-global-checks/v1\0');
  hash.update(normalizePath(path.resolve(absoluteRoot, specDir)));

  for (const entry of directoryResult?.results ?? []) {
    hash.update('\0');
    hash.update(normalizePath(path.relative(absoluteRoot, path.resolve(absoluteRoot, entry.specPath))));
    hash.update('\0');
    hash.update(entry.result?.content ?? '');
    hash.update('\0');
    hash.update(entry.result?.metadata?.['Target Test File'] ?? '');
  }

  for (const configPath of ['package.json', 'tsconfig.json', 'playwright.config.ts']) {
    const absolutePath = path.resolve(absoluteRoot, configPath);
    hash.update('\0');
    hash.update(configPath);
    hash.update('\0');
    if (fs.existsSync(absolutePath)) {
      hash.update(fs.readFileSync(absolutePath));
    }
  }

  for (const sourcePath of resolvedTypeScriptInputs(absoluteRoot)) {
    hash.update('\0typescript-input\0');
    hash.update(normalizePath(path.relative(absoluteRoot, sourcePath)));
    hash.update('\0');
    hash.update(fs.readFileSync(sourcePath));
  }

  return hash.digest('hex');
}

export function verifyGlobalChecksReceipt({ expectedFingerprint, specDir, directoryResult, rootDir = '.' }) {
  const currentFingerprint = computeGlobalChecksFingerprint(specDir, directoryResult, rootDir);
  if (currentFingerprint === expectedFingerprint) {
    return { valid: true, currentFingerprint, issue: undefined };
  }
  return {
    valid: false,
    currentFingerprint,
    issue: 'The supplied global-check fingerprint does not match the current specs/configuration/TypeScript inputs.'
  };
}

function resolvedTypeScriptInputs(rootDir) {
  const configPath = path.join(rootDir, 'tsconfig.json');
  if (!fs.existsSync(configPath)) {
    return [];
  }
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error) {
    throw new Error(`Cannot fingerprint TypeScript inputs: ${formatDiagnostic(loaded.error)}`);
  }
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, rootDir, undefined, configPath);
  if (parsed.errors.length > 0) {
    throw new Error(`Cannot fingerprint TypeScript inputs: ${parsed.errors.map(formatDiagnostic).join('; ')}`);
  }
  return parsed.fileNames
    .map((fileName) => path.resolve(fileName))
    .filter((fileName) => {
      if (!fs.existsSync(fileName)) {
        return false;
      }
      const stat = fs.lstatSync(fileName);
      return stat.isFile() || stat.isSymbolicLink();
    })
    .sort((left, right) => normalizePath(left).localeCompare(normalizePath(right)));
}

function formatDiagnostic(diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
}

function normalizePath(value) {
  return String(value ?? '').split(path.sep).join('/').replace(/\\/g, '/');
}
