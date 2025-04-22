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
