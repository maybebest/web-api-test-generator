import { test as setup } from '@playwright/test';

import { authStatePath, loginAndSaveStorageState, requireAuthConfig } from '../../fixtures/auth.fixture';

// Authenticated setup. Runs only in the `setup` project, which Playwright wires
// up exclusively when E2E_AUTH_ENABLED=true (see playwright.config.ts). It logs
// in with non-production credentials from the environment and saves storage
// state for the chromium-auth project. requireAuthConfig fails fast with an
// actionable message when configuration is missing, and loginAndSaveStorageState
// asserts authentication succeeded before persisting state.
setup('authenticate and persist storage state', async ({ page }) => {
  const config = requireAuthConfig();
  await loginAndSaveStorageState(page, config, authStatePath);
});
