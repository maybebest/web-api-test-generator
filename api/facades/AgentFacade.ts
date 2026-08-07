import { expect, test } from '@playwright/test';

import type { ApiClient } from '../http/ApiClient';
import { AgentApi } from '../services/AgentApi';
import type { ChatDto, ChatMessageDto, ChatPageDto, ChatSessionDto } from '../dto/agent.dto';
import { credentials } from '../../config/credentials';

export type AgentSession = {
  consultantUuid: string;
  api: AgentApi;
};

/** How long we wait for a chat to appear after a booking is paid. */
const CHAT_APPEARS_TIMEOUT_MS = 30_000;
/** How often the user page is reloaded while waiting for a session. */
const PAGE_REFRESH_EVERY_MS = 60_000;

/**
 * Everything a test needs on the agent side: log in, go online, find the
 * chat of a user, take that chat and read its messages.
 */
export class AgentFacade {
  constructor(private readonly client: ApiClient) {}

  /**
   * Logs the agent in the same way the agent cabinet does: first the
   * password check, then the token request.
   *
   * Careful: a wrong password still answers 200, only without a token. So
   * the token, not the status, tells us the login worked.
   */
  async openSession(email: string, password: string): Promise<AgentSession> {
    return test.step(`agentSession ${email}`, async () => {
      const anonymous = new AgentApi(this.client);

      const authorization = await anonymous.authorize(email, password);
      expect(authorization.status, 'agent authorization should answer 200').toBe(200);
      const consultantUuid = authorization.body?.consultantUuid;
      expect(consultantUuid, 'authorization must return consultantUuid').toBeTruthy();

      const token = await anonymous.oauthToken(consultantUuid!, password);
      expect(token.status, 'agent OAuth token should answer 200').toBe(200);
      const accessToken = token.body?.access_token ?? token.body?.accessToken;
      expect(accessToken, 'agent login must issue an access token').toBeTruthy();

      return {
        consultantUuid: consultantUuid!,
        api: new AgentApi(this.client.withToken(accessToken!))
      };
    });
  }

  /**
   * Switches the agent online and checks it really happened.
   *
   * Experts show free time only while at least one agent is online, so this
   * runs before every booking. The switch call answers 200 even when the
   * flag did not change, so the state is read back.
   */
  async ensureOnline(agent: AgentSession): Promise<void> {
    await test.step('make sure the agent is online', async () => {
      const switched = await agent.api.setOnline(true);
      expect(switched.status, 'switching the agent online should answer 200').toBe(200);

      const own = await agent.api.getOwn();
      expect(own.status, 'reading the agent state should answer 200').toBe(200);
      expect(own.body?.online, 'the agent must be online, the 200 above is not enough').toBe(true);
    });
  }

  /**
   * Logs in every agent of the pool, without taking any of them from it.
   *
   * The site, not the test, decides which agent serves a booking: a booked
   * slot belongs to one agent, and the calendar an expert shows is that
   * agent's calendar. So the whole pool has to be online, not only the agent
   * this test holds — see `ensureEveryoneOnline`.
   */
  async openPoolSessions(): Promise<AgentSession[]> {
    return test.step('log in every agent of the pool', async () => {
      const sessions: AgentSession[] = [];
      for (const login of credentials.agentPool.logins) {
        sessions.push(await this.openSession(login, credentials.agentPool.password));
      }
      return sessions;
    });
  }

  /**
   * Switches every agent of the pool online.
   *
   * Two things on the stage depend on it, both measured:
   *  - an expert offers the "NOW" cell only while the agent behind them is
   *    online;
   *  - a booking that lands on an offline agent is cancelled by the site
   *    within seconds ("session cancelled by therapist"), and then the
   *    session never starts.
   *
   * Tests never switch an agent off, so several tests doing this at the same
   * time cannot get in each other's way.
   *
   * This is preparation, not a check: one agent that refuses to come online
   * (it happens while it serves a session of another test) must not fail the
   * test. The agent this test holds is the one that has to be online, and
   * `ensureOnline` guards that separately.
   */
  async ensureEveryoneOnline(sessions: AgentSession[], quiet = false): Promise<void> {
    if (quiet) {
      await Promise.all(sessions.map((session) => session.api.setOnline(true, true)));
      return;
    }
    await test.step(`switch all ${sessions.length} pool agents online`, async () => {
      const offline: string[] = [];
      for (const session of sessions) {
        await session.api.setOnline(true, true);
        const own = await session.api.getOwn();
        if (own.body?.online !== true) {
          offline.push(session.consultantUuid);
        }
      }
      if (offline.length > 0) {
        await test.info().attach('agents that stayed offline', {
          body: offline.join('\n'),
          contentType: 'text/plain'
        });
      }
    });
  }

  /**
   * Writes the agent working hours into the report. It is information for a
   * failed run, not a check: compare the UTC pair startTime/endTime, the
   * *Local fields are in the agent own time zone.
   */
  async logSchedule(agent: AgentSession): Promise<void> {
    const schedule = await agent.api.getSchedule();
    const now = Date.now();
    const coversNow = (schedule.body?.workPeriods ?? []).some(
      (period) => Date.parse(period.startTime) <= now && now <= Date.parse(period.endTime)
    );
    await test.info().attach('agent schedule', {
      body: JSON.stringify({ coversNowUtc: coversNow, workPeriods: schedule.body?.workPeriods ?? [] }, null, 2),
      contentType: 'application/json'
    });
  }

  /**
   * Reads the chat a booking created and checks it belongs to this user.
   *
   * The chat list is not a way to find it: it answers with the first 30 of
   * more than twenty thousand chats, in no dependable order, so a chat made
   * a second ago is often not on that page. The booking gives us the chat
   * id, and the nickname proves the chat is the right one.
   */
  async readChatOfUser(agent: AgentSession, chatUuid: string, nickname: string): Promise<ChatDto> {
    return test.step(`read the chat of "${nickname}"`, async () => {
      let chat: ChatDto | undefined;

      await expect
        .poll(
          async () => {
            const answer = await agent.api.getChat(chatUuid, true);
            chat = answer.body;
            return answer.status;
          },
          { timeout: CHAT_APPEARS_TIMEOUT_MS, message: `chat ${chatUuid} never became readable` }
        )
        .toBe(200);

      expect(chat?.userProfile?.nickname, 'the chat should belong to the user of this test').toBe(nickname);
      return chat!;
    });
  }

  /**
   * Finds the chat of a user by nickname. A chat exists only after a booking
   * is paid, and it shows up with a small delay, so the list is re-read
   * until the chat is there.
   */
  async findChatByNickname(agent: AgentSession, nickname: string): Promise<ChatDto> {
    return test.step(`find the chat of "${nickname}"`, async () => {
      let found: ChatDto | undefined;

      await expect
        .poll(
          async () => {
            found = (await this.listChats(agent)).find((chat) => chat.userProfile?.nickname === nickname);
            return Boolean(found);
          },
          { timeout: CHAT_APPEARS_TIMEOUT_MS, message: `chat of user "${nickname}" never appeared` }
        )
        .toBe(true);

      return found!;
    });
  }

  /** All chats the agent can see. */
  async listChats(agent: AgentSession): Promise<ChatDto[]> {
    const listed = await agent.api.listChats('all');
    expect(listed.status, 'chat list should answer 200').toBe(200);
    return Array.isArray(listed.body) ? listed.body : ((listed.body as ChatPageDto | undefined)?.content ?? []);
  }

  /**
   * Takes the chat for our agent.
   *
   * The server gives a new chat to a random agent by itself, so we simply
   * take it over. The assign call can answer 200 without changing anything,
   * so the chat is read back and the call is repeated if needed.
   */
  async assignChatToAgent(agent: AgentSession, chat: ChatDto): Promise<void> {
    await test.step(`assign chat ${chat.uuid} to agent`, async () => {
      const userProfileUuid = chat.userProfile?.profileUuid;
      const expertProfileUuid = chat.expertProfile?.profileUuid;
      expect(userProfileUuid, 'chat must expose userProfile.profileUuid').toBeTruthy();
      expect(expertProfileUuid, 'chat must expose expertProfile.profileUuid').toBeTruthy();

      const previousHolder = chat.agentProfile?.profileUuid ?? 'nobody';
      await test.info().attach('chat holder before assign', {
        body: `chat ${chat.uuid} was held by ${previousHolder}`,
        contentType: 'text/plain'
      });

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const assigned = await agent.api.assignChat(userProfileUuid!, expertProfileUuid!);
        expect(assigned.status, 'taking the chat should answer 200').toBe(200);

        const fresh = await agent.api.getChat(chat.uuid);
        expect(fresh.status, 'reading the chat back should answer 200').toBe(200);
        if (fresh.body?.agentProfile?.profileUuid === agent.consultantUuid) {
          return;
        }
      }
      throw new Error(
        `Chat ${chat.uuid} still does not belong to our agent after 3 attempts (it was held by ${previousHolder})`
      );
    });
  }

  /**
   * Waits until the session of a chat is running.
   *
   * A session booked for "NOW" is running at once. A session booked for a
   * time starts when that time comes, and only while an agent is online —
   * the server switches an agent offline by itself after a few minutes, so
   * the agent is switched back on before every check.
   *
   * `refreshUserPage` is called about once a minute, not on every check: the
   * user side keeps a live connection to the site, and reloading the page
   * every few seconds would break it again and again.
   */
  async waitForSessionStart(
    agent: AgentSession,
    chatUuid: string,
    waitMs: number,
    options: { slotName?: string; refreshUserPage?: () => Promise<void>; keepOnline?: AgentSession[] } = {}
  ): Promise<void> {
    const bookedFor = options.slotName ? ` booked for ${options.slotName}` : '';
    const online = options.keepOnline ?? [agent];

    await test.step('wait for the session to start', async () => {
      let refreshedAt = Date.now();

      await expect
        .poll(
          async () => {
            await this.ensureEveryoneOnline(online, true);

            if (options.refreshUserPage && Date.now() - refreshedAt > PAGE_REFRESH_EVERY_MS) {
              refreshedAt = Date.now();
              await options.refreshUserPage().catch(() => undefined);
            }
            return this.sessionIsRunning(agent, chatUuid);
          },
          {
            timeout: waitMs,
            intervals: [10_000],
            message: `the session${bookedFor} should start`
          }
        )
        .toBe(true);
    });
  }

  /**
   * Waits until the session of a chat is over.
   *
   * A session ends by itself when the paid minutes are used up; an agent
   * cannot close it earlier. When it is over, asking for the current
   * session answers "there is none".
   */
  async waitForSessionEnd(
    agent: AgentSession,
    chatUuid: string,
    waitMs: number,
    options: { keepOnline?: AgentSession[] } = {}
  ): Promise<void> {
    const online = options.keepOnline ?? [agent];

    await test.step('wait for the session to end', async () => {
      // The session state blinks: for a moment the API answers "no session"
      // while the session is still running. So the end is only accepted when
      // two checks in a row agree.
      let quietChecks = 0;

      await expect
        .poll(
          async () => {
            // A session should not be cut short because an agent went
            // offline while we waited.
            await this.ensureEveryoneOnline(online, true);
            quietChecks = (await this.sessionIsRunning(agent, chatUuid)) ? 0 : quietChecks + 1;
            return quietChecks >= 2;
          },
          {
            timeout: waitMs,
            intervals: [15_000],
            message: 'the session should end when the paid minutes are over'
          }
        )
        .toBe(true);
    });
  }

  /**
   * Is a session running in this chat?
   *
   * Asked in two ways, because the two answers come from different places:
   * the session itself, and the `session` field of the chat. A finished
   * session is still returned, so the answer is the status, not the 200 —
   * see `isRunning`.
   */
  private async sessionIsRunning(agent: AgentSession, chatUuid: string): Promise<boolean> {
    const session = await agent.api.getCurrentSession(chatUuid, true);
    if (session.status === 200) {
      return isRunning(session.body);
    }
    const chat = await agent.api.getChat(chatUuid, true);
    return isRunning(chat.body?.session);
  }

  /** Reads chat messages. The API may answer with a list or with a page. */
  async readMessages(agent: AgentSession, chatUuid: string): Promise<ChatMessageDto[]> {
    const response = await agent.api.getMessages(chatUuid);
    expect(response.status, 'message list should answer 200').toBe(200);
    const body = response.body;
    return Array.isArray(body) ? body : (body?.content ?? []);
  }

  /**
   * Splits messages into "written by the user" and "written by the agent".
   *
   * Service messages (booking notice, coupon, session ended) are skipped.
   * An agent message is sent under the expert name — that is how the product
   * works, not a bug — so it is recognised by the agent id, not the author.
   */
  classifyMessages(
    messages: ChatMessageDto[],
    ids: { userProfileUuid: string; expertProfileUuid: string; consultantUuid: string }
  ): { userMessages: ChatMessageDto[]; agentMessages: ChatMessageDto[] } {
    const real = messages.filter((message) => message.type === 'MSG');
    return {
      userMessages: real.filter((message) => message.authorProfileUuid === ids.userProfileUuid),
      agentMessages: real.filter(
        (message) =>
          message.authorProfileUuid === ids.expertProfileUuid && message.agentProfileUuid === ids.consultantUuid
      )
    };
  }
}

/**
 * A session that has run out is not removed: it keeps being returned with
 * status "CLOSED" and an end date, and the request still answers 200. So a
 * running session is one that says "OPENED" and has no end date yet.
 */
function isRunning(session?: ChatSessionDto | null): boolean {
  return Boolean(session) && session!.status === 'OPENED' && !session!.endDate;
}
