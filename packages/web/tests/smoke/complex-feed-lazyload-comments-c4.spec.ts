/* spec: specs/complex-feed-lazyload-comments.md version:1.0.0 sha256:d5ccaf9b451b30886174c0eae2bc18258ed2009ebd5664c70e13614bd3643043 */
import { test, expect } from '../../fixtures/test';
import type { Locator, Page } from '@playwright/test';

class ComplexFeedPage {
  constructor(private readonly page: Page) {}

  unreadBadge(): Locator {
    return this.page.getByTestId('unread-badge');
  }

  private story(storyNumber: number): Locator {
    return this.page.getByTestId(`feed-item-${storyNumber}`);
  }

  async openAndWaitForInitialBatch(initialBatch: number): Promise<void> {
    await this.page.goto('/complex/feed');
    await this.story(initialBatch).waitFor({ state: 'visible' });
    await this.unreadBadge().getByText(String(initialBatch), { exact: true }).waitFor({ state: 'visible' });
  }

  async loadMoreAndWaitForStoryCount(storyCount: number): Promise<void> {
    await this.page.getByTestId('feed-load-more').click();
    await this.story(storyCount).waitFor({ state: 'visible' });
    await this.unreadBadge().getByText(String(storyCount), { exact: true }).waitFor({ state: 'visible' });
  }

  async expandStoryDetails(storyNumber: number): Promise<void> {
    await this.story(storyNumber).getByRole('button', { name: 'Details', exact: true }).click();
  }

  async openStoryCommentsAndWaitForComment(storyNumber: number, commentText: string): Promise<void> {
    const storyObject = this.story(storyNumber);
    await storyObject.getByRole('button', { name: 'Comments', exact: true }).click();
    await storyObject.getByText(commentText, { exact: true }).waitFor({ state: 'visible' });
  }
}

const dataCases = [
  {
    caseId: 'DC-001',
    expandedStory: 1,
    initialBatch: 15,
    storyCountAfterLoadMore: 20,
    loadMoreClicks: 1,
    deepCommentText: 'Comment C-1-1-1-1 on story 1',
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

      await test.step('Arrange AC-001: open the feed and wait for 15 stories', async () => {
        await complexFeedPage.openAndWaitForInitialBatch(dataCase.initialBatch);
      });

      await test.step('Action AC-002: load one batch and grow the feed to 20 stories', async () => {
        for (let clickNumber = 0; clickNumber < dataCase.loadMoreClicks; clickNumber += 1) {
          await complexFeedPage.loadMoreAndWaitForStoryCount(dataCase.storyCountAfterLoadMore);
        }
      });

      await test.step('Action AC-003: expand story 1 details and mark it read', async () => {
        await complexFeedPage.expandStoryDetails(dataCase.expandedStory);
      });

      await test.step('Action AC-004: reveal Comment C-1-1-1-1 on story 1', async () => {
        await complexFeedPage.openStoryCommentsAndWaitForComment(
          dataCase.expandedStory,
          dataCase.deepCommentText,
        );
      });

      await test.step('Assert AC-005: unread badge shows 19', async () => {
        await expect(complexFeedPage.unreadBadge()).toHaveText(dataCase.unreadBadgeText);
      });
    },
  );
}
