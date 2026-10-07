/**
 * Wire-level tests for public-client (keyless) mode.
 *
 * These drive the real sign-in, callback and refresh paths through
 * `createAuthService` and the real WorkOS SDK, with only `fetch` mocked, and
 * assert on the request the SDK actually sends to
 * `/user_management/authenticate`.
 */
import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import sessionEncryption from '../core/encryption/ironWebcryptoEncryption.js';
import { CookieSessionStorage } from '../core/session/CookieSessionStorage.js';
import type { AuthKitConfig } from '../core/config/types.js';

const API_KEY = 'sk_test_confidential';
const CLIENT_ID = 'client_123';
const env: Record<string, string> = {
  WORKOS_CLIENT_ID: CLIENT_ID,
  WORKOS_REDIRECT_URI: 'http://localhost:3000/callback',
  WORKOS_COOKIE_PASSWORD: 'a'.repeat(32),
};

class RequestStorage extends CookieSessionStorage<Request, undefined> {
  async getCookie(request: Request, name: string): Promise<string | null> {
    for (const part of (request.headers.get('cookie') ?? '').split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k === name) return decodeURIComponent(rest.join('='));
    }
    return null;
  }
}

function cookiePair(setCookie: string | string[] | undefined) {
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return first!.split(';')[0]!;
}

// One signing key per run; the mocked JWKS endpoint serves its public half so
// `withAuth` verifies tokens exactly as it does in production.
const signingKey = generateKeyPair('RS256');
async function signAccessToken(expiresAt: number) {
  const { privateKey } = await signingKey;
  return new SignJWT({ sid: 'session_123' })
    .setProtectedHeader({ alg: 'RS256', kid: 'key_1' })
    .setIssuedAt(expiresAt - 300)
    .setExpirationTime(expiresAt)
    .sign(privateKey);
}

function authenticateResponse(accessToken: string, refreshToken: string) {
  return Response.json({
    user: {
      object: 'user',
      id: 'user_123',
      email: 'test@example.com',
      email_verified: true,
      first_name: 'Test',
      last_name: 'User',
      profile_picture_url: null,
      last_sign_in_at: null,
      locale: null,
      external_id: null,
      metadata: {},
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    access_token: accessToken,
    refresh_token: refreshToken,
  });
}

describe.each([
  ['public client (no API key)', undefined],
  ['confidential client (API key)', API_KEY],
] as const)('%s', (_label, apiKey) => {
  let savedApiKey: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;
  let authenticateCalls: { body: any; authorization: string | null }[];
  let nextAuthenticate: () => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    // The SDK falls back to process.env.WORKOS_API_KEY, so a key in the test
    // runner's environment would silently turn the public case confidential.
    savedApiKey = process.env.WORKOS_API_KEY;
    delete process.env.WORKOS_API_KEY;

    const jwk = await exportJWK((await signingKey).publicKey);
    authenticateCalls = [];
    fetchMock = vi.fn(async (input: string | URL | Request, init?: any) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === `https://api.workos.com/sso/jwks/${CLIENT_ID}`) {
        return Response.json({
          keys: [{ ...jwk, kid: 'key_1', alg: 'RS256' }],
        });
      }
      if (url === 'https://api.workos.com/user_management/authenticate') {
        authenticateCalls.push({
          body: JSON.parse(init.body),
          authorization: new Headers(init.headers).get('Authorization'),
        });
        return nextAuthenticate();
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    // The SDK binds fetch when the client is constructed (lazily, below).
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedApiKey !== undefined) process.env.WORKOS_API_KEY = savedApiKey;
  });

  async function createService() {
    const { configure } = await import('../core/config.js');
    const { createAuthService } = await import('./factory.js');
    const source = apiKey ? { ...env, WORKOS_API_KEY: apiKey } : env;
    configure(key => source[key]);
    return createAuthService({
      sessionStorageFactory: (config: AuthKitConfig) =>
        new RequestStorage(config),
    });
  }

  function expectClientCredentials(call: {
    body: any;
    authorization: string | null;
  }) {
    if (apiKey) {
      expect(call.body.client_secret).toBe(apiKey);
      expect(call.authorization).toBe(`Bearer ${apiKey}`);
    } else {
      expect(call.body).not.toHaveProperty('client_secret');
      expect(call.authorization).toBeNull();
    }
  }

  it('builds the client in the expected mode', async () => {
    const service = await createService();
    expect(service.getWorkOS().key).toBe(apiKey);
  });

  it('signs in with PKCE, exchanges the code and refreshes the session', async () => {
    const service = await createService();
    const now = Math.floor(Date.now() / 1000);

    // 1. Sign in: PKCE challenge in the URL, verifier sealed into a cookie.
    const signIn = await service.createSignIn(undefined);
    const authorizationUrl = new URL(signIn.url);
    expect(authorizationUrl.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(authorizationUrl.searchParams.get('code_challenge')).toBeTruthy();
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe(
      'S256',
    );
    const state = authorizationUrl.searchParams.get('state')!;

    // 2. Callback: exchange the code with the verifier.
    nextAuthenticate = async () =>
      authenticateResponse(await signAccessToken(now + 300), 'refresh_1');
    const callback = await service.handleCallback(
      new Request(`${env.WORKOS_REDIRECT_URI}?code=code_123&state=${state}`, {
        headers: { cookie: cookiePair(signIn.headers?.['Set-Cookie']) },
      }),
      undefined,
      { code: 'code_123', state },
    );
    expect(callback.authResponse.user.id).toBe('user_123');

    expect(authenticateCalls).toHaveLength(1);
    const exchange = authenticateCalls[0]!;
    expect(exchange.body).toMatchObject({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: 'code_123',
      code_verifier: expect.any(String),
    });
    // The verifier sent must be the one behind the URL's S256 challenge.
    expect(
      createHash('sha256')
        .update(exchange.body.code_verifier)
        .digest('base64url'),
    ).toBe(authorizationUrl.searchParams.get('code_challenge'));
    expectClientCredentials(exchange);

    // 3. Explicit refresh of the saved session.
    const sessionCookie = cookiePair(callback.headers?.['Set-Cookie']);
    expect(sessionCookie).toMatch(/^wos-session=/);
    const session = await service.getSession(
      new Request('http://localhost:3000/', {
        headers: { cookie: sessionCookie },
      }),
    );
    nextAuthenticate = async () =>
      authenticateResponse(await signAccessToken(now + 600), 'refresh_2');
    const refreshed = await service.refreshSession(session!);
    if (!refreshed.auth.user) throw new Error('expected a signed-in user');
    expect(refreshed.auth.user.id).toBe('user_123');
    expect(refreshed.auth.refreshToken).toBe('refresh_2');

    expect(authenticateCalls).toHaveLength(2);
    const refresh = authenticateCalls[1]!;
    expect(refresh.body).toMatchObject({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: 'refresh_1',
    });
    expectClientCredentials(refresh);
  });

  it('refreshes an expired session automatically in withAuth', async () => {
    const service = await createService();
    const now = Math.floor(Date.now() / 1000);
    const sealed = await sessionEncryption.sealData(
      {
        accessToken: await signAccessToken(now - 60), // expired
        refreshToken: 'refresh_1',
        user: { id: 'user_123' },
      },
      { password: env.WORKOS_COOKIE_PASSWORD!, ttl: 0 },
    );
    const { headers } = await service.saveSession(undefined, sealed);

    nextAuthenticate = async () =>
      authenticateResponse(await signAccessToken(now + 300), 'refresh_2');
    const { auth, refreshedSessionData } = await service.withAuth(
      new Request('http://localhost:3000/', {
        headers: { cookie: cookiePair(headers?.['Set-Cookie']) },
      }),
    );

    expect(auth.user?.id).toBe('user_123');
    expect(refreshedSessionData).toEqual(expect.any(String));
    expect(authenticateCalls).toHaveLength(1);
    expect(authenticateCalls[0]!.body).toMatchObject({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: 'refresh_1',
    });
    expectClientCredentials(authenticateCalls[0]!);
  });

  it.runIf(!apiKey)(
    'rejects WorkOS management calls before any network request',
    async () => {
      const { ApiKeyRequiredException } = await import('@workos-inc/node');
      const service = await createService();
      const workos = service.getWorkOS();

      // The SDK owns this error (AuthKit doesn't wrap the client); pin that it
      // is the actionable API-key error for the called path, not a 401.
      for (const [call, path] of [
        [
          () => workos.userManagement.getUser('user_123'),
          '/user_management/users/user_123',
        ],
        [() => workos.organizations.listOrganizations(), '/organizations'],
      ] as const) {
        const error = await call().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ApiKeyRequiredException);
        expect(error).toMatchObject({ status: 403, path });
        expect((error as Error).message).toContain(
          `API key required for "${path}"`,
        );
        expect((error as Error).message).toContain('new WorkOS("sk_...")');
      }
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
