export class AuthKitError extends Error {
  data?: Record<string, any>;

  constructor(message: string, cause?: unknown, data?: Record<string, any>) {
    super(message);
    this.name = 'AuthKitError';
    this.cause = cause;
    this.data = data;
  }
}

export class SessionEncryptionError extends AuthKitError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'SessionEncryptionError';
  }
}

export class TokenValidationError extends AuthKitError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'TokenValidationError';
  }
}

export class OAuthStateMismatchError extends AuthKitError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'OAuthStateMismatchError';
  }
}

export class PKCECookieMissingError extends AuthKitError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'PKCECookieMissingError';
  }
}

export class PKCEPayloadTooLargeError extends AuthKitError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'PKCEPayloadTooLargeError';
  }
}

/**
 * Why a token refresh failed. Each reason always comes with the same
 * `retryable` value.
 *
 * Retryable (`retryable: true`), so the session may still be good:
 * - `network_error`: no response came back (DNS failure, connection refused
 *   or reset, `fetch failed`).
 * - `timeout`: the request timed out or was aborted (HTTP 408, `AbortError`,
 *   `TimeoutError`, `ETIMEDOUT`).
 * - `rate_limited`: HTTP 429, including when the one rate-limit retry in
 *   `refreshTokens` also fails.
 * - `server_error`: HTTP 500, 502, 503 or 504, including a response whose
 *   body isn't JSON (such as a load balancer's HTML error page).
 *
 * Terminal (`retryable: false`), so the session is over:
 * - `invalid_grant`: the refresh token is invalid, expired, or already used.
 * - `email_verification_required`, `organization_selection_required`,
 *   `mfa_enrollment`, `mfa_challenge`, `mfa_verification`,
 *   `radar_email_challenge`, `radar_sms_challenge`, `sso_required`: WorkOS
 *   needs the user to complete a step of the sign-in flow.
 * - `http_error`: any other HTTP error status, such as 400, 401, 403 or 501.
 * - `unknown`: an error this package doesn't recognize.
 */
export type RefreshFailureReason =
  | 'network_error'
  | 'timeout'
  | 'rate_limited'
  | 'server_error'
  | 'invalid_grant'
  | AuthenticationErrorReason
  | 'http_error'
  | 'unknown';

type AuthenticationErrorReason =
  | 'email_verification_required'
  | 'organization_selection_required'
  | 'mfa_enrollment'
  | 'mfa_challenge'
  | 'mfa_verification'
  | 'radar_email_challenge'
  | 'radar_sms_challenge'
  | 'sso_required';

/** How a failed token refresh was classified. */
export interface RefreshFailure {
  /**
   * `true` when the failure is likely temporary (network, timeout, 429, 5xx):
   * keep the session cookie and try again on a later request. `false` when
   * the session is over: clear the cookie and sign in again.
   */
  retryable: boolean;
  reason: RefreshFailureReason;
}

export interface TokenRefreshErrorContext {
  userId?: string;
  sessionId?: string;
  /** Defaults to `false`. */
  retryable?: boolean;
  /** Defaults to `'unknown'`. */
  reason?: RefreshFailureReason;
}

export class TokenRefreshError extends AuthKitError {
  readonly userId?: string;
  readonly sessionId?: string;
  readonly retryable: boolean;
  readonly reason: RefreshFailureReason;

  constructor(
    message: string,
    cause?: unknown,
    context?: TokenRefreshErrorContext,
  ) {
    super(message, cause);
    this.name = 'TokenRefreshError';
    this.userId = context?.userId;
    this.sessionId = context?.sessionId;
    this.retryable = context?.retryable ?? false;
    this.reason = context?.reason ?? 'unknown';
  }
}

// The statuses the WorkOS SDK itself retries, matching authkit-nextjs. Other
// 5xx (such as 501) are terminal.
const RETRYABLE_STATUS_REASONS = new Map<number, RefreshFailureReason>([
  [408, 'timeout'],
  [429, 'rate_limited'],
  [500, 'server_error'],
  [502, 'server_error'],
  [503, 'server_error'],
  [504, 'server_error'],
]);

const AUTHENTICATION_ERROR_REASONS: ReadonlySet<string> = new Set([
  'email_verification_required',
  'organization_selection_required',
  'mfa_enrollment',
  'mfa_challenge',
  'mfa_verification',
  'radar_email_challenge',
  'radar_sms_challenge',
  'sso_required',
] satisfies AuthenticationErrorReason[]);

const TIMEOUT_ERROR_NAMES = new Set(['AbortError', 'TimeoutError']);
const TIMEOUT_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);
const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_SOCKET',
]);
// Matched on TypeError messages only, so an unrelated programming TypeError
// isn't treated as a network failure. Same pattern as authkit-nextjs.
const NETWORK_ERROR_MESSAGE =
  /fetch failed|failed to fetch|network|load failed|terminated/i;

type ErrorShape = {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  rawStatus?: unknown;
  code?: unknown;
  error?: unknown;
  rawData?: unknown;
  cause?: unknown;
};

function asShape(value: unknown): ErrorShape | undefined {
  return typeof value === 'object' && value !== null
    ? (value as ErrorShape)
    : undefined;
}

const MAX_CAUSE_DEPTH = 10;

/** The error and its `cause`s, stopping at a cycle or after 10 links. */
function* causeChain(error: unknown): Generator<ErrorShape> {
  const seen = new Set<ErrorShape>();
  for (
    let current = asShape(error);
    current && !seen.has(current) && seen.size < MAX_CAUSE_DEPTH;
    current = asShape(current.cause)
  ) {
    seen.add(current);
    yield current;
  }
}

function httpStatusOf(error: unknown): number | undefined {
  const status = asShape(error)?.status;
  if (typeof status === 'number') {
    return status;
  }
  // The SDK wraps a response whose body isn't JSON (such as a load
  // balancer's HTML 502 page) in a plain Error, with the real status on the
  // cause's `rawStatus`. authkit-nextjs doesn't look there.
  for (const link of causeChain(error)) {
    if (typeof link.rawStatus === 'number') {
      return link.rawStatus;
    }
  }
  return undefined;
}

/**
 * Classify an error thrown by `authenticateWithRefreshToken`.
 *
 * Works from the error's shape (`status`, `error`/`code` strings, `rawData`,
 * `name`, and the `cause` chain) rather than `instanceof`, because exception
 * classes differ across the supported `@workos-inc/node` majors (v8 has no
 * `AuthenticationException`, for example). Anything unrecognized is terminal,
 * as in authkit-nextjs. Unlike authkit-nextjs, a status that is only on a
 * cause's `rawStatus` (a non-JSON error response) also counts.
 */
export function classifyRefreshFailure(error: unknown): RefreshFailure {
  const shape = asShape(error);
  const rawData = asShape(shape?.rawData);

  for (const value of [
    shape?.error,
    shape?.code,
    rawData?.error,
    rawData?.code,
  ]) {
    if (value === 'invalid_grant') {
      return { retryable: false, reason: 'invalid_grant' };
    }
    if (typeof value === 'string' && AUTHENTICATION_ERROR_REASONS.has(value)) {
      return {
        retryable: false,
        reason: value as AuthenticationErrorReason,
      };
    }
  }

  const status = httpStatusOf(error);
  const statusReason =
    status === undefined ? undefined : RETRYABLE_STATUS_REASONS.get(status);
  if (statusReason) {
    return { retryable: true, reason: statusReason };
  }

  const transportReason = classifyTransportFailure(error);
  if (transportReason) {
    return { retryable: true, reason: transportReason };
  }

  if (status !== undefined && status >= 400) {
    return { retryable: false, reason: 'http_error' };
  }

  return { retryable: false, reason: 'unknown' };
}

/**
 * Look through the error and its `cause` chain for a timeout or network
 * failure. The WorkOS SDK wraps a raw fetch `TypeError` in a plain `Error`
 * whose `cause` is the original, and Node puts codes like `ECONNRESET` on a
 * nested cause.
 */
function classifyTransportFailure(
  error: unknown,
): 'timeout' | 'network_error' | undefined {
  let reason: 'network_error' | undefined;
  for (const { name, code, message } of causeChain(error)) {
    if (
      (typeof name === 'string' && TIMEOUT_ERROR_NAMES.has(name)) ||
      (typeof code === 'string' && TIMEOUT_ERROR_CODES.has(code))
    ) {
      return 'timeout';
    }
    if (
      (name === 'TypeError' &&
        typeof message === 'string' &&
        NETWORK_ERROR_MESSAGE.test(message)) ||
      (typeof code === 'string' && NETWORK_ERROR_CODES.has(code))
    ) {
      reason = 'network_error';
    }
  }
  return reason;
}
