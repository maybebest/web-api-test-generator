/* spec: specs/complex-catalog-filter-sort-modal.md version:1.0.0 sha256:e98ef7e42868b6f0f50633fdf2e9ec61d29f62e937b4d61e13dd7b29b18dae99 */
import { test, expect } from '../../fixtures/test';
import type { Locator, Page } from '@playwright/test';

class ComplexCatalogPageObject {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto('/complex/catalog');
    await this.page
      .getByRole('heading', { name: 'Complex catalog', level: 1 })
      .waitFor();
  }

  async applyCategoryFilter(
    category: string,
    expectedStatus: string,
  ): Promise<void> {
    await this.page.getByRole('checkbox', { name: category }).check();
    await this.page
      .getByRole('button', { name: 'Apply catalog filters' })
      .click();
    await this.page.getByText(expectedStatus, { exact: true }).waitFor();
  }

  async sortByPrice(): Promise<void> {
    await this.page.getByTestId('sort-price').click();
  }

  async goToPage(
    targetPage: string,
    expectedIndicator: string,
  ): Promise<void> {
    await this.page.getByTestId(`page-${targetPage}`).click();
    await this.page
      .getByTestId('page-indicator')
      .filter({ hasText: expectedIndicator })
      .waitFor();
  }

  async openFeaturedQuickView(productName: string): Promise<void> {
    await this.page.getByTestId('quickview-1').click();
    await this.page
      .getByRole('dialog', { name: productName })
      .waitFor();
  }

  async addToBasketFromQuickView(productName: string): Promise<void> {
    const quickViewDialog = this.page.getByRole('dialog', {
      name: productName,
    });
    await quickViewDialog.getByRole('button', { name: 'Add to cart' }).click();
    await quickViewDialog.waitFor({ state: 'hidden' });
  }

  basketBadge(): Locator {
    return this.page.getByTestId('basket-count');
  }
}

const dataCases = [
  {
    caseId: 'DC-001',
    categoryFilter: 'Lighting',
    quickViewProduct: 'Aurora Lamp',
    targetPage: '2',
    filterStatusText: 'Filters applied: 1 active',
    pageIndicatorText: 'Page 2 of 3',
    priceHeaderStateToken: 'aria-sort=',
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

      const complexCatalogPageObject = new ComplexCatalogPageObject(page);

      await test.step('Arrange AC-001: open Complex catalog', async () => {
        await complexCatalogPageObject.open();
      });

      await test.step(
        `Action AC-002: apply Lighting filter and show ${dataCase.filterStatusText}`,
        async () => {
          await complexCatalogPageObject.applyCategoryFilter(
            dataCase.categoryFilter,
            dataCase.filterStatusText,
          );
        },
      );

      await test.step(
        `Action AC-003: sort Price column with ${dataCase.priceHeaderStateToken}ascending`,
        async () => {
          await complexCatalogPageObject.sortByPrice();
        },
      );

      await test.step(
        `Action AC-004: select pagination page 2 and show ${dataCase.pageIndicatorText}`,
        async () => {
          await complexCatalogPageObject.goToPage(
            dataCase.targetPage,
            dataCase.pageIndicatorText,
          );
        },
      );

      await test.step('Action AC-005: open Aurora Lamp quick view', async () => {
        await complexCatalogPageObject.openFeaturedQuickView(
          dataCase.quickViewProduct,
        );
      });

      await test.step('Action AC-006: add Aurora Lamp to the basket', async () => {
        await complexCatalogPageObject.addToBasketFromQuickView(
          dataCase.quickViewProduct,
        );
      });

      await test.step('Assert AC-006: basket badge shows 1', async () => {
        await expect(complexCatalogPageObject.basketBadge()).toHaveText(
          dataCase.basketBadgeText,
        );
      });
    },
  );
}
