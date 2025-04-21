import {
  createRemoteJWKSet,
  decodeJwt,
  jwtVerify,
  type JWTPayload,
} from 'jose';
import { getWorkOS } from '../workos';
import { once } from '../../utils';

export class TokenManager {
  clientId: string;

  constructor(clientId: string) {
    this.clientId = clientId;
  }

  private readonly getPublicKey = once(() =>
    createRemoteJWKSet(
      new URL(getWorkOS().userManagement.getJwksUrl(this.clientId)),
    ),
  );

  async verifyToken(token: string): Promise<boolean> {
    try {
      await jwtVerify(token, this.getPublicKey());
      return true;
    } catch {
      return false;
    }
  }

  parseTokenClaims<T = {}>(token: string): T & JWTPayload {
    try {
      return decodeJwt<T>(token);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  isTokenExpiring(token: string, bufferSeconds?: number): boolean {
    const expiryTime = this.getTokenExpiryTime(token);
    if (!expiryTime) {
      return false;
    }

    const buffer = bufferSeconds ?? 60; // Default to 1 minute
    const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
    return expiryTime - currentTime <= buffer;
  }

  getTokenExpiryTime(token: string): number | null {
    const claims = this.parseTokenClaims(token);
    return claims.exp ? claims.exp : null;
  }
}

export default TokenManager;
