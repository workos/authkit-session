import sessionEncryption from '../encryption/ironWebcryptoEncryption.js';
import { SessionEncryptionError } from '../errors.js';
import { sealState, unsealState, type PKCEStateInput } from './state.js';

const testPassword = 'this-is-a-test-password-that-is-32-characters-long!';

const validState: PKCEStateInput = {
  nonce: '8b7b1c32-7d8f-44f9-aa51-4c3a6c8fb8d9',
  codeVerifier: 'verifier-12345678901234567890123456789012345678',
  returnPathname: '/dashboard',
  customState: 'user-custom',
};

describe('PKCE state seal/unseal', () => {
  it('round-trips a valid state', async () => {
    const sealed = await sealState(sessionEncryption, testPassword, validState);
    const unsealed = await unsealState(sessionEncryption, testPassword, sealed);

    expect(unsealed).toMatchObject(validState);
    expect(typeof unsealed.issuedAt).toBe('number');
  });

  it('round-trips without optional fields', async () => {
    const minimal: PKCEStateInput = {
      nonce: 'n',
      codeVerifier: 'v',
    };
    const sealed = await sealState(sessionEncryption, testPassword, minimal);
    const unsealed = await unsealState(sessionEncryption, testPassword, sealed);

    expect(unsealed).toMatchObject(minimal);
    expect(typeof unsealed.issuedAt).toBe('number');
    expect(unsealed.redirectUri).toBeUndefined();
  });

  it('round-trips redirectUri when stamped into the state', async () => {
    const withRedirect: PKCEStateInput = {
      nonce: 'n',
      codeVerifier: 'v',
      redirectUri: 'https://app.example.com/custom/callback',
    };
    const sealed = await sealState(
      sessionEncryption,
      testPassword,
      withRedirect,
    );
    const unsealed = await unsealState(sessionEncryption, testPassword, sealed);

    expect(unsealed.redirectUri).toBe(
      'https://app.example.com/custom/callback',
    );
  });

  it('stamps issuedAt with Date.now() at seal time', async () => {
    vi.useFakeTimers();
    try {
      const fixedNow = new Date('2026-01-01T00:00:00.000Z').getTime();
      vi.setSystemTime(fixedNow);

      const sealed = await sealState(
        sessionEncryption,
        testPassword,
        validState,
      );
      const unsealed = await unsealState(
        sessionEncryption,
        testPassword,
        sealed,
      );

      expect(unsealed.issuedAt).toBe(fixedNow);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each<[string, string]>([
    ['dots', 'has.many.dots.in.it'],
    ['JSON-like', '{"key":"value","nested":{"a":1}}'],
    ['2KB payload', 'x'.repeat(2048)],
  ])(
    'preserves %s customState byte-identically',
    async (_label, customState) => {
      const input: PKCEStateInput = {
        nonce: 'n',
        codeVerifier: 'v',
        customState,
      };
      const sealed = await sealState(sessionEncryption, testPassword, input);
      const unsealed = await unsealState(
        sessionEncryption,
        testPassword,
        sealed,
      );

      expect(unsealed.customState).toBe(customState);
    },
  );

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

      expect(unsealed).toMatchObject(validState);
    });

    it('throws just past the 600s payload-level expiry', async () => {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const sealed = await sealState(
        sessionEncryption,
        testPassword,
        validState,
      );

      // Payload-level expiry is strict at 600s (no positive skew grace).
      vi.setSystemTime(new Date('2026-01-01T00:10:01.000Z')); // +601s

      await expect(
        unsealState(sessionEncryption, testPassword, sealed),
      ).rejects.toThrow(SessionEncryptionError);
    });

    it('rejects payloads older than 600s even when the encryptor ignores ttl', async () => {
      // Custom SessionEncryption that ignores the ttl option — simulates an
      // adapter that would let a stale blob through. The payload-level
      // issuedAt check in unsealState is the authoritative guard.
      const ignoresTtl = {
        sealData: (data: unknown, options: { password: string }) =>
          sessionEncryption.sealData(data, { password: options.password }),
        unsealData: <T>(sealed: string, options: { password: string }) =>
          sessionEncryption.unsealData<T>(sealed, {
            password: options.password,
          }),
      };

      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const sealed = await sealState(ignoresTtl, testPassword, validState);

      // 605s — inside iron's default 60s skew grace, outside the strict 600s
      // payload-level check.
      vi.setSystemTime(new Date('2026-01-01T00:10:05.000Z'));

      await expect(
        unsealState(ignoresTtl, testPassword, sealed),
      ).rejects.toThrow(/PKCE state expired/);
    });

    it('tolerates bounded negative skew (issuedAt up to 60s ahead of now)', async () => {
      // Simulates sign-in on a node whose clock is ahead of the callback
      // node by 30s — within the 60s tolerance.
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const sealed = await sessionEncryption.sealData(
        { ...validState, issuedAt: Date.now() + 30_000 },
        { password: testPassword, ttl: 600 },
      );

      const unsealed = await unsealState(
        sessionEncryption,
        testPassword,
        sealed,
      );
      expect(unsealed).toMatchObject(validState);
    });

    it('rejects payloads meaningfully in the future (issuedAt beyond skew)', async () => {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const sealed = await sessionEncryption.sealData(
        { ...validState, issuedAt: Date.now() + 120_000 },
        { password: testPassword, ttl: 600 },
      );

      await expect(
        unsealState(sessionEncryption, testPassword, sealed),
      ).rejects.toThrow(/PKCE state expired/);
    });
  });
});
