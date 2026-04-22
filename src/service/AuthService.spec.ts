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
    it('returns url + cookieName and writes under the derived per-flow name', async () => {
      const realStorage = makeStorage();
      const authService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      const { url, cookieName, headers } = await authService.createSignIn(
        undefined,
        {
          returnPathname: '/foo',
        },
      );
      expect(url).toMatch(/^https:\/\//);
      expect(cookieName).toMatch(/^wos-auth-verifier-[0-9a-f]{8}$/);

      // Storage must have been called with the derived name, not the legacy name.
      expect(realStorage.cookies.has('wos-auth-verifier')).toBe(false);
      expect(realStorage.cookies.get(cookieName)).toBeTruthy();

      // Set-Cookie header reflects the same name.
      const setCookie = Array.isArray(headers?.['Set-Cookie'])
        ? headers!['Set-Cookie'].join('\n')
        : (headers?.['Set-Cookie'] ?? '');
      expect(setCookie).toContain(`${cookieName}=`);
    });

    it('isolates concurrent flows: two sign-ins produce two distinct cookies', async () => {
      const realStorage = makeStorage();
      const authService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      const a = await authService.createSignIn(undefined, {
        returnPathname: '/a',
      });
      const b = await authService.createSignIn(undefined, {
        returnPathname: '/b',
      });
      expect(a.cookieName).not.toBe(b.cookieName);
      expect(realStorage.cookies.get(a.cookieName)).toBeTruthy();
      expect(realStorage.cookies.get(b.cookieName)).toBeTruthy();
    });

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
      expect(realStorage.cookies.get(result.cookieName)).toBeTruthy();
      expect(result.headers?.['Set-Cookie']).toContain(`${result.cookieName}=`);
      expect(realStorage.lastSetOptions.get(result.cookieName)?.path).toBe('/');
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
      expect(realStorage.cookies.get(result.cookieName)).toBeTruthy();
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
      expect(realStorage.cookies.get(result.cookieName)).toBeTruthy();
    });
  });

  describe('AuthService — pure URL-generation methods', () => {
    it('getAuthorizationUrl returns { url, cookieName } without touching storage', async () => {
      const realStorage = makeStorage();
      const authService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );
      const setCookieSpy = vi.spyOn(realStorage, 'setCookie');
      const result = await authService.getAuthorizationUrl({
        returnPathname: '/foo',
      });

      expect(result.url).toMatch(/^https:\/\//);
      expect(result.cookieName).toMatch(/^wos-auth-verifier-[0-9a-f]{8}$/);
      expect(setCookieSpy).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty('response');
      expect(result).not.toHaveProperty('headers');
    });

    it('getSignInUrl returns { url, cookieName } with sign-in screen hint', async () => {
      const realStorage = makeStorage();
      const authService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );
      const setCookieSpy = vi.spyOn(realStorage, 'setCookie');
      const result = await authService.getSignInUrl({ returnPathname: '/foo' });
      expect(result.url).toContain('screen_hint=sign-in');
      expect(result.cookieName).toMatch(/^wos-auth-verifier-[0-9a-f]{8}$/);
      expect(setCookieSpy).not.toHaveBeenCalled();
    });

    it('getSignUpUrl returns { url, cookieName } with sign-up screen hint', async () => {
      const realStorage = makeStorage();
      const authService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );
      const setCookieSpy = vi.spyOn(realStorage, 'setCookie');
      const result = await authService.getSignUpUrl();
      expect(result.url).toContain('screen_hint=sign-up');
      expect(result.cookieName).toMatch(/^wos-auth-verifier-[0-9a-f]{8}$/);
      expect(setCookieSpy).not.toHaveBeenCalled();
    });
  });

  describe('clearPendingVerifier()', () => {
    it('emits a delete cookie with Path=/', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      const { cookieName } = await realService.createSignIn(undefined);
      const sealedState = realStorage.cookies.get(cookieName)!;

      await realService.clearPendingVerifier('res', { state: sealedState });

      expect(realStorage.lastClearOptions.get(cookieName)?.path).toBe('/');
    });

    it('accepts undefined response for headers-only adapters', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      const { cookieName } = await realService.createSignIn(undefined);
      const sealedState = realStorage.cookies.get(cookieName)!;

      const result = await realService.clearPendingVerifier(undefined, {
        state: sealedState,
      });

      expect(result.headers?.['Set-Cookie']).toContain(`${cookieName}=`);
    });

    it('clears the flow-specific cookie derived from state', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      const { cookieName } = await realService.createSignIn(undefined);
      const sealedState = realStorage.cookies.get(cookieName)!;

      const clearCookieSpy = vi.spyOn(realStorage, 'clearCookie');
      await realService.clearPendingVerifier(undefined, { state: sealedState });

      expect(clearCookieSpy).toHaveBeenCalledWith(
        undefined,
        cookieName,
        expect.any(Object),
      );
    });

    it('threads redirectUri into the cookie options', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      const { cookieName } = await realService.createSignIn(undefined, {
        redirectUri: 'https://custom.example/cb',
      });
      const sealedState = realStorage.cookies.get(cookieName)!;

      await realService.clearPendingVerifier(undefined, {
        state: sealedState,
        redirectUri: 'https://custom.example/cb',
      });

      expect(realStorage.lastClearOptions.get(cookieName)?.path).toBe('/');
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

      const { cookieName } = await realService.createAuthorization('res', {
        returnPathname: '/dashboard',
        state: 'my.custom.state',
      });
      const sealedState = realStorage.cookies.get(cookieName)!;

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

      const { cookieName } = await realService.createAuthorization('res');
      const sealedState = realStorage.cookies.get(cookieName)!;

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
        (setCookie as string[]).some(c => c.startsWith(`${cookieName}=`)),
      ).toBe(true);
      expect(
        (setCookie as string[]).find(c => c.startsWith(`${cookieName}=`)),
      ).toContain('Max-Age=0');
    });

    it('merges lowercase set-cookie headers into an array (case-insensitive)', async () => {
      // Regression: adapters that normalize through Headers objects emit
      // lowercase `set-cookie`.
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

      const { cookieName } = await realService.createAuthorization('res');
      const sealedState = realStorage.cookies.get(cookieName)!;

      const result = await realService.handleCallback('req', 'res', {
        code: 'code',
        state: sealedState,
      });

      const setCookie = result.headers?.['set-cookie'];
      expect(Array.isArray(setCookie)).toBe(true);
      expect(setCookie).toHaveLength(2);
      expect(
        (setCookie as string[]).some(c => c.startsWith('wos-session=')),
      ).toBe(true);
      expect(
        (setCookie as string[]).some(c => c.startsWith(`${cookieName}=`)),
      ).toBe(true);
    });

    it('emits the verifier-delete cookie with Path=/', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      const { cookieName } = await realService.createAuthorization('res');
      const sealedState = realStorage.cookies.get(cookieName)!;

      await realService.handleCallback('req', 'res', {
        code: 'code',
        state: sealedState,
      });

      expect(realStorage.lastClearOptions.get(cookieName)?.path).toBe('/');
    });

    it('throws OAuthStateMismatchError when storage cookie differs from url state', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      const { cookieName } = await realService.createAuthorization('res');
      const sealedState = realStorage.cookies.get(cookieName)!;
      // Tamper the stored cookie under the derived name that
      // handleCallback reads.
      realStorage.cookies.set(cookieName, sealedState.slice(0, -2) + 'XX');

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

      const { cookieName } = await realService.createAuthorization('res');
      const sealedState = realStorage.cookies.get(cookieName)!;
      // Delete the derived-name cookie so handleCallback's read finds
      // nothing — the scenario under test.
      realStorage.cookies.delete(cookieName);

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

      const { cookieName } = await realService.createAuthorization('res');
      const sealedState = realStorage.cookies.get(cookieName)!;

      const result = await realService.handleCallback('req', 'res', {
        code: 'c',
        state: sealedState,
      });

      expect(result.returnPathname).toBe('/');
    });

    it('best-effort clears the verifier cookie on OAuthStateMismatchError', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      const { cookieName } = await realService.createAuthorization('res');
      const sealedState = realStorage.cookies.get(cookieName)!;
      realStorage.cookies.set(cookieName, sealedState.slice(0, -2) + 'XX');

      await expect(
        realService.handleCallback('req', 'res', {
          code: 'code',
          state: sealedState,
        }),
      ).rejects.toThrow(OAuthStateMismatchError);

      expect(realStorage.lastClearOptions.get(cookieName)?.path).toBe('/');
    });

    it('emits a scheme-agnostic (secure=false, sameSite=lax) delete on pre-unseal failure', async () => {
      // Covers the end-to-end case that motivates the schemeAgnostic flag:
      // sign-in used an http:// redirectUri override (secure=false), then
      // the callback hits a pre-unseal error (state mismatch) — we don't
      // know the override at that point, so the fallback delete must drop
      // Secure so the browser accepts the Set-Cookie over http://.
      const realStorage = makeStorage();
      const realService = new AuthService(
        { ...mockConfig, cookieSameSite: 'lax' } as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      const { cookieName } = await realService.createAuthorization('res', {
        redirectUri: 'http://localhost:3000/callback',
      });
      // Confirm the original set was secure=false (the scenario we're
      // proving we can still clean up).
      expect(realStorage.lastSetOptions.get(cookieName)?.secure).toBe(false);
      const sealedState = realStorage.cookies.get(cookieName)!;
      realStorage.cookies.set(cookieName, sealedState.slice(0, -2) + 'XX');

      await expect(
        realService.handleCallback('req', 'res', {
          code: 'code',
          state: sealedState,
        }),
      ).rejects.toThrow(OAuthStateMismatchError);

      const clearOpts = realStorage.lastClearOptions.get(cookieName);
      expect(clearOpts?.secure).toBe(false);
      expect(clearOpts?.sameSite).toBe('lax');
      expect(clearOpts?.path).toBe('/');
    });

    it('keeps Secure on scheme-agnostic delete when sameSite=none (Secure is required)', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        { ...mockConfig, cookieSameSite: 'none' } as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      const { cookieName } = await realService.createAuthorization('res');
      const sealedState = realStorage.cookies.get(cookieName)!;
      realStorage.cookies.set(cookieName, sealedState.slice(0, -2) + 'XX');

      await expect(
        realService.handleCallback('req', 'res', {
          code: 'code',
          state: sealedState,
        }),
      ).rejects.toThrow(OAuthStateMismatchError);

      const clearOpts = realStorage.lastClearOptions.get(cookieName);
      expect(clearOpts?.secure).toBe(true);
      expect(clearOpts?.sameSite).toBe('none');
    });

    it('best-effort clears the verifier cookie on PKCECookieMissingError', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      const { cookieName } = await realService.createAuthorization('res');
      const sealedState = realStorage.cookies.get(cookieName)!;
      // Delete the derived-name cookie so handleCallback's read returns
      // null and triggers the missing-cookie path under test.
      realStorage.cookies.delete(cookieName);

      await expect(
        realService.handleCallback('req', 'res', {
          code: 'code',
          state: sealedState,
        }),
      ).rejects.toThrow(PKCECookieMissingError);

      expect(realStorage.lastClearOptions.get(cookieName)?.path).toBe('/');
    });

    it('best-effort clears the verifier cookie when authenticateWithCode throws', async () => {
      const realStorage = makeStorage();
      const throwingClient = makeClient();
      throwingClient.userManagement.authenticateWithCode = async () => {
        throw new Error('WorkOS exchange failed');
      };
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        throwingClient as any,
        sessionEncryption,
      );

      const { cookieName } = await realService.createAuthorization('res');
      const sealedState = realStorage.cookies.get(cookieName)!;

      await expect(
        realService.handleCallback('req', 'res', {
          code: 'code',
          state: sealedState,
        }),
      ).rejects.toThrow('WorkOS exchange failed');

      expect(realStorage.lastClearOptions.get(cookieName)?.path).toBe('/');
    });

    it('best-effort clears the verifier cookie when saveSession throws', async () => {
      const realStorage = makeStorage();
      realStorage.saveSession = async () => {
        throw new Error('storage write failed');
      };
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      const { cookieName } = await realService.createAuthorization('res');
      const sealedState = realStorage.cookies.get(cookieName)!;

      await expect(
        realService.handleCallback('req', 'res', {
          code: 'code',
          state: sealedState,
        }),
      ).rejects.toThrow('storage write failed');

      expect(realStorage.lastClearOptions.get(cookieName)?.path).toBe('/');
    });

    it('swallows clearCookie errors so the original failure propagates', async () => {
      const realStorage = makeStorage();
      const throwingClient = makeClient();
      throwingClient.userManagement.authenticateWithCode = async () => {
        throw new Error('original exchange failure');
      };
      realStorage.clearCookie = async () => {
        throw new Error('clearCookie blew up');
      };
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        throwingClient as any,
        sessionEncryption,
      );

      const { cookieName } = await realService.createAuthorization('res');
      const sealedState = realStorage.cookies.get(cookieName)!;

      await expect(
        realService.handleCallback('req', 'res', {
          code: 'code',
          state: sealedState,
        }),
      ).rejects.toThrow('original exchange failure');
    });

    it('round-trips redirectUri override through the sealed state into the clear cookie', async () => {
      const realStorage = makeStorage();
      const realService = new AuthService(
        mockConfig as any,
        realStorage as any,
        makeClient() as any,
        sessionEncryption,
      );

      // Override with an http:// URL so the `secure` attribute differs from
      // the https:// default — proves handleCallback used the override.
      const { cookieName } = await realService.createAuthorization('res', {
        redirectUri: 'http://localhost:3000/callback',
      });
      const sealedState = realStorage.cookies.get(cookieName)!;

      expect(realStorage.lastSetOptions.get(cookieName)?.secure).toBe(false);

      await realService.handleCallback('req', 'res', {
        code: 'code',
        state: sealedState,
      });

      expect(realStorage.lastClearOptions.get(cookieName)?.secure).toBe(false);
    });

    describe('per-flow cookie isolation', () => {
      it('reads and clears the cookie derived from URL state', async () => {
        // Start a flow. createSignIn wrote under the derived name.
        const realStorage = makeStorage();
        const authService = new AuthService(
          mockConfig as any,
          realStorage as any,
          makeClient() as any,
          sessionEncryption,
        );
        const { cookieName } = await authService.createSignIn(undefined);
        const sealedState = realStorage.cookies.get(cookieName)!;

        const result = await authService.handleCallback(
          'req' as never,
          'res' as never,
          { code: 'abc', state: sealedState },
        );

        const setCookies = Array.isArray(result.headers?.['Set-Cookie'])
          ? (result.headers!['Set-Cookie'] as string[])
          : ([result.headers?.['Set-Cookie']].filter(Boolean) as string[]);
        const deleteLine = setCookies.find(c =>
          c.startsWith(`${cookieName}=`),
        );
        expect(deleteLine).toBeDefined();
        expect(deleteLine).toContain('Max-Age=0');
      });

      it("does not touch another concurrent flow's cookie", async () => {
        const realStorage = makeStorage();
        const authService = new AuthService(
          mockConfig as any,
          realStorage as any,
          makeClient() as any,
          sessionEncryption,
        );
        const a = await authService.createSignIn(undefined, {
          returnPathname: '/a',
        });
        const b = await authService.createSignIn(undefined, {
          returnPathname: '/b',
        });
        const sealedA = realStorage.cookies.get(a.cookieName)!;

        const result = await authService.handleCallback(
          'req' as never,
          'res' as never,
          { code: 'abc', state: sealedA },
        );

        const setCookies = Array.isArray(result.headers?.['Set-Cookie'])
          ? (result.headers!['Set-Cookie'] as string[])
          : ([result.headers?.['Set-Cookie']].filter(Boolean) as string[]);
        // Flow A's cookie gets a delete. Flow B's cookie must NOT.
        expect(
          setCookies.some(c => c.startsWith(`${a.cookieName}=`)),
        ).toBe(true);
        expect(
          setCookies.some(c => c.startsWith(`${b.cookieName}=`)),
        ).toBe(false);
      });
    });
  });
});
