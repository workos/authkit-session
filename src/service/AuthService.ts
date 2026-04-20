import type { WorkOS } from '@workos-inc/node';
import { AuthKitCore } from '../core/AuthKitCore.js';
import type { AuthKitConfig } from '../core/config/types.js';
import {
  getPKCECookieOptions,
  PKCE_COOKIE_NAME,
} from '../core/pkce/cookieOptions.js';
import { AuthOperations } from '../operations/AuthOperations.js';
import type {
  AuthResult,
  CustomClaims,
  GetAuthorizationUrlOptions,
  GetAuthorizationUrlResult,
  HeadersBag,
  Session,
  SessionEncryption,
  SessionStorage,
} from '../core/session/types.js';

/**
 * Merge two `HeadersBag` values. `Set-Cookie` matching is case-insensitive;
 * existing key casing is preserved. Multiple `Set-Cookie` values are
 * concatenated into a `string[]`. Other keys are shallow-merged (second wins).
 */
function mergeHeaderBags(
  a: HeadersBag | undefined,
  b: HeadersBag | undefined,
): HeadersBag | undefined {
  if (!a) return b;
  if (!b) return a;
  const merged: HeadersBag = { ...a };
  let setCookieKey = Object.keys(merged).find(
    k => k.toLowerCase() === 'set-cookie',
  );
  for (const [key, value] of Object.entries(b)) {
    if (key.toLowerCase() !== 'set-cookie') {
      merged[key] = value;
      continue;
    }
    if (!setCookieKey) {
      merged[key] = value;
      setCookieKey = key;
      continue;
    }
    const left = merged[setCookieKey]!;
    const leftArr = Array.isArray(left) ? left : [left];
    const rightArr = Array.isArray(value) ? value : [value];
    merged[setCookieKey] = [...leftArr, ...rightArr];
  }
  return merged;
}

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
 * - `signOut()`, `createSignIn()`, etc. - Delegate to AuthOperations
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
   * Create an authorization URL and write the PKCE verifier cookie.
   *
   * @param response - Framework-specific response object (may be undefined —
   *   adapters that mutate responses in-place will get back a mutated copy).
   * @param options - screenHint, returnPathname, custom state, redirectUri, etc.
   * @returns The URL to redirect the browser to, plus storage's
   *   `{ response?, headers? }` carrying the verifier `Set-Cookie`.
   */
  async createAuthorization(
    response: TResponse | undefined,
    options: GetAuthorizationUrlOptions = {},
  ): Promise<
    GetAuthorizationUrlResult & { response?: TResponse; headers?: HeadersBag }
  > {
    const { url, sealedState, cookieOptions } =
      await this.operations.createAuthorization(options);
    const write = await this.storage.setCookie(
      response,
      PKCE_COOKIE_NAME,
      sealedState,
      cookieOptions,
    );
    return { url, ...write };
  }

  /**
   * Convenience: Create sign-in URL and write the PKCE verifier cookie.
   */
  async createSignIn(
    response: TResponse | undefined,
    options: Omit<GetAuthorizationUrlOptions, 'screenHint'> = {},
  ): Promise<
    GetAuthorizationUrlResult & { response?: TResponse; headers?: HeadersBag }
  > {
    return this.createAuthorization(response, {
      ...options,
      screenHint: 'sign-in',
    });
  }

  /**
   * Convenience: Create sign-up URL and write the PKCE verifier cookie.
   */
  async createSignUp(
    response: TResponse | undefined,
    options: Omit<GetAuthorizationUrlOptions, 'screenHint'> = {},
  ): Promise<
    GetAuthorizationUrlResult & { response?: TResponse; headers?: HeadersBag }
  > {
    return this.createAuthorization(response, {
      ...options,
      screenHint: 'sign-up',
    });
  }

  /**
   * Emit a `Set-Cookie` header that clears the PKCE verifier cookie.
   *
   * Use on any exit path where a sign-in was started (verifier cookie
   * written) but `handleCallback` will not run to clear it — OAuth error
   * responses, missing `code`, early bail-outs.
   */
  async clearPendingVerifier(
    response: TResponse | undefined,
  ): Promise<{ response?: TResponse; headers?: HeadersBag }> {
    return this.storage.clearCookie(
      response,
      PKCE_COOKIE_NAME,
      getPKCECookieOptions(this.config),
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
   * Reads the verifier cookie via storage, verifies it against the URL
   * `state`, exchanges the code, saves the session, and — on success —
   * also emits a verifier-delete `Set-Cookie` so `HeadersBag['Set-Cookie']`
   * carries both entries as a `string[]`. Adapters MUST append each
   * `Set-Cookie` as its own header (never comma-join).
   */
  async handleCallback(
    request: TRequest,
    response: TResponse,
    options: {
      code: string;
      state: string | undefined;
    },
  ) {
    const cookieValue = await this.storage.getCookie(request, PKCE_COOKIE_NAME);
    const { codeVerifier, returnPathname, customState } =
      await this.core.verifyCallbackState({
        stateFromUrl: options.state,
        cookieValue: cookieValue ?? undefined,
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
    const save = await this.storage.saveSession(response, encryptedSession);
    const clear = await this.storage.clearCookie(
      save.response ?? response,
      PKCE_COOKIE_NAME,
      getPKCECookieOptions(this.config),
    );

    return {
      response: clear.response ?? save.response,
      headers: mergeHeaderBags(save.headers, clear.headers),
      returnPathname: returnPathname ?? '/',
      state: customState,
      authResponse,
    };
  }
}
