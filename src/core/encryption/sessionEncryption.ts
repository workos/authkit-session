import type { SessionEncryption } from '../session/types.js';

const IRON_SEAL_PREFIX = 'Fe26.';

/**
 * Bidirectional session encryption adapter.
 *
 * Reads both sealed (iron-webcrypto) and unsealed (plain JSON) formats.
 * Writes in whichever mode is configured, enabling zero-downtime migration
 * in either direction.
 */
export class SessionEncryptionAdapter implements SessionEncryption {
  readonly ironEncryption: SessionEncryption;
  readonly sealed: boolean;

  constructor(ironEncryption: SessionEncryption, sealed: boolean = false) {
    this.ironEncryption = ironEncryption;
    this.sealed = sealed;
  }

  async sealData(
    data: unknown,
    options: { password: string; ttl?: number | undefined },
  ): Promise<string> {
    if (this.sealed) {
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
