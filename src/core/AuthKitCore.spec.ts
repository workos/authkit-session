import { AuthKitCore } from './AuthKitCore.js';
import { SessionEncryptionError, TokenRefreshError } from './errors.js';

const mockConfig = {
  cookiePassword: 'test-password-that-is-32-chars-long!!',
  clientId: 'test-client-id',
};

const mockUser = {
  id: 'user_123',
  email: 'test@example.com',
  object: 'user',
  firstName: 'Test',
  lastName: 'User',
  emailVerified: true,
  profilePictureUrl: null,
  createdAt: '2023-01-01T00:00:00Z',
  updatedAt: '2023-01-01T00:00:00Z',
  lastSignInAt: '2023-01-01T00:00:00Z',
  locale: 'en-US',
  externalId: null,
  metadata: {},
} as const;

const mockClient = {
  userManagement: {
    getJwksUrl: () => 'https://api.workos.com/sso/jwks/test-client-id',
    authenticateWithRefreshToken: async () => ({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      user: mockUser,
      impersonator: undefined,
    }),
  },
};

const mockEncryption = {
  sealData: async () => 'encrypted-session-data',
  unsealData: async () => ({
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    user: mockUser,
    impersonator: undefined,
  }),
};

describe('AuthKitCore', () => {
  let core: AuthKitCore;

  beforeEach(() => {
    core = new AuthKitCore(
      mockConfig as any,
      mockClient as any,
      mockEncryption as any,
    );
  });

  describe('constructor', () => {
    it('creates instance with required dependencies', () => {
      expect(core).toBeInstanceOf(AuthKitCore);
    });
  });

  describe('parseTokenClaims()', () => {
    it('parses valid JWT payload', () => {
      const validJwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyIsInNpZCI6InNlc3Npb25fMTIzIiwiZXhwIjoxNzM2Mzc2MDAwfQ.fake-signature';

      const result = core.parseTokenClaims(validJwt);

      expect(result.sub).toBe('user_123');
      expect(result.sid).toBe('session_123');
      expect(result.exp).toBe(1736376000);
    });

    it('throws error for invalid JWT', () => {
      expect(() => core.parseTokenClaims('invalid-jwt')).toThrow(
        'Invalid token',
      );
    });

    it('supports custom claims', () => {
      const customJwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyIsImN1c3RvbUZpZWxkIjoiY3VzdG9tLXZhbHVlIn0.fake-signature';

      const result = core.parseTokenClaims<{ customField: string }>(customJwt);

      expect(result.customField).toBe('custom-value');
    });
  });

  describe('isTokenExpiring()', () => {
    it('returns true when token expires soon', () => {
      // Token expires in 5 seconds, which is within the default 10-second buffer
      const soonExpiry = Math.floor(Date.now() / 1000) + 5;
      const expiringJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${btoa(JSON.stringify({ exp: soonExpiry }))}.fake-signature`;

      const result = core.isTokenExpiring(expiringJwt);

      expect(result).toBe(true);
    });

    it('returns false when token expires later', () => {
      const laterExpiry = Math.floor(Date.now() / 1000) + 3600;
      const validJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${btoa(JSON.stringify({ exp: laterExpiry }))}.fake-signature`;

      const result = core.isTokenExpiring(validJwt);

      expect(result).toBe(false);
    });

    it('uses custom buffer time', () => {
      const expiry = Math.floor(Date.now() / 1000) + 150;
      const jwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${btoa(JSON.stringify({ exp: expiry }))}.fake-signature`;

      const result = core.isTokenExpiring(jwt, 180);

      expect(result).toBe(true);
    });

    it('returns false when token has no expiry', () => {
      const noExpiryJwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyJ9.fake-signature';

      const result = core.isTokenExpiring(noExpiryJwt);

      expect(result).toBe(false);
    });
  });

  describe('verifyToken()', () => {
    it('returns false for invalid tokens', async () => {
      const result = await core.verifyToken('invalid-token');

      expect(result).toBe(false);
    });

    it('returns false for malformed tokens', async () => {
      const result = await core.verifyToken('not.a.jwt');

      expect(result).toBe(false);
    });
  });

  describe('encryptSession()', () => {
    it('encrypts session data', async () => {
      const session = {
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        user: mockUser,
        impersonator: undefined,
      };

      const result = await core.encryptSession(session);

      expect(result).toBe('encrypted-session-data');
    });

    it('throws SessionEncryptionError on failure', async () => {
      const failingEncryption = {
        sealData: async () => {
          throw new Error('Encryption failed');
        },
        unsealData: async () => ({}),
      };
      const failingCore = new AuthKitCore(
        mockConfig as any,
        mockClient as any,
        failingEncryption as any,
      );

      await expect(
        failingCore.encryptSession({
          accessToken: 'test',
          refreshToken: 'test',
          user: mockUser,
          impersonator: undefined,
        }),
      ).rejects.toThrow(SessionEncryptionError);
    });
  });

  describe('decryptSession()', () => {
    it('decrypts session data', async () => {
      const result = await core.decryptSession('encrypted-data');

      expect(result.accessToken).toBe('test-access-token');
      expect(result.user).toEqual(mockUser);
    });

    it('throws SessionEncryptionError on failure', async () => {
      const failingEncryption = {
        sealData: async () => 'encrypted',
        unsealData: async () => {
          throw new Error('Decryption failed');
        },
      };
      const failingCore = new AuthKitCore(
        mockConfig as any,
        mockClient as any,
        failingEncryption as any,
      );

      await expect(failingCore.decryptSession('bad-data')).rejects.toThrow(
        SessionEncryptionError,
      );
    });
  });

  describe('refreshTokens()', () => {
    it('refreshes tokens via WorkOS', async () => {
      const result = await core.refreshTokens('refresh-token');

      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
      expect(result.user).toEqual(mockUser);
    });

    it('includes organizationId when provided', async () => {
      const clientWithSpy = {
        userManagement: {
          getJwksUrl: () => 'https://api.workos.com/sso/jwks/test-client-id',
          authenticateWithRefreshToken: async ({ organizationId }: any) => ({
            accessToken: organizationId ? 'org-token' : 'regular-token',
            refreshToken: 'new-refresh-token',
            user: mockUser,
            impersonator: undefined,
          }),
        },
      };
      const testCore = new AuthKitCore(
        mockConfig as any,
        clientWithSpy as any,
        mockEncryption as any,
      );

      const result = await testCore.refreshTokens('refresh-token', 'org_123');

      expect(result.accessToken).toBe('org-token');
    });

    it('throws TokenRefreshError on failure', async () => {
      const failingClient = {
        userManagement: {
          getJwksUrl: () => 'https://api.workos.com/sso/jwks/test-client-id',
          authenticateWithRefreshToken: async () => {
            throw new Error('Refresh failed');
          },
        },
      };
      const failingCore = new AuthKitCore(
        mockConfig as any,
        failingClient as any,
        mockEncryption as any,
      );

      await expect(failingCore.refreshTokens('bad-token')).rejects.toThrow(
        TokenRefreshError,
      );
    });
  });
});
