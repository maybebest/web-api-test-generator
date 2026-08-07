import fs from 'node:fs';
import path from 'node:path';

import { chromium } from '@playwright/test';

import { projectPlanForSpec } from '../generated-test-gate.mjs';
import { validateAuthenticatedTarget } from './authenticated-target.mjs';

const EXTERNAL_BROWSER_PROJECTS = new Set([
  'chromium', 'firefox', 'webkit', 'mobile-chrome', 'chromium-auth'
]);

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRegularExecutableFile(filePath) {
  if (!hasText(filePath)) return false;
  try {
    const stats = fs.lstatSync(filePath);
    if (stats.isSymbolicLink() || !stats.isFile()) return false;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function chromiumExecutableExists() {
  try {
    return isRegularExecutableFile(chromium.executablePath());
  } catch {
    return false;
  }
}

function reusableStateExists(env, webRoot) {
  const configuredPath = hasText(env.E2E_AUTH_STATE_PATH)
    ? env.E2E_AUTH_STATE_PATH.trim()
    : 'playwright/.auth/user.json';
  const statePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(webRoot, configuredPath);
  try {
    const stats = fs.lstatSync(statePath);
    return !stats.isSymbolicLink() && stats.isFile();
  } catch {
    return false;
  }
}

/**
 * Confirms a validated flow spec can reach its selected Playwright project
 * before a generation provider is invoked. It never launches a browser.
 */
export function checkGenerationReadiness({
  validation,
  env = process.env,
  webRoot,
  browserExecutableExists = chromiumExecutableExists
} = {}) {
  const diagnostics = [];
  const effectiveEnv = env && typeof env === 'object' ? env : {};
  const effectiveWebRoot = hasText(webRoot) ? path.resolve(webRoot) : process.cwd();
  let projects = [];

  if (!validation?.valid || !validation.metadata || typeof validation.metadata !== 'object') {
    return {
      passed: false,
      projects,
      diagnostics: ['Generation readiness requires a validated flow spec.']
    };
  }

  try {
    projects = projectPlanForSpec(validation.metadata, { env: effectiveEnv });
  } catch (error) {
    diagnostics.push(error.message);
    return { passed: false, projects, diagnostics };
  }

  const usesBrowser = projects.some(({ project }) => /chromium|firefox|webkit/i.test(project));
  if (usesBrowser && !browserExecutableExists()) {
    diagnostics.push('Chromium executable is not installed or is not a regular executable file.');
  }

  const usesExternalBrowser = projects.some(({ project }) => EXTERNAL_BROWSER_PROJECTS.has(project));
  if (usesExternalBrowser) {
    if (!hasText(effectiveEnv.PLAYWRIGHT_TEST_BASE_URL)) {
      diagnostics.push('PLAYWRIGHT_TEST_BASE_URL is required for selected external browser projects.');
    } else {
      try {
        validateAuthenticatedTarget(
          effectiveEnv.PLAYWRIGHT_TEST_BASE_URL.trim(),
          effectiveEnv.E2E_AUTH_ALLOWED_HOSTS
        );
      } catch (error) {
        diagnostics.push(error.message);
      }
    }
  }

  if (validation.metadata.Auth?.toLowerCase() === 'required') {
    if (effectiveEnv.E2E_AUTH_REUSE_STATE === 'true') {
      if (!reusableStateExists(effectiveEnv, effectiveWebRoot)) {
        diagnostics.push('E2E_AUTH_STATE_PATH must point to an existing regular non-symlink file when E2E_AUTH_REUSE_STATE=true.');
      }
    } else {
      if (!hasText(effectiveEnv.E2E_USER_EMAIL) || !hasText(effectiveEnv.E2E_USER_PASSWORD)) {
        diagnostics.push('E2E_USER_EMAIL and E2E_USER_PASSWORD are required when E2E_AUTH_REUSE_STATE is not true.');
      }
      if (!hasText(effectiveEnv.E2E_AUTH_SUCCESS_SELECTOR) && !hasText(effectiveEnv.E2E_AUTH_SUCCESS_URL_REGEX)) {
        diagnostics.push('Set E2E_AUTH_SUCCESS_SELECTOR or E2E_AUTH_SUCCESS_URL_REGEX when E2E_AUTH_REUSE_STATE is not true.');
      }
    }
  }

  return { passed: diagnostics.length === 0, projects, diagnostics };
}

export { isRegularExecutableFile };
