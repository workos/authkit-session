import { once } from '../utils';
import { ConfigurationProvider } from './config/ConfigurationProvider';
import type { AuthKitConfig, ValueSource } from './config/types';

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
  const config = getConfigurationInstance();
  config.configure(configOrSource, source);
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
  const config = getConfigurationInstance();
  return config.getValue(key);
}

export function getConfigurationProvider(): ConfigurationProvider {
  return getConfigurationInstance();
}

export function getFullConfig(): AuthKitConfig {
  const config = getConfigurationInstance();
  return config.getConfig();
}
