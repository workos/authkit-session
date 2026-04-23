import type { AuthKitConfig } from '../config/types.js';
import type { CookieOptions } from '../session/types.js';

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
 * - `path` is always `/`. The cookie gets sent on every same-origin request
 *   during the 10-minute window, which is fine — it's HttpOnly and expires
 *   quickly. The tradeoff favors DX: path-scoped cookies are invisible in
 *   Chrome DevTools' Application panel from any page outside the scoped
 *   path, which makes PKCE wiring look broken even when it works.
 *
 * Internal helper — not exported from the package. Callers get cookie options
 * indirectly via `AuthService.createSignIn` / `clearPendingVerifier`.
 */
export function getPKCECookieOptions(
  config: AuthKitConfig,
  redirectUri?: string,
): CookieOptions {
  const configuredSameSite = (config.cookieSameSite ?? 'lax').toLowerCase();
  const sameSite: 'lax' | 'none' =
    configuredSameSite === 'none' ? 'none' : 'lax';

  const urlString = redirectUri ?? config.redirectUri;
  let secure = true;
  if (urlString && sameSite !== 'none') {
    try {
      secure = new URL(urlString).protocol === 'https:';
    } catch {
      // Fail-closed: secure stays true.
    }
  }

  return {
    path: '/',
    httpOnly: true,
    secure,
    sameSite,
    maxAge: PKCE_COOKIE_MAX_AGE,
    ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
  };
}
