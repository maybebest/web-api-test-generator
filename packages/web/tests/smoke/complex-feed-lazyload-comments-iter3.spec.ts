/* spec: specs/complex-feed-lazyload-comments.md version:1.0.0 sha256:d5ccaf9b451b30886174c0eae2bc18258ed2009ebd5664c70e13614bd3643043 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test';

class ComplexFeedPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto('/complex/feed');
  }

  unreadBadge(): Locator {
    return this.page.getByTestId('unread-badge');
  }

  private unreadBadgeWithText(text: string): Locator {
    return this.unreadBadge().filter({ hasText: new RegExp(`^${text}$`) });
  }

  private feedItems(): Locator {
    return this.page.getByTestId(/^feed-item-\d+$/);
  }

  private story(storyNumber: string): Locator {
    return this.page.getByTestId(`feed-item-${storyNumber}`);
  }

  private loadMoreButton(): Locator {
    return this.page.getByTestId('feed-load-more');
  }

  async waitForStoryCountAndBadge(storyCount: number, badgeText: string): Promise<void> {
    await this.story(String(storyCount)).waitFor({ state: 'visible' });
    await this.unreadBadgeWithText(badgeText).waitFor({ state: 'visible' });

    const renderedStoryCount = await this.feedItems().count();
    if (renderedStoryCount !== storyCount) {
      throw new Error(`Expected ${storyCount} feed stories, but found ${renderedStoryCount}`);
    }
  }

  async loadMoreAndWaitForStoryCount(storyCount: number, badgeText: string): Promise<void> {
    await this.loadMoreButton().click();
    await this.waitForStoryCountAndBadge(storyCount, badgeText);
  }

  async expandStoryDetails(storyNumber: string, unreadBadgeText: string): Promise<void> {
    await this.story(storyNumber).getByRole('button', { name: 'Details', exact: true }).click();
    await this.unreadBadgeWithText(unreadBadgeText).waitFor({ state: 'visible' });
  }

  async openStoryCommentsAndWaitForComment(
    storyNumber: string,
    deepCommentText: string,
  ): Promise<void> {
    const storyObject = this.story(storyNumber);
    await storyObject.getByRole('button', { name: 'Comments', exact: true }).click();
    await storyObject.getByText(deepCommentText, { exact: true }).waitFor({ state: 'visible' });
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
    `Complex feed lazy loading, story expansion, and nested comments [${dataCase.caseId}]`,
    { tag: ['@generated', '@smoke', '@local-fixture', '@complex-feed'] },
    async ({ page }) => {
      test.info().annotations.push({
        type: 'covered-ac-ids',
        description: 'AC-001 AC-002 AC-003 AC-004 AC-005',
      });

      const complexFeedPage = new ComplexFeedPage(page);

      await test.step('Arrange AC-001: open the feed and wait for 15 stories with badge 15', async () => {
        await complexFeedPage.open();
        await complexFeedPage.waitForStoryCountAndBadge(Number(dataCase.inputs.initialBatch), '15');
      });

      await test.step('Action AC-002: load one batch and wait for 20 stories with badge 20', async () => {
        for (let clickNumber = 0; clickNumber < Number(dataCase.inputs.loadMoreClicks); clickNumber += 1) {
          await complexFeedPage.loadMoreAndWaitForStoryCount(
            dataCase.expected.storyCountAfterLoadMore,
            '20',
          );
        }
      });

      await test.step('Action AC-003: expand story 1 details and mark it read', async () => {
        await complexFeedPage.expandStoryDetails(
          dataCase.inputs.expandedStory,
          dataCase.expected.unreadBadgeText,
        );
      });

      await test.step('Action AC-004: show Comment C-1-1-1-1 on story 1', async () => {
        await complexFeedPage.openStoryCommentsAndWaitForComment(
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
