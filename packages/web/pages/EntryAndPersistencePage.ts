import type { Locator, Page } from '@playwright/test';

import { PlanningPage } from './PlanningPage';

// The planningAI session id appears in the SPA URL once the guided conversation has
// started (observed scheme /planning/nectar-ai/<sessionId>, re-audited live 2026-07-02).
// The URL can lag the first assistant turn on the slow dev environment, so budget an
// assistant-turn-sized wait.
const SESSION_URL_TIMEOUT = 90_000;

/** The summary fields FLOW-MP-025 snapshots before a restore and compares after it. */
export type SummarySnapshot = {
  advertiser: string;
  brands: string;
  objective: string;
  dates: string;
  totalBudget: string;
  heroSkus: string;
  measurementSkus: string;
};

/**
 * How the plan session is restored for the FLOW-MP-025 persistence data cases:
 * - `reload-mid-journey`: navigate back to the session URL without saving first
 *   (equivalent to a browser reload of the in-progress plan).
 * - `save-then-reopen`: save the draft, then reopen the session from its URL so the
 *   summary is reconstructed from durable data only.
 */
export type RestoreMode = 'reload-mid-journey' | 'save-then-reopen';

/**
 * Component Object for the FLOW-MP-025 entry & persistence suite. It owns the few
 * locators/flows the suite needs beyond PlanningPage (unauthenticated entry, the
 * session-id URL capture, summary snapshots and mode-dependent session restores)
 * and composes a PlanningPage for everything already live-verified there.
 */
export class EntryAndPersistencePage {
  private readonly page: Page;
  private readonly planning: PlanningPage;

  constructor(page: Page) {
    this.page = page;
    this.planning = new PlanningPage(page);
  }

  /**
   * Open the protected planning route in a context that carries no authenticated
   * storage state. No readiness gate beyond DOM content: the app is expected to
   * route to its sign-in experience, which signInAffordance() then proves.
   */
  async gotoPlanningUnauthenticated(): Promise<void> {
    await this.page.goto('/planning');
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * A control that only the sign-in experience renders: the email credential field
   * (the auth setup fills it via the same label/placeholder defaults — see
   * fixtures/auth.fixture.ts) or, if the environment lands on a pre-login screen
   * first, its explicit sign-in call-to-action.
   */
  signInAffordance(): Locator {
    const emailField = this.page.getByLabel(/email/i).or(this.page.getByPlaceholder(/email/i));
    const signInButton = this.page.getByRole('button', { name: /sign in|log in|login/i });
    // locator-policy:exception any one matching sign-in control proves the sign-in experience rendered
    return emailField.or(signInButton).first();
  }

  /** Wait for the session id to appear in the URL and return it. */
  async capturedSessionId(): Promise<string> {
    await this.page.waitForURL(/\/planning\/nectar-ai\/[^/?#]+/, { timeout: SESSION_URL_TIMEOUT });
    const match = /\/planning\/nectar-ai\/([^/?#]+)/.exec(this.page.url());
    if (!match) {
      throw new Error('EntryAndPersistencePage: expected a /planning/nectar-ai/<sessionId> URL after the guided flow started.');
    }
    return match[1];
  }

  /**
   * Read the current summary values (rendered text as-is) so a test can compare the
   * restored summary for equality after a reload/reopen. Reads, not assertions —
   * the oracle stays in the test's final assertion step.
   */
  async captureSummarySnapshot(): Promise<SummarySnapshot> {
    const read = async (locator: Locator): Promise<string> => (await locator.textContent()) ?? '';
    return {
      advertiser: await read(this.planning.summaryAdvertiser()),
      brands: await read(this.planning.summaryBrands()),
      objective: await read(this.planning.summaryObjective()),
      dates: await read(this.planning.summaryDates()),
      totalBudget: await read(this.planning.summaryTotalBudget()),
      heroSkus: await read(this.planning.heroSkusCount()),
      measurementSkus: await read(this.planning.campaignSkusCount())
    };
  }

  /**
   * Restore the plan session per the data case's mode. The branch lives here (not in
   * the test body) so the parameterized suite stays conditional-free.
   */
  async restorePlanState(mode: RestoreMode, sessionId: string): Promise<void> {
    if (mode === 'save-then-reopen') {
      await this.planning.savePlan();
    }
    await this.planning.gotoSession(sessionId);
  }
}
