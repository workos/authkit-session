import { CookieSessionStorage } from './CookieSessionStorage.js';
import type { AuthKitConfig } from '../config/types.js';

// Mock config
const createMockConfig = (
  overrides: Partial<AuthKitConfig> = {},
): AuthKitConfig => ({
  clientId: 'test-client-id',
  apiKey: 'test-api-key',
  redirectUri: 'https://example.com/callback',
  cookiePassword: 'test-password-that-is-32-chars-long!!',
  cookieName: 'wos-session',
  cookieSameSite: 'lax',
  apiHttps: true,
  cookieMaxAge: 60 * 60 * 24 * 400,
  cookieDomain: undefined,
  ...overrides,
});

// Concrete implementation for testing the abstract class
class TestCookieSessionStorage extends CookieSessionStorage<string, string> {
  async getCookie(_request: string, _name: string): Promise<string | null> {
    return null;
  }
}

describe('CookieSessionStorage', () => {
  describe('constructor', () => {
    it('sets default cookie configuration', () => {
      const storage = new TestCookieSessionStorage(createMockConfig());

      expect(storage['cookieName']).toBe('wos-session');
      expect(storage['cookieOptions']).toEqual({
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        maxAge: 60 * 60 * 24 * 400,
        domain: undefined,
      });
    });

    it('uses custom cookie name from config', () => {
      const config = createMockConfig({ cookieName: 'custom-session' });
      const storage = new TestCookieSessionStorage(config);

      expect(storage['cookieName']).toBe('custom-session');
    });

    it('uses custom sameSite setting', () => {
      const config = createMockConfig({ cookieSameSite: 'strict' });
      const storage = new TestCookieSessionStorage(config);

      expect(storage['cookieOptions'].sameSite).toBe('strict');
    });

    it('infers secure=false from http redirectUri', () => {
      const config = createMockConfig({
        redirectUri: 'http://localhost:3000/callback',
      });
      const storage = new TestCookieSessionStorage(config);

      expect(storage['cookieOptions'].secure).toBe(false);
    });

    it('infers secure=true from https redirectUri', () => {
      const config = createMockConfig({
        redirectUri: 'https://example.com/callback',
      });
      const storage = new TestCookieSessionStorage(config);

      expect(storage['cookieOptions'].secure).toBe(true);
    });

    it('forces secure=true when sameSite is none', () => {
      const config = createMockConfig({
        cookieSameSite: 'none',
        redirectUri: 'http://localhost:3000/callback',
      });
      const storage = new TestCookieSessionStorage(config);

      expect(storage['cookieOptions'].secure).toBe(true);
    });

    it('uses custom max age', () => {
      const customMaxAge = 60 * 60 * 24; // 1 day
      const config = createMockConfig({ cookieMaxAge: customMaxAge });
      const storage = new TestCookieSessionStorage(config);

      expect(storage['cookieOptions'].maxAge).toBe(customMaxAge);
    });

    it('sets custom cookie domain', () => {
      const config = createMockConfig({ cookieDomain: '.example.com' });
      const storage = new TestCookieSessionStorage(config);

      expect(storage['cookieOptions'].domain).toBe('.example.com');
    });
  });

  describe('abstract methods', () => {
    it('implements SessionStorage interface', () => {
      const storage = new TestCookieSessionStorage(createMockConfig());

      expect(typeof storage.getSession).toBe('function');
      expect(typeof storage.saveSession).toBe('function');
      expect(typeof storage.clearSession).toBe('function');
    });

    it('concrete implementation works', async () => {
      const storage = new TestCookieSessionStorage(createMockConfig());

      const session = await storage.getSession('request');
      expect(session).toBeNull();

      const savedResult = await storage.saveSession(undefined, 'session-data');
      expect(savedResult).toHaveProperty('headers');
      expect(savedResult.headers).toHaveProperty('Set-Cookie');

      const clearedResult = await storage.clearSession('response');
      expect(clearedResult).toHaveProperty('headers');
      expect(clearedResult.headers).toHaveProperty('Set-Cookie');
    });
  });

  describe('serializeCookie', () => {
    it('capitalizes SameSite values for Safari compatibility', async () => {
      const testCases = [
        { input: 'lax' as const, expected: 'SameSite=Lax' },
        { input: 'strict' as const, expected: 'SameSite=Strict' },
        { input: 'none' as const, expected: 'SameSite=None' },
      ];

      for (const { input, expected } of testCases) {
        const config = createMockConfig({ cookieSameSite: input });
        const storage = new TestCookieSessionStorage(config);
        const result = await storage.saveSession(undefined, 'test-data');
        expect(result.headers?.['Set-Cookie']).toContain(expected);
      }
    });
  });

  describe('generic cookie primitives', () => {
    it('setCookie emits a Set-Cookie with the passed name, value, and options', async () => {
      const storage = new TestCookieSessionStorage(createMockConfig());

      const result = await storage.setCookie(undefined, 'foo', 'bar', {
        path: '/x',
        maxAge: 60,
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
      });

      const header = result.headers?.['Set-Cookie'];
      expect(header).toContain('foo=bar');
      expect(header).toContain('Path=/x');
      expect(header).toContain('Max-Age=60');
      expect(header).toContain('HttpOnly');
      expect(header).toContain('Secure');
      expect(header).toContain('SameSite=Lax');
    });

    it('clearCookie emits Max-Age=0 with empty value', async () => {
      const storage = new TestCookieSessionStorage(createMockConfig());

      const result = await storage.clearCookie(undefined, 'foo', {
        path: '/x',
      });

      const header = result.headers?.['Set-Cookie'] as string;
      expect(header).toContain('foo=;');
      expect(header).toContain('Max-Age=0');
    });

    it('getCookie is abstract — subclass must implement it', async () => {
      const storage = new TestCookieSessionStorage(createMockConfig());

      const value = await storage.getCookie('request', 'anything');
      expect(value).toBeNull();
    });

    it('getSession wraps getCookie with the configured cookie name', async () => {
      class CapturingStorage extends CookieSessionStorage<string, string> {
        captured?: { name: string };
        async getCookie(_req: string, name: string): Promise<string | null> {
          this.captured = { name };
          return 'stored-value';
        }
      }
      const storage = new CapturingStorage(
        createMockConfig({ cookieName: 'my-session' }),
      );

      const value = await storage.getSession('request');

      expect(storage.captured).toEqual({ name: 'my-session' });
      expect(value).toBe('stored-value');
    });

    it('saveSession and setCookie produce identical headers for the session cookie', async () => {
      const config = createMockConfig();
      const storage = new TestCookieSessionStorage(config);

      const saved = await storage.saveSession(undefined, 'data');
      const explicit = await storage.setCookie(
        undefined,
        storage['cookieName'],
        'data',
        storage['cookieOptions'],
      );

      expect(saved.headers?.['Set-Cookie']).toBe(
        explicit.headers?.['Set-Cookie'],
      );
    });
  });
});
