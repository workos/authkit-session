import type { SessionEncryption as SessionEncryptionInterface } from '../session/types.js';

/**
 * Pure WebCrypto implementation compatible with iron-session
 * Based on reverse-engineered iron-session format (Fe26.2)
 */
export class PureWebcryptoEncryption implements SessionEncryptionInterface {
  private readonly versionDelimiter = '~';
  private readonly currentMajorVersion = 2;

  // Parse version from sealed data
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

  // Base64url utilities
  private base64urlToBytes(base64url: string): Uint8Array {
    const base64 =
      base64url.replace(/-/g, '+').replace(/_/g, '/') +
      '='.repeat((4 - (base64url.length % 4)) % 4);
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  private bytesToBase64url(bytes: Uint8Array): string {
    const base64 = btoa(String.fromCharCode.apply(null, Array.from(bytes)));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  private bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private generateRandomBytes(length: number): Uint8Array {
    return globalThis.crypto.getRandomValues(new Uint8Array(length));
  }

  // Key derivation using PBKDF2 (iron-session compatible)
  private async deriveKeyBits(options: {
    password: string;
    salt: string | Uint8Array;
    iterations: number;
    hashAlgorithm: string;
    keyLength: number;
  }): Promise<ArrayBuffer> {
    const keyMaterial = await globalThis.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(options.password),
      'PBKDF2',
      false,
      ['deriveBits'],
    );

    const saltBytes =
      typeof options.salt === 'string'
        ? new TextEncoder().encode(options.salt)
        : options.salt;

    return globalThis.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBytes as BufferSource,
        iterations: options.iterations,
        hash: options.hashAlgorithm,
      },
      keyMaterial,
      options.keyLength,
    );
  }

  // Parse iron-session legacy format (Fe26.2)
  private parseLegacyFormat(sealWithoutVersion: string): {
    encryptionSalt: string;
    encryptionIv: string;
    encryptedB64: string;
    expiration?: string;
    hmacSalt?: string;
    signature?: string;
  } {
    const parts = sealWithoutVersion.split('*');

    if (parts.length < 6 || !parts[0]?.startsWith('Fe26.2')) {
      throw new Error('Invalid legacy sealed data format');
    }

    const [
      ,
      ,
      encryptionSalt,
      encryptionIv,
      encryptedB64,
      expiration,
      hmacSalt,
      signature,
    ] = parts;
    return {
      encryptionSalt: encryptionSalt!,
      encryptionIv: encryptionIv!,
      encryptedB64: encryptedB64!,
      expiration,
      hmacSalt,
      signature,
    };
  }

  // Decrypt legacy data using AES-CBC
  private async decryptLegacyData(
    encryptedB64: string,
    encryptionIv: string,
    encryptionSalt: string,
    password: string,
  ): Promise<string> {
    const encryptedBuffer = this.base64urlToBytes(encryptedB64);
    const ivBuffer = this.base64urlToBytes(encryptionIv);

    // Derive decryption key using iron-session parameters
    const keyBits = await this.deriveKeyBits({
      password,
      salt: encryptionSalt,
      iterations: 1,
      hashAlgorithm: 'SHA-1',
      keyLength: 256,
    });

    const encryptionKey = await globalThis.crypto.subtle.importKey(
      'raw',
      keyBits,
      { name: 'AES-CBC' },
      false,
      ['decrypt'],
    );

    // Decrypt using AES-256-CBC
    const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
      {
        name: 'AES-CBC',
        iv: ivBuffer as BufferSource,
      },
      encryptionKey,
      encryptedBuffer as BufferSource,
    );

    return new TextDecoder().decode(decryptedBuffer);
  }

  // Encrypt data using AES-CBC
  private async encryptLegacyData(
    jsonString: string,
    encryptionIv: Uint8Array,
    encryptionSalt: string,
    password: string,
  ): Promise<string> {
    // Derive encryption key using iron-session parameters
    const keyBits = await this.deriveKeyBits({
      password,
      salt: encryptionSalt,
      iterations: 1,
      hashAlgorithm: 'SHA-1',
      keyLength: 256,
    });

    const encryptionKey = await globalThis.crypto.subtle.importKey(
      'raw',
      keyBits,
      { name: 'AES-CBC' },
      false,
      ['encrypt'],
    );

    // Encrypt the JSON string
    const encryptedBuffer = await globalThis.crypto.subtle.encrypt(
      {
        name: 'AES-CBC',
        iv: encryptionIv as BufferSource,
      },
      encryptionKey,
      new TextEncoder().encode(jsonString),
    );

    return this.bytesToBase64url(new Uint8Array(encryptedBuffer));
  }

  // Create HMAC signature for iron-session format
  private async signSealedData(
    encryptionSaltHex: string,
    encryptionIvB64: string,
    encryptedB64: string,
    hmacSaltHex: string,
    expiration: number,
    password: string,
  ): Promise<string> {
    // Create the unsigned data for HMAC
    const unsignedData = `Fe26.2*1*${encryptionSaltHex}*${encryptionIvB64}*${encryptedB64}*${expiration}`;

    // Derive HMAC key
    const hmacKeyBits = await this.deriveKeyBits({
      password,
      salt: hmacSaltHex,
      iterations: 1,
      hashAlgorithm: 'SHA-1',
      keyLength: 256,
    });

    const hmacKey = await globalThis.crypto.subtle.importKey(
      'raw',
      hmacKeyBits,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    // Calculate HMAC signature
    const signature = await globalThis.crypto.subtle.sign(
      'HMAC',
      hmacKey,
      new TextEncoder().encode(unsignedData),
    );

    return this.bytesToBase64url(new Uint8Array(signature));
  }

  async sealData(
    data: unknown,
    { password, ttl = 0 }: { password: string; ttl?: number | undefined },
  ): Promise<string> {
    if (password.length < 32) {
      throw new Error('Password must be at least 32 characters long');
    }

    const jsonString = JSON.stringify(data);

    // Generate encryption components (matching iron-session)
    const encryptionSalt = this.generateRandomBytes(32);
    const hmacSalt = this.generateRandomBytes(32);
    const encryptionIv = this.generateRandomBytes(16);

    // Convert salts to hex (iron-session format)
    const encryptionSaltHex = this.bytesToHex(encryptionSalt);
    const hmacSaltHex = this.bytesToHex(hmacSalt);

    // Encrypt the session data
    const encryptedB64 = await this.encryptLegacyData(
      jsonString,
      encryptionIv,
      encryptionSaltHex,
      password,
    );

    const encryptionIvB64 = this.bytesToBase64url(encryptionIv);

    // Calculate expiration (iron-session uses milliseconds)
    const expiration =
      ttl > 0
        ? Date.now() + ttl * 1000
        : ttl < 0
          ? Date.now() + ttl * 1000
          : Date.now() + 24 * 60 * 60 * 1000;

    // Sign the sealed data
    const signatureB64 = await this.signSealedData(
      encryptionSaltHex,
      encryptionIvB64,
      encryptedB64,
      hmacSaltHex,
      expiration,
      password,
    );

    // Build iron-session format string (Fe26.2)
    const sealed = `Fe26.2*1*${encryptionSaltHex}*${encryptionIvB64}*${encryptedB64}*${expiration}*${hmacSaltHex}*${signatureB64}`;

    // Add version suffix for compatibility
    return `${sealed}${this.versionDelimiter}${this.currentMajorVersion}`;
  }

  async unsealData<T = unknown>(
    encryptedData: string,
    { password }: { password: string },
  ): Promise<T> {
    if (password.length < 32) {
      throw new Error('Password must be at least 32 characters long');
    }

    // Parse version
    const { sealWithoutVersion, tokenVersion } = this.parseSeal(encryptedData);

    // Parse iron-session legacy format
    const { encryptionSalt, encryptionIv, encryptedB64, expiration } =
      this.parseLegacyFormat(sealWithoutVersion);

    // Check expiration if present
    if (expiration) {
      const expirationTime = parseInt(expiration, 10);
      if (Date.now() > expirationTime) {
        throw new Error('Sealed data has expired');
      }
    }

    // Decrypt the data
    const decryptedText = await this.decryptLegacyData(
      encryptedB64,
      encryptionIv,
      encryptionSalt,
      password,
    );

    // Parse the JSON data
    const sessionData = JSON.parse(decryptedText);

    // Handle version-specific extraction (matching iron-session behavior)
    if (tokenVersion === 2) {
      return sessionData as T;
    } else if (tokenVersion !== null && tokenVersion !== 2) {
      // For older token versions, extract the persistent property
      return { ...(sessionData as any).persistent } as T;
    }

    // No version info - return as-is
    return sessionData as T;
  }
}

const pureWebcryptoEncryption = new PureWebcryptoEncryption();

export default pureWebcryptoEncryption;
