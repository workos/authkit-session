import sessionEncryption from '../core/encryption/ironWebcryptoEncryption.js';
import {
  OAuthStateMismatchError,
  PKCECookieMissingError,
} from '../core/errors.js';
import { AuthService } from './AuthService.js';

const mockConfig = {
  clientId: 'test-client-id',
  apiKey: 'test-api-key',
  redirectUri: 'https://app.example.com/callback',
  cookiePassword: 'this-is-a-test-password-that-is-32-characters-long!',
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
  clearSession: async () => ({
    response: 'cleared-response',
    headers: { 'Set-Cookie': 'wos-session=; Path=/; Max-Age=0' },
  }),
};

const testVerifier = 'test-verifier-abcdefghijklmnopqrstuvwxyz1234567890';

function makeClient(capture?: { authCall?: Record<string, unknown> }) {
  return {
    userManagement: {
      getJwksUrl: () => 'https://api.workos.com/sso/jwks/test-client-id',
      getAuthorizationUrl: (opts: any) => {
        const params = new URLSearchParams({
          state: opts.state ?? '',
          screen_hint: opts.screenHint ?? '',
        });
        return `https://api.workos.com/sso/authorize?${params.toString()}`;
      },
      authenticateWithCode: async (opts: any) => {
        if (capture) capture.authCall = opts;
        return {
          accessToken: `access-${opts.code}`,
          refreshToken: `refresh-${opts.code}`,
          user: mockUser,
          impersonator: undefined,
        };
      },
      getLogoutUrl: ({ sessionId }: any) =>
        `https://api.workos.com/sso/logout?session_id=${sessionId}`,
    },
    pkce: {
      generate: async () => ({
        codeVerifier: testVerifier,
        codeChallenge: 'test-challenge',
        codeChallengeMethod: 'S256',
      }),
    },
  };
}

// For withAuth / getSession tests — returns a decrypted Session-shaped blob.
const mockEncryptionSessionShape = {
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
      makeClient() as any,
      mockEncryptionSessionShape as any,
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
        makeClient() as any,
        mockEncryptionSessionShape as any,
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
        makeClient() as any,
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
        makeClient() as any,
        mockEncryptionSessionShape as any,
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
    it('returns logout URL and headers from storage', async () => {
      const result = await service.signOut('session_123');

      expect(result.logoutUrl).toContain('session_id=session_123');
      expect(result.headers).toBeDefined();
      expect(result.headers?.['Set-Cookie']).toContain('wos-session=');
    });
  });

  describe('getAuthorizationUrl()', () => {
    it('returns url + sealedState + cookieOptions triple', async () => {
      const client = makeClient();
      const realService = new AuthService(
        mockConfig as any,
        mockStorage as any,
        client as any,
        sessionEncryption,
      );

      const result = await realService.getAuthorizationUrl();

      expect(result.url).toContain('authorize');
      expect(result.sealedState.length).toBeGreaterThan(0);
      expect(result.cookieOptions.name).toBe('wos-auth-verifier');
    });
  });

  describe('getSignInUrl()', () => {
    it('returns sign-in URL in the triple shape', async () => {
      const realService = new AuthService(
        mockConfig as any,
        mockStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      const result = await realService.getSignInUrl();

      expect(result.url).toContain('screen_hint=sign-in');
    });
  });

  describe('getSignUpUrl()', () => {
    it('returns sign-up URL in the triple shape', async () => {
      const realService = new AuthService(
        mockConfig as any,
        mockStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      const result = await realService.getSignUpUrl();

      expect(result.url).toContain('screen_hint=sign-up');
    });
  });

  describe('getPKCECookieOptions()', () => {
    it('returns PKCE cookie options derived from config', () => {
      const opts = service.getPKCECookieOptions();

      expect(opts.name).toBe('wos-auth-verifier');
      expect(opts.path).toBe('/callback'); // scoped from config redirectUri
      expect(opts.httpOnly).toBe(true);
      expect(opts.maxAge).toBe(600);
      expect(opts.secure).toBe(true); // https redirectUri
    });

    it('derives secure from explicit redirectUri arg', () => {
      const opts = service.getPKCECookieOptions('http://localhost:3000/cb');

      expect(opts.secure).toBe(false);
    });
  });

  describe('buildPKCEDeleteCookieHeader()', () => {
    it('returns a Set-Cookie header deleting the verifier cookie', () => {
      const header = service.buildPKCEDeleteCookieHeader();

      expect(header).toContain('wos-auth-verifier=;');
      expect(header).toContain('Max-Age=0');
      expect(header).toContain('HttpOnly');
    });
  });

  describe('getWorkOS()', () => {
    it('returns WorkOS client', () => {
      const result = service.getWorkOS();

      expect(result).toBeDefined();
      expect(typeof (result as any).userManagement.getJwksUrl).toBe('function');
    });
  });

  describe('handleCallback()', () => {
    it('round-trips through getAuthorizationUrl → handleCallback', async () => {
      const capture: { authCall?: Record<string, unknown> } = {};
      const realService = new AuthService(
        mockConfig as any,
        mockStorage as any,
        makeClient(capture) as any,
        sessionEncryption,
      );

      const { sealedState } = await realService.getAuthorizationUrl({
        returnPathname: '/dashboard',
        state: 'my.custom.state',
      });

      const result = await realService.handleCallback('req', 'res', {
        code: 'auth-code-xyz',
        state: sealedState,
        cookieValue: sealedState,
      });

      expect(result.authResponse.accessToken).toBe('access-auth-code-xyz');
      expect(result.returnPathname).toBe('/dashboard');
      expect(result.state).toBe('my.custom.state');
      expect(capture.authCall?.codeVerifier).toBe(testVerifier);
    });

    it('throws OAuthStateMismatchError when cookieValue differs from state', async () => {
      const realService = new AuthService(
        mockConfig as any,
        mockStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      const { sealedState } = await realService.getAuthorizationUrl();
      // Tamper one byte in the cookie copy
      const tampered = sealedState.slice(0, -2) + 'XX';

      await expect(
        realService.handleCallback('req', 'res', {
          code: 'code',
          state: sealedState,
          cookieValue: tampered,
        }),
      ).rejects.toThrow(OAuthStateMismatchError);
    });

    it('throws PKCECookieMissingError when cookieValue is undefined', async () => {
      const realService = new AuthService(
        mockConfig as any,
        mockStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      const { sealedState } = await realService.getAuthorizationUrl();

      await expect(
        realService.handleCallback('req', 'res', {
          code: 'code',
          state: sealedState,
          cookieValue: undefined,
        }),
      ).rejects.toThrow(PKCECookieMissingError);
    });

    it('throws OAuthStateMismatchError when state is undefined', async () => {
      const realService = new AuthService(
        mockConfig as any,
        mockStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      await expect(
        realService.handleCallback('req', 'res', {
          code: 'code',
          state: undefined,
          cookieValue: 'something',
        }),
      ).rejects.toThrow(OAuthStateMismatchError);
    });

    it('defaults returnPathname to "/" when the sealed state omits it', async () => {
      const capture: { authCall?: Record<string, unknown> } = {};
      const realService = new AuthService(
        mockConfig as any,
        mockStorage as any,
        makeClient(capture) as any,
        sessionEncryption,
      );

      const { sealedState } = await realService.getAuthorizationUrl({
        // no returnPathname
      });

      const result = await realService.handleCallback('req', 'res', {
        code: 'c',
        state: sealedState,
        cookieValue: sealedState,
      });

      expect(result.returnPathname).toBe('/');
    });
  });
});
