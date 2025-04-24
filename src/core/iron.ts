import * as Iron from 'iron-webcrypto';
import type { SessionEncryption as SessionEncryptionInterface } from './session/types';

/**
 * A compatible implementation that works with iron-session
 */
export class SessionEncryption implements SessionEncryptionInterface {
  private readonly versionDelimiter = '~';
  private readonly currentMajorVersion = 2;

  /**
   * Parse an iron-session seal to extract the version
   */
  private parseSeal(seal: string): {
    sealWithoutVersion: string;
    tokenVersion: number | null;
  } {
    const [sealWithoutVersion = '', tokenVersionAsString] = seal.split(
      this.versionDelimiter,
    );
    const tokenVersion =
      tokenVersionAsString == null ? null : parseInt(tokenVersionAsString, 10);
    return { sealWithoutVersion, tokenVersion };
  }

  /**
   * Encrypt data in a way that's compatible with iron-session
   */
  async sealData(
    data: unknown,
    { password, ttl = 0 }: { password: string; ttl?: number | undefined },
  ) {
    // Seal the data using iron-webcrypto
    const seal = await Iron.seal(globalThis.crypto, data, password, {
      encryption: {
        saltBits: 256,
        algorithm: 'aes-256-cbc',
        iterations: 1,
        minPasswordlength: 32,
      },
      integrity: {
        saltBits: 256,
        algorithm: 'sha256',
        iterations: 1,
        minPasswordlength: 32,
      },
      ttl,
      timestampSkewSec: 60,
      localtimeOffsetMsec: 0,
    });

    // Add the version delimiter exactly like iron-session does
    return `${seal}${this.versionDelimiter}${this.currentMajorVersion}`;
  }

  /**
   * Decrypt data from iron-session with HMAC verification
   */
  async unsealData<T = unknown>(
    encryptedData: string,
    { password }: { password: string },
  ): Promise<T> {
    // First, parse the seal to extract the version and get just the seal part
    const { sealWithoutVersion, tokenVersion } = this.parseSeal(encryptedData);

    // Use iron-webcrypto's unseal function with just the seal part
    const data = await Iron.unseal(
      globalThis.crypto,
      sealWithoutVersion, // This is the key - use only the part before the version marker
      password,
      {
        encryption: {
          saltBits: 256,
          algorithm: 'aes-256-cbc',
          iterations: 1,
          minPasswordlength: 32,
        },
        integrity: {
          saltBits: 256,
          algorithm: 'sha256',
          iterations: 1,
          minPasswordlength: 32,
        },
        ttl: 0,
        timestampSkewSec: 60,
        localtimeOffsetMsec: 0,
      },
    );

    // Check the token version if needed
    if (tokenVersion === 2) {
      return data as T;
    } else if (tokenVersion !== null) {
      // Handle older token versions if needed
      // This matches iron-session's own code
      return { ...(data as any).persistent } as T;
    }

    return data as T;
  }
}
