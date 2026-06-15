import { PKCE_COOKIE_PREFIX } from './cookieName.js';

/**
 * Default ceiling on simultaneous pending PKCE verifier cookies before
 * eviction kicks in. Mirrors `authkit-nextjs`'s `MAX_PKCE_COOKIES`.
 *
 * A handful of concurrent flows is normal — e.g. several tabs each
 * mid-sign-in, each holding its own verifier. Eviction only triggers
 * once accumulation risks an oversized `Cookie` request header
 * (HTTP 431), which happens when an integration generates authorization
 * URLs it never navigates to (prefetching `getSignInUrl()` in a loader).
 */
export const DEFAULT_MAX_PENDING_PKCE_COOKIES = 5;

/**
 * True when `name` is a PKCE verifier cookie — either the per-flow hashed
 * name (`wos-auth-verifier-<hash>`) or the legacy unsuffixed name.
 *
 * The hyphen boundary is required so a lookalike like
 * `wos-auth-verifierXYZ` is NOT treated as a verifier.
 */
export function isPKCEVerifierCookieName(name: string): boolean {
  return (
    name === PKCE_COOKIE_PREFIX || name.startsWith(`${PKCE_COOKIE_PREFIX}-`)
  );
}

/**
 * Decide which stale PKCE verifier cookies to evict on the request that
 * mints `keep`.
 *
 * The per-flow cookie naming (each `getSignInUrl()`/`getSignUpUrl()` call
 * derives a unique name from its sealed state) means cookies never
 * overwrite — they accumulate until their 10-minute TTL. Generating URLs
 * without navigating to them (e.g. prefetching in a loader) can pile up
 * enough verifier cookies to exceed the server's request-header limit and
 * surface as HTTP 431.
 *
 * Policy (matches `authkit-nextjs`): tolerate up to `max` simultaneous
 * verifier cookies. Once the cookie being created this request would push
 * the total past `max`, evict *every* other verifier — keeping only the
 * one just minted. Because cookie names are content hashes with no
 * embedded ordering, "keep the newest N" is not expressible; all-but-newest
 * is the only well-defined bounded policy, and it mirrors the browser's own
 * drop-oldest behavior at the cookie-jar limit.
 *
 * Pure and I/O-free: callers supply the incoming cookie names and emit the
 * delete `Set-Cookie` headers for the returned names themselves.
 *
 * @param cookieNames - Names of all cookies on the incoming request.
 * @param keep - Name of the verifier cookie being written this request;
 *   never included in the result.
 * @param max - Maximum simultaneous verifier cookies tolerated before
 *   eviction. Defaults to {@link DEFAULT_MAX_PENDING_PKCE_COOKIES}.
 * @returns Verifier cookie names to delete. Empty when within budget.
 */
export function selectStalePKCEVerifierCookieNames(
  cookieNames: Iterable<string>,
  {
    keep,
    max = DEFAULT_MAX_PENDING_PKCE_COOKIES,
  }: { keep: string; max?: number },
): string[] {
  const others = new Set<string>();
  for (const name of cookieNames) {
    if (name !== keep && isPKCEVerifierCookieName(name)) {
      others.add(name);
    }
  }

  // +1 accounts for `keep`, which may not be on the incoming request yet.
  if (others.size + 1 <= max) {
    return [];
  }

  return [...others];
}
