import sessionEncryption from '../encryption/ironWebcryptoEncryption.js';
import { SessionEncryptionError } from '../errors.js';
import { sealState, unsealState, type PKCEState } from './state.js';

const testPassword = 'this-is-a-test-password-that-is-32-characters-long!';

const validState: PKCEState = {
  nonce: '8b7b1c32-7d8f-44f9-aa51-4c3a6c8fb8d9',
  codeVerifier: 'verifier-12345678901234567890123456789012345678',
  returnPathname: '/dashboard',
  customState: 'user-custom',
};

describe('PKCE state seal/unseal', () => {
  it('round-trips a valid state', async () => {
    const sealed = await sealState(sessionEncryption, testPassword, validState);
    const unsealed = await unsealState(sessionEncryption, testPassword, sealed);

    expect(unsealed).toEqual(validState);
  });

  it('round-trips without optional fields', async () => {
    const minimal: PKCEState = {
      nonce: 'n',
      codeVerifier: 'v',
    };
    const sealed = await sealState(sessionEncryption, testPassword, minimal);
    const unsealed = await unsealState(sessionEncryption, testPassword, sealed);

    expect(unsealed).toEqual(minimal);
  });

  it('preserves customState with dots exactly', async () => {
    const withDots: PKCEState = {
      nonce: 'n',
      codeVerifier: 'v',
      customState: 'has.many.dots.in.it',
    };
    const sealed = await sealState(sessionEncryption, testPassword, withDots);
    const unsealed = await unsealState(sessionEncryption, testPassword, sealed);

    expect(unsealed.customState).toBe('has.many.dots.in.it');
  });

  it('preserves JSON-like customState', async () => {
    const jsonLike: PKCEState = {
      nonce: 'n',
      codeVerifier: 'v',
      customState: '{"key":"value","nested":{"a":1}}',
    };
    const sealed = await sealState(sessionEncryption, testPassword, jsonLike);
    const unsealed = await unsealState(sessionEncryption, testPassword, sealed);

    expect(unsealed.customState).toBe(jsonLike.customState);
  });

  it('preserves 2KB customState', async () => {
    const large: PKCEState = {
      nonce: 'n',
      codeVerifier: 'v',
      customState: 'x'.repeat(2048),
    };
    const sealed = await sealState(sessionEncryption, testPassword, large);
    const unsealed = await unsealState(sessionEncryption, testPassword, sealed);

    expect(unsealed.customState).toBe('x'.repeat(2048));
  });

  it('throws SessionEncryptionError on tampered ciphertext', async () => {
    const sealed = await sealState(sessionEncryption, testPassword, validState);
    // Flip one char in the middle of the sealed string (avoiding the ~2 suffix).
    const mid = Math.floor(sealed.length / 2);
    const tampered =
      sealed.slice(0, mid) +
      (sealed[mid] === 'a' ? 'b' : 'a') +
      sealed.slice(mid + 1);

    await expect(
      unsealState(sessionEncryption, testPassword, tampered),
    ).rejects.toThrow(SessionEncryptionError);
  });

  it('throws SessionEncryptionError with wrong password', async () => {
    const sealed = await sealState(sessionEncryption, testPassword, validState);
    const wrongPassword =
      'this-is-a-completely-different-password-that-is-long';

    await expect(
      unsealState(sessionEncryption, wrongPassword, sealed),
    ).rejects.toThrow(SessionEncryptionError);
  });

  it('throws SessionEncryptionError on schema mismatch', async () => {
    // Seal something that passes encryption but fails the StateSchema check.
    const wrongShape = await sessionEncryption.sealData(
      { foo: 'bar', baz: 42 },
      { password: testPassword, ttl: 600 },
    );

    await expect(
      unsealState(sessionEncryption, testPassword, wrongShape),
    ).rejects.toThrow(SessionEncryptionError);
    await expect(
      unsealState(sessionEncryption, testPassword, wrongShape),
    ).rejects.toThrow(/Malformed PKCE state payload/);
  });

  describe('TTL enforcement', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('succeeds well before expiry', async () => {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const sealed = await sealState(
        sessionEncryption,
        testPassword,
        validState,
      );

      vi.setSystemTime(new Date('2026-01-01T00:09:59.000Z')); // +599s
      const unsealed = await unsealState(
        sessionEncryption,
        testPassword,
        sealed,
      );

      expect(unsealed).toEqual(validState);
    });

    it('throws after TTL expires (+60s skew)', async () => {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const sealed = await sealState(
        sessionEncryption,
        testPassword,
        validState,
      );

      // 600s TTL + 60s skew = 660s grace. Advance to 661s.
      vi.setSystemTime(new Date('2026-01-01T00:11:01.000Z'));

      await expect(
        unsealState(sessionEncryption, testPassword, sealed),
      ).rejects.toThrow(SessionEncryptionError);
    });
  });
});
