/* spec: specs/complex-catalog-filter-sort-modal.md version:1.0.0 sha256:e98ef7e42868b6f0f50633fdf2e9ec61d29f62e937b4d61e13dd7b29b18dae99 */
import { test, expect } from '../../fixtures/test';
import type { Locator, Page } from '@playwright/test';

class ComplexCatalogPageObject {
  constructor(private readonly page: Page) {}

  levelOneHeading(): Locator {
    return this.page.getByRole('heading', { name: 'Complex catalog', level: 1 });
  }

  categoryCheckbox(name: string): Locator {
    return this.page.getByRole('checkbox', { name });
  }

  applyCatalogFiltersButton(): Locator {
    return this.page.getByRole('button', { name: 'Apply catalog filters' });
  }

  filterStatus(text: string): Locator {
    return this.page.getByText(text, { exact: true });
  }

  priceSortButton(): Locator {
    return this.page.getByTestId('sort-price');
  }

  priceHeaderWithSort(sortDirection: string): Locator {
    // locator-policy:exception The IR identifies the Price column header by its aria-sort attribute and contained sort-price testid.
    return this.page.locator(`th[aria-sort="${sortDirection}"]`, {
      has: this.priceSortButton(),
    });
  }

  pageButton(pageNumber: string): Locator {
    return this.page.getByTestId(`page-${pageNumber}`);
  }

  pageIndicator(text: string): Locator {
    return this.page.getByTestId('page-indicator').filter({ hasText: text });
  }

  quickViewButton(): Locator {
    return this.page.getByTestId('quickview-1');
  }

  quickViewDialog(productName: string): Locator {
    return this.page.getByRole('dialog', { name: productName });
  }

  modalProductHeading(productName: string): Locator {
    return this.quickViewDialog(productName).getByRole('heading', {
      name: productName,
    });
  }

  modalAddToCartButton(productName: string): Locator {
    return this.quickViewDialog(productName).getByRole('button', {
      name: 'Add to cart',
    });
  }

  modalCloseButton(): Locator {
    return this.page.getByTestId('modal-close');
  }

  basketBadge(): Locator {
    return this.page.getByTestId('basket-count');
  }

  async open(): Promise<void> {
    await this.page.goto('/complex/catalog');
    await this.levelOneHeading().waitFor({ state: 'visible' });
  }

  async applyCategoryFilter(category: string, expectedStatus: string): Promise<void> {
    await this.categoryCheckbox(category).check();
    await this.applyCatalogFiltersButton().click();
    await this.filterStatus(expectedStatus).waitFor({ state: 'visible' });
  }

  async sortByPrice(expectedSortDirection: string): Promise<void> {
    await this.priceSortButton().click();
    await this.priceHeaderWithSort(expectedSortDirection).waitFor({ state: 'visible' });
  }

  async goToPage(pageNumber: string, expectedIndicator: string): Promise<void> {
    await this.pageButton(pageNumber).click();
    await this.pageIndicator(expectedIndicator).waitFor({ state: 'visible' });
  }

  async openQuickView(productName: string): Promise<void> {
    await this.quickViewButton().click();
    await this.quickViewDialog(productName).waitFor({ state: 'visible' });
    await this.modalProductHeading(productName).waitFor({ state: 'visible' });
  }

  async addToBasketFromQuickView(productName: string): Promise<void> {
    const dialogComponent = this.quickViewDialog(productName);
    await this.modalAddToCartButton(productName).click();
    await dialogComponent.waitFor({ state: 'hidden' });
  }
}

const dataCases = [
  {
    caseId: 'DC-001',
    categoryFilter: 'Lighting',
    quickViewProduct: 'Aurora Lamp',
    targetPage: '2',
    filterStatusText: 'Filters applied: 1 active',
    priceHeaderAriaSort: 'ascending',
    ariaSortToken: 'aria-sort=',
    pageIndicatorText: 'Page 2 of 3',
    basketBadgeText: '1',
  },
] as const;

const variants = [
  {
    locale: 'en-US',
    plan: 'standard',
    role: 'guest',
  },
] as const;

for (const dataCase of dataCases) {
  for (const variant of variants) {
    test(
      `Complex catalog filtering, sorting, and quick-view modal purchase — ${dataCase.caseId} ${variant.locale} ${variant.plan} ${variant.role}`,
      {
        tag: ['@generated', '@smoke', '@local-fixture', '@complex-catalog'],
      },
      async ({ page }) => {
        test.info().annotations.push({
          type: 'covered-ac-ids',
          description: 'AC-001 AC-002 AC-003 AC-004 AC-005 AC-006',
        });

        const complexCatalogPageObject = new ComplexCatalogPageObject(page);

        await test.step('Arrange AC-001: open the Complex catalog page', async () => {
          await complexCatalogPageObject.open();
        });

        await test.step(`Act AC-002: apply Lighting filter until ${dataCase.filterStatusText}`, async () => {
          await complexCatalogPageObject.applyCategoryFilter(
            dataCase.categoryFilter,
            dataCase.filterStatusText,
          );
        });

        await test.step(`Act AC-003: sort Price until ${dataCase.ariaSortToken}${dataCase.priceHeaderAriaSort}`, async () => {
          await complexCatalogPageObject.sortByPrice(dataCase.priceHeaderAriaSort);
        });

        await test.step(`Act AC-004: select page 2 and show ${dataCase.pageIndicatorText}`, async () => {
          await complexCatalogPageObject.goToPage(
            dataCase.targetPage,
            dataCase.pageIndicatorText,
          );
        });

        await test.step('Act AC-005: open Aurora Lamp quick-view modal', async () => {
          await complexCatalogPageObject.openQuickView(dataCase.quickViewProduct);
        });

        await test.step('Act AC-006: add Aurora Lamp to the basket from the modal', async () => {
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
}
