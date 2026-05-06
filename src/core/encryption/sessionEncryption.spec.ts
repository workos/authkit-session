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

    it('writes plain JSON by default', async () => {
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
  });

  describe('unsealed mode', () => {
    const adapter = new SessionEncryptionAdapter(iron, { mode: 'unsealed' });

    it('writes plain JSON for session cookies (ttl=0)', async () => {
      const result = await adapter.sealData(testData, {
        password: testPassword,
        ttl: 0,
      });
      expect(JSON.parse(result)).toEqual(testData);
    });

    it('writes plain JSON when ttl omitted', async () => {
      const result = await adapter.sealData(testData, {
        password: testPassword,
      });
      expect(JSON.parse(result)).toEqual(testData);
    });

    it('always seals when ttl > 0 (PKCE protection)', async () => {
      const result = await adapter.sealData(testData, {
        password: testPassword,
        ttl: 600,
      });
      expect(result).toMatch(/^Fe26\.2\*/);
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

  describe('bidirectional migration', () => {
    const unsealedAdapter = new SessionEncryptionAdapter(iron, {
      mode: 'unsealed',
    });
    const sealedAdapter = new SessionEncryptionAdapter(iron, {
      mode: 'sealed',
    });

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

  describe('PKCE TTL guard', () => {
    const adapter = new SessionEncryptionAdapter(iron, { mode: 'unsealed' });

    it('seals when ttl is positive', async () => {
      const result = await adapter.sealData(testData, {
        password: testPassword,
        ttl: 1,
      });
      expect(result).toMatch(/^Fe26\.2\*/);
    });

    it('does not seal when ttl is 0', async () => {
      const result = await adapter.sealData(testData, {
        password: testPassword,
        ttl: 0,
      });
      expect(result).not.toMatch(/^Fe26\./);
      expect(JSON.parse(result)).toEqual(testData);
    });

    it('does not seal when ttl is undefined', async () => {
      const result = await adapter.sealData(testData, {
        password: testPassword,
      });
      expect(result).not.toMatch(/^Fe26\./);
      expect(JSON.parse(result)).toEqual(testData);
    });

    it('round-trips PKCE sealed data in unsealed mode', async () => {
      const sealed = await adapter.sealData(testData, {
        password: testPassword,
        ttl: 600,
      });
      const decoded = await adapter.unsealData(sealed, {
        password: testPassword,
        ttl: 600,
      });
      expect(decoded).toEqual(testData);
    });
  });

  describe('TTL enforcement', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('sealed mode respects TTL on unseal', async () => {
      const adapter = new SessionEncryptionAdapter(iron, { mode: 'sealed' });
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

    it('PKCE ttl > 0 is iron-sealed even in unsealed mode, so TTL is enforced', async () => {
      const adapter = new SessionEncryptionAdapter(iron, { mode: 'unsealed' });
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
  });

  describe('error handling', () => {
    const adapter = new SessionEncryptionAdapter(iron);

    it('throws on empty string', async () => {
      await expect(
        adapter.unsealData('', { password: testPassword }),
      ).rejects.toThrow();
    });

    it('throws on whitespace-only string', async () => {
      await expect(
        adapter.unsealData('   ', { password: testPassword }),
      ).rejects.toThrow();
    });

    it('throws on malformed JSON that does not start with Fe26.', async () => {
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

    it('throws on fake Fe26. prefix (invalid iron token)', async () => {
      await expect(
        adapter.unsealData('Fe26.2*garbage*data', {
          password: testPassword,
        }),
      ).rejects.toThrow();
    });
  });

  describe('prefix collision safety', () => {
    it('JSON.stringify of objects never starts with Fe26.', () => {
      expect(JSON.stringify(testData).startsWith('Fe26.')).toBe(false);
      expect(JSON.stringify({}).startsWith('Fe26.')).toBe(false);
      expect(JSON.stringify([]).startsWith('Fe26.')).toBe(false);
      expect(JSON.stringify('Fe26.fake').startsWith('Fe26.')).toBe(false);
    });
  });
});
