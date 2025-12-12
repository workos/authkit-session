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
});
