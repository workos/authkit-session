import type { WorkOS } from '@workos-inc/node';
import { AuthKitCore } from '../core/AuthKitCore.js';
import type { AuthKitConfig } from '../core/config/types.js';
import {
  getPKCECookieOptions,
  serializePKCESetCookie,
} from '../core/pkce/cookieOptions.js';
import { AuthOperations } from '../operations/AuthOperations.js';
import type {
  AuthResult,
  CustomClaims,
  GetAuthorizationUrlOptions,
  GetAuthorizationUrlResult,
  HeadersBag,
  PKCECookieOptions,
  Session,
  SessionEncryption,
  SessionStorage,
} from '../core/session/types.js';

/**
 * Framework-agnostic authentication service.
 *
 * Coordinates between:
 * - AuthKitCore (pure business logic: crypto, JWT, refresh)
 * - AuthOperations (WorkOS API operations: signOut, refreshSession, URLs)
 * - SessionStorage<TRequest, TResponse> (framework-specific storage)
 *
 * Provides common patterns:
 * - `withAuth()` - Validate session with auto-refresh
 * - `handleCallback()` - Process OAuth callback
 * - `signOut()`, `getSignInUrl()`, etc. - Delegate to AuthOperations
 *
 * **Used by:** @workos/authkit-tanstack-react-start
 */
export class AuthService<TRequest, TResponse> {
  private readonly core: AuthKitCore;
  private readonly operations: AuthOperations;
  private readonly storage: SessionStorage<TRequest, TResponse>;
  private readonly config: AuthKitConfig;
  private readonly client: WorkOS;

  constructor(
    config: AuthKitConfig,
    storage: SessionStorage<TRequest, TResponse>,
    client: WorkOS,
    encryption: SessionEncryption,
  ) {
    this.config = config;
    this.storage = storage;
    this.client = client;
    this.core = new AuthKitCore(config, client, encryption);
    this.operations = new AuthOperations(this.core, client, config, encryption);
  }

  /**
   * Main authentication check method.
   *
   * This method:
   * 1. Reads encrypted session from request (via storage)
   * 2. Validates and potentially refreshes the session (via core)
   * 3. Returns auth result + optionally refreshed session data
   *
   * @param request - Framework-specific request object
   * @returns Auth result and optional refreshed session data
   */
  async withAuth<TCustomClaims = CustomClaims>(
    request: TRequest,
  ): Promise<{
    auth: AuthResult<TCustomClaims>;
    refreshedSessionData?: string;
  }> {
    try {
      const encryptedSession = await this.storage.getSession(request);
      if (!encryptedSession) {
        return { auth: { user: null } };
      }

      const { claims, session, refreshed } =
        await this.core.validateAndRefresh<TCustomClaims>(
          await this.core.decryptSession(encryptedSession),
        );

      const auth: AuthResult<TCustomClaims> = {
        refreshToken: session.refreshToken,
        user: session.user,
        claims,
        impersonator: session.impersonator,
        accessToken: session.accessToken,
        sessionId: claims.sid,
        organizationId: claims.org_id,
        role: claims.role,
        roles: claims.roles,
        permissions: claims.permissions,
        entitlements: claims.entitlements,
        featureFlags: claims.feature_flags,
      };

      if (refreshed) {
        const refreshedSessionData = await this.core.encryptSession(session);
        return { auth, refreshedSessionData };
      }

      return { auth };
    } catch {
      return { auth: { user: null } };
    }
  }

  /**
   * Get a session from a request.
   *
   * @param request - Framework-specific request object
   * @returns Decrypted session or null
   */
  async getSession(request: TRequest): Promise<Session | null> {
    const encryptedSession = await this.storage.getSession(request);
    if (!encryptedSession) {
      return null;
    }
    return this.core.decryptSession(encryptedSession);
  }

  /**
   * Save a session to storage.
   *
   * @param response - Framework-specific response object (may be undefined)
   * @param sessionData - Encrypted session string
   * @returns Updated response and/or headers
   */
  async saveSession(
    response: TResponse | undefined,
    sessionData: string,
  ): Promise<{ response?: TResponse; headers?: HeadersBag }> {
    return this.storage.saveSession(response, sessionData);
  }

  /**
   * Clear a session from storage.
   *
   * @param response - Framework-specific response object
   * @returns Updated response and/or headers
   */
  async clearSession(
    response: TResponse,
  ): Promise<{ response?: TResponse; headers?: HeadersBag }> {
    return this.storage.clearSession(response);
  }

  /**
   * Sign out operation.
   *
   * Gets the WorkOS logout URL and clears the session via storage.
   * Returns the URL plus whatever the storage returns (headers and/or response).
   *
   * @param sessionId - The session ID to terminate
   * @param options - Optional return URL
   * @returns Logout URL and storage clear result (headers and/or response)
   */
  async signOut(
    sessionId: string,
    options?: { returnTo?: string },
  ): Promise<{
    logoutUrl: string;
    response?: TResponse;
    headers?: HeadersBag;
  }> {
    const logoutUrl = this.operations.getLogoutUrl(sessionId, options);
    const clearResult = await this.storage.clearSession(undefined);
    return { logoutUrl, ...clearResult };
  }

  /**
   * Switch organization - delegates to AuthOperations.
   */
  async switchOrganization(session: Session, organizationId: string) {
    return this.operations.switchOrganization(session, organizationId);
  }

  /**
   * Refresh session - delegates to AuthOperations.
   */
  async refreshSession(session: Session, organizationId?: string) {
    return this.operations.refreshSession(session, organizationId);
  }

  /**
   * Get authorization URL - delegates to AuthOperations.
   */
  async getAuthorizationUrl(
    options: GetAuthorizationUrlOptions = {},
  ): Promise<GetAuthorizationUrlResult> {
    return this.operations.getAuthorizationUrl(options);
  }

  /**
   * Convenience: Get sign-in URL.
   */
  async getSignInUrl(
    options: Omit<GetAuthorizationUrlOptions, 'screenHint'> = {},
  ): Promise<GetAuthorizationUrlResult> {
    return this.operations.getSignInUrl(options);
  }

  /**
   * Convenience: Get sign-up URL.
   */
  async getSignUpUrl(
    options: Omit<GetAuthorizationUrlOptions, 'screenHint'> = {},
  ): Promise<GetAuthorizationUrlResult> {
    return this.operations.getSignUpUrl(options);
  }

  /**
   * Get PKCE verifier cookie options for the given redirect URI.
   *
   * Thin delegator so adapters never need to read raw config keys. Equivalent
   * to calling the exported `getPKCECookieOptions(config, redirectUri)`.
   */
  getPKCECookieOptions(redirectUri?: string): PKCECookieOptions {
    return getPKCECookieOptions(this.config, redirectUri);
  }

  /**
   * Build a ready-to-emit `Set-Cookie` header that deletes the
   * `wos-auth-verifier` cookie. Adapters typically compute this once at the
   * top of their callback handler and append it on every exit path.
   */
  buildPKCEDeleteCookieHeader(redirectUri?: string): string {
    return serializePKCESetCookie(
      getPKCECookieOptions(this.config, redirectUri),
      '',
      { expired: true },
    );
  }

  /**
   * Get the WorkOS client instance.
   * Useful for direct API calls not covered by AuthKit.
   */
  getWorkOS(): WorkOS {
    return this.client;
  }

  /**
   * Handle OAuth callback.
   *
   * Verifies the PKCE state cookie against the URL state, extracts the
   * sealed `codeVerifier`, exchanges the code, and creates a new session.
   *
   * `cookieValue` is `string | undefined` (not optional) to force every
   * adapter to explicitly pass what they read from the request — silent
   * omission would be a bug.
   */
  async handleCallback(
    _request: TRequest,
    response: TResponse,
    options: {
      code: string;
      state: string | undefined;
      cookieValue: string | undefined;
    },
  ) {
    const { codeVerifier, returnPathname, customState } =
      await this.core.verifyCallbackState({
        stateFromUrl: options.state,
        cookieValue: options.cookieValue,
      });

    const authResponse = await this.client.userManagement.authenticateWithCode({
      code: options.code,
      clientId: this.config.clientId,
      codeVerifier,
    });

    const session: Session = {
      accessToken: authResponse.accessToken,
      refreshToken: authResponse.refreshToken,
      user: authResponse.user,
      impersonator: authResponse.impersonator,
    };

    const encryptedSession = await this.core.encryptSession(session);
    const { response: updatedResponse, headers } = await this.saveSession(
      response,
      encryptedSession,
    );

    return {
      response: updatedResponse,
      headers,
      returnPathname: returnPathname ?? '/',
      state: customState,
      authResponse,
    };
  }
}
