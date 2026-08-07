import type { ApiClient, ApiResult } from '../http/ApiClient';
import type {
  AgentAuthorizationResponseDto,
  AgentOwnDto,
  AgentScheduleDto,
  ChatDto,
  ChatMessageDto,
  ChatMessagePageDto,
  ChatPageDto,
  ChatSessionDto,
  ExpertCouponDto,
  OAuthTokenResponseDto
} from '../dto/agent.dto';
import { base64, uuid } from '../support/crypto';

/**
 * The whole agent-side surface the ported cases use — the same calls the
 * helpdesk cabinet makes, minus the cabinet. Do not explore beyond it:
 * POST /talk/chat answers 500, DELETE of an agent message answers 500,
 * and guessing chat-list enum values burns the run budget.
 */
export class AgentApi {
  constructor(private readonly client: ApiClient) {}

  // --- authorization (no bearer yet) ---

  authorize(email: string, password: string): Promise<ApiResult<AgentAuthorizationResponseDto>> {
    return this.client.post('/profile/agent/authorization', {
      data: { email, password }
    });
  }

  /** Public OAuth client of the PsychicBook frontends, not a user secret. */
  oauthToken(consultantUuid: string, password: string): Promise<ApiResult<OAuthTokenResponseDto>> {
    return this.client.post('/auth/oauth/token', {
      params: { grant_type: 'password', username: consultantUuid, password },
      headers: { Authorization: `Basic ${base64('client:clientsecret')}` }
    });
  }

  // --- agent state (bearer-bound client) ---

  /**
   * `quiet` keeps the call out of the report — used when a test switches the
   * agent online again and again while waiting for something.
   */
  setOnline(online: boolean, quiet = false): Promise<ApiResult<void>> {
    return this.client.patch('/profile/agent/online', {
      params: { online, type: 'MANUAL' },
      quiet
    });
  }

  /** The online oracle is this call's `online` field, never the PATCH status. */
  getOwn(): Promise<ApiResult<AgentOwnDto>> {
    return this.client.get('/profile/agent/own');
  }

  getSchedule(): Promise<ApiResult<AgentScheduleDto>> {
    return this.client.get('/calendar/schedule/for-therapist');
  }

  // --- chats ---

  listChats(type = 'all'): Promise<ApiResult<ChatPageDto | ChatDto[]>> {
    return this.client.get('/talk/chat', {
      params: { type, page: 0, size: 30, reqId: uuid() }
    });
  }

  getChat(chatUuid: string, quiet = false): Promise<ApiResult<ChatDto>> {
    return this.client.get(`/talk/chat/${chatUuid}`, { params: { reqId: uuid() }, quiet });
  }

  /**
   * Both arguments are the `profileUuid` fields of the chat's userProfile /
   * expertProfile — NOT their `uuid` fields (those get a 400 "Failed to
   * convert ... to UUID"). Oracle: fresh getChat → agentProfile.profileUuid.
   */
  assignChat(userProfileUuid: string, expertProfileUuid: string): Promise<ApiResult<void>> {
    return this.client.put('/profile/agent/assign', {
      params: { userUuid: userProfileUuid, expertUuid: expertProfileUuid }
    });
  }

  /** The payload is either a bare array or a Spring page — unwrap via AgentFacade.readMessages. */
  getMessages(chatUuid: string): Promise<ApiResult<ChatMessageDto[] | ChatMessagePageDto>> {
    return this.client.get(`/talk/chat/${chatUuid}/message`, { params: { reqId: uuid() } });
  }

  /**
   * The body is EXACTLY {mid, text, sourceLang} — adding `data` gets a
   * 400/8006 even on a correctly assigned chat. 400/8006 "author is not in
   * chat" means the chat is not owned by this agent; retries won't help.
   */
  sendMessage(chatUuid: string, text: string): Promise<ApiResult<ChatMessageDto>> {
    return this.client.post(`/talk/chat/${chatUuid}/message`, {
      params: { reqId: uuid() },
      data: { mid: uuid(), text, sourceLang: 'en' }
    });
  }

  /** Action buttons (e.g. BOOK_SESSION): the body MUST be an object, a bare string gets 500. */
  sendActionMessage(chatUuid: string, actionType: string, text: string): Promise<ApiResult<ChatMessageDto>> {
    return this.client.post(`/talk/chat/${chatUuid}/message/action`, {
      params: { actionType, reqId: uuid() },
      data: { text, mid: uuid() }
    });
  }

  // --- coupons ---

  listExpertCoupons(expertProfileUuid: string, userProfileUuid: string): Promise<ApiResult<ExpertCouponDto[]>> {
    return this.client.get('/coupon/expert-coupon/all', {
      params: { type: 'ADVISOR_DISCOUNT', expertUuid: expertProfileUuid, userUuid: userProfileUuid }
    });
  }

  sendCouponToChat(chatUuid: string, couponUuid: string): Promise<ApiResult<void>> {
    return this.client.post(`/talk/chat/${chatUuid}/coupon/${couponUuid}`, {
      params: { reqId: uuid() }
    });
  }

  // --- sessions ---

  endSession(chatUuid: string): Promise<ApiResult<void>> {
    return this.client.post(`/talk/chat/${chatUuid}/session/end`, { params: { reqId: uuid() } });
  }

  /** 400/8002 = no session — an expected outcome, not an error. */
  getCurrentSession(chatUuid: string, quiet = false): Promise<ApiResult<ChatSessionDto>> {
    return this.client.get(`/talk/chat/${chatUuid}/session/current`, { params: { reqId: uuid() }, quiet });
  }
}
