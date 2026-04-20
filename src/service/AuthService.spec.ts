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

/**
 * Storage mock that remembers the last value passed to setCookie so
 * handleCallback's getCookie read sees what sign-in wrote. Exposes the most
 * recent options per cookie name for path/scope assertions.
 */
function makeStorage(initialSession: string | null = 'encrypted-session-data') {
  const cookies = new Map<string, string>();
  const lastSetOptions = new Map<string, any>();
  const lastClearOptions = new Map<string, any>();
  return {
    cookies,
    lastSetOptions,
    lastClearOptions,
    getSession: async () => initialSession,
    getCookie: async (_req: any, name: string) => cookies.get(name) ?? null,
    setCookie: async (_res: any, name: string, value: string, options: any) => {
      cookies.set(name, value);
      lastSetOptions.set(name, options);
      return {
        headers: {
          'Set-Cookie': `${name}=${value}; Path=${options.path}; Max-Age=${options.maxAge}`,
        },
      };
    },
    clearCookie: async (_res: any, name: string, options: any) => {
      lastClearOptions.set(name, options);
      cookies.delete(name);
      return {
        headers: {
          'Set-Cookie': `${name}=; Path=${options.path}; Max-Age=0`,
        },
      };
    },
    saveSession: async () => ({
      response: 'updated-response',
      headers: { 'Set-Cookie': 'wos-session=encrypted; Path=/; Max-Age=3600' },
    }),
    clearSession: async () => ({
      response: 'cleared-response',
      headers: { 'Set-Cookie': 'wos-session=; Path=/; Max-Age=0' },
    }),
  };
}

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
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    storage = makeStorage();
    service = new AuthService(
      mockConfig as any,
      storage as any,
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
      const emptyStorage = makeStorage(null);
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
        storage as any,
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
      const emptyStorage = makeStorage(null);
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

  describe('createAuthorization()', () => {
    it('returns url and writes the verifier cookie via storage.setCookie', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      const result = await realService.createAuthorization('res');

      expect(result.url).toContain('authorize');
      expect(realStorage.cookies.get('wos-auth-verifier')).toBeTruthy();
      expect(result.headers?.['Set-Cookie']).toContain('wos-auth-verifier=');
      // Default path from config.redirectUri pathname
      expect(realStorage.lastSetOptions.get('wos-auth-verifier')?.path).toBe(
        '/callback',
      );
    });

    it('scopes the verifier cookie path to a per-call redirectUri override', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      await realService.createAuthorization('res', {
        redirectUri: 'https://app.example.com/custom/callback',
      });

      expect(realStorage.lastSetOptions.get('wos-auth-verifier')?.path).toBe(
        '/custom/callback',
      );
    });
  });

  describe('createSignIn()', () => {
    it('returns sign-in URL and writes the verifier cookie', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      const result = await realService.createSignIn('res');

      expect(result.url).toContain('screen_hint=sign-in');
      expect(realStorage.cookies.get('wos-auth-verifier')).toBeTruthy();
    });
  });

  describe('createSignUp()', () => {
    it('returns sign-up URL and writes the verifier cookie', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      const result = await realService.createSignUp('res');

      expect(result.url).toContain('screen_hint=sign-up');
      expect(realStorage.cookies.get('wos-auth-verifier')).toBeTruthy();
    });
  });

  describe('clearPendingVerifier()', () => {
    it('emits a delete cookie with the config-default path', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      await realService.clearPendingVerifier('res');

      expect(realStorage.lastClearOptions.get('wos-auth-verifier')?.path).toBe(
        '/callback',
      );
    });

    it('emits a delete cookie with a per-call redirectUri override path', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      await realService.clearPendingVerifier('res', {
        redirectUri: 'https://app.example.com/custom/callback',
      });

      expect(realStorage.lastClearOptions.get('wos-auth-verifier')?.path).toBe(
        '/custom/callback',
      );
    });

    it('accepts undefined response for headers-only adapters', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      const result = await realService.clearPendingVerifier(undefined);

      expect(result.headers?.['Set-Cookie']).toContain('wos-auth-verifier=');
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
    it('round-trips through createSignIn → handleCallback', async () => {
      const capture: { authCall?: Record<string, unknown> } = {};
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient(capture) as any,
        sessionEncryption,
      );

      await realService.createAuthorization('res', {
        returnPathname: '/dashboard',
        state: 'my.custom.state',
      });
      const sealedState = realStorage.cookies.get('wos-auth-verifier')!;

      const result = await realService.handleCallback('req', 'res', {
        code: 'auth-code-xyz',
        state: sealedState,
      });

      expect(result.authResponse.accessToken).toBe('access-auth-code-xyz');
      expect(result.returnPathname).toBe('/dashboard');
      expect(result.state).toBe('my.custom.state');
      expect(capture.authCall?.codeVerifier).toBe(testVerifier);
    });

    it('returns both session and verifier-delete Set-Cookie as a string[]', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      await realService.createAuthorization('res');
      const sealedState = realStorage.cookies.get('wos-auth-verifier')!;

      const result = await realService.handleCallback('req', 'res', {
        code: 'code',
        state: sealedState,
      });

      const setCookie = result.headers?.['Set-Cookie'];
      expect(Array.isArray(setCookie)).toBe(true);
      expect(setCookie).toHaveLength(2);
      expect(
        (setCookie as string[]).some(c => c.startsWith('wos-session=')),
      ).toBe(true);
      expect(
        (setCookie as string[]).some(c => c.startsWith('wos-auth-verifier=')),
      ).toBe(true);
      expect(
        (setCookie as string[]).find(c => c.startsWith('wos-auth-verifier=')),
      ).toContain('Max-Age=0');
    });

    it('merges lowercase set-cookie headers into an array (case-insensitive)', async () => {
      // Adapters that normalize through Headers objects emit lowercase keys.
      // Without case-insensitive merging, the second bag overwrites the first
      // and one of the two cookies (session or verifier-delete) is lost.
      const realStorage = makeStorage();
      const lowerStorage = {
        ...realStorage,
        setCookie: async (
          _res: any,
          name: string,
          value: string,
          options: any,
        ) => {
          realStorage.cookies.set(name, value);
          realStorage.lastSetOptions.set(name, options);
          return {
            headers: {
              'set-cookie': `${name}=${value}; Path=${options.path}; Max-Age=${options.maxAge}`,
            },
          };
        },
        clearCookie: async (_res: any, name: string, options: any) => {
          realStorage.lastClearOptions.set(name, options);
          realStorage.cookies.delete(name);
          return {
            headers: {
              'set-cookie': `${name}=; Path=${options.path}; Max-Age=0`,
            },
          };
        },
        saveSession: async () => ({
          response: 'updated-response',
          headers: {
            'set-cookie': 'wos-session=encrypted; Path=/; Max-Age=3600',
          },
        }),
      };
      const realService = new AuthService(
        mockConfig as any,
        lowerStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      await realService.createAuthorization('res');
      const sealedState = realStorage.cookies.get('wos-auth-verifier')!;

      const result = await realService.handleCallback('req', 'res', {
        code: 'code',
        state: sealedState,
      });

      const bag = result.headers ?? {};
      const setCookieKey = Object.keys(bag).find(
        k => k.toLowerCase() === 'set-cookie',
      )!;
      const setCookie = bag[setCookieKey];
      expect(Array.isArray(setCookie)).toBe(true);
      expect(setCookie).toHaveLength(2);
      expect(
        (setCookie as string[]).some(c => c.startsWith('wos-session=')),
      ).toBe(true);
      expect(
        (setCookie as string[]).some(c => c.startsWith('wos-auth-verifier=')),
      ).toBe(true);
    });

    it('emits the verifier-delete cookie with the default config path', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      await realService.createAuthorization('res');
      const sealedState = realStorage.cookies.get('wos-auth-verifier')!;

      await realService.handleCallback('req', 'res', {
        code: 'code',
        state: sealedState,
      });

      expect(realStorage.lastClearOptions.get('wos-auth-verifier')?.path).toBe(
        '/callback',
      );
    });

    it('emits the verifier-delete cookie with the per-call redirectUri path when overridden at sign-in', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      await realService.createAuthorization('res', {
        redirectUri: 'https://app.example.com/a/callback',
      });
      const sealedState = realStorage.cookies.get('wos-auth-verifier')!;

      await realService.handleCallback('req', 'res', {
        code: 'code',
        state: sealedState,
      });

      expect(realStorage.lastClearOptions.get('wos-auth-verifier')?.path).toBe(
        '/a/callback',
      );
    });

    it('throws OAuthStateMismatchError when storage cookie differs from url state', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      await realService.createAuthorization('res');
      const sealedState = realStorage.cookies.get('wos-auth-verifier')!;
      // Tamper the stored cookie after sign-in
      realStorage.cookies.set(
        'wos-auth-verifier',
        sealedState.slice(0, -2) + 'XX',
      );

      await expect(
        realService.handleCallback('req', 'res', {
          code: 'code',
          state: sealedState,
        }),
      ).rejects.toThrow(OAuthStateMismatchError);
    });

    it('throws PKCECookieMissingError when storage has no verifier cookie', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      await realService.createAuthorization('res');
      const sealedState = realStorage.cookies.get('wos-auth-verifier')!;
      realStorage.cookies.delete('wos-auth-verifier');

      await expect(
        realService.handleCallback('req', 'res', {
          code: 'code',
          state: sealedState,
        }),
      ).rejects.toThrow(PKCECookieMissingError);
    });

    it('throws OAuthStateMismatchError when state is undefined', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      await realService.createAuthorization('res');

      await expect(
        realService.handleCallback('req', 'res', {
          code: 'code',
          state: undefined,
        }),
      ).rejects.toThrow(OAuthStateMismatchError);
    });

    it('defaults returnPathname to "/" when the sealed state omits it', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      await realService.createAuthorization('res');
      const sealedState = realStorage.cookies.get('wos-auth-verifier')!;

      const result = await realService.handleCallback('req', 'res', {
        code: 'c',
        state: sealedState,
      });

      expect(result.returnPathname).toBe('/');
    });
  });
});
