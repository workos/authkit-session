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
    describe('neutralizes hostile input to same-origin relative paths', () => {
      // Each payload is something an attacker could smuggle via OAuth state.
      // The result must always start with exactly one `/`, so when a caller
      // emits it as a `Location` header the browser resolves against the
      // current (trusted) origin — never off-origin.
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
      ])('%s stays on trusted origin when resolved', (_desc, payload) => {
        const result = sanitizeReturnPathname(payload);

        // Always exactly one leading slash (not zero, not two).
        expect(result.startsWith('/')).toBe(true);
        expect(result.startsWith('//')).toBe(false);

        // Resolving against any trusted origin keeps the host unchanged.
        const resolved = new URL(result, 'https://trusted.example.com');
        expect(resolved.origin).toBe('https://trusted.example.com');
        expect(resolved.host).not.toBe('evil.com');
      });
    });

    describe('preserves legitimate values', () => {
      it('keeps a simple path', () => {
        expect(sanitizeReturnPathname('/dashboard')).toBe('/dashboard');
      });

      it('keeps pathname + query', () => {
        expect(sanitizeReturnPathname('/dashboard?tab=settings')).toBe(
          '/dashboard?tab=settings',
        );
      });

      it('keeps hash fragments for client-side routing / anchors', () => {
        expect(sanitizeReturnPathname('/dashboard#billing')).toBe(
          '/dashboard#billing',
        );
      });

      it('keeps path + query + hash together', () => {
        expect(
          sanitizeReturnPathname('/docs/api?v=2#auth'),
        ).toBe('/docs/api?v=2#auth');
      });
    });

    describe('fallback behavior for missing input', () => {
      it('returns default fallback for undefined', () => {
        expect(sanitizeReturnPathname(undefined)).toBe('/');
      });

      it('returns default fallback for null', () => {
        expect(sanitizeReturnPathname(null)).toBe('/');
      });

      it('returns default fallback for empty string', () => {
        expect(sanitizeReturnPathname('')).toBe('/');
      });

      it('returns default fallback for non-string types', () => {
        expect(sanitizeReturnPathname(42)).toBe('/');
        expect(sanitizeReturnPathname({})).toBe('/');
      });

      it('accepts a custom fallback', () => {
        expect(sanitizeReturnPathname(undefined, '/login')).toBe('/login');
      });

      it('sanitizes an unsafe custom fallback (fallback is not trusted)', () => {
        // A caller that accidentally passes a hostile fallback must not get
        // an off-origin redirect target back. The fallback goes through the
        // same parser as the primary input.
        expect(sanitizeReturnPathname(undefined, '//evil.com')).toBe('/');
        expect(sanitizeReturnPathname(undefined, 'https://evil.com/x')).toBe(
          '/x',
        );
      });

      it('backstops to `/` when both input and fallback are unusable', () => {
        expect(sanitizeReturnPathname(undefined, '')).toBe('/');
        expect(sanitizeReturnPathname(null, null as unknown as string)).toBe(
          '/',
        );
      });
    });
  });
});
