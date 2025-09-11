import {
  sealData as ironSessionSeal,
  unsealData as ironSessionUnseal,
} from 'iron-session';
import { PureWebcryptoEncryption } from './pureWebcryptoEncryption.js';

const testPassword = 'this-is-a-test-password-that-is-32-characters-long!';
const testData = {
  userId: '123',
  email: 'test@example.com',
  timestamp: Date.now(),
};

describe('pureWebcryptoEncryption', () => {
  const pureEncryption = new PureWebcryptoEncryption();

  describe('cross-compatibility with iron-session', () => {
    it('can unseal data sealed by iron-session', async () => {
      const sealed = await ironSessionSeal(testData, {
        password: testPassword,
      });

      const unsealed = await pureEncryption.unsealData(sealed, {
        password: testPassword,
      });

      expect(unsealed).toEqual(testData);
    });

    it('produces data that iron-session can unseal', async () => {
      const sealed = await pureEncryption.sealData(testData, {
        password: testPassword,
      });

      const unsealed = await ironSessionUnseal(sealed, {
        password: testPassword,
      });

      expect(unsealed).toEqual(testData);
    });

    it('handles version 2 tokens correctly', async () => {
      const sealed = await pureEncryption.sealData(testData, {
        password: testPassword,
      });

      expect(sealed).toMatch(/~2$/);

      const unsealed = await pureEncryption.unsealData(sealed, {
        password: testPassword,
      });
      expect(unsealed).toEqual(testData);
    });

    it('handles legacy tokens without version', async () => {
      const legacySealed = await ironSessionSeal(testData, {
        password: testPassword,
      });
      const sealWithoutVersion = legacySealed.split('~')[0]!;

      const unsealed = await pureEncryption.unsealData(sealWithoutVersion, {
        password: testPassword,
      });

      expect(unsealed).toEqual(testData);
    });
  });

  describe('basic functionality', () => {
    it('seals and unseals data correctly', async () => {
      const sealed = await pureEncryption.sealData(testData, {
        password: testPassword,
      });
      const unsealed = await pureEncryption.unsealData(sealed, {
        password: testPassword,
      });

      expect(unsealed).toEqual(testData);
    });

    it('handles TTL parameter', async () => {
      const sealed = await pureEncryption.sealData(testData, {
        password: testPassword,
        ttl: 3600,
      });

      expect(sealed).toBeDefined();
      expect(typeof sealed).toBe('string');
      expect(sealed).toMatch(/^Fe26\.2\*/); // Should use iron-session format
    });

    it('fails with wrong password', async () => {
      const sealed = await pureEncryption.sealData(testData, {
        password: testPassword,
      });
      const wrongPassword = 'wrong-password-that-is-32-chars!!';

      await expect(
        pureEncryption.unsealData(sealed, { password: wrongPassword }),
      ).rejects.toThrow();
    });

    it('enforces minimum password length', async () => {
      const shortPassword = 'short';

      await expect(
        pureEncryption.sealData(testData, { password: shortPassword }),
      ).rejects.toThrow('Password must be at least 32 characters long');

      await expect(
        pureEncryption.unsealData('fake-seal', { password: shortPassword }),
      ).rejects.toThrow('Password must be at least 32 characters long');
    });

    it('handles TTL expiration', async () => {
      const sealed = await pureEncryption.sealData(testData, {
        password: testPassword,
        ttl: -1, // Already expired
      });

      await expect(
        pureEncryption.unsealData(sealed, { password: testPassword }),
      ).rejects.toThrow('Sealed data has expired');
    });

    it('produces iron-session compatible format', async () => {
      const sealed = await pureEncryption.sealData(testData, {
        password: testPassword,
      });

      // Should start with Fe26.2 (iron-session format)
      expect(sealed).toMatch(/^Fe26\.2\*/);

      // Should end with ~2 (version delimiter)
      expect(sealed).toMatch(/~2$/);

      // Should have the correct number of parts when split by *
      const withoutVersion = sealed.split('~')[0]!;
      const parts = withoutVersion.split('*');
      expect(parts).toHaveLength(8); // Fe26.2 format has 8 parts
    });

    it('handles complex data structures', async () => {
      const complexData = {
        user: {
          id: '123',
          profile: {
            name: 'Test User',
            preferences: {
              theme: 'dark',
              notifications: true,
            },
          },
        },
        session: {
          id: 'sess_123',
          createdAt: new Date().toISOString(),
          metadata: {
            userAgent: 'Mozilla/5.0',
            ip: '192.168.1.1',
          },
        },
        permissions: ['read', 'write', 'admin'],
      };

      const sealed = await pureEncryption.sealData(complexData, {
        password: testPassword,
      });

      const unsealed = await pureEncryption.unsealData(sealed, {
        password: testPassword,
      });

      expect(unsealed).toEqual(complexData);
    });
  });
});
