import { vi } from 'vitest';
import {
  configure,
  getConfig,
  getConfigurationProvider,
  getFullConfig,
} from './config';
import { ConfigurationProvider } from './config/ConfigurationProvider';

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

    it('throws on short cookie password', () => {
      const config = { cookiePassword: 'short' };

      expect(() => configure(config)).toThrow(
        'cookiePassword must be at least 32 characters long',
      );
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
});
