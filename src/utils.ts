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
 * Constant-time byte-array equality.
 *
 * Used for comparing security-sensitive values (OAuth state, tokens, MACs)
 * where early-return on mismatch would leak timing information about how
 * many leading bytes matched.
 *
 * Runtime-portable: no `node:crypto`, no `Buffer` — works in Node, browsers,
 * and edge runtimes. Callers produce `Uint8Array`s via `TextEncoder`.
 *
 * Contract:
 *   - Returns false immediately if lengths differ (length is not secret).
 *   - Once past the length gate, inspects EVERY byte regardless of mismatches.
 *   - No branches whose count depends on byte values.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * Normalize an untrusted return-path candidate (e.g. decoded from OAuth
 * state) to a same-origin relative URL. The returned value always begins
 * with exactly one `/`, safe to emit directly as a `Location` header.
 *
 * Parsing against a throwaway origin lets the WHATWG URL parser strip any
 * smuggled host, scheme, backslash, tab, or newline; the leading-slash
 * normalization defuses `//evil.com`-style protocol-relative redirects
 * (CWE-601). `fallback` is sanitized by the same pipeline so a hostile
 * fallback can't reopen the hole.
 */
export function sanitizeReturnPathname(
  input: unknown,
  fallback: string = '/',
): string {
  for (const candidate of [input, fallback]) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue;
    try {
      const parsed = new URL(candidate, 'https://placeholder.invalid');
      const path = '/' + parsed.pathname.replace(/^\/+/, '');
      return `${path}${parsed.search}${parsed.hash}`;
    } catch {
      // Unparseable; try the next candidate.
    }
  }
  return '/';
}
