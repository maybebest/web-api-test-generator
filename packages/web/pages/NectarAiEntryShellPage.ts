import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';

import { PlanningPage } from './PlanningPage';

const KEYBOARD_TRAVERSAL_LIMIT = 80;

/**
 * Read-only Page Object for the authenticated Nectar AI entry shell.
 *
 * The helpers in this object deliberately stop before activating "Try now":
 * opening the guided assistant may create a live session, while viewport,
 * keyboard and accessibility inspection of the landing shell is side-effect
 * free.
 */
export class NectarAiEntryShellPage {
  private readonly page: Page;
  private readonly planningPage: PlanningPage;
  private lastAxeViolationIds: string[] = ['accessibility-scan-not-run'];

  constructor(page: Page) {
    this.page = page;
    this.planningPage = new PlanningPage(page);
  }

  async goto(): Promise<void> {
    await this.planningPage.goto();
  }

  async setViewportSize(width: number, height: number): Promise<void> {
    await this.page.setViewportSize({ width, height });
  }

  startAssistantButton(): Locator {
    return this.planningPage.startAssistantButton();
  }

  async horizontalOverflowPixels(): Promise<number> {
    return this.page.evaluate(() => {
      const root = document.documentElement;
      return Math.max(0, root.scrollWidth - root.clientWidth);
    });
  }

  async startAssistantButtonIsInsideViewport(): Promise<boolean> {
    return this.startAssistantButton().evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const tolerance = 1;
      return (
        bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.left >= -tolerance &&
        bounds.top >= -tolerance &&
        bounds.right <= globalThis.innerWidth + tolerance &&
        bounds.bottom <= globalThis.innerHeight + tolerance
      );
    });
  }

  /**
   * Follow the page's natural Tab order without clicking or programmatically
   * focusing the target. The bounded traversal prevents an infinite loop when
   * the control is missing from the keyboard sequence.
   */
  async reachStartAssistantButtonWithKeyboard(maxTabPresses = KEYBOARD_TRAVERSAL_LIMIT): Promise<void> {
    const target = this.startAssistantButton();
    if (await target.evaluate((element) => element === document.activeElement)) {
      return;
    }

    for (let index = 0; index < maxTabPresses; index += 1) {
      await this.page.keyboard.press('Tab');
      if (await target.evaluate((element) => element === document.activeElement)) {
        return;
      }
    }
  }

  /** Run the automated WCAG 2.0/2.1 A/AA rules against the rendered document. */
  async scanDocumentForAccessibilityViolations(): Promise<void> {
    const results = await new AxeBuilder({ page: this.page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    this.lastAxeViolationIds = [...new Set(results.violations.map((violation) => violation.id))].sort();
  }

  accessibilityViolationIds(): string[] {
    return this.lastAxeViolationIds;
  }
}
