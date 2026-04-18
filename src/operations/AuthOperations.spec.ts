import sessionEncryption from '../core/encryption/ironWebcryptoEncryption.js';
import { unsealState } from '../core/pkce/state.js';
import { AuthOperations } from './AuthOperations.js';

const mockConfig = {
  clientId: 'test-client-id',
  redirectUri: 'http://localhost:3000/callback',
  cookieName: 'wos-session',
  cookiePassword: 'this-is-a-test-password-that-is-32-characters-long!',
} as const;

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

function makeAuthUrlClient(capture?: { last?: Record<string, unknown> }) {
  return {
    pkce: {
      generate: async () => ({
        codeVerifier: 'generated-verifier-1234567890abcdef',
        codeChallenge: 'generated-challenge',
        codeChallengeMethod: 'S256',
      }),
    },
    userManagement: {
      getLogoutUrl: ({ sessionId, returnTo }: any) =>
        `https://api.workos.com/sso/logout?session_id=${sessionId}&return_to=${returnTo || ''}`,
      getAuthorizationUrl: (opts: any) => {
        if (capture) capture.last = opts;
        const params = new URLSearchParams({
          client_id: opts.clientId,
          redirect_uri: opts.redirectUri,
          state: opts.state ?? '',
          screen_hint: opts.screenHint ?? '',
          code_challenge: opts.codeChallenge ?? '',
          code_challenge_method: opts.codeChallengeMethod ?? '',
        });
        return `https://api.workos.com/sso/authorize?${params.toString()}`;
      },
    },
  };
}

describe('AuthOperations', () => {
  let operations: AuthOperations;
  let capture: { last?: Record<string, unknown> };

  beforeEach(() => {
    capture = {};
    operations = new AuthOperations(
      mockCore as any,
      makeAuthUrlClient(capture) as any,
      mockConfig as any,
      sessionEncryption,
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
      const auth = result.auth as Extract<typeof result.auth, { user: object }>;

      expect(auth.user).toEqual(mockUser);
      expect(auth.accessToken).toBe('new-access-token');
      expect(auth.refreshToken).toBe('new-refresh-token');
      expect(auth.sessionId).toBe('session_123');
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
        makeAuthUrlClient() as any,
        mockConfig as any,
        sessionEncryption,
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
        makeAuthUrlClient() as any,
        mockConfig as any,
        sessionEncryption,
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

  describe('createAuthorization()', () => {
    it('returns url + sealedState + cookieOptions for storage dispatch', async () => {
      const result = await operations.createAuthorization();

      expect(typeof result.url).toBe('string');
      expect(typeof result.sealedState).toBe('string');
      expect(result.sealedState.length).toBeGreaterThan(0);
      expect(result.cookieOptions.maxAge).toBe(600);
      expect(result.cookieOptions.path).toBe('/callback');
      expect(result.url).toContain('client_id=test-client-id');
    });

    it('passes the sealedState as the URL state param (identical string)', async () => {
      const result = await operations.createAuthorization();
      const urlState = decodeURIComponent(
        new URL(result.url).searchParams.get('state') ?? '',
      );

      expect(urlState).toBe(result.sealedState);
    });

    it('includes codeChallenge + codeChallengeMethod in WorkOS URL', async () => {
      await operations.createAuthorization();

      expect(capture.last?.codeChallenge).toBe('generated-challenge');
      expect(capture.last?.codeChallengeMethod).toBe('S256');
    });

    it('seals returnPathname into the state blob', async () => {
      const result = await operations.createAuthorization({
        returnPathname: '/dashboard',
      });
      const unsealed = await unsealState(
        sessionEncryption,
        mockConfig.cookiePassword,
        result.sealedState,
      );

      expect(unsealed.returnPathname).toBe('/dashboard');
      expect(unsealed.codeVerifier).toBe('generated-verifier-1234567890abcdef');
    });

    it('seals customState into the state blob', async () => {
      const result = await operations.createAuthorization({
        state: 'my-custom-state',
      });
      const unsealed = await unsealState(
        sessionEncryption,
        mockConfig.cookiePassword,
        result.sealedState,
      );

      expect(unsealed.customState).toBe('my-custom-state');
    });

    it('seals both returnPathname and customState together', async () => {
      const result = await operations.createAuthorization({
        returnPathname: '/profile',
        state: 'custom',
      });
      const unsealed = await unsealState(
        sessionEncryption,
        mockConfig.cookiePassword,
        result.sealedState,
      );

      expect(unsealed.returnPathname).toBe('/profile');
      expect(unsealed.customState).toBe('custom');
    });

    it('seals per-call redirectUri override into the state blob', async () => {
      const result = await operations.createAuthorization({
        redirectUri: 'https://app.example.com/custom/callback',
      });
      const unsealed = await unsealState(
        sessionEncryption,
        mockConfig.cookiePassword,
        result.sealedState,
      );

      expect(unsealed.redirectUri).toBe(
        'https://app.example.com/custom/callback',
      );
    });

    it('omits redirectUri from the state blob when using the config default', async () => {
      const result = await operations.createAuthorization();
      const unsealed = await unsealState(
        sessionEncryption,
        mockConfig.cookiePassword,
        result.sealedState,
      );

      expect(unsealed.redirectUri).toBeUndefined();
    });

    it('includes screenHint when provided', async () => {
      const result = await operations.createAuthorization({
        screenHint: 'sign-up',
      });

      expect(result.url).toContain('screen_hint=sign-up');
    });

    it('generates a unique nonce per call (concurrent last-flow-wins)', async () => {
      const a = await operations.createAuthorization();
      const b = await operations.createAuthorization();

      expect(a.sealedState).not.toBe(b.sealedState);
    });
  });

  describe('createSignIn()', () => {
    it('returns authorization URL with sign-in hint', async () => {
      const result = await operations.createSignIn();

      expect(result.url).toContain('screen_hint=sign-in');
    });
  });

  describe('createSignUp()', () => {
    it('returns authorization URL with sign-up hint', async () => {
      const result = await operations.createSignUp();

      expect(result.url).toContain('screen_hint=sign-up');
    });
  });
});
