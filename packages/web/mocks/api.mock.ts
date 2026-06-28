import type { Page, Route } from '@playwright/test';

type JsonBody = Record<string, unknown> | Array<unknown>;

export interface MockOptions {
  status?: number;
  /** Only fulfill requests using this HTTP method; other methods fall through. */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Fulfill at most this many matching requests, then fall through. */
  times?: number;
}

export async function mockJsonResponse(
  page: Page,
  urlPattern: string | RegExp,
  body: JsonBody,
  options: MockOptions = {}
): Promise<void> {
  const { status = 200, method, times } = options;
  let served = 0;

  await page.route(urlPattern, async (route: Route) => {
    if (method && route.request().method() !== method) {
      await route.fallback();
      return;
    }

    if (times !== undefined && served >= times) {
      await route.fallback();
      return;
    }

    served += 1;
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });
}

export async function mockJsonError(
  page: Page,
  urlPattern: string | RegExp,
  status = 500,
  message = 'Mocked server error'
): Promise<void> {
  await mockJsonResponse(page, urlPattern, { error: message }, { status });
}

export async function clearMockRoutes(page: Page, urlPattern: string | RegExp): Promise<void> {
  await page.unroute(urlPattern);
}
