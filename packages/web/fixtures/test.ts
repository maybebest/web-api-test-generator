import { test as base, expect, type APIRequestContext } from '@playwright/test';

import { defaultTestData, type TestData } from '../data/test-data';
import { createTestDataManager, type TestDataManager } from './test-data-manager';

type ApiHelpers = {
  getJson<T>(path: string): Promise<T>;
};

type Fixtures = {
  testData: TestData;
  api: ApiHelpers;
  // API-driven test-data management (channel config, catalogue, plan seeding). Reads are
  // implemented; mutating helpers throw NotImplementedTestDataError until the backend op is wired
  // (see fixtures/test-data-manager.ts and MISSING_TEST_DATA_FUNCTIONS).
  dataManager: TestDataManager;
};

export const test = base.extend<Fixtures>({
  testData: async ({}, use) => {
    await use(defaultTestData);
  },

  api: async ({ request }, use) => {
    await use(createApiHelpers(request));
  },

  dataManager: async ({}, use) => {
    await use(createTestDataManager());
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
