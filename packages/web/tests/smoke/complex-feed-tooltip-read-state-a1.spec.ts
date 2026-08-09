/* spec: specs/complex-feed-tooltip-read-state.md version:1.0.0 sha256:10e06dd30bc4b59c1fb13bca2f5dce2c3e5660a40d4f8ec3965992e2f33f01a4 */
import { test, expect } from '../../fixtures/test';
import type { Locator, Page } from '@playwright/test';

class ComplexFeedPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto('/complex/feed');
  }

  async waitForInitialFeed(): Promise<void> {
    for (let storyNumber = 1; storyNumber <= 15; storyNumber += 1) {
      await this.page.getByTestId(`feed-item-${storyNumber}`).waitFor({ state: 'visible' });
    }

    await this.page
      .getByTestId('unread-badge')
      .filter({ hasText: '15' })
      .waitFor({ state: 'visible' });
  }

  async hoverInfoTip(
    storyTestId: string,
    expectedTooltipText: string,
  ): Promise<void> {
    const storyObject = this.page.getByTestId(storyTestId);
    // locator-policy:exception The focusable info tip has no accessible role or unique accessible name.
    const infoTipObject = storyObject.locator('.tip');
    await infoTipObject.hover();
    await storyObject
      .getByRole('tooltip')
      .filter({ hasText: expectedTooltipText })
      .waitFor({ state: 'visible' });
  }

  async focusInfoTip(
    storyTestId: string,
    expectedTooltipText: string,
  ): Promise<void> {
    const storyObject = this.page.getByTestId(storyTestId);
    // locator-policy:exception The focusable info tip has no accessible role or unique accessible name.
    const infoTipObject = storyObject.locator('.tip');
    await infoTipObject.focus();
    await storyObject
      .getByRole('tooltip')
      .filter({ hasText: expectedTooltipText })
      .waitFor({ state: 'visible' });
  }

  async toggleDetails(storyTestId: string): Promise<void> {
    await this.page
      .getByTestId(storyTestId)
      .getByRole('button', { name: 'Details' })
      .click();
  }

  unreadBadge(): Locator {
    return this.page.getByTestId('unread-badge');
  }
}

const dataCases = [
  {
    caseId: 'DC-001',
    hoverStoryTestId: 'feed-item-2',
    focusStoryTestId: 'feed-item-3',
    hoverTooltipText: 'Story 2 is deterministic fixture data',
    focusTooltipText: 'Story 3 is deterministic fixture data',
    unreadBadgeAfterRead: '14',
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
      `Complex feed tooltips on hover and focus with single-decrement read state ${dataCase.caseId} ${variant.locale} ${variant.plan} ${variant.role}`,
      { tag: ['@generated', '@smoke', '@local-fixture', '@complex-feed'] },
      async ({ page }) => {
        test.info().annotations.push({
          type: 'covered-ac-ids',
          description: 'AC-001 AC-002 AC-003 AC-004 AC-005',
        });

        const complexFeedPage = new ComplexFeedPage(page);

        await test.step('Arrange AC-001: open the feed and wait for 15 stories with unread badge 15', async () => {
          await complexFeedPage.open();
          await complexFeedPage.waitForInitialFeed();
        });

        await test.step(`Action AC-002: reveal ${dataCase.hoverTooltipText} by hovering story 2`, async () => {
          await complexFeedPage.hoverInfoTip(
            dataCase.hoverStoryTestId,
            dataCase.hoverTooltipText,
          );
        });

        await test.step(`Action AC-003: reveal ${dataCase.focusTooltipText} by focusing story 3`, async () => {
          await complexFeedPage.focusInfoTip(
            dataCase.focusStoryTestId,
            dataCase.focusTooltipText,
          );
        });

        await test.step('Action AC-004: expand story 2 details for the first read', async () => {
          await complexFeedPage.toggleDetails(dataCase.hoverStoryTestId);
        });

        await test.step('Action AC-005: collapse and re-expand story 2 details', async () => {
          await complexFeedPage.toggleDetails(dataCase.hoverStoryTestId);
          await complexFeedPage.toggleDetails(dataCase.hoverStoryTestId);
        });

        await test.step('Assert AC-005: unread badge shows 14', async () => {
          expect(complexFeedPage.unreadBadge()).toHaveText(dataCase.unreadBadgeAfterRead);
        });
      },
    );
  }
}
