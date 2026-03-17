/**
 * Session encoding configuration for gradual migration between sealed and unsealed formats.
 *
 * - `read: 'sealed'` — only accept iron-encrypted cookies (default)
 * - `read: 'unsealed'` — only accept base64url JSON cookies
 * - `read: 'both'` — try sealed first, fall back to unsealed (migration phase)
 * - `write: 'sealed'` — write iron-encrypted cookies (default)
 * - `write: 'unsealed'` — write base64url JSON cookies
 */
export interface SessionEncoding {
  read: 'sealed' | 'unsealed' | 'both';
  write: 'sealed' | 'unsealed';
}

/**
 * AuthKit Configuration Options
 */
export interface AuthKitConfig {
  /**
   * The WorkOS Client ID
   * Equivalent to the WORKOS_CLIENT_ID environment variable
   */
  clientId: string;

  /**
   * The WorkOS API Key
   * Equivalent to the WORKOS_API_KEY environment variable
   */
  apiKey: string;

  /**
   * The redirect URI for the authentication callback
   * Equivalent to the WORKOS_REDIRECT_URI environment variable
   */
  redirectUri: string;

  /**
   * The password used to encrypt the session cookie
   * Equivalent to the WORKOS_COOKIE_PASSWORD environment variable
   * Must be at least 32 characters long.
   * Not required when sessionEncoding is fully unsealed ({ read: 'unsealed', write: 'unsealed' }).
   */
  cookiePassword?: string;

  /**
   * The hostname of the API to use
   * Equivalent to the WORKOS_API_HOSTNAME environment variable
   */
  apiHostname?: string;

  /**
   * Whether to use HTTPS for API requests
   * Equivalent to the WORKOS_API_HTTPS environment variable
   */
  apiHttps: boolean;

  /**
   * The port to use for the API
   * Equivalent to the WORKOS_API_PORT environment variable
   */
  apiPort?: number;

  /**
   * The maximum age of the session cookie in seconds
   * Equivalent to the WORKOS_COOKIE_MAX_AGE environment variable
   */
  cookieMaxAge: number;

  /**
   * The sameSite attribute for the session cookie
   */
  cookieSameSite?: 'strict' | 'lax' | 'none';

  /**
   * The name of the session cookie
   * Equivalent to the WORKOS_COOKIE_NAME environment variable
   * Defaults to "wos-session"
   */
  cookieName: string;

  /**
   * The domain for the session cookie
   */
  cookieDomain?: string;

  /**
   * Session encoding configuration.
   * Controls whether sessions are sealed (iron-encrypted) or unsealed (base64url JSON).
   * Use to migrate between formats without breaking existing sessions.
   *
   * Defaults to { read: 'sealed', write: 'sealed' } for backward compatibility.
   *
   * Environment variables: WORKOS_SESSION_ENCODING_READ, WORKOS_SESSION_ENCODING_WRITE
   */
  sessionEncoding?: SessionEncoding;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ValueSource = Record<string, any> | ((key: string) => any);
