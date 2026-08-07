import { test, expect } from '../../fixtures/test';
import { assertPricingConfiguration } from '../../automation/src/pricing-config-preflight';

function media(pricingModel: string, cost: number, feeType = 'Percentage', feeValue = 3): unknown {
  return {
    inStore: {
      cost: {
        managedService: {
          pricingModels: [{ pricingModel, costStoreVolume: [{ quantity: 50, cost }] }],
          managedServiceFee: { type: feeType, value: feeValue }
        }
      }
    }
  };
}

test.describe('pricing configuration preflight', () => {
  test('accepts exact model, nested rate and fee parity', async () => {
    expect(() =>
      assertPricingConfiguration(media('Cost per unit', 3.37), {
        channel: 'Trolley',
        model: 'cost-per-unit',
        rate: 3.37,
        managedServiceFee: { kind: 'percentage', value: 3 }
      })
    ).not.toThrow();
    expect(() =>
      assertPricingConfiguration(media('Cost per store', 300, 'Flat fee', 2), {
        channel: 'Travel Money',
        model: 'cost-per-store',
        rate: 300,
        managedServiceFee: { kind: 'flat', value: 2 }
      })
    ).not.toThrow();
  });

  test('accepts direct pricing rows and a configured fee for Budget-Led', async () => {
    expect(() =>
      assertPricingConfiguration(
        {
          inStore: {
            cost: {
              managedService: {
                pricingModel: 'Budget Led',
                cost: 30_000,
                managedServiceFee: { type: 'Percentage', value: 4 }
              }
            }
          }
        },
        {
          channel: 'Digital Screens',
          model: 'budget-led',
          managedServiceFee: 'configured'
        }
      )
    ).not.toThrow();
  });

  test('rejects wrong models, rates, fees and malformed media data', async () => {
    const input = media('Cost per unit', 3.37);
    expect(() =>
      assertPricingConfiguration(input, {
        channel: 'Trolley',
        model: 'cost-per-store',
        rate: 3.37,
        managedServiceFee: { kind: 'percentage', value: 3 }
      })
    ).toThrow('does not expose the expected cost-per-store model');
    expect(() =>
      assertPricingConfiguration(input, {
        channel: 'Trolley',
        model: 'cost-per-unit',
        rate: 9.99,
        managedServiceFee: { kind: 'percentage', value: 3 }
      })
    ).toThrow('rate does not match 9.99');
    expect(() =>
      assertPricingConfiguration(input, {
        channel: 'Trolley',
        model: 'cost-per-unit',
        rate: 3.37,
        managedServiceFee: { kind: 'flat', value: 3 }
      })
    ).toThrow('managed-service fee does not match flat 3');
    expect(() =>
      assertPricingConfiguration(null, {
        channel: 'Trolley',
        model: 'cost-per-unit',
        managedServiceFee: 'configured'
      })
    ).toThrow('returned an invalid media object');
  });

  test('does not borrow a matching fee from an unrelated delivery mode', async () => {
    const input = {
      inStore: {
        cost: {
          managedService: {
            pricingModels: [{ pricingModel: 'Cost per unit', cost: 3.37 }],
            managedServiceFee: { type: 'Flat fee', value: 2 }
          }
        }
      },
      offSite: {
        cost: {
          managedService: {
            pricingModels: [{ pricingModel: 'Budget Led', cost: 30_000 }],
            managedServiceFee: { type: 'Percentage', value: 3 }
          }
        }
      }
    };

    expect(() =>
      assertPricingConfiguration(input, {
        channel: 'Trolley',
        model: 'cost-per-unit',
        rate: 3.37,
        managedServiceFee: { kind: 'percentage', value: 3 }
      })
    ).toThrow('managed-service fee does not match percentage 3');
  });
});
