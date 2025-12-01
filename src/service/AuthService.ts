import type { WorkOS } from '@workos-inc/node';
import { AuthKitCore } from '../core/AuthKitCore.js';
import type { ConfigurationProvider } from '../core/config/ConfigurationProvider.js';
import type { AuthKitConfig } from '../core/config/types.js';
import { AuthOperations } from '../operations/AuthOperations.js';
import type {
  AuthResult,
  CustomClaims,
  GetAuthorizationUrlOptions,
  HeadersBag,
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
  private _core?: AuthKitCore;
  private _operations?: AuthOperations;
  private readonly storage: SessionStorage<TRequest, TResponse>;
  private readonly config: ConfigurationProvider;
  private readonly clientFactory: (config: AuthKitConfig) => WorkOS;
  private readonly encryptionFactory: (
    config: AuthKitConfig,
  ) => SessionEncryption;

  constructor(
    config: ConfigurationProvider,
    storage: SessionStorage<TRequest, TResponse>,
    clientFactory: (config: AuthKitConfig) => WorkOS,
    encryptionFactory: (config: AuthKitConfig) => SessionEncryption,
  ) {
    this.config = config;
    this.storage = storage;
    this.clientFactory = clientFactory;
    this.encryptionFactory = encryptionFactory;
    // NOTE: core and operations are NOT instantiated here
    // They're created lazily on first access via getters below
  }

  /**
   * Lazy getter for AuthKitCore.
   * Instantiates on first access, allowing config to be set beforehand.
   */
  private get core(): AuthKitCore {
    if (!this._core) {
      const resolvedConfig = this.config.getConfig();
      this._core = new AuthKitCore(
        resolvedConfig,
        this.clientFactory(resolvedConfig),
        this.encryptionFactory(resolvedConfig),
      );
    }
    return this._core;
  }

  /**
   * Lazy getter for AuthOperations.
   * Instantiates on first access, allowing config to be set beforehand.
   */
  private get operations(): AuthOperations {
    if (!this._operations) {
      const resolvedConfig = this.config.getConfig();
      this._operations = new AuthOperations(
        this.core,
        this.clientFactory(resolvedConfig),
        resolvedConfig,
      );
    }
    return this._operations;
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
   * Sign out operation - delegates to AuthOperations.
   */
  async signOut(sessionId: string, options?: { returnTo?: string }) {
    return this.operations.signOut(sessionId, options);
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
  async getAuthorizationUrl(options: GetAuthorizationUrlOptions = {}) {
    return this.operations.getAuthorizationUrl(options);
  }

  /**
   * Convenience: Get sign-in URL.
   */
  async getSignInUrl(
    options: Omit<GetAuthorizationUrlOptions, 'screenHint'> = {},
  ) {
    return this.operations.getSignInUrl(options);
  }

  /**
   * Convenience: Get sign-up URL.
   */
  async getSignUpUrl(
    options: Omit<GetAuthorizationUrlOptions, 'screenHint'> = {},
  ) {
    return this.operations.getSignUpUrl(options);
  }

  /**
   * Get the WorkOS client instance.
   * Useful for direct API calls not covered by AuthKit.
   */
  getWorkOS(): WorkOS {
    return this.clientFactory(this.config.getConfig());
  }

  /**
   * Handle OAuth callback.
   * This creates a new session after successful authentication.
   *
   * @param request - Framework-specific request (not currently used)
   * @param response - Framework-specific response
   * @param options - OAuth callback options (code, state)
   * @returns Updated response, return pathname, and auth response
   */
  async handleCallback(
    _request: TRequest,
    response: TResponse,
    options: { code: string; state?: string },
  ) {
    const clientId = this.config.getValue('clientId');
    const client = this.clientFactory(this.config.getConfig());

    // Authenticate with WorkOS using the OAuth code
    const authResponse = await client.userManagement.authenticateWithCode({
      code: options.code,
      clientId,
    });

    // Create and save the new session
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

    // Decode return pathname from state
    let returnPathname = '/';
    if (options.state) {
      try {
        const decoded = JSON.parse(atob(options.state));
        returnPathname = decoded.returnPathname || '/';
      } catch {
        // Invalid state, use default
      }
    }

    return {
      response: updatedResponse,
      headers,
      returnPathname,
      authResponse,
    };
  }
}
