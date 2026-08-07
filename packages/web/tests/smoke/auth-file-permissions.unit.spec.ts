import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { test, expect, type Page } from '@playwright/test';

import { loginAndSaveStorageState, type AuthConfig } from '../../fixtures/auth.fixture';
import { shouldCollectPerformance } from '../../fixtures/perf/policy';
import playwrightConfig, {
  AUTHENTICATED_ARTIFACT_POLICY,
  AUTHENTICATED_REPORTER_POLICY,
  validateAuthenticatedTarget
} from '../../playwright.config';

test('authenticated project never retains credential-bearing browser media', () => {
  const authenticatedPolicies = (playwrightConfig.projects ?? [])
    .filter((project) => project.name === 'chromium-auth')
    .map((project) => ({
      trace: project.use?.trace,
      screenshot: project.use?.screenshot,
      video: project.use?.video
    }));

  expect(AUTHENTICATED_ARTIFACT_POLICY).toEqual({ trace: 'off', screenshot: 'off', video: 'off' });
  expect(AUTHENTICATED_REPORTER_POLICY).toEqual([['list']]);
  expect(authenticatedPolicies).toEqual(authenticatedPolicies.map(() => AUTHENTICATED_ARTIFACT_POLICY));
});

test('persisted browser auth state is owner-readable only', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'web-auth-state-'));
  const storagePath = path.join(temporaryRoot, 'private', 'user.json');
  const locator = {
    first() {
      return this;
    },
    async fill() {},
    async click() {},
    async waitFor() {}
  };
  const page = {
    async goto() {},
    locator() {
      return locator;
    },
    context() {
      return {
        async storageState({ path: outputPath }: { path: string }) {
          await fs.writeFile(outputPath, '{"cookies":[],"origins":[]}\n', 'utf8');
        }
      };
    }
  } as unknown as Page;
  const config: AuthConfig = {
    loginPath: '/login',
    email: 'qa.user@example.test',
    password: 'synthetic-test-password',
    emailSelector: '#email',
    passwordSelector: '#password',
    submitSelector: '#submit',
    successSelector: '#signed-in'
  };

  try {
    await loginAndSaveStorageState(page, config, storagePath);

    expect((await fs.stat(path.dirname(storagePath))).mode & 0o777).toBe(0o700);
    expect((await fs.stat(storagePath)).mode & 0o777).toBe(0o600);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('authenticated regression accepts only classified non-production targets', () => {
  expect(validateAuthenticatedTarget('https://www.dev.example.test/planning')).toBe(
    'https://www.dev.example.test/planning'
  );
  expect(validateAuthenticatedTarget('https://test-environment.example', 'test-environment.example')).toBe(
    'https://test-environment.example/'
  );

  expect(() => validateAuthenticatedTarget('https://www.example.com')).toThrow(/unclassified host/);
  expect(() => validateAuthenticatedTarget('http://www.dev.example.test')).toThrow(/requires HTTPS/);
  expect(() => validateAuthenticatedTarget('https://user:secret@www.dev.example.test')).toThrow(/requires HTTPS/);
  expect(() => validateAuthenticatedTarget('https://www.dev.example.test:8443')).toThrow(/requires HTTPS/);
  expect(() => validateAuthenticatedTarget('https://www.dev.example.test?token=secret')).toThrow(/requires HTTPS/);
  expect(() => validateAuthenticatedTarget('https://reviewed.example', '*.example')).toThrow(/hostnames only/);
});

test('authenticated projects never collect private performance artifacts', () => {
  expect(shouldCollectPerformance(true, 'chromium-auth')).toBe(false);
  expect(shouldCollectPerformance(true, 'setup')).toBe(false);
  expect(shouldCollectPerformance(true, 'local-chromium')).toBe(true);
  expect(shouldCollectPerformance(false, 'local-chromium')).toBe(false);
});
