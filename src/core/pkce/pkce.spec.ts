import { AuthKitCore } from '../AuthKitCore.js';
import sessionEncryption from '../encryption/ironWebcryptoEncryption.js';
import { OAuthStateMismatchError, PKCECookieMissingError } from '../errors.js';
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

function generate(options: Parameters<typeof generateAuthorizationUrl>[0]['options'] = {}) {
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
