// Spec-bound header: sha256 is the behavioral hash of the spec (computed via
// scripts/ai/lib/spec-parser.mjs specSha256). Re-stamp after behavioral spec changes.
/* spec: specs/secondary-space/nectar-ai-secondary-space-live.md version:1.0.0 sha256:57a0d9c707ddcebddb8c72d344896e189f101a177fe534c422dc803250f3b5fe */
import { expect, test } from '../../../fixtures/test';
import {
  deleteOwnedSecondarySpacePlan,
  readSecondarySpaceFixtureSnapshot,
  readSecondarySpaceCycleFixture,
  readSecondarySpacePlan,
  requireInStoreAdvertiserBrand,
  requireSecondarySpaceMutationPolicy,
  secondarySpaceFixtureNames,
  type BaseSecondarySpaceMedia,
  type PersistedSecondarySpaceChannel,
  type SecondarySpaceCycleFixture
} from '../../../fixtures/secondary-space.fixture';
import { SecondarySpacePage } from '../../../pages/SecondarySpacePage';

const advertiser = process.env.E2E_SECONDARY_SPACE_ADVERTISER?.trim() || 'N360_Unilever_MS';
const brand = process.env.E2E_SECONDARY_SPACE_BRAND?.trim() || 'Unilever | Persil | MS';
const objective = 'Customer retention';
const productSearch = process.env.E2E_SECONDARY_SPACE_PRODUCT_SEARCH?.trim() || 'persil';

const formatDdMmYyyy = (date: Date): string =>
  `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;

const channelRequest = (channelName: string, cycle: SecondarySpaceCycleFixture): string =>
  `In-store, ${channelName}, ${formatDdMmYyyy(new Date(cycle.startDate))} till ` +
  `${formatDdMmYyyy(new Date(cycle.endDate))}, the budget is £7,000, Self-Serve, 100 stores, ` +
  `C${cycle.cycle} G${cycle.foodGroup}`;

const liveChannelRequest = async (channelName: string): Promise<string> =>
  channelRequest(channelName, await readSecondarySpaceCycleFixture());

const assetContract = (media: BaseSecondarySpaceMedia): Array<{ id: number; mandatory: boolean; name: string | null }> =>
  media.piggyBackAssetTypes
    .map(({ id, mandatory, name }) => ({ id, mandatory, name }))
    .sort((left, right) => left.id - right.id);

const persistedAssets = (channel: PersistedSecondarySpaceChannel | undefined): Array<{ id: number; quantity: number }> =>
  (channel?.piggyBackAssets ?? [])
    .map(({ id, quantity }) => ({ id, quantity }))
    .sort((left, right) => left.id - right.id);

const channelForMedia = (
  channels: PersistedSecondarySpaceChannel[],
  mediaId: string
): PersistedSecondarySpaceChannel | undefined => channels.find((channel) => channel.mediaId === mediaId);

const expectedAssets = (
  media: BaseSecondarySpaceMedia,
  optionalQuantities: number[]
): Array<{ id: number; quantity: number }> => {
  let optionalIndex = 0;
  return media.piggyBackAssetTypes
    .map((asset) => ({
      id: asset.id,
      quantity: asset.mandatory ? 1 : (optionalQuantities[optionalIndex++] ?? 0)
    }))
    .sort((left, right) => left.id - right.id);
};

async function reachChannelStage(planningPage: SecondarySpacePage): Promise<string> {
  await requireInStoreAdvertiserBrand(advertiser, brand);
  await planningPage.goto();
  await planningPage.startNectarAiPlanner();
  await planningPage.chooseBuildByObjectiveAndBudget();
  await planningPage.selectAdvertiser(advertiser);
  await planningPage.selectBrand(brand);
  await planningPage.confirmAdvertiserAndBrand();
  const sessionId = await planningPage.currentSessionId();
  await planningPage.enterObjective(objective);
  await planningPage.searchProducts(productSearch);
  await planningPage.selectFirstProduct();
  await planningPage.confirmProducts();
  return sessionId;
}

async function cleanupCreatedPlan(sessionId: string | undefined, startedAt: number): Promise<void> {
  if (sessionId) {
    await deleteOwnedSecondarySpacePlan(sessionId, startedAt);
  }
}

test.describe('Nectar AI Secondary Space live contracts', () => {
  for (const dataCase of [{ caseId: 'DC-001' }] as const) {
    test(
    `TC-SEC-001 ${dataCase.caseId} direct and cached Base configurations resolve consistently`,
    { tag: ['@generated', '@regression', '@secondary-space', '@authenticated'] },
    async () => {
      let snapshot: Awaited<ReturnType<typeof readSecondarySpaceFixtureSnapshot>> | undefined;

      await test.step('AC-001: read the linked Pollen and direct/cache Base configurations', async () => {
        snapshot = await readSecondarySpaceFixtureSnapshot();
      });

      await test.step('Assert AC-001: each linked Base configuration is complete and cache-consistent', async () => {
        await expect.poll(() => snapshot?.publicDirect.id).toBe(snapshot?.publicMedia.baseAssetType.id);
        await expect.poll(() => snapshot?.publicCache.id).toBe(snapshot?.publicMedia.baseAssetType.id);
        await expect.poll(() => snapshot?.internalDirect.id).toBe(snapshot?.internalMedia.baseAssetType.id);
        await expect.poll(() => snapshot?.internalCache.id).toBe(snapshot?.internalMedia.baseAssetType.id);
        await expect.poll(() => (snapshot ? assetContract(snapshot.publicCache) : [])).toEqual(
          snapshot ? assetContract(snapshot.publicDirect) : []
        );
        await expect.poll(() => (snapshot ? assetContract(snapshot.internalCache) : [])).toEqual(
          snapshot ? assetContract(snapshot.internalDirect) : []
        );
        await expect.poll(() => snapshot?.publicDirect.piggyBackAssetTypes.length).toBeGreaterThan(0);
        await expect.poll(() => snapshot?.internalDirect.piggyBackAssetTypes.length).toBeGreaterThan(0);
        await expect
          .poll(() => snapshot?.publicDirect.piggyBackAssetTypes.every((asset) => Boolean(asset.name?.trim())))
          .toBe(true);
        await expect
          .poll(() => snapshot?.internalDirect.piggyBackAssetTypes.every((asset) => Boolean(asset.name?.trim())))
          .toBe(true);
      });
    }
    );
  }

  for (const dataCase of [{ caseId: 'DC-002' }] as const) {
    test(
    `TC-SEC-002 ${dataCase.caseId} internal account resolves public and internal-only fixtures`,
    { tag: ['@generated', '@regression', '@secondary-space', '@authenticated'] },
    async () => {
      let snapshot: Awaited<ReturnType<typeof readSecondarySpaceFixtureSnapshot>> | undefined;

      await test.step('AC-002: read the authenticated role and both Secondary Space fixtures', async () => {
        snapshot = await readSecondarySpaceFixtureSnapshot();
      });

      await test.step('Assert AC-002: visibility metadata distinguishes the public and internal fixtures', async () => {
        await expect.poll(() => snapshot?.profile.partner.type).toMatch(/internal/i);
        await expect.poll(() => snapshot?.publicMedia).toMatchObject({
          name: secondarySpaceFixtureNames.publicMedia,
          isVisible: true,
          isVisibleToInternalOnly: false
        });
        await expect.poll(() => snapshot?.internalMedia).toMatchObject({
          name: secondarySpaceFixtureNames.internalMedia,
          isVisible: true,
          isVisibleToInternalOnly: true
        });
        await expect.poll(() => snapshot?.publicDirect.piggyBackAssetTypes.length).toBeGreaterThan(0);
        await expect.poll(() => snapshot?.internalDirect.piggyBackAssetTypes.length).toBeGreaterThan(0);
      });
    }
    );
  }

  for (const dataCase of [{ caseId: 'DC-003' }] as const) {
    test(
    `TC-SEC-004 ${dataCase.caseId} mandatory quantity defaults, updates, and locks after confirmation`,
    { tag: ['@generated', '@regression', '@secondary-space', '@authenticated'] },
    async ({ page }) => {
      test.setTimeout(600_000);
      requireSecondarySpaceMutationPolicy();
      const startedAt = Date.now();
      const planningPage = new SecondarySpacePage(page);
      let sessionId: string | undefined;
      let initialValues: string[] = [];
      let optionValues: string[] = [];
      let initialSelection = '';
      let updatedValues: string[] = [];
      let updatedSelection = '';
      let locked = false;

      try {
        await test.step('AC-003: create an isolated plan and request the public Secondary Space fixture', async () => {
          sessionId = await reachChannelStage(planningPage);
          await planningPage.requestSecondarySpaceChannel(
            await liveChannelRequest(secondarySpaceFixtureNames.publicMedia),
            secondarySpaceFixtureNames.publicMedia
          );
        });

        await test.step('AC-003: inspect the default, set quantity four, and confirm mandatory elements', async () => {
          initialValues = await planningPage.secondaryStageValues('mandatory');
          optionValues = await planningPage.secondaryStageOptionValues('mandatory');
          initialSelection = await planningPage.secondaryStageSelectionText('mandatory');
          await planningPage.selectSecondaryQuantity('mandatory', 0, 4);
          updatedValues = await planningPage.secondaryStageValues('mandatory');
          updatedSelection = await planningPage.secondaryStageSelectionText('mandatory');
          await planningPage.confirmSecondaryStage('mandatory');
          locked = await planningPage.secondaryStageControlsLocked('mandatory');
        });

        await test.step('Assert AC-003: mandatory selection uses 1-10 quantities and becomes immutable', async () => {
          await expect.poll(() => initialValues).toEqual(['1']);
          await expect.poll(() => optionValues).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
          await expect.poll(() => initialSelection).toBe('1 Selected');
          await expect.poll(() => updatedValues).toEqual(['4']);
          await expect.poll(() => updatedSelection).toBe('4 Selected');
          await expect.poll(() => locked).toBe(true);
          await expect(planningPage.secondaryStageTitle('optional')).toBeVisible();
        });
      } finally {
        await cleanupCreatedPlan(sessionId, startedAt);
      }
    }
    );
  }

  for (const dataCase of [{ caseId: 'DC-004' }] as const) {
    test(
      `TC-SEC-005 ${dataCase.caseId} optional zero state and Assign all persist both quantities`,
      { tag: ['@generated', '@regression', '@secondary-space', '@authenticated'] },
      async ({ page }) => {
        test.setTimeout(600_000);
        requireSecondarySpaceMutationPolicy();
        const startedAt = Date.now();
        const planningPage = new SecondarySpacePage(page);
        let sessionId: string | undefined;
        let fixture: Awaited<ReturnType<typeof readSecondarySpaceFixtureSnapshot>> | undefined;
        let optionalDefaults: string[] = [];
        let optionalOptions: string[] = [];
        let optionalSelection = '';
        let zeroConfirmDisabled = false;
        let zeroSkipEnabled = false;
        let assignedValues: string[] = [];
        let assignedSelection = '';
        let persistedChannel: PersistedSecondarySpaceChannel | undefined;

        try {
          await test.step('AC-004: create an isolated plan and reach the optional Secondary Space step', async () => {
            fixture = await readSecondarySpaceFixtureSnapshot();
            sessionId = await reachChannelStage(planningPage);
            await planningPage.requestSecondarySpaceChannel(
              await liveChannelRequest(secondarySpaceFixtureNames.publicMedia),
              secondarySpaceFixtureNames.publicMedia
            );
            await planningPage.confirmSecondaryStage('mandatory');
          });

          await test.step('AC-004: inspect zero defaults, use Assign all, confirm, and read the plan', async () => {
            optionalDefaults = await planningPage.secondaryStageValues('optional');
            optionalOptions = await planningPage.secondaryStageOptionValues('optional');
            optionalSelection = await planningPage.secondaryStageSelectionText('optional');
            zeroConfirmDisabled = await planningPage.activeSecondaryConfirmButton().isDisabled();
            zeroSkipEnabled = await planningPage.activeSecondarySkipButton().isEnabled();
            await planningPage.selectSecondaryQuantity('optional', 0, 3);
            await planningPage.assignSecondaryQuantityToAll('optional');
            assignedValues = await planningPage.secondaryStageValues('optional');
            assignedSelection = await planningPage.secondaryStageSelectionText('optional');
            await planningPage.confirmSecondaryStage('optional');
            await planningPage.waitForSummaryChannel(secondarySpaceFixtureNames.publicMedia);
            const plan = await readSecondarySpacePlan(sessionId!);
            persistedChannel = channelForMedia(plan.channels.instore, fixture!.publicMedia.id);
          });

          await test.step('Assert AC-004: zero gating, bulk assignment, and persisted quantities agree', async () => {
            await expect.poll(() => optionalDefaults).toEqual(['0', '0']);
            await expect.poll(() => optionalOptions).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
            await expect.poll(() => optionalSelection).toBe('0 Selected');
            await expect.poll(() => zeroConfirmDisabled).toBe(true);
            await expect.poll(() => zeroSkipEnabled).toBe(true);
            await expect.poll(() => assignedValues).toEqual(['3', '3']);
            await expect.poll(() => assignedSelection).toBe('6 Selected');
            await expect.poll(() => persistedAssets(persistedChannel)).toEqual(expectedAssets(fixture!.publicDirect, [3, 3]));
          });
        } finally {
          await cleanupCreatedPlan(sessionId, startedAt);
        }
      }
    );
  }

  for (const dataCase of [{ caseId: 'DC-005' }] as const) {
    test(
      `TC-SEC-006 ${dataCase.caseId} manual optional selections hydrate and update through Edit Channel`,
      { tag: ['@generated', '@regression', '@secondary-space', '@authenticated'] },
      async ({ page }) => {
        test.setTimeout(600_000);
        requireSecondarySpaceMutationPolicy();
        const startedAt = Date.now();
        const planningPage = new SecondarySpacePage(page);
        let sessionId: string | undefined;
        let fixture: Awaited<ReturnType<typeof readSecondarySpaceFixtureSnapshot>> | undefined;
        let editMandatoryValues: string[] = [];
        let editOptionalValues: string[] = [];
        let editOptionalCheckedStates: boolean[] = [];
        let editAssignAllCount = -1;
        let beforeEdit: PersistedSecondarySpaceChannel | undefined;
        let afterEdit: PersistedSecondarySpaceChannel | undefined;

        try {
          await test.step('Arrange AC-005: manually select both optional quantities and confirm the channel', async () => {
            fixture = await readSecondarySpaceFixtureSnapshot();
            sessionId = await reachChannelStage(planningPage);
            await planningPage.requestSecondarySpaceChannel(
              await liveChannelRequest(secondarySpaceFixtureNames.publicMedia),
              secondarySpaceFixtureNames.publicMedia
            );
            await planningPage.confirmSecondaryStage('mandatory');
            await planningPage.selectSecondaryQuantity('optional', 0, 3);
            await planningPage.selectSecondaryQuantity('optional', 1, 3);
            await planningPage.confirmSecondaryStage('optional');
            await planningPage.waitForSummaryChannel(secondarySpaceFixtureNames.publicMedia);
            const plan = await readSecondarySpacePlan(sessionId!);
            beforeEdit = channelForMedia(plan.channels.instore, fixture!.publicMedia.id);
          });

          await test.step('Act AC-005: edit the confirmed channel and change the second optional quantity', async () => {
            await planningPage.openChannelEdit(secondarySpaceFixtureNames.publicMedia);
            editMandatoryValues = await planningPage.editMandatoryValues();
            editOptionalValues = await planningPage.editOptionalValues();
            editOptionalCheckedStates = await planningPage.editOptionalCheckedStates();
            editAssignAllCount = await planningPage.editAssignAllCount();
            await planningPage.selectEditOptionalQuantity(1, 5);
            await planningPage.saveChannelEdit();
            const plan = await readSecondarySpacePlan(sessionId!);
            afterEdit = channelForMedia(plan.channels.instore, fixture!.publicMedia.id);
          });

          await test.step('Assert AC-005: edit hydration and the intended quantity update are exact', async () => {
            await expect.poll(() => editMandatoryValues).toEqual(['1']);
            await expect.poll(() => editOptionalValues).toEqual(['3', '3']);
            await expect.poll(() => editOptionalCheckedStates).toEqual([true, true]);
            await expect.poll(() => editAssignAllCount).toBe(0);
            await expect.poll(() => persistedAssets(beforeEdit)).toEqual(expectedAssets(fixture!.publicDirect, [3, 3]));
            await expect.poll(() => persistedAssets(afterEdit)).toEqual(expectedAssets(fixture!.publicDirect, [3, 5]));
            await expect(planningPage.summaryChannel(secondarySpaceFixtureNames.publicMedia)).toBeVisible();
          });
        } finally {
          await cleanupCreatedPlan(sessionId, startedAt);
        }
      }
    );
  }

  for (const dataCase of [{ caseId: 'DC-006' }] as const) {
    test(
      `TC-SEC-007 ${dataCase.caseId} confirmed manual optional selections survive save and reload`,
      { tag: ['@generated', '@regression', '@secondary-space', '@authenticated'] },
      async ({ page }) => {
        test.setTimeout(900_000);
        requireSecondarySpaceMutationPolicy();
        const startedAt = Date.now();
        const planningPage = new SecondarySpacePage(page);
        let sessionId: string | undefined;
        let fixture: Awaited<ReturnType<typeof readSecondarySpaceFixtureSnapshot>> | undefined;
        let beforeSave: PersistedSecondarySpaceChannel | undefined;
        let afterSave: PersistedSecondarySpaceChannel | undefined;
        let afterReload: PersistedSecondarySpaceChannel | undefined;

        try {
          await test.step('Arrange AC-006: manually confirm both optional quantities in an isolated plan', async () => {
            fixture = await readSecondarySpaceFixtureSnapshot();
            sessionId = await reachChannelStage(planningPage);
            await planningPage.requestSecondarySpaceChannel(
              await liveChannelRequest(secondarySpaceFixtureNames.publicMedia),
              secondarySpaceFixtureNames.publicMedia
            );
            await planningPage.confirmSecondaryStage('mandatory');
            await planningPage.selectSecondaryQuantity('optional', 0, 3);
            await planningPage.selectSecondaryQuantity('optional', 1, 3);
            await planningPage.confirmSecondaryStage('optional');
            await planningPage.waitForSummaryChannel(secondarySpaceFixtureNames.publicMedia);
            const plan = await readSecondarySpacePlan(sessionId!);
            beforeSave = channelForMedia(plan.channels.instore, fixture!.publicMedia.id);
          });

          await test.step('Act AC-006: save the draft and restore the same planning session', async () => {
            await planningPage.confirmPlan();
            await planningPage.savePlan();
            const savedPlan = await readSecondarySpacePlan(sessionId!);
            afterSave = channelForMedia(savedPlan.channels.instore, fixture!.publicMedia.id);
            await planningPage.gotoSession(sessionId!);
            await planningPage.waitForSummaryChannel(secondarySpaceFixtureNames.publicMedia);
            const restoredPlan = await readSecondarySpacePlan(sessionId!);
            afterReload = channelForMedia(restoredPlan.channels.instore, fixture!.publicMedia.id);
          });

          await test.step('Assert AC-006: exact optional asset identities survive save and reload', async () => {
            await expect.poll(() => persistedAssets(beforeSave)).toEqual(expectedAssets(fixture!.publicDirect, [3, 3]));
            await expect.poll(() => persistedAssets(afterSave)).toEqual(expectedAssets(fixture!.publicDirect, [3, 3]));
            await expect.poll(() => persistedAssets(afterReload)).toEqual(expectedAssets(fixture!.publicDirect, [3, 3]));
            await expect(planningPage.summaryChannel(secondarySpaceFixtureNames.publicMedia)).toBeVisible();
          });
        } finally {
          await cleanupCreatedPlan(sessionId, startedAt);
        }
      }
    );
  }

  test(
    'TC-SEC-005 NEG-001 optional zero total cannot be confirmed',
    { tag: ['@generated', '@regression', '@secondary-space', '@authenticated'] },
    async ({ page }) => {
      test.setTimeout(600_000);
      requireSecondarySpaceMutationPolicy();
      const startedAt = Date.now();
      const planningPage = new SecondarySpacePage(page);
      let sessionId: string | undefined;

      try {
        await test.step('NEG-001: create an isolated plan and reach untouched optional elements', async () => {
          sessionId = await reachChannelStage(planningPage);
          await planningPage.requestSecondarySpaceChannel(
            await liveChannelRequest(secondarySpaceFixtureNames.publicMedia),
            secondarySpaceFixtureNames.publicMedia
          );
          await planningPage.confirmSecondaryStage('mandatory');
        });

        await test.step('Assert NEG-001: zero optional total disables Confirm while preserving Skip', async () => {
          await expect(planningPage.secondaryStageSelectionCount('optional')).toHaveText('0 Selected');
          await expect(planningPage.activeSecondaryConfirmButton()).toBeDisabled();
          await expect(planningPage.activeSecondarySkipButton()).toBeEnabled();
        });
      } finally {
        await cleanupCreatedPlan(sessionId, startedAt);
      }
    }
  );
});
