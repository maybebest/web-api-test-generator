// Spec-bound header: recompute with specSha256 after behavioral spec changes.
/* spec: specs/sains/parallel-conversation-isolation.md version:1.0.0 sha256:efe5ecd9bcdf5841983f67d5514f8330a8f8bf1028493ddcc5f5d17ad3c39271 */
import { test, expect } from '../../../fixtures/test';
import {
  ParallelConversationIsolationComponent,
  type IsolationCleanupResult,
  type IsolationResult
} from '../../../pages/ParallelConversationIsolationComponent';

function requireEvidence(
  result: IsolationResult | undefined,
  cleanup: IsolationCleanupResult | undefined
): [IsolationResult, IsolationCleanupResult] {
  if (!result || !cleanup) {
    throw new Error('TC-ACC-005 completed without both isolation and cleanup evidence.');
  }
  return [result, cleanup];
}

function captureMissingConsentGuard(component: ParallelConversationIsolationComponent): string {
  const originalConsent = process.env.E2E_ALLOW_PERSISTENT_TEST_DATA;
  let guardError = '';
  delete process.env.E2E_ALLOW_PERSISTENT_TEST_DATA;
  try {
    component.requirePersistentConversationConsent();
  } catch (error) {
    guardError = error instanceof Error ? error.message : String(error);
  } finally {
    if (originalConsent === undefined) delete process.env.E2E_ALLOW_PERSISTENT_TEST_DATA;
    else process.env.E2E_ALLOW_PERSISTENT_TEST_DATA = originalConsent;
  }
  return guardError;
}

test.describe.serial('Parallel Nectar AI conversation isolation', () => {
  for (const dataCase of [{ caseId: 'DC-001' }] as const) {
    test(
      `${dataCase.caseId} TC-ACC-005 isolates two tabs and cleans up only each owned plan`,
      { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@isolation'] },
      async ({ page, context }) => {
        test.setTimeout(1_200_000);
        test.info().annotations.push({ type: 'covered-ac-ids', description: 'AC-001 AC-002' });
        const bravoPage = await context.newPage();
        const isolationComponent = new ParallelConversationIsolationComponent(page, bravoPage);
        let result: IsolationResult | undefined;
        let cleanup: IsolationCleanupResult | undefined;

        try {
          await test.step('Arrange AC-001: alternate two conversations, reload both, and capture UI/API state', async () => {
            isolationComponent.requirePersistentConversationConsent();
            result = await isolationComponent.createReloadAndReadBoth();
          });
        } finally {
          await test.step('Act AC-002: discard Alpha, prove Bravo survives, then discard Bravo', async () => {
            cleanup = await isolationComponent.discardOwnedPlans();
          });
        }

        const [observed, cleaned] = requireEvidence(result, cleanup);

        await test.step('Assert AC-002: identities, state and ownership-scoped cleanup are isolated', async () => {
          await expect.poll(() => observed.alpha.sessionId).not.toBe(observed.bravo.sessionId);
          await expect.poll(() => observed.alpha.planId).not.toBe(observed.bravo.planId);
          await expect.poll(() => observed.alpha.ownerId).not.toBe('');
          await expect.poll(() => observed.alpha.ownerId).toBe(observed.bravo.ownerId);
          await expect.poll(() => observed.alpha.planReadId).toBe(observed.alpha.planId);
          await expect.poll(() => observed.bravo.planReadId).toBe(observed.bravo.planId);

          await expect(isolationComponent.summaryObjective('alpha')).toContainText(isolationComponent.objective('alpha'));
          await expect(isolationComponent.summaryObjective('alpha')).not.toContainText(isolationComponent.objective('bravo'));
          await expect(isolationComponent.summaryObjective('bravo')).toContainText(isolationComponent.objective('bravo'));
          await expect(isolationComponent.summaryObjective('bravo')).not.toContainText(isolationComponent.objective('alpha'));
          await expect.poll(() => observed.alpha.stateJson).toContain(isolationComponent.objective('alpha'));
          await expect.poll(() => observed.alpha.stateJson).not.toContain(isolationComponent.objective('bravo'));
          await expect.poll(() => observed.bravo.stateJson).toContain(isolationComponent.objective('bravo'));
          await expect.poll(() => observed.bravo.stateJson).not.toContain(isolationComponent.objective('alpha'));

          await expect.poll(() => cleaned.failures).toEqual([]);
          await expect.poll(() => cleaned.alphaDiscarded).toBe(true);
          await expect.poll(() => cleaned.bravoReadableAfterAlphaDiscard).toBe(true);
          await expect.poll(() => cleaned.bravoDiscarded).toBe(true);
          await expect.poll(() => cleaned.alphaPlanReadableAfterCleanup).toBe(false);
          await expect.poll(() => cleaned.bravoPlanReadableAfterCleanup).toBe(false);
          await expect.poll(() => cleaned.retainedConversationShells).toBe(2);
        });
      }
    );
  }

  test(
    'NEG-001 missing persistent-shell consent fails before either conversation is created',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@isolation'] },
    async ({ page, context }) => {
      const bravoPage = await context.newPage();
      const isolationComponent = new ParallelConversationIsolationComponent(page, bravoPage);
      let guardError = '';

      await test.step('NEG-001: remove persistent-shell consent and invoke the mutation guard', async () => {
        guardError = captureMissingConsentGuard(isolationComponent);
        await bravoPage.close();
      });

      await test.step('Assert NEG-001: the guard reports the undeletable-shell risk before navigation', async () => {
        await expect.poll(() => guardError).toContain('requires E2E_ALLOW_PERSISTENT_TEST_DATA=true');
        await expect.poll(() => page.url()).toBe('about:blank');
      });
    }
  );
});
