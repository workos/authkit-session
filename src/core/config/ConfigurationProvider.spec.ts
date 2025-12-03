import { vi } from 'vitest';
import { ConfigurationProvider } from './ConfigurationProvider.js';

describe('ConfigurationProvider', () => {
  let provider: ConfigurationProvider;

  beforeEach(() => {
    provider = new ConfigurationProvider();
    provider.setValueSource(() => undefined); // Default to no env vars
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
      const validPassword = 'a'.repeat(32);
      provider.configure({
        clientId: 'test-client',
        apiKey: 'test-api-key',
        redirectUri: 'http://localhost:3000/callback',
        cookiePassword: validPassword,
        cookieName: 'test-cookie',
      });

      const config = provider.getConfig();
      expect(config.cookieName).toBe('test-cookie');
    });
  });

  describe('validate()', () => {
    it('passes validation with all required config', () => {
      const validPassword = 'a'.repeat(32);
      provider.configure({
        clientId: 'test-client',
        apiKey: 'test-api-key',
        redirectUri: 'http://localhost:3000/callback',
        cookiePassword: validPassword,
      });

      expect(() => provider.validate()).not.toThrow();
    });

    it('throws with all missing required fields at once', () => {
      expect(() => provider.validate()).toThrow(
        /AuthKit configuration error\. Missing or invalid environment variables:\n\n  • WORKOS_CLIENT_ID is required\n  • WORKOS_API_KEY is required\n  • WORKOS_REDIRECT_URI is required\n  • WORKOS_COOKIE_PASSWORD is required/,
      );
    });

    it('throws with helpful message for short cookiePassword', () => {
      provider.configure({
        clientId: 'test-client',
        apiKey: 'test-api-key',
        redirectUri: 'http://localhost:3000/callback',
        cookiePassword: 'short',
      });

      expect(() => provider.validate()).toThrow(
        /WORKOS_COOKIE_PASSWORD must be at least 32 characters \(currently 5\)/,
      );
    });

    it('includes dashboard link in error message', () => {
      expect(() => provider.validate()).toThrow(
        /Get your values from the WorkOS Dashboard: https:\/\/dashboard\.workos\.com/,
      );
    });

    it('shows current length of invalid cookiePassword', () => {
      provider.configure({
        clientId: 'test-client',
        apiKey: 'test-api-key',
        redirectUri: 'http://localhost:3000/callback',
        cookiePassword: '12345678901234567890', // 20 chars
      });

      expect(() => provider.validate()).toThrow(
        /WORKOS_COOKIE_PASSWORD must be at least 32 characters \(currently 20\)/,
      );
    });

    it('collects multiple errors including password length', () => {
      provider.configure({
        clientId: 'test-client',
        cookiePassword: 'too-short',
      });

      const error = () => provider.validate();
      expect(error).toThrow(/WORKOS_API_KEY is required/);
      expect(error).toThrow(/WORKOS_REDIRECT_URI is required/);
      expect(error).toThrow(
        /WORKOS_COOKIE_PASSWORD must be at least 32 characters/,
      );
    });

    it('prefers environment values over config in validation', () => {
      const source = vi.fn((key: string) => {
        if (key === 'WORKOS_COOKIE_PASSWORD') return 'a'.repeat(32);
        if (key === 'WORKOS_CLIENT_ID') return 'env-client';
        if (key === 'WORKOS_API_KEY') return 'env-api-key';
        if (key === 'WORKOS_REDIRECT_URI')
          return 'http://localhost:3000/callback';
        return undefined;
      });
      provider.configure(source);

      expect(() => provider.validate()).not.toThrow();
    });
  });
});
