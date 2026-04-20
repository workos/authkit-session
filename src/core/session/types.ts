import type { Impersonator, User } from '@workos-inc/node';
import type { JWTPayload } from 'jose';

export interface BaseTokenClaims extends JWTPayload {
  sid: string;
  org_id?: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
  entitlements?: string[];
  feature_flags?: string[];
}

export type CustomClaims = Record<string, unknown>;

/**
 * Authentication result - discriminated union based on user presence.
 *
 * TypeScript can narrow this type by checking if user is null:
 *
 * @example
 * ```typescript
 * const { auth } = await authService.withAuth(request);
 *
 * if (!auth.user) {
 *   // auth is { user: null }
 *   return redirect('/login');
 * }
 *
 * // TypeScript knows: auth.user exists, so sessionId, accessToken, etc. also exist
 * console.log(auth.sessionId);  // ← No ! needed, TypeScript knows it's string
 * ```
 */
export type AuthResult<TCustomClaims = Record<string, unknown>> =
  | {
      user: null;
    }
  | {
      user: User;
      sessionId: string;
      accessToken: string;
      refreshToken: string;
      claims: BaseTokenClaims & TCustomClaims;
      organizationId?: string;
      role?: string;
      roles?: string[];
      permissions?: string[];
      entitlements?: string[];
      featureFlags?: string[];
      impersonator?: Impersonator;
    };

/**
 * AuthKit Session
 */
export interface Session {
  /**
   * The session access token
   */
  accessToken: string;
  /**
   * The session refresh token - used to refresh the access token
   */
  refreshToken: string;
  /**
   * The logged-in user
   */
  user: User;
  /**
   * The impersonator user, if any
   */
  impersonator?: Impersonator;
}

/**
 * Map of HTTP response headers.
 *
 * `Set-Cookie` MUST be represented as `string[]` when multiple values exist
 * — adapters must append each entry as its own header, never comma-join.
 * A comma-joined `Set-Cookie` string is not a valid single HTTP header.
 */
export type HeadersBag = Record<string, string | string[]>;

export interface SessionStorage<TRequest, TResponse, TOptions = unknown> {
  /**
   * Read a named cookie from a request.
   * @param request Framework-specific request object.
   * @param name Cookie name.
   * @returns The cookie value or null if absent.
   */
  getCookie(request: TRequest, name: string): Promise<string | null>;

  /**
   * Write a named cookie to a response.
   * @param response Framework-specific response object (or undefined to emit headers only).
   * @param name Cookie name.
   * @param value Cookie value (will be URL-encoded).
   * @param options Per-call cookie options.
   */
  setCookie(
    response: TResponse | undefined,
    name: string,
    value: string,
    options: CookieOptions,
  ): Promise<{ response?: TResponse; headers?: HeadersBag }>;

  /**
   * Clear a named cookie by emitting a Set-Cookie with Max-Age=0.
   * @param response Framework-specific response object (or undefined to emit headers only).
   * @param name Cookie name.
   * @param options Cookie options (must match those used at set time, especially `path`).
   */
  clearCookie(
    response: TResponse | undefined,
    name: string,
    options: CookieOptions,
  ): Promise<{ response?: TResponse; headers?: HeadersBag }>;

  /*
   * Extract session data from a request object
   * @param request the framework-specific request object.
   * @returns The encrypted session string or null if no session exists.
   */
  getSession(request: TRequest): Promise<string | null>;

  /**
   * Save session data to a response object.
   * @param response The framework-specific response object.
   * @param sessionData The encrypted session string.
   * @param options Optional cookie options.
   * @returns The framework-specific response object with the session cookie set.
   */
  saveSession(
    response: TResponse | undefined,
    sessionData: string,
    options?: TOptions,
  ): Promise<{ response?: TResponse; headers?: HeadersBag }>;

  /**
   * @param response The frmework-specific response object.
   * @returns The framework-specific response object with the session cookie removed.
   */
  clearSession(
    response: TResponse | undefined,
    options?: TOptions,
  ): Promise<{ response?: TResponse; headers?: HeadersBag }>;
}

export interface SessionEncryption {
  sealData: (
    data: unknown,
    options: {
      password: string;
      ttl?: number | undefined;
    },
  ) => Promise<string>;
  unsealData: <T>(
    encryptedData: string,
    options: {
      password: string;
      ttl?: number | undefined;
    },
  ) => Promise<T>;
}

/**
 * Result shape returned by `createAuthorization` / `createSignIn` / `createSignUp`.
 *
 * The verifier cookie is written internally via `SessionStorage.setCookie` — callers
 * only need to redirect the browser to `url` and apply any returned `headers`/`response`.
 */
export interface GetAuthorizationUrlResult {
  url: string;
}

export type CreateAuthorizationResult<TResponse> = GetAuthorizationUrlResult & {
  response?: TResponse;
  headers?: HeadersBag;
};

export interface CookieOptions {
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  priority?: 'low' | 'medium' | 'high';
  partitioned?: boolean;
}

/**
 * Options for generating authorization URLs
 */
export interface AuthUrlOptions {
  returnPathname?: string;
  redirectUri?: string;
  organizationId?: string;
  loginHint?: string;
  prompt?: 'login' | 'none' | 'consent' | 'select_account';
  /** Custom state to pass through the OAuth flow. Returned in handleCallback. */
  state?: string;
}

/**
 * Options for `createAuthorization` / `createSignIn` / `createSignUp`,
 * including the `screenHint` selector used by the sign-in/sign-up variants.
 */
export interface GetAuthorizationUrlOptions extends AuthUrlOptions {
  screenHint?: 'sign-up' | 'sign-in';
}
