import type { Locator, Page } from '@playwright/test';

// Assistant turns on the slow dev environment run 30-60s+ (same budget rationale as
// PlanningPage.ASSISTANT_REPLY_TIMEOUT); channel resolution (disambiguate -> select ->
// extract -> summary recompute) is the slowest turn and gets the longer budget.
const ASSISTANT_REPLY_TIMEOUT = 60_000;
const CHANNEL_ADD_TIMEOUT = 120_000;

/**
 * Component Object for the FLOW-MP-024 AI-conversation-quality suite
 * (specs/sains/ai-conversation-quality.md).
 *
 * Owns the suite-specific chat interactions that PlanningPage does not expose:
 * multi-line prompt typing (Shift+Enter line breaks — a plain Enter would submit the
 * chat early), variant channel requests driven from string arrays, and the
 * "wait for disambiguation options WITHOUT selecting one" flow that AC-002 asserts on.
 * Locators mirror the live-verified PlanningPage contracts (chatbot-textarea,
 * chatbot-send-button, nectar-lottie-icon-idle, summary-panel, score-ranked channel
 * match option buttons) and live here per the one-component-file ownership rule.
 */
export class AiConversationQualityComponent {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // --- Chat surfaces (mirroring the live-verified PlanningPage contracts) ---
  private chatInput(): Locator {
    // The Fable textarea component carries the testid on its wrapper <div>; the real
    // editable element is the inner <textarea> (verified live on PlanningPage 2026-06-22).
    return this.page.getByTestId('chatbot-textarea').locator('textarea');
  }

  private sendButton(): Locator {
    return this.page.getByTestId('chatbot-send-button');
  }

  // The send button enables only once the textarea has text AND the assistant has
  // finished the previous turn — the reliable readiness gate before clicking.
  private sendButtonEnabled(): Locator {
    return this.sendButton().and(this.page.locator(':enabled'));
  }

  private async waitForAssistantIdle(): Promise<void> {
    await this.page
      .getByTestId('nectar-lottie-icon-idle')
      // locator-policy:exception either idle lottie icon signals the assistant has finished streaming
      .first()
      .waitFor({ state: 'visible', timeout: ASSISTANT_REPLY_TIMEOUT });
  }

  // --- Channel disambiguation + summary readbacks --------------------------
  // Score-ranked fuzzy-match option buttons "<name> (Score: 0.NN)" (live-verified
  // shape on PlanningPage 2026-06-22).
  channelMatchOptions(): Locator {
    return this.page.getByRole('button', { name: /\(Score:\s*0\.\d+\)/ });
  }

  firstChannelMatchOption(): Locator {
    // locator-policy:exception the first score-ranked option is the observable "options rendered" signal
    return this.channelMatchOptions().first();
  }

  private summaryPanel(): Locator {
    return this.page.getByTestId('summary-panel');
  }

  private summaryChannel(channelName: string): Locator {
    // exact:true targets the channel title row only — a substring match would also hit
    // the "Budget for <channel>" input label in the same panel.
    return this.summaryPanel().getByText(channelName, { exact: true });
  }

  /**
   * Type a (possibly multi-line) prompt with REAL keystrokes and send it. The Fable
   * textarea is React-controlled and ignores fill(), and a plain Enter would submit
   * mid-prompt, so line breaks between segments are inserted with Shift+Enter.
   */
  async sendPrompt(lines: readonly string[]): Promise<void> {
    await this.waitForAssistantIdle();
    const input = this.chatInput();
    await input.click();
    for (const [index, line] of lines.entries()) {
      if (index > 0) {
        await this.page.keyboard.press('Shift+Enter');
      }
      await input.pressSequentially(line, { timeout: ASSISTANT_REPLY_TIMEOUT });
    }
    await this.sendButtonEnabled().waitFor({ state: 'visible', timeout: ASSISTANT_REPLY_TIMEOUT });
    await this.sendButton().click();
  }

  /**
   * Send a variant channel prompt and resolve it to the named channel (multi-line-capable
   * mirror of PlanningPage.enterChannelRequest). The assistant either lists score-ranked
   * matches to disambiguate, or adds the channel directly when the description names it
   * exactly — race both paths, then gate on the channel's summary row.
   */
  async requestChannel(lines: readonly string[], resolvedChannelName: string): Promise<void> {
    await this.sendPrompt(lines);
    // locator-policy:exception the first disambiguation option matching the resolved name is the named match
    const firstOption = this.channelMatchOptions().filter({ hasText: resolvedChannelName }).first();
    // locator-policy:exception the first matching summary row is the deterministic landing signal
    const firstLanded = this.summaryChannel(resolvedChannelName).first();
    await Promise.race([
      firstOption.waitFor({ state: 'visible', timeout: ASSISTANT_REPLY_TIMEOUT }).catch(() => undefined),
      firstLanded.waitFor({ state: 'visible', timeout: ASSISTANT_REPLY_TIMEOUT }).catch(() => undefined)
    ]);
    if (await firstOption.isVisible().catch(() => false)) {
      await firstOption.click();
    }
    await firstLanded.waitFor({ state: 'visible', timeout: CHANNEL_ADD_TIMEOUT });
  }

  /**
   * Send an ambiguous channel description and wait for the grounded score-ranked
   * disambiguation options WITHOUT selecting one, so the test can assert that no
   * channel is committed until the user chooses.
   */
  async requestAmbiguousChannel(prompt: string): Promise<void> {
    await this.sendPrompt([prompt]);
    await this.firstChannelMatchOption().waitFor({ state: 'visible', timeout: CHANNEL_ADD_TIMEOUT });
  }

  /**
   * Send a free-text message (correction, reference, adversarial instruction) and wait
   * for the assistant to finish its reply, without expecting any channel to land.
   */
  async sendPromptAndAwaitReply(prompt: string): Promise<void> {
    await this.sendPrompt([prompt]);
    await this.waitForAssistantIdle();
  }
}
