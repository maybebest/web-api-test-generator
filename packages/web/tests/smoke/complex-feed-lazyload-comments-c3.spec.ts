/* spec: specs/complex-feed-lazyload-comments.md version:1.0.0 sha256:d5ccaf9b451b30886174c0eae2bc18258ed2009ebd5664c70e13614bd3643043 */
import { test, expect } from '../../fixtures/test';
import type { Locator, Page } from '@playwright/test';

class ComplexFeedPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto('/complex/feed');
  }

  unreadBadge(): Locator {
    return this.page.getByTestId('unread-badge');
  }

  private story(storyId: string): Locator {
    return this.page.getByTestId(`feed-item-${storyId}`);
  }

  async waitForStoryCount(expectedCount: number): Promise<void> {
    // locator-policy:exception counting the supplied feed-item testid prefix requires a collection selector
    await this.page.waitForFunction(
      ({ count }) =>
        document.querySelectorAll('[data-testid^="feed-item-"]').length === count,
      { count: expectedCount },
    );
  }

  async waitForUnreadBadgeText(expectedText: string): Promise<void> {
    await this.unreadBadge().getByText(expectedText, { exact: true }).waitFor();
  }

  async loadMore(): Promise<void> {
    await this.page.getByTestId('feed-load-more').click();
  }

  async expandDetails(storyId: string): Promise<void> {
    await this.story(storyId).getByRole('button', { name: 'Details', exact: true }).click();
  }

  async openComments(storyId: string): Promise<void> {
    await this.story(storyId).getByRole('button', { name: 'Comments', exact: true }).click();
  }

  async waitForDeepComment(storyId: string, commentText: string): Promise<void> {
    await this.story(storyId).getByText(commentText, { exact: true }).waitFor();
  }
}

const dataCases = [
  {
    caseId: 'DC-001',
    inputs: {
      expandedStory: '1',
      initialBatch: '15',
      loadMoreClicks: '1',
    },
    expected: {
      deepCommentText: 'Comment C-1-1-1-1 on story 1',
      storyCountAfterLoadMore: 20,
      unreadBadgeText: '19',
    },
  },
] as const;

for (const dataCase of dataCases) {
  test(
    `Complex feed lazy loading, story expansion, and nested comments - ${dataCase.caseId}`,
    { tag: ['@generated', '@smoke', '@local-fixture', '@complex-feed'] },
    async ({ page }) => {
      test.info().annotations.push({
        type: 'covered-ac-ids',
        description: 'AC-001 AC-002 AC-003 AC-004 AC-005',
      });

      const complexFeedPage = new ComplexFeedPage(page);

      await test.step('Arrange AC-001: open the feed and render 15 stories', async () => {
        await complexFeedPage.open();
        await complexFeedPage.waitForStoryCount(Number(dataCase.inputs.initialBatch));
        await complexFeedPage.waitForUnreadBadgeText(dataCase.inputs.initialBatch);
      });

      await test.step('Act AC-002: load more and grow the feed to 20 stories', async () => {
        for (let click = 0; click < Number(dataCase.inputs.loadMoreClicks); click += 1) {
          await complexFeedPage.loadMore();
        }
        await complexFeedPage.waitForStoryCount(dataCase.expected.storyCountAfterLoadMore);
        await complexFeedPage.waitForUnreadBadgeText(
          String(dataCase.expected.storyCountAfterLoadMore),
        );
      });

      await test.step('Act AC-003: expand story 1 details and mark it read', async () => {
        await complexFeedPage.expandDetails(dataCase.inputs.expandedStory);
        await complexFeedPage.waitForUnreadBadgeText(dataCase.expected.unreadBadgeText);
      });

      await test.step('Act AC-004: reveal Comment C-1-1-1-1 on story 1', async () => {
        await complexFeedPage.openComments(dataCase.inputs.expandedStory);
        await complexFeedPage.waitForDeepComment(
          dataCase.inputs.expandedStory,
          dataCase.expected.deepCommentText,
        );
      });

      await test.step('Assert AC-005: unread badge shows 19', async () => {
        await expect(complexFeedPage.unreadBadge()).toHaveText(dataCase.expected.unreadBadgeText);
      });
    },
  );
}
