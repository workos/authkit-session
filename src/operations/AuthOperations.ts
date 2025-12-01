import type { WorkOS } from '@workos-inc/node';
import type { AuthKitCore } from '../core/AuthKitCore.js';
import type { AuthKitConfig } from '../core/config/types.js';
import type {
  AuthResult,
  BaseTokenClaims,
  GetAuthorizationUrlOptions,
  Session,
} from '../core/session/types.js';

/**
 * AuthOperations provides high-level authentication operations.
 *
 * This class orchestrates between AuthKitCore (pure logic) and WorkOS API.
 * It doesn't know about requests, responses, or cookies - that's the framework's job.
 *
 * Responsibilities:
 * - Sign out (generate logout URL + clear cookie header)
 * - Switch organization (refresh with new org + return auth result)
 * - Refresh session (refresh tokens + return auth result)
 * - Get authorization URLs (for sign in/sign up flows)
 */
export class AuthOperations {
  private core: AuthKitCore;
  private client: WorkOS;
  private config: AuthKitConfig;

  constructor(core: AuthKitCore, client: WorkOS, config: AuthKitConfig) {
    this.core = core;
    this.client = client;
    this.config = config;
  }

  /**
   * Sign out operation.
   *
   * Returns the WorkOS logout URL and a cookie clear header string.
   * The framework is responsible for applying the header and redirecting.
   *
   * @param sessionId - The session ID to terminate
   * @param options - Optional return URL
   * @returns Logout URL and clear cookie header
   */
  async signOut(
    sessionId: string,
    options?: { returnTo?: string },
  ): Promise<{
    logoutUrl: string;
    clearCookieHeader: string;
  }> {
    // Generate WorkOS logout URL
    const logoutUrl = this.client.userManagement.getLogoutUrl({
      sessionId,
      returnTo: options?.returnTo,
    });

    // Build cookie clear header
    const cookieName = this.config.cookieName ?? 'wos-session';
    const clearCookieHeader = `${cookieName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=lax`;

    return {
      logoutUrl,
      clearCookieHeader,
    };
  }

  /**
   * Switch to a different organization.
   *
   * This is a convenience wrapper around refreshSession() that enforces
   * an organization ID must be provided.
   *
   * @param session - Current session
   * @param organizationId - Organization ID to switch to (required)
   * @returns Auth result and encrypted session data
   */
  async switchOrganization(
    session: Session,
    organizationId: string,
  ): Promise<{
    auth: AuthResult;
    encryptedSession: string;
  }> {
    // Delegate to refreshSession with explicit organization
    return this.refreshSession(session, organizationId);
  }

  /**
   * Refresh session operation.
   *
   * Calls WorkOS to refresh tokens (optionally switching organizations),
   * encrypts the new session, and returns the auth result.
   *
   * @param session - Current session with refresh token
   * @param organizationId - Optional organization ID to switch to during refresh
   * @returns Auth result and encrypted session data
   */
  async refreshSession(
    session: Session,
    organizationId?: string,
  ): Promise<{
    auth: AuthResult;
    encryptedSession: string;
  }> {
    // Determine which organization to use
    let orgId = organizationId;
    if (!orgId) {
      // Extract org from current token (decodeJwt works even on expired tokens)
      try {
        const claims = this.core.parseTokenClaims<BaseTokenClaims>(
          session.accessToken,
        );
        orgId = claims.org_id;
      } catch {
        // Token too malformed to parse - refresh without org context
        // WorkOS will use whatever org is embedded in the refresh token
      }
    }

    const result = await this.core.refreshTokens(session.refreshToken, orgId);

    const newSession: Session = {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
      impersonator: result.impersonator,
    };

    const encryptedSession = await this.core.encryptSession(newSession);

    const claims = this.core.parseTokenClaims(result.accessToken);

    const auth: AuthResult = {
      user: result.user,
      sessionId: claims.sid,
      impersonator: result.impersonator,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      claims,
    };

    return {
      auth,
      encryptedSession,
    };
  }

  /**
   * Get authorization URL for WorkOS authentication.
   *
   * Builds the WorkOS authorization URL with proper state encoding.
   *
   * @param options - Authorization URL options (returnPathname, screenHint, etc.)
   * @returns The authorization URL
   */
  async getAuthorizationUrl(
    options: GetAuthorizationUrlOptions = {},
  ): Promise<string> {
    return this.client.userManagement.getAuthorizationUrl({
      provider: 'authkit',
      redirectUri: options.redirectUri ?? this.config.redirectUri,
      screenHint: options.screenHint,
      organizationId: options.organizationId,
      loginHint: options.loginHint,
      prompt: options.prompt,
      clientId: this.config.clientId,
      state: options.returnPathname
        ? btoa(JSON.stringify({ returnPathname: options.returnPathname }))
        : undefined,
    });
  }

  /**
   * Convenience method: Get sign-in URL.
   */
  async getSignInUrl(
    options: Omit<GetAuthorizationUrlOptions, 'screenHint'> = {},
  ): Promise<string> {
    return this.getAuthorizationUrl({
      ...options,
      screenHint: 'sign-in',
    });
  }

  /**
   * Convenience method: Get sign-up URL.
   */
  async getSignUpUrl(
    options: Omit<GetAuthorizationUrlOptions, 'screenHint'> = {},
  ): Promise<string> {
    return this.getAuthorizationUrl({
      ...options,
      screenHint: 'sign-up',
    });
  }
}
