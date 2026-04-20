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
