/**
 * Expected-value oracles for SKU suites whose live per-channel/parser signals
 * are not available yet. These functions do not claim to test the product;
 * they provide deterministic expectations for future authenticated E2E tests.
 */

export type ParsedSkuPrompt = {
  recognizedSinglePrompt: boolean;
  measurementSkus: string[];
  heroSkus: string[];
  unknownSkus: string[];
};

export type HeroLimitEvaluation = {
  withinMinimum: boolean;
  withinMaximum: boolean;
  bookable: boolean;
  warning: string | null;
};

export type ChannelHeroState = Readonly<Record<string, readonly string[]>>;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function numericSkus(value: string): string[] {
  return unique(value.match(/\b\d+\b/g) ?? []);
}

function orderedUnion(first: readonly string[], second: readonly string[]): string[] {
  return unique([...first, ...second]);
}

/**
 * Parse the documented "measurement ... and hero skus ..." grammar.
 * Hero SKUs are included in Measurement by definition. Unknown catalogue IDs
 * remain visible in `unknownSkus` so a caller cannot silently drop them.
 */
export function parseHeroMeasurementPrompt(
  prompt: string,
  brandLinkedSkus: readonly string[]
): ParsedSkuPrompt {
  const heroMarker = /\bhero\s+skus?\b\s*:?/i;
  const marker = heroMarker.exec(prompt);
  if (!marker) {
    const measurementSkus = numericSkus(prompt);
    const linked = new Set(brandLinkedSkus);
    return {
      recognizedSinglePrompt: false,
      measurementSkus,
      heroSkus: [],
      unknownSkus: measurementSkus.filter((sku) => !linked.has(sku))
    };
  }

  const before = prompt.slice(0, marker.index);
  const after = prompt.slice(marker.index + marker[0].length);
  let measurementClause = numericSkus(before);
  let heroClause = numericSkus(after);
  if (measurementClause.length === 0) {
    const [heroFirst, ...measurementRest] = after.split(/\band\b/i);
    heroClause = numericSkus(heroFirst);
    measurementClause = numericSkus(measurementRest.join(' and '));
  }
  const hasBothLists = measurementClause.length > 0 && heroClause.length > 0;
  const measurementSkus = hasBothLists ? orderedUnion(measurementClause, heroClause) : measurementClause;
  const heroSkus = hasBothLists ? heroClause : [];
  const linked = new Set(brandLinkedSkus);

  return {
    recognizedSinglePrompt: hasBothLists,
    measurementSkus,
    heroSkus,
    unknownSkus: orderedUnion(measurementSkus, heroSkus).filter((sku) => !linked.has(sku))
  };
}

export function evaluateHeroLimit(
  heroCount: number,
  maxHeroSkus: number | null,
  minHeroSkus = 0
): HeroLimitEvaluation {
  for (const [name, value] of [
    ['heroCount', heroCount],
    ['minHeroSkus', minHeroSkus]
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative safe integer`);
    }
  }
  if (maxHeroSkus !== null && (!Number.isSafeInteger(maxHeroSkus) || maxHeroSkus < 0)) {
    throw new RangeError('maxHeroSkus must be null or a non-negative safe integer');
  }
  if (maxHeroSkus !== null && minHeroSkus > maxHeroSkus) {
    throw new RangeError('minHeroSkus cannot exceed maxHeroSkus');
  }

  const withinMinimum = heroCount >= minHeroSkus;
  const withinMaximum = maxHeroSkus === null || heroCount <= maxHeroSkus;
  return {
    withinMinimum,
    withinMaximum,
    bookable: withinMinimum && withinMaximum,
    warning: withinMaximum ? null : `Media limit: ${maxHeroSkus} Hero SKUs. Edit SKUs`
  };
}

function normalizedState(state: ChannelHeroState): Record<string, string[]> {
  return Object.fromEntries(Object.entries(state).map(([channel, skus]) => [channel, unique(skus)]));
}

export function editChannelHeroSkus(
  state: ChannelHeroState,
  channel: string,
  heroSkus: readonly string[]
): Record<string, string[]> {
  if (!Object.hasOwn(state, channel)) {
    throw new Error(`unknown channel: ${channel}`);
  }
  return { ...normalizedState(state), [channel]: unique(heroSkus) };
}

export function removeSkuFromEveryChannel(
  state: ChannelHeroState,
  sku: string
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(normalizedState(state)).map(([channel, skus]) => [
      channel,
      skus.filter((candidate) => candidate !== sku)
    ])
  );
}

export function deleteChannel(state: ChannelHeroState, channel: string): Record<string, string[]> {
  if (!Object.hasOwn(state, channel)) {
    throw new Error(`unknown channel: ${channel}`);
  }
  return Object.fromEntries(Object.entries(normalizedState(state)).filter(([name]) => name !== channel));
}

export function uniqueHeroSkus(state: ChannelHeroState): string[] {
  return unique(Object.values(state).flatMap((skus) => [...skus]));
}
