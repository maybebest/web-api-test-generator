import type { Locator, Page } from '@playwright/test';

// Global site header. Besides the banner/nav helpers it owns the two header
// dropdown menus exposed across the authenticated PsychicBook experience:
//   - "Psychics"  (button) -> role=menu with 10 menuitems
//   - "Horoscope" (button) -> role=menu with 16 menuitems
// DOM-discovery facts (evidence: docs/ai-testing/psychicbook-navigation-flow.md):
//   * Both menus open on CLICK only (hover does not open them).
//   * The open popup is a role=menu rendered in a portal at document level
//     (not inside <header>); its entries are role=menuitem. Scope items to the
//     open menu so labels that also appear in the footer/body never collide.
//   * The "Horoscope" button's accessible name changes while the menu is open,
//     so never re-query the button by name after opening — open, then act on
//     the menu.
export class Header {
  readonly root: Locator;
  readonly navigation: Locator;
  readonly articlesLink: Locator;
  readonly psychicsMenuButton: Locator;
  readonly horoscopeMenuButton: Locator;
  readonly menu: Locator;
  readonly menuItems: Locator;
  readonly mySessionsLink: Locator;
  readonly getStartedCta: Locator;

  constructor(private readonly page: Page) {
    this.root = page.getByRole('banner');
    this.navigation = page.getByRole('navigation');
    this.articlesLink = page.getByRole('banner').getByRole('link', { name: 'Articles' });
    this.psychicsMenuButton = page.getByRole('button', { name: 'Psychics', exact: true });
    this.horoscopeMenuButton = page.getByRole('button', { name: 'Horoscope', exact: true });
    // Logged-in session signals: "My Sessions" appears only for an
    // authenticated user, the "Get Started" CTA only for an anonymous one.
    this.mySessionsLink = this.root.getByRole('link', { name: /my sessions/i });
    this.getStartedCta = this.page.getByRole('link', { name: /get started/i });
    // Scope to the visible (open) menu: the dropdown portal is the only menu on
    // screen while open, and filtering to visible turns a stray mounted menu
    // into an explicit failure instead of a strict-mode crash.
    this.menu = page.getByRole('menu').filter({ visible: true });
    this.menuItems = this.menu.getByRole('menuitem');
  }

  /** The logged-in user's nickname as rendered inside the header. */
  nicknameLabel(nickname: string): Locator {
    return this.root.getByText(nickname);
  }

  async openPsychicsMenu(): Promise<void> {
    await this.openMenu('Psychics');
  }

  async openHoroscopeMenu(): Promise<void> {
    await this.openMenu('Horoscope');
  }

  // The header dropdowns open on click. On the SPA the trigger can be visible
  // before its click handler is hydrated, so the first click occasionally
  // no-ops; re-click until the menu appears. Re-resolve the button fresh each
  // time (it re-renders/goes stale after toggling) and only re-click while the
  // menu is still closed, so we never toggle an already-open menu shut. (The
  // closed button keeps its accessible name, so name-based re-clicks are safe.)
  private async openMenu(buttonName: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await this.menu.isVisible().catch(() => false)) {
        return;
      }
      await this.page.getByRole('button', { name: buttonName, exact: true }).click();
      const opened = await this.menu
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true, () => false);
      if (opened) {
        return;
      }
    }
    await this.menu.waitFor({ state: 'visible' });
  }

  menuItem(name: string): Locator {
    return this.menu.getByRole('menuitem', { name, exact: true });
  }

  // Clicking an item follows its inner link and navigates. Lower items in the
  // (taller) Horoscope menu need scrolling into view first.
  async clickMenuItem(name: string): Promise<void> {
    const item = this.menuItem(name);
    await item.scrollIntoViewIfNeeded();
    await item.click();
  }
}
