import { vi } from 'vitest';
import {
  configure,
  getConfig,
  getConfigurationProvider,
  getFullConfig,
  validateConfig,
} from './config.js';
import { ConfigurationProvider } from './config/ConfigurationProvider.js';

describe('config', () => {
  let originalProvider: ConfigurationProvider;

  beforeEach(() => {
    // Store reference to reset later
    originalProvider = getConfigurationProvider();
  });

  afterEach(() => {
    // Reset the provider's internal state
    originalProvider['config'] = {
      cookieName: 'wos-session',
      apiHttps: true,
      cookieMaxAge: 60 * 60 * 24 * 400,
      apiHostname: 'api.workos.com',
    };
    originalProvider['valueSource'] = () => undefined;
  });

  describe('configure()', () => {
    it('accepts config object', () => {
      const config = { clientId: 'test-client-id' };

      expect(() => configure(config)).not.toThrow();
    });

    it('accepts value source function', () => {
      const source = vi.fn().mockReturnValue('test-value');

      expect(() => configure(source)).not.toThrow();
    });

    it('accepts config and source together', () => {
      const config = { clientId: 'test-client' };
      const source = vi.fn();

      expect(() => configure(config, source)).not.toThrow();
    });

    it('accepts short cookie password (validation happens in validateConfig)', () => {
      const config = { cookiePassword: 'short' };

      expect(() => configure(config)).not.toThrow();
    });
  });

  describe('getConfig()', () => {
    it('returns configured values', () => {
      const clientId = 'test-client-configured';
      const validPassword = 'a'.repeat(32);
      configure({ clientId, cookiePassword: validPassword });

      expect(getConfig('clientId')).toBe(clientId);
    });

    it('throws for missing required config', () => {
      expect(() => getConfig('clientId')).toThrow(
        'Missing required configuration value for clientId',
      );
    });

    it('returns defaults for optional config', () => {
      expect(getConfig('cookieName')).toBe('wos-session');
      expect(getConfig('apiHttps')).toBe(true);
    });

    it('prefers environment over config', () => {
      const envValue = 'env-client-id';
      const validPassword = 'a'.repeat(32);
      configure(
        { clientId: 'config-client-id', cookiePassword: validPassword },
        () => envValue,
      );

      expect(getConfig('clientId')).toBe(envValue);
    });
  });

  describe('getConfigurationProvider()', () => {
    it('returns same instance', () => {
      const provider1 = getConfigurationProvider();
      const provider2 = getConfigurationProvider();

      expect(provider1).toBe(provider2);
    });
  });

  describe('getFullConfig()', () => {
    it('returns config object', () => {
      const validPassword = 'a'.repeat(32);
      configure({
        clientId: 'test-client',
        apiKey: 'test-api-key',
        redirectUri: 'http://localhost:3000/callback',
        cookiePassword: validPassword,
      });

      const config = getFullConfig();
      expect(config).toMatchObject({ clientId: 'test-client' });
    });
  });

  describe('validateConfig()', () => {
    it('passes with all required config', () => {
      const validPassword = 'a'.repeat(32);
      configure({
        clientId: 'test-client',
        apiKey: 'test-api-key',
        redirectUri: 'http://localhost:3000/callback',
        cookiePassword: validPassword,
      });

      expect(() => validateConfig()).not.toThrow();
    });

    it('throws with batch of missing fields', () => {
      expect(() => validateConfig()).toThrow(
        /AuthKit configuration error\. Missing or invalid environment variables/,
      );
    });

    it('shows all missing fields at once', () => {
      expect(() => validateConfig()).toThrow(/WORKOS_CLIENT_ID is required/);
      expect(() => validateConfig()).toThrow(/WORKOS_API_KEY is required/);
      expect(() => validateConfig()).toThrow(/WORKOS_REDIRECT_URI is required/);
      expect(() => validateConfig()).toThrow(
        /WORKOS_COOKIE_PASSWORD is required/,
      );
    });

    it('throws for short cookie password', () => {
      configure({
        clientId: 'test-client',
        apiKey: 'test-api-key',
        redirectUri: 'http://localhost:3000/callback',
        cookiePassword: 'short',
      });

      expect(() => validateConfig()).toThrow(
        /WORKOS_COOKIE_PASSWORD must be at least 32 characters \(currently 5\)/,
      );
    });

    it('includes dashboard link in error', () => {
      expect(() => validateConfig()).toThrow(
        /Get your values from the WorkOS Dashboard: https:\/\/dashboard\.workos\.com/,
      );
    });
  });
});
