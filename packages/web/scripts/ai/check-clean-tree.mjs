#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_DIRS = ['.ai-runs', 'playwright-report', 'test-results', 'allure-results', 'allure-report'];
const FORBIDDEN_FILE_PATTERNS = [/\.trace\.zip$/i, /^trace\.zip$/i, /\.webm$/i, /\.mp4$/i, /\.har$/i];
const SCAN_SKIP_DIRS = new Set(['node_modules', '.git', '.idea']);
const PLACEHOLDER_NAMES = new Set(['.gitkeep', '.DS_Store']);

export function listForbiddenFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const currentPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SCAN_SKIP_DIRS.has(entry.name) || FORBIDDEN_DIRS.includes(entry.name)) {
        continue;
      }
      listForbiddenFiles(currentPath, found);
    } else if (entry.isFile() && FORBIDDEN_FILE_PATTERNS.some((pattern) => pattern.test(entry.name))) {
      found.push(currentPath);
    }
  }

  return found;
}

export function hasMeaningfulContent(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (PLACEHOLDER_NAMES.has(entry.name)) {
      continue;
    }
    if (entry.isDirectory()) {
      // A (recursively) empty directory is a stale leftover, not a runtime
      // artifact — gates used to pre-create evidence dirs they never filled.
      if (hasMeaningfulContent(path.join(dir, entry.name))) {
        return true;
      }
      continue;
    }
    return true;
  }

  return false;
}

export function collectCleanTreeIssues(rootDir = '.') {
  const issues = [];

  for (const dir of FORBIDDEN_DIRS) {
    const dirPath = path.join(rootDir, dir);
    if (fs.existsSync(dirPath) && hasMeaningfulContent(dirPath)) {
      issues.push(`${dir}/ contains runtime artifacts. Traces, reports, and run evidence may embed tokens and PII — never ship them.`);
    }
  }

  for (const file of listForbiddenFiles(rootDir)) {
    issues.push(`${file}: trace/video/HAR artifact present in the tree.`);
  }

  return issues;
}

function runCli() {
  const issues = collectCleanTreeIssues();

  if (issues.length > 0) {
    console.error('Clean-tree check failed:');
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    console.error('Remove the artifacts (they are gitignored, but archives/packaging must also exclude them).');
    process.exit(1);
  }

  console.log('Clean-tree check passed: no runtime artifacts in the distributable tree.');
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli();
}
