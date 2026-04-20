import type { AuthKitConfig } from '../config/types.js';
import type { CookieOptions } from '../session/types.js';

/** Name of the PKCE verifier cookie on the wire. */
export const PKCE_COOKIE_NAME = 'wos-auth-verifier';

/**
 * PKCE verifier cookie lifetime (seconds). Matches the 10-minute convention
 * used by Arctic, openid-client, Clerk, and Okta for short-lived OAuth state
 * cookies — long enough to accommodate slow sign-ins (out-of-band 2FA, tab
 * switching) and short enough to keep the replay window tight if the sealed
 * blob leaks.
 *
 * The same value is used as both the `Max-Age` cookie attribute and the
 * sealed payload's TTL, so both layers reject a stale blob.
 */
export const PKCE_COOKIE_MAX_AGE = 600;

/**
 * Compute PKCE verifier cookie options from config + the resolved redirect URI.
 *
 * Behavior:
 * - `sameSite: 'strict'` is downgraded to `'lax'` so the cookie survives the
 *   cross-site redirect back from WorkOS.
 * - `sameSite: 'none'` is preserved (iframe/embed flows require it).
 * - `secure` is forced to `true` when `sameSite === 'none'` (required by
 *   modern browsers). Otherwise it is inferred from the redirect URI's
 *   protocol, defaulting fail-closed to `true` on invalid/missing URLs.
 * - `path` is scoped to the redirect URI's pathname so two AuthKit apps on
 *   the same host under different subpaths don't overwrite each other's
 *   verifier cookie. Falls back to `/` when no redirect URI is available.
 *
 * Internal helper — not exported from the package. Callers get cookie options
 * indirectly via `AuthService.createSignIn` / `clearPendingVerifier`.
 */
export function getPKCECookieOptions(
  config: AuthKitConfig,
  redirectUri?: string,
): CookieOptions {
  // 'strict' is downgraded to 'lax' (see JSDoc); anything else falls through to 'lax'.
  const configuredSameSite = (config.cookieSameSite ?? 'lax').toLowerCase();
  const sameSite: 'lax' | 'none' =
    configuredSameSite === 'none' ? 'none' : 'lax';

  const urlString = redirectUri ?? config.redirectUri;
  let secure = true;
  let path = '/';
  if (urlString) {
    try {
      const parsed = new URL(urlString);
      if (sameSite !== 'none') {
        secure = parsed.protocol === 'https:';
      }
      path = parsed.pathname || '/';
    } catch {
      // Fail-closed: secure stays true, path stays '/'.
    }
  }

  return {
    path,
    httpOnly: true,
    secure,
    sameSite,
    maxAge: PKCE_COOKIE_MAX_AGE,
    ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
  };
}
