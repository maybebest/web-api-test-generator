import type { Locator, Page } from '@playwright/test';

import { PlanningPage } from './PlanningPage';

const SECONDARY_STAGE_TIMEOUT = 120_000;
const EDIT_MODAL_TIMEOUT = 60_000;

export type SecondarySpaceStage = 'mandatory' | 'optional';

/**
 * Secondary-Space-specific controls layered on top of the normal Nectar AI
 * planning journey. Keeping these selectors here prevents the generated spec
 * from depending on the component's presentational DOM structure.
 */
export class SecondarySpacePage extends PlanningPage {
  constructor(page: Page) {
    super(page);
  }

  async currentSessionId(): Promise<string> {
    await this.page.waitForURL(/\/planning\/nectar-ai\/[A-Za-z0-9_-]+(?:[?#].*)?$/, {
      timeout: SECONDARY_STAGE_TIMEOUT
    });
    const segments = new URL(this.page.url()).pathname.split('/').filter(Boolean);
    const sessionId = segments.at(-1);
    if (!sessionId || !/^[A-Za-z0-9_-]{8,128}$/.test(sessionId)) {
      throw new Error('secondary-space journey did not expose a valid planning session id');
    }
    return sessionId;
  }

  secondaryStageTitle(stage: SecondarySpaceStage): Locator {
    // locator-policy:exception completed stages remain in the transcript, so the last matching heading is active
    return this.page.getByText(stage === 'mandatory' ? 'Mandatory elements' : 'Optional elements', { exact: true }).last();
  }

  secondaryStageContainer(stage: SecondarySpaceStage): Locator {
    return this.secondaryStageTitle(stage).locator('..').locator('..');
  }

  secondaryStageSelects(stage: SecondarySpaceStage): Locator {
    return this.secondaryStageContainer(stage).locator('select');
  }

  secondaryStageAssignAllButtons(stage: SecondarySpaceStage): Locator {
    return this.secondaryStageContainer(stage).getByRole('button', { name: 'Assign all', exact: true });
  }

  secondaryStageSelectionCount(stage: SecondarySpaceStage): Locator {
    return this.secondaryStageContainer(stage).getByText(/^\d+ Selected$/);
  }

  activeSecondaryConfirmButton(): Locator {
    // locator-policy:exception completed stage controls remain in the transcript; the last matching control is active
    return this.page.getByTestId('confirm-selection-button').filter({ hasText: /^Confirm$/ }).last();
  }

  activeSecondarySkipButton(): Locator {
    // locator-policy:exception completed stage controls remain in the transcript; the last matching control is active
    return this.page.getByTestId('skip-button').filter({ hasText: /^Skip$/ }).last();
  }

  async waitForSecondaryStage(stage: SecondarySpaceStage): Promise<void> {
    await this.secondaryStageTitle(stage).waitFor({ state: 'visible', timeout: SECONDARY_STAGE_TIMEOUT });
  }

  async requestSecondarySpaceChannel(channelRequest: string, resolvedChannelName: string): Promise<void> {
    await this.sendChatMessage(channelRequest);
    // locator-policy:exception duplicate historic channel choices can remain in the transcript; the first visible match is actionable
    const namedOption = this.channelMatchOptions().filter({ hasText: resolvedChannelName }).first();
    const mandatoryStage = this.secondaryStageTitle('mandatory');
    // locator-policy:exception only the most recent assistant response describes the current brand/channel request
    const unavailableForBrand = this.assistantChatPanel().getByText(/not available for the chosen brand/i).last();

    await Promise.race([
      namedOption.waitFor({ state: 'visible', timeout: SECONDARY_STAGE_TIMEOUT }).catch(() => undefined),
      mandatoryStage.waitFor({ state: 'visible', timeout: SECONDARY_STAGE_TIMEOUT }).catch(() => undefined),
      unavailableForBrand.waitFor({ state: 'visible', timeout: SECONDARY_STAGE_TIMEOUT }).catch(() => undefined)
    ]);
    if (await unavailableForBrand.isVisible().catch(() => false)) {
      throw new Error('secondary-space preflight: the requested channel is not available for the selected brand');
    }
    if (await namedOption.isVisible().catch(() => false)) {
      await namedOption.click();
    }
    await mandatoryStage.waitFor({ state: 'visible', timeout: SECONDARY_STAGE_TIMEOUT });
  }

  async secondaryStageValues(stage: SecondarySpaceStage): Promise<string[]> {
    return this.secondaryStageSelects(stage).evaluateAll((selects) =>
      selects.map((select) => (select as HTMLSelectElement).value)
    );
  }

  async secondaryStageOptionValues(stage: SecondarySpaceStage, index = 0): Promise<string[]> {
    return this.secondaryStageSelects(stage).nth(index).locator('option').evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value)
    );
  }

  async secondaryStageSelectionText(stage: SecondarySpaceStage): Promise<string> {
    return (await this.secondaryStageSelectionCount(stage).innerText()).trim();
  }

  async selectSecondaryQuantity(stage: SecondarySpaceStage, index: number, quantity: number): Promise<void> {
    await this.secondaryStageSelects(stage).nth(index).selectOption(String(quantity));
  }

  async assignSecondaryQuantityToAll(stage: SecondarySpaceStage, sourceIndex = 0): Promise<void> {
    await this.secondaryStageAssignAllButtons(stage).nth(sourceIndex).click();
  }

  async confirmSecondaryStage(stage: SecondarySpaceStage): Promise<void> {
    await this.activeSecondaryConfirmButton().click();
    if (stage === 'mandatory') {
      await this.waitForSecondaryStage('optional');
      return;
    }
    await this.waitForAssistantIdle();
  }

  async secondaryStageControlsLocked(stage: SecondarySpaceStage): Promise<boolean> {
    const states = await this.secondaryStageSelects(stage).evaluateAll((selects) =>
      selects.map((select) => (select as HTMLSelectElement).disabled)
    );
    return states.length > 0 && states.every(Boolean);
  }

  async waitForSummaryChannel(channelName: string): Promise<void> {
    await this.summaryChannel(channelName).waitFor({ state: 'visible', timeout: SECONDARY_STAGE_TIMEOUT });
  }

  private summaryChannelRow(channelName: string): Locator {
    return this.summaryPanel()
      .locator('div')
      .filter({ hasText: channelName })
      .filter({ has: this.page.getByRole('button', { name: 'Edit Channel', exact: true }) })
      // locator-policy:exception nested summary wrappers match; the deepest final match owns the edit control
      .last();
  }

  async openChannelEdit(channelName: string): Promise<void> {
    await this.summaryChannelRow(channelName).getByRole('button', { name: 'Edit Channel', exact: true }).click();
    await this.channelEditModal().waitFor({ state: 'visible', timeout: EDIT_MODAL_TIMEOUT });
    await this.editSecondarySpaceSection().waitFor({ state: 'visible', timeout: EDIT_MODAL_TIMEOUT });
  }

  channelEditModal(): Locator {
    // locator-policy:exception inactive media-selection containers remain mounted; the last one is the open edit modal
    return this.page.getByTestId('media-selection').last();
  }

  editSecondarySpaceSection(): Locator {
    return this.channelEditModal().getByText('Select your element(s) for secondary space', { exact: true }).locator('..');
  }

  editMandatorySection(): Locator {
    return this.editSecondarySpaceSection().getByText('Mandatory elements', { exact: true }).locator('..');
  }

  editOptionalSection(): Locator {
    return this.editSecondarySpaceSection().getByText('Optional elements', { exact: true }).locator('..');
  }

  editMandatorySelects(): Locator {
    return this.editMandatorySection().locator('select');
  }

  editOptionalSelects(): Locator {
    return this.editOptionalSection().locator('select');
  }

  editOptionalCheckboxes(): Locator {
    return this.editOptionalSection().getByRole('checkbox');
  }

  editAssignAllButtons(): Locator {
    return this.editSecondarySpaceSection().getByRole('button', { name: 'Assign all', exact: true });
  }

  async editMandatoryValues(): Promise<string[]> {
    return this.editMandatorySelects().evaluateAll((selects) =>
      selects.map((select) => (select as HTMLSelectElement).value)
    );
  }

  async editOptionalValues(): Promise<string[]> {
    return this.editOptionalSelects().evaluateAll((selects) =>
      selects.map((select) => (select as HTMLSelectElement).value)
    );
  }

  async editOptionalCheckedStates(): Promise<boolean[]> {
    return this.editOptionalCheckboxes().evaluateAll((checkboxes) =>
      checkboxes.map((checkbox) => (checkbox as HTMLInputElement).checked)
    );
  }

  async editAssignAllCount(): Promise<number> {
    return this.editAssignAllButtons().count();
  }

  async selectEditOptionalQuantity(index: number, quantity: number): Promise<void> {
    await this.editOptionalSelects().nth(index).selectOption(String(quantity));
  }

  async saveChannelEdit(): Promise<void> {
    await this.channelEditModal().getByTestId('btn-modal-confirm-visible-next').click();
    await this.channelEditModal().waitFor({ state: 'hidden', timeout: SECONDARY_STAGE_TIMEOUT });
    await this.waitForAssistantIdle();
  }
}
