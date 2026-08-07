import type { Locator, Page } from '@playwright/test';

import { offsetDate } from '../data/media-planner';
import { getEveryMedia, getMedia, getPlanningSession, getSkusBySkuId } from '../fixtures/nectar-api';
import { PlanningPage } from './PlanningPage';

const ASSISTANT_RESPONSE_TIMEOUT_MS = 180_000;
const RESTRICTED_SKU_ID = 8_161_985;
const ELIGIBLE_SKU_ID = 8_184_969;

const fixture = {
  advertiser: 'The QA Advertiser™',
  brand: 'Hellmanns',
  objective: 'Customer retention',
  productSearch: 'Hellmann',
  channel: 'OK_Offsite_HFSS',
  restrictedCategories: ['BABY', 'BWS', 'PET_DOG']
} as const;

type CampaignSku = { skuId?: unknown; isHero?: unknown };
type KnownHeroSku = { skuId?: unknown };
type EligibilityChannel = {
  mediaId?: unknown;
  mediaName?: unknown;
  channelMediaName?: unknown;
  hasHFSSRestrictions?: unknown;
  restrictedCategories?: unknown;
  minHeroSKUs?: unknown;
  maxHeroSKUs?: unknown;
  heroSKUs?: { known?: KnownHeroSku[] | null } | null;
};
type EligibilityState = {
  campaignSkus?: CampaignSku[] | null;
  channels?: EligibilityChannel[] | null;
};
type EligibilitySession = {
  state?: EligibilityState | null;
  history?: unknown;
};

export type HfssFixtureEvidence = {
  mediaId: string;
  hasHfssRestrictions: boolean;
  restrictedCategories: string[];
  minHeroSkus: number | null;
  maxHeroSkus: number | null;
  restrictedSkuIsHfss: boolean;
  eligibleSkuIsHfss: boolean;
};

export type HfssEligibilityResult = {
  sessionId: string;
  feedbackText: string;
  summaryChannelCount: number;
  globalSkuIds: number[];
  globalHeroSkuIds: number[];
  channelNamesInOrder: string[];
  channelMediaIds: string[];
  channelHeroSkuIds: number[];
  channelHasHfssRestrictions: boolean;
  channelRestrictedCategories: string[];
  channelMinHeroSkus: number | null;
  channelMaxHeroSkus: number | null;
  historyJson: string;
};

export type HfssCleanupResult = {
  remainingChannelNames: string[];
  retainedConversationShells: number;
};

const sortedStrings = (values: unknown): string[] =>
  Array.isArray(values)
    ? values.filter((value): value is string => typeof value === 'string').sort((left, right) => left.localeCompare(right))
    : [];

const nullableInteger = (value: unknown, label: string): number | null => {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value)) throw new Error(`TC-VAL-003: ${label} is not an integer or null.`);
  return value as number;
};

/**
 * Executes the live-proven offsite core of canonical TC-VAL-003.
 *
 * A planning session cannot currently be deleted through the observed schema. The
 * component therefore requires explicit persistent-data consent, removes the owned
 * channel in teardown, and reports the retained conversation shell honestly.
 */
export class HfssEligibilityComponent {
  readonly restrictedSkuId = RESTRICTED_SKU_ID;
  readonly eligibleSkuId = ELIGIBLE_SKU_ID;
  readonly expectedChannel = fixture.channel;
  readonly expectedRestrictedCategories = [...fixture.restrictedCategories].sort((left, right) => left.localeCompare(right));

  private readonly planning: PlanningPage;

  constructor(private readonly page: Page) {
    this.planning = new PlanningPage(page);
  }

  requirePersistentConversationConsent(): void {
    if (process.env.E2E_ALLOW_PERSISTENT_TEST_DATA !== 'true') {
      throw new Error(
        'TC-VAL-003 requires E2E_ALLOW_PERSISTENT_TEST_DATA=true: the live schema has no conversation-delete operation. The test removes its owned channel, but one conversation shell remains.'
      );
    }
  }

  async preflightLiveFixtures(): Promise<HfssFixtureEvidence> {
    const mediaMatches = (await getEveryMedia()).filter((entry) => entry.name === fixture.channel);
    if (mediaMatches.length !== 1) {
      throw new Error(
        `TC-VAL-003 fixture preflight expected exactly one media named ${JSON.stringify(fixture.channel)}, found ${mediaMatches.length}.`
      );
    }

    const media = await getMedia(mediaMatches[0].id);
    const offsite = media.offSite as
      | {
          audienceAndTargeting?: { hasHFSSRestrictions?: unknown; restrictedCategories?: unknown } | null;
          setup?: { minHeroSKUs?: unknown; maxHeroSKUs?: unknown } | null;
        }
      | null
      | undefined;
    if (!offsite) throw new Error('TC-VAL-003 fixture preflight found no offSite configuration on the restricted media.');

    const hasHfssRestrictions = offsite.audienceAndTargeting?.hasHFSSRestrictions;
    if (hasHfssRestrictions !== true) {
      throw new Error('TC-VAL-003 fixture preflight requires hasHFSSRestrictions=true.');
    }
    const restrictedCategories = sortedStrings(offsite.audienceAndTargeting?.restrictedCategories);
    if (JSON.stringify(restrictedCategories) !== JSON.stringify(this.expectedRestrictedCategories)) {
      throw new Error(
        `TC-VAL-003 fixture preflight expected categories ${JSON.stringify(this.expectedRestrictedCategories)}, received ${JSON.stringify(restrictedCategories)}.`
      );
    }

    const skus = await getSkusBySkuId([RESTRICTED_SKU_ID, ELIGIBLE_SKU_ID]);
    const restricted = skus.find((sku) => sku.skuId === RESTRICTED_SKU_ID);
    const eligible = skus.find((sku) => sku.skuId === ELIGIBLE_SKU_ID);
    if (!restricted || !eligible) {
      throw new Error('TC-VAL-003 fixture preflight could not resolve both approved Hellmanns SKU ids.');
    }
    if (restricted.isHFSS !== true || eligible.isHFSS !== false) {
      throw new Error(
        `TC-VAL-003 fixture drift: expected ${RESTRICTED_SKU_ID}=HFSS and ${ELIGIBLE_SKU_ID}=non-HFSS, received ${String(restricted.isHFSS)}/${String(eligible.isHFSS)}.`
      );
    }

    return {
      mediaId: mediaMatches[0].id,
      hasHfssRestrictions,
      restrictedCategories,
      minHeroSkus: nullableInteger(offsite.setup?.minHeroSKUs, 'configured minHeroSKUs'),
      maxHeroSkus: nullableInteger(offsite.setup?.maxHeroSKUs, 'configured maxHeroSKUs'),
      restrictedSkuIsHfss: true,
      eligibleSkuIsHfss: false
    };
  }

  private productCheckbox(skuId: number): Locator {
    return this.page.getByRole('checkbox', { name: new RegExp(`-\\s*${skuId}\\s*$`) });
  }

  private heroToggle(skuId: number): Locator {
    return this.page.getByTestId(`selectedSku-${skuId}`).getByTestId('toggle-hero-button');
  }

  private eligibilityFeedback(): Locator {
    return this.planning
      .assistantChatPanel()
      .getByText(/The following SKUs were removed for the channel\s+OK_Offsite_HFSS\s+as they are not HFSS compliant/i);
  }

  private channelDefinitionPrompt(): Locator {
    return this.planning.assistantChatPanel().getByText(/To start building your plan/i);
  }

  private captureSessionId(): string {
    const sessionId = /\/planning\/nectar-ai\/([^/?#]+)/.exec(this.page.url())?.[1];
    if (!sessionId) throw new Error('TC-VAL-003 expected a session id in the current Nectar AI URL.');
    return sessionId;
  }

  async buildMixedHeroSelection(): Promise<string> {
    await this.planning.goto();
    await this.planning.startNectarAiPlanner();
    await this.planning.chooseBuildByObjectiveAndBudget();
    await this.planning.selectAdvertiser(fixture.advertiser);
    await this.planning.selectBrand(fixture.brand);
    await this.planning.confirmAdvertiserAndBrand();
    await this.planning.enterObjective(fixture.objective);
    await this.planning.searchProducts(fixture.productSearch);
    await this.productCheckbox(RESTRICTED_SKU_ID).check();
    await this.productCheckbox(ELIGIBLE_SKU_ID).check();

    // PlanningPage.confirmMeasurementSkus waits on a strict single locator and
    // therefore cannot represent this intentional two-SKU case. Commit directly,
    // then gate on one SKU-scoped hero toggle.
    await this.planning.panelConfirmButton().click();
    await this.heroToggle(RESTRICTED_SKU_ID).waitFor({ state: 'visible', timeout: 60_000 });
    await this.heroToggle(RESTRICTED_SKU_ID).click();
    await this.heroToggle(ELIGIBLE_SKU_ID).click();
    await this.planning.panelConfirmButton().click();
    await this.channelDefinitionPrompt().waitFor({ state: 'visible', timeout: ASSISTANT_RESPONSE_TIMEOUT_MS });
    return this.captureSessionId();
  }

  async addRestrictedChannelAndReadOutcome(sessionId: string): Promise<HfssEligibilityResult> {
    const channelPrompt = `${fixture.channel}, ${offsetDate(30)} till ${offsetDate(60)}, the budget is £10,000, Managed service`;
    await this.planning.sendChatMessage(channelPrompt);

    const option = this.planning.channelMatchOptions().filter({ hasText: fixture.channel });
    // locator-policy:exception the one exact named channel candidate is the deterministic selection
    const firstOption = option.first();
    const directFeedback = this.eligibilityFeedback();
    // locator-policy:exception either the exact candidate or the direct-add feedback is the valid landing signal
    await firstOption.or(directFeedback).first().waitFor({
      state: 'visible',
      timeout: ASSISTANT_RESPONSE_TIMEOUT_MS
    });
    if (await firstOption.isVisible().catch(() => false)) await firstOption.click();

    await directFeedback.waitFor({ state: 'visible', timeout: 120_000 });
    await this.planning.summaryChannel(fixture.channel).waitFor({ state: 'visible', timeout: 120_000 });

    const session = (await getPlanningSession(sessionId)) as EligibilitySession | null;
    const state = session?.state;
    const channels = state?.channels ?? [];
    const selected = channels.find((channel) => channel.mediaName === fixture.channel);
    if (!selected) throw new Error('TC-VAL-003 API readback did not contain the UI-added restricted channel.');

    const campaignSkus = state?.campaignSkus ?? [];
    const knownHeroes = selected.heroSKUs?.known ?? [];
    return {
      sessionId,
      feedbackText: ((await directFeedback.innerText()) ?? '').replace(/\s+/g, ' ').trim(),
      summaryChannelCount: await this.planning.summaryChannel(fixture.channel).count(),
      globalSkuIds: campaignSkus
        .map((sku) => sku.skuId)
        .filter((skuId): skuId is number => Number.isSafeInteger(skuId))
        .sort((left, right) => left - right),
      globalHeroSkuIds: campaignSkus
        .filter((sku) => sku.isHero === true)
        .map((sku) => sku.skuId)
        .filter((skuId): skuId is number => Number.isSafeInteger(skuId))
        .sort((left, right) => left - right),
      channelNamesInOrder: channels
        .map((channel) => channel.mediaName)
        .filter((name): name is string => typeof name === 'string'),
      channelMediaIds: channels
        .map((channel) => channel.mediaId)
        .filter((id): id is string => typeof id === 'string'),
      channelHeroSkuIds: knownHeroes
        .map((sku) => sku.skuId)
        .filter((skuId): skuId is number => Number.isSafeInteger(skuId))
        .sort((left, right) => left - right),
      channelHasHfssRestrictions: selected.hasHFSSRestrictions === true,
      channelRestrictedCategories: sortedStrings(selected.restrictedCategories),
      channelMinHeroSkus: nullableInteger(selected.minHeroSKUs, 'readback minHeroSKUs'),
      channelMaxHeroSkus: nullableInteger(selected.maxHeroSKUs, 'readback maxHeroSKUs'),
      historyJson: JSON.stringify(session?.history ?? [])
    };
  }

  async cleanupOwnedChannel(sessionId: string): Promise<HfssCleanupResult> {
    await this.planning.deleteChannelIfPresent(fixture.channel);
    const deadline = Date.now() + 120_000;
    let session = (await getPlanningSession(sessionId)) as EligibilitySession | null;
    while ((session?.state?.channels ?? []).some((channel) => channel.mediaName === fixture.channel)) {
      if (Date.now() >= deadline) {
        throw new Error(`TC-VAL-003 cleanup timed out while removing ${fixture.channel} from API readback.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      session = (await getPlanningSession(sessionId)) as EligibilitySession | null;
    }
    return {
      remainingChannelNames: (session?.state?.channels ?? [])
        .map((channel) => channel.mediaName)
        .filter((name): name is string => typeof name === 'string'),
      retainedConversationShells: 1
    };
  }
}
