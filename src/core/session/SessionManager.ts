import type { ConfigurationProvider } from '../config/ConfigurationProvider.js';
import {
  AuthKitError,
  SessionEncryptionError,
  TokenRefreshError,
} from '../errors.js';
import type { AuthenticationResponse } from '../client/types.js';
import type { TokenManager } from './TokenManager.js';
import type {
  AuthResult,
  CustomClaims,
  HeadersBag,
  Session,
  SessionStorage,
} from './types.js';
import type { SessionEncryption } from './types.js';
import type { WorkOS } from '@workos-inc/node';

export class SessionManager<TRequest, TResponse> {
  private readonly config: ConfigurationProvider;
  private readonly storage: SessionStorage<TRequest, TResponse>;
  private readonly tokenManager: TokenManager;
  private readonly client: WorkOS;
  private readonly encryption: SessionEncryption;

  constructor(
    config: ConfigurationProvider,
    storage: SessionStorage<TRequest, TResponse>,
    tokenManager: TokenManager,
    client: WorkOS,
    encryption: SessionEncryption,
  ) {
    this.config = config;
    this.storage = storage;
    this.tokenManager = tokenManager;
    this.client = client;
    this.encryption = encryption;
  }

  private async encryptSession(session: Session): Promise<string> {
    try {
      const password = this.config.getValue('cookiePassword');
      // const encryptedSession = await sealData(session, { password });
      const encryptedSession = await this.encryption.sealData(session, {
        password,
        ttl: 0,
      });
      return encryptedSession;
    } catch (error) {
      throw new SessionEncryptionError('Failed to encrypt session', error);
    }
  }

  private async decryptSession(encryptedSession: string): Promise<Session> {
    try {
      const password = this.config.getValue('cookiePassword');
      const session = await this.encryption.unsealData<Session>(
        encryptedSession,
        { password },
      );
      return session;
    } catch (error) {
      throw new SessionEncryptionError('Failed to decrypt session', error);
    }
  }

  async getSession(request: TRequest): Promise<Session | null> {
    const encryptedSession = await this.storage.getSession(request);
    if (!encryptedSession) {
      return null;
    }
    return this.decryptSession(encryptedSession);
  }

  private async validateSession<TCustomClaims = CustomClaims>(
    encryptedSession: string,
  ) {
    try {
      const session = await this.decryptSession(encryptedSession);
      const isValid = await this.tokenManager.verifyToken(session.accessToken);
      const isExpiring = this.tokenManager.isTokenExpiring(session.accessToken);

      // Token is valid and not expiring - return immediately
      if (isValid && !isExpiring) {
        const claims = this.tokenManager.parseTokenClaims<TCustomClaims>(
          session.accessToken,
        );
        return {
          valid: true,
          session,
          claims,
        };
      }

      // Token needs refresh
      try {
        const refreshResult = await this.refreshSession<TCustomClaims>(session);
        return {
          valid: true,
          session: refreshResult.session,
          claims: refreshResult.claims,
        };
      } catch (refreshError) {
        return {
          valid: false,
          error:
            refreshError instanceof Error
              ? refreshError
              : new TokenRefreshError(
                  'Failed to refresh session',
                  refreshError,
                ),
        };
      }
    } catch (decryptError) {
      return {
        valid: false,
        error:
          decryptError instanceof Error
            ? decryptError
            : new AuthKitError('Failed to decrypt session', decryptError),
      };
    }
  }

  async withAuth<TCustomClaims = CustomClaims>(
    request: TRequest,
  ): Promise<AuthResult<TCustomClaims>> {
    const encryptedSession = await this.storage.getSession(request);

    if (!encryptedSession) {
      return { user: null };
    }

    const { valid, session, claims } =
      await this.validateSession<TCustomClaims>(encryptedSession);

    if (!valid || !session || !claims) {
      return { user: null };
    }

    return {
      user: session.user,
      sessionId: claims.sid,
      impersonator: session.impersonator,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken, // TODO should this be here?
      claims,
    };
  }

  async refreshSession<TCustomClaims = CustomClaims>(
    session: Session,
    organizationId?: string,
  ) {
    try {
      const currentClaims = this.tokenManager.parseTokenClaims(
        session.accessToken,
      );
      const refreshResponse =
        await this.client.userManagement.authenticateWithRefreshToken({
          refreshToken: session.refreshToken,
          clientId: this.config.getValue('clientId'),
          organizationId: organizationId ?? currentClaims.org_id,
        });

      const newSession: Session = {
        accessToken: refreshResponse.accessToken,
        refreshToken: refreshResponse.refreshToken,
        user: refreshResponse.user,
        impersonator: refreshResponse.impersonator,
      };

      const sessionData = await this.encryptSession(newSession);

      const claims = this.tokenManager.parseTokenClaims<TCustomClaims>(
        newSession.accessToken,
      );

      return {
        user: newSession.user,
        sessionId: claims.sid,
        organizationId: claims.org_id,
        role: claims.role,
        roles: claims.roles,
        permissions: claims.permissions,
        entitlements: claims.entitlements,
        impersonator: newSession.impersonator,
        accessToken: newSession.accessToken,
        claims,
        sessionData,
        session: newSession,
      };
    } catch (error) {
      throw new TokenRefreshError('Failed to refresh session', error);
    }
  }

  async getAuthorizationUrl({
    returnPathname,
    redirectUri,
    screenHint,
    organizationId,
    loginHint,
    prompt,
  }: {
    returnPathname?: string;
    redirectUri?: string;
    screenHint?: 'sign-up' | 'sign-in';
    organizationId?: string;
    loginHint?: string;
    prompt?: 'login' | 'none' | 'consent' | 'select_account';
  } = {}): Promise<string> {
    return this.client.userManagement.getAuthorizationUrl({
      provider: 'authkit',
      redirectUri: redirectUri ?? this.config.getValue('redirectUri'),
      screenHint,
      organizationId,
      loginHint,
      prompt,
      clientId: this.config.getValue('clientId'),
      state: returnPathname
        ? btoa(JSON.stringify({ returnPathname }))
        : undefined,
    });
  }

  async createSession(
    authResponse: AuthenticationResponse,
    response: TResponse | undefined,
  ): Promise<{ response?: TResponse; headers?: HeadersBag }> {
    const { accessToken, refreshToken, user, impersonator } = authResponse;
    if (!accessToken || !refreshToken) {
      throw new AuthKitError('Missing access or refresh token');
    }

    const session: Session = {
      accessToken,
      refreshToken,
      user,
      impersonator,
    };

    const encryptedSession = await this.encryptSession(session);

    // Save to response
    return this.storage.saveSession(response, encryptedSession);
  }

  async switchToOrganization<TCustomClaims = CustomClaims>(
    request: TRequest,
    response: TResponse,
    organizationId: string,
  ): Promise<{
    response?: TResponse;
    headers?: HeadersBag;
    authResult: AuthResult<TCustomClaims>;
  }> {
    const session = await this.getSession(request);

    if (!session) {
      throw new AuthKitError('No active session to switch organization');
    }

    try {
      const refreshResult = await this.refreshSession<TCustomClaims>(
        session,
        organizationId,
      );

      // Save the new session
      const updatedResponse = await this.storage.saveSession(
        response,
        refreshResult.sessionData,
      );

      return {
        response: updatedResponse.response,
        headers: updatedResponse.headers,
        authResult: {
          user: refreshResult.user,
          sessionId: refreshResult.sessionId,
          impersonator: refreshResult.impersonator,
          accessToken: refreshResult.accessToken,
          refreshToken: refreshResult.session.refreshToken,
          claims: refreshResult.claims,
        },
      };
    } catch (error: any) {
      throw await this.handleSwitchOrganizationError(error, organizationId);
    }
  }

  private async handleSwitchOrganizationError(
    error: any,
    organizationId: string,
  ): Promise<AuthKitError> {
    const errorCodeToMessage = {
      sso_required: `SSO required for organization ${organizationId}`,
      mfa_enrollment: `MFA enrollment required for organization ${organizationId}`,
    };

    const errorMessage =
      errorCodeToMessage[error?.code as keyof typeof errorCodeToMessage];

    if (errorMessage) {
      const authUrl = await this.getAuthorizationUrl({
        redirectUri: this.config.getValue('redirectUri'),
      });
      return new AuthKitError(errorMessage, error, { authUrl });
    }

    if (error?.authkit_redirect_url) {
      return new AuthKitError(
        'Organization switch requires authentication',
        error,
        { authUrl: error.authkit_redirect_url },
      );
    }

    return new AuthKitError(
      `Failed to switch to organization ${organizationId}`,
      error,
    );
  }

  async terminateSession(
    session: Session,
    response: TResponse,
    options?: { returnTo?: string },
  ): Promise<{
    response?: TResponse;
    headers?: HeadersBag;
    logoutUrl: string;
  }> {
    const claims = this.tokenManager.parseTokenClaims(session.accessToken);

    // Revoke the session on WorkOS side
    try {
      await this.client.userManagement.revokeSession({
        sessionId: claims.sid,
      });
    } catch (error) {
      console.error('Failed to revoke session on WorkOS:', error);
      // Continue with local logout even if remote revocation fails
    }

    // Clear the session cookie locally
    const cleared = await this.storage.clearSession(response);

    // Generate logout URL (for completeness, though session is already revoked)
    const logoutUrl = this.client.userManagement.getLogoutUrl({
      sessionId: claims.sid,
      returnTo: options?.returnTo,
    });

    return {
      response: cleared.response,
      headers: cleared.headers,
      logoutUrl,
    };
  }
}
