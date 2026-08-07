import type { Locator, Page } from '@playwright/test';

import { getPlan, getPlanningSession } from '../fixtures/nectar-api';
import { PlanningPage } from './PlanningPage';

type Slot = 'alpha' | 'bravo';

type ConversationSnapshot = {
  sessionId: string;
  planId: string;
  ownerId: string;
  stateJson: string;
  planReadId: string;
  objectiveText: string;
};

export type IsolationResult = {
  alpha: ConversationSnapshot;
  bravo: ConversationSnapshot;
};

export type IsolationCleanupResult = {
  alphaDiscarded: boolean;
  bravoDiscarded: boolean;
  bravoReadableAfterAlphaDiscard: boolean;
  alphaPlanReadableAfterCleanup: boolean;
  bravoPlanReadableAfterCleanup: boolean;
  retainedConversationShells: number;
  failures: string[];
};

const POLL_INTERVAL_MS = 1_000;
const PLAN_ID_TIMEOUT_MS = 120_000;

const journey = {
  advertiser: 'N360_Unilever_MS',
  brand: 'Unilever | Knorr | MS',
  productSearch: 'knorr',
  channel: 'Meta'
} as const;

const objectiveBySlot: Record<Slot, string> = {
  alpha: 'Increase sales & conversions',
  bravo: 'Customer acquisition'
};

const formatDdMmYyyy = (date: Date): string =>
  `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;

const futureDate = (offsetDays: number): string => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return formatDdMmYyyy(date);
};

const channelRequest = (): string =>
  `Offsite, ${journey.channel}, ${futureDate(45)} till ${futureDate(75)}, the budget is 7k, Self-Serve`;

const delay = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
};

/**
 * Drives TC-ACC-005 through two tabs in one authenticated browser context.
 * Conversation shells cannot be deleted by the current schema, so the test is
 * explicitly opt-in; each owned media plan is nevertheless completed and discarded
 * through the product UI, with a cross-plan survival check between the two deletes.
 */
export class ParallelConversationIsolationComponent {
  private readonly pages: Record<Slot, Page>;
  private readonly planning: Record<Slot, PlanningPage>;
  private readonly sessionIds: Partial<Record<Slot, string>> = {};
  private readonly planIds: Partial<Record<Slot, string>> = {};

  constructor(alphaPage: Page, bravoPage: Page) {
    this.pages = { alpha: alphaPage, bravo: bravoPage };
    this.planning = {
      alpha: new PlanningPage(alphaPage),
      bravo: new PlanningPage(bravoPage)
    };
  }

  requirePersistentConversationConsent(): void {
    if (process.env.E2E_ALLOW_PERSISTENT_TEST_DATA !== 'true') {
      throw new Error(
        'TC-ACC-005 requires E2E_ALLOW_PERSISTENT_TEST_DATA=true: the live schema has no conversation-delete operation, so two discarded conversation shells remain after owned-plan cleanup.'
      );
    }
  }

  private async startIdentity(slot: Slot): Promise<void> {
    const planning = this.planning[slot];
    await planning.goto();
    await planning.startNectarAiPlanner();
    await planning.chooseBuildByObjectiveAndBudget();
    await planning.selectAdvertiser(journey.advertiser);
    await planning.selectBrand(journey.brand);
    await planning.confirmAdvertiserAndBrand();
    this.sessionIds[slot] = await this.captureSessionId(this.pages[slot]);
  }

  private async captureSessionId(page: Page): Promise<string> {
    await page.waitForURL(/\/planning\/nectar-ai\/[^/?#]+/, { timeout: 90_000 });
    const sessionId = /\/planning\/nectar-ai\/([^/?#]+)/.exec(page.url())?.[1];
    if (!sessionId) {
      throw new Error('TC-ACC-005: expected a session id in the Nectar AI conversation URL.');
    }
    return sessionId;
  }

  private async requireSessionPlan(slot: Slot): Promise<ConversationSnapshot> {
    const sessionId = this.sessionIds[slot];
    if (!sessionId) {
      throw new Error(`TC-ACC-005: ${slot} has no captured session id.`);
    }
    const deadline = Date.now() + PLAN_ID_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const session = (await getPlanningSession(sessionId)) as
        | ({ userId?: unknown; state: unknown; planId: string | null })
        | null;
      if (session?.planId) {
        const plan = await getPlan(session.planId);
        const planReadId = typeof plan?.id === 'string' ? plan.id : '';
        const ownerId = typeof session.userId === 'string' ? session.userId : '';
        this.planIds[slot] = session.planId;
        return {
          sessionId,
          planId: session.planId,
          ownerId,
          stateJson: JSON.stringify(session.state ?? {}),
          planReadId,
          objectiveText: ((await this.planning[slot].summaryObjective().textContent()) ?? '').trim()
        };
      }
      await delay();
    }
    throw new Error(`TC-ACC-005: ${slot} session did not expose an owned planId within ${PLAN_ID_TIMEOUT_MS}ms.`);
  }

  async createReloadAndReadBoth(): Promise<IsolationResult> {
    // Alternate the same lifecycle stage between tabs instead of completing one
    // whole journey first; this is the concurrency shape the canonical case requires.
    await this.startIdentity('alpha');
    await this.startIdentity('bravo');
    await this.planning.alpha.enterObjective(objectiveBySlot.alpha);
    await this.planning.bravo.enterObjective(objectiveBySlot.bravo);

    const alphaId = this.sessionIds.alpha as string;
    const bravoId = this.sessionIds.bravo as string;
    await this.planning.alpha.gotoSession(alphaId);
    await this.planning.bravo.gotoSession(bravoId);

    const [alpha, bravo] = await Promise.all([
      this.requireSessionPlan('alpha'),
      this.requireSessionPlan('bravo')
    ]);
    return { alpha, bravo };
  }

  objective(slot: Slot): string {
    return objectiveBySlot[slot];
  }

  summaryObjective(slot: Slot): Locator {
    return this.planning[slot].summaryObjective();
  }

  private async finishAndDiscard(slot: Slot): Promise<boolean> {
    const planning = this.planning[slot];
    await planning.searchProducts(journey.productSearch);
    await planning.selectFirstProduct();
    await planning.confirmProducts();
    await planning.enterChannelRequest(channelRequest(), journey.channel);
    await planning.confirmPlan();
    await planning.discardButton().waitFor({ state: 'visible', timeout: 180_000 });
    await planning.openDiscardPrompt();
    await planning.answerDiscardPrompt('Yes, discard draft plan');
    await planning.discardedConfirmation().waitFor({ state: 'visible', timeout: 120_000 });
    return true;
  }

  private async isPlanReadable(planId: string | undefined): Promise<boolean> {
    if (!planId) {
      return false;
    }
    try {
      const plan = await getPlan(planId);
      return plan?.id === planId;
    } catch {
      return false;
    }
  }

  async discardOwnedPlans(): Promise<IsolationCleanupResult> {
    const result: IsolationCleanupResult = {
      alphaDiscarded: false,
      bravoDiscarded: false,
      bravoReadableAfterAlphaDiscard: false,
      alphaPlanReadableAfterCleanup: true,
      bravoPlanReadableAfterCleanup: true,
      retainedConversationShells: Object.keys(this.sessionIds).length,
      failures: []
    };

    if (this.sessionIds.alpha) {
      try {
        result.alphaDiscarded = await this.finishAndDiscard('alpha');
        result.bravoReadableAfterAlphaDiscard = await this.isPlanReadable(this.planIds.bravo);
      } catch (error) {
        result.failures.push(`alpha cleanup: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (this.sessionIds.bravo) {
      try {
        result.bravoDiscarded = await this.finishAndDiscard('bravo');
      } catch (error) {
        result.failures.push(`bravo cleanup: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    result.alphaPlanReadableAfterCleanup = await this.isPlanReadable(this.planIds.alpha);
    result.bravoPlanReadableAfterCleanup = await this.isPlanReadable(this.planIds.bravo);
    return result;
  }
}
