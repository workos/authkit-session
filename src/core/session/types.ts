import type { Impersonator, User } from '@workos-inc/node';
import type { CookieOptions } from '../../cookie';
import type { JWTPayload } from 'jose';

export interface BaseTokenClaims extends JWTPayload {
  sid: string;
  org_id?: string;
  role?: string;
  permissions?: string[];
  entitlements?: string[];
}

export type CustomClaims = Record<string, unknown>;

export interface AuthResult<TCustomClaims = Record<string, unknown>> {
  user?: User | null;
  claims?: BaseTokenClaims & TCustomClaims;
  impersonator?: Impersonator;
  accessToken?: string;
  sessionId?: string;
}

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

export interface SessionStorage<TRequest, TResponse> {
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
    response: TResponse,
    sessionData: string,
    options?: CookieOptions,
  ): Promise<TResponse>;

  /**
   * @param response The frmework-specific response object.
   * @returns The framework-specific response object with the session cookie removed.
   */
  clearSession(response: TResponse): Promise<TResponse>;
}
