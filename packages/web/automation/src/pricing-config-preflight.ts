export type PricingConfigurationExpectation = {
  channel: string;
  model: 'cost-per-unit' | 'cost-per-store' | 'budget-led';
  rate?: number;
  managedServiceFee: { kind: 'flat' | 'percentage'; value: number } | 'configured';
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function records(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.map(asRecord).filter((entry): entry is JsonRecord => Boolean(entry));
  }
  const entry = asRecord(value);
  return entry ? [entry] : [];
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nestedCosts(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.flatMap(nestedCosts);
  }
  const object = asRecord(value);
  if (!object) {
    return [];
  }
  return Object.entries(object).flatMap(([key, child]) => {
    if (key.toLowerCase() === 'cost') {
      const cost = finiteNumber(child);
      return cost === undefined ? [] : [cost];
    }
    return nestedCosts(child);
  });
}

function normalized(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9%]+/g, '');
}

function modelMatches(label: unknown, expected: PricingConfigurationExpectation['model']): boolean {
  const candidate = normalized(label);
  if (expected === 'cost-per-unit') {
    return candidate.includes('unit');
  }
  if (expected === 'cost-per-store') {
    return candidate.includes('store');
  }
  return candidate.includes('budget');
}

function deliveryModes(media: JsonRecord): JsonRecord[] {
  return ['inStore', 'offSite', 'onSite', 'atHome']
    .map((mode) => asRecord(media[mode]))
    .filter((mode): mode is JsonRecord => Boolean(mode));
}

/** Fail closed unless the captured admin_getMedia shape proves model/rate/fee parity. */
export function assertPricingConfiguration(
  mediaValue: unknown,
  expected: PricingConfigurationExpectation
): void {
  const media = asRecord(mediaValue);
  if (!media) {
    throw new Error(`pricing-suite preflight: ${expected.channel} returned an invalid media object`);
  }

  const managedServices = deliveryModes(media)
    .map((mode) => asRecord(asRecord(mode.cost)?.managedService))
    .filter((service): service is JsonRecord => Boolean(service));
  if (managedServices.length === 0) {
    throw new Error(`pricing-suite preflight: ${expected.channel} has no managed-service pricing configuration`);
  }

  const matchedServices = managedServices.filter((service) => {
    const rows = records(service.pricingModels);
    if (rows.length > 0) {
      return rows.some((row) => modelMatches(row.pricingModel, expected.model));
    }
    return modelMatches(service.pricingModel, expected.model);
  });
  const matchedRows = matchedServices.flatMap((service) => {
    const rows = records(service.pricingModels);
    return rows.length > 0 ? rows.filter((row) => modelMatches(row.pricingModel, expected.model)) : [service];
  });
  if (matchedRows.length === 0) {
    throw new Error(
      `pricing-suite preflight: ${expected.channel} does not expose the expected ${expected.model} model`
    );
  }

  if (expected.rate !== undefined) {
    const rates = matchedRows.flatMap(nestedCosts);
    if (!rates.some((rate) => Math.abs(rate - expected.rate!) < 0.000_001)) {
      throw new Error(
        `pricing-suite preflight: ${expected.channel} ${expected.model} rate does not match ${expected.rate}`
      );
    }
  }

  // A matching fee from an unrelated delivery mode must not validate this model.
  const feeRecords = matchedServices
    .map((service) => asRecord(service.managedServiceFee))
    .filter((fee): fee is JsonRecord => Boolean(fee));
  if (feeRecords.length === 0) {
    throw new Error(`pricing-suite preflight: ${expected.channel} has no managed-service fee configuration`);
  }
  const expectedFee = expected.managedServiceFee;
  if (expectedFee === 'configured') {
    return;
  }

  const feeMatches = feeRecords.some((fee) => {
    const type = normalized(fee.type);
    const kindMatches =
      expectedFee.kind === 'percentage'
        ? type.includes('percent') || type.includes('%')
        : type.includes('flat') || type.includes('fixed');
    const value = finiteNumber(fee.value);
    return kindMatches && value !== undefined && Math.abs(value - expectedFee.value) < 0.000_001;
  });
  if (!feeMatches) {
    throw new Error(
      `pricing-suite preflight: ${expected.channel} managed-service fee does not match ` +
        `${expectedFee.kind} ${expectedFee.value}`
    );
  }
}
