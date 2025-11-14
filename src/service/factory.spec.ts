import { createAuthService } from './factory.js';
import { AuthService } from './AuthService.js';

const mockConfig = {
  clientId: 'test-client-id',
  apiKey: 'test-api-key',
  redirectUri: 'http://localhost:3000/callback',
  cookiePassword: 'test-password-that-is-32-chars-long!!',
};

const mockStorage = {
  getSession: async () => null,
  saveSession: async (response: any) => ({ response }),
  clearSession: async (response: any) => ({ response }),
};

describe('createAuthService', () => {
  beforeEach(() => {
    process.env.WORKOS_CLIENT_ID = mockConfig.clientId;
    process.env.WORKOS_API_KEY = mockConfig.apiKey;
    process.env.WORKOS_REDIRECT_URI = mockConfig.redirectUri;
    process.env.WORKOS_COOKIE_PASSWORD = mockConfig.cookiePassword;
  });

  afterEach(() => {
    delete process.env.WORKOS_CLIENT_ID;
    delete process.env.WORKOS_API_KEY;
    delete process.env.WORKOS_REDIRECT_URI;
    delete process.env.WORKOS_COOKIE_PASSWORD;
  });

  describe('factory creation', () => {
    it('creates AuthService instance', () => {
      const service = createAuthService({
        sessionStorageFactory: () => mockStorage as any,
      });

      expect(service).toBeInstanceOf(AuthService);
    });

    it('accepts custom client factory', () => {
      const customClient = {
        userManagement: {
          getJwksUrl: () => 'https://custom.example.com/jwks',
        },
      };

      const service = createAuthService({
        sessionStorageFactory: () => mockStorage as any,
        clientFactory: () => customClient as any,
      });

      expect(service).toBeInstanceOf(AuthService);
      expect(service.getWorkOS()).toBe(customClient);
    });

    it('accepts custom encryption factory', () => {
      const customEncryption = {
        sealData: async () => 'custom-encrypted',
        unsealData: async () => ({}),
      };

      const service = createAuthService({
        sessionStorageFactory: () => mockStorage as any,
        encryptionFactory: () => customEncryption as any,
      });

      expect(service).toBeInstanceOf(AuthService);
    });
  });

  describe('lazy storage initialization', () => {
    it('defers storage creation until first use', async () => {
      let storageCreated = false;
      const storageFactory = () => {
        storageCreated = true;
        return mockStorage as any;
      };

      const service = createAuthService({
        sessionStorageFactory: storageFactory,
      });

      expect(storageCreated).toBe(false);

      await service.getSession('request');

      expect(storageCreated).toBe(true);
    });

    it('creates storage only once', async () => {
      let creationCount = 0;
      const storageFactory = () => {
        creationCount++;
        return mockStorage as any;
      };

      const service = createAuthService({
        sessionStorageFactory: storageFactory,
      });

      await service.getSession('request');
      await service.getSession('request');
      await service.getSession('request');

      expect(creationCount).toBe(1);
    });
  });
});
