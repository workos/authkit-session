import type { CookieOptions } from './types.js';

/**
 * Serialize a `Set-Cookie` header value from (name, value, options).
 *
 * Shared between `CookieSessionStorage` (writes the header on response) and
 * the PKCE flow's pre-write size guard (must measure the exact bytes the
 * browser will see, including attribute overhead, to detect oversized
 * verifier cookies before they silently get dropped).
 */
export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions,
  { expired }: { expired?: boolean } = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.maxAge != null || expired)
    parts.push(`Max-Age=${expired ? 0 : options.maxAge}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) {
    const capitalized =
      options.sameSite.charAt(0).toUpperCase() +
      options.sameSite.slice(1).toLowerCase();
    parts.push(`SameSite=${capitalized}`);
  }
  if (options.priority) parts.push(`Priority=${options.priority}`);
  if (options.partitioned) parts.push('Partitioned');
  return parts.join('; ');
}
