import type { Page } from '@playwright/test';

import { apiTest, expect, type ApiFixtures } from './api-test';

import { BookingDialog } from '../components/BookingDialog';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { ArticleDetailPage } from '../pages/ArticleDetailPage';
import { ArticlesPage } from '../pages/ArticlesPage';
import { ChatPage } from '../pages/ChatPage';
import { ContentPage } from '../pages/ContentPage';
import { DailyHoroscopePage } from '../pages/DailyHoroscopePage';
import { ExpertProfilePage } from '../pages/ExpertProfilePage';
import { ExpertsCatalogPage } from '../pages/ExpertsCatalogPage';
import { HomePage } from '../pages/HomePage';
import { LegalPage } from '../pages/LegalPage';
import { MatchAdvisorPage } from '../pages/MatchAdvisorPage';
import { ProfilePage } from '../pages/ProfilePage';
import { PsychicsPage } from '../pages/PsychicsPage';
import { SessionsPage } from '../pages/SessionsPage';
import { SignupPage } from '../pages/SignupPage';
import { BookingFlow } from '../flows/BookingFlow';
import { ConversationFlow } from '../flows/ConversationFlow';
import { LoginFlow } from '../flows/LoginFlow';
import { MultiBookingFlow } from '../flows/MultiBookingFlow';
import type { ApiUser } from '../api/facades/UserFacade';

/** Every page and component, ready to use — no `new SomePage(page)` in tests. */
export type Pages = {
  signup: SignupPage;
  /** Landing page with the "find your match" question. */
  home: HomePage;
  /** Page the user lands on after login. */
  psychics: PsychicsPage;
  catalog: ExpertsCatalogPage;
  expertProfile: ExpertProfilePage;
  articles: ArticlesPage;
  article: ArticleDetailPage;
  horoscope: DailyHoroscopePage;
  sessions: SessionsPage;
  chat: ChatPage;
  profile: ProfilePage;
  /** Terms and privacy pages inside the profile. */
  legal: LegalPage;
  matchAdvisor: MatchAdvisorPage;
  /** Any page opened by a link: it only knows headings and body text. */
  content: ContentPage;
  header: Header;
  footer: Footer;
  bookingDialog: BookingDialog;
};

/** A user who is already logged in on the site. */
export type SignedInUser = {
  account: ApiUser;
  nickname: string;
};

export type UiFixtures = {
  pages: Pages;
  login: LoginFlow;
  booking: BookingFlow;
  /**
   * Fresh user with a filled profile and a saved card, already logged in.
   * Most UI tests start from here.
   */
  signedInUser: SignedInUser;
  /**
   * Books with experts from the catalog and moves on to the next expert
   * when this one has no suitable free time. Use it whenever the scenario
   * does not name a particular expert.
   */
  expertBooking: MultiBookingFlow;
  /** User in the browser talking to the agent over the API, in one chat. */
  conversation: ConversationFlow;
  /**
   * The same as `signedInUser`, but registered by e-mail.
   *
   * Some pages (the profile sections) show an empty block for a user who
   * signed up by phone, because such a user has no e-mail address.
   */
  signedInEmailUser: SignedInUser;
};

/**
 * Base test for UI tests. It has everything the API test has (users, agent,
 * API client) plus pages, flows and a logged-in user.
 */
export const uiTest = apiTest.extend<UiFixtures>({
  pages: async ({ page }, use) => {
    await use(createPages(page));
  },

  login: async ({ page }, use) => {
    await use(new LoginFlow(page));
  },

  booking: async ({ page }, use) => {
    await use(new BookingFlow(page));
  },

  signedInUser: async ({ users, login, pages, page }, use) => {
    const nickname = `AQA ${randomNickname()}`;
    const account = await users.createReadyToBook(nickname);

    await login.byPhone(account.nationalPhone!);
    // Waiting for the address, not for every last resource of the page:
    // under load the site keeps loading trackers long after it is usable,
    // and the header check below is what proves the session is real.
    await page.waitForURL((url) => url.pathname.startsWith('/psychics'), { waitUntil: 'domcontentloaded' });

    // One check for every UI test: the session is real. The URL alone does
    // not prove it, the header does.
    await expect(pages.header.mySessionsLink, 'user should be logged in').toBeVisible();
    await expect(pages.header.nicknameLabel(nickname)).toBeVisible();
    await expect(pages.header.getStartedCta, 'the sign-up call to action should be gone').toBeHidden();

    await use({ account, nickname });
  },

  expertBooking: async ({ pages, booking, keepAgentsOnline }, use) => {
    await use(new MultiBookingFlow(pages.catalog, booking, keepAgentsOnline));
  },

  conversation: async ({ agentFacade, agent, pages, onlineAgents }, use) => {
    await use(new ConversationFlow(agentFacade, agent, pages.chat, onlineAgents));
  },

  signedInEmailUser: async ({ users, userFacade, login, pages, page }, use) => {
    const nickname = `AQA ${randomNickname()}`;
    const account = await users.createByEmail('mail');
    await userFacade.completeProfile(account, nickname);

    await login.byEmail(account.email!);
    // Waiting for the address, not for every last resource of the page:
    // under load the site keeps loading trackers long after it is usable,
    // and the header check below is what proves the session is real.
    await page.waitForURL((url) => url.pathname.startsWith('/psychics'), { waitUntil: 'domcontentloaded' });
    await expect(pages.header.nicknameLabel(nickname), 'user should be logged in').toBeVisible();

    await use({ account, nickname });
  }
});

export function createPages(page: Page): Pages {
  return {
    signup: new SignupPage(page),
    home: new HomePage(page),
    psychics: new PsychicsPage(page),
    catalog: new ExpertsCatalogPage(page),
    expertProfile: new ExpertProfilePage(page),
    articles: new ArticlesPage(page),
    article: new ArticleDetailPage(page),
    horoscope: new DailyHoroscopePage(page),
    sessions: new SessionsPage(page),
    chat: new ChatPage(page),
    profile: new ProfilePage(page),
    legal: new LegalPage(page),
    matchAdvisor: new MatchAdvisorPage(page),
    content: new ContentPage(page),
    header: new Header(page),
    footer: new Footer(page),
    bookingDialog: new BookingDialog(page)
  };
}

function randomNickname(): string {
  return Math.random().toString(16).slice(2, 7);
}

export { expect };
export type { ApiFixtures };
