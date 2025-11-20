import type { WorkOS } from '@workos-inc/node';
import { once } from '../utils.js';
import { getConfigurationProvider, getFullConfig } from '../core/config.js';
import type { AuthKitConfig } from '../core/config/types.js';
import { getWorkOS } from '../core/client/workos.js';
import sessionEncryption from '../core/encryption/ironWebcryptoEncryption.js';
import type {
  SessionEncryption,
  SessionStorage,
} from '../core/session/types.js';
import { AuthService } from './AuthService.js';

/**
 * Creates an AuthService instance with lazy initialization support.
 *
 * This factory function provides ergonomic AuthService creation with sensible defaults.
 * The returned service uses lazy initialization, allowing configure() to be called
 * after instantiation but before first use.
 *
 * @param options - Configuration options
 * @param options.sessionStorageFactory - Factory function to create storage adapter
 * @param options.clientFactory - Optional factory for WorkOS client (defaults to getWorkOS)
 * @param options.encryptionFactory - Optional factory for encryption (defaults to iron-webcrypto)
 * @returns AuthService instance with lazy initialization
 *
 * @example
 * ```typescript
 * // Create service (config not needed yet)
 * export const authService = createAuthService({
 *   sessionStorageFactory: (config) => new MyFrameworkStorage(config),
 * });
 *
 * // Configure later
 * configure({ clientId: '...' });
 *
 * // Use (triggers lazy init)
 * await authService.withAuth(request);
 * ```
 */
export function createAuthService<TRequest, TResponse>(options: {
  sessionStorageFactory: (
    config: AuthKitConfig,
  ) => SessionStorage<TRequest, TResponse>;
  clientFactory?: (config: AuthKitConfig) => WorkOS;
  encryptionFactory?: (config: AuthKitConfig) => SessionEncryption;
}): AuthService<TRequest, TResponse> {
  const {
    sessionStorageFactory,
    clientFactory = () => getWorkOS(),
    encryptionFactory = () => sessionEncryption,
  } = options;

  // Storage needs to be created with lazy config evaluation
  // We create a wrapper storage that delegates to the real storage lazily
  const getStorage = once(() => sessionStorageFactory(getFullConfig()));

  // Create a proxy storage that lazily instantiates the real storage
  const lazyStorage: SessionStorage<TRequest, TResponse> = {
    getSession: async (request: TRequest) => getStorage().getSession(request),
    saveSession: async (response: TResponse | undefined, sessionData: string) =>
      getStorage().saveSession(response, sessionData),
    clearSession: async (response: TResponse) =>
      getStorage().clearSession(response),
  };

  return new AuthService<TRequest, TResponse>(
    getConfigurationProvider(),
    lazyStorage,
    clientFactory,
    encryptionFactory,
  );
}
