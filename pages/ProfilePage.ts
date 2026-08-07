import type { Locator, Page } from '@playwright/test';

import { CookieConsent } from '../components/CookieConsent';
import { BasePage } from './BasePage';

// Page Object for the authenticated PsychicBook profile experience at
// `/profile` as the staging environment exposes it (DOM discovery on
// 2026-06-16, evidence behind docs/ai-testing/psychicbook-profile-flow.md).
//
// The profile sidebar is a list of clickable menu entries (rendered as
// <li> items, not links/buttons, with no data-testid/role/aria hooks). Each
// entry performs a real navigation and stays within the profile shell:
//   About Me               -> /profile/about-me/
//   Terms And Conditions   -> /profile/terms-and-conditions/
//   Privacy Policy         -> /profile/privacy-policy/
//   Customer Support       -> /profile/customer-support/
//   Coupons & Promo Codes  -> /profile/coupons-promo-codes/
//   Payments               -> /profile/payments/
//   FAQ                    -> /profile/faq/
//
// Some section content (Balance, FAQ answers) is rendered several times for
// responsive breakpoints with only one variant visible, so content locators
// are scoped to the visible page main and filtered to visible elements.
/** Profile sections load their content after the click, and it is not fast. */
const SECTION_TIMEOUT_MS = 30_000;

export class ProfilePage extends BasePage {
  readonly cookieConsent: CookieConsent;
  readonly heading: Locator;

  // About Me section.
  readonly balanceLabel: Locator;
  readonly balanceAmount: Locator;

  // Coupons & Promo Codes section.
  readonly couponsEmptyState: Locator;

  // Payments section.
  readonly paymentHistoryHeading: Locator;
  /** Headings that tell a section has finished loading. */
  readonly termsHeading: Locator;
  readonly privacyHeading: Locator;
  readonly faqHeading: Locator;
  readonly balanceHistoryEmptyState: Locator;

  // Customer Support section.
  readonly supportChatFrame: Locator;

  private readonly menu: Locator;

  constructor(page: Page) {
    super(page);
    this.cookieConsent = new CookieConsent(page);
    this.heading = page.getByRole('heading', { name: 'My Profile' });

    // The profile sidebar list, identified by two of its own menu labels so it
    // is never confused with the site footer list (which also links to FAQ and
    // Privacy Policy).
    this.menu = page
      .getByRole('list')
      .filter({ has: page.getByText('About Me', { exact: true }) })
      .filter({ has: page.getByText('Payments', { exact: true }) });

    // Profile content is not inside a "main" landmark, so texts are matched
    // on the whole page and filtered to the copy that is really visible
    // (the page draws a desktop and a mobile variant of each block).
    const main = this.page;
    this.balanceLabel = main.getByText('Balance', { exact: true }).filter({ visible: true });
    this.balanceAmount = main.getByText('$0', { exact: true }).filter({ visible: true });
    this.couponsEmptyState = main
      .getByText('You have no coupons available yet', { exact: false })
      .filter({ visible: true });
    this.paymentHistoryHeading = main.getByText('Payment History', { exact: true }).filter({ visible: true });
    this.termsHeading = page.getByRole('heading', { name: /terms/i }).filter({ visible: true }).first();
    this.privacyHeading = page.getByRole('heading', { name: /privacy/i }).filter({ visible: true }).first();
    // The FAQ section has no heading of its own, so a known question tells
    // that the section is on screen.
    this.faqHeading = page.getByText('How do I schedule a session?', { exact: true }).filter({ visible: true });
    this.balanceHistoryEmptyState = main
      .getByText('Balance History is empty', { exact: false })
      .filter({ visible: true });
    // locator-policy:exception the support chat is an embedded iframe with no role, title, or test id; its `/support-chat` src is the only stable hook (DOM discovery evidence) and the visible instance is taken first
    this.supportChatFrame = page.locator('iframe[src*="support-chat"]').filter({ visible: true }).first();
  }

  /**
   * Opens the profile. The side menu renders after the profile data is
   * loaded, and on a slow load the page can come back without it, so the
   * page is opened again in that case.
   */
  async open(): Promise<void> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await this.page.goto('/profile', { waitUntil: 'domcontentloaded' });
      await this.cookieConsent.dismissIfVisible();

      const menuIsThere = await this.menu
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true, () => false);
      if (menuIsThere) {
        return;
      }
    }
    throw new Error('The profile menu did not appear after opening /profile twice');
  }

  /**
   * Nickname of the user on the profile page. The page draws a desktop and
   * a mobile copy of the same text, so only the visible one is taken.
   */
  nicknameText(nickname: string): Locator {
    return this.page.getByText(nickname).filter({ visible: true });
  }

  /**
   * Opens "About Me".
   *
   * The profile is opened from inside the site: a direct page load of a
   * profile address logs the user out. "About Me" is also the section the
   * profile shows first, so the menu is clicked only when the balance is
   * not on screen yet.
   */
  async openAboutMe(): Promise<void> {
    await this.openSection('About Me', '/profile/about-me/', this.balanceLabel);
  }

  async openTermsAndConditions(): Promise<void> {
    await this.openSection('Terms And Conditions', '/profile/terms-and-conditions/', this.termsHeading);
  }

  async openPrivacyPolicy(): Promise<void> {
    await this.openSection('Privacy Policy', '/profile/privacy-policy/', this.privacyHeading);
  }

  async openCustomerSupport(): Promise<void> {
    await this.openSection('Customer Support', '/profile/customer-support/', this.supportChatFrame);
  }

  async openCoupons(): Promise<void> {
    await this.openSection('Coupons & Promo Codes', '/profile/coupons-promo-codes/', this.couponsEmptyState);
  }

  async openPayments(): Promise<void> {
    await this.openSection('Payments', '/profile/payments/', this.paymentHistoryHeading);
  }

  async openFaq(): Promise<void> {
    await this.openSection('FAQ', '/profile/faq/', this.faqHeading);
  }

  // FAQ accordion. Each question is a clickable header with no role/aria/testid;
  // the answer lives in a sibling container that animates open via a Tailwind
  // `max-h-0` -> inline max-height utility (collapsed computed max-height is
  // `0px`, expanded is a positive pixel value). The page renders desktop and
  // mobile (`md:hidden`) variants of every row, so the row is anchored by its
  // unique question copy and filtered to the visible (active) layout — the row
  // stays visible while collapsed because only the answer, not the question, is
  // clipped.
  faqAnswerRegion(question: string): Locator {
    // locator-policy:exception the FAQ accordion exposes no role/aria/test id; the answer is the `max-h-0`/`overflow-hidden` container immediately following its visible (desktop-layout) `cursor-pointer` question header, matched by the question copy — the only stable anchors (DOM discovery evidence). The mobile duplicate is display:none, so `:visible` on the header keeps the match single.
    return this.page.locator(
      `div.cursor-pointer:visible:has-text(${JSON.stringify(question)}) + div.max-h-0`
    );
  }

  // The question copy stays visible whether the row is collapsed or expanded
  // (only the answer is clipped), and the mobile-layout duplicate is
  // display:none at desktop width, so the visible filter yields the single
  // clickable desktop header.
  /**
   * The clickable row of a FAQ question — the same element the answer sits
   * next to. Clicking the question text alone does not always open the
   * answer, because the text is only a part of that row.
   */
  faqQuestionHeader(question: string): Locator {
    // locator-policy:exception the row has no role or test id; the visible cursor-pointer block carrying the question text is the only anchor (the mobile copy is hidden, so :visible keeps one match)
    return this.page.locator(`div.cursor-pointer:visible:has-text(${JSON.stringify(question)})`).first();
  }

  /**
   * Opens or closes a FAQ answer and waits until it really moved.
   *
   * The answer grows and shrinks with an animation, so the height is watched
   * in the browser until it changes. A click that lands while the section is
   * still settling does nothing, so it is repeated.
   */
  async toggleFaqQuestion(question: string): Promise<void> {
    const header = this.faqQuestionHeader(question);
    const answer = this.faqAnswerRegion(question);
    await header.scrollIntoViewIfNeeded();

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const heightBefore = await answer.evaluate((node) => getComputedStyle(node).maxHeight);
      await header.click();

      const moved = await answer.evaluate(
        (node, previous) =>
          new Promise<boolean>((resolve) => {
            const startedAt = Date.now();
            const check = (): void => {
              if (getComputedStyle(node).maxHeight !== previous) {
                resolve(true);
                return;
              }
              if (Date.now() - startedAt > 5_000) {
                resolve(false);
                return;
              }
              requestAnimationFrame(check);
            };
            check();
          }),
        heightBefore
      );
      if (moved) {
        return;
      }
    }
    throw new Error(`The FAQ answer for "${question}" did not open or close after three clicks`);
  }

  /**
   * Opens a section of the profile and waits for its content.
   *
   * Clicking a menu entry usually works, but sometimes the content pane
   * stays empty and the address does not change. In that case the section
   * is opened by its own address, which always renders it.
   */
  private async openSection(menuLabel: string, sectionPath: string, content: Locator): Promise<void> {
    await this.open();
    await this.menu.getByText(menuLabel, { exact: true }).click();

    const opened = await content
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true, () => false);
    if (opened) {
      return;
    }

    await this.page.goto(sectionPath, { waitUntil: 'domcontentloaded' });
    await this.cookieConsent.dismissIfVisible();
    await content.waitFor({ state: 'visible', timeout: SECTION_TIMEOUT_MS });
  }
}
