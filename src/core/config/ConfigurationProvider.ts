import type { AuthKitConfig, ValueSource } from './types.js';

/**
 * Default environment variable source that uses process.env
 */
const defaultSource: ValueSource = (key: string): string | undefined => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const processEnv: Record<string, string> | undefined = (globalThis as any)
      ?.process?.env;
    return processEnv?.[key];
  } catch {
    return undefined;
  }
};

/**
 * Configuration class for AuthKit.
 * This class is used to manage configuration values and provide defaults.
 * It also provides a way to get configuration values from environment variables.
 * @internal
 */
export class ConfigurationProvider {
  private config: Partial<AuthKitConfig> = {
    cookieName: 'wos-session',
    apiHttps: true,
    // Defaults to 400 days, the maximum allowed by Chrome
    // It's fine to have a long cookie expiry date as the access/refresh tokens
    // act as the actual time-limited aspects of the session.
    cookieMaxAge: 60 * 60 * 24 * 400,
    apiHostname: 'api.workos.com',
  };

  private valueSource: ValueSource = defaultSource;

  private readonly requiredKeys: (keyof AuthKitConfig)[] = [
    'clientId',
    'apiKey',
    'redirectUri',
    'cookiePassword',
  ];

  /**
   * Convert a camelCase string to an uppercase, underscore-separated environment variable name.
   * @param str The string to convert
   * @returns The environment variable name
   */
  protected getEnvironmentVariableName(str: string) {
    return `WORKOS_${str.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}`;
  }

  private updateConfig(config: Partial<AuthKitConfig>): void {
    this.config = { ...this.config, ...config };
  }

  setValueSource(source: ValueSource): void {
    this.valueSource = source;
  }

  configure(
    configOrSource: Partial<AuthKitConfig> | ValueSource,
    source?: ValueSource,
  ): void {
    if (typeof configOrSource === 'function') {
      this.setValueSource(configOrSource);
    } else if (typeof configOrSource === 'object' && !source) {
      this.updateConfig(configOrSource);
    } else if (typeof configOrSource === 'object' && source) {
      this.updateConfig(configOrSource);
      this.setValueSource(source);
    }

    // Validate the cookiePassword if provided
    if (this.config.cookiePassword && this.config.cookiePassword.length < 32) {
      throw new Error('cookiePassword must be at least 32 characters long');
    }
  }

  getValue<K extends keyof AuthKitConfig>(key: K): AuthKitConfig[K] {
    const envKey = this.getEnvironmentVariableName(key);
    const envValue = this.getEnvironmentValue(envKey);

    // Use environment value if available, otherwise fall back to config
    const rawValue = envValue ?? this.config[key];

    if (rawValue != null) {
      return this.convertValueType(key, rawValue) as AuthKitConfig[K];
    }

    if (this.requiredKeys.includes(key)) {
      throw new Error(
        `Missing required configuration value for ${key} (${envKey}).`,
      );
    }

    return undefined as AuthKitConfig[K];
  }

  private getEnvironmentValue(envKey: string): string | undefined {
    const { valueSource } = this;

    if (typeof valueSource === 'function') {
      return valueSource(envKey);
    }

    if (valueSource && envKey in valueSource) {
      return valueSource[envKey];
    }

    return undefined;
  }

  private convertValueType<K extends keyof AuthKitConfig>(
    key: K,
    value: unknown,
  ): AuthKitConfig[K] | undefined {
    if (typeof value !== 'string') {
      return value as AuthKitConfig[K];
    }

    // Handle boolean conversion
    if (key === 'apiHttps') {
      return (value === 'true') as AuthKitConfig[K];
    }

    // Handle number conversion
    if (key === 'apiPort' || key === 'cookieMaxAge') {
      const num = parseInt(value, 10);
      return (isNaN(num) ? undefined : num) as AuthKitConfig[K];
    }

    return value as AuthKitConfig[K];
  }

  getConfig(): AuthKitConfig {
    // Build a complete config by merging stored config with environment variables
    const fullConfig = {} as AuthKitConfig;

    // Get all keys from the stored config and required keys
    const allKeys = new Set<keyof AuthKitConfig>([
      ...(Object.keys(this.config) as (keyof AuthKitConfig)[]),
      ...this.requiredKeys,
    ]);

    // Merge each key, with environment variables taking precedence
    for (const key of allKeys) {
      try {
        const value = this.getValue(key);
        if (value !== undefined) {
          (fullConfig as any)[key] = value;
        }
      } catch (error) {
        // If a required key is missing, let the error bubble up
        if (this.requiredKeys.includes(key)) {
          throw error;
        }
        // For optional keys, continue without the value
      }
    }

    return fullConfig;
  }
}
