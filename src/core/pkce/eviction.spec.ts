import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAX_PENDING_PKCE_COOKIES,
  isPKCEVerifierCookieName,
  selectStalePKCEVerifierCookieNames,
} from './eviction.js';
import { PKCE_COOKIE_PREFIX, getPKCECookieNameForState } from './cookieName.js';

const verifier = (state: string) => getPKCECookieNameForState(state);

describe('isPKCEVerifierCookieName', () => {
  it('matches the per-flow hashed name', () => {
    expect(isPKCEVerifierCookieName(verifier('abc'))).toBe(true);
  });

  it('matches the legacy unsuffixed name', () => {
    expect(isPKCEVerifierCookieName(PKCE_COOKIE_PREFIX)).toBe(true);
  });

  it('rejects unrelated cookies', () => {
    expect(isPKCEVerifierCookieName('wos-session')).toBe(false);
    expect(isPKCEVerifierCookieName('foo')).toBe(false);
  });

  it('rejects names that share the prefix without the hyphen boundary', () => {
    // Guards against `wos-auth-verifierEVIL` being treated as a verifier.
    expect(isPKCEVerifierCookieName(`${PKCE_COOKIE_PREFIX}EVIL`)).toBe(false);
  });
});

describe('selectStalePKCEVerifierCookieNames', () => {
  const keep = verifier('new-flow');

  it('evicts nothing when the new cookie is the only verifier', () => {
    expect(selectStalePKCEVerifierCookieNames([], { keep })).toEqual([]);
  });

  it('evicts nothing while total verifier count stays within the cap', () => {
    // 4 existing + the new one = 5 = DEFAULT cap.
    const existing = ['a', 'b', 'c', 'd'].map(verifier);
    expect(selectStalePKCEVerifierCookieNames(existing, { keep })).toEqual([]);
  });

  it('evicts every other verifier once the new cookie tips it over the cap', () => {
    // 5 existing + the new one = 6 > 5.
    const existing = ['a', 'b', 'c', 'd', 'e'].map(verifier);
    const stale = selectStalePKCEVerifierCookieNames(existing, { keep });
    expect(new Set(stale)).toEqual(new Set(existing));
    expect(stale).not.toContain(keep);
  });

  it('never evicts the cookie being kept, even if it is already on the request', () => {
    const existing = [...['a', 'b', 'c', 'd'].map(verifier), keep];
    // existing verifiers other than keep = 4; +1 new (keep, already counted) → within cap.
    expect(selectStalePKCEVerifierCookieNames(existing, { keep })).toEqual([]);
  });

  it('ignores non-verifier cookies when counting', () => {
    const existing = [
      'wos-session',
      'theme',
      ...['a', 'b', 'c', 'd'].map(verifier),
    ];
    expect(selectStalePKCEVerifierCookieNames(existing, { keep })).toEqual([]);
  });

  it('honors a custom max', () => {
    const existing = ['a', 'b'].map(verifier);
    // 2 existing + 1 new = 3 > max:2 → evict both existing.
    const stale = selectStalePKCEVerifierCookieNames(existing, {
      keep,
      max: 2,
    });
    expect(new Set(stale)).toEqual(new Set(existing));
  });

  it('evicts all others even when only slightly over the cap (partial over-cap)', () => {
    // max=3, 3 existing + 1 new = 4 > 3 → evicts all 3 existing (not just the surplus).
    const existing = ['a', 'b', 'c'].map(verifier);
    const stale = selectStalePKCEVerifierCookieNames(existing, {
      keep,
      max: 3,
    });
    expect(new Set(stale)).toEqual(new Set(existing));
    expect(stale).not.toContain(keep);
  });

  it('exposes a sane default cap', () => {
    expect(DEFAULT_MAX_PENDING_PKCE_COOKIES).toBe(5);
  });
});
