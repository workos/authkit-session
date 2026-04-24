import { once, sanitizeReturnPathname } from './utils.js';

describe('utils', () => {
  describe('once', () => {
    it('only allows the provided function to be called once, caching its result', () => {
      let num = 0;
      const fn = once(() => ++num);
      expect(fn()).toEqual(1);
      expect(fn()).toEqual(1); // test it's the same on every call
    });
  });

  describe('sanitizeReturnPathname (CWE-601 open-redirect protection)', () => {
    it.each([
      ['absolute URL to evil host', 'https://evil.com/steal'],
      ['absolute http URL', 'http://evil.com/steal'],
      ['protocol-relative URL', '//evil.com/steal'],
      ['backslash smuggle', '/\\evil.com/path'],
      ['double-backslash', '\\\\evil.com/path'],
      ['javascript: scheme', 'javascript:alert(1)'],
      ['data: scheme', 'data:text/html,<script>alert(1)</script>'],
      ['tab smuggling', '/\tevil.com'],
      ['newline smuggling', '/\nevil.com'],
      ['carriage-return smuggling', '/\revil.com'],
      ['url-encoded slashes', '%2f%2fevil.com/steal'],
      ['double-encoded slashes', '%252f%252fevil.com/steal'],
      ['userinfo smuggling', 'https://user:pass@evil.com/path'],
      ['leading-whitespace protocol-relative', '   //evil.com'],
      ['ftp scheme', 'ftp://evil.com'],
      ['null-byte injection', '/path%00.evil.com'],
    ])('neutralizes %s to a same-origin relative path', (_desc, payload) => {
      const result = sanitizeReturnPathname(payload);
      const resolved = new URL(result, 'https://trusted.example.com');
      expect(resolved.origin).toBe('https://trusted.example.com');
    });

    it.each([
      ['/dashboard'],
      ['/dashboard?tab=settings'],
      ['/dashboard#billing'],
      ['/docs/api?v=2#auth'],
    ])('preserves legitimate path %s', path => {
      expect(sanitizeReturnPathname(path)).toBe(path);
    });

    it.each([[undefined], [null], [''], [42], [{}]])(
      'falls back to `/` for %p',
      input => {
        expect(sanitizeReturnPathname(input)).toBe('/');
      },
    );

    it('accepts a custom fallback', () => {
      expect(sanitizeReturnPathname(undefined, '/login')).toBe('/login');
    });

    it('sanitizes an unsafe custom fallback — the fallback is not trusted either', () => {
      expect(sanitizeReturnPathname(undefined, '//evil.com')).toBe('/');
      expect(sanitizeReturnPathname(undefined, 'https://evil.com/x')).toBe(
        '/x',
      );
    });

    it('backstops to `/` when both input and fallback are unusable', () => {
      expect(sanitizeReturnPathname(undefined, '')).toBe('/');
      expect(sanitizeReturnPathname(null, null as unknown as string)).toBe('/');
    });
  });
});
