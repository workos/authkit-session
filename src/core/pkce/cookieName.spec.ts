import { describe, it, expect } from 'vitest';
import {
  PKCE_COOKIE_PREFIX,
  getPKCECookieNameForState,
  fnv1a32Hex,
} from './cookieName.js';

describe('fnv1a32Hex', () => {
  // Known-answer tests against the reference FNV-1a 32-bit spec
  // (http://www.isthe.com/chongo/tech/comp/fnv/). Empty string is the
  // FNV offset basis 0x811c9dc5.
  it('hashes the empty string to the FNV offset basis', () => {
    expect(fnv1a32Hex('')).toBe('811c9dc5');
  });

  it('hashes "a" to 0xe40c292c', () => {
    expect(fnv1a32Hex('a')).toBe('e40c292c');
  });

  it('hashes "foobar" to 0xbf9cf968', () => {
    expect(fnv1a32Hex('foobar')).toBe('bf9cf968');
  });

  it('returns a zero-padded 8-char hex string', () => {
    expect(fnv1a32Hex('x')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic', () => {
    expect(fnv1a32Hex('some-sealed-state')).toBe(
      fnv1a32Hex('some-sealed-state'),
    );
  });
});

describe('getPKCECookieNameForState', () => {
  it('prefixes with wos-auth-verifier and appends an 8-char hex hash', () => {
    expect(getPKCECookieNameForState('any-state')).toMatch(
      /^wos-auth-verifier-[0-9a-f]{8}$/,
    );
  });

  it('produces different names for different states', () => {
    expect(getPKCECookieNameForState('state-a')).not.toBe(
      getPKCECookieNameForState('state-b'),
    );
  });

  it('is deterministic for the same input', () => {
    const s = 'sealed-' + 'x'.repeat(200);
    expect(getPKCECookieNameForState(s)).toBe(getPKCECookieNameForState(s));
  });

  it('exports the prefix constant', () => {
    expect(PKCE_COOKIE_PREFIX).toBe('wos-auth-verifier');
  });
});
