/**
 * Configuration shared by both client modes.
 */
interface AuthKitBaseConfig {
  /**
   * The WorkOS Client ID
   * Equivalent to the WORKOS_CLIENT_ID environment variable
   */
  clientId: string;

  /**
   * The redirect URI for the authentication callback
   * Equivalent to the WORKOS_REDIRECT_URI environment variable
   */
  redirectUri: string;

  /**
   * The password used to encrypt the session cookie
   * Equivalent to the WORKOS_COOKIE_PASSWORD environment variable
   * Must be at least 32 characters long
   */
  cookiePassword: string;

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
   * Equivalent to the WORKOS_COOKIE_SAME_SITE environment variable
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
   * Equivalent to the WORKOS_COOKIE_DOMAIN environment variable
   */
  cookieDomain?: string;
}

/**
 * Confidential client: the server holds a WorkOS API key.
 *
 * The key is sent as the client secret on code exchange and refresh
 * (alongside PKCE) and is required for WorkOS management APIs called through
 * `getWorkOS()`, such as `organizations.*` or `userManagement.getUser`.
 */
export interface AuthKitConfidentialConfig extends AuthKitBaseConfig {
  /**
   * The WorkOS API Key
   * Equivalent to the WORKOS_API_KEY environment variable
   */
  apiKey: string;
}

/**
 * Public client (keyless): the server holds no WorkOS API key.
 *
 * Sign-in, callback, session refresh, organization switching and sign-out all
 * work; PKCE protects the code exchange and the refresh token is bound to the
 * client ID. WorkOS management APIs are unavailable.
 */
export interface AuthKitPublicConfig extends AuthKitBaseConfig {
  apiKey?: never;
}

/**
 * AuthKit Configuration Options
 *
 * Discriminated on the presence of `apiKey`: {@link AuthKitConfidentialConfig}
 * when set, {@link AuthKitPublicConfig} when not. Configuration is resolved at
 * runtime from environment variables and `configure()`, so
 * `getConfig('apiKey')` is typed `string | undefined`.
 */
export type AuthKitConfig = AuthKitConfidentialConfig | AuthKitPublicConfig;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ValueSource = Record<string, any> | ((key: string) => any);
