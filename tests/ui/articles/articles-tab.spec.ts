import { expect, uiTest as test } from '../../../fixtures/ui-test';

/**
 * The Articles section is reachable from the header and shows real content:
 * a list of articles, and an article page with its title and text.
 */
test('articles section opens from the header and shows a real article @ui @articles', async ({
  signedInUser,
  pages,
  page
}) => {
  await test.step('the header link opens the articles list', async () => {
    await pages.header.articlesLink.click();
    await page.waitForURL(/\/articles/);
    await expect(pages.articles.pageHeading).toBeVisible();
    await expect(pages.articles.popularHeading).toBeVisible();
    await expect(pages.articles.firstArticleCardTitle).toBeVisible();
  });

  await test.step('the first article opens with its own title and text', async () => {
    const title = (await pages.articles.firstArticleCardTitle.textContent())!.trim();
    await pages.articles.firstArticleCardTitle.click();
    await page.waitForURL((url) => !url.pathname.startsWith('/articles'));

    await expect(pages.article.heading(title)).toBeVisible();
    await expect(pages.article.firstParagraph).toBeVisible();
  });
});
