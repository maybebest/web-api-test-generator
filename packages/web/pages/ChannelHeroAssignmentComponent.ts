import type { Locator, Page } from '@playwright/test';

import { PlanningPage } from './PlanningPage';

// Budgets mirror PlanningPage: streamed assistant turns run 30-60s+ on the dev
// environment and a channel add (disambiguate -> select -> extract -> recompute)
// is the slowest, most variable operation.
const MODAL_READY_TIMEOUT = 30_000;
const ASSISTANT_REPLY_TIMEOUT = 60_000;
const CHANNEL_ADD_TIMEOUT = 120_000;

/**
 * Component Object for the per-channel Hero SKU assignment suite
 * (specs/sains/channel-hero-assignment.md, FLOW-MP-026): the per-channel
 * Edit SKUs affordance and channel-scoped Hero dialog, the dialog's candidate
 * search/rows, the batch multi-channel resolver driver, and the media-summary
 * Hero SKUs column with its per-channel count cells. Shared journey locators
 * are reused from PlanningPage by instantiation — this class adds no duplicate
 * ownership of them.
 *
 * Locator provenance:
 * - CONFIRMED locators reuse contracts live-audited for PlanningPage
 *   (2026-06-22 .. 2026-07-03): `chat-panel` testid, the in-chat product
 *   checkbox naming convention "<product name> - <SKU>", `selectedSku-<sku>` /
 *   `remove-selectedSku-<sku>` testids, the role=dialog editor named
 *   Measurement/Hero, the summary-panel channel rows, and the score-ranked
 *   channel disambiguation buttons.
 * - INFERRED locators sit past the read-only recon boundary (the dev
 *   environment currently crashes the SKU-search chat turn, so they could not
 *   be live-audited yet): the per-channel "Edit SKUs" affordance on a channel
 *   row WITHOUT a limit warning (the copy is anchored to the observed
 *   "Media limit: ... Edit SKUs" affordance, NUP-18943), the dialog candidate
 *   search box and candidate-row naming (mirroring the verified in-chat
 *   convention), and the media-summary table semantics for NUP-20813 (a
 *   role=table with a Hero SKUs columnheader and per-row count cells). Heal
 *   them on the first live run before treating the suite as live-green.
 */
export class ChannelHeroAssignmentComponent {
  private readonly page: Page;
  private readonly planning: PlanningPage;

  constructor(page: Page) {
    this.page = page;
    this.planning = new PlanningPage(page);
  }

  // --- Conversation (chat panel) surfaces ------------------- CONFIRMED ---
  private chatPanel(): Locator {
    return this.page.getByTestId('chat-panel');
  }

  /**
   * In-chat product row mapped from a measurement search. Real product rows
   * are checkboxes named "<product name> - <SKU>" (verified live 2026-06-22).
   */
  measurementOptionBySku(skuId: string): Locator {
    return this.page.getByRole('checkbox', { name: new RegExp(`-\\s*${skuId}\\s*$`) });
  }

  /**
   * The hero-selection step's per-row promote control for a given SKU. The
   * page-wide "Add hero SKU" control is live-verified (PlanningPage); scoping
   * it to the SKU's committed row is INFERRED — heal on the first live run.
   */
  heroPromoteControlFor(skuId: string): Locator {
    // locator-policy:exception the newest committed row for the sku carries the promote control at the hero step
    return this.chatPanel().getByTestId(`selectedSku-${skuId}`).last().getByRole('button', { name: 'Add hero SKU' });
  }

  // --- Per-channel Hero modal (channel row -> Edit SKUs) ------------------
  /**
   * The summary block that holds a given channel's name AND its own Edit SKUs
   * affordance — the innermost matching block, so the affordance is that
   * channel's. INFERRED: the affordance copy is anchored to the observed
   * "Edit SKUs" fragment of the per-channel limit warning (NUP-18943 channel
   * edit entry point); heal on the first live run.
   */
  private channelRow(channelName: string): Locator {
    const blocks = this.planning
      .summaryPanel()
      // locator-policy:exception the summary panel exposes no per-channel testid; the innermost block holding both the name and the affordance is the channel's own row
      .locator('div')
      .filter({ hasText: channelName })
      .filter({ has: this.page.getByText('Edit SKUs', { exact: true }) });
    // locator-policy:exception the innermost (last) matching block is the channel's own row
    return blocks.last();
  }

  /** The named channel row's own Edit SKUs affordance. */
  channelEditSkusControl(channelName: string): Locator {
    // locator-policy:exception the targeted channel row's own Edit SKUs affordance is its first match
    return this.channelRow(channelName).getByText('Edit SKUs', { exact: true }).first();
  }

  /**
   * The open channel-scoped Hero dialog. The channel dialog reuses the
   * verified editor contract (role=dialog named Measurement/Hero with
   * selectedSku-<sku> rows), so it resolves through PlanningPage.
   */
  channelHeroModal(): Locator {
    return this.planning.editSkuModal();
  }

  /** Open the named channel's Hero dialog from its summary row. */
  async openChannelHeroModal(channelName: string): Promise<void> {
    await this.channelEditSkusControl(channelName).click();
    await this.channelHeroModal().waitFor({ state: 'visible', timeout: MODAL_READY_TIMEOUT });
  }

  /** All selected SKU rows inside the open dialog (dialog-scoped, verified). */
  modalSelectedRows(): Locator {
    return this.planning.modalSelectedSkuRows();
  }

  /**
   * The open dialog's SKU search box. INFERRED: the editor exposes one text
   * input for filtering the brand catalogue; heal to a data-testid when
   * audited (mirrors the sibling extended-SKU component's contract).
   */
  private modalSearchInput(): Locator {
    return this.channelHeroModal().getByRole('textbox');
  }

  /** Filter the open dialog's candidate list by a catalogue product name. */
  async searchModalCandidates(term: string): Promise<void> {
    const input = this.modalSearchInput();
    await input.click();
    await input.fill(term);
  }

  /**
   * A candidate row in the open dialog's brand-catalogue list, located by its
   * SKU id suffix. INFERRED: candidate rows are checkboxes named
   * "<product name> - <SKU>", mirroring the verified in-chat convention.
   */
  modalCandidateOption(skuId: string): Locator {
    return this.channelHeroModal().getByRole('checkbox', { name: new RegExp(`-\\s*${skuId}\\s*$`) });
  }

  /** Confirm the open dialog and wait for it to close. */
  async confirmOpenModal(): Promise<void> {
    await this.planning.editModalConfirm().click();
    await this.channelHeroModal().waitFor({ state: 'hidden', timeout: MODAL_READY_TIMEOUT });
  }

  /** Dismiss the open dialog without committing and wait for it to close. */
  async cancelOpenModal(): Promise<void> {
    await this.planning.editModalCancel().click();
    await this.channelHeroModal().waitFor({ state: 'hidden', timeout: MODAL_READY_TIMEOUT });
  }

  /** Assign one catalogue SKU as Hero to the named channel via its dialog. */
  async addHeroToChannel(channelName: string, skuId: string, searchTerm: string): Promise<void> {
    await this.openChannelHeroModal(channelName);
    await this.searchModalCandidates(searchTerm);
    await this.modalCandidateOption(skuId).check();
    await this.confirmOpenModal();
  }

  /** Remove one assigned Hero from the named channel via its dialog. */
  async removeHeroFromChannel(channelName: string, skuId: string): Promise<void> {
    await this.openChannelHeroModal(channelName);
    await this.planning.modalRemoveSku(skuId).click();
    await this.confirmOpenModal();
  }

  /** Remove every listed Hero from the named channel in one dialog session. */
  async clearChannelHeroes(channelName: string, skuIds: readonly string[]): Promise<void> {
    await this.openChannelHeroModal(channelName);
    for (const skuId of skuIds) {
      await this.planning.modalRemoveSku(skuId).click();
    }
    await this.confirmOpenModal();
  }

  // --- Batch multi-channel request (one message, sequential resolvers) ----
  /**
   * Send ONE chat message naming several channels, then land every channel by
   * completing its resolver sequentially (mirrors the proven combined-channel
   * driver of the max-hero suite). Channels that resolve directly render no
   * disambiguation option, so the option click is conditional here — inside
   * the component, never in a test body.
   */
  async addChannelsInOneRequest(request: string, resolvedNames: readonly string[]): Promise<void> {
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

  // --- Media summary Hero SKUs column (NUP-20813) --------------- INFERRED ---
  /**
   * The media summary table that carries the per-channel Hero SKUs column.
   * INFERRED table semantics; heal to a data-testid when audited.
   */
  mediaSummaryTable(): Locator {
    return this.page
      .getByRole('table')
      .filter({ has: this.page.getByRole('columnheader', { name: /hero skus/i }) });
  }

  /** The Hero SKUs column header that replaced the legacy Details column. */
  heroSkusColumnHeader(): Locator {
    return this.mediaSummaryTable().getByRole('columnheader', { name: /hero skus/i });
  }

  /** The legacy Details column header — asserted absent per NUP-20813. */
  detailsColumnHeader(): Locator {
    return this.mediaSummaryTable().getByRole('columnheader', { name: /details/i });
  }

  /** The named channel's row in the media summary table. */
  channelSummaryRow(channelName: string): Locator {
    return this.mediaSummaryTable().getByRole('row').filter({ hasText: channelName });
  }

  /**
   * The named channel row's cell holding exactly the given value — used for
   * the per-channel Hero count ('3', '1') and the zero-Hero dash ('-').
   * Exact-name matching keeps a '1' from satisfying a '12' cell and a '-'
   * from matching a date range.
   */
  channelHeroCountCell(channelName: string, value: string): Locator {
    return this.channelSummaryRow(channelName).getByRole('cell', { name: value, exact: true });
  }
}
