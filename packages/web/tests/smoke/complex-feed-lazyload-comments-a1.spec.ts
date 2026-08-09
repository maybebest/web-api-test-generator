/* spec: specs/complex-feed-lazyload-comments.md version:1.0.0 sha256:d5ccaf9b451b30886174c0eae2bc18258ed2009ebd5664c70e13614bd3643043 */
import { test, expect } from '../../fixtures/test';
import type { Locator, Page } from '@playwright/test';

class ComplexFeedPageObject {
  constructor(private readonly page: Page) {}

  private story(storyNumber: number): Locator {
    return this.page.getByTestId(`feed-item-${storyNumber}`);
  }

  unreadBadge(): Locator {
    return this.page.getByTestId('unread-badge');
  }

  async open(): Promise<void> {
    await this.page.goto('/complex/feed');
  }

  async waitForInitialFeed(): Promise<void> {
    await this.story(1).waitFor({ state: 'visible' });
    await this.story(15).waitFor({ state: 'visible' });
    await this.story(16).waitFor({ state: 'hidden' });
    await this.unreadBadge().filter({ hasText: '15' }).waitFor({ state: 'visible' });
  }

  async loadMore(): Promise<void> {
    await this.page.getByTestId('feed-load-more').click();
    await this.story(20).waitFor({ state: 'visible' });
    await this.story(21).waitFor({ state: 'hidden' });
    await this.unreadBadge().filter({ hasText: '20' }).waitFor({ state: 'visible' });
  }

  async expandFirstStoryDetails(): Promise<void> {
    const firstStoryObject = this.story(1);
    await firstStoryObject.getByRole('button', { name: 'Details' }).click();
  }

  async openFirstStoryComments(deepCommentText: string): Promise<void> {
    const firstStoryObject = this.story(1);
    await firstStoryObject.getByRole('button', { name: 'Comments' }).click();
    await firstStoryObject.getByText(deepCommentText, { exact: true }).waitFor({ state: 'visible' });
  }
}

const dataCases = [
  {
    caseId: 'DC-001',
    deepCommentText: 'Comment C-1-1-1-1 on story 1',
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
      `Complex feed lazy loading, story expansion, and nested comments (${dataCase.caseId}, ${variant.locale}, ${variant.plan}, ${variant.role})`,
      { tag: ['@generated', '@smoke', '@local-fixture', '@complex-feed'] },
      async ({ page }) => {
        test.info().annotations.push({
          type: 'covered-ac-ids',
          description: 'AC-001 AC-002 AC-003 AC-004 AC-005',
        });

        const complexFeedPageObject = new ComplexFeedPageObject(page);

        await test.step('Arrange AC-001: open the feed and wait for 15 stories with unread badge 15', async () => {
          await complexFeedPageObject.open();
          await complexFeedPageObject.waitForInitialFeed();
        });

        await test.step('Action AC-002: load more to append 5 stories and show unread badge 20', async () => {
          await complexFeedPageObject.loadMore();
        });

        await test.step('Action AC-003: expand story 1 details and mark it read', async () => {
          await complexFeedPageObject.expandFirstStoryDetails();
        });

        await test.step(`Action AC-004: open comments and reveal ${dataCase.deepCommentText}`, async () => {
          await complexFeedPageObject.openFirstStoryComments(dataCase.deepCommentText);
        });

        await test.step('Assert AC-005: unread badge shows 19', async () => {
          const unreadBadgeObject = complexFeedPageObject.unreadBadge();
          await expect(unreadBadgeObject).toHaveText('19');
        });
      },
    );
  }
}
