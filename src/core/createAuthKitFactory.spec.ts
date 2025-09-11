import { createAuthKitFactory } from './createAuthKitFactory.js';
import { configure } from './config.js';

// Mock session storage factory
const mockSessionStorageFactory = () => ({
  getSession: async () => null,
  saveSession: async (response: any) => response,
  clearSession: async (response: any) => response,
});

describe('createAuthKitFactory', () => {
  beforeEach(() => {
    // Configure required values for tests
    configure({
      clientId: 'test-client-id',
      apiKey: 'test-api-key',
      redirectUri: 'http://localhost:3000/callback',
      cookiePassword: 'test-password-that-is-32-chars-long!!',
    });
  });

  describe('factory function', () => {
    it('creates factory with required session storage', () => {
      const factory = createAuthKitFactory({
        sessionStorageFactory: mockSessionStorageFactory,
      });

      expect(typeof factory).toBe('object');
      expect(typeof factory.withAuth).toBe('function');
      expect(typeof factory.getSignInUrl).toBe('function');
      expect(typeof factory.getSignUpUrl).toBe('function');
      expect(typeof factory.handleCallback).toBe('function');
      expect(typeof factory.signOut).toBe('function');
      expect(typeof factory.refreshSession).toBe('function');
      expect(typeof factory.saveSession).toBe('function');
      expect(typeof factory.terminateSession).toBe('function');
      expect(typeof factory.switchToOrganization).toBe('function');
      expect(typeof factory.getTokenClaims).toBe('function');
      expect(typeof factory.getAuthorizationUrl).toBe('function');
    });

    it('returns same instance on multiple calls (singleton)', () => {
      const factory1 = createAuthKitFactory({
        sessionStorageFactory: mockSessionStorageFactory,
      });

      const factory2 = createAuthKitFactory({
        sessionStorageFactory: mockSessionStorageFactory,
      });

      expect(factory1).toBe(factory2);
    });

    it('accepts optional client factory', () => {
      const factory = createAuthKitFactory({
        sessionStorageFactory: mockSessionStorageFactory,
        clientFactory: () => ({}) as any,
      });

      expect(typeof factory.withAuth).toBe('function');
    });

    it('accepts optional session encryption factory', () => {
      const mockEncryptionFactory = () => ({
        sealData: async () => 'encrypted',
        unsealData: async <T>() => ({}) as T,
      });

      const factory = createAuthKitFactory({
        sessionStorageFactory: mockSessionStorageFactory,
        sessionEncryptionFactory: mockEncryptionFactory,
      });

      expect(typeof factory.withAuth).toBe('function');
    });
  });

  describe('API surface', () => {
    let authKit: ReturnType<typeof createAuthKitFactory>;

    beforeEach(() => {
      authKit = createAuthKitFactory({
        sessionStorageFactory: mockSessionStorageFactory,
      });
    });

    describe('authentication methods', () => {
      it('provides withAuth method', async () => {
        const result = await authKit.withAuth('test-request');
        expect(result).toHaveProperty('user');
      });

      it('provides getTokenClaims method', async () => {
        const claims = await authKit.getTokenClaims('request');
        expect(typeof claims).toBe('object');
      });
    });

    describe('URL generation methods', () => {
      it('provides getSignInUrl method', async () => {
        const url = await authKit.getSignInUrl({});
        expect(typeof url).toBe('string');
        expect(url).toContain('client_id=test-client-id');
      });

      it('provides getSignUpUrl method', async () => {
        const url = await authKit.getSignUpUrl({});
        expect(typeof url).toBe('string');
        expect(url).toContain('client_id=test-client-id');
      });

      it('provides getAuthorizationUrl method', async () => {
        const url = await authKit.getAuthorizationUrl({});
        expect(typeof url).toBe('string');
        expect(url).toContain('client_id=test-client-id');
      });
    });

    describe('session management methods', () => {
      it('provides saveSession method', async () => {
        const result = await authKit.saveSession('response', 'session-data');
        expect(result).toBe('response');
      });

      it('provides signOut method', async () => {
        const result = await authKit.signOut('request', 'response');
        expect(result).toBe('response');
      });
    });

    describe('method parameter handling', () => {
      it('getSignInUrl accepts options', async () => {
        const url = await authKit.getSignInUrl({
          organizationId: 'org_123',
          loginHint: 'user@example.com',
          redirectUri: 'https://custom.com/callback',
        });

        expect(typeof url).toBe('string');
      });

      it('getSignUpUrl accepts options', async () => {
        const url = await authKit.getSignUpUrl({
          organizationId: 'org_123',
          loginHint: 'user@example.com',
          redirectUri: 'https://custom.com/callback',
        });

        expect(typeof url).toBe('string');
      });

      it('signOut accepts options', async () => {
        const result = await authKit.signOut('request', 'response', {
          returnTo: 'https://example.com',
        });

        expect(result).toBe('response');
      });
    });
  });
});

