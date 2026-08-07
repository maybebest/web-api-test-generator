import { expect, test } from '@playwright/test';

import type { AgentFacade, AgentSession } from '../api/facades/AgentFacade';
import type { ChatDto } from '../api/dto/agent.dto';
import type { ChatPage } from '../pages/ChatPage';

/**
 * A conversation between a user (in the browser) and an agent (over the
 * API) inside one chat.
 *
 * Two facts about the product shape this class:
 *  - an agent can write only in a chat that belongs to it, so the chat is
 *    taken first;
 *  - the user sees agent messages under the expert name, and the text can
 *    be re-cased or translated on the way, so the exact wording is checked
 *    on the API side where the original text is kept.
 */
export class ConversationFlow {
  /** The agent that writes in the chat. See `takeChatOf`. */
  private agent: AgentSession;

  constructor(
    private readonly agents: AgentFacade,
    poolAgent: AgentSession,
    private readonly chatUi: ChatPage,
    /** Agents we are logged in as, any of which the site may pick. */
    private readonly known: AgentSession[] = []
  ) {
    this.agent = poolAgent;
  }

  /** The agent this conversation speaks as. Known only after `takeChatOf`. */
  get speaker(): AgentSession {
    return this.agent;
  }

  /**
   * Finds the chat created for this user and makes sure we can write in it.
   *
   * The site hands a new chat to an agent of its own choosing. When that is
   * one of the agents we are logged in as, we simply speak as that agent —
   * a chat whose session is already running cannot be taken over at all
   * (the assign call answers 400). Otherwise the chat is taken over, which
   * only works before the session starts.
   */
  async takeChatOf(nickname: string, chatUuid?: string): Promise<ChatDto> {
    const chat = chatUuid
      ? await this.agents.readChatOfUser(this.agent, chatUuid, nickname)
      : await this.agents.findChatByNickname(this.agent, nickname);

    const owner = this.known.find((session) => session.consultantUuid === chat.agentProfile?.profileUuid);
    if (owner) {
      this.agent = owner;
      return chat;
    }

    await this.agents.assignChatToAgent(this.agent, chat);
    return chat;
  }

  /** Agent writes the given messages and re-reads the chat to confirm them. */
  async agentSends(chat: ChatDto, texts: string[]): Promise<void> {
    await test.step(`agent sends ${texts.length} message(s)`, async () => {
      for (const text of texts) {
        const sent = await this.agent.api.sendMessage(chat.uuid, text);
        expect(sent.status, 'sending a message should answer 200').toBe(200);
        expect(sent.body?.uuid, 'the sent message should have an id').toBeTruthy();
      }

      const messages = await this.agents.readMessages(this.agent, chat.uuid);
      const sentTexts = messages.map((message) => message.data).filter((text) => texts.includes(text ?? ''));
      expect(sentTexts, 'all sent messages should be in the chat').toEqual(texts);
    });
  }

  /** User sees the messages in the browser. */
  async userSees(texts: string[]): Promise<void> {
    await test.step('user sees the messages', async () => {
      for (const text of texts) {
        await this.chatUi.waitForIncoming(text);
      }
    });
  }

  /** User types the given messages in the browser. */
  async userSends(texts: string[]): Promise<void> {
    await test.step(`user sends ${texts.length} message(s)`, async () => {
      for (const text of texts) {
        await this.chatUi.sendMessage(text);
      }
    });
  }

  /**
   * Agent sees exactly these user messages, in this order. The original text
   * is compared, because the agent side may show a translation.
   */
  async agentSeesUserMessages(chat: ChatDto, texts: string[]): Promise<void> {
    await expect
      .poll(
        async () => {
          const messages = await this.agents.readMessages(this.agent, chat.uuid);
          const { userMessages } = this.agents.classifyMessages(messages, this.chatIds(chat));
          return userMessages.map((message) => message.originalData);
        },
        { timeout: 60_000, message: 'user messages should reach the agent in the same order' }
      )
      .toEqual(texts);
  }

  /** Agent messages are stored under the expert name, not the agent one. */
  async agentMessagesComeFromExpert(chat: ChatDto, texts: string[]): Promise<void> {
    const messages = await this.agents.readMessages(this.agent, chat.uuid);
    const { agentMessages } = this.agents.classifyMessages(messages, this.chatIds(chat));
    expect(agentMessages.map((message) => message.data)).toEqual(texts);
  }

  private chatIds(chat: ChatDto) {
    return {
      userProfileUuid: chat.userProfile!.profileUuid,
      expertProfileUuid: chat.expertProfile!.profileUuid,
      consultantUuid: this.agent.consultantUuid
    };
  }
}
