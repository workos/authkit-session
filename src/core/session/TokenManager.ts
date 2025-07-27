import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { once } from '../../utils';
import type { WorkOSClient } from '../client/types';
import type { BaseTokenClaims, CustomClaims } from './types';

export class TokenManager {
  private clientId: string;
  private client: WorkOSClient;

  constructor(clientId: string, client: WorkOSClient) {
    this.clientId = clientId;
    this.client = client;
  }

  private readonly getPublicKey = once(() =>
    createRemoteJWKSet(new URL(this.client.getJwksUrl(this.clientId))),
  );

  async verifyToken(token: string): Promise<boolean> {
    try {
      await jwtVerify(token, this.getPublicKey());
      return true;
    } catch {
      return false;
    }
  }

  parseTokenClaims<TCustomClaims = CustomClaims>(
    token: string,
  ): BaseTokenClaims & TCustomClaims {
    try {
      return decodeJwt<BaseTokenClaims & TCustomClaims>(token);
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
    return claims.exp ?? null;
  }
}

export default TokenManager;
