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

export type HeadersBag = Record<string, string | string[]>;

export interface SessionStorage<TRequest, TResponse, TOptions = unknown> {
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
 * Cookie options for the PKCE verifier cookie (`wos-auth-verifier`).
 *
 * Shape is intentionally narrower than the generic `CookieOptions`:
 * - `name` and `maxAge` are literal types — the contract hardcodes them.
 * - `sameSite` excludes `'strict'` — the strict→lax downgrade happens at
 *   construction time so the browser can send the cookie on the cross-site
 *   redirect back from WorkOS.
 * - `httpOnly` is a literal `true` — no way to accidentally construct PKCE
 *   options without it.
 */
export interface PKCECookieOptions {
  name: 'wos-auth-verifier';
  path: '/';
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax' | 'none';
  maxAge: 600;
  domain?: string;
}

/**
 * Result shape returned by `getAuthorizationUrl` / `getSignInUrl` / `getSignUpUrl`.
 *
 * Adapters set a cookie with `sealedState` as the value using `cookieOptions`,
 * then redirect the browser to `url`. On callback, adapters read the cookie
 * and pass both it and the URL's `state` param to `handleCallback`.
 */
export interface GetAuthorizationUrlResult {
  url: string;
  sealedState: string;
  cookieOptions: PKCECookieOptions;
}

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
 * Options for getAuthorizationUrl, including screenHint
 */
export interface GetAuthorizationUrlOptions extends AuthUrlOptions {
  screenHint?: 'sign-up' | 'sign-in';
}
