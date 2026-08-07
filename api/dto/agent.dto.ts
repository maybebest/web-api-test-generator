/** POST /profile/agent/authorization */
export type AgentAuthorizationResponseDto = {
  consultantUuid: string;
};

/**
 * POST /auth/oauth/token — the token arrives as access_token or accessToken
 * depending on the caller; accept either. 200 without a token = failed login.
 */
export type OAuthTokenResponseDto = {
  access_token?: string;
  accessToken?: string;
  refresh_token?: string;
  token_type?: string;
};

/** GET /profile/agent/own */
export type AgentOwnDto = {
  uuid: string;
  nickname?: string;
  /** The actual state of the online toggle — THE online oracle. */
  online: boolean;
  assignable?: boolean;
};

/** GET /calendar/schedule/for-therapist */
export type AgentScheduleDto = {
  timeZone?: string;
  workPeriods?: Array<{
    /** UTC pair — the one to compare against "now". */
    startTime: string;
    endTime: string;
    /** Agent-timezone pair — never use for coverage checks. */
    startTimeLocal?: string;
    endTimeLocal?: string;
  }>;
};

export type ChatProfileRefDto = {
  /** The identifier assign/classification works with — NOT `uuid`. */
  profileUuid: string;
  uuid?: string;
  nickname?: string;
  firstName?: string;
  lastName?: string;
};

/** Element of GET /talk/chat (Spring page content) and GET /talk/chat/{uuid}. */
export type ChatDto = {
  uuid: string;
  /** Running session of this chat, null while there is none. */
  session?: ChatSessionDto | null;
  userProfile?: ChatProfileRefDto;
  expertProfile?: ChatProfileRefDto;
  /** Absent/empty agentProfile = the chat is unowned. */
  agentProfile?: ChatProfileRefDto | null;
  message?: unknown;
  type?: string;
  status?: string;
};

export type ChatPageDto = {
  content?: ChatDto[];
};

/**
 * Chat message. On READ the text lives in `data`; for incoming user messages
 * `data` may be an auto-translation — the original is always `originalData`.
 * An agent's message goes out under the EXPERT's identity: authorProfileUuid
 * is the expert's profileUuid, agentProfileUuid is the agent's uuid.
 */
export type ChatMessageDto = {
  uuid: string;
  mid?: string;
  data?: string;
  originalData?: string;
  status?: string;
  /** MSG for real messages; MSG_THERAPY_HELLO, COUPON, SESSION_ENDED... are service types. */
  type?: string;
  authorProfileUuid?: string;
  agentProfileUuid?: string;
  delivered?: boolean;
  read?: boolean;
  creationDate?: string;
  action?: {
    type?: string;
    title?: string;
  };
};

export type ChatMessagePageDto = {
  content?: ChatMessageDto[];
};

/** GET /coupon/expert-coupon/all element. */
export type ExpertCouponDto = {
  uuid: string;
  discount?: number;
  type?: string;
};

/** GET /talk/chat/{uuid}/session/current */
export type ChatSessionDto = {
  uuid?: string;
  /** "OPENED" while the session runs, "CLOSED" once the paid minutes are over. */
  status?: string;
  /** Set when the session is over; null while it runs. */
  endDate?: string | null;
};
