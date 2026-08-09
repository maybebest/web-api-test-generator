/* spec: specs/complex-feed-lazyload-comments.md version:1.0.0 sha256:d5ccaf9b451b30886174c0eae2bc18258ed2009ebd5664c70e13614bd3643043 */
import { test, expect } from '../../fixtures/test';
import type { Locator, Page } from '@playwright/test';

class ComplexFeedPage {
  readonly unreadBadgeObject: Locator;
  private readonly loadMoreButtonObject: Locator;
  private readonly firstStoryObject: Locator;
  private readonly deepCommentObject: Locator;

  constructor(private readonly page: Page) {
    this.unreadBadgeObject = page.getByTestId('unread-badge');
    this.loadMoreButtonObject = page.getByTestId('feed-load-more');
    this.firstStoryObject = page.getByTestId('feed-item-1');
    this.deepCommentObject = this.firstStoryObject.getByText(
      'Comment C-1-1-1-1 on story 1',
      { exact: true },
    );
  }

  async openAndWaitForInitialFeed(): Promise<void> {
    await this.page.goto('/complex/feed');
    await this.page.getByTestId('feed-item-15').waitFor({ state: 'visible' });
    await this.unreadBadgeObject.filter({ hasText: /^15$/ }).waitFor({ state: 'visible' });
  }

  async loadMoreAndWaitForTwentyStories(): Promise<void> {
    await this.loadMoreButtonObject.click();
    await this.page.getByTestId('feed-item-20').waitFor({ state: 'visible' });
    await this.unreadBadgeObject.filter({ hasText: /^20$/ }).waitFor({ state: 'visible' });
  }

  async expandFirstStoryDetails(): Promise<void> {
    await this.firstStoryObject.getByRole('button', { name: 'Details', exact: true }).click();
    await this.unreadBadgeObject.filter({ hasText: /^19$/ }).waitFor({ state: 'visible' });
  }

  async openFirstStoryCommentsAndWaitForDeepComment(): Promise<void> {
    await this.firstStoryObject.getByRole('button', { name: 'Comments', exact: true }).click();
    await this.deepCommentObject.waitFor({ state: 'visible' });
  }
}

const dataCases = [
  {
    caseId: 'DC-001',
    deepCommentText: 'Comment C-1-1-1-1 on story 1',
    storyCountAfterLoadMore: 20,
    unreadBadgeText: '19',
  },
] as const;

for (const dataCase of dataCases) {
  test(
    `Complex feed lazy loading, story expansion, and nested comments (${dataCase.caseId})`,
    { tag: ['@generated', '@smoke', '@local-fixture', '@complex-feed'] },
    async ({ page }) => {
      test.info().annotations.push({
        type: 'covered-ac-ids',
        description: 'AC-001 AC-002 AC-003 AC-004 AC-005',
      });

      const complexFeedPage = new ComplexFeedPage(page);

      await test.step('Arrange AC-001: open the feed and render 15 stories with badge 15', async () => {
        await complexFeedPage.openAndWaitForInitialFeed();
      });

      await test.step(`Action AC-002: load more to render ${dataCase.storyCountAfterLoadMore} stories with badge 20`, async () => {
        await complexFeedPage.loadMoreAndWaitForTwentyStories();
      });

      await test.step('Action AC-003: expand story 1 details and mark it read', async () => {
        await complexFeedPage.expandFirstStoryDetails();
      });

      await test.step(`Action AC-004: show ${dataCase.deepCommentText}`, async () => {
        await complexFeedPage.openFirstStoryCommentsAndWaitForDeepComment();
      });

      await test.step('Assert AC-005: unread badge shows 19', async () => {
        await expect(complexFeedPage.unreadBadgeObject).toHaveText(dataCase.unreadBadgeText);
      });
    },
  );
}
