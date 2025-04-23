import * as Iron from 'iron-webcrypto';
/**
 * A compatible implementation that works with iron-session
 */
const versionDelimiter = '~';
const currentMajorVersion = 2;

/**
 * Parse an iron-session seal to extract the version
 */
function parseSeal(seal: string): {
  sealWithoutVersion: string;
  tokenVersion: number | null;
} {
  const [sealWithoutVersion = '', tokenVersionAsString] =
    seal.split(versionDelimiter);
  const tokenVersion =
    tokenVersionAsString == null ? null : parseInt(tokenVersionAsString, 10);
  return { sealWithoutVersion, tokenVersion };
}

/**
 * Encrypt data in a way that's compatible with iron-session
 */
export async function sealData(data: unknown, password: string) {
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
    ttl: 0,
    timestampSkewSec: 60,
    localtimeOffsetMsec: 0,
  });

  // Add the version delimiter exactly like iron-session does
  return `${seal}${versionDelimiter}${currentMajorVersion}`;
}

/**
 * Decrypt data from iron-session with HMAC verification
 */
export async function unsealData<T = unknown>(
  encryptedData: string,
  password: string,
) {
  // First, parse the seal to extract the version and get just the seal part
  const { sealWithoutVersion, tokenVersion } = parseSeal(encryptedData);

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
