/* spec: specs/complex-feed-tooltip-read-state.md version:1.0.0 sha256:10e06dd30bc4b59c1fb13bca2f5dce2c3e5660a40d4f8ec3965992e2f33f01a4 */
import { test, expect } from '../../fixtures/test';
import type { Locator, Page } from '@playwright/test';

class ComplexFeedPageObject {
  readonly unreadBadgeObject: Locator;
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
    this.unreadBadgeObject = page.getByTestId('unread-badge');
  }

  async open(): Promise<void> {
    await this.page.goto('/complex/feed');
    for (let storyNumber = 1; storyNumber <= 15; storyNumber += 1) {
      await this.storyObject(storyNumber).waitFor({ state: 'visible' });
    }
    await this.unreadBadgeObject.waitFor({ state: 'visible' });
  }

  async hoverInfoTip(storyNumber: number, tooltipText: string): Promise<void> {
    const storyObject = this.storyObject(storyNumber);
    // locator-policy:exception The focusable info tip has no accessible role or unique text and is uniquely scoped to its story container.
    const infoTipObject = storyObject.locator('.tip');
    await infoTipObject.hover();
    const tooltipObject = storyObject.getByRole('tooltip');
    await tooltipObject.getByText(tooltipText, { exact: true }).waitFor({ state: 'visible' });
  }

  async focusInfoTip(storyNumber: number, tooltipText: string): Promise<void> {
    const storyObject = this.storyObject(storyNumber);
    // locator-policy:exception The focusable info tip has no accessible role or unique text and is uniquely scoped to its story container.
    const infoTipObject = storyObject.locator('.tip');
    await infoTipObject.focus();
    const tooltipObject = storyObject.getByRole('tooltip');
    await tooltipObject.getByText(tooltipText, { exact: true }).waitFor({ state: 'visible' });
  }

  async expandDetails(storyNumber: number): Promise<void> {
    await this.detailsButtonObject(storyNumber).click();
  }

  async collapseAndReExpandDetails(storyNumber: number): Promise<void> {
    const detailsButtonObject = this.detailsButtonObject(storyNumber);
    await detailsButtonObject.click();
    await detailsButtonObject.click();
  }

  private storyObject(storyNumber: number): Locator {
    return this.page.getByTestId(`feed-item-${storyNumber}`);
  }

  private detailsButtonObject(storyNumber: number): Locator {
    return this.storyObject(storyNumber).getByRole('button', { name: 'Details' });
  }
}

const dataCases = [
  {
    caseId: 'DC-001',
    hoverStory: 2,
    focusStory: 3,
    readStory: 2,
    detailsExpansions: 2,
    hoverTooltipText: 'Story 2 is deterministic fixture data',
    focusTooltipText: 'Story 3 is deterministic fixture data',
    unreadBadgeAfterRead: '14',
  },
] as const;

const variants = [
  { locale: 'en-US', plan: 'standard', role: 'guest' },
] as const;

for (const dataCase of dataCases) {
  for (const variant of variants) {
    test(
      `Complex feed tooltips on hover and focus with single-decrement read state ${dataCase.caseId} ${variant.locale} ${variant.plan} ${variant.role}`,
      { tag: ['@generated', '@smoke', '@local-fixture', '@complex-feed'] },
      async ({ page }) => {
        test.info().annotations.push({
          type: 'covered-ac-ids',
          description: 'AC-001 AC-002 AC-003 AC-004 AC-005',
        });

        const complexFeedPageObject = new ComplexFeedPageObject(page);

        await test.step('Arrange AC-001: open the deterministic 15-story feed', async () => {
          await complexFeedPageObject.open();
        });

        await test.step('Action AC-002: hover story 2 info tip', async () => {
          await complexFeedPageObject.hoverInfoTip(
            dataCase.hoverStory,
            dataCase.hoverTooltipText,
          );
        });

        await test.step('Action AC-003: keyboard-focus story 3 info tip', async () => {
          await complexFeedPageObject.focusInfoTip(
            dataCase.focusStory,
            dataCase.focusTooltipText,
          );
        });

        await test.step('Action AC-004: expand story 2 details for the first read', async () => {
          await complexFeedPageObject.expandDetails(dataCase.readStory);
        });

        await test.step(`Action AC-005: collapse and re-expand story 2 details for ${dataCase.detailsExpansions} total expansions`, async () => {
          await complexFeedPageObject.collapseAndReExpandDetails(dataCase.readStory);
        });

        await test.step('Assert AC-005: unread badge shows 14', async () => {
          const unreadBadgeObject = complexFeedPageObject.unreadBadgeObject;
          await expect(unreadBadgeObject).toHaveText(dataCase.unreadBadgeAfterRead);
        });
      },
    );
  }
}
