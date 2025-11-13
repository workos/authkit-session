import { SessionManager } from './SessionManager.js';
import {
  SessionEncryptionError,
  AuthKitError,
  TokenRefreshError,
} from '../errors.js';

// Simple mocks for dependencies
const mockConfig = {
  getValue: (key: string) => {
    const values = {
      cookiePassword: 'test-password-that-is-32-chars-long!!',
      clientId: 'test-client-id',
      redirectUri: 'http://localhost:3000/callback',
    };
    return values[key as keyof typeof values];
  },
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
  externalId: null,
  metadata: {},
} as const;

const mockStorage = {
  getSession: async () => null,
  saveSession: async (response: any) => ({ response }),
  clearSession: async (response: any) => ({ response }),
};

const mockTokenManager = {
  verifyToken: async () => true,
  isTokenExpiring: () => false,
  parseTokenClaims: () => ({
    sub: 'user_123',
    sid: 'session_123',
    exp: Math.floor(Date.now() / 1000) + 3600,
    org_id: 'org_123',
  }),
};

const mockClient = {
  userManagement: {
    getAuthorizationUrl: ({ redirectUri, clientId, state }: any) =>
      `https://api.workos.com/sso/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state || ''}`,
    authenticateWithRefreshToken: async () => ({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      user: mockUser,
      impersonator: undefined,
    }),
    revokeSession: async () => {},
    getLogoutUrl: ({ sessionId, returnTo }: any) =>
      `https://api.workos.com/sso/logout?session_id=${sessionId}&return_to=${returnTo || ''}`,
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

describe('SessionManager', () => {
  let sessionManager: SessionManager<any, any>;

  beforeEach(() => {
    sessionManager = new SessionManager(
      mockConfig as any,
      mockStorage as any,
      mockTokenManager as any,
      mockClient as any,
      mockEncryption as any,
    );
  });

  describe('constructor', () => {
    it('creates instance with required dependencies', () => {
      expect(sessionManager).toBeInstanceOf(SessionManager);
    });
  });

  describe('withAuth()', () => {
    it('returns null user when no session exists', async () => {
      const result = await sessionManager.withAuth('request');

      expect(result.auth.user).toBeNull();
    });

    it('returns user data when valid session exists', async () => {
      const storageWithSession = {
        ...mockStorage,
        getSession: async () => 'encrypted-session',
      };

      const manager = new SessionManager(
        mockConfig as any,
        storageWithSession as any,
        mockTokenManager as any,
        mockClient as any,
        mockEncryption as any,
      );

      const result = await manager.withAuth('request');

      expect(result.auth.user).toEqual(mockUser);
      expect(result.auth.sessionId).toBe('session_123');
      expect(result.auth.accessToken).toBe('test-access-token');
    });
  });

  describe('getAuthorizationUrl()', () => {
    it('generates authorization URL with default values', async () => {
      const url = await sessionManager.getAuthorizationUrl({});

      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain(
        'redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback',
      );
    });

    it('includes return pathname in state', async () => {
      const url = await sessionManager.getAuthorizationUrl({
        returnPathname: '/dashboard',
      });

      const stateParam = new URLSearchParams(url.split('?')[1]).get('state');
      const decodedState = JSON.parse(atob(stateParam!));

      expect(decodedState.returnPathname).toBe('/dashboard');
    });

    it('uses custom redirect URI when provided', async () => {
      const url = await sessionManager.getAuthorizationUrl({
        redirectUri: 'https://example.com/auth/callback',
      });

      expect(url).toContain(
        'redirect_uri=https%3A%2F%2Fexample.com%2Fauth%2Fcallback',
      );
    });
  });

  describe('createSession()', () => {
    it('creates session from auth response', async () => {
      const authResponse = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: mockUser,
        impersonator: undefined,
      };

      const result = await sessionManager.createSession(
        authResponse,
        'response',
      );

      expect(result.response).toBe('response');
    });

    it('throws error when tokens are missing', async () => {
      const authResponse = {
        accessToken: null,
        refreshToken: 'refresh-token',
        user: mockUser,
        impersonator: undefined,
      };

      await expect(
        sessionManager.createSession(authResponse as any, 'response'),
      ).rejects.toThrow(AuthKitError);
    });
  });

  describe('refreshSession()', () => {
    it('refreshes session with new tokens', async () => {
      const session = {
        accessToken: 'old-access-token',
        refreshToken: 'old-refresh-token',
        user: mockUser,
        impersonator: undefined,
      };

      const result = await sessionManager.refreshSession(session);

      expect(result.accessToken).toBe('new-access-token');
      expect(result.session.refreshToken).toBe('new-refresh-token');
      expect(result.sessionId).toBe('session_123');
    });

    it('throws TokenRefreshError on failure', async () => {
      const failingClient = {
        userManagement: {
          authenticateWithRefreshToken: async () => {
            throw new Error('Refresh failed');
          },
        },
      };

      const manager = new SessionManager(
        mockConfig as any,
        mockStorage as any,
        mockTokenManager as any,
        failingClient as any,
        mockEncryption as any,
      );

      const session = {
        accessToken: 'token',
        refreshToken: 'refresh',
        user: mockUser,
        impersonator: undefined,
      };

      await expect(manager.refreshSession(session)).rejects.toThrow(
        TokenRefreshError,
      );
    });
  });

  describe('terminateSession()', () => {
    it('revokes session and returns logout URL', async () => {
      const session = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: mockUser,
        impersonator: undefined,
      };

      const result = await sessionManager.terminateSession(session, 'response');

      expect(result.response).toBe('response');
      expect(result.logoutUrl).toContain('session_id=session_123');
    });

    it('includes return URL in logout URL when provided', async () => {
      const session = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: mockUser,
        impersonator: undefined,
      };

      const result = await sessionManager.terminateSession(
        session,
        'response',
        {
          returnTo: 'https://example.com',
        },
      );

      expect(result.logoutUrl).toContain('return_to=https://example.com');
    });
  });

  describe('switchToOrganization()', () => {
    it('switches organization and updates session', async () => {
      const storageWithSession = {
        ...mockStorage,
        getSession: async () => 'encrypted-session',
      };

      const manager = new SessionManager(
        mockConfig as any,
        storageWithSession as any,
        mockTokenManager as any,
        mockClient as any,
        mockEncryption as any,
      );

      const result = await manager.switchToOrganization(
        'request',
        'response',
        'org_456',
      );

      expect(result.response).toBe('response');
      expect(result.authResult.user).toEqual(mockUser);
    });

    it('throws error when no session exists', async () => {
      await expect(
        sessionManager.switchToOrganization('request', 'response', 'org_456'),
      ).rejects.toThrow(AuthKitError);
    });
  });

  describe('error handling', () => {
    it('handles encryption failures', async () => {
      const failingEncryption = {
        sealData: async () => {
          throw new Error('Encryption failed');
        },
        unsealData: async () => ({}),
      };

      const manager = new SessionManager(
        mockConfig as any,
        mockStorage as any,
        mockTokenManager as any,
        mockClient as any,
        failingEncryption as any,
      );

      const session = {
        accessToken: 'token',
        refreshToken: 'refresh',
        user: mockUser,
        impersonator: undefined,
      };

      await expect(manager.createSession(session, 'response')).rejects.toThrow(
        SessionEncryptionError,
      );
    });

    it('handles decryption failures', async () => {
      const storageWithSession = {
        ...mockStorage,
        getSession: async () => 'invalid-encrypted-session',
      };

      const failingEncryption = {
        sealData: async () => 'encrypted',
        unsealData: async () => {
          throw new Error('Decryption failed');
        },
      };

      const manager = new SessionManager(
        mockConfig as any,
        storageWithSession as any,
        mockTokenManager as any,
        mockClient as any,
        failingEncryption as any,
      );

      const result = await manager.withAuth('request');

      expect(result.auth.user).toBeNull();
    });
  });
});
