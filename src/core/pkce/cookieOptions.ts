import type { AuthKitConfig } from '../config/types.js';
import type { CookieOptions } from '../session/types.js';
import { PKCE_COOKIE_MAX_AGE } from './constants.js';

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
