import type { Locator, Page } from '@playwright/test';

/**
 * Component Object for the single-prompt Hero+Measurement parsing suite
 * (specs/skus/single-prompt-hero-measurement-parsing.md).
 *
 * Owns the observable surfaces the parameterized data cases assert on, keyed by a
 * stable surface name so the suite can assert uniformly per data-case row:
 *   - 'chat'              the assistant conversation panel (testid chat-panel)
 *   - 'measurement-count' the summary Measurement SKUs counter (testid plan-measurement-skus)
 *   - 'hero-count'        the summary Hero SKUs counter (testid plan-hero-skus)
 *   - 'hero-step'         the standard two-step flow's "Add hero SKU" control
 *   - 'edit-modal'        the open Edit Measurement/Hero SKUs dialog
 *
 * All locators mirror the live-audited contracts already proven in
 * pages/PlanningPage.ts (2026-07-02/03 read-only audits of the dev environment).
 */
export type ParseSurface = 'chat' | 'measurement-count' | 'hero-count' | 'hero-step' | 'edit-modal';

export class SinglePromptParseComponent {
  constructor(private readonly page: Page) {}

  /** Resolve a data-case signal surface to its owned locator. */
  surface(surface: ParseSurface): Locator {
    switch (surface) {
      case 'chat':
        return this.assistantChatPanel();
      case 'measurement-count':
        return this.measurementCounter();
      case 'hero-count':
        return this.heroCounter();
      case 'hero-step':
        return this.heroSelectionStep();
      case 'edit-modal':
        return this.editSkuModal();
    }
  }

  /** The assistant conversation; parsed selections and clarifications render here. */
  assistantChatPanel(): Locator {
    return this.page.getByTestId('chat-panel');
  }

  /** Summary Measurement SKUs counter row ("N SKUs" / "To be defined"). */
  measurementCounter(): Locator {
    return this.page.getByTestId('plan-measurement-skus');
  }

  /** Summary Hero SKUs counter row ("N SKUs" / "To be defined"). */
  heroCounter(): Locator {
    return this.page.getByTestId('plan-hero-skus');
  }

  /**
   * The standard (two-step) flow's hero-selection step control. Several per-row
   * "Add hero SKU" buttons can render at once, so the first proves the step exists.
   */
  heroSelectionStep(): Locator {
    // locator-policy:exception any visible "Add hero SKU" control proves the two-step hero stage rendered
    return this.page.getByRole('button', { name: 'Add hero SKU' }).first();
  }

  /** The open "Edit Measurement/Hero SKUs" dialog (selected rows carry the SKU ids). */
  editSkuModal(): Locator {
    return this.page.getByRole('dialog', { name: /Measurement|Hero/i });
  }
}
