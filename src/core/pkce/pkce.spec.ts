import { AuthKitCore } from '../AuthKitCore.js';
import sessionEncryption from '../encryption/ironWebcryptoEncryption.js';
import {
  OAuthStateMismatchError,
  PKCECookieMissingError,
  SessionEncryptionError,
} from '../errors.js';
import { generateAuthorizationUrl } from './generateAuthorizationUrl.js';

const config = {
  clientId: 'test-client-id',
  apiKey: 'test-api-key',
  redirectUri: 'https://app.example.com/callback',
  cookiePassword: 'this-is-a-test-password-that-is-32-characters-long!',
} as const;

const mockClient = {
  pkce: {
    generate: async () => ({
      codeVerifier: 'verifier-' + crypto.randomUUID(),
      codeChallenge: 'challenge-' + crypto.randomUUID(),
      codeChallengeMethod: 'S256',
    }),
  },
  userManagement: {
    getAuthorizationUrl: (opts: any) => {
      const params = new URLSearchParams({
        client_id: opts.clientId,
        redirect_uri: opts.redirectUri,
        state: opts.state ?? '',
        code_challenge: opts.codeChallenge ?? '',
        code_challenge_method: opts.codeChallengeMethod ?? '',
      });
      return `https://api.workos.com/sso/authorize?${params.toString()}`;
    },
    getJwksUrl: () => 'https://api.workos.com/sso/jwks/test-client-id',
  },
} as const;

function makeCore() {
  return new AuthKitCore(config as any, mockClient as any, sessionEncryption);
}

describe('PKCE end-to-end round-trip', () => {
  it('verifyCallbackState recovers the sealed state after generateAuthorizationUrl', async () => {
    const core = makeCore();
    const { sealedState } = await generateAuthorizationUrl({
      client: mockClient as any,
      config: config as any,
      encryption: sessionEncryption,
      options: {
        returnPathname: '/dashboard',
        state: 'user-opaque',
      },
    });

    const result = await core.verifyCallbackState({
      stateFromUrl: sealedState,
      cookieValue: sealedState,
    });

    expect(result.returnPathname).toBe('/dashboard');
    expect(result.customState).toBe('user-opaque');
    expect(typeof result.codeVerifier).toBe('string');
    expect(typeof result.nonce).toBe('string');
  });

  it('round-trips customState containing dots byte-identically', async () => {
    const core = makeCore();
    const customWithDots = 'a.b.c.d.e';
    const { sealedState } = await generateAuthorizationUrl({
      client: mockClient as any,
      config: config as any,
      encryption: sessionEncryption,
      options: { state: customWithDots },
    });

    const result = await core.verifyCallbackState({
      stateFromUrl: sealedState,
      cookieValue: sealedState,
    });

    expect(result.customState).toBe(customWithDots);
  });

  it('tampering a single byte of the cookie value throws OAuthStateMismatchError', async () => {
    const core = makeCore();
    const { sealedState } = await generateAuthorizationUrl({
      client: mockClient as any,
      config: config as any,
      encryption: sessionEncryption,
      options: {},
    });

    // Mutate one char
    const mid = Math.floor(sealedState.length / 2);
    const tampered =
      sealedState.slice(0, mid) +
      (sealedState[mid] === 'a' ? 'b' : 'a') +
      sealedState.slice(mid + 1);

    await expect(
      core.verifyCallbackState({
        stateFromUrl: sealedState,
        cookieValue: tampered,
      }),
    ).rejects.toThrow(OAuthStateMismatchError);
  });

  it('missing cookie throws PKCECookieMissingError with deploy-debug guidance', async () => {
    const core = makeCore();
    const { sealedState } = await generateAuthorizationUrl({
      client: mockClient as any,
      config: config as any,
      encryption: sessionEncryption,
      options: {},
    });

    const err = await core
      .verifyCallbackState({
        stateFromUrl: sealedState,
        cookieValue: undefined,
      })
      .catch(e => e);

    expect(err).toBeInstanceOf(PKCECookieMissingError);
    expect(err.message).toContain('Set-Cookie');
  });

  it('empty-string cookieValue is treated as missing (falsy check)', async () => {
    const core = makeCore();
    const { sealedState } = await generateAuthorizationUrl({
      client: mockClient as any,
      config: config as any,
      encryption: sessionEncryption,
      options: {},
    });

    await expect(
      core.verifyCallbackState({
        stateFromUrl: sealedState,
        cookieValue: '',
      }),
    ).rejects.toThrow(PKCECookieMissingError);
  });

  it('missing URL state throws OAuthStateMismatchError', async () => {
    const core = makeCore();

    await expect(
      core.verifyCallbackState({
        stateFromUrl: undefined,
        cookieValue: 'whatever',
      }),
    ).rejects.toThrow(OAuthStateMismatchError);
  });

  it('concurrent sign-ins produce distinct sealedStates (last-flow-wins)', async () => {
    const core = makeCore();
    const a = await generateAuthorizationUrl({
      client: mockClient as any,
      config: config as any,
      encryption: sessionEncryption,
      options: {},
    });
    const b = await generateAuthorizationUrl({
      client: mockClient as any,
      config: config as any,
      encryption: sessionEncryption,
      options: {},
    });

    expect(a.sealedState).not.toBe(b.sealedState);

    // Using A's state with B's cookie value (or vice versa) must fail.
    await expect(
      core.verifyCallbackState({
        stateFromUrl: a.sealedState,
        cookieValue: b.sealedState,
      }),
    ).rejects.toThrow(OAuthStateMismatchError);
  });

  describe('TTL expiry through the public verify path', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('throws SessionEncryptionError when TTL expires between sign-in and callback', async () => {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const core = makeCore();
      const { sealedState } = await generateAuthorizationUrl({
        client: mockClient as any,
        config: config as any,
        encryption: sessionEncryption,
        options: {},
      });

      // 600s TTL + 60s skew, advance past it.
      vi.setSystemTime(new Date('2026-01-01T00:11:05.000Z'));

      await expect(
        core.verifyCallbackState({
          stateFromUrl: sealedState,
          cookieValue: sealedState,
        }),
      ).rejects.toThrow(SessionEncryptionError);
    });
  });
});
