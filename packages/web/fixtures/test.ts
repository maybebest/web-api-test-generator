import { test as base, expect, type APIRequestContext } from '@playwright/test';

import { defaultTestData, type TestData } from '../data/test-data';

type ApiHelpers = {
  getJson<T>(path: string): Promise<T>;
};

type Fixtures = {
  testData: TestData;
  api: ApiHelpers;
};

export const test = base.extend<Fixtures>({
  testData: async ({}, use) => {
    await use(defaultTestData);
  },

  api: async ({ request }, use) => {
    await use(createApiHelpers(request));
  }
});

function createApiHelpers(request: APIRequestContext): ApiHelpers {
  return {
    async getJson<T>(path: string): Promise<T> {
      const response = await request.get(path);
      expect(response.ok(), `GET ${path} should return a successful response`).toBeTruthy();
      return (await response.json()) as T;
    }
  };
}

export { expect };
