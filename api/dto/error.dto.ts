/**
 * PsychicBook error envelopes. The stage API answers with THREE different
 * shapes and the HTTP status carries no domain meaning, so negative oracles
 * must be built on the domain code, never on the bare status code.
 */

/** A. Domain envelope (CommonErrorDetail) — HTTP is almost always 400. */
export type DomainErrorDto = {
  title?: string;
  /** Domain code (3060, 3109, …) — NOT the HTTP status. */
  status: number;
  detail?: string;
  /** "d.<code>" — the reliable marker of the domain envelope. */
  detailMessage?: string;
  data?: unknown;
  cause?: unknown;
  timestamp?: number;
  exception?: string;
  method?: string;
  requestedPath?: string;
};

/** B. Spring Boot default envelope (parse/route/method errors). */
export type SpringErrorDto = {
  timestamp: string;
  status: number;
  error: string;
  message?: string;
  path: string;
};

/** C. Spring Security envelope (403 access_denied). */
export type SecurityErrorDto = {
  error: string;
  error_description?: string;
};

/** Known domain codes used by the ported cases. */
export const DomainCode = {
  ACCOUNT_NOT_REGISTERED: 3060,
  USER_DATA_NOT_VALID: 3109
} as const;

/**
 * Extracts the domain code when (and only when) the body is the domain
 * envelope. `detailMessage` ("d.NNNN") is not reliable — 3109 ships it as
 * null — so the discriminator is the `status` value itself: domain codes are
 * four-digit (≥1000) while the Spring envelope carries an HTTP status ≤599.
 */
export function domainCode(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  const candidate = body as Partial<DomainErrorDto>;
  return typeof candidate.status === 'number' && candidate.status >= 1000 ? candidate.status : undefined;
}
