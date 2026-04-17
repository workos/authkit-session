import type { AuthKitConfig } from '../config/types.js';
import type { PKCECookieOptions } from '../session/types.js';
import { PKCE_COOKIE_MAX_AGE, PKCE_COOKIE_NAME } from './constants.js';

/**
 * Compute PKCE verifier cookie options from config + the resolved redirect URI.
 *
 * Behavior:
 * - `sameSite: 'strict'` is downgraded to `'lax'` so the cookie survives the
 *   cross-site redirect back from WorkOS.
 * - `sameSite: 'none'` is preserved (iframe/embed flows require it).
 * - `secure` is inferred from the redirect URI's protocol, defaulting
 *   fail-closed to `true` on invalid/missing URLs.
 */
export function getPKCECookieOptions(
  config: AuthKitConfig,
  redirectUri?: string,
): PKCECookieOptions {
  const configuredSameSite = (config.cookieSameSite ?? 'lax').toLowerCase();
  const sameSite: 'lax' | 'none' =
    configuredSameSite === 'strict'
      ? 'lax'
      : configuredSameSite === 'none'
        ? 'none'
        : 'lax';

  const urlString = redirectUri ?? config.redirectUri;
  let secure = true;
  if (sameSite !== 'none' && urlString) {
    try {
      secure = new URL(urlString).protocol === 'https:';
    } catch {
      secure = true;
    }
  }

  return {
    name: PKCE_COOKIE_NAME,
    path: '/',
    httpOnly: true,
    secure,
    sameSite,
    maxAge: PKCE_COOKIE_MAX_AGE,
    ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
  };
}

/**
 * Serialize PKCE cookie options into a `Set-Cookie` header value.
 *
 * Wire format mirrors `CookieSessionStorage.buildSetCookie` capitalization
 * (`HttpOnly`, `SameSite=Lax`, etc.) so operators see consistent headers
 * regardless of cookie source.
 *
 * Pass `{ expired: true }` to emit a delete header (Max-Age=0, empty value).
 */
export function serializePKCESetCookie(
  options: PKCECookieOptions,
  value: string,
  flags?: { expired?: boolean },
): string {
  const expired = flags?.expired ?? false;
  const parts = [
    `${options.name}=${expired ? '' : encodeURIComponent(value)}`,
    `Path=${options.path}`,
  ];
  if (options.domain) parts.push(`Domain=${options.domain}`);
  parts.push(`Max-Age=${expired ? 0 : options.maxAge}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  const capitalizedSameSite =
    options.sameSite.charAt(0).toUpperCase() +
    options.sameSite.slice(1).toLowerCase();
  parts.push(`SameSite=${capitalizedSameSite}`);
  return parts.join('; ');
}
