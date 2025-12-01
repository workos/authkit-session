import { createAuthService } from './factory.js';

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
    it('creates AuthService-compatible interface', () => {
      const service = createAuthService({
        sessionStorageFactory: () => mockStorage as any,
      });

      // Verify the proxy has all expected methods
      expect(typeof service.withAuth).toBe('function');
      expect(typeof service.getSession).toBe('function');
      expect(typeof service.saveSession).toBe('function');
      expect(typeof service.clearSession).toBe('function');
      expect(typeof service.signOut).toBe('function');
      expect(typeof service.getAuthorizationUrl).toBe('function');
      expect(typeof service.getSignInUrl).toBe('function');
      expect(typeof service.getSignUpUrl).toBe('function');
      expect(typeof service.getWorkOS).toBe('function');
      expect(typeof service.handleCallback).toBe('function');
    });

    it('accepts custom client factory', async () => {
      const customClient = {
        userManagement: {
          getJwksUrl: () => 'https://custom.example.com/jwks',
        },
      };

      const service = createAuthService({
        sessionStorageFactory: () => mockStorage as any,
        clientFactory: () => customClient as any,
      });

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

      // Factory accepts the custom encryption - verify by checking the interface exists
      expect(typeof service.withAuth).toBe('function');
    });
  });

  describe('lazy initialization', () => {
    it('defers service creation until first use', async () => {
      let storageCreated = false;
      const storageFactory = () => {
        storageCreated = true;
        return mockStorage as any;
      };

      const service = createAuthService({
        sessionStorageFactory: storageFactory,
      });

      // Service created, but underlying AuthService not yet instantiated
      expect(storageCreated).toBe(false);

      // First use triggers lazy init
      await service.getSession('request');

      expect(storageCreated).toBe(true);
    });

    it('creates service only once', async () => {
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
