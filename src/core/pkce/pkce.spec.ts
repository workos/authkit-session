import { AuthKitCore } from '../AuthKitCore.js';
import sessionEncryption from '../encryption/ironWebcryptoEncryption.js';
import {
  OAuthStateMismatchError,
  PKCECookieMissingError,
  PKCEPayloadTooLargeError,
} from '../errors.js';
import { getPKCECookieNameForState } from './cookieName.js';
import {
  generateAuthorizationUrl,
  PKCE_MAX_COOKIE_BYTES,
  PKCE_MAX_STATE_BYTES,
} from './generateAuthorizationUrl.js';

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

function generate(
  options: Parameters<typeof generateAuthorizationUrl>[0]['options'] = {},
) {
  return generateAuthorizationUrl({
    client: mockClient as any,
    config: config as any,
    encryption: sessionEncryption,
    options,
  });
}

// Tamper, missing cookie, missing state, TTL, and single-byte custom-state
// round-trip are covered in state.spec.ts and AuthKitCore.spec.ts. These
// tests exercise the integration seam (generateAuthorizationUrl →
// verifyCallbackState) for behaviors that only emerge when both modules
// run together.
describe('PKCE end-to-end round-trip', () => {
  it('verifyCallbackState recovers the sealed state after generateAuthorizationUrl', async () => {
    const core = makeCore();
    const { sealedState } = await generate({
      returnPathname: '/dashboard',
      state: 'user-opaque',
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

  it('empty-string cookieValue is treated as missing (falsy check)', async () => {
    const core = makeCore();
    const { sealedState } = await generate();

    await expect(
      core.verifyCallbackState({ stateFromUrl: sealedState, cookieValue: '' }),
    ).rejects.toThrow(PKCECookieMissingError);
  });

  it('returns cookieName derived from the sealed state', async () => {
    const result = await generate();
    expect(result.cookieName).toBe(getPKCECookieNameForState(result.sealedState));
    expect(result.cookieName).toMatch(/^wos-auth-verifier-[0-9a-f]{8}$/);
  });

  it('concurrent sign-ins produce distinct sealedStates (cross-flow rejection)', async () => {
    const core = makeCore();
    const a = await generate();
    const b = await generate();

    expect(a.sealedState).not.toBe(b.sealedState);
    await expect(
      core.verifyCallbackState({
        stateFromUrl: a.sealedState,
        cookieValue: b.sealedState,
      }),
    ).rejects.toThrow(OAuthStateMismatchError);
  });
});

describe('PKCE payload size guards', () => {
  it(`accepts custom state at the ${PKCE_MAX_STATE_BYTES}-byte supported limit`, async () => {
    const state = 'a'.repeat(PKCE_MAX_STATE_BYTES);
    await expect(generate({ state })).resolves.toMatchObject({
      sealedState: expect.any(String),
    });
  });

  it(`rejects custom state ${PKCE_MAX_STATE_BYTES + 1} bytes or larger before sealing`, async () => {
    const state = 'a'.repeat(PKCE_MAX_STATE_BYTES + 1);
    await expect(generate({ state })).rejects.toThrow(PKCEPayloadTooLargeError);
  });

  it('counts state size in UTF-8 bytes, not JS characters (multibyte input)', async () => {
    // 2-byte UTF-8 char; 1025 chars = 2050 bytes > 2048.
    const state = '\u00e9'.repeat(1025);
    await expect(generate({ state })).rejects.toThrow(PKCEPayloadTooLargeError);
  });

  it('rejects oversized serialized cookie from large returnPathname + near-limit state', async () => {
    // Under the per-field state cap, but the sealed cookie still overflows
    // once returnPathname is concatenated into the payload.
    const state = 'a'.repeat(PKCE_MAX_STATE_BYTES);
    const returnPathname = '/' + 'p'.repeat(2048);
    await expect(generate({ state, returnPathname })).rejects.toThrow(
      PKCEPayloadTooLargeError,
    );
  });

  it('shrinks the effective budget when cookieDomain adds attribute bytes', async () => {
    // cookieDomain=<long> is serialized into every Set-Cookie and counts
    // against the browser's per-cookie budget. A state payload that fits
    // without a Domain attribute can push the serialized header over the
    // limit when Domain is present.
    const longDomain = 'sub.' + 'd'.repeat(200) + '.example.com';
    const configWithDomain = { ...config, cookieDomain: longDomain } as any;

    const state = 'a'.repeat(PKCE_MAX_STATE_BYTES);
    await expect(
      generateAuthorizationUrl({
        client: mockClient as any,
        config: configWithDomain,
        encryption: sessionEncryption,
        options: { state, returnPathname: '/' + 'p'.repeat(700) },
      }),
    ).rejects.toThrow(PKCEPayloadTooLargeError);
  });

  it(`error message names PKCE_MAX_COOKIE_BYTES (${PKCE_MAX_COOKIE_BYTES})`, async () => {
    const state = 'a'.repeat(PKCE_MAX_STATE_BYTES);
    const returnPathname = '/' + 'p'.repeat(2048);
    try {
      await generate({ state, returnPathname });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PKCEPayloadTooLargeError);
      expect((err as Error).message).toContain(String(PKCE_MAX_COOKIE_BYTES));
    }
  });
});
