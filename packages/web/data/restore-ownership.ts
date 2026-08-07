export type RestoreDecision = 'already-restored' | 'restore-owned-state' | 'conflict';

export type SkuState = Array<{ skuId: number; isHero: boolean }>;
export type ChannelConfigState = { maxHeroSKUs: number | null; minHeroSKUs: number | null };

export function sameSkuState(left: SkuState, right: SkuState): boolean {
  return (
    left.length === right.length &&
    left.every((entry) => right.some((sku) => sku.skuId === entry.skuId && sku.isHero === entry.isHero))
  );
}

export function decideSkuRestore(live: SkuState, original: SkuState, lastWritten?: SkuState): RestoreDecision {
  if (sameSkuState(live, original)) return 'already-restored';
  if (lastWritten && sameSkuState(live, lastWritten)) return 'restore-owned-state';
  return 'conflict';
}

export function sameChannelConfig(left: ChannelConfigState, right: ChannelConfigState): boolean {
  return left.maxHeroSKUs === right.maxHeroSKUs && left.minHeroSKUs === right.minHeroSKUs;
}

export function decideChannelRestore(
  live: ChannelConfigState,
  original: ChannelConfigState,
  lastWritten?: ChannelConfigState
): RestoreDecision {
  if (sameChannelConfig(live, original)) return 'already-restored';
  if (lastWritten && sameChannelConfig(live, lastWritten)) return 'restore-owned-state';
  return 'conflict';
}
