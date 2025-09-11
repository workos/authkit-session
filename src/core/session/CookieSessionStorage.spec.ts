import { CookieSessionStorage } from './CookieSessionStorage.js';

// Mock config provider
const createMockConfig = (overrides: Record<string, any> = {}) => ({
  getValue: (key: string) => {
    const defaults = {
      cookieName: 'wos-session',
      cookieSameSite: 'lax',
      apiHttps: true,
      cookieMaxAge: 60 * 60 * 24 * 400,
      cookieDomain: undefined,
    };
    return overrides[key] ?? defaults[key as keyof typeof defaults];
  },
});

// Concrete implementation for testing the abstract class
class TestCookieSessionStorage extends CookieSessionStorage<string, string> {
  async getSession(): Promise<string | null> {
    return null;
  }

  async saveSession(response: string): Promise<string> {
    return response;
  }

  async clearSession(response: string): Promise<string> {
    return response;
  }
}

describe('CookieSessionStorage', () => {
  describe('constructor', () => {
    it('sets default cookie configuration', () => {
      const storage = new TestCookieSessionStorage(createMockConfig() as any);

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
      const storage = new TestCookieSessionStorage(config as any);

      expect(storage['cookieName']).toBe('custom-session');
    });

    it('falls back to default cookie name when config returns falsy', () => {
      const config = createMockConfig({ cookieName: '' });
      const storage = new TestCookieSessionStorage(config as any);

      expect(storage['cookieName']).toBe('workos_session');
    });

    it('uses custom sameSite setting', () => {
      const config = createMockConfig({ cookieSameSite: 'strict' });
      const storage = new TestCookieSessionStorage(config as any);

      expect(storage['cookieOptions'].sameSite).toBe('strict');
    });

    it('uses custom security settings', () => {
      const config = createMockConfig({ apiHttps: false });
      const storage = new TestCookieSessionStorage(config as any);

      expect(storage['cookieOptions'].secure).toBe(false);
    });

    it('uses custom max age', () => {
      const customMaxAge = 60 * 60 * 24; // 1 day
      const config = createMockConfig({ cookieMaxAge: customMaxAge });
      const storage = new TestCookieSessionStorage(config as any);

      expect(storage['cookieOptions'].maxAge).toBe(customMaxAge);
    });

    it('uses default max age when config returns null', () => {
      const config = createMockConfig({ cookieMaxAge: null });
      const storage = new TestCookieSessionStorage(config as any);

      expect(storage['cookieOptions'].maxAge).toBe(60 * 60 * 24 * 400);
    });

    it('sets custom cookie domain', () => {
      const config = createMockConfig({ cookieDomain: '.example.com' });
      const storage = new TestCookieSessionStorage(config as any);

      expect(storage['cookieOptions'].domain).toBe('.example.com');
    });

    it('uses all default fallbacks', () => {
      const config = createMockConfig({
        cookieName: '',
        cookieSameSite: null,
        apiHttps: null,
        cookieMaxAge: null,
        cookieDomain: null,
      });
      const storage = new TestCookieSessionStorage(config as any);

      expect(storage['cookieName']).toBe('workos_session');
      expect(storage['cookieOptions']).toEqual({
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        maxAge: 60 * 60 * 24 * 400,
        domain: undefined,
      });
    });
  });

  describe('abstract methods', () => {
    it('implements SessionStorage interface', () => {
      const storage = new TestCookieSessionStorage(createMockConfig() as any);

      expect(typeof storage.getSession).toBe('function');
      expect(typeof storage.saveSession).toBe('function');
      expect(typeof storage.clearSession).toBe('function');
    });

    it('concrete implementation works', async () => {
      const storage = new TestCookieSessionStorage(createMockConfig() as any);

      const session = await storage.getSession();
      expect(session).toBeNull();

      const savedResponse = await storage.saveSession('response');
      expect(savedResponse).toBe('response');

      const clearedResponse = await storage.clearSession('response');
      expect(clearedResponse).toBe('response');
    });
  });
});
