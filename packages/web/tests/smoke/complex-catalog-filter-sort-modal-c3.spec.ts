/* spec: specs/complex-catalog-filter-sort-modal.md version:1.0.0 sha256:e98ef7e42868b6f0f50633fdf2e9ec61d29f62e937b4d61e13dd7b29b18dae99 */
import { test, expect } from '../../fixtures/test';
import type { Locator, Page } from '@playwright/test';

class ComplexCatalogPage {
  readonly page: Page;
  readonly catalogHeading: Locator;
  readonly lightingCheckbox: Locator;
  readonly applyFiltersButton: Locator;
  readonly filterStatus: Locator;
  readonly priceSortButton: Locator;
  readonly priceColumnHeader: Locator;
  readonly pageTwoButton: Locator;
  readonly pageIndicator: Locator;
  readonly quickViewButton: Locator;
  readonly quickViewDialog: Locator;
  readonly modalProductHeading: Locator;
  readonly modalAddToCartButton: Locator;
  readonly basketBadge: Locator;

  constructor(page: Page) {
    this.page = page;
    this.catalogHeading = page.getByRole('heading', {
      level: 1,
      name: 'Complex catalog',
      exact: true,
    });
    this.lightingCheckbox = page.getByRole('checkbox', {
      name: 'Lighting',
      exact: true,
    });
    this.applyFiltersButton = page.getByRole('button', {
      name: 'Apply catalog filters',
      exact: true,
    });
    this.filterStatus = page.getByText('Filters applied: 1 active', { exact: true });
    this.priceSortButton = page.getByTestId('sort-price');
    this.priceColumnHeader = page.getByRole('columnheader', { name: /Price/ });
    this.pageTwoButton = page.getByTestId('page-2');
    this.pageIndicator = page.getByTestId('page-indicator');
    this.quickViewButton = page.getByTestId('quickview-1');
    this.quickViewDialog = page.getByRole('dialog');
    this.modalProductHeading = this.quickViewDialog.getByRole('heading', {
      name: 'Aurora Lamp',
      exact: true,
    });
    this.modalAddToCartButton = this.quickViewDialog.getByRole('button', {
      name: 'Add to cart',
      exact: true,
    });
    this.basketBadge = page.getByTestId('basket-count');
  }

  async open(): Promise<void> {
    await this.page.goto('/complex/catalog');
    await this.catalogHeading.waitFor({ state: 'visible' });
  }

  async applyLightingFilter(): Promise<void> {
    await this.lightingCheckbox.check();
    await this.applyFiltersButton.click();
    await this.filterStatus.waitFor({ state: 'visible' });
  }

  async sortPriceAscending(): Promise<void> {
    await this.priceSortButton.click();
    await this.priceColumnHeader.waitFor({ state: 'visible' });
    await this.page.waitForFunction(
      (element) => element?.getAttribute('aria-sort') === 'ascending',
      await this.priceColumnHeader.elementHandle(),
    );
  }

  async selectPageTwo(): Promise<void> {
    // eslint-disable-next-line playwright/prefer-locator -- plugin false positive: locator property name begins with 'page'
    await this.pageTwoButton.click();
    await this.pageIndicator.getByText('Page 2 of 3', { exact: true }).waitFor({
      state: 'visible',
    });
  }

  async openAuroraLampQuickView(): Promise<void> {
    await this.quickViewButton.click();
    await this.quickViewDialog.waitFor({ state: 'visible' });
    await this.modalProductHeading.waitFor({ state: 'visible' });
  }

  async addModalProductToBasket(): Promise<void> {
    await this.modalAddToCartButton.click();
    await this.quickViewDialog.waitFor({ state: 'hidden' });
  }
}

const dataCases = [
  {
    caseId: 'DC-001',
    categoryFilter: 'Lighting',
    quickViewProduct: 'Aurora Lamp',
    sortColumn: 'Price',
    targetPage: '2',
    filterStatusText: 'Filters applied: 1 active',
    priceHeaderState: 'aria-sort=ascending',
    pageIndicatorText: 'Page 2 of 3',
    basketBadgeText: '1',
  },
] as const;

for (const dataCase of dataCases) {
  test(
    `Complex catalog filtering, sorting, and quick-view modal purchase (${dataCase.caseId})`,
    { tag: ['@generated', '@smoke', '@local-fixture', '@complex-catalog'] },
    async ({ page }) => {
      test.info().annotations.push({
        type: 'covered-ac-ids',
        description: 'AC-001 AC-002 AC-003 AC-004 AC-005 AC-006',
      });

      const complexCatalogPage = new ComplexCatalogPage(page);

      await test.step('Arrange AC-001: open Complex catalog', async () => {
        await complexCatalogPage.open();
      });

      await test.step(`Action AC-002: apply ${dataCase.categoryFilter} and show ${dataCase.filterStatusText}`, async () => {
        await complexCatalogPage.applyLightingFilter();
      });

      await test.step(`Action AC-003: sort ${dataCase.sortColumn} with ${dataCase.priceHeaderState}`, async () => {
        await complexCatalogPage.sortPriceAscending();
      });

      await test.step(`Action AC-004: select page ${dataCase.targetPage} and show ${dataCase.pageIndicatorText}`, async () => {
        await complexCatalogPage.selectPageTwo();
      });

      await test.step(`Action AC-005: open quick view for ${dataCase.quickViewProduct}`, async () => {
        await complexCatalogPage.openAuroraLampQuickView();
      });

      await test.step('Action AC-006: add modal product to basket', async () => {
        await complexCatalogPage.addModalProductToBasket();
      });

      await test.step('Assert AC-006: basket badge shows 1', async () => {
        await expect(complexCatalogPage.basketBadge).toHaveText(dataCase.basketBadgeText);
      });
    },
  );
}
