// Spec-bound header: sha256 is the behavioral hash of the spec.
/* spec: specs/special-preconditions/media-planner-pricing-cost-calculation.md version:1.1.0 sha256:fe02a2fb953e57b2170911dd6ab6c97f11c0b78674e0edbf0fde72dd6d062631 */
import { test, expect } from '../../fixtures/test';
import { getEveryMedia, getMedia } from '../../fixtures/nectar-api';
import { mediaPlannerData } from '../../data/media-planner';
import { PlanningPage } from '../../pages/PlanningPage';
import {
  applyManagedService,
  calculateBudgetLedCost,
  calculatePetrolPumpCost,
  calculateTravelMoneyScreensCost,
  calculateTrolleyCost,
  formatGBP,
  roundToPence
} from '../../automation/src/cost-oracle';
import {
  assertPricingConfiguration,
  type PricingConfigurationExpectation
} from '../../automation/src/pricing-config-preflight';

function finiteEnv(rawValue: string | undefined, name: string, fallback: number): number {
  const raw = rawValue?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite, non-negative number`);
  }
  return value;
}

function stringEnv(rawValue: string | undefined, fallback: string): string {
  return rawValue?.trim() || fallback;
}

const configured = {
  trolley: {
    channel: stringEnv(process.env.E2E_MP_TROLLEY_CHANNEL, 'Trolley Panels (KCTEST)'),
    costPerUnit: finiteEnv(process.env.E2E_MP_TROLLEY_COST_PER_UNIT, 'E2E_MP_TROLLEY_COST_PER_UNIT', 3.37),
    managedPercent: finiteEnv(process.env.E2E_MP_TROLLEY_MS_PERCENT, 'E2E_MP_TROLLEY_MS_PERCENT', 3)
  },
  petrolFlat: {
    channel: stringEnv(process.env.E2E_MP_PETROL_FLAT_CHANNEL, 'Petrol Pump Nozzles'),
    costPerUnit: finiteEnv(process.env.E2E_MP_PETROL_COST_PER_UNIT, 'E2E_MP_PETROL_COST_PER_UNIT', 16.24),
    managedFlat: finiteEnv(process.env.E2E_MP_PETROL_MS_FLAT, 'E2E_MP_PETROL_MS_FLAT', 2)
  },
  travelMoney: {
    channel: stringEnv(process.env.E2E_MP_TRAVELMONEY_CHANNEL, 'Travel Money Screens (KCTEST)'),
    costPerStoreStandard: finiteEnv(
      process.env.E2E_MP_TRAVELMONEY_COST_PER_STORE,
      'E2E_MP_TRAVELMONEY_COST_PER_STORE',
      300
    ),
    managedPercent: finiteEnv(process.env.E2E_MP_TRAVELMONEY_MS_PERCENT, 'E2E_MP_TRAVELMONEY_MS_PERCENT', 4)
  },
  budgetLed: {
    channel: stringEnv(process.env.E2E_MP_BUDGETLED_CHANNEL, 'Digital Screens - 6 Sheets'),
    budget: finiteEnv(process.env.E2E_MP_BUDGETLED_BUDGET, 'E2E_MP_BUDGETLED_BUDGET', 30_000)
  }
} as const;

function dateFromAnchor(anchor: Date, days: number): string {
  const date = new Date(anchor);
  date.setDate(date.getDate() + days);
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

function channelLine(channel: string, anchor: Date, stores?: number, budget?: number): string {
  const fields = [
    channel,
    stores === undefined ? undefined : `${stores} stores`,
    budget === undefined ? undefined : `the budget is £${budget}`,
    'Managed service',
    `${dateFromAnchor(anchor, 45)} till ${dateFromAnchor(anchor, 75)}`
  ];
  return fields.filter((field): field is string => Boolean(field)).join(', ');
}

async function buildToChannelRequest(planningPage: PlanningPage): Promise<void> {
  await planningPage.goto();
  await planningPage.startNectarAiPlanner();
  await planningPage.chooseBuildByObjectiveAndBudget();
  await planningPage.selectAdvertiser(mediaPlannerData.advertiser);
  await planningPage.selectBrand(mediaPlannerData.brand);
  await planningPage.confirmAdvertiserAndBrand();
  await planningPage.enterObjective(mediaPlannerData.objective);
  await planningPage.searchProducts(mediaPlannerData.productSearch);
  await planningPage.selectFirstProduct();
  await planningPage.confirmProducts();
}

async function cleanupPreservingPrimary(
  planningPage: PlanningPage,
  channel: string,
  primaryError: unknown
): Promise<never> {
  try {
    await planningPage.deleteChannelIfPresent(channel);
  } catch {
    test.info().annotations.push({
      type: 'cleanup-error',
      description: `Failed to remove test-owned channel ${channel}; primary failure preserved`
    });
  }
  throw primaryError;
}

async function addConfiguredChannel(
  planningPage: PlanningPage,
  preflight: PricingConfigurationExpectation,
  options: { stores?: number; budget?: number }
): Promise<void> {
  const media = await getEveryMedia();
  const matches = media.filter((entry) => entry.name === preflight.channel);
  if (matches.length !== 1) {
    throw new Error(
      `pricing-suite preflight: expected exactly one read-only channel named "${preflight.channel}", found ${matches.length}`
    );
  }
  assertPricingConfiguration(await getMedia(matches[0].id), preflight);

  const calendarAnchor = new Date();
  try {
    await buildToChannelRequest(planningPage);
    if (dateFromAnchor(new Date(), 0) !== dateFromAnchor(calendarAnchor, 0)) {
      throw new Error('pricing-suite preflight: calendar date rolled over while arranging the plan; retry with a fresh anchor');
    }
    await planningPage.enterChannelRequest(
      channelLine(preflight.channel, calendarAnchor, options.stores, options.budget),
      preflight.channel
    );
    await planningPage.waitForAssistantIdle();
  } catch (error) {
    return cleanupPreservingPrimary(planningPage, preflight.channel, error);
  }
}

async function assertWithCleanup(
  planningPage: PlanningPage,
  channel: string,
  assertion: () => Promise<void>
): Promise<void> {
  let primaryError: unknown;
  let cleanupError: unknown;
  try {
    await assertion();
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await planningPage.deleteChannelIfPresent(channel);
    } catch (error) {
      cleanupError = error;
    }
  }

  if (primaryError !== undefined) {
    if (cleanupError !== undefined) {
      test.info().annotations.push({
        type: 'cleanup-error',
        description: `Failed to remove test-owned channel ${channel}; primary assertion failure preserved`
      });
    }
    throw primaryError;
  }
  if (cleanupError !== undefined) {
    throw cleanupError;
  }
}

async function displayedSummaryMoney(planningPage: PlanningPage): Promise<number> {
  const text = (await planningPage.summaryTotalBudget().textContent()) ?? '';
  const parsed = Number(text.replace(/,/g, '').replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(parsed)) {
    throw new Error(`pricing-suite assertion: summary total is not parseable money: ${JSON.stringify(text)}`);
  }
  return parsed;
}

type OracleCase = {
  caseId: string;
  title: string;
  actual: () => unknown;
  expected: unknown;
};

const trolleyOracleCases: OracleCase[] = [
  {
    caseId: 'DC-001',
    title: 'Self-serve base',
    actual: () => calculateTrolleyCost({ costPerUnit: 3.37, numberOfStores: 50, mediaServiceType: 'Self-serve' }),
    expected: 21_062.5
  },
  {
    caseId: 'DC-002',
    title: 'Managed flat fee',
    actual: () =>
      calculateTrolleyCost({
        costPerUnit: 3.37,
        numberOfStores: 50,
        mediaServiceType: 'Managed service',
        managedServiceFee: { kind: 'flat', amount: 2 }
      }),
    expected: 21_064.5
  },
  {
    caseId: 'DC-003',
    title: 'Managed percentage fee',
    actual: () =>
      calculateTrolleyCost({
        costPerUnit: 3.37,
        numberOfStores: 50,
        mediaServiceType: 'Managed service',
        managedServiceFee: { kind: 'percentage', percent: 3 }
      }),
    expected: 21_694.38
  }
];

const crossModelOracleCases: OracleCase[] = [
  {
    caseId: 'DC-005',
    title: 'Petrol Self-serve base',
    actual: () =>
      calculatePetrolPumpCost({ costPerUnit: 16.24, numberOfStores: 40, mediaServiceType: 'Self-serve' }),
    expected: 19_488
  },
  {
    caseId: 'DC-008',
    title: 'Travel Money Self-serve base',
    actual: () =>
      calculateTravelMoneyScreensCost({
        costPerStoreStandard: 300,
        numberOfStores: 50,
        mediaServiceType: 'Self-serve'
      }),
    expected: 15_000
  },
  {
    caseId: 'DC-013',
    title: 'Petrol neighbouring store counts',
    actual: () =>
      [39, 41].map((numberOfStores) =>
        calculatePetrolPumpCost({
          costPerUnit: 16.24,
          numberOfStores,
          mediaServiceType: 'Managed service',
          managedServiceFee: { kind: 'percentage', percent: 4 }
        })
      ),
    expected: [19_760.83, 20_774.21]
  }
];

type LivePricingCase = {
  caseId: string;
  title: string;
  channel: string;
  preflight: PricingConfigurationExpectation;
  options: { stores?: number; budget?: number };
  oracle: () => number;
};

const livePricingCases: LivePricingCase[] = [
  {
    caseId: 'DC-004',
    title: 'Trolley percentage',
    channel: configured.trolley.channel,
    preflight: {
      channel: configured.trolley.channel,
      model: 'cost-per-unit',
      rate: configured.trolley.costPerUnit,
      managedServiceFee: { kind: 'percentage', value: configured.trolley.managedPercent }
    },
    options: { stores: 50 },
    oracle: () =>
      calculateTrolleyCost({
        costPerUnit: configured.trolley.costPerUnit,
        numberOfStores: 50,
        mediaServiceType: 'Managed service',
        managedServiceFee: { kind: 'percentage', percent: configured.trolley.managedPercent }
      })
  },
  {
    caseId: 'DC-007',
    title: 'Petrol flat fee',
    channel: configured.petrolFlat.channel,
    preflight: {
      channel: configured.petrolFlat.channel,
      model: 'cost-per-unit',
      rate: configured.petrolFlat.costPerUnit,
      managedServiceFee: { kind: 'flat', value: configured.petrolFlat.managedFlat }
    },
    options: { stores: 40 },
    oracle: () =>
      calculatePetrolPumpCost({
        costPerUnit: configured.petrolFlat.costPerUnit,
        numberOfStores: 40,
        mediaServiceType: 'Managed service',
        managedServiceFee: { kind: 'flat', amount: configured.petrolFlat.managedFlat }
      })
  },
  {
    caseId: 'DC-009',
    title: 'Travel Money percentage',
    channel: configured.travelMoney.channel,
    preflight: {
      channel: configured.travelMoney.channel,
      model: 'cost-per-store',
      rate: configured.travelMoney.costPerStoreStandard,
      managedServiceFee: { kind: 'percentage', value: configured.travelMoney.managedPercent }
    },
    options: { stores: 50 },
    oracle: () =>
      calculateTravelMoneyScreensCost({
        costPerStoreStandard: configured.travelMoney.costPerStoreStandard,
        numberOfStores: 50,
        mediaServiceType: 'Managed service',
        managedServiceFee: { kind: 'percentage', percent: configured.travelMoney.managedPercent }
      })
  }
];

const poll = { timeout: 75_000 } as const;

test.describe.serial(
  'Media Planner pricing model cost calculation',
  { tag: ['@generated', '@regression', '@media-planner', '@authenticated', '@special-preconditions'] },
  () => {
    test('AC-001 cost oracle exposes every pricing entry point', async () => {
      await test.step('Assert AC-001: every documented oracle function is importable', async () => {
        await expect
          .poll(() => ({
            calculateTrolleyCost: typeof calculateTrolleyCost,
            calculatePetrolPumpCost: typeof calculatePetrolPumpCost,
            calculateTravelMoneyScreensCost: typeof calculateTravelMoneyScreensCost,
            calculateBudgetLedCost: typeof calculateBudgetLedCost,
            applyManagedService: typeof applyManagedService,
            roundToPence: typeof roundToPence,
            formatGBP: typeof formatGBP
          }))
          .toEqual({
            calculateTrolleyCost: 'function',
            calculatePetrolPumpCost: 'function',
            calculateTravelMoneyScreensCost: 'function',
            calculateBudgetLedCost: 'function',
            applyManagedService: 'function',
            roundToPence: 'function',
            formatGBP: 'function'
          });
      });
    });

    for (const dataCase of trolleyOracleCases) {
      test(`${dataCase.caseId} AC-002 ${dataCase.title}`, async () => {
        await test.step('Assert AC-002: Trolley total follows the captured formula', async () => {
          await expect.poll(dataCase.actual).toEqual(dataCase.expected);
        });
      });
    }

    for (const dataCase of crossModelOracleCases) {
      test(`${dataCase.caseId} AC-003 ${dataCase.title}`, async () => {
        await test.step('Assert AC-003: channel total follows its documented multiplier', async () => {
          await expect.poll(dataCase.actual).toEqual(dataCase.expected);
        });
      });
    }

    test('DC-006 NEG-001 Petrol percentage oracle rejects the documented buggy £19,489.02 value', async () => {
      await test.step('Assert NEG-001: the correct oracle is £20,267.52 and never the buggy value', async () => {
        const petrolPercentage = () =>
          calculatePetrolPumpCost({
            costPerUnit: 16.24,
            numberOfStores: 40,
            mediaServiceType: 'Managed service',
            managedServiceFee: { kind: 'percentage', percent: 4 }
          });
        await expect.poll(petrolPercentage).toBe(20_267.52);
        await expect.poll(petrolPercentage).not.toBe(19_489.02);
      });
    });

    test('DC-011 NEG-004 managed-service gate excludes Self-serve, undefined, and zero fees', async () => {
      await test.step('Assert NEG-004: inapplicable fees leave the subtotal unchanged', async () => {
        await expect
          .poll(() => [
            applyManagedService(15_000, 'Self-serve', { kind: 'flat', amount: 2 }),
            applyManagedService(15_000, 'Self-serve', { kind: 'percentage', percent: 4 }),
            applyManagedService(15_000, 'Managed service'),
            applyManagedService(15_000, 'Managed service', { kind: 'flat', amount: 0 }),
            applyManagedService(15_000, 'Managed service', { kind: 'percentage', percent: 0 }),
            applyManagedService(15_000, 'Managed service', { kind: 'flat', amount: 2 }),
            applyManagedService(15_000, 'Managed service', { kind: 'percentage', percent: 4 })
          ])
          .toEqual([15_000, 15_000, 15_000, 15_000, 15_000, 15_002, 15_600]);
      });
    });

    test('DC-012 AC-004 pence half-up and neighbouring percentage decision table', async () => {
      await test.step('Assert AC-004: fractional pence and neighbouring rates round half-up', async () => {
        await expect
          .poll(() => ({
            halfUp: [roundToPence(21_694.375), roundToPence(0.005), roundToPence(0.004)],
            trolleyNeighbours: [2, 3, 4].map((percent) =>
              calculateTrolleyCost({
                costPerUnit: 3.37,
                numberOfStores: 50,
                mediaServiceType: 'Managed service',
                managedServiceFee: { kind: 'percentage', percent }
              })
            )
          }))
          .toEqual({
            halfUp: [21_694.38, 0.01, 0],
            trolleyNeighbours: [21_483.75, 21_694.38, 21_905]
          });
      });
    });

    test('AC-005 guided planner reaches the channel pricing request state', async ({ page }) => {
      const planningPage = new PlanningPage(page);

      await test.step('Complete the advertiser, brand, objective and SKU setup', async () => {
        await buildToChannelRequest(planningPage);
      });

      await test.step('Assert AC-005: the assistant requests channel, budget and timeline inputs', async () => {
        await expect(planningPage.assistantChatPanel()).toContainText(/channel/i);
        await expect(planningPage.assistantChatPanel()).toContainText(/budget/i);
        await expect(planningPage.assistantChatPanel()).toContainText(/timeline/i);
      });
    });

    for (const dataCase of livePricingCases) {
      test(`${dataCase.caseId} AC-006 ${dataCase.title} displayed cost equals the configured oracle`, async ({ page }) => {
        test.slow();
        const planningPage = new PlanningPage(page);
        const oracle = dataCase.oracle();

        await test.step(`Add configured ${dataCase.title} channel`, async () => {
          await addConfiguredChannel(planningPage, dataCase.preflight, dataCase.options);
        });

        await test.step('Assert AC-006: displayed and numeric summary totals equal formatGBP oracle output', async () => {
          await assertWithCleanup(planningPage, dataCase.channel, async () => {
            await expect(planningPage.summaryTotalBudget()).toContainText(formatGBP(oracle), poll);
            await expect.poll(() => displayedSummaryMoney(planningPage), poll).toBe(oracle);
          });
        });
      });
    }

    test('DC-010 NEG-003 Budget-Led displayed total ignores the configured managed-service fee', async ({ page }) => {
      test.slow();
      const planningPage = new PlanningPage(page);
      const oracle = calculateBudgetLedCost({
        budget: configured.budgetLed.budget,
        managedServiceFee: { kind: 'percentage', percent: 4 }
      });

      await test.step('Add the configured Budget-Led channel', async () => {
        await addConfiguredChannel(
          planningPage,
          {
            channel: configured.budgetLed.channel,
            model: 'budget-led',
            managedServiceFee: 'configured'
          },
          { budget: configured.budgetLed.budget }
        );
      });

      await test.step('Assert NEG-003: Budget-Led summary stays at the configured budget', async () => {
        await assertWithCleanup(planningPage, configured.budgetLed.channel, async () => {
          await expect(planningPage.summaryTotalBudget()).toContainText(formatGBP(oracle), poll);
          await expect(planningPage.summaryTotalBudget()).not.toContainText(
            formatGBP(configured.budgetLed.budget * 1.04)
          );
          await expect.poll(() => displayedSummaryMoney(planningPage), poll).toBe(oracle);
        });
      });
    });
  }
);
