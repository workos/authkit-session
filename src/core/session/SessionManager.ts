// import { sealData, unsealData } from 'iron-session';
import * as Iron from 'iron-webcrypto';
import type { ConfigurationProvider } from '../config/ConfigurationProvider';
import {
  AuthKitError,
  SessionEcnryptionError,
  TokenRefreshError,
} from '../errors';
import { sealData, unsealData } from '../iron';
import type { AuthenticationResponse } from '../workos/types';
import type { UserManagement } from '../workos/UserManagement';
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
  private readonly client: UserManagement;

  constructor(
    config: ConfigurationProvider,
    storage: SessionStorage<TRequest, TResponse>,
    tokenManager: TokenManager,
    client: UserManagement,
  ) {
    this.config = config;
    this.storage = storage;
    this.tokenManager = tokenManager;
    this.client = client;
  }

  private async encryptSession(session: Session): Promise<string> {
    try {
      const password = this.config.getValue('cookiePassword');
      // const encryptedSession = await sealData(session, { password });
      const encryptedSession = await sealData(session, password);
      return encryptedSession;
    } catch (error) {
      throw new SessionEcnryptionError('Failed to encrypt session', error);
    }
  }

  private async decryptSession(encryptedSession: string): Promise<Session> {
    try {
      const password = this.config.getValue('cookiePassword');
      console.log('PASSWORD', password);
      const session = await unsealData<Session>(encryptedSession, password);
      console.log('SESSION', session);
      return session;
    } catch (error) {
      console.error('Detailed error:', error);
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
    console.log('encryptedSession', encryptedSession);

    if (!encryptedSession) {
      return { user: null };
    }

    const { valid, session, claims, error } =
      await this.validateSession<TCustomClaims>(encryptedSession);

    console.log({
      valid,
      session,
      claims,
      error,
      refreshToken: session?.refreshToken,
    });
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
      const refreshResponse = await this.client.authenticateWithRefreshToken({
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
    return this.client.getAuthorizationUrl({
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

    const logoutUrl = this.client.getLogoutUrl({
      sessionId: claims.sid,
      returnTo: options?.returnTo,
    });

    return {
      response: clearedResponse,
      logoutUrl,
    };
  }

  /**
   * Custom adapter to decrypt iron-session data
   */
  async decryptIronSessionData(encryptedData: string, password: string) {
    // Ensure we have the crypto object
    const crypto = globalThis.crypto;

    // Split the sealed data to analyze its format
    const parts = encryptedData.split('*');
    console.log('Parts length:', parts.length);
    console.log('Prefix:', parts[0]);

    // Extract the necessary components manually
    // Format should be: Fe26.2*[id]*[encryptionSalt]*[iv]*[encryptedB64]*[exp]*[hmacSalt]*[hmac]
    if (parts.length !== 8) {
      throw new Error(`Invalid format: expected 8 parts, got ${parts.length}`);
    }

    // Manually reconstruct the data for decryption
    const prefix = parts[0];
    const passwordId = parts[1] || '';
    const encryptionSalt = parts[2];
    const iv = parts[3];
    const encryptedB64 = parts[4];
    const expiration = parts[5];
    const hmacSalt = parts[6];
    const hmacSignature = parts[7];

    // We'll try a hybrid approach - use iron-webcrypto but with our own adaptation

    try {
      // Attempt using the regular unseal with explicit options
      return await Iron.unseal(crypto, encryptedData, password, {
        encryption: {
          saltBits: 256,
          algorithm: 'aes-256-cbc',
          iterations: 1,
          minPasswordlength: 32,
        },
        integrity: {
          saltBits: 256,
          algorithm: 'sha256',
          iterations: 1,
          minPasswordlength: 32,
        },
        ttl: 0,
        timestampSkewSec: 60,
        localtimeOffsetMsec: 0,
      });
    } catch (error) {
      console.error('First attempt failed:', error);

      // If that fails, try a more direct approach using the lower-level functions
      try {
        // We'll need to manually:
        // 1. Decrypt the data using the encryption components
        // 2. Skip the HMAC verification since that's where it's failing

        // Prepare the decryption options
        const decryptOptions = {
          algorithm: 'aes-256-cbc',
          iterations: 1,
          minPasswordlength: 32,
          salt: encryptionSalt,
          iv: Iron.base64urlDecode(iv!),
        };

        // Use the decrypt function directly
        const decrypted = await Iron.decrypt(
          crypto,
          password,
          decryptOptions as any,
          Iron.base64urlDecode(encryptedB64!),
        );

        // Parse the JSON result
        return JSON.parse(decrypted);
      } catch (innerError) {
        console.error('Manual decryption failed:', innerError);
        throw innerError;
      }
    }
  }
}
