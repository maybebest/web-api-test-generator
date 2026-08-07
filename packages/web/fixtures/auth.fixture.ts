import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';

export const authStatePath = process.env.E2E_AUTH_STATE_PATH ?? 'playwright/.auth/user.json';

export type AuthConfig = {
  loginPath: string;
  email: string;
  password: string;
  emailSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  successSelector?: string;
  successUrlRegex?: string;
};

export function isAuthEnabled(): boolean {
  return process.env.E2E_AUTH_ENABLED === 'true';
}

export function getAuthConfig(): Partial<AuthConfig> {
  return {
    loginPath: process.env.E2E_LOGIN_PATH || '/login',
    email: process.env.E2E_USER_EMAIL,
    password: process.env.E2E_USER_PASSWORD,
    emailSelector: process.env.E2E_LOGIN_EMAIL_SELECTOR,
    passwordSelector: process.env.E2E_LOGIN_PASSWORD_SELECTOR,
    submitSelector: process.env.E2E_LOGIN_SUBMIT_SELECTOR,
    successSelector: process.env.E2E_AUTH_SUCCESS_SELECTOR,
    successUrlRegex: process.env.E2E_AUTH_SUCCESS_URL_REGEX
  };
}

export function requireAuthConfig(): AuthConfig {
  if (!isAuthEnabled()) {
    throw new Error('Authentication is disabled. Set E2E_AUTH_ENABLED=true to run authenticated setup.');
  }

  const config = getAuthConfig();
  const missingFields: string[] = [];

  if (!config.loginPath) {
    missingFields.push('E2E_LOGIN_PATH');
  }

  if (!config.email) {
    missingFields.push('E2E_USER_EMAIL');
  }

  if (!config.password) {
    missingFields.push('E2E_USER_PASSWORD');
  }

  if (!config.successSelector && !config.successUrlRegex) {
    missingFields.push('E2E_AUTH_SUCCESS_SELECTOR or E2E_AUTH_SUCCESS_URL_REGEX');
  }

  if (missingFields.length > 0) {
    throw new Error(
      [
        'Authenticated setup is enabled but required configuration is missing:',
        ...missingFields.map((field) => `- ${field}`),
        'Set these values using non-production credentials and a non-production environment.'
      ].join('\n')
    );
  }

  return config as AuthConfig;
}

export async function assertAuthenticated(page: Page, config: AuthConfig): Promise<void> {
  const checks: Array<Promise<unknown>> = [];

  if (config.successSelector) {
    checks.push(successLocator(page, config).waitFor({ state: 'visible', timeout: 10_000 }));
  }

  if (config.successUrlRegex) {
    checks.push(page.waitForURL(new RegExp(config.successUrlRegex), { timeout: 10_000 }));
  }

  if (checks.length === 0) {
    throw new Error('Cannot assert authentication without a success selector or success URL regex.');
  }

  try {
    await Promise.any(checks);
  } catch {
    throw new Error(
      'Login completed, but authenticated state was not proven. Check E2E_AUTH_SUCCESS_SELECTOR or E2E_AUTH_SUCCESS_URL_REGEX.'
    );
  }
}

export async function loginAndSaveStorageState(
  page: Page,
  config: AuthConfig,
  storagePath: string
): Promise<void> {
  await page.goto(config.loginPath);
  await loginEmailField(page, config).fill(config.email);
  await loginPasswordField(page, config).fill(config.password);
  await loginSubmitButton(page, config).click();
  await assertAuthenticated(page, config);

  const storageDirectory = path.dirname(storagePath);
  const createdDirectory = await mkdir(storageDirectory, { recursive: true, mode: 0o700 });
  if (createdDirectory !== undefined) {
    await chmod(storageDirectory, 0o700);
  }
  await page.context().storageState({ path: storagePath });
  await chmod(storagePath, 0o600);
}

function loginEmailField(page: Page, config: AuthConfig): Locator {
  if (config.emailSelector) {
    return page.locator(config.emailSelector).first();
  }

  return page.getByLabel(/email/i).or(page.getByPlaceholder(/email/i)).first();
}

function loginPasswordField(page: Page, config: AuthConfig): Locator {
  if (config.passwordSelector) {
    return page.locator(config.passwordSelector).first();
  }

  return page.getByLabel(/password/i).or(page.getByPlaceholder(/password/i)).first();
}

function loginSubmitButton(page: Page, config: AuthConfig): Locator {
  if (config.submitSelector) {
    return page.locator(config.submitSelector).first();
  }

  return page.getByRole('button', { name: /sign in|log in|login|continue/i }).first();
}

function successLocator(page: Page, config: AuthConfig): Locator {
  if (!config.successSelector) {
    throw new Error('Missing E2E_AUTH_SUCCESS_SELECTOR.');
  }

  return page.locator(config.successSelector).first();
}
