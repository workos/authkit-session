import { AuthService } from './AuthService.js';

const mockConfig = {
  clientId: 'test-client-id',
  apiKey: 'test-api-key',
  redirectUri: 'http://localhost:3000/callback',
  cookiePassword: 'test-password-that-is-32-chars-long!!',
  cookieName: 'wos-session',
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
  getSession: async () => 'encrypted-session-data',
  saveSession: async () => ({ response: 'updated-response' }),
  clearSession: async () => ({ response: 'cleared-response' }),
};

const mockClient = {
  userManagement: {
    getJwksUrl: () => 'https://api.workos.com/sso/jwks/test-client-id',
    getAuthorizationUrl: ({ screenHint }: any) =>
      `https://api.workos.com/sso/authorize?screen_hint=${screenHint || ''}`,
    authenticateWithCode: async ({ code }: any) => ({
      accessToken: `access-${code}`,
      refreshToken: `refresh-${code}`,
      user: mockUser,
      impersonator: undefined,
    }),
    getLogoutUrl: ({ sessionId }: any) =>
      `https://api.workos.com/sso/logout?session_id=${sessionId}`,
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

describe('AuthService', () => {
  let service: AuthService<any, any>;

  beforeEach(() => {
    service = new AuthService(
      mockConfig as any,
      mockStorage as any,
      mockClient as any,
      mockEncryption as any,
    );
  });

  describe('constructor', () => {
    it('creates instance with required dependencies', () => {
      expect(service).toBeInstanceOf(AuthService);
    });
  });

  describe('withAuth()', () => {
    it('returns null user when no session exists', async () => {
      const emptyStorage = {
        ...mockStorage,
        getSession: async () => null,
      };
      const testService = new AuthService(
        mockConfig as any,
        emptyStorage as any,
        mockClient as any,
        mockEncryption as any,
      );

      const result = await testService.withAuth('request');

      expect(result.auth.user).toBeNull();
      expect(result.refreshedSessionData).toBeUndefined();
    });

    it('returns null user on decryption error', async () => {
      const failingEncryption = {
        sealData: async () => 'encrypted',
        unsealData: async () => {
          throw new Error('Decryption failed');
        },
      };
      const testService = new AuthService(
        mockConfig as any,
        mockStorage as any,
        mockClient as any,
        failingEncryption as any,
      );

      const result = await testService.withAuth('request');

      expect(result.auth.user).toBeNull();
    });
  });

  describe('getSession()', () => {
    it('returns decrypted session', async () => {
      const result = await service.getSession('request');

      expect(result).toBeDefined();
      expect(result?.user).toEqual(mockUser);
    });

    it('returns null when no session exists', async () => {
      const emptyStorage = {
        ...mockStorage,
        getSession: async () => null,
      };
      const testService = new AuthService(
        mockConfig as any,
        emptyStorage as any,
        mockClient as any,
        mockEncryption as any,
      );

      const result = await testService.getSession('request');

      expect(result).toBeNull();
    });
  });

  describe('saveSession()', () => {
    it('delegates to storage', async () => {
      const result = await service.saveSession('response', 'session-data');

      expect(result.response).toBe('updated-response');
    });
  });

  describe('clearSession()', () => {
    it('delegates to storage', async () => {
      const result = await service.clearSession('response');

      expect(result.response).toBe('cleared-response');
    });
  });

  describe('signOut()', () => {
    it('delegates to operations', async () => {
      const result = await service.signOut('session_123');

      expect(result.logoutUrl).toContain('session_id=session_123');
      expect(result.clearCookieHeader).toBeDefined();
    });
  });

  describe('getAuthorizationUrl()', () => {
    it('delegates to operations', async () => {
      const result = await service.getAuthorizationUrl();

      expect(result).toContain('authorize');
    });
  });

  describe('getSignInUrl()', () => {
    it('returns sign-in URL', async () => {
      const result = await service.getSignInUrl();

      expect(result).toContain('screen_hint=sign-in');
    });
  });

  describe('getSignUpUrl()', () => {
    it('returns sign-up URL', async () => {
      const result = await service.getSignUpUrl();

      expect(result).toContain('screen_hint=sign-up');
    });
  });

  describe('getWorkOS()', () => {
    it('returns WorkOS client', () => {
      const result = service.getWorkOS();

      expect(result).toBe(mockClient);
    });
  });

  describe('handleCallback()', () => {
    it('authenticates and creates session', async () => {
      const result = await service.handleCallback('request', 'response', {
        code: 'auth-code-123',
      });

      expect(result.authResponse.accessToken).toBe('access-auth-code-123');
      expect(result.returnPathname).toBe('/');
      expect(result.response).toBe('updated-response');
    });

    it('decodes returnPathname from state', async () => {
      const state = btoa(JSON.stringify({ returnPathname: '/dashboard' }));

      const result = await service.handleCallback('request', 'response', {
        code: 'auth-code-123',
        state,
      });

      expect(result.returnPathname).toBe('/dashboard');
    });

    it('uses default returnPathname for invalid state', async () => {
      const result = await service.handleCallback('request', 'response', {
        code: 'auth-code-123',
        state: 'invalid-state',
      });

      expect(result.returnPathname).toBe('/');
    });
  });
});
