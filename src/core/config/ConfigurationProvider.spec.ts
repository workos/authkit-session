import { vi } from 'vitest';
import { ConfigurationProvider } from './ConfigurationProvider.js';
import type {
  AuthKitConfidentialConfig,
  AuthKitConfig,
  AuthKitPublicConfig,
} from './types.js';

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
      expect(provider['getEnvironmentVariableName']('cookieDomain')).toBe(
        'WORKOS_COOKIE_DOMAIN',
      );
      expect(provider['getEnvironmentVariableName']('cookieSameSite')).toBe(
        'WORKOS_COOKIE_SAME_SITE',
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

    it('reads optional env vars that have no defaults without configure()', () => {
      const validPassword = 'a'.repeat(32);
      const source = vi.fn((key: string) => {
        if (key === 'WORKOS_CLIENT_ID') return 'env-client';
        if (key === 'WORKOS_API_KEY') return 'env-api-key';
        if (key === 'WORKOS_REDIRECT_URI')
          return 'http://localhost:3000/callback';
        if (key === 'WORKOS_COOKIE_PASSWORD') return validPassword;
        if (key === 'WORKOS_COOKIE_DOMAIN') return '.example.com';
        if (key === 'WORKOS_COOKIE_SAME_SITE') return 'strict';
        if (key === 'WORKOS_API_PORT') return '8443';
        return undefined;
      });

      provider.configure(source);

      const config = provider.getConfig();
      expect(config.cookieDomain).toBe('.example.com');
      expect(config.cookieSameSite).toBe('strict');
      expect(config.apiPort).toBe(8443);
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
        /AuthKit configuration error\. Missing or invalid environment variables:\n\n  • WORKOS_CLIENT_ID is required\n  • WORKOS_REDIRECT_URI is required\n  • WORKOS_COOKIE_PASSWORD is required/,
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
      expect(error).not.toThrow(/WORKOS_API_KEY/);
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

  describe('public client (no API key)', () => {
    const publicEnv: Record<string, string> = {
      WORKOS_CLIENT_ID: 'client_public',
      WORKOS_REDIRECT_URI: 'http://localhost:3000/callback',
      WORKOS_COOKIE_PASSWORD: 'a'.repeat(32),
    };
    let savedApiKey: string | undefined;

    beforeEach(() => {
      // Make sure a key in the test runner's environment can't leak in.
      savedApiKey = process.env.WORKOS_API_KEY;
      delete process.env.WORKOS_API_KEY;
    });

    afterEach(() => {
      if (savedApiKey !== undefined) process.env.WORKOS_API_KEY = savedApiKey;
    });

    it('resolves apiKey to undefined instead of throwing', () => {
      expect(provider.getValue('apiKey')).toBeUndefined();
    });

    it('validates without an apiKey', () => {
      provider.setValueSource(publicEnv);

      expect(() => provider.validate()).not.toThrow();
    });

    it('builds a full config from an env-only value source', () => {
      provider.setValueSource(publicEnv);

      const config = provider.getConfig();
      expect(config).not.toHaveProperty('apiKey');
      expect(config).toMatchObject({
        clientId: 'client_public',
        redirectUri: 'http://localhost:3000/callback',
        cookiePassword: publicEnv.WORKOS_COOKIE_PASSWORD,
      });
    });

    it('builds a full config from process.env with no WORKOS_API_KEY', () => {
      const fresh = new ConfigurationProvider(); // default process.env source
      const saved = { ...process.env };
      Object.assign(process.env, publicEnv);
      try {
        expect(() => fresh.validate()).not.toThrow();
        const config = fresh.getConfig();
        expect(config.apiKey).toBeUndefined();
        expect(config.clientId).toBe('client_public');
      } finally {
        for (const key of Object.keys(publicEnv)) {
          if (saved[key] === undefined) delete process.env[key];
          else process.env[key] = saved[key];
        }
      }
    });

    it('accepts a programmatic config without apiKey', () => {
      provider.configure({
        clientId: 'client_public',
        redirectUri: 'http://localhost:3000/callback',
        cookiePassword: 'a'.repeat(32),
      });

      expect(() => provider.validate()).not.toThrow();
      expect(provider.getConfig().apiKey).toBeUndefined();
    });

    it('still reads apiKey from an env-only source (confidential mode)', () => {
      provider.setValueSource({ ...publicEnv, WORKOS_API_KEY: 'sk_test_env' });

      expect(provider.getConfig().apiKey).toBe('sk_test_env');
    });

    it.each([
      ['clientId', 'WORKOS_CLIENT_ID'],
      ['redirectUri', 'WORKOS_REDIRECT_URI'],
      ['cookiePassword', 'WORKOS_COOKIE_PASSWORD'],
    ] as const)('still requires %s', (key, envKey) => {
      const rest = { ...publicEnv };
      delete rest[envKey];
      provider.setValueSource(rest);

      expect(() => provider.getValue(key)).toThrow(
        `Missing required configuration value for ${key} (${envKey}).`,
      );
      expect(() => provider.getConfig()).toThrow(envKey);
      expect(() => provider.validate()).toThrow(`${envKey} is required`);
    });

    it('still validates the cookie password length', () => {
      provider.setValueSource({
        ...publicEnv,
        WORKOS_COOKIE_PASSWORD: 'short',
      });

      expect(() => provider.validate()).toThrow(
        /WORKOS_COOKIE_PASSWORD must be at least 32 characters/,
      );
    });
  });

  describe('AuthKitConfig types', () => {
    const base = {
      clientId: 'client_123',
      redirectUri: 'http://localhost:3000/callback',
      cookiePassword: 'a'.repeat(32),
      apiHttps: true,
      cookieMaxAge: 60,
      cookieName: 'wos-session',
    };

    it('narrows on the presence of apiKey', () => {
      const narrow = (config: AuthKitConfig) => {
        if (config.apiKey !== undefined) {
          expectTypeOf(config).toEqualTypeOf<AuthKitConfidentialConfig>();
          expectTypeOf(config.apiKey).toEqualTypeOf<string>();
        } else {
          expectTypeOf(config).toEqualTypeOf<AuthKitPublicConfig>();
        }
        if ('apiKey' in config) {
          expectTypeOf(config.apiKey).toEqualTypeOf<string | undefined>();
        }
      };
      narrow({ ...base, apiKey: 'sk_test' });
      narrow(base);
    });

    it('types a runtime-resolved apiKey as optional', () => {
      expectTypeOf<AuthKitConfig['apiKey']>().toEqualTypeOf<
        string | undefined
      >();
    });

    it('accepts both client shapes and rejects invalid ones', () => {
      const confidential: AuthKitConfig = { ...base, apiKey: 'sk_test' };
      const publicConfig: AuthKitConfig = base;
      // @ts-expect-error a confidential config must carry a key
      const missingKey: AuthKitConfidentialConfig = base;
      // @ts-expect-error a public config cannot carry a key
      const keyedPublic: AuthKitPublicConfig = { ...base, apiKey: 'sk_test' };
      // @ts-expect-error clientId is required in both modes
      const missingClientId: AuthKitPublicConfig = {
        ...base,
        clientId: undefined,
      };
      expect([
        confidential,
        publicConfig,
        missingKey,
        keyedPublic,
        missingClientId,
      ]).toHaveLength(5);
    });
  });
});
