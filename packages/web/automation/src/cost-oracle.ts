export type MediaServiceType = 'Self-serve' | 'Managed service';

export type ManagedServiceFee =
  | { kind: 'flat'; amount: number }
  | { kind: 'percentage'; percent: number }
  | null
  | undefined;

export type CostPerUnitInput = {
  costPerUnit: number;
  numberOfStores: number;
  mediaServiceType: MediaServiceType;
  managedServiceFee?: ManagedServiceFee;
};

export type CostPerStoreInput = {
  costPerStoreStandard: number;
  numberOfStores: number;
  mediaServiceType: MediaServiceType;
  managedServiceFee?: ManagedServiceFee;
};

export type BudgetLedInput = {
  budget: number;
  managedServiceFee?: ManagedServiceFee;
};

export const TROLLEY_UNITS_PER_STORE = 125;
export const PETROL_PUMP_UNITS_PER_STORE = 30;

function assertMoney(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a finite, non-negative number`);
  }
}

function assertStoreCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('numberOfStores must be a non-negative safe integer');
  }
}

/**
 * Currency values in the captured pricing contract use arithmetic half-up
 * rounding. The small epsilon compensates for binary floating-point values
 * such as 1.005 without changing already-exact pence values.
 */
export function roundToPence(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError('value must be finite');
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function applyManagedService(
  subtotal: number,
  mediaServiceType: MediaServiceType,
  fee?: ManagedServiceFee
): number {
  assertMoney(subtotal, 'subtotal');
  if (mediaServiceType !== 'Managed service' || fee == null) {
    return roundToPence(subtotal);
  }

  if (fee.kind === 'flat') {
    assertMoney(fee.amount, 'managedServiceFee.amount');
    return roundToPence(subtotal + fee.amount);
  }

  assertMoney(fee.percent, 'managedServiceFee.percent');
  return roundToPence(subtotal * (1 + fee.percent / 100));
}

function calculateUnitCost(input: CostPerUnitInput, unitsPerStore: number): number {
  assertMoney(input.costPerUnit, 'costPerUnit');
  assertStoreCount(input.numberOfStores);
  const subtotal = roundToPence(input.costPerUnit * unitsPerStore * input.numberOfStores);
  return applyManagedService(subtotal, input.mediaServiceType, input.managedServiceFee);
}

export function calculateTrolleyCost(input: CostPerUnitInput): number {
  return calculateUnitCost(input, TROLLEY_UNITS_PER_STORE);
}

export function calculatePetrolPumpCost(input: CostPerUnitInput): number {
  return calculateUnitCost(input, PETROL_PUMP_UNITS_PER_STORE);
}

export function calculateTravelMoneyScreensCost(input: CostPerStoreInput): number {
  assertMoney(input.costPerStoreStandard, 'costPerStoreStandard');
  assertStoreCount(input.numberOfStores);
  const subtotal = roundToPence(input.costPerStoreStandard * input.numberOfStores);
  return applyManagedService(subtotal, input.mediaServiceType, input.managedServiceFee);
}

/** Budget-led channels treat the supplied budget as the total; managed-service fees are inert. */
export function calculateBudgetLedCost(input: BudgetLedInput): number {
  assertMoney(input.budget, 'budget');
  return roundToPence(input.budget);
}

const GBP = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function formatGBP(value: number): string {
  assertMoney(value, 'value');
  return GBP.format(roundToPence(value));
}
