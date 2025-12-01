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
  refreshTokens: async () => ({
    accessToken: 'new-access-token',
    refreshToken: 'new-refresh-token',
    user: mockUser,
    impersonator: undefined,
  }),
  encryptSession: async () => 'encrypted-session-data',
  parseTokenClaims: () => ({
    sub: 'user_123',
    sid: 'session_123',
    exp: Math.floor(Date.now() / 1000) + 3600,
    org_id: 'org_123',
  }),
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

  describe('signOut()', () => {
    it('returns logout URL and clear cookie header', async () => {
      const result = await operations.signOut('session_123');

      expect(result.logoutUrl).toContain('session_id=session_123');
      expect(result.clearCookieHeader).toContain('wos-session=');
      expect(result.clearCookieHeader).toContain('Max-Age=0');
    });

    it('includes returnTo in logout URL', async () => {
      const result = await operations.signOut('session_123', {
        returnTo: 'http://localhost:3000',
      });

      expect(result.logoutUrl).toContain('return_to=');
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
      expect(result.auth.accessToken).toBe('new-access-token');
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

    it('includes organizationId when provided', async () => {
      const coreWithSpy = {
        refreshTokens: async (_token: string, orgId?: string) => ({
          accessToken: orgId ? 'org-token' : 'regular-token',
          refreshToken: 'new-refresh-token',
          user: mockUser,
          impersonator: undefined,
        }),
        encryptSession: async () => 'encrypted-session-data',
        parseTokenClaims: () => ({
          sub: 'user_123',
          sid: 'session_123',
          exp: Math.floor(Date.now() / 1000) + 3600,
          org_id: 'org_123',
        }),
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

      const result = await testOps.refreshSession(session, 'org_456');

      expect(result.auth.accessToken).toBe('org-token');
    });

    it('extracts org from current token when not provided', async () => {
      const validJwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyIsInNpZCI6InNlc3Npb25fMTIzIiwiZXhwIjoxNzM2Mzc2MDAwLCJvcmdfaWQiOiJvcmdfZnJvbV90b2tlbiJ9.fake-signature';

      const coreWithSpy = {
        refreshTokens: async (_token: string, orgId?: string) => ({
          accessToken:
            orgId === 'org_from_token' ? 'extracted-org-token' : 'no-org-token',
          refreshToken: 'new-refresh-token',
          user: mockUser,
          impersonator: undefined,
        }),
        encryptSession: async () => 'encrypted-session-data',
        parseTokenClaims: () => ({
          sub: 'user_123',
          sid: 'session_123',
          exp: 1736376000,
          org_id: 'org_from_token',
        }),
      };
      const testOps = new AuthOperations(
        coreWithSpy as any,
        mockClient as any,
        mockConfig as any,
      );

      const session = {
        accessToken: validJwt,
        refreshToken: 'test-refresh',
        user: mockUser,
        impersonator: undefined,
      };

      const result = await testOps.refreshSession(session);

      expect(result.auth.accessToken).toBe('extracted-org-token');
    });
  });

  describe('getAuthorizationUrl()', () => {
    it('returns WorkOS authorization URL', async () => {
      const result = await operations.getAuthorizationUrl();

      expect(result).toContain('client_id=test-client-id');
      expect(result).toContain('redirect_uri');
    });

    it('encodes returnPathname in state', async () => {
      const result = await operations.getAuthorizationUrl({
        returnPathname: '/dashboard',
      });

      expect(result).toContain('state=');
      const stateMatch = result.match(/state=([^&]+)/);
      expect(stateMatch).toBeTruthy();
      const decoded = JSON.parse(atob(stateMatch![1]));
      expect(decoded.returnPathname).toBe('/dashboard');
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
