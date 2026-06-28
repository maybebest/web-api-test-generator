// Shared build helpers for the Nectar AI media-planner SKU-stage tests (mapped from
// specs/test-cases.yaml). Each drives the verified guided flow to a specific stage so
// the per-case tests only carry their own assertions.
import { PlanningPage } from './PlanningPage';

export const nectarData = {
  advertiser: 'N360_Unilever_MS',
  brand: 'Unilever | Knorr | MS',
  objective: 'Customer retention',
  productSearch: 'knorr'
} as const;

export async function buildToObjective(p: PlanningPage): Promise<void> {
  await p.goto();
  await p.startNectarAiPlanner();
  await p.chooseBuildByObjectiveAndBudget();
  await p.selectAdvertiser(nectarData.advertiser);
  await p.selectBrand(nectarData.brand);
  await p.confirmAdvertiserAndBrand();
  await p.enterObjective(nectarData.objective);
}

// Measurement products shown, nothing selected.
export async function buildToMeasurementSearch(p: PlanningPage): Promise<void> {
  await buildToObjective(p);
  await p.searchProducts(nectarData.productSearch);
}

// Hero-selection step reached (measurement confirmed, no hero added yet).
export async function buildToHeroStep(p: PlanningPage): Promise<void> {
  await buildToMeasurementSearch(p);
  await p.selectFirstProduct();
  await p.confirmMeasurementSkus();
}

// Full SKU stage complete: one measurement SKU + one hero SKU confirmed.
export async function buildToSkusConfirmed(p: PlanningPage): Promise<void> {
  await buildToHeroStep(p);
  await p.promoteFirstHeroSku();
  await p.confirmHeroSkus();
}
