import { expect, uiTest as test } from '../../../fixtures/ui-test';

/**
 * Header menus, the Articles link and the footer links of the site.
 *
 * Every check starts from the articles page. It is the one page that draws
 * the header menus and the footer again after each navigation, so the links
 * are always there when the next item is clicked.
 *
 * The items of one menu are checked inside one test on purpose: each test
 * gets its own new user and its own login, and 48 logins would make the run
 * far too long. Every item still has its own step and its own asserts.
 */

// The "Psychics" menu: the item name and the page it must open.
const PSYCHICS_MENU = [
  { item: 'All Psychics', url: /\/psychics\/?$/ },
  { item: 'Love & Relationships', url: /\/love-and-relationships\/?$/ },
  { item: 'Tarot Readings', url: /\/tarot-readings\/?$/ },
  { item: 'Psychic Readings', url: /\/psychic-readings\/?$/ },
  { item: 'Life Questions', url: /\/life-questions\/?$/ },
  { item: 'Astrology Readings', url: /\/astrology-readings\/?$/ },
  { item: 'Sexology Advice', url: /\/sexology-advice\/?$/ },
  { item: 'Lgbtq Support', url: /\/lgbtq-support\/?$/ },
  { item: 'Other Questions', url: /\/other-questions\/?$/ },
  { item: 'Dream Interpretation', url: /\/dream-interpreter\/?$/ }
] as const;

// The "Horoscope" menu: four time periods first, then the twelve signs.
const HOROSCOPE_MENU = [
  { item: 'Daily', url: /\/daily-horoscope\/?$/ },
  { item: 'Tomorrow', url: /\/tomorrow-horoscope\/?$/ },
  { item: 'Weekly', url: /\/weekly-horoscope\/?$/ },
  { item: 'Monthly', url: /\/monthly-horoscope\/?$/ },
  { item: 'Aries', url: /\/daily-aries\/?$/ },
  { item: 'Taurus', url: /\/daily-taurus\/?$/ },
  { item: 'Gemini', url: /\/daily-gemini\/?$/ },
  { item: 'Cancer', url: /\/daily-cancer\/?$/ },
  { item: 'Leo', url: /\/daily-leo\/?$/ },
  { item: 'Virgo', url: /\/daily-virgo\/?$/ },
  { item: 'Libra', url: /\/daily-libra\/?$/ },
  { item: 'Scorpio', url: /\/daily-scorpio\/?$/ },
  { item: 'Sagittarius', url: /\/daily-sagittarius\/?$/ },
  { item: 'Capricorn', url: /\/daily-capricorn\/?$/ },
  { item: 'Aquarius', url: /\/daily-aquarius\/?$/ },
  { item: 'Pisces', url: /\/daily-pisces\/?$/ }
] as const;

/**
 * Footer links: the link name, the page it must open and a heading that
 * proves real content instead of an error page. Link text and heading are
 * often different words.
 *
 * "Getting Started" points to the sign-up page, and a user who is already
 * logged in is sent to the psychics page. Two pairs of links share one page
 * by design: How To Find An Advisor / What To Ask, and Become a Psychic /
 * Contact Us. Each link is still clicked, so a broken one is found.
 */
const FOOTER_LINKS = [
  { link: 'Psychic Readings', url: /\/psychic-readings\/?$/, heading: /Psychic\s+readings/i },
  { link: 'Tarot Readings', url: /\/tarot-readings\/?$/, heading: /Tarot\s+readings/i },
  { link: 'Astrology Readings', url: /\/astrology-readings\/?$/, heading: /Astrology\s+readings/i },
  { link: 'Love & Relationships', url: /\/love-and-relationships\/?$/, heading: 'Relationship Psychics and Love Readings' },
  { link: 'Dream Interpreter', url: /\/dream-interpreter\/?$/, heading: 'Dream Interpreter' },
  { link: 'Sexology Advice', url: /\/sexology-advice\/?$/, heading: 'Sex Life Psychic Advice' },
  { link: 'Daily Horoscope', url: /\/daily-horoscope\/?$/, heading: /Daily .* Horoscope/i },
  { link: 'Weekly Horoscope', url: /\/weekly-horoscope\/?$/, heading: /Weekly .* Horoscope/i },
  { link: 'Monthly Horoscope', url: /\/monthly-horoscope\/?$/, heading: /Monthly .* Horoscope/i },
  { link: 'Getting Started', url: /\/psychics\/?$/, heading: 'Psychics' },
  { link: 'How To Find An Advisor', url: /\/match-advisor\/?$/, heading: 'Find your match with a Psychic Expert' },
  { link: 'What To Ask', url: /\/match-advisor\/?$/, heading: 'Find your match with a Psychic Expert' },
  { link: 'FAQ', url: /\/faq\/?$/, heading: 'FAQ' },
  { link: 'Become a Psychic', url: /\/contacts\/?$/, heading: 'Contacts' },
  { link: 'Contact Us', url: /\/contacts\/?$/, heading: 'Contacts' },
  { link: 'About Us', url: /\/about\/?$/, heading: 'About Us' },
  { link: 'Privacy Policy', url: /\/policy\/?$/, heading: 'Privacy Policy' },
  { link: 'Terms and Conditions', url: /\/terms\/?$/, heading: 'Disclaimer and Terms' }
] as const;

test.describe('site navigation', () => {
  test('psychics menu shows all its items and each one opens its page @ui @navigation', async ({
    signedInUser,
    pages,
    page
  }) => {
    await test.step('the menu opens and lists all its items', async () => {
      await pages.articles.open();
      await pages.header.openPsychicsMenu();

      await expect(pages.header.menuItems).toHaveCount(PSYCHICS_MENU.length);
      for (const entry of PSYCHICS_MENU) {
        await expect(pages.header.menuItem(entry.item)).toBeVisible();
      }
    });

    for (const entry of PSYCHICS_MENU) {
      await test.step(`"${entry.item}" opens its page`, async () => {
        await pages.articles.open();
        await pages.header.openPsychicsMenu();
        await pages.header.clickMenuItem(entry.item);

        await expect(page).toHaveURL(entry.url);
        await expect(pages.content.topHeading).toBeVisible();
      });
    }
  });

  test('horoscope menu shows all its items and each one opens its page @ui @navigation', async ({
    signedInUser,
    pages,
    page
  }) => {
    await test.step('the menu opens and lists all its items', async () => {
      await pages.articles.open();
      await pages.header.openHoroscopeMenu();

      await expect(pages.header.menuItems).toHaveCount(HOROSCOPE_MENU.length);
      for (const entry of HOROSCOPE_MENU) {
        await expect(pages.header.menuItem(entry.item)).toBeVisible();
      }
    });

    for (const entry of HOROSCOPE_MENU) {
      await test.step(`"${entry.item}" opens its page`, async () => {
        await pages.articles.open();
        await pages.header.openHoroscopeMenu();
        await pages.header.clickMenuItem(entry.item);

        await expect(page).toHaveURL(entry.url);
        await expect(pages.content.topHeading).toBeVisible();
      });
    }
  });

  test('articles link opens the list and an article can be read @ui @navigation', async ({
    signedInUser,
    pages,
    page
  }) => {
    await test.step('the header link opens the articles page', async () => {
      await pages.header.articlesLink.click();

      await expect(page).toHaveURL(/\/articles\/?$/);
      await expect(pages.articles.pageHeading).toBeVisible();
      await expect(page).toHaveTitle(/Psychic Articles & Guides/);
    });

    await test.step('the first article opens on its own page with text', async () => {
      await pages.articles.open();
      await pages.articles.firstArticleCardTitle.scrollIntoViewIfNeeded();
      await pages.articles.firstArticleCardTitle.click();

      await expect(page).not.toHaveURL(/\/articles\/?$/);
      await expect(pages.content.topHeading).toBeVisible();
      await expect(pages.content.articleBody).toBeVisible();
    });
  });

  test('every footer link opens a real page @ui @navigation', async ({ signedInUser, pages, page }) => {
    for (const entry of FOOTER_LINKS) {
      await test.step(`"${entry.link}" opens its page`, async () => {
        await pages.articles.open();
        await pages.footer.scrollIntoView();
        await pages.footer.link(entry.link).click();

        await expect(page).toHaveURL(entry.url);
        await expect(pages.content.heading(entry.heading)).toBeVisible();
      });
    }
  });
});
