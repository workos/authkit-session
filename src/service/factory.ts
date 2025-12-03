import type { WorkOS } from '@workos-inc/node';
import { once } from '../utils.js';
import { getFullConfig } from '../core/config.js';
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

  // Lazily create the real AuthService with resolved config
  const getService = once(() => {
    const config = getFullConfig();
    const storage = sessionStorageFactory(config);
    const client = clientFactory(config);
    const encryption = encryptionFactory(config);
    return new AuthService(config, storage, client, encryption);
  });

  // Return proxy that lazily delegates to the real service
  // This allows configure() to be called after createAuthService() but before first use
  return {
    withAuth: request => getService().withAuth(request),
    getSession: request => getService().getSession(request),
    saveSession: (response, sessionData) =>
      getService().saveSession(response, sessionData),
    clearSession: response => getService().clearSession(response),
    signOut: (sessionId, opts) => getService().signOut(sessionId, opts),
    switchOrganization: (session, organizationId) =>
      getService().switchOrganization(session, organizationId),
    refreshSession: (session, organizationId) =>
      getService().refreshSession(session, organizationId),
    getAuthorizationUrl: opts => getService().getAuthorizationUrl(opts),
    getSignInUrl: opts => getService().getSignInUrl(opts),
    getSignUpUrl: opts => getService().getSignUpUrl(opts),
    getWorkOS: () => getService().getWorkOS(),
    handleCallback: (request, response, opts) =>
      getService().handleCallback(request, response, opts),
  } as AuthService<TRequest, TResponse>;
}
