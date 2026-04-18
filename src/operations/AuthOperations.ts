import type { WorkOS } from '@workos-inc/node';
import type { AuthKitCore } from '../core/AuthKitCore.js';
import type { AuthKitConfig } from '../core/config/types.js';
import {
  type GeneratedAuthorizationUrl,
  generateAuthorizationUrl,
} from '../core/pkce/generateAuthorizationUrl.js';
import type {
  AuthResult,
  GetAuthorizationUrlOptions,
  Session,
  SessionEncryption,
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
  private encryption: SessionEncryption;

  constructor(
    core: AuthKitCore,
    client: WorkOS,
    config: AuthKitConfig,
    encryption: SessionEncryption,
  ) {
    this.core = core;
    this.client = client;
    this.config = config;
    this.encryption = encryption;
  }

  /**
   * Get the WorkOS logout URL.
   *
   * This only handles the WorkOS API part. Session clearing is handled
   * by the storage layer in AuthService.
   *
   * @param sessionId - The session ID to terminate
   * @param options - Optional return URL
   * @returns Logout URL
   */
  getLogoutUrl(sessionId: string, options?: { returnTo?: string }): string {
    return this.client.userManagement.getLogoutUrl({
      sessionId,
      returnTo: options?.returnTo,
    });
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
   * Forces a token refresh (for org switching or manual refresh),
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
    // Force refresh via core, optionally switching organizations
    const { session: newSession, claims } = await this.core.validateAndRefresh(
      session,
      { force: true, organizationId },
    );

    const encryptedSession = await this.core.encryptSession(newSession);

    const auth: AuthResult = {
      user: newSession.user,
      sessionId: claims.sid,
      impersonator: newSession.impersonator,
      accessToken: newSession.accessToken,
      refreshToken: newSession.refreshToken,
      claims,
      organizationId: claims.org_id,
      role: claims.role,
      roles: claims.roles,
      permissions: claims.permissions,
      entitlements: claims.entitlements,
      featureFlags: claims.feature_flags,
    };

    return {
      auth,
      encryptedSession,
    };
  }

  /**
   * Create a PKCE-bound WorkOS authorization URL.
   *
   * Returns the URL, the sealed state blob (to be used as both the cookie
   * value and — already present in the URL — the OAuth `state` param), and
   * the cookie options the verifier cookie should be written with.
   * AuthService dispatches the write via `SessionStorage.setCookie`.
   *
   * @param options - returnPathname, screenHint, custom state, redirectUri, etc.
   */
  async createAuthorization(
    options: GetAuthorizationUrlOptions = {},
  ): Promise<GeneratedAuthorizationUrl> {
    return generateAuthorizationUrl({
      client: this.client,
      config: this.config,
      encryption: this.encryption,
      options,
    });
  }

  /**
   * Convenience method: Create sign-in authorization URL.
   */
  async createSignIn(
    options: Omit<GetAuthorizationUrlOptions, 'screenHint'> = {},
  ): Promise<GeneratedAuthorizationUrl> {
    return this.createAuthorization({
      ...options,
      screenHint: 'sign-in',
    });
  }

  /**
   * Convenience method: Create sign-up authorization URL.
   */
  async createSignUp(
    options: Omit<GetAuthorizationUrlOptions, 'screenHint'> = {},
  ): Promise<GeneratedAuthorizationUrl> {
    return this.createAuthorization({
      ...options,
      screenHint: 'sign-up',
    });
  }
}
