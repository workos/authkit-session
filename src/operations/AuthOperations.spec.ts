import { AuthOperations } from './AuthOperations.js';

const mockConfig = {
  clientId: 'test-client-id',
  redirectUri: 'http://localhost:3000/callback',
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
  locale: 'en-US',
  externalId: null,
  metadata: {},
} as const;

const mockCore = {
  validateAndRefresh: async () => ({
    valid: true,
    refreshed: true,
    session: {
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      user: mockUser,
      impersonator: undefined,
    },
    claims: {
      sub: 'user_123',
      sid: 'session_123',
      exp: Math.floor(Date.now() / 1000) + 3600,
      org_id: 'org_123',
    },
  }),
  encryptSession: async () => 'encrypted-session-data',
};

const mockClient = {
  userManagement: {
    getLogoutUrl: ({ sessionId, returnTo }: any) =>
      `https://api.workos.com/sso/logout?session_id=${sessionId}&return_to=${returnTo || ''}`,
    getAuthorizationUrl: ({ clientId, redirectUri, screenHint, state }: any) =>
      `https://api.workos.com/sso/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&screen_hint=${screenHint || ''}&state=${state || ''}`,
  },
};

describe('AuthOperations', () => {
  let operations: AuthOperations;

  beforeEach(() => {
    operations = new AuthOperations(
      mockCore as any,
      mockClient as any,
      mockConfig as any,
    );
  });

  describe('constructor', () => {
    it('creates instance with required dependencies', () => {
      expect(operations).toBeInstanceOf(AuthOperations);
    });
  });

  describe('getLogoutUrl()', () => {
    it('returns logout URL with session ID', () => {
      const result = operations.getLogoutUrl('session_123');

      expect(result).toContain('session_id=session_123');
    });

    it('includes returnTo in logout URL', () => {
      const result = operations.getLogoutUrl('session_123', {
        returnTo: 'http://localhost:3000',
      });

      expect(result).toContain('return_to=');
    });
  });

  describe('switchOrganization()', () => {
    it('delegates to refreshSession with organizationId', async () => {
      const session = {
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        user: mockUser,
        impersonator: undefined,
      };

      const result = await operations.switchOrganization(session, 'org_456');

      expect(result.auth.user).toEqual(mockUser);
      if (result.auth.user) {
        expect(result.auth.accessToken).toBe('new-access-token');
      }
      expect(result.encryptedSession).toBe('encrypted-session-data');
    });
  });

  describe('refreshSession()', () => {
    it('refreshes session and returns auth result', async () => {
      const session = {
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        user: mockUser,
        impersonator: undefined,
      };

      const result = await operations.refreshSession(session);

      expect(result.auth.user).toEqual(mockUser);
      expect(result.auth.accessToken).toBe('new-access-token');
      expect(result.auth.refreshToken).toBe('new-refresh-token');
      expect(result.auth.sessionId).toBe('session_123');
      expect(result.encryptedSession).toBe('encrypted-session-data');
    });

    it('passes organizationId to validateAndRefresh when provided', async () => {
      let capturedOptions: any;
      const coreWithSpy = {
        validateAndRefresh: async (_session: any, options?: any) => {
          capturedOptions = options;
          return {
            valid: true,
            refreshed: true,
            session: {
              accessToken: 'new-access-token',
              refreshToken: 'new-refresh-token',
              user: mockUser,
              impersonator: undefined,
            },
            claims: {
              sub: 'user_123',
              sid: 'session_123',
              exp: Math.floor(Date.now() / 1000) + 3600,
              org_id: 'org_456',
            },
          };
        },
        encryptSession: async () => 'encrypted-session-data',
      };
      const testOps = new AuthOperations(
        coreWithSpy as any,
        mockClient as any,
        mockConfig as any,
      );

      const session = {
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        user: mockUser,
        impersonator: undefined,
      };

      await testOps.refreshSession(session, 'org_456');

      expect(capturedOptions).toEqual({
        force: true,
        organizationId: 'org_456',
      });
    });

    it('calls validateAndRefresh with force: true and no organizationId when not provided', async () => {
      let capturedOptions: any;
      const coreWithSpy = {
        validateAndRefresh: async (_session: any, options?: any) => {
          capturedOptions = options;
          return {
            valid: true,
            refreshed: true,
            session: {
              accessToken: 'new-access-token',
              refreshToken: 'new-refresh-token',
              user: mockUser,
              impersonator: undefined,
            },
            claims: {
              sub: 'user_123',
              sid: 'session_123',
              exp: Math.floor(Date.now() / 1000) + 3600,
              org_id: 'org_123',
            },
          };
        },
        encryptSession: async () => 'encrypted-session-data',
      };
      const testOps = new AuthOperations(
        coreWithSpy as any,
        mockClient as any,
        mockConfig as any,
      );

      const session = {
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        user: mockUser,
        impersonator: undefined,
      };

      await testOps.refreshSession(session);

      expect(capturedOptions).toEqual({
        force: true,
        organizationId: undefined,
      });
    });
  });

  describe('getAuthorizationUrl()', () => {
    it('returns WorkOS authorization URL', async () => {
      const result = await operations.getAuthorizationUrl();

      expect(result).toContain('client_id=test-client-id');
      expect(result).toContain('redirect_uri');
    });

    it('encodes returnPathname in URL-safe base64 state', async () => {
      const result = await operations.getAuthorizationUrl({
        returnPathname: '/dashboard',
      });

      expect(result).toContain('state=');
      const stateMatch = result.match(/state=([^&]+)/);
      expect(stateMatch).toBeTruthy();

      // Decode URL-safe base64: reverse - to +, _ to /
      const urlSafeState = stateMatch![1];
      const standardBase64 = urlSafeState.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = JSON.parse(atob(standardBase64));
      expect(decoded.returnPathname).toBe('/dashboard');
    });

    it('combines internal state with custom user state', async () => {
      const result = await operations.getAuthorizationUrl({
        returnPathname: '/profile',
        state: 'my-custom-state',
      });

      expect(result).toContain('state=');
      const stateMatch = result.match(/state=([^&]+)/);
      expect(stateMatch).toBeTruthy();

      // State should be in format: internal.userState
      const fullState = stateMatch![1];
      expect(fullState).toContain('.');
      const [internal, userState] = fullState.split('.');
      expect(userState).toBe('my-custom-state');

      // Decode internal part
      const standardBase64 = internal.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = JSON.parse(atob(standardBase64));
      expect(decoded.returnPathname).toBe('/profile');
    });

    it('passes custom state as-is when no returnPathname', async () => {
      const result = await operations.getAuthorizationUrl({
        state: 'only-user-state',
      });

      expect(result).toContain('state=');
      const stateMatch = result.match(/state=([^&]+)/);
      expect(stateMatch).toBeTruthy();

      // State should be passed through directly without internal wrapper
      expect(stateMatch![1]).toBe('only-user-state');
    });

    it('includes screenHint when provided', async () => {
      const result = await operations.getAuthorizationUrl({
        screenHint: 'sign-up',
      });

      expect(result).toContain('screen_hint=sign-up');
    });
  });

  describe('getSignInUrl()', () => {
    it('returns authorization URL with sign-in hint', async () => {
      const result = await operations.getSignInUrl();

      expect(result).toContain('screen_hint=sign-in');
    });
  });

  describe('getSignUpUrl()', () => {
    it('returns authorization URL with sign-up hint', async () => {
      const result = await operations.getSignUpUrl();

      expect(result).toContain('screen_hint=sign-up');
    });
  });
});
