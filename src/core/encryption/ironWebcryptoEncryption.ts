import { seal as sealData, unseal as unsealData } from 'iron-webcrypto';
import type { SessionEncryption as SessionEncryptionInterface } from '../session/types.js';

/**
 * A compatible implementation that works with iron-session
 */
export class SessionEncryption implements SessionEncryptionInterface {
  private readonly versionDelimiter = '~';
  private readonly currentMajorVersion = 2;

  // Parse an iron-session seal to extract the version
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

  // Encrypt data in a way that's compatible with iron-session
  async sealData(
    data: unknown,
    { password, ttl = 0 }: { password: string; ttl?: number | undefined },
  ) {
    // Format password as iron-session expects
    const passwordObj = {
      id: '1',
      secret: password,
    };

    // Seal the data using iron-webcrypto with properly formatted password
    const seal = await sealData(data, passwordObj, {
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
      ttl: ttl * 1000, // Convert seconds to milliseconds
      timestampSkewSec: 60,
      localtimeOffsetMsec: 0,
    });

    // Add the version delimiter exactly like iron-session does
    return `${seal}${this.versionDelimiter}${this.currentMajorVersion}`;
  }

  // Decrypt data from iron-session with HMAC verification
  async unsealData<T = unknown>(
    encryptedData: string,
    { password }: { password: string },
  ): Promise<T> {
    // First, parse the seal to extract the version
    const { sealWithoutVersion, tokenVersion } = this.parseSeal(encryptedData);

    // Format password as a map like iron-session expects
    const passwordMap = { 1: password };

    // Use iron-webcrypto's unseal function
    const data = await unsealData(sealWithoutVersion, passwordMap, {
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
    });

    // Check the token version if needed
    if (tokenVersion === 2) {
      return data as T;
    } else if (tokenVersion !== null) {
      // For older token versions, extract the persistent property
      return { ...(data as any).persistent } as T;
    }

    return data as T;
  }
}

const ironWebcryptoEncryption = new SessionEncryption();

export default ironWebcryptoEncryption;
