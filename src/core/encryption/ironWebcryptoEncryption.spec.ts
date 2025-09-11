import {
  sealData as ironSessionSeal,
  unsealData as ironSessionUnseal,
} from 'iron-session';
import { SessionEncryption } from './ironWebcryptoEncryption.js';
import ironSessionEncryption from './ironSessionEncryption.js';

const testPassword = 'this-is-a-test-password-that-is-32-characters-long!';
const testData = {
  userId: '123',
  email: 'test@example.com',
  timestamp: Date.now(),
};

describe('ironWebcryptoEncryption', () => {
  const encryption = new SessionEncryption();

  describe('cross-compatibility with iron-session', () => {
    it('can unseal data sealed by iron-session', async () => {
      const sealed = await ironSessionSeal(testData, {
        password: testPassword,
      });

      const unsealed = await encryption.unsealData(sealed, {
        password: testPassword,
      });

      expect(unsealed).toEqual(testData);
    });

    it('produces data that iron-session can unseal', async () => {
      const sealed = await encryption.sealData(testData, {
        password: testPassword,
      });

      const unsealed = await ironSessionUnseal(sealed, {
        password: testPassword,
      });

      expect(unsealed).toEqual(testData);
    });

    it('handles version 2 tokens correctly', async () => {
      const sealed = await encryption.sealData(testData, {
        password: testPassword,
      });

      expect(sealed).toMatch(/~2$/);

      const unsealed = await encryption.unsealData(sealed, {
        password: testPassword,
      });
      expect(unsealed).toEqual(testData);
    });

    it('handles legacy tokens without version', async () => {
      const legacySealed = await ironSessionSeal(testData, {
        password: testPassword,
      });
      const sealWithoutVersion = legacySealed.split('~')[0]!;

      const unsealed = await encryption.unsealData(sealWithoutVersion, {
        password: testPassword,
      });

      expect(unsealed).toEqual(testData);
    });
  });

  describe('basic functionality', () => {
    it('seals and unseals data correctly', async () => {
      const sealed = await encryption.sealData(testData, {
        password: testPassword,
      });
      const unsealed = await encryption.unsealData(sealed, {
        password: testPassword,
      });

      expect(unsealed).toEqual(testData);
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
  });

  describe('compatibility with ironSessionEncryption export', () => {
    it('can unseal data sealed by ironSessionEncryption', async () => {
      const sealed = await ironSessionEncryption.sealData(testData, {
        password: testPassword,
      });

      const unsealed = await encryption.unsealData(sealed, {
        password: testPassword,
      });

      expect(unsealed).toEqual(testData);
    });

    it('produces data that ironSessionEncryption can unseal', async () => {
      const sealed = await encryption.sealData(testData, {
        password: testPassword,
      });

      const unsealed = await ironSessionEncryption.unsealData(sealed, {
        password: testPassword,
      });

      expect(unsealed).toEqual(testData);
    });
  });
});
