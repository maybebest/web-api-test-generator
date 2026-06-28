import { users } from './users';

export type TestData = {
  app: {
    defaultPath: string;
  };
  users: typeof users;
  examples: {
    searchTerm: string;
    apiResourcePath: string;
  };
};

export const defaultTestData: TestData = {
  app: {
    defaultPath: '/'
  },
  users,
  examples: {
    searchTerm: 'example',
    apiResourcePath: '/api/example'
  }
};

