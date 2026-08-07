import type { Locator, Page } from '@playwright/test';

import { PlanningPage } from './PlanningPage';

// Budgets mirror PlanningPage: streamed assistant turns run 30-60s+ on the dev
// environment and a channel add (disambiguate -> select -> extract -> recompute)
// is the slowest, most variable operation.
const MODAL_READY_TIMEOUT = 30_000;
const ASSISTANT_REPLY_TIMEOUT = 60_000;
const CHANNEL_ADD_TIMEOUT = 120_000;

/**
 * Where a max/min Hero SKU signal is expected to render:
 * - 'summary'      — inside the summary panel (channel rows and their per-channel
 *                    "Media limit: <max> Hero SKUs. Edit SKUs" warnings);
 * - 'chat'         — inside the assistant conversation (backend informing messages);
 * - 'hero-count'   — the summary "Hero SKUs" counter row (plan-hero-skus testid),
 *                    filtered by the expected "<n> SKUs" text;
 * - 'modal'        — inside the open Edit SKU dialog;
 * - 'modal-count'  — the open dialog's selected-skus-length counter;
 * - 'page'         — anywhere on the page (save/booking outcome copy).
 */
export type MaxHeroSignalScope = 'page' | 'summary' | 'chat' | 'hero-count' | 'modal' | 'modal-count';

/**
 * Component Object for the "Maximum/minimum Hero SKUs per channel" validation
 * suite (specs/skus/max-hero-skus-per-channel.md). Owns the suite-specific
 * locators (warning "Edit SKUs" affordance, scoped outcome signals) and the
 * granular multi-select/multi-promote drivers the generic PlanningPage journey
 * helpers do not expose. All shared journey locators are reused from
 * PlanningPage — this class adds no duplicate ownership of them.
 */
export class MaxHeroSkusPerChannelComponent {
  private readonly page: Page;
  private readonly planning: PlanningPage;

  constructor(page: Page) {
    this.page = page;
    this.planning = new PlanningPage(page);
  }

  /**
   * A single expected-outcome signal, scoped per the data case. Every data case
   * asserts uniformly on these locators (visible for documented outcomes,
   * hidden for documented non-outcomes), so the per-case oracle lives in the
   * data rows, not in per-case branching inside test bodies.
   */
  signal(scope: MaxHeroSignalScope, text: string | RegExp): Locator {
    if (scope === 'summary') {
      // locator-policy:exception the first summary-panel text match is the asserted per-channel signal
      return this.planning.summaryPanel().getByText(text).first();
    }
    if (scope === 'chat') {
      // locator-policy:exception the first chat-panel text match is the asserted assistant message
      return this.planning.assistantChatPanel().getByText(text).first();
    }
    if (scope === 'hero-count') {
      // The plan-hero-skus row concatenates children without whitespace, so the
      // row itself is filtered by the expected "<n> SKUs" fragment.
      return this.planning.summaryHeroCount().filter({ hasText: text });
    }
    if (scope === 'modal') {
      // locator-policy:exception the first dialog text match is the asserted modal signal
      return this.planning.editSkuModal().getByText(text).first();
    }
    if (scope === 'modal-count') {
      return this.planning.modalSelectedCount().filter({ hasText: text });
    }
    // locator-policy:exception the first page-wide text match is the asserted outcome copy
    return this.page.getByText(text).first();
  }

  /** Check the first `count` in-chat product result checkboxes. */
  async selectProducts(count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      // locator-policy:exception the case selects the first N returned product rows deterministically
      await this.planning.productCheckboxes().nth(index).check();
    }
  }

  /**
   * Promote `count` of the confirmed measurement SKUs to Hero SKUs. Each click
   * consumes that row's "Add hero SKU" control, so the first remaining control
   * is always the next candidate.
   */
  async promoteHeroes(count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      // locator-policy:exception each promotion consumes the first remaining "Add hero SKU" control
      await this.planning.addHeroSkuButton().first().click();
    }
  }

  /**
   * The "Edit SKUs" affordance inside the per-channel over/under-limit warning
   * ("Media limit: <max> Hero SKUs. Edit SKUs").
   */
  warningEditSkusLink(): Locator {
    // locator-policy:exception the warning's exact "Edit SKUs" affordance; first match is the warned channel's own link
    return this.page.getByText('Edit SKUs', { exact: true }).first();
  }

  /** Open the channel-scoped SKU edit dialog from the limit warning. */
  async openEditModalFromWarning(): Promise<void> {
    await this.warningEditSkusLink().click();
    await this.planning.editSkuModal().waitFor({ state: 'visible', timeout: MODAL_READY_TIMEOUT });
  }

  /** Open the summary "Hero SKUs" edit dialog (session-level Hero selection). */
  async openHeroEditModal(): Promise<void> {
    await this.planning.openHeroEditModal();
  }

  /** Deselect `count` SKU rows inside the open edit dialog. */
  async removeSelectedSkusInModal(count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      await this.planning.modalFirstRemoveSkuButton().click();
    }
  }

  /** Confirm the open edit dialog and wait for it to close. */
  async confirmEditModal(): Promise<void> {
    await this.planning.editModalConfirm().click();
    await this.planning.editSkuModal().waitFor({ state: 'hidden', timeout: MODAL_READY_TIMEOUT });
  }

  /**
   * Send a channel request whose documented outcome is a backend block (the
   * channel must NOT land in the summary): wait only for the assistant turn to
   * finish — the caller asserts the absence of the summary row and the
   * informing message afterwards.
   */
  async requestChannelExpectingBlock(request: string): Promise<void> {
    await this.planning.sendChatMessage(request);
    await this.planning.waitForAssistantIdle();
  }

  /**
   * Send ONE chat message naming several channels (the multi-channel resolver
   * cases), then land every channel that is documented to be added. Channels
   * documented as blocked are not waited for — their absence is asserted by
   * the test's final step.
   */
  async addCombinedChannels(request: string, resolvedNames: string[]): Promise<void> {
    await this.planning.sendChatMessage(request);
    for (const name of resolvedNames) {
      // locator-policy:exception the first disambiguation option naming the channel is its match
      const option = this.planning.channelMatchOptions().filter({ hasText: name }).first();
      await option.waitFor({ state: 'visible', timeout: ASSISTANT_REPLY_TIMEOUT }).catch(() => undefined);
      if (await option.isVisible().catch(() => false)) {
        await option.click();
      }
      // locator-policy:exception the named summary row is the deterministic landing signal
      await this.planning.summaryChannel(name).first().waitFor({ state: 'visible', timeout: CHANNEL_ADD_TIMEOUT });
    }
  }
}
