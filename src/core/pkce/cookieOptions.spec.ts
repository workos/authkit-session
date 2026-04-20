import type { AuthKitConfig } from '../config/types.js';
import { getPKCECookieOptions } from './cookieOptions.js';

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

    it('always sets maxAge=600', () => {
      const opts = getPKCECookieOptions(baseConfig);

      expect(opts.maxAge).toBe(600);
    });
  });

  describe('path', () => {
    it.each([
      ['config callback path', 'https://app.example.com/callback'],
      ['nested callback path', 'https://app.example.com/auth/v2/callback'],
      ['host-only', 'https://app.example.com'],
      ['invalid url', 'not-a-valid-url'],
    ])(
      "is always '/' regardless of redirectUri (%s)",
      (_label, redirectUri) => {
        const opts = getPKCECookieOptions({ ...baseConfig, redirectUri });

        expect(opts.path).toBe('/');
      },
    );

    it("is '/' even when per-call redirectUri override is supplied", () => {
      const opts = getPKCECookieOptions(
        baseConfig,
        'https://app.example.com/some/other/path',
      );

      expect(opts.path).toBe('/');
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
