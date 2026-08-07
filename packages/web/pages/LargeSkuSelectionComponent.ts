import type { Locator, Page } from '@playwright/test';

/**
 * Component Object for the large Measurement-SKU result integrity slice in
 * specs/sains/large-sku-selection-integrity.md (FLOW-MP-028).
 *
 * Product-row accessible names (`<product> - <SKU>`) and the group-level
 * `Select All` checkbox names were reconfirmed against dev on 2026-07-13.
 */
export class LargeSkuSelectionComponent {
  constructor(private readonly page: Page) {}

  productRows(): Locator {
    return this.page.getByRole('checkbox', { name: /-\s*\d{5,}\s*$/ });
  }

  selectAllGroups(): Locator {
    return this.page.getByRole('checkbox', { name: /select all/i });
  }

  measurementConfirm(): Locator {
    return this.page.getByRole('button', { name: 'Confirm', exact: true });
  }

  measurementSummaryCount(): Locator {
    return this.page.getByTestId('plan-measurement-skus');
  }

  heroSelectionControls(): Locator {
    return this.page.getByRole('button', { name: 'Add hero SKU' });
  }

  firstHeroSelectionControl(): Locator {
    // locator-policy:exception any rendered Add hero SKU control proves the Hero-selection step is usable
    return this.heroSelectionControls().first();
  }

  async confirmMeasurementSelection(): Promise<void> {
    await this.measurementConfirm().click();
    await this.firstHeroSelectionControl().waitFor({ state: 'visible', timeout: 90_000 });
  }

  async selectEveryVisibleGroup(): Promise<number> {
    const groups = this.selectAllGroups();
    const groupCount = await groups.count();
    let actionable = 0;
    for (let index = 0; index < groupCount; index += 1) {
      const group = groups.nth(index);
      if ((await group.isVisible()) && (await group.isEnabled())) {
        await group.check();
        actionable += 1;
      }
    }
    return actionable;
  }

  async checkedProductRowCount(): Promise<number> {
    return this.productRows().evaluateAll((elements) =>
      elements.filter((element) => element instanceof HTMLInputElement && element.checked).length
    );
  }
}
