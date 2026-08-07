import { test as base, expect } from '@playwright/test';

import { ApiClient } from '../api/http/ApiClient';
import { AgentFacade, type AgentSession } from '../api/facades/AgentFacade';
import { BookingFacade } from '../api/facades/BookingFacade';
import { ExpertFacade } from '../api/facades/ExpertFacade';
import { UserFacade } from '../api/facades/UserFacade';
import { AgentPool } from '../api/support/agent-pool';
import { ExpertFactory } from '../api/support/expert-factory';
import { UserFactory } from '../api/support/user-factory';
import { credentials } from '../config/credentials';
import { environment } from '../config/environments';

export type ApiFixtures = {
  /** HTTP client for the API. Bind a token with `api.withToken(...)`. */
  api: ApiClient;
  /** Creates users and profiles, attaches cards. */
  userFacade: UserFacade;
  /** Users created through it are deleted when the test ends. */
  users: UserFactory;
  /** Agent actions: online, find chat, assign, read messages. */
  agentFacade: AgentFacade;
  /** Administrator actions on experts: generate, publish, edit, delete. */
  expertFacade: ExpertFacade;
  /** Experts created through it are deleted when the test ends. */
  experts: ExpertFactory;
  /** Booking a session over the API: choose, calendar, pay, take a cell. */
  bookingFacade: BookingFacade;
  /**
   * A support agent taken from the pool for this test only, already online.
   * Other tests get a different agent, so parallel runs never collide.
   */
  agent: AgentSession;
  /**
   * The whole agent pool, online. Only for tests that need more than one
   * agent at a time (three bookings in a row, for example). It waits until
   * every agent is free, so use it only when one agent is not enough.
   */
  agents: AgentSession[];
  /**
   * Switches every agent of the pool online. Booking needs this, because the
   * site picks the agent behind a booking itself — see AgentFacade.
   */
  keepAgentsOnline: () => Promise<void>;
  /** Sessions behind `keepAgentsOnline`, for tests that wait for a session. */
  onlineAgents: AgentSession[];
};

/**
 * Base test for everything that talks to the API.
 * UI tests extend it (see ui-test.ts), so both layers share one setup.
 */
export const apiTest = base.extend<ApiFixtures>({
  api: async ({ playwright }, use) => {
    const context = await playwright.request.newContext({ baseURL: environment.apiUrl });
    await use(new ApiClient(context));
    await context.dispose();
  },

  userFacade: async ({ api }, use) => {
    await use(new UserFacade(api));
  },

  agentFacade: async ({ api }, use) => {
    await use(new AgentFacade(api));
  },

  expertFacade: async ({ api }, use) => {
    await use(new ExpertFacade(api));
  },

  experts: async ({ expertFacade }, use, testInfo) => {
    const factory = new ExpertFactory(expertFacade, testInfo.title);
    await use(factory);

    const report = await factory.cleanUp();
    if (report.length > 0) {
      await testInfo.attach('expert cleanup', { body: report.join('\n'), contentType: 'text/plain' });
    }
  },

  // Depends on `users` although it does not read it: fixtures tear down in
  // reverse order, so the dependency makes the booking sweep run while the
  // test users still exist and their tokens can still cancel.
  bookingFacade: async ({ api, users }, use, testInfo) => {
    void users;
    const facade = new BookingFacade(api);
    await use(facade);

    const report = await facade.cancelRemainingQuietly();
    if (report.length > 0) {
      await testInfo.attach('booking cleanup', { body: report.join('\n'), contentType: 'text/plain' });
    }
  },

  users: async ({ userFacade }, use, testInfo) => {
    const factory = new UserFactory(userFacade);
    await use(factory);

    const report = await factory.deleteAll();
    if (report.length > 0) {
      await testInfo.attach('cleanup', { body: report.join('\n'), contentType: 'text/plain' });
    }
  },

  agent: async ({ agentFacade }, use, testInfo) => {
    const pool = new AgentPool();
    const login = await pool.acquire(testInfo.title);
    // A long test outlives the age at which a lock counts as abandoned, so
    // the lock is refreshed while the test runs.
    const keepLock = setInterval(() => pool.touch(login, testInfo.title), 60_000);
    try {
      const session = await agentFacade.openSession(login, credentials.agentPool.password);
      await agentFacade.ensureOnline(session);
      await use(session);
    } finally {
      clearInterval(keepLock);
      pool.release(login);
    }
  },

  agents: async ({ agentFacade }, use, testInfo) => {
    const pool = new AgentPool();
    let taken: string[] = [];
    try {
      taken = await pool.acquireMany(credentials.agentPool.logins.length, testInfo.title);
      const sessions = [];
      for (const login of taken) {
        const session = await agentFacade.openSession(login, credentials.agentPool.password);
        await agentFacade.ensureOnline(session);
        sessions.push(session);
      }
      await use(sessions);
    } finally {
      taken.forEach((login) => pool.release(login));
    }
  },

  onlineAgents: async ({ agentFacade }, use) => {
    // No pool lock here: this is only about presence. The test still holds
    // its own agent for the chat work.
    await use(await agentFacade.openPoolSessions());
  },

  keepAgentsOnline: async ({ agentFacade, onlineAgents }, use) => {
    await use(() => agentFacade.ensureEveryoneOnline(onlineAgents));
  }
});

export { expect };
