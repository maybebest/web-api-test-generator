/* spec: specs/sains/entry-shell-responsive-accessibility.md version:1.0.0 sha256:59ad8c46f759ff1615bb1a09b466e93c1e3d7185c0f8024189a0b42e05f0f894 */
import { test, expect } from '../../../fixtures/test';
import { NectarAiEntryShellPage } from '../../../pages/NectarAiEntryShellPage';

// The focused shell object delegates the live entry locator/readiness contract
// to PlanningPage while preventing this read-only suite from activating it.

const responsiveCases = [
  {
    caseId: 'DC-001',
    label: 'desktop probe',
    viewport: { width: 1440, height: 900 },
    expected: { maxHorizontalOverflowPixels: 1, entryActionContained: true }
  },
  {
    caseId: 'DC-002',
    label: 'tablet landscape probe',
    viewport: { width: 1024, height: 768 },
    expected: { maxHorizontalOverflowPixels: 1, entryActionContained: true }
  },
  {
    caseId: 'DC-003',
    label: 'mobile portrait probe',
    viewport: { width: 390, height: 844 },
    expected: { maxHorizontalOverflowPixels: 1, entryActionContained: true }
  }
] as const;

test.describe('Authenticated Nectar AI entry-shell responsive and accessibility checks', () => {
  for (const dataCase of responsiveCases) {
    test(
      `${dataCase.caseId} ${dataCase.label} keeps the entry action on screen`,
      { tag: ['@generated', '@regression', '@accessibility', '@responsive', '@authenticated'] },
      async ({ page }) => {
        const entryShellPage = new NectarAiEntryShellPage(page);

        await test.step('Arrange: set the declared viewport before opening the authenticated entry shell', async () => {
          await entryShellPage.setViewportSize(dataCase.viewport.width, dataCase.viewport.height);
          await entryShellPage.goto();
        });

        await test.step('Assert AC-001: the entry action is visible and the declared viewport has no clipped entry shell', async () => {
          await expect(entryShellPage.startAssistantButton()).toBeVisible();
          await expect.poll(() => entryShellPage.horizontalOverflowPixels()).toBeLessThanOrEqual(
            dataCase.expected.maxHorizontalOverflowPixels
          );
          await expect.poll(() => entryShellPage.startAssistantButtonIsInsideViewport()).toBe(
            dataCase.expected.entryActionContained
          );
        });
      }
    );
  }

  test(
    'DC-004 entry action exposes its visible purpose as an accessible name',
    { tag: ['@generated', '@regression', '@accessibility', '@responsive', '@authenticated'] },
    async ({ page }) => {
      const entryShellPage = new NectarAiEntryShellPage(page);

      await test.step('Arrange: open the authenticated desktop entry shell without activating its action', async () => {
        await entryShellPage.setViewportSize(1440, 900);
        await entryShellPage.goto();
      });

      await test.step('Assert AC-002: the entry action names the Nectar AI Assistant action', async () => {
        await expect(entryShellPage.startAssistantButton()).toHaveAccessibleName('Try Nectar AI Assistant now');
      });
    }
  );

  test(
    'DC-005 entry shell has no automated WCAG 2.0 or 2.1 A or AA violations',
    { tag: ['@generated', '@regression', '@accessibility', '@responsive', '@authenticated'] },
    async ({ page }) => {
      const entryShellPage = new NectarAiEntryShellPage(page);

      await test.step('Arrange: open the authenticated desktop entry shell', async () => {
        await entryShellPage.setViewportSize(1440, 900);
        await entryShellPage.goto();
      });

      await test.step('Action: scan the authenticated document with the declared axe-core rule tags', async () => {
        await entryShellPage.scanDocumentForAccessibilityViolations();
      });

      await test.step('Assert AC-003: the automated accessibility violation ID list is empty', async () => {
        await expect.poll(() => entryShellPage.accessibilityViolationIds(), { timeout: 1_000 }).toEqual([]);
      });
    }
  );

  test(
    'NEG-001 natural forward keyboard traversal reaches the entry action',
    { tag: ['@generated', '@regression', '@accessibility', '@responsive', '@authenticated'] },
    async ({ page }) => {
      const entryShellPage = new NectarAiEntryShellPage(page);

      await test.step('Arrange: open the authenticated desktop entry shell without clicking', async () => {
        await entryShellPage.setViewportSize(1440, 900);
        await entryShellPage.goto();
      });

      await test.step('Action: follow the natural keyboard sequence through the bounded traversal', async () => {
        await entryShellPage.reachStartAssistantButtonWithKeyboard(80);
      });

      await test.step('Assert NEG-001: the entry action is not absent from the natural keyboard sequence', async () => {
        await expect(entryShellPage.startAssistantButton()).toBeFocused();
      });
    }
  );
});
