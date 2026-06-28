export type TestUser = {
  email: string;
  password?: string;
  role: 'user' | 'admin';
};

export const users = {
  standard: {
    email: process.env.E2E_USER_EMAIL || 'test@example.com',
    password: process.env.E2E_USER_PASSWORD,
    role: 'user'
  },
  admin: {
    email: process.env.E2E_ADMIN_EMAIL || 'admin@example.com',
    password: process.env.E2E_ADMIN_PASSWORD,
    role: 'admin'
  }
} satisfies Record<string, TestUser>;

export const hasStandardUserCredentials = Boolean(
  process.env.E2E_USER_EMAIL && process.env.E2E_USER_PASSWORD
);

