import type { Impersonator, User, WorkOS } from '@workos-inc/node';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { once } from '../utils.js';
import type { AuthKitConfig } from './config/types.js';
import { SessionEncryptionError, TokenRefreshError } from './errors.js';
import type {
  BaseTokenClaims,
  CustomClaims,
  Session,
  SessionEncryption,
} from './session/types.js';

/**
 * AuthKitCore provides pure business logic for authentication operations.
 *
 * This class contains no framework-specific code - all methods are pure functions
 * that take data in and return data out. No TRequest/TResponse generics here.
 *
 * Responsibilities:
 * - Token validation (JWT verification against JWKS)
 * - Token expiry detection
 * - Token claims parsing
 * - Session encryption/decryption
 * - Token refresh (calling WorkOS API)
 * - Session validation orchestration
 */
export class AuthKitCore {
  private config: AuthKitConfig;
  private client: WorkOS;
  private encryption: SessionEncryption;
  private clientId: string;

  constructor(
    config: AuthKitConfig,
    client: WorkOS,
    encryption: SessionEncryption,
  ) {
    this.config = config;
    this.client = client;
    this.encryption = encryption;
    this.clientId = config.clientId;
  }

  /**
   * JWKS public key fetcher - cached for performance
   */
  private readonly getPublicKey = once(() =>
    createRemoteJWKSet(
      new URL(this.client.userManagement.getJwksUrl(this.clientId)),
    ),
  );

  /**
   * Verify a JWT access token against WorkOS JWKS.
   *
   * @param token - The JWT access token to verify
   * @returns true if valid, false otherwise
   */
  async verifyToken(token: string): Promise<boolean> {
    try {
      await jwtVerify(token, this.getPublicKey());
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a token is expiring soon.
   *
   * @param token - The JWT access token
   * @param buffer - How many seconds before expiry to consider "expiring" (default: 60)
   * @returns true if token expires within buffer period
   */
  isTokenExpiring(token: string, buffer: number = 10): boolean {
    const expiryTime = this.getTokenExpiryTime(token);
    if (!expiryTime) {
      return false;
    }

    const currentTime = Math.floor(Date.now() / 1000);
    return expiryTime - currentTime <= buffer;
  }

  /**
   * Get the expiry time from a token's claims.
   *
   * @param token - The JWT access token
   * @returns Unix timestamp of expiry, or null if not present
   */
  private getTokenExpiryTime(token: string): number | null {
    const claims = this.parseTokenClaims(token);
    return claims.exp ?? null;
  }

  /**
   * Parse JWT claims from an access token.
   *
   * @param token - The JWT access token
   * @returns Decoded token claims
   * @throws Error if token is invalid
   */
  parseTokenClaims<TCustomClaims = CustomClaims>(
    token: string,
  ): BaseTokenClaims & TCustomClaims {
    try {
      return decodeJwt<BaseTokenClaims & TCustomClaims>(token);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  /**
   * Encrypt a session object into a string suitable for cookie storage.
   *
   * @param session - The session to encrypt
   * @returns Encrypted session string
   * @throws SessionEncryptionError if encryption fails
   */
  async encryptSession(session: Session): Promise<string> {
    try {
      const encryptedSession = await this.encryption.sealData(session, {
        password: this.config.cookiePassword,
        ttl: 0,
      });
      return encryptedSession;
    } catch (error) {
      throw new SessionEncryptionError('Failed to encrypt session', error);
    }
  }

  /**
   * Decrypt an encrypted session string back into a session object.
   *
   * @param encryptedSession - The encrypted session string
   * @returns Decrypted session object
   * @throws SessionEncryptionError if decryption fails
   */
  async decryptSession(encryptedSession: string): Promise<Session> {
    try {
      const session = await this.encryption.unsealData<Session>(
        encryptedSession,
        { password: this.config.cookiePassword },
      );
      return session;
    } catch (error) {
      throw new SessionEncryptionError('Failed to decrypt session', error);
    }
  }

  /**
   * Refresh tokens using WorkOS API.
   *
   * @param refreshToken - The refresh token
   * @param organizationId - Optional organization ID to switch to
   * @returns New access token, refresh token, user, and impersonator
   * @throws TokenRefreshError if refresh fails
   */
  async refreshTokens(
    refreshToken: string,
    organizationId?: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    user: User;
    impersonator: Impersonator | undefined;
  }> {
    try {
      const result =
        await this.client.userManagement.authenticateWithRefreshToken({
          refreshToken,
          clientId: this.clientId,
          organizationId,
        });

      return {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
        impersonator: result.impersonator,
      };
    } catch (error) {
      throw new TokenRefreshError('Failed to refresh tokens', error);
    }
  }

  /**
   * Validate a session and refresh if needed.
   *
   * This is the core orchestration method that decides:
   * 1. Is the token valid?
   * 2. Is it expiring soon?
   * 3. Should we refresh it?
   *
   * @param session - The current session with access and refresh tokens
   * @param options - Optional settings
   * @param options.force - Force refresh even if token is valid (for org switching)
   * @param options.organizationId - Organization ID to switch to during refresh
   * @returns Validation result with refreshed session if needed
   * @throws TokenRefreshError if refresh fails
   */
  async validateAndRefresh<TCustomClaims = CustomClaims>(
    session: Session,
    options?: { force?: boolean; organizationId?: string },
  ): Promise<{
    valid: boolean;
    refreshed: boolean;
    session: Session;
    claims: BaseTokenClaims & TCustomClaims;
  }> {
    const { accessToken } = session;
    const { force = false, organizationId: explicitOrgId } = options ?? {};

    const isValid = await this.verifyToken(accessToken);
    const isExpiring = this.isTokenExpiring(accessToken);

    // Return early if token is valid, not expiring, and not forced
    if (isValid && !isExpiring && !force) {
      const claims = this.parseTokenClaims<TCustomClaims>(accessToken);
      return { valid: true, refreshed: false, session, claims };
    }

    // Determine organization ID: explicit > extracted from token
    let organizationId = explicitOrgId;
    if (!organizationId && isValid) {
      try {
        const oldClaims = this.parseTokenClaims(accessToken);
        organizationId = oldClaims.org_id;
      } catch {
        // Token parsing failed - refresh without org context
      }
    }

    const newSession = await this.refreshTokens(
      session.refreshToken,
      organizationId,
    );
    const newClaims = this.parseTokenClaims<TCustomClaims>(
      newSession.accessToken,
    );
    return {
      valid: true,
      refreshed: true,
      session: newSession,
      claims: newClaims,
    };
  }
}
