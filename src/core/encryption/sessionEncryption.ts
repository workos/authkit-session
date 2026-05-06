import type { SessionEncryption } from '../session/types.js';

const IRON_SEAL_PREFIX = 'Fe26.';

export interface SessionEncryptionAdapterOptions {
  /**
   * `'sealed'` — always encrypt via iron-webcrypto (current behavior).
   * `'unsealed'` — write plain JSON for session cookies. PKCE state
   * (TTL > 0) is always sealed regardless of this setting because
   * the sealed blob appears in the OAuth `state` URL parameter.
   *
   * Default: `'sealed'` — deploy readers first, flip to `'unsealed'`
   * once all nodes run the adapter.
   */
  mode?: 'sealed' | 'unsealed';
}

/**
 * Bidirectional session encryption adapter.
 *
 * Reads both sealed (iron-webcrypto) and unsealed (plain JSON) formats.
 * Writes in whichever mode is configured, enabling zero-downtime migration
 * in either direction. PKCE state is always sealed regardless of mode
 * because the sealed blob appears in the OAuth `state` URL parameter —
 * an unsealed blob would expose the PKCE `codeVerifier` in browser
 * history, server logs, and proxy logs.
 */
export class SessionEncryptionAdapter implements SessionEncryption {
  private readonly ironEncryption: SessionEncryption;
  private readonly mode: 'sealed' | 'unsealed';

  constructor(
    ironEncryption: SessionEncryption,
    options: SessionEncryptionAdapterOptions = {},
  ) {
    this.ironEncryption = ironEncryption;
    this.mode = options.mode ?? 'sealed';
  }

  async sealData(
    data: unknown,
    options: { password: string; ttl?: number | undefined },
  ): Promise<string> {
    if (this.mode === 'sealed' || (options.ttl != null && options.ttl > 0)) {
      return this.ironEncryption.sealData(data, options);
    }
    return JSON.stringify(data);
  }

  async unsealData<T = unknown>(
    encryptedData: string,
    options: { password: string; ttl?: number | undefined },
  ): Promise<T> {
    if (encryptedData.startsWith(IRON_SEAL_PREFIX)) {
      return this.ironEncryption.unsealData<T>(encryptedData, options);
    }
    return JSON.parse(encryptedData) as T;
  }
}
