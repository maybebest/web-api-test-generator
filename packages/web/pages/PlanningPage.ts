import type { Download, Locator } from '@playwright/test';

import { BasePage } from './BasePage';

// The Nectar AI / Pollen dev environment is slow, so allow up to 30s for each
// readiness wait (page render, panel appearance, streamed assistant reply) instead
// of relying on the shorter default. Note: assistant turns can run 30-60s+, so if
// waitForAssistantIdle still flakes, raise ASSISTANT_REPLY_TIMEOUT further (to ~75s).
const READY_TIMEOUT = 30_000;
// Assistant turns on this slow dev environment can run well past 30s; allow up to 60s
// for a streamed reply / the chat to re-enable before the next message.
const ASSISTANT_REPLY_TIMEOUT = 60_000;
// Adding a channel (disambiguate -> select -> extract -> summary recompute) is the
// slowest, most variable assistant operation; give it extra headroom so a slow turn
// does not flake the channel-add wait.
const CHANNEL_ADD_TIMEOUT = 120_000;
// Restoring a saved session (/planning/nectar-ai/<sessionId>) replays the whole
// conversation progressively; observed live at 60-90s+ before the summary renders.
const SESSION_HYDRATION_TIMEOUT = 150_000;

/**
 * Page Object for the Nectar AI guided media-planning flow on the Pollen app
 * (Planning page -> "Nectar AI Assistant" -> guided objective & budget flow).
 *
 * Locators were HEALED from a live read-only DOM reconnaissance of
 * https://www.dev.pollen.js-devops.co.uk/planning (webapp-testing skill,
 * 2026-06-22). Locators tagged CONFIRMED were observed in the live DOM; locators
 * tagged INFERRED sit deeper in the journey than the read-only recon went (it
 * stopped before products/channel/save so as not to write a plan to the DB) and
 * must be confirmed by extending the recon before the end-to-end test is green.
 * Re-audited read-only on 2026-07-02 against the live landing page, a fresh
 * assistant view and a restored saved-plan session (including opening/closing both
 * Edit SKU modals): every CONFIRMED/VERIFIED locator that renders in those states
 * was re-observed; the channel-stage and save-stage locators (heroLimitWarning,
 * channel delete/match/added, saveButton, savedConfirmation, in-chat
 * productCheckboxes) need a plan with channels / a live run past the read-only
 * boundary and remain unverified.
 * The app exposes stable data-testids throughout, so getByTestId is preferred
 * (matches the e2e-testing-patterns "use data attributes" guidance).
 */
export class PlanningPage extends BasePage {
  async goto(): Promise<void> {
    // Guarantee the Nectar AI feature flags are present in localStorage on every
    // navigation (every spec requires them), independent of the captured session.
    await this.page.addInitScript(() => {
      const g = globalThis as unknown as { localStorage: { setItem(key: string, value: string): void } };
      g.localStorage.setItem(
        'feature-flags',
        JSON.stringify({ FEATURE_NECTAR_AI: true, FEATURE_NUP: true, FEATURE_NECTAR_AI_MP: true })
      );
    });
    await this.page.goto('/planning');
    await this.page.waitForLoadState('domcontentloaded');
    await this.startAssistantButton().waitFor({ state: 'visible', timeout: READY_TIMEOUT });
  }

  /**
   * Open an EXISTING planningAI session directly (observed URL scheme
   * /planning/nectar-ai/<sessionId>, re-audited live 2026-07-02). The saved conversation
   * hydrates progressively and can take 60-90s+, so readiness gates on the summary panel
   * rendering, not on load state. Use after seeding the session via dataManager
   * (planningAI SET_SKUS) so the asserted summary reflects the seeded state.
   */
  async gotoSession(sessionId: string): Promise<void> {
    await this.page.addInitScript(() => {
      const g = globalThis as unknown as { localStorage: { setItem(key: string, value: string): void } };
      g.localStorage.setItem(
        'feature-flags',
        JSON.stringify({ FEATURE_NECTAR_AI: true, FEATURE_NUP: true, FEATURE_NECTAR_AI_MP: true })
      );
    });
    await this.page.goto(`/planning/nectar-ai/${sessionId}`);
    await this.page.waitForLoadState('domcontentloaded');
    await this.summaryPanel().waitFor({ state: 'visible', timeout: SESSION_HYDRATION_TIMEOUT });
  }

  // --- Entry: planning page -> Nectar AI assistant ----------- CONFIRMED ---
  startAssistantButton(): Locator {
    // "Try now" under the Nectar AI Assistant card; opens /planning/nectar-ai.
    return this.page.getByTestId('my360-targeting-try-now-button');
  }

  buildByObjectiveButton(): Locator {
    return this.page.getByRole('button', { name: 'Help me build a plan based on my objective & budget' });
  }

  async startNectarAiPlanner(): Promise<void> {
    await this.startAssistantButton().click();
    await this.buildByObjectiveButton().waitFor({ state: 'visible', timeout: READY_TIMEOUT });
  }

  async chooseBuildByObjectiveAndBudget(): Promise<void> {
    await this.buildByObjectiveButton().click();
    // The advertiser/brand panel renders inside the assistant's streamed reply to
    // the objective-and-budget prompt (30-60s+), so budget the assistant-turn timeout.
    await this.advertiserBrandPanel().waitFor({ state: 'visible', timeout: ASSISTANT_REPLY_TIMEOUT });
  }

  // --- Conversational assistant chat -------------------------- CONFIRMED ---
  chatInput(): Locator {
    // The Fable textarea component carries the testid on its wrapper <div>; the
    // real editable element is the inner <textarea>, so target it for fill()
    // (verified live 2026-06-22 — filling the wrapper div throws "not an input").
    return this.page.getByTestId('chatbot-textarea').locator('textarea');
  }

  sendButton(): Locator {
    return this.page.getByTestId('chatbot-send-button');
  }

  // The send button is the reliable readiness gate: it enables only once the textarea
  // has text AND the assistant has finished the previous turn. (The Add/Microphone
  // controls stay permanently disabled in this chat, so they are not a usable "ready"
  // signal.) So type first, then wait for send to enable before clicking.
  private sendButtonEnabled(): Locator {
    return this.sendButton().and(this.page.locator(':enabled'));
  }

  async sendChatMessage(text: string): Promise<void> {
    // Wait for the assistant to finish the previous turn so the text is not lost to a
    // re-render, then type with REAL keystrokes. The Fable textarea is React-controlled
    // and ignores fill()'s synthetic value-set (the Submit button stays disabled), so
    // pressSequentially is required to fire onChange and enable Submit.
    await this.waitForAssistantIdle();
    const input = this.chatInput();
    await input.click();
    await input.pressSequentially(text, { timeout: ASSISTANT_REPLY_TIMEOUT });
    await this.sendButtonEnabled().waitFor({ state: 'visible', timeout: ASSISTANT_REPLY_TIMEOUT });
    await this.sendButton().click();
  }

  // --- Advertiser + brand selection (search -> checkbox -> confirm) -- VERIFIED ---
  // The panel renders asynchronously after the assistant answers "Help me build a
  // plan"; chooseBuildByObjectiveAndBudget() waits for it. The panel, its single
  // search textbox, the search button and the confirm button each resolve to
  // exactly one element (live-verified 2026-06-22).
  advertiserBrandPanel(): Locator {
    return this.page.getByTestId('advertisers-and-brands');
  }

  searchButton(): Locator {
    return this.page.getByTestId('ai-search-button'); // button "Search"
  }

  confirmSelectionButton(): Locator {
    return this.page.getByTestId('confirm-selection-button'); // "Confirm and continue"
  }

  // Type the advertiser, run the search, then click the advertiser result chip to
  // reveal its brand checkboxes (verified live 2026-06-22).
  async selectAdvertiser(advertiser: string): Promise<void> {
    await this.advertiserBrandPanel().getByRole('textbox').fill(advertiser);
    await this.searchButton().click();
    await this.advertiserBrandPanel().getByText(advertiser, { exact: true }).click();
  }

  // Brand checkboxes (e.g. "Unilever | Knorr | MS", "Knorr") render after the
  // advertiser result is clicked. exact:true avoids the substring collision between
  // "Knorr" and "Unilever | Knorr | MS" (verified live 2026-06-22).
  async selectBrand(brand: string): Promise<void> {
    await this.advertiserBrandPanel().getByRole('checkbox', { name: brand, exact: true }).check();
  }

  async confirmAdvertiserAndBrand(): Promise<void> {
    await this.confirmSelectionButton().click();
  }

  // --- Objective (chat) --------------------------------------- CONFIRMED ---
  async enterObjective(objective: string): Promise<void> {
    await this.sendChatMessage(objective);
  }

  // --- Product selection: measurement SKUs then hero SKUs ------- VERIFIED ---
  // After the objective the assistant asks to (1) search & confirm MEASUREMENT SKUs,
  // then (2) promote at least one to a HERO SKU. Products render in-chat as checkboxes
  // named "<product name> - <SKU>"; each step is committed by the panel's own
  // "Confirm" button (NOT confirm-selection-button, which belongs to the
  // advertiser/brand step). Verified live 2026-06-22.
  productCheckboxes(): Locator {
    // Real product rows end in " - <SKU>"; this excludes the per-group "Select All".
    return this.page.getByRole('checkbox', { name: /-\s*\d{5,}\s*$/ });
  }

  // The measurement and hero panels each commit via an exact "Confirm" button. exact
  // matters: once committed the button relabels to "Confirmed", which must not match.
  panelConfirmButton(): Locator {
    return this.page.getByRole('button', { name: 'Confirm', exact: true });
  }

  addHeroSkuButton(): Locator {
    return this.page.getByRole('button', { name: 'Add hero SKU' });
  }

  // Search measurement products by name or SKU; result checkboxes render in-chat.
  // The rows arrive inside a streamed assistant turn (30-60s+), so budget the
  // assistant-reply timeout, not the page-readiness one.
  async searchProducts(term: string): Promise<void> {
    await this.sendChatMessage(term);
    // locator-policy:exception waits for the first returned product row to render
    await this.productCheckboxes().first().waitFor({ state: 'visible', timeout: ASSISTANT_REPLY_TIMEOUT });
  }

  async selectFirstProduct(): Promise<void> {
    // locator-policy:exception deterministic case selects the first returned product checkbox
    await this.productCheckboxes().first().check();
  }

  // Commit the measurement SKUs, then promote the first to a hero SKU and commit
  // again — the assistant requires at least one hero SKU before prompting for
  // channels.
  async confirmProducts(): Promise<void> {
    await this.panelConfirmButton().click();
    await this.addHeroSkuButton().waitFor({ state: 'visible', timeout: ASSISTANT_REPLY_TIMEOUT });
    await this.addHeroSkuButton().click();
    await this.panelConfirmButton().click();
    await this.waitForAssistantIdle();
  }

  // --- SKU management: granular steps, gating + edit modal ------- VERIFIED ---
  // The combined confirmProducts() above is split here into the observable sub-steps
  // the granular SKU-management cases assert on. Verified live 2026-06-23.

  // Commit the selected MEASUREMENT SKUs only and wait for the hero-selection step
  // ("Add hero SKU") to render.
  async confirmMeasurementSkus(): Promise<void> {
    await this.panelConfirmButton().click();
    await this.addHeroSkuButton().waitFor({ state: 'visible', timeout: ASSISTANT_REPLY_TIMEOUT });
  }

  // Promote the first listed measurement SKU to a hero SKU.
  async promoteFirstHeroSku(): Promise<void> {
    // locator-policy:exception promotes the first hero candidate row's "Add hero SKU"
    await this.addHeroSkuButton().first().click();
  }

  // Commit the HERO SKUs and wait for the assistant to move on to the channel prompt.
  async confirmHeroSkus(): Promise<void> {
    await this.panelConfirmButton().click();
    await this.waitForAssistantIdle();
  }

  // Note: the panel "Confirm" only renders once >=1 SKU is selected (the selection bar
  // "Measurement SKUs | N selected | View | Confirm" appears on selection), so absence
  // at 0 and presence+enabled at >=1 is the gating signal — assert on panelConfirmButton().

  // --- Summary SKU counts + per-section edit controls ------------ VERIFIED ---
  // The summary count fields; the per-section edit buttons APPEAR (count 0 -> 1) as
  // each stage is confirmed (Measurement edit after measurement confirm; Hero edit
  // after hero confirm).
  summaryMeasurementCount(): Locator {
    return this.page.getByTestId('plan-measurement-skus');
  }

  summaryHeroCount(): Locator {
    return this.page.getByTestId('plan-hero-skus');
  }

  // The per-channel "Media limit: <max> Hero SKUs. Edit SKUs" over-limit warning. The numeral is
  // interpolated from the channel's configured maxHeroSkus (it must NOT be hardcoded). Matched by
  // its stable prefix; heal to a data-testid if one becomes available.
  heroLimitWarning(): Locator {
    return this.page.getByText(/Media limit:\s*\d+\s*Hero SKUs/i);
  }

  summaryEditMeasurementButton(): Locator {
    return this.page.getByRole('button', { name: 'open modal Measurement SKUs' });
  }

  summaryEditHeroButton(): Locator {
    return this.page.getByRole('button', { name: 'open modal Hero SKUs' });
  }

  // --- Edit SKU modal (role=dialog "Edit Measurement/Hero SKUs") -- VERIFIED ---
  editSkuModal(): Locator {
    return this.page.getByRole('dialog');
  }

  async openMeasurementEditModal(): Promise<void> {
    await this.summaryEditMeasurementButton().click();
    await this.editSkuModal().waitFor({ state: 'visible', timeout: READY_TIMEOUT });
  }

  async openHeroEditModal(): Promise<void> {
    await this.summaryEditHeroButton().click();
    await this.editSkuModal().waitFor({ state: 'visible', timeout: READY_TIMEOUT });
  }

  modalSelectedCount(): Locator {
    return this.page.getByTestId('selected-skus-length');
  }

  // HEALED 2026-07-02 (live audit, restored-session state): the chat history's
  // committed SKU panel keeps its own visible selectedSku-<sku> rows in the DOM, so
  // a page-wide getByTestId resolves to TWO elements once the edit modal is open
  // (5 chat rows + 5 dialog rows observed) — a strict-mode violation. Scope to the
  // open dialog, like editModalConfirm/Cancel below.
  modalSkuRow(sku: string): Locator {
    return this.editSkuModal().getByTestId(`selectedSku-${sku}`);
  }

  modalRemoveSku(sku: string): Locator {
    return this.editSkuModal().getByTestId(`remove-selectedSku-${sku}`);
  }

  // The open edit modal's own Confirm/Cancel/dismiss (scoped to the visible dialog so
  // the several hidden modalWrapper-* instances in the DOM don't collide).
  editModalConfirm(): Locator {
    return this.editSkuModal().getByRole('button', { name: 'Confirm', exact: true });
  }

  editModalCancel(): Locator {
    return this.editSkuModal().getByRole('button', { name: 'Cancel', exact: true });
  }

  // --- Summary panel ------------------------------------------ CONFIRMED ---
  summaryPanel(): Locator {
    return this.page.getByTestId('summary-panel');
  }

  summaryAdvertiser(): Locator {
    return this.page.getByTestId('plan-advertiser');
  }

  summaryBrands(): Locator {
    return this.page.getByTestId('plan-brands');
  }

  summaryObjective(): Locator {
    return this.page.getByTestId('plan-objective');
  }

  summaryDates(): Locator {
    return this.page.getByTestId('plan-dates');
  }

  heroSkusCount(): Locator {
    return this.page.getByTestId('plan-hero-skus');
  }

  campaignSkusCount(): Locator {
    return this.page.getByTestId('plan-measurement-skus');
  }

  // --- Entry-point + chat surfaces used by assertions --------- CONFIRMED ---
  nectarAssistantHeading(): Locator {
    return this.page.getByRole('heading', { name: 'Nectar AI Assistant' });
  }

  assistantChatPanel(): Locator {
    // The assistant conversation; booking-deadline rejection messages render here.
    return this.page.getByTestId('chat-panel');
  }

  // The Nectar AI assistant streams replies. Wait for it to return to idle before
  // asserting on its output — a deterministic alternative to a fixed timeout. The
  // live DOM renders two `nectar-lottie-icon-idle` icons once the reply completes;
  // either being visible means the assistant has finished, so wait on the first.
  async waitForAssistantIdle(): Promise<void> {
    // locator-policy:exception either idle lottie icon signals the assistant has finished streaming
    await this.page.getByTestId('nectar-lottie-icon-idle').first().waitFor({ state: 'visible', timeout: ASSISTANT_REPLY_TIMEOUT });
  }

  // Channel as it appears in the running summary channel list — the placement (e.g.
  // "Onsite") and the resolved channel name (e.g. "Homepage Sponsored Product") render
  // as text rows in the summary Media section. Pass the resolved channel name, not the
  // free-text request. Verified live 2026-06-22.
  summaryChannel(channelName: string): Locator {
    // exact:true targets the channel title row only — a substring match also hits the
    // "Budget for <channel>" input label in the same panel.
    return this.summaryPanel().getByText(channelName, { exact: true });
  }

  // --- Summary recompute reads (channel deletion) --------------- VERIFIED ---
  // The summary "Media > Total Budget" value has NO dedicated testid (the summary
  // panel exposes plan-advertiser/brands/objective/dates/hero-skus/measurement-skus
  // only). It renders as a "£..." amount in the Media section ("£--" when empty,
  // "£10,000" once a channel is added) and is the FIRST "£" amount in the panel,
  // ahead of the per-channel budget. Verified live 2026-06-22.
  summaryTotalBudget(): Locator {
    // locator-policy:exception the first "£" amount in the summary panel is the Media total budget
    return this.summaryPanel().getByText(/^£/).first();
  }

  async summaryTotalBudgetText(): Promise<string> {
    return (await this.summaryTotalBudget().innerText()).trim();
  }

  // The campaign timeline (start - end) lives in the confirmed `plan-dates` testid.
  async summaryTimelineText(): Promise<string> {
    return (await this.summaryDates().innerText()).trim();
  }

  // Delete a named channel through the assistant chat. NOTE: the verified delete path
  // is the summary UI control (deleteChannel below); this chat-based variant is
  // retained for the suites that still reference it and is not yet live-verified.
  async deleteChannelViaChat(channelName: string): Promise<void> {
    await this.sendChatMessage(`Please delete the ${channelName} channel from the plan.`);
    await this.waitForAssistantIdle();
  }

  // --- Channel delete + recompute (summary UI) ----------------- VERIFIED ---
  // Each channel row in the summary Media section exposes a delete control
  // (aria-label "...delete channel") that opens a confirm modal; confirming removes
  // the channel and the summary Total Budget recomputes (e.g. £15,000 -> £--).
  // Verified live 2026-06-23.
  channelDeleteButton(): Locator {
    return this.summaryPanel().getByRole('button', { name: /delete channel/i });
  }

  // The delete-confirmation modal's affirmative button is labelled "Delete" (other
  // modals' confirm buttons read "Confirm"), so role+name is unique even though several
  // modalWrapper-confirm-button testids are present in the DOM at once.
  modalDeleteConfirmButton(): Locator {
    return this.page.getByRole('button', { name: 'Delete', exact: true });
  }

  // The summary block that holds a given channel's name AND its own delete control —
  // the innermost matching block, so its delete button is that channel's.
  private channelRow(channelName: string): Locator {
    const blocks = this.summaryPanel()
      .locator('div')
      .filter({ hasText: channelName })
      .filter({ has: this.page.getByRole('button', { name: /delete channel/i }) });
    // locator-policy:exception the innermost (last) matching block is the channel's own row
    return blocks.last();
  }

  // Delete a channel by name (scoped to its row) — or the first channel if no name is
  // given — then confirm. The summary Total Budget recomputes to the remaining channels.
  async deleteChannel(channelName?: string): Promise<void> {
    const control = channelName
      ? this.channelRow(channelName).getByRole('button', { name: /delete channel/i })
      : this.channelDeleteButton();
    // locator-policy:exception the targeted channel row's delete control (or the first)
    await control.first().click();
    await this.modalDeleteConfirmButton().click();
  }

  // --- Channel request (chat -> disambiguation -> add) --------- VERIFIED ---
  // The assistant fuzzy-matches a channel description to real channels and lists them
  // as score-ranked buttons "<name> (Score: 0.NN)", best first. There is NO
  // booking-deadline validation in the dev environment — a vague description (e.g.
  // "Onsite Display") and a specific one alike are simply disambiguated and added.
  // Verified live 2026-06-22.
  channelMatchOptions(): Locator {
    return this.page.getByRole('button', { name: /\(Score:\s*0\.\d+\)/ });
  }

  // The assistant confirms "...added those channels to your plan." once a channel is
  // committed; this is the deterministic "channel added" signal (the summary Media
  // section then populates with the budget, dates and channel row a few seconds later).
  channelAddedConfirmation(): Locator {
    return this.assistantChatPanel().getByText(/added .*to your plan/i);
  }

  // Send a channel request, then select a match to add it to the plan. The fuzzy match
  // is NON-deterministic — the candidate set and their scores vary run to run for the
  // same description, and some channels carry their own budget/validation follow-ups —
  // so pass `resolvedChannelName` to deterministically pick a specific channel rather
  // than relying on the top score. Verified live 2026-06-22/23.
  async enterChannelRequest(channelRequest: string, resolvedChannelName?: string): Promise<void> {
    await this.sendChatMessage(channelRequest);
    const option = resolvedChannelName
      ? this.channelMatchOptions().filter({ hasText: resolvedChannelName })
      : this.channelMatchOptions();
    const landed = resolvedChannelName ? this.summaryChannel(resolvedChannelName) : this.channelAddedConfirmation();
    // locator-policy:exception the first disambiguation option is the named/best-scored match
    const firstOption = option.first();
    // locator-policy:exception the first matching summary row / chat confirmation is the landing signal
    const firstLanded = landed.first();
    // Two paths: the assistant either lists score-ranked matches to disambiguate, or —
    // when the description names a channel exactly — adds it directly with no options.
    // Race them so a direct-add isn't blocked waiting for options that never come.
    await Promise.race([
      firstOption.waitFor({ state: 'visible', timeout: ASSISTANT_REPLY_TIMEOUT }).catch(() => undefined),
      firstLanded.waitFor({ state: 'visible', timeout: ASSISTANT_REPLY_TIMEOUT }).catch(() => undefined)
    ]);
    if (await firstOption.isVisible().catch(() => false)) {
      await firstOption.click();
    }
    // Confirm the channel landed. With a resolved name, wait for its summary row (the
    // deterministic per-channel signal that works for sequential adds); otherwise fall
    // back to the chat confirmation. Use the longer channel-add budget — extraction and
    // summary recompute after selection can take well over a minute on a slow turn.
    await firstLanded.waitFor({ state: 'visible', timeout: CHANNEL_ADD_TIMEOUT });
  }

  // --- Confirm + save ------------------------------------------ INFERRED ---
  // Save UI sits past the read-only recon boundary. "Proceed to Booking" was the
  // only late-stage CTA observed; the save/confirm controls below are inferred
  // from the manual test case and must be confirmed before treating as green.
  async confirmPlan(): Promise<void> {
    // HEALED 2026-07-03 (content review vs live audit): confirm-selection-button
    // belongs to the advertiser/brand step and RELABELS to "Confirmed" once
    // committed, so clicking it at the plan-confirm stage hits a stale committed
    // control (or strict-mode-collides). The chat-stage commit control is the
    // ACTIVE exact-match "Confirm" button — committed panels relabel, so
    // exact:true targets only the live one.
    await this.panelConfirmButton().click();
  }

  saveButton(): Locator {
    // VERIFIED 2026-07-03 (live save run): the save CTA the assistant renders after the
    // plan-confirm turn is labelled exactly "Save plan as draft". "Proceed to Booking" is a
    // DIFFERENT action (it books, it does not save) and must never be matched here.
    return this.page.getByRole('button', { name: /save plan as draft/i });
  }

  async savePlan(): Promise<void> {
    await this.saveButton().click();
    // "Your plan is now saved." arrives as a streamed assistant reply (30-60s+),
    // so budget the assistant-turn timeout, not the page-readiness one.
    await this.savedConfirmation().waitFor({ state: 'visible', timeout: ASSISTANT_REPLY_TIMEOUT });
  }

  savedConfirmation(): Locator {
    // VERIFIED 2026-07-03 (live save run): the assistant's post-save reply reads
    // "Your plan has been saved as a draft. What would you like to do next?" — the previously
    // inferred "Your plan is now saved." copy does not exist in the live flow.
    return this.page.getByText('Your plan has been saved as a draft.');
  }

  // VERIFIED 2026-07-03: rendered alongside the saved-as-draft confirmation; opens the
  // saved-plan review view (where the post-save outputs live).
  reviewSavedPlanButton(): Locator {
    return this.page.getByRole('button', { name: /review my plan/i });
  }

  async reviewSavedPlan(): Promise<void> {
    await this.reviewSavedPlanButton().click();
  }

  // HEALED 2026-07-02 (live audit, restored saved-plan session): there is NO
  // `plan-name` testid in the live DOM. The saved plan title renders at the top of
  // the summary as "Plan name: <name>" — a label span, the name text and the
  // name-suffix input (testid `plan-name-input`, with `plan-name-tooltip` /
  // `confirm-plan-name` / `remove-plan-name` controls) inside a single container.
  // Anchor on the visible label and take its container so the located element's
  // text includes the plan name (supports toContainText on the name tokens).
  planName(): Locator {
    // locator-policy:exception no testid wraps the full "Plan name: <name>" row;
    // the label span's parent container is the observed stable structure.
    return this.page.getByText(/^Plan name:/).locator('..');
  }

  // --- Post-save outputs -------------------------------------- CONFIRMED ---
  downloadButton(): Locator {
    return this.page.getByRole('button', { name: /download/i });
  }

  editInPollenLink(): Locator {
    return this.page.getByRole('button', { name: /edit plan in pollen/i });
  }

  async downloadCsv(): Promise<Download> {
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.downloadButton().click()
    ]);
    return download;
  }
}
