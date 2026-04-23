/** Stable prefix for all PKCE verifier cookies. */
export const PKCE_COOKIE_PREFIX = 'wos-auth-verifier';

/**
 * FNV-1a 32-bit hash of the input, returned as a zero-padded 8-char
 * lowercase hex string. Used purely as a namespacing mechanism — not
 * security-sensitive. Collision probability is ~1/4B per pair; a
 * collision routes one flow's callback to the wrong cookie, which
 * then fails byte-equality in `verifyCallbackState` (fail-closed).
 */
export function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5;
  const bytes = new TextEncoder().encode(input);
  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Derive a flow-specific PKCE verifier cookie name from the sealed
 * state blob. Each concurrent OAuth flow gets its own cookie so
 * parallel sign-ins from multiple tabs don't clobber each other.
 */
export function getPKCECookieNameForState(state: string): string {
  return `${PKCE_COOKIE_PREFIX}-${fnv1a32Hex(state)}`;
}
