/* spec: specs/complex-feed-lazyload-comments.md version:1.0.0 sha256:d5ccaf9b451b30886174c0eae2bc18258ed2009ebd5664c70e13614bd3643043 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test';

class ComplexFeedPage {
  constructor(private readonly page: Page) {}

  unreadBadge(): Locator {
    return this.page.getByTestId('unread-badge');
  }

  private loadMoreButton(): Locator {
    return this.page.getByTestId('feed-load-more');
  }

  private story(storyNumber: number): Locator {
    return this.page.getByTestId(`feed-item-${storyNumber}`);
  }

  private detailsButton(storyNumber: number): Locator {
    return this.story(storyNumber).getByRole('button', { name: 'Details' });
  }

  private commentsButton(storyNumber: number): Locator {
    return this.story(storyNumber).getByRole('button', { name: 'Comments' });
  }

  private deepComment(commentText: string): Locator {
    return this.story(1).getByText(commentText);
  }

  private badgeWithText(text: string): Locator {
    return this.unreadBadge().filter({ hasText: text });
  }

  async openAndWaitForInitialStories(initialBatch: number): Promise<void> {
    await this.page.goto('/complex/feed');
    await this.story(initialBatch).waitFor({ state: 'visible' });
    await this.badgeWithText(String(initialBatch)).waitFor({ state: 'visible' });
  }

  async loadMoreAndWaitForStoryCount(storyCount: number): Promise<void> {
    await this.loadMoreButton().click();
    await this.story(storyCount).waitFor({ state: 'visible' });
    await this.badgeWithText(String(storyCount)).waitFor({ state: 'visible' });
  }

  async expandStoryDetails(storyNumber: number): Promise<void> {
    await this.detailsButton(storyNumber).click();
  }

  async openCommentsAndWaitForDeepComment(
    storyNumber: number,
    commentText: string,
  ): Promise<void> {
    await this.commentsButton(storyNumber).click();
    await this.deepComment(commentText).waitFor({ state: 'visible' });
  }
}

const dataCases = [
  {
    caseId: 'DC-001',
    expandedStory: 1,
    initialBatch: 15,
    loadMoreClicks: 1,
    storyCountAfterLoadMore: 20,
    deepCommentText: 'Comment C-1-1-1-1 on story 1',
    unreadBadgeText: '19',
  },
] as const;

const variants = [
  { locale: 'en-US', plan: 'standard', role: 'guest' },
] as const;

for (const dataCase of dataCases) {
  for (const variant of variants) {
    test(
      `Complex feed lazy loading, story expansion, and nested comments — ${dataCase.caseId} ${variant.locale} ${variant.plan} ${variant.role}`,
      { tag: ['@generated', '@smoke', '@local-fixture', '@complex-feed'] },
      async ({ page }) => {
        test.info().annotations.push({
          type: 'covered-ac-ids',
          description: 'AC-001 AC-002 AC-003 AC-004 AC-005',
        });

        const complexFeedPageObject = new ComplexFeedPage(page);

        await test.step('Arrange AC-001: open the feed and load 15 stories', async () => {
          await complexFeedPageObject.openAndWaitForInitialStories(dataCase.initialBatch);
        });

        await test.step('Action AC-002: load one batch and grow the feed to 20 stories', async () => {
          for (let clickNumber = 0; clickNumber < dataCase.loadMoreClicks; clickNumber += 1) {
            await complexFeedPageObject.loadMoreAndWaitForStoryCount(
              dataCase.storyCountAfterLoadMore,
            );
          }
        });

        await test.step('Action AC-003: expand story 1 details and mark it read', async () => {
          await complexFeedPageObject.expandStoryDetails(dataCase.expandedStory);
        });

        await test.step('Action AC-004: reveal Comment C-1-1-1-1 on story 1', async () => {
          await complexFeedPageObject.openCommentsAndWaitForDeepComment(
            dataCase.expandedStory,
            dataCase.deepCommentText,
          );
        });

        await test.step('Assert AC-005: unread badge shows 19', async () => {
          const unreadBadgeObject = complexFeedPageObject.unreadBadge();
          await expect(unreadBadgeObject).toHaveText(dataCase.unreadBadgeText);
        });
      },
    );
  }
}
