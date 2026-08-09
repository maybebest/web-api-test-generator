/* spec: specs/complex-feed-lazyload-comments.md version:1.0.0 sha256:d5ccaf9b451b30886174c0eae2bc18258ed2009ebd5664c70e13614bd3643043 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test';

class ComplexFeedPage {
  constructor(private readonly page: Page) {}

  private storyObject(storyNumber: string): Locator {
    return this.page.getByTestId(`feed-item-${storyNumber}`);
  }

  private storyByPositionObject(position: number): Locator {
    return this.page.getByTestId(`feed-item-${position}`);
  }

  private unreadBadgeObject(): Locator {
    return this.page.getByTestId('unread-badge');
  }

  private loadMoreButtonObject(): Locator {
    return this.page.getByTestId('feed-load-more');
  }

  async open(): Promise<void> {
    await this.page.goto('/complex/feed');
  }

  async waitForInitialFeed(storyCount: number, unreadBadgeText: string): Promise<void> {
    await this.storyByPositionObject(storyCount).waitFor({ state: 'visible' });
    await this.unreadBadgeObject().filter({ hasText: unreadBadgeText }).waitFor({ state: 'visible' });
  }

  async loadMoreAndWaitForFeed(storyCount: number, unreadBadgeText: string): Promise<void> {
    await this.loadMoreButtonObject().click();
    await this.storyByPositionObject(storyCount).waitFor({ state: 'visible' });
    await this.unreadBadgeObject().filter({ hasText: unreadBadgeText }).waitFor({ state: 'visible' });
  }

  async expandStoryDetails(storyNumber: string): Promise<void> {
    await this.storyObject(storyNumber).getByRole('button', { name: 'Details', exact: true }).click();
  }

  async openStoryComments(storyNumber: string, deepCommentText: string): Promise<void> {
    const storyObject = this.storyObject(storyNumber);
    await storyObject.getByRole('button', { name: 'Comments', exact: true }).click();
    await storyObject.getByText(deepCommentText, { exact: true }).waitFor({ state: 'visible' });
  }

  unreadBadge(): Locator {
    return this.unreadBadgeObject();
  }
}

const dataCases = [
  {
    caseId: 'DC-001',
    expandedStory: '1',
    initialStoryCount: 15,
    storyCountAfterLoadMore: 20,
    deepCommentText: 'Comment C-1-1-1-1 on story 1',
    unreadBadgeText: '19',
  },
] as const;

for (const dataCase of dataCases) {
  test(
    `Complex feed lazy loading, story expansion, and nested comments ${dataCase.caseId}`,
    { tag: ['@generated', '@smoke', '@local-fixture', '@complex-feed'] },
    async ({ page }) => {
      test.info().annotations.push({
        type: 'covered-ac-ids',
        description: 'AC-001 AC-002 AC-003 AC-004 AC-005',
      });

      const complexFeedPage = new ComplexFeedPage(page);

      await test.step('Arrange AC-001: open the feed and render 15 stories with badge 15', async () => {
        await complexFeedPage.open();
        await complexFeedPage.waitForInitialFeed(dataCase.initialStoryCount, '15');
      });

      await test.step('Action AC-002: load more to render 20 stories with badge 20', async () => {
        await complexFeedPage.loadMoreAndWaitForFeed(dataCase.storyCountAfterLoadMore, '20');
      });

      await test.step('Action AC-003: expand story 1 details and mark it read', async () => {
        await complexFeedPage.expandStoryDetails(dataCase.expandedStory);
      });

      await test.step(`Action AC-004: reveal ${dataCase.deepCommentText}`, async () => {
        await complexFeedPage.openStoryComments(dataCase.expandedStory, dataCase.deepCommentText);
      });

      await test.step('Assert AC-005: unread badge shows 19', async () => {
        await expect(complexFeedPage.unreadBadge()).toHaveText(dataCase.unreadBadgeText);
      });
    },
  );
}
