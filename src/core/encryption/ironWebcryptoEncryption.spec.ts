import { SessionEncryption } from './ironWebcryptoEncryption.js';

const testPassword = 'this-is-a-test-password-that-is-32-characters-long!';
const testData = {
  userId: '123',
  email: 'test@example.com',
};

describe('ironWebcryptoEncryption', () => {
  const encryption = new SessionEncryption();

  describe('seal/unseal', () => {
    it('round-trips data correctly', async () => {
      const sealed = await encryption.sealData(testData, {
        password: testPassword,
      });
      const unsealed = await encryption.unsealData(sealed, {
        password: testPassword,
      });

      expect(unsealed).toEqual(testData);
    });

    it('produces version 2 tokens', async () => {
      const sealed = await encryption.sealData(testData, {
        password: testPassword,
      });

      expect(sealed).toMatch(/~2$/);
    });

    it('handles TTL parameter', async () => {
      const sealed = await encryption.sealData(testData, {
        password: testPassword,
        ttl: 3600,
      });

      expect(sealed).toBeDefined();
      expect(typeof sealed).toBe('string');
    });

    it('fails with wrong password', async () => {
      const sealed = await encryption.sealData(testData, {
        password: testPassword,
      });
      const wrongPassword = 'wrong-password-that-is-32-chars!!';

      await expect(
        encryption.unsealData(sealed, { password: wrongPassword }),
      ).rejects.toThrow();
    });

    it('unseals tokens without version suffix (v1 format)', async () => {
      const sealed = await encryption.sealData(testData, {
        password: testPassword,
      });
      // Strip the ~2 version suffix to simulate legacy token
      const legacySealed = sealed.replace(/~2$/, '');

      const unsealed = await encryption.unsealData(legacySealed, {
        password: testPassword,
      });

      expect(unsealed).toEqual(testData);
    });
  });

  describe('TTL enforcement', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('unseals successfully before TTL expires', async () => {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const sealed = await encryption.sealData(testData, {
        password: testPassword,
        ttl: 600,
      });

      // Advance less than TTL
      vi.setSystemTime(new Date('2026-01-01T00:09:00.000Z')); // +540s
      const unsealed = await encryption.unsealData(sealed, {
        password: testPassword,
        ttl: 600,
      });

      expect(unsealed).toEqual(testData);
    });

    it('throws when TTL has expired on unseal', async () => {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const sealed = await encryption.sealData(testData, {
        password: testPassword,
        ttl: 1,
      });

      // Advance past TTL + skew (60s default)
      vi.setSystemTime(new Date('2026-01-01T00:02:00.000Z'));
      await expect(
        encryption.unsealData(sealed, {
          password: testPassword,
          ttl: 1,
        }),
      ).rejects.toThrow();
    });

    it('preserves session-cookie flow: seal without TTL, unseal without TTL', async () => {
      // This is the invariant AuthKitCore.encryptSession/decryptSession relies on.
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const sealed = await encryption.sealData(testData, {
        password: testPassword,
        // no ttl — matches AuthKitCore.encryptSession
      });

      // Advance time substantially — session cookies must still unseal.
      vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
      const unsealed = await encryption.unsealData(sealed, {
        password: testPassword,
        // no ttl — matches AuthKitCore.decryptSession
      });

      expect(unsealed).toEqual(testData);
    });
  });
});
