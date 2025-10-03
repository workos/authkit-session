import { once } from '../utils.js';
import { ConfigurationProvider } from './config/ConfigurationProvider.js';
import type { AuthKitConfig, ValueSource } from './config/types.js';

const getConfigurationInstance = once(() => new ConfigurationProvider());

/**
 * Configure AuthKit with a custom value source.
 * @param source The source of configuration values
 *
 * @example
 * configure(key => Deno.env.get(key));
 */
export function configure(source: ValueSource): void;
/**
 * Configure AuthKit with custom values.
 * @param config The configuration values
 *
 * @example
 * configure({
 *    clientId: 'your-client-id',
 *    redirectUri: 'https://your-app.com/auth/callback',
 *    apiKey: 'your-api-key',
 *    cookiePassword: 'your-cookie-password',
 *  });
 */
export function configure(config: Partial<AuthKitConfig>): void;
/**
 * Configure AuthKit with custom values and a custom value source.
 * @param config The configuration values
 * @param source The source of configuration values
 *
 * @example
 * configure({
 *   clientId: 'your-client-id',
 * }, env);
 */
export function configure(
  config: Partial<AuthKitConfig>,
  source: ValueSource,
): void;
export function configure(
  configOrSource: Partial<AuthKitConfig> | ValueSource,
  source?: ValueSource,
): void {
  getConfigurationInstance().configure(configOrSource, source);
}

/**
 * Get a configuration value by key.
 * This function will first check environment variables, then programmatically provided config,
 * and finally fall back to defaults for optional settings.
 * If a required setting is missing, an error will be thrown.
 * @param key The configuration key
 * @returns The configuration value
 */
export function getConfig<K extends keyof AuthKitConfig>(
  key: K,
): AuthKitConfig[K] {
  return getConfigurationInstance().getValue(key);
}

export function getConfigurationProvider(): ConfigurationProvider {
  return getConfigurationInstance();
}

export function getFullConfig(): AuthKitConfig {
  return getConfigurationInstance().getConfig();
}

/**
 * Validates that all required configuration values are present and meet requirements.
 * Collects all validation errors before throwing to provide comprehensive feedback.
 *
 * This is useful to call early in your application lifecycle to fail fast with
 * helpful error messages showing all missing/invalid configuration at once.
 *
 * @throws {Error} If any required configuration is missing or invalid
 *
 * @example
 * ```typescript
 * import { validateConfig } from '@workos/authkit-session';
 *
 * // Validate configuration on startup
 * try {
 *   validateConfig();
 * } catch (error) {
 *   console.error(error.message); // Shows all missing config at once
 *   process.exit(1);
 * }
 * ```
 */
export function validateConfig(): void {
  return getConfigurationInstance().validate();
}
