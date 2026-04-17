import type { AuthKitConfig } from '../config/types.js';
import {
  getPKCECookieOptions,
  serializePKCESetCookie,
} from './cookieOptions.js';

const baseConfig: AuthKitConfig = {
  clientId: 'client_test',
  apiKey: 'sk_test',
  redirectUri: 'https://app.example.com/callback',
  cookiePassword: 'x'.repeat(48),
} as AuthKitConfig;

describe('getPKCECookieOptions', () => {
  describe('sameSite behavior', () => {
    it.each([
      ['strict', 'lax'],
      ['lax', 'lax'],
      ['none', 'none'],
    ] as const)(
      'maps cookieSameSite=%s to sameSite=%s',
      (configured, expected) => {
        const config = { ...baseConfig, cookieSameSite: configured };
        const opts = getPKCECookieOptions(config);

        expect(opts.sameSite).toBe(expected);
      },
    );

    it('defaults to lax when cookieSameSite is undefined', () => {
      const opts = getPKCECookieOptions(baseConfig);

      expect(opts.sameSite).toBe('lax');
    });

    it('accepts mixed-case sameSite values', () => {
      const config = { ...baseConfig, cookieSameSite: 'NONE' as any };
      const opts = getPKCECookieOptions(config);

      expect(opts.sameSite).toBe('none');
    });
  });

  describe('secure flag', () => {
    it('derives secure=true from https redirectUri', () => {
      const opts = getPKCECookieOptions({
        ...baseConfig,
        redirectUri: 'https://app.example.com/callback',
      });

      expect(opts.secure).toBe(true);
    });

    it('derives secure=false from http redirectUri', () => {
      const opts = getPKCECookieOptions({
        ...baseConfig,
        redirectUri: 'http://localhost:3000/callback',
      });

      expect(opts.secure).toBe(false);
    });

    it('prefers explicit redirectUri arg over config', () => {
      const opts = getPKCECookieOptions(
        { ...baseConfig, redirectUri: 'https://prod.example.com/callback' },
        'http://localhost:3000/callback',
      );

      expect(opts.secure).toBe(false);
    });

    it('fail-closes to secure=true on invalid URL', () => {
      const opts = getPKCECookieOptions({
        ...baseConfig,
        redirectUri: 'not-a-valid-url',
      });

      expect(opts.secure).toBe(true);
    });

    it('forces secure=true when sameSite=none regardless of protocol', () => {
      const opts = getPKCECookieOptions({
        ...baseConfig,
        cookieSameSite: 'none',
        redirectUri: 'http://localhost:3000/callback',
      });

      expect(opts.secure).toBe(true);
    });
  });

  describe('invariants', () => {
    it('always sets httpOnly=true', () => {
      const opts = getPKCECookieOptions(baseConfig);

      expect(opts.httpOnly).toBe(true);
    });

    it('always sets path=/', () => {
      const opts = getPKCECookieOptions(baseConfig);

      expect(opts.path).toBe('/');
    });

    it('always sets name=wos-auth-verifier', () => {
      const opts = getPKCECookieOptions(baseConfig);

      expect(opts.name).toBe('wos-auth-verifier');
    });

    it('always sets maxAge=600', () => {
      const opts = getPKCECookieOptions(baseConfig);

      expect(opts.maxAge).toBe(600);
    });
  });

  describe('domain passthrough', () => {
    it('includes domain when configured', () => {
      const opts = getPKCECookieOptions({
        ...baseConfig,
        cookieDomain: '.example.com',
      });

      expect(opts.domain).toBe('.example.com');
    });

    it('omits domain when not configured', () => {
      const opts = getPKCECookieOptions(baseConfig);

      expect(opts.domain).toBeUndefined();
    });
  });
});

describe('serializePKCESetCookie', () => {
  const opts = getPKCECookieOptions(baseConfig);

  it('serializes live cookie with standard fields', () => {
    const header = serializePKCESetCookie(opts, 'sealed-value');

    expect(header).toContain('wos-auth-verifier=sealed-value');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=600');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
  });

  it('URL-encodes the value', () => {
    const header = serializePKCESetCookie(opts, 'a=b;c');

    expect(header).toContain('wos-auth-verifier=a%3Db%3Bc');
  });

  it('emits expired variant with Max-Age=0 and empty value', () => {
    const header = serializePKCESetCookie(opts, '', { expired: true });

    expect(header).toContain('wos-auth-verifier=;');
    expect(header).toContain('Max-Age=0');
  });

  it('includes Domain when present in options', () => {
    const optsWithDomain = getPKCECookieOptions({
      ...baseConfig,
      cookieDomain: '.example.com',
    });
    const header = serializePKCESetCookie(optsWithDomain, 'v');

    expect(header).toContain('Domain=.example.com');
  });

  it('capitalizes sameSite correctly for none', () => {
    const noneOpts = getPKCECookieOptions({
      ...baseConfig,
      cookieSameSite: 'none',
    });
    const header = serializePKCESetCookie(noneOpts, 'v');

    expect(header).toContain('SameSite=None');
  });

  it('omits Secure when secure=false', () => {
    const httpOpts = getPKCECookieOptions({
      ...baseConfig,
      redirectUri: 'http://localhost:3000/callback',
    });
    const header = serializePKCESetCookie(httpOpts, 'v');

    expect(header).not.toContain('Secure');
  });
});
