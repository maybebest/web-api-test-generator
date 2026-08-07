// Spec-bound header: update with specSha256 after behavioral spec changes.
/* spec: specs/sains/reliability-recovery.md version:1.0.0 sha256:44c043e3f78801a6127452c0300f83fb297be9ede9cfc7c15d575cb21b6c0126 */
import { test, expect } from '../../../fixtures/test';
import { PlanningPage } from '../../../pages/PlanningPage';
import { ReliabilityRecoveryComponent } from '../../../pages/ReliabilityRecoveryComponent';

const journey = {
  advertiser: 'N360_Unilever_MS',
  brand: 'Unilever | Knorr | MS',
  objective: 'Customer retention',
  productSearch: 'knorr'
} as const;

async function openAssistant(planningPage: PlanningPage): Promise<void> {
  await planningPage.goto();
  await planningPage.startNectarAiPlanner();
}

async function buildToProductSearch(planningPage: PlanningPage): Promise<void> {
  await openAssistant(planningPage);
  await planningPage.chooseBuildByObjectiveAndBudget();
  await planningPage.selectAdvertiser(journey.advertiser);
  await planningPage.selectBrand(journey.brand);
  await planningPage.confirmAdvertiserAndBrand();
  await planningPage.enterObjective(journey.objective);
}

test.describe.serial('Nectar AI transient-failure recovery', () => {
  for (const dataCase of [{ caseId: 'DC-001' }] as const) {
    test(
      `${dataCase.caseId} EXT-AI-RETRY-001 exposes an actionable error after transient assistant failures`,
      { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@reliability'] },
      async ({ page }) => {
        test.setTimeout(180_000);
        const planningPage = new PlanningPage(page);
        const recoveryComponent = new ReliabilityRecoveryComponent(page);

        await test.step('Arrange AC-001: inject one transient failure for the objective-flow assistant request', async () => {
          await openAssistant(planningPage);
          await recoveryComponent.injectChatFault({ failures: 1 });
          await planningPage.buildByObjectiveButton().click();
          await recoveryComponent.waitForInjectedFailure(60_000);
        });

        await test.step('Assert AC-001: error, Retry and Cancel are visible and no advertiser state was committed', async () => {
          await expect(recoveryComponent.errorAlert()).toBeVisible({ timeout: 30_000 });
          await expect(recoveryComponent.retryButton()).toBeVisible();
          await expect(recoveryComponent.cancelButton()).toBeVisible();
          await expect(planningPage.advertiserBrandPanel()).toHaveCount(0);
          await expect.poll(() => recoveryComponent.injectedFailureCount()).toBe(1);
        });
      }
    );
  }

  for (const dataCase of [{ caseId: 'DC-002' }] as const) {
    test(
      `${dataCase.caseId} EXT-DEPENDENCY-001 keeps SKU state atomic when product search fails`,
      { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@reliability'] },
      async ({ page }) => {
        test.setTimeout(300_000);
        const planningPage = new PlanningPage(page);
        const recoveryComponent = new ReliabilityRecoveryComponent(page);

        await test.step('Arrange AC-002: build to product search and fail only the knorr request', async () => {
          await buildToProductSearch(planningPage);
          await recoveryComponent.injectChatFault({ message: journey.productSearch, failures: 1 });
          await planningPage.sendChatMessage(journey.productSearch);
          await recoveryComponent.waitForInjectedFailure(60_000);
        });

        await test.step('Assert AC-002: a retryable error is visible and no Measurement SKU was partially committed', async () => {
          await expect(recoveryComponent.errorAlert()).toBeVisible({ timeout: 30_000 });
          await expect(recoveryComponent.retryButton()).toBeVisible();
          await expect(planningPage.campaignSkusCount()).toContainText(/\b0\s+SKUs?\b/);
          await expect.poll(() => recoveryComponent.injectedFailureCount()).toBe(1);
        });
      }
    );
  }

  for (const dataCase of [{ caseId: 'DC-003' }] as const) {
    test(
      `${dataCase.caseId} EXT-AI-RETRY-001 retries once without duplicating the advertiser panel`,
      { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@reliability'] },
      async ({ page }) => {
        test.setTimeout(240_000);
        const planningPage = new PlanningPage(page);
        const recoveryComponent = new ReliabilityRecoveryComponent(page);

        await test.step('Arrange AC-003: fail the first request, then use the product Retry action', async () => {
          await openAssistant(planningPage);
          await recoveryComponent.injectChatFault({ failures: 1 });
          await planningPage.buildByObjectiveButton().click();
          await recoveryComponent.waitForInjectedFailure(60_000);
          await recoveryComponent.retry();
          await planningPage.advertiserBrandPanel().waitFor({ state: 'visible', timeout: 120_000 });
        });

        await test.step('Assert AC-003: one retry produces one panel after exactly two matched requests', async () => {
          await expect.poll(() => recoveryComponent.injectedFailureCount()).toBe(1);
          await expect.poll(() => recoveryComponent.matchedRequestCount()).toBe(2);
          await expect(planningPage.advertiserBrandPanel()).toHaveCount(1);
        });
      }
    );
  }

  test(
    'NEG-001 a message-scoped fault leaves non-target Planning traffic untouched',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@reliability'] },
    async ({ page }) => {
      const planningPage = new PlanningPage(page);
      const recoveryComponent = new ReliabilityRecoveryComponent(page);

      await test.step('NEG-001: install a non-matching chat fault and load the Planning landing page', async () => {
        await recoveryComponent.injectChatFault({ message: 'E2E-NON-TARGET-MESSAGE', failures: 1 });
        await planningPage.goto();
      });

      await test.step('Assert NEG-001: non-target traffic renders normally and is not counted', async () => {
        await expect(planningPage.startAssistantButton()).toBeVisible();
        await expect.poll(() => recoveryComponent.matchedRequestCount()).toBe(0);
        await expect.poll(() => recoveryComponent.injectedFailureCount()).toBe(0);
      });
    }
  );
});
