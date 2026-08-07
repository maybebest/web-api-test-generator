// Spec-bound header: sha256 is the behavioral hash of the spec.
/* spec: specs/sains/hfss-category-eligibility.md version:1.0.0 sha256:e303d59ad94059a6a068a4cdd44f5c36fc9ccad314ac2aa54582f1321caafc5c */
import { expect, test } from '../../../fixtures/test';
import {
  HfssEligibilityComponent,
  type HfssCleanupResult,
  type HfssEligibilityResult,
  type HfssFixtureEvidence
} from '../../../pages/HfssEligibilityComponent';

const expected = {
  mediaId: '6981e2dd205dfe855026fdff',
  channel: 'OK_Offsite_HFSS',
  restrictedCategories: ['BABY', 'BWS', 'PET_DOG']
} as const;

function captureMissingConsentGuard(component: HfssEligibilityComponent): string {
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

test.describe.serial('HFSS eligibility filtering — live offsite mixed-SKU core', () => {
  test.describe.configure({ retries: 0 });

  test(
    'DC-001 XLSX::TC-VAL-003 filters only the ineligible Hero and retains the eligible channel remainder',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@eligibility'] },
    async ({ page }) => {
      test.setTimeout(600_000);
      test.info().annotations.push({
        type: 'covered-ac-ids',
        description: 'AC-001 AC-002 AC-003 AC-004'
      });

      const eligibilityComponent = new HfssEligibilityComponent(page);
      let fixtureEvidence: HfssFixtureEvidence | undefined;
      let outcome: HfssEligibilityResult | undefined;
      let cleanup: HfssCleanupResult | undefined;
      let sessionId: string | undefined;
      let primaryError: unknown;
      let cleanupError: unknown;

      eligibilityComponent.requirePersistentConversationConsent();

      try {
        await test.step('Arrange AC-001: fail closed on the exact live restriction fixtures', async () => {
          fixtureEvidence = await eligibilityComponent.preflightLiveFixtures();
        });

        await test.step('Arrange AC-002: create a fresh mixed-HFSS global Measurement and Hero set', async () => {
          sessionId = await eligibilityComponent.buildMixedHeroSelection();
        });

        await test.step('Act AC-003: add the exact restricted offsite channel and capture both surfaces', async () => {
          // eslint-disable-next-line playwright/no-conditional-in-test -- the guard prevents an unowned live mutation
          if (!sessionId) throw new Error('TC-VAL-003 cannot add a channel without the captured planning session id.');
          outcome = await eligibilityComponent.addRestrictedChannelAndReadOutcome(sessionId);
        });
      } catch (error) {
        primaryError = error;
      } finally {
        // eslint-disable-next-line playwright/no-conditional-in-test -- cleanup is only possible after session creation
        if (sessionId) {
          try {
            cleanup = await test.step(
              'Cleanup AC-004: remove the test-owned channel from the retained session',
              async () => {
                const result = await eligibilityComponent.cleanupOwnedChannel(sessionId as string);
                return result;
              }
            );
          } catch (error) {
            cleanupError = error;
          }
        }
      }

      // eslint-disable-next-line playwright/no-conditional-in-test -- preserve the actionable primary failure after cleanup
      if (primaryError !== undefined) {
        // eslint-disable-next-line playwright/no-conditional-in-test -- annotate secondary cleanup failure without masking primary
        if (cleanupError !== undefined) {
          test.info().annotations.push({
            type: 'cleanup-error',
            description: `TC-VAL-003 primary failure preserved; channel cleanup also failed: ${String(cleanupError)}`
          });
        }
        throw primaryError;
      }
      // eslint-disable-next-line playwright/no-conditional-in-test -- surface cleanup failure only when no primary failure exists
      if (cleanupError !== undefined) throw cleanupError;
      // eslint-disable-next-line playwright/no-conditional-in-test -- fail closed if the journey returned incomplete evidence
      if (!fixtureEvidence || !outcome || !cleanup || !sessionId) {
        throw new Error('TC-VAL-003 completed without all fixture, outcome, cleanup, and session evidence.');
      }
      const verifiedFixture = fixtureEvidence;
      const verifiedOutcome = outcome;
      const verifiedCleanup = cleanup;
      const verifiedSessionId = sessionId;

      await test.step('Assert AC-004: filtering, feedback, persistence, limits, and cleanup agree', async () => {
        await expect.poll(() => verifiedFixture.mediaId).toBe(expected.mediaId);
        await expect.poll(() => verifiedFixture.hasHfssRestrictions).toBe(true);
        await expect.poll(() => verifiedFixture.restrictedCategories).toEqual(expected.restrictedCategories);
        await expect.poll(() => verifiedFixture.minHeroSkus).toBeNull();
        await expect.poll(() => verifiedFixture.maxHeroSkus).toBeNull();
        await expect.poll(() => verifiedFixture.restrictedSkuIsHfss).toBe(true);
        await expect.poll(() => verifiedFixture.eligibleSkuIsHfss).toBe(false);

        await expect.poll(() => verifiedOutcome.sessionId).toBe(verifiedSessionId);
        await expect.poll(() => verifiedOutcome.feedbackText).toContain(expected.channel);
        await expect.poll(() => verifiedOutcome.feedbackText).toContain('not HFSS compliant');
        await expect.poll(() => verifiedOutcome.summaryChannelCount).toBe(1);
        await expect.poll(() => verifiedOutcome.globalSkuIds).toEqual([8161985, 8184969]);
        await expect.poll(() => verifiedOutcome.globalHeroSkuIds).toEqual([8161985, 8184969]);
        await expect.poll(() => verifiedOutcome.channelNamesInOrder).toEqual([expected.channel]);
        await expect.poll(() => verifiedOutcome.channelMediaIds).toEqual([expected.mediaId]);
        await expect.poll(() => verifiedOutcome.channelHeroSkuIds).toEqual([8184969]);
        await expect.poll(() => verifiedOutcome.channelHasHfssRestrictions).toBe(true);
        await expect.poll(() => verifiedOutcome.channelRestrictedCategories).toEqual(expected.restrictedCategories);
        await expect.poll(() => verifiedOutcome.channelMinHeroSkus).toBeNull();
        await expect.poll(() => verifiedOutcome.channelMaxHeroSkus).toBeNull();
        await expect.poll(() => verifiedOutcome.historyJson).toContain('8161985');
        await expect.poll(() => verifiedOutcome.historyJson).toContain('8184969');
        await expect.poll(() => verifiedOutcome.historyJson).toContain(expected.channel);
        await expect.poll(() => verifiedOutcome.historyJson).toContain('not HFSS compliant');

        await expect.poll(() => verifiedCleanup.remainingChannelNames).toEqual([]);
        await expect.poll(() => verifiedCleanup.retainedConversationShells).toBe(1);
      });
    }
  );

  test(
    'NEG-001 missing persistent-conversation consent fails before UI mutation',
    { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@eligibility'] },
    async ({ page }) => {
      const eligibilityComponent = new HfssEligibilityComponent(page);
      let guardError = '';

      await test.step('NEG-001: remove persistent-conversation consent and invoke the guard', async () => {
        guardError = captureMissingConsentGuard(eligibilityComponent);
      });

      await test.step('Assert NEG-001: the guard reports the retained-shell risk before navigation', async () => {
        await expect.poll(() => guardError).toContain('requires E2E_ALLOW_PERSISTENT_TEST_DATA=true');
        await expect.poll(() => page.url()).toBe('about:blank');
      });
    }
  );
});
