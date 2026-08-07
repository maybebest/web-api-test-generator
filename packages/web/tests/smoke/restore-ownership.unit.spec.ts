import { test, expect } from '@playwright/test';
import { decideChannelRestore, decideSkuRestore } from '../../data/restore-ownership';
import { createTestDataManager } from '../../fixtures/test-data-manager';

test('restore ownership permits owned and already-restored states but rejects divergence', () => {
  const originalSkus = [{ skuId: 1, isHero: false }];
  const writtenSkus = [{ skuId: 2, isHero: true }];

  expect(decideSkuRestore(originalSkus, originalSkus, writtenSkus)).toBe('already-restored');
  expect(decideSkuRestore(writtenSkus, originalSkus, writtenSkus)).toBe('restore-owned-state');
  expect(decideSkuRestore([{ skuId: 3, isHero: false }], originalSkus, writtenSkus)).toBe('conflict');

  const originalChannel = { maxHeroSKUs: 3, minHeroSKUs: 1 };
  const writtenChannel = { maxHeroSKUs: 2, minHeroSKUs: 1 };
  expect(decideChannelRestore(originalChannel, originalChannel, writtenChannel)).toBe('already-restored');
  expect(decideChannelRestore(writtenChannel, originalChannel, writtenChannel)).toBe('restore-owned-state');
  expect(decideChannelRestore({ maxHeroSKUs: 4, minHeroSKUs: 1 }, originalChannel, writtenChannel)).toBe('conflict');
});

test('created-data cleanup includes ownership-aware restoration when no resources were created', async () => {
  const manager = createTestDataManager();

  expect(manager.cleanupCreatedTestData).not.toBe(manager.restoreMutatedTestData);
  await manager.cleanupCreatedTestData();
  await manager.restoreMutatedTestData();
});
