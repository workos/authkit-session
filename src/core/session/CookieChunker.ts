export class CookieChunker {
  private static readonly MAX_COOKIE_SIZE = 4096; // Maximum size of a cookie in bytes
  private static readonly CHUNK_OVERHEAD = 160; // Overhead for chunking metadata
  private static readonly CHUNK_SIZE =
    CookieChunker.MAX_COOKIE_SIZE - CookieChunker.CHUNK_OVERHEAD;
  private static readonly CHUNK_PATTERN = /\.(\d+)$/;

  static readValue(
    cookieName: string,
    cookies: Record<string, string>,
  ): string | null {
    const chunks: Array<[number, string]> = [];
    let hasChunks = false;

    for (const [name, value] of Object.entries(cookies)) {
      if (name === cookieName) {
        if (!(`${cookieName}.0` in cookies)) {
          return value || null;
        }
      } else if (name.startsWith(`${cookieName}.`)) {
        const [, match] = name.match(CookieChunker.CHUNK_PATTERN) ?? [];
        if (match) {
          hasChunks = true;
          chunks.push([parseInt(match, 10), value]);
        }
      }
    }

    if (!hasChunks) {
      return cookies[cookieName] || null;
    }

    return chunks
      .sort(([a], [b]) => a - b)
      .map(([, value]) => value)
      .join('');
  }

  static chunkValue(
    cookieName: string,
    value: string,
    existingCookies: Record<string, string> = {},
  ): Array<{ name: string; value: string; clear?: boolean }> {
    const cookies: Array<{ name: string; value: string; clear?: boolean }> = [];

    const existingChunks = Object.keys(existingCookies).filter(
      name =>
        name.startsWith(`${cookieName}.`) &&
        name.match(CookieChunker.CHUNK_PATTERN),
    );

    if (value.length <= CookieChunker.CHUNK_SIZE) {
      cookies.push({ name: cookieName, value });
      existingChunks.forEach(name => {
        cookies.push({ name, value: '', clear: true });
      });

      return cookies;
    }

    const chunkCount = Math.ceil(value.length / CookieChunker.CHUNK_SIZE);

    for (let i = 0; i < chunkCount; ++i) {
      const start = i * CookieChunker.CHUNK_SIZE;
      const end = start + CookieChunker.CHUNK_SIZE;
      cookies.push({
        name: `${cookieName}.${i}`,
        value: value.slice(start, end),
      });
    }

    existingChunks.forEach(name => {
      const [, match] = name.match(CookieChunker.CHUNK_PATTERN) || [];
      if (match && parseInt(match, 10) >= chunkCount) {
        cookies.push({ name, value: '', clear: true });
      }
    });

    return cookies;
  }
}
