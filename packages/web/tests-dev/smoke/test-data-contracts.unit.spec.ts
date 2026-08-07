import { expect, test } from '../../fixtures/test';
import {
  createTestDataManager,
  extractCategorySkuIds,
  NotImplementedTestDataError,
  REQUIRED_EXTERNAL_TEST_DATA_CONTRACTS,
  type TestDataContracts
} from '../../fixtures/test-data-manager';

test('external contract inventory records the verified schema candidates and rollback blockers', () => {
  expect(REQUIRED_EXTERNAL_TEST_DATA_CONTRACTS.map(({ name }) => name)).toEqual([
    'linkSkuToBrand',
    'unlinkSkuFromBrand',
    'createMediaPlan',
    'assignChannelToPlan',
    'deleteMediaPlan'
  ]);
  const requirements = Object.fromEntries(
    REQUIRED_EXTERNAL_TEST_DATA_CONTRACTS.map(({ name, needs }) => [name, needs])
  );
  expect(requirements.linkSkuToBrand).toContain('189 introspected mutations');
  expect(requirements.createMediaPlan).toContain('planning_savePartial/CompleteCampaignDetailsAndBudget');
  expect(requirements.createMediaPlan).toContain('non-null briefId and advertiserId');
  expect(requirements.assignChannelToPlan).toContain('planning_savePartial/CompleteChannelsAndMedia');
  expect(requirements.deleteMediaPlan).toContain('planning_deletePlan(planId:ID!, briefId:ID!, advertiserId:ID!)');
});

test('captured category-tree read is flattened into unique, numerically sorted SKU ids', () => {
  expect(
    extractCategorySkuIds([
      {
        subCategories: [
          { skus: [{ skuId: 10 }, { skuId: 2 }] },
          { subCategories: [{ skus: [{ skuId: 2 }, { skuId: 3 }] }] }
        ]
      }
    ])
  ).toEqual(['2', '3', '10']);
});

function catalogueHarness(initial: string[]): {
  contracts: TestDataContracts;
  linked: Set<string>;
  writes: string[];
} {
  const linked = new Set(initial);
  const writes: string[] = [];
  return {
    linked,
    writes,
    contracts: {
      listBrandLinkedSkus: async () => [...linked],
      linkSkuToBrand: async (sku) => {
        writes.push(`link:${sku}`);
        linked.add(sku);
      },
      unlinkSkuFromBrand: async (sku) => {
        writes.push(`unlink:${sku}`);
        linked.delete(sku);
      }
    }
  };
}

test('catalogue helpers enumerate, ensure, mutate, verify, and restore only manager-owned links', async () => {
  const harness = catalogueHarness(['10', '2', '2']);
  const manager = createTestDataManager(harness.contracts);

  await expect(manager.listBrandLinkedSkus('Example brand')).resolves.toEqual(['2', '10']);
  await manager.ensureBrandLinkedSkus('Example brand', ['002', '3', '3']);
  await manager.unlinkSkuFromBrand('10', 'Example brand');

  expect([...harness.linked].sort()).toEqual(['2', '3']);
  expect(harness.writes).toEqual(['link:3', 'unlink:10']);

  await manager.restoreMutatedTestData();
  expect([...harness.linked].sort()).toEqual(['10', '2']);
  expect(harness.writes).toEqual(['link:3', 'unlink:10', 'unlink:3', 'link:10']);
});

test('catalogue mutation fails closed before writing when its inverse cleanup contract is absent', async () => {
  let writes = 0;
  const manager = createTestDataManager({
    listBrandLinkedSkus: async () => [],
    linkSkuToBrand: async () => {
      writes += 1;
    }
  });

  await expect(manager.linkSkuToBrand('1', 'Example brand')).rejects.toBeInstanceOf(NotImplementedTestDataError);
  expect(writes).toBe(0);
});

test('disposable media-plan contracts create, assign, explicitly delete, and reject unowned ids', async () => {
  const events: string[] = [];
  const manager = createTestDataManager({
    createMediaPlan: async (advertiser, brand) => {
      events.push(`create:${advertiser}:${brand}`);
      return 'owned-plan-1';
    },
    assignChannelToPlan: async (planId, channel, budget, startOffsetDays) => {
      events.push(`assign:${planId}:${channel}:${budget}:${startOffsetDays}`);
    },
    deleteMediaPlan: async (planId) => {
      events.push(`delete:${planId}`);
    }
  });

  const planId = await manager.createMediaPlan('Example advertiser', 'Example brand');
  await manager.assignChannelToPlan(planId, 'offsite', '7k', 45);
  await expect(manager.assignChannelToPlan('shared-plan', 'offsite', '7k', 45)).rejects.toThrow(
    'this manager did not create it'
  );
  await manager.deleteMediaPlan(planId);

  expect(events).toEqual([
    'create:Example advertiser:Example brand',
    'assign:owned-plan-1:offsite:7k:45',
    'delete:owned-plan-1'
  ]);
  await manager.cleanupCreatedTestData();
});

test('media-plan creation is refused before writing when deletion is unavailable', async () => {
  let writes = 0;
  const manager = createTestDataManager({
    createMediaPlan: async () => {
      writes += 1;
      return 'leaked-plan';
    }
  });

  await expect(manager.createMediaPlan('Example advertiser', 'Example brand')).rejects.toBeInstanceOf(
    NotImplementedTestDataError
  );
  expect(writes).toBe(0);
});

test('cleanup deletes every disposable plan created by the manager in reverse order', async () => {
  const deleted: string[] = [];
  let sequence = 0;
  const manager = createTestDataManager({
    createMediaPlan: async () => `owned-plan-${++sequence}`,
    deleteMediaPlan: async (planId) => {
      deleted.push(planId);
    }
  });

  await manager.createMediaPlan('Example advertiser', 'Example brand');
  await manager.createMediaPlan('Example advertiser', 'Example brand');
  await manager.cleanupCreatedTestData();

  expect(deleted).toEqual(['owned-plan-2', 'owned-plan-1']);
});

test('fixture-backed feature flags are validated, applied now, and retained for later navigations', async ({
  dataManager,
  page
}) => {
  await dataManager.setFeatureFlags({ FEATURE_NECTAR_AI: false, TEST_ONLY_FLAG: true });
  const expectedFlags = {
    FEATURE_NECTAR_AI: false,
    FEATURE_NUP: true,
    FEATURE_NECTAR_AI_MP: true,
    TEST_ONLY_FLAG: true
  };
  expect(dataManager.featureFlags()).toEqual(expectedFlags);

  await page.goto('/');
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(globalThis.localStorage.getItem('feature-flags') ?? '{}') as Record<string, boolean>)
    )
    .toEqual(expectedFlags);
});
