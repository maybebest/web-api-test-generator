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

  private loadMoreButton(): Locator {
    return this.page.getByTestId('feed-load-more');
  }

  private story(storyNumber: number): Locator {
    return this.page.getByTestId(`feed-item-${storyNumber}`);
  }

  async waitForStoryCount(expectedCount: number): Promise<void> {
    // locator-policy:exception supplied testid prefix is required to verify the exact story count
    await this.page.waitForFunction(
      ({ selector, count }) => document.querySelectorAll(selector).length === count,
      { selector: '[data-testid^="feed-item-"]', count: expectedCount },
    );
  }

  async waitForUnreadBadgeText(expectedText: string): Promise<void> {
    await this.unreadBadge().filter({ hasText: expectedText }).waitFor();
  }

  async loadMore(): Promise<void> {
    await this.loadMoreButton().click();
  }

  async expandStoryDetails(storyNumber: number): Promise<void> {
    await this.story(storyNumber)
      .getByRole('button', { name: 'Details', exact: true })
      .click();
  }

  async openStoryComments(storyNumber: number): Promise<void> {
    await this.story(storyNumber)
      .getByRole('button', { name: 'Comments', exact: true })
      .click();
  }

  async waitForComment(storyNumber: number, commentText: string): Promise<void> {
    await this.story(storyNumber).getByText(commentText, { exact: true }).waitFor();
  }
}

const dataCases = [
  {
    caseId: 'DC-001',
    inputs: {
      expandedStory: 1,
      initialBatch: 15,
      loadMoreClicks: 1,
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
    `Complex feed lazy loading, story expansion, and nested comments (${dataCase.caseId})`,
    { tag: ['@generated', '@smoke', '@local-fixture', '@complex-feed'] },
    async ({ page }) => {
      test.info().annotations.push({
        type: 'covered-ac-ids',
        description: 'AC-001 AC-002 AC-003 AC-004 AC-005',
      });

      const complexFeedPage = new ComplexFeedPage(page);

      await test.step('Arrange AC-001: open the feed and wait for 15 stories', async () => {
        await complexFeedPage.open();
        await complexFeedPage.waitForStoryCount(dataCase.inputs.initialBatch);
        await complexFeedPage.waitForUnreadBadgeText('15');
      });

      await test.step('Action AC-002: load one batch and wait for 20 stories', async () => {
        for (let clickIndex = 0; clickIndex < dataCase.inputs.loadMoreClicks; clickIndex += 1) {
          await complexFeedPage.loadMore();
        }
        await complexFeedPage.waitForStoryCount(dataCase.expected.storyCountAfterLoadMore);
        await complexFeedPage.waitForUnreadBadgeText('20');
      });

      await test.step('Action AC-003: expand story 1 details', async () => {
        await complexFeedPage.expandStoryDetails(dataCase.inputs.expandedStory);
      });

      await test.step('Action AC-004: reveal Comment C-1-1-1-1 on story 1', async () => {
        await complexFeedPage.openStoryComments(dataCase.inputs.expandedStory);
        await complexFeedPage.waitForComment(
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
