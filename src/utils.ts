/**
 * Returns a function that can only be called once.
 * Subsequent calls will return the result of the first call.
 * This is useful for lazy initialization.
 * @param fn - The function to be called once.
 * @returns A function that can only be called once.
 */
export function once<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn {
  let called = false;
  let result: TReturn;

  return (...args: TArgs): TReturn => {
    if (!called) {
      result = fn(...args);
      called = true;
    }
    return result;
  };
}

/**
 * Normalize a post-auth return path to a safe, same-origin relative URL.
 *
 * `returnPathname` travels through the OAuth `state` parameter, which is
 * attacker-influenceable. Without normalization, a crafted value such as
 * `https://evil.com`, `//evil.com`, or `/\evil.com` can cause downstream
 * callers to emit an off-origin `Location` header and redirect the user
 * after a successful sign-in — an open-redirect / phishing primitive
 * (CWE-601).
 *
 * Strategy: parse the untrusted value against a throwaway origin so the
 * WHATWG URL parser strips any smuggled host, scheme, backslash, tab, or
 * newline; then rebuild as `pathname + search + hash` with a leading-slash
 * normalization that defuses the `//evil.com` protocol-relative case.
 *
 * The returned value is always a string beginning with exactly one `/`.
 *
 * @param input - Untrusted return-path candidate (typically decoded from OAuth state)
 * @param fallback - Value to return for empty/invalid input (default `'/'`)
 * @returns A safe, origin-relative path
 */
export function sanitizeReturnPathname(
  input: unknown,
  fallback: string = '/',
): string {
  // The fallback is also an input to this helper — a caller who passes
  // `'//evil.com'` as their fallback must not get an off-origin redirect
  // back, so it goes through the same safety transform as `input`. If both
  // are unsafe or unparseable we end up at `'/'`, which is trivially safe.
  const toSafePath = (value: unknown): string | null => {
    if (typeof value !== 'string' || value.length === 0) return null;
    try {
      const parsed = new URL(value, 'https://placeholder.invalid');
      const path = '/' + parsed.pathname.replace(/^\/+/, '');
      return `${path}${parsed.search}${parsed.hash}`;
    } catch {
      return null;
    }
  };

  return toSafePath(input) ?? toSafePath(fallback) ?? '/';
}
