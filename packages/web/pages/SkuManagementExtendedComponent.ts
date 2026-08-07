import type { Locator, Page } from '@playwright/test';

/**
 * Component Object for the extended SKU-management surfaces exercised by
 * specs/sains/sku-management-extended.md (FLOW-MP-023): the Edit SKU editors'
 * search/candidate rows and hero-indicator badge, the chat panel's committed
 * SKU rows and removal controls, and the combined-summary Edit SKU list action.
 *
 * Locator provenance:
 * - CONFIRMED locators reuse contracts live-audited for PlanningPage
 *   (2026-06-22 .. 2026-07-03): `chat-panel` testid, `selectedSku-<sku>` /
 *   `remove-selectedSku-<sku>` testids (present in BOTH the chat history's
 *   committed SKU panels and the open editor dialog — hence the explicit
 *   chat-panel / dialog scoping below), the role=dialog editor named
 *   Measurement/Hero, and the in-chat product checkbox naming convention
 *   "<product name> - <SKU>".
 * - INFERRED locators sit on surfaces past the read-only recon boundary
 *   (the dev environment currently crashes the SKU-search chat turn, so they
 *   could not be live-audited yet): the editor search box, the editor
 *   candidate-row naming, the hero-indicator badge copy (NUP-21966 "Hero SKU"),
 *   and the combined-summary "Edit SKU list" action (NUP-19216). Heal them on
 *   the first live run before treating the suite as live-green.
 */
export class SkuManagementExtendedComponent {
  constructor(private readonly page: Page) {}

  // --- Conversation (chat panel) surfaces ------------------- CONFIRMED ---
  chatPanel(): Locator {
    return this.page.getByTestId('chat-panel');
  }

  /**
   * In-chat product row mapped from a measurement search. Real product rows are
   * checkboxes named "<product name> - <SKU>" (verified live 2026-06-22).
   */
  measurementOptionBySku(skuId: string): Locator {
    return this.page.getByRole('checkbox', { name: new RegExp(`-\\s*${skuId}\\s*$`) });
  }

  /** Same row located by (a fragment of) its catalogue product name. */
  measurementOptionByName(name: string): Locator {
    return this.page.getByRole('checkbox', { name });
  }

  /**
   * The most recent chat turn's committed SKU row for a given SKU id. The chat
   * history keeps each turn's committed panel in the DOM, so earlier turns can
   * hold rows for the same SKU.
   */
  latestChatSkuRow(skuId: string): Locator {
    // locator-policy:exception the newest chat turn's committed row is the last selectedSku-<sku> match
    return this.chatPanel().getByTestId(`selectedSku-${skuId}`).last();
  }

  /**
   * The most recent chat turn's removal control for a given SKU id — at the
   * hero-selection step this is the in-conversation hero unassign control.
   * INFERRED from the observed remove-selectedSku-<sku> testid convention;
   * heal on the first live run.
   */
  latestChatRemoveSkuButton(skuId: string): Locator {
    // locator-policy:exception the newest chat turn's removal control is the last remove-selectedSku-<sku> match
    return this.chatPanel().getByTestId(`remove-selectedSku-${skuId}`).last();
  }

  /**
   * The hero-selection step's per-row promote control for a given SKU. The
   * page-wide "Add hero SKU" control is live-verified (PlanningPage); scoping it
   * to the SKU's committed row is INFERRED — heal on the first live run.
   */
  heroPromoteControlFor(skuId: string): Locator {
    // locator-policy:exception the newest committed row for the sku carries the promote control at the hero step
    return this.chatPanel().getByTestId(`selectedSku-${skuId}`).last().getByRole('button', { name: 'Add hero SKU' });
  }

  /** Any open dialog — used to assert that NO confirmation dialog appeared. */
  anyDialog(): Locator {
    return this.page.getByRole('dialog');
  }

  // --- Edit SKU editor (role=dialog) surfaces ---------------------------
  /** The open Measurement/Hero editor dialog (mirrors PlanningPage.editSkuModal). */
  editSkuDialog(): Locator {
    return this.page.getByRole('dialog', { name: /Measurement|Hero/i });
  }

  /** Dialog identity locators for the editor-identity assertions (NUP-19216). */
  heroEditDialog(): Locator {
    return this.page.getByRole('dialog', { name: /hero/i });
  }

  measurementEditDialog(): Locator {
    return this.page.getByRole('dialog', { name: /measurement/i });
  }

  /**
   * The editor's SKU search box. INFERRED: the editor exposes one text input
   * for filtering the brand catalogue; heal to a data-testid when audited.
   */
  dialogSearchInput(): Locator {
    return this.editSkuDialog().getByRole('textbox');
  }

  /** Filter the editor's candidate list by a catalogue product name. */
  async searchCandidates(term: string): Promise<void> {
    const input = this.dialogSearchInput();
    await input.click();
    await input.fill(term);
  }

  /**
   * A candidate row in the editor's brand-catalogue list, located by its SKU id
   * suffix. INFERRED: candidate rows are checkboxes named
   * "<product name> - <SKU>", mirroring the verified in-chat convention.
   */
  candidateOption(skuId: string): Locator {
    return this.editSkuDialog().getByRole('checkbox', { name: new RegExp(`-\\s*${skuId}\\s*$`) });
  }

  /**
   * The hero indicator badge on a selected row inside the open editor
   * (NUP-21966: measurement rows currently assigned as hero carry a clear
   * "Hero SKU" indicator). INFERRED badge copy; heal on the first live run.
   */
  heroIndicator(skuId: string): Locator {
    return this.editSkuDialog().getByTestId(`selectedSku-${skuId}`).getByText(/hero sku/i);
  }

  // --- Combined summary (single-prompt) surfaces -------------------------
  /**
   * The pencil/Edit SKU list action rendered beneath the combined summary
   * (NUP-19216/NUP-21978). INFERRED accessible name; heal on the first live run.
   */
  editSkuListButton(): Locator {
    return this.page.getByRole('button', { name: /edit sku list/i });
  }

  // --- Session identity ---------------------------------------------------
  /**
   * The live planningAI session id from the observed URL scheme
   * /planning/nectar-ai/<sessionId> (re-audited live 2026-07-02). Used to read
   * the session state through fixtures/nectar-api.ts.
   */
  sessionIdFromUrl(): string {
    const match = /\/planning\/nectar-ai\/([A-Za-z0-9_-]+)/.exec(this.page.url());
    if (!match) {
      throw new Error(`Expected a /planning/nectar-ai/<sessionId> URL, got: ${this.page.url()}`);
    }
    return match[1];
  }
}
