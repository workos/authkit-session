import { TokenManager } from './TokenManager.js';

// Mock WorkOS client
const mockClient = {
  userManagement: {
    getJwksUrl: () => 'https://api.workos.com/sso/jwks/test-client-id',
  },
};

describe('TokenManager', () => {
  let tokenManager: TokenManager;

  beforeEach(() => {
    tokenManager = new TokenManager('test-client-id', mockClient as any);
  });

  describe('constructor', () => {
    it('creates instance with client ID and WorkOS client', () => {
      expect(tokenManager).toBeInstanceOf(TokenManager);
    });
  });

  describe('parseTokenClaims()', () => {
    it('parses valid JWT payload', () => {
      // Simple JWT with valid claims (header.payload.signature)
      const validJwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyIsInNpZCI6InNlc3Npb25fMTIzIiwiZXhwIjoxNzM2Mzc2MDAwfQ.fake-signature';

      const result = tokenManager.parseTokenClaims(validJwt);

      expect(result.sub).toBe('user_123');
      expect(result.sid).toBe('session_123');
      expect(result.exp).toBe(1736376000);
    });

    it('throws error for invalid JWT', () => {
      expect(() => tokenManager.parseTokenClaims('invalid-jwt')).toThrow(
        'Invalid token',
      );
    });

    it('throws error for malformed JWT', () => {
      expect(() => tokenManager.parseTokenClaims('not.a.jwt')).toThrow(
        'Invalid token',
      );
    });

    it('supports custom claims', () => {
      // JWT with custom claims
      const customJwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyIsImN1c3RvbUZpZWxkIjoiY3VzdG9tLXZhbHVlIn0.fake-signature';

      const result = tokenManager.parseTokenClaims<{ customField: string }>(
        customJwt,
      );

      expect(result.customField).toBe('custom-value');
    });
  });

  describe('getTokenExpiryTime()', () => {
    it('returns expiry time from token', () => {
      const jwtWithExp =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyIsImV4cCI6MTczNjM3NjAwMH0.fake-signature';

      const result = tokenManager.getTokenExpiryTime(jwtWithExp);

      expect(result).toBe(1736376000);
    });

    it('returns null when token has no exp claim', () => {
      const jwtWithoutExp =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyJ9.fake-signature';

      const result = tokenManager.getTokenExpiryTime(jwtWithoutExp);

      expect(result).toBeNull();
    });
  });

  describe('isTokenExpiring()', () => {
    it('returns true when token expires soon', () => {
      const soonExpiry = Math.floor(Date.now() / 1000) + 30; // 30 seconds from now
      const expiringJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${btoa(JSON.stringify({ exp: soonExpiry }))}.fake-signature`;

      const result = tokenManager.isTokenExpiring(expiringJwt);

      expect(result).toBe(true);
    });

    it('returns false when token expires later', () => {
      const laterExpiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const validJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${btoa(JSON.stringify({ exp: laterExpiry }))}.fake-signature`;

      const result = tokenManager.isTokenExpiring(validJwt);

      expect(result).toBe(false);
    });

    it('uses custom buffer time', () => {
      const expiry = Math.floor(Date.now() / 1000) + 150; // 2.5 minutes from now
      const jwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${btoa(JSON.stringify({ exp: expiry }))}.fake-signature`;

      const result = tokenManager.isTokenExpiring(jwt, 180); // 3 minute buffer

      expect(result).toBe(true);
    });

    it('returns false when token has no expiry', () => {
      const noExpiryJwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyJ9.fake-signature';

      const result = tokenManager.isTokenExpiring(noExpiryJwt);

      expect(result).toBe(false);
    });
  });

  describe('verifyToken()', () => {
    it('returns false for invalid tokens', async () => {
      const result = await tokenManager.verifyToken('invalid-token');

      expect(result).toBe(false);
    });

    it('returns false for malformed tokens', async () => {
      const result = await tokenManager.verifyToken('not.a.jwt');

      expect(result).toBe(false);
    });
  });
});
