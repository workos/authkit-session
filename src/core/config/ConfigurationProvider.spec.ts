import { vi } from 'vitest';
import { ConfigurationProvider } from './ConfigurationProvider.js';

describe('ConfigurationProvider', () => {
  let provider: ConfigurationProvider;

  beforeEach(() => {
    provider = new ConfigurationProvider();
  });

  describe('configure()', () => {
    it('updates config with object', () => {
      provider.configure({ clientId: 'test-client' });

      expect(provider.getValue('clientId')).toBe('test-client');
    });

    it('sets value source with function', () => {
      const source = vi.fn().mockReturnValue('env-value');
      provider.configure(source);

      expect(provider.getValue('cookieName')).toBe('env-value');
      expect(source).toHaveBeenCalledWith('WORKOS_COOKIE_NAME');
    });

    it('sets both config and source', () => {
      const source = vi.fn().mockReturnValue(undefined);
      provider.configure({ cookieName: 'custom' }, source);

      expect(provider.getValue('cookieName')).toBe('custom');
    });

    it('throws on short cookie password', () => {
      expect(() => provider.configure({ cookiePassword: 'short' })).toThrow(
        'cookiePassword must be at least 32 characters long',
      );
    });
  });

  describe('getValue()', () => {
    it('returns default values', () => {
      expect(provider.getValue('cookieName')).toBe('wos-session');
      expect(provider.getValue('apiHttps')).toBe(true);
      expect(provider.getValue('cookieMaxAge')).toBe(60 * 60 * 24 * 400);
    });

    it('returns configured values', () => {
      provider.configure({ cookieName: 'custom-session' });

      expect(provider.getValue('cookieName')).toBe('custom-session');
    });

    it('prefers env values over config', () => {
      const source = vi.fn().mockReturnValue('env-name');
      provider.configure({ cookieName: 'config-name' }, source);

      expect(provider.getValue('cookieName')).toBe('env-name');
    });

    it('throws for missing required values', () => {
      expect(() => provider.getValue('clientId')).toThrow(
        'Missing required configuration value for clientId (WORKOS_CLIENT_ID)',
      );
    });

    it('converts boolean values from strings', () => {
      const source = vi.fn().mockReturnValue('false');
      provider.configure(source);

      expect(provider.getValue('apiHttps')).toBe(false);
    });

    it('converts number values from strings', () => {
      const source = vi.fn().mockReturnValue('8080');
      provider.configure(source);

      expect(provider.getValue('apiPort')).toBe(8080);
    });

    it('returns undefined for invalid numbers', () => {
      const source = vi.fn().mockReturnValue('invalid');
      provider.configure(source);

      expect(provider.getValue('apiPort')).toBeUndefined();
    });
  });

  describe('getEnvironmentVariableName()', () => {
    it('converts camelCase to SCREAMING_SNAKE_CASE', () => {
      expect(provider['getEnvironmentVariableName']('clientId')).toBe(
        'WORKOS_CLIENT_ID',
      );
      expect(provider['getEnvironmentVariableName']('apiPort')).toBe(
        'WORKOS_API_PORT',
      );
      expect(provider['getEnvironmentVariableName']('cookieMaxAge')).toBe(
        'WORKOS_COOKIE_MAX_AGE',
      );
    });
  });

  describe('setValueSource()', () => {
    it('updates the value source', () => {
      const source = vi.fn().mockReturnValue('source-value');
      provider.setValueSource(source);

      provider.getValue('cookieName');
      expect(source).toHaveBeenCalledWith('WORKOS_COOKIE_NAME');
    });
  });

  describe('getConfig()', () => {
    it('returns current config as AuthKitConfig', () => {
      provider.configure({ cookieName: 'test-cookie' });

      const config = provider.getConfig();
      expect(config.cookieName).toBe('test-cookie');
    });
  });
});
