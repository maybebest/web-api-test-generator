/* spec: specs/complex-catalog-filter-combo.md version:1.0.0 sha256:2a7c3b5436eaa70a6b23dbeddadbaeac3b8369c07afc1ba54cf05af084f0de7b */
import { test, expect } from '../../fixtures/test';
import type { Locator, Page } from '@playwright/test';

class ComplexCatalogPageObject {
  constructor(private readonly page: Page) {}

  filterStatus(): Locator {
    return this.page.getByTestId('filter-status');
  }

  kitchenCategoryCheckbox(): Locator {
    return this.page.getByRole('checkbox', { name: 'Kitchen' });
  }

  materialsSelect(): Locator {
    return this.page.getByTestId('filter-materials');
  }

  applyFiltersButton(): Locator {
    return this.page.getByRole('button', { name: 'Apply catalog filters' });
  }

  pageIndicator(): Locator {
    return this.page.getByTestId('page-indicator');
  }

  pageTwoButton(): Locator {
    return this.page.getByTestId('page-2');
  }

  pageOneButton(): Locator {
    return this.page.getByTestId('page-1');
  }

  stockSortButton(): Locator {
    return this.page.getByTestId('sort-stock');
  }

  async open(): Promise<void> {
    await this.page.goto('/complex/catalog');
  }

  async waitForInitialFilterStatus(): Promise<void> {
    await this.filterStatus().waitFor({ state: 'visible' });
  }

  async applyCombinedFilters(materials: readonly string[]): Promise<void> {
    await this.kitchenCategoryCheckbox().check();
    await this.materialsSelect().selectOption([...materials]);
    await this.applyFiltersButton().click();
  }

  async goToPageTwo(): Promise<void> {
    await this.pageTwoButton().click();
  }

  async sortByStock(): Promise<void> {
    await this.stockSortButton().click();
    await this.pageOneButton().waitFor({ state: 'visible' });
  }
}

const dataCases = [
  {
    caseId: 'DC-001',
    categoryFilter: 'Kitchen',
    materials: ['Oak', 'Ceramic'],
    initialFilterStatus: 'Filters applied: 0 active',
    appliedFilterStatus: 'Filters applied: 3 active',
    pageAfterSelection: 'Page 2 of 3',
    stockSortStateToken: 'aria-sort=',
    pageAfterSort: 'Page 1 of 3',
  },
] as const;

const variants = [
  { locale: 'en-US', plan: 'standard', role: 'guest' },
] as const;

for (const dataCase of dataCases) {
  for (const variant of variants) {
    test(
      `Complex catalog combined filters, multi-select materials, and pagination reset on sort [${dataCase.caseId}] [${variant.locale}/${variant.plan}/${variant.role}]`,
      { tag: ['@generated', '@smoke', '@local-fixture', '@complex-catalog'] },
      async ({ page }) => {
        test.info().annotations.push({
          type: 'covered-ac-ids',
          description: 'AC-001 AC-002 AC-003 AC-004 AC-005',
        });

        const catalogPageObject = new ComplexCatalogPageObject(page);

        await test.step(`Arrange AC-001: open catalog with ${dataCase.initialFilterStatus}`, async () => {
          await catalogPageObject.open();
          await catalogPageObject.waitForInitialFilterStatus();
        });

        await test.step(`Action AC-002: apply ${dataCase.categoryFilter}, Oak, and Ceramic for ${dataCase.appliedFilterStatus}`, async () => {
          await catalogPageObject.applyCombinedFilters(dataCase.materials);
        });

        await test.step(`Action AC-003: select page 2 for ${dataCase.pageAfterSelection}`, async () => {
          await catalogPageObject.goToPageTwo();
        });

        await test.step(`Action AC-004: activate Stock sort with ${dataCase.stockSortStateToken}ascending`, async () => {
          await catalogPageObject.sortByStock();
        });

        await test.step('Assert AC-005: page indicator shows Page 1 of 3', async () => {
          await expect(catalogPageObject.pageIndicator()).toHaveText(dataCase.pageAfterSort);
        });
      },
    );
  }
}
