// Core business logic
export { AuthKitCore } from './core/AuthKitCore.js';

// High-level operations
export { AuthOperations } from './operations/AuthOperations.js';

// Integration layer
export { AuthService } from './service/AuthService.js';

// Configuration
export {
  configure,
  getConfig,
  getConfigurationProvider,
  validateConfig,
} from './core/config.js';
export { ConfigurationProvider } from './core/config/ConfigurationProvider.js';

// Storage adapters
export { CookieSessionStorage } from './core/session/CookieSessionStorage.js';

// Client
export { getWorkOS } from './core/client/workos.js';

// Type exports
export * from './core/session/types.js';
export * from './core/config/types.js';
export type {
  User,
  Impersonator,
  Organization,
  WorkOS,
  AuthenticationResponse,
} from '@workos-inc/node';

// Legacy exports (deprecated - will be removed in next major version)
export { SessionManager } from './core/session/SessionManager.js';
export { createAuthKitFactory } from './core/createAuthKitFactory.js';

// Convenience factory function
export { createAuthService } from './service/factory.js';
