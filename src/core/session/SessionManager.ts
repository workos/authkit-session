import type { AuthenticationResponse, WorkOS } from '@workos-inc/node';
import { sealData, unsealData } from 'iron-session';
import type { ConfigurationProvider } from '../config/ConfigurationProvider';
import {
  AuthKitError,
  SessionEcnryptionError,
  TokenRefreshError,
} from '../errors';
import type { TokenManager } from './TokenManager';
import type {
  AuthResult,
  CustomClaims,
  Session,
  SessionStorage,
} from './types';

export class SessionManager<TRequest, TResponse> {
  private readonly config: ConfigurationProvider;
  private readonly storage: SessionStorage<TRequest, TResponse>;
  private readonly tokenManager: TokenManager;
  private readonly client: WorkOS;

  constructor(
    config: ConfigurationProvider,
    storage: SessionStorage<TRequest, TResponse>,
    tokenManager: TokenManager,
    client: WorkOS,
  ) {
    this.config = config;
    this.storage = storage;
    this.tokenManager = tokenManager;
    this.client = client;
  }

  private async encryptSession(session: Session): Promise<string> {
    try {
      const password = this.config.getValue('cookiePassword');
      const encryptedSession = await sealData(session, { password });
      return encryptedSession;
    } catch (error) {
      throw new SessionEcnryptionError('Failed to encrypt session', error);
    }
  }

  private async decryptSession(encryptedSession: string): Promise<Session> {
    try {
      const password = this.config.getValue('cookiePassword');
      const session = await unsealData<Session>(encryptedSession, {
        password,
      });
      return session;
    } catch (error) {
      throw new SessionEcnryptionError('Failed to decrypt session', error);
    }
  }

  private async validateSession<TCustomClaims = CustomClaims>(
    encryptedSession: string,
  ) {
    try {
      const session = await this.decryptSession(encryptedSession);

      const isValid = await this.tokenManager.verifyToken(session.accessToken);

      if (isValid) {
        if (this.tokenManager.isTokenExpiring(session.accessToken)) {
          const refreshResult =
            await this.refreshSession<TCustomClaims>(session);
          return {
            valid: true,
            session: refreshResult.session,
            claims: refreshResult.claims,
          };
        }

        const claims = this.tokenManager.parseTokenClaims<TCustomClaims>(
          session.accessToken,
        );

        return {
          valid: true,
          session,
          claims,
        };
      } else {
        try {
          const refreshResult =
            await this.refreshSession<TCustomClaims>(session);
          return {
            valid: true,
            session: refreshResult.session,
            claims: refreshResult.claims,
          };
        } catch (error) {
          return {
            valid: false,
            error:
              error instanceof Error
                ? error
                : new TokenRefreshError('Failed to refresh session', error),
          };
        }
      }
    } catch (error) {
      return {
        valid: false,
        error:
          error instanceof Error
            ? error
            : new AuthKitError('Failed to decrypt session', error),
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
      claims,
    };
  }

  async refreshSession<TCustomClaims = CustomClaims>(session: Session) {
    try {
      const currentClaims = this.tokenManager.parseTokenClaims(
        session.accessToken,
      );
      const refreshResponse =
        await this.client.userManagement.authenticateWithRefreshToken({
          refreshToken: session.refreshToken,
          clientId: this.config.getValue('clientId'),
          organizationId: currentClaims.org_id,
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
        permissions: claims.permissions,
        entitlements: claims.entitlements,
        imposionator: newSession.impersonator,
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
    returnPathname = '/',
    redirectUri,
    screenHint,
  }: {
    returnPathname?: string;
    redirectUri?: string;
    screenHint?: 'sign-up' | 'sign-in';
  }): Promise<string> {
    return this.client.userManagement.getAuthorizationUrl({
      provider: 'authkit',
      redirectUri: redirectUri ?? this.config.getValue('redirectUri'),
      screenHint,
      clientId: this.config.getValue('clientId'),
      state: returnPathname
        ? btoa(JSON.stringify({ returnPathname }))
        : undefined,
    });
  }

  async createSession(
    authResponse: AuthenticationResponse,
    response: TResponse,
  ): Promise<TResponse> {
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

  async terminateSession(
    session: Session,
    response: TResponse,
    options?: { returnTo?: string },
  ): Promise<{
    response: TResponse;
    logoutUrl: string;
  }> {
    const clearedResponse = await this.storage.clearSession(response);

    const claims = this.tokenManager.parseTokenClaims(session.accessToken);

    const logoutUrl = this.client.userManagement.getLogoutUrl({
      sessionId: claims.sid,
      returnTo: options?.returnTo,
    });

    return {
      response: clearedResponse,
      logoutUrl,
    };
  }
}
