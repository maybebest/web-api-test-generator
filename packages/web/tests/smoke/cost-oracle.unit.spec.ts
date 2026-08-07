import { test, expect } from '../../fixtures/test';
import {
  applyManagedService,
  calculateBudgetLedCost,
  calculatePetrolPumpCost,
  calculateTravelMoneyScreensCost,
  calculateTrolleyCost,
  formatGBP,
  roundToPence
} from '../../automation/src/cost-oracle';

test.describe('media-planner cost oracle', () => {
  test('calculates captured channel pricing models and managed-service fees', async () => {
    const values = {
      trolleyBase: calculateTrolleyCost({
        costPerUnit: 3.37,
        numberOfStores: 50,
        mediaServiceType: 'Self-serve'
      }),
      trolleyFlat: calculateTrolleyCost({
        costPerUnit: 3.37,
        numberOfStores: 50,
        mediaServiceType: 'Managed service',
        managedServiceFee: { kind: 'flat', amount: 2 }
      }),
      trolleyPercent: calculateTrolleyCost({
        costPerUnit: 3.37,
        numberOfStores: 50,
        mediaServiceType: 'Managed service',
        managedServiceFee: { kind: 'percentage', percent: 3 }
      }),
      petrolPercent: calculatePetrolPumpCost({
        costPerUnit: 16.24,
        numberOfStores: 40,
        mediaServiceType: 'Managed service',
        managedServiceFee: { kind: 'percentage', percent: 4 }
      }),
      travelMoneyPercent: calculateTravelMoneyScreensCost({
        costPerStoreStandard: 300,
        numberOfStores: 50,
        mediaServiceType: 'Managed service',
        managedServiceFee: { kind: 'percentage', percent: 4 }
      }),
      budgetLed: calculateBudgetLedCost({
        budget: 30_000,
        managedServiceFee: { kind: 'percentage', percent: 4 }
      })
    };

    expect(values).toEqual({
      trolleyBase: 21_062.5,
      trolleyFlat: 21_064.5,
      trolleyPercent: 21_694.38,
      petrolPercent: 20_267.52,
      travelMoneyPercent: 15_600,
      budgetLed: 30_000
    });
  });

  test('applies the managed-service decision table and arithmetic half-up rounding', async () => {
    expect({
      selfServeFlat: applyManagedService(15_000, 'Self-serve', { kind: 'flat', amount: 2 }),
      selfServePercent: applyManagedService(15_000, 'Self-serve', { kind: 'percentage', percent: 4 }),
      managedUndefined: applyManagedService(15_000, 'Managed service'),
      managedZeroFlat: applyManagedService(15_000, 'Managed service', { kind: 'flat', amount: 0 }),
      managedFlat: applyManagedService(15_000, 'Managed service', { kind: 'flat', amount: 2 }),
      managedZeroPercent: applyManagedService(15_000, 'Managed service', { kind: 'percentage', percent: 0 }),
      managedPercent: applyManagedService(15_000, 'Managed service', { kind: 'percentage', percent: 4 }),
      halfPence: roundToPence(0.005),
      belowHalfPence: roundToPence(0.004),
      formatted: formatGBP(21_694.375)
    }).toEqual({
      selfServeFlat: 15_000,
      selfServePercent: 15_000,
      managedUndefined: 15_000,
      managedZeroFlat: 15_000,
      managedFlat: 15_002,
      managedZeroPercent: 15_000,
      managedPercent: 15_600,
      halfPence: 0.01,
      belowHalfPence: 0,
      formatted: '£21,694.38'
    });
  });

  test('rejects invalid numeric inputs instead of returning NaN or unsafe totals', async () => {
    expect(() =>
      calculatePetrolPumpCost({
        costPerUnit: Number.NaN,
        numberOfStores: 40,
        mediaServiceType: 'Self-serve'
      })
    ).toThrow('costPerUnit must be a finite, non-negative number');
    expect(() =>
      calculateTravelMoneyScreensCost({
        costPerStoreStandard: 300,
        numberOfStores: 1.5,
        mediaServiceType: 'Self-serve'
      })
    ).toThrow('numberOfStores must be a non-negative safe integer');
    expect(() => formatGBP(-1)).toThrow('value must be a finite, non-negative number');
  });
});
