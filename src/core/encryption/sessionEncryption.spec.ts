import { SessionEncryption as IronEncryption } from './ironWebcryptoEncryption.js';
import { SessionEncryptionAdapter } from './sessionEncryption.js';

const testPassword = 'this-is-a-test-password-that-is-32-characters-long!';
const testData = {
  accessToken: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test',
  refreshToken: 'refresh_abc123',
  user: { id: 'user_01', email: 'test@example.com' },
};

describe('SessionEncryptionAdapter', () => {
  const iron = new IronEncryption();

  describe('unsealed mode (default)', () => {
    const adapter = new SessionEncryptionAdapter(iron);

    it('writes plain JSON', async () => {
      const result = await adapter.sealData(testData, {
        password: testPassword,
      });
      expect(JSON.parse(result)).toEqual(testData);
    });

    it('reads plain JSON', async () => {
      const json = JSON.stringify(testData);
      const result = await adapter.unsealData(json, {
        password: testPassword,
      });
      expect(result).toEqual(testData);
    });

    it('reads legacy iron-sealed data', async () => {
      const sealed = await iron.sealData(testData, {
        password: testPassword,
      });
      const result = await adapter.unsealData(sealed, {
        password: testPassword,
      });
      expect(result).toEqual(testData);
    });

    it('round-trips through unsealed format', async () => {
      const encoded = await adapter.sealData(testData, {
        password: testPassword,
      });
      const decoded = await adapter.unsealData(encoded, {
        password: testPassword,
      });
      expect(decoded).toEqual(testData);
    });
  });

  describe('sealed mode', () => {
    const adapter = new SessionEncryptionAdapter(iron, true);

    it('writes iron-sealed data', async () => {
      const result = await adapter.sealData(testData, {
        password: testPassword,
      });
      expect(result).toMatch(/^Fe26\.2\*/);
      expect(result).toMatch(/~2$/);
    });

    it('reads iron-sealed data', async () => {
      const sealed = await adapter.sealData(testData, {
        password: testPassword,
      });
      const result = await adapter.unsealData(sealed, {
        password: testPassword,
      });
      expect(result).toEqual(testData);
    });

    it('reads plain JSON (migrating back from unsealed)', async () => {
      const json = JSON.stringify(testData);
      const result = await adapter.unsealData(json, {
        password: testPassword,
      });
      expect(result).toEqual(testData);
    });
  });

  describe('bidirectional migration', () => {
    const unsealedAdapter = new SessionEncryptionAdapter(iron, false);
    const sealedAdapter = new SessionEncryptionAdapter(iron, true);

    it('sealed adapter reads what unsealed adapter writes', async () => {
      const encoded = await unsealedAdapter.sealData(testData, {
        password: testPassword,
      });
      const decoded = await sealedAdapter.unsealData(encoded, {
        password: testPassword,
      });
      expect(decoded).toEqual(testData);
    });

    it('unsealed adapter reads what sealed adapter writes', async () => {
      const encoded = await sealedAdapter.sealData(testData, {
        password: testPassword,
      });
      const decoded = await unsealedAdapter.unsealData(encoded, {
        password: testPassword,
      });
      expect(decoded).toEqual(testData);
    });

    it('handles unicode in session data', async () => {
      const unicodeData = {
        ...testData,
        user: { id: 'user_01', name: '日本語テスト 🔐' },
      };
      const encoded = await unsealedAdapter.sealData(unicodeData, {
        password: testPassword,
      });
      const decoded = await unsealedAdapter.unsealData(encoded, {
        password: testPassword,
      });
      expect(decoded).toEqual(unicodeData);
    });
  });

  describe('TTL passthrough', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('sealed mode respects TTL on unseal', async () => {
      const adapter = new SessionEncryptionAdapter(iron, true);
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

      const sealed = await adapter.sealData(testData, {
        password: testPassword,
        ttl: 1,
      });

      vi.setSystemTime(new Date('2026-01-01T00:02:00.000Z'));
      await expect(
        adapter.unsealData(sealed, { password: testPassword, ttl: 1 }),
      ).rejects.toThrow();
    });

    it('unsealed mode ignores TTL (cookie maxAge handles expiry)', async () => {
      const adapter = new SessionEncryptionAdapter(iron, false);
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

      const encoded = await adapter.sealData(testData, {
        password: testPassword,
        ttl: 1,
      });

      vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
      const decoded = await adapter.unsealData(encoded, {
        password: testPassword,
        ttl: 1,
      });
      expect(decoded).toEqual(testData);
    });
  });

  describe('error handling', () => {
    const adapter = new SessionEncryptionAdapter(iron);

    it('throws on malformed JSON', async () => {
      await expect(
        adapter.unsealData('not-json-and-not-iron', {
          password: testPassword,
        }),
      ).rejects.toThrow();
    });

    it('throws on iron seal with wrong password', async () => {
      const sealed = await iron.sealData(testData, {
        password: testPassword,
      });
      await expect(
        adapter.unsealData(sealed, {
          password: 'wrong-password-that-is-32-chars!!',
        }),
      ).rejects.toThrow();
    });
  });
});
