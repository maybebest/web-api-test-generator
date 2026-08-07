import './load-dotenv';

/**
 * Every credential the tests use comes from environment variables.
 * Nothing is hard-coded here, and no password is ever printed to a report.
 *
 * See docs/environment-variables.md for the full list and how to fill it.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Environment variable ${name} is not set. See docs/environment-variables.md and copy .env.example to .env.`
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const credentials = {
  /** HTTP basic auth of the site (the whole site sits behind it). */
  basicAuth: {
    username: required('WEB_BASIC_AUTH_USER'),
    password: required('WEB_BASIC_AUTH_PASSWORD')
  },

  /**
   * Support agents the tests borrow from. Tests take one agent from this
   * pool, hold it while they run and give it back, so parallel workers
   * never share an agent. Add more logins here to run wider.
   */
  agentPool: {
    logins: optional('AGENT_POOL_LOGINS', 'aqa1@gmail.com,aqa2@gmail.com,aqa3@gmail.com')
      .split(',')
      .map((login) => login.trim())
      .filter(Boolean),
    password: required('AGENT_PASSWORD')
  },

  /** Administrator account. Expert tests create and delete experts with it. */
  admin: {
    email: required('ADMIN_EMAIL'),
    password: required('ADMIN_PASSWORD')
  },

  /** Test card used for paid steps. */
  testCard: {
    number: optional('TEST_CARD_NUMBER', '4242424242424242'),
    expiry: optional('TEST_CARD_EXPIRY', '04/44'),
    cvc: optional('TEST_CARD_CVC', '444'),
    /** Payment method id accepted by the payment provider in test mode. */
    paymentMethodId: optional('TEST_CARD_PAYMENT_METHOD_ID', 'pm_card_visa')
  },

  /** Email address pattern for generated users: <local>+<prefix><random>@<domain>. */
  userEmail: {
    local: optional('TEST_EMAIL_LOCAL_PART', 'olekwer'),
    domain: optional('TEST_EMAIL_DOMAIN', 'gmail.com')
  }
};
