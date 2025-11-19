/**
 * @workos/authkit-session
 *
 * A toolkit library for building WorkOS AuthKit integrations.
 * Provides business logic primitives (crypto, JWT, refresh) that framework
 * adapters use to implement authentication patterns.
 *
 * **Philosophy:**
 * - Extract complex business logic → Shared across frameworks
 * - Provide integration helpers → Cookie building, config management
 * - Let frameworks own patterns → updateSession/withAuth are framework-specific
 *
 * **Core Toolkit (Primitives):**
 * - AuthKitCore: Token verification, encryption, refresh orchestration
 * - AuthOperations: WorkOS API operations (signOut, refreshSession, URLs)
 * - CookieSessionStorage: Cookie building helpers
 * - ConfigurationProvider: Environment variable and config management
 *
 * **Orchestration (Your Choice):**
 * - AuthService: One orchestration pattern (used by @workos/authkit-tanstack-start)
 * - Or build your own orchestration using Core + Operations directly
 */

// ============================================
// Core Toolkit (Primitives)
// ============================================
export { AuthKitCore } from './core/AuthKitCore.js';
export { AuthOperations } from './operations/AuthOperations.js';

// ============================================
// Orchestration Pattern (Optional)
// ============================================
export { AuthService } from './service/AuthService.js';
export { createAuthService } from './service/factory.js';

// ============================================
// Storage Helpers
// ============================================
export { CookieSessionStorage } from './core/session/CookieSessionStorage.js';

// ============================================
// Configuration
// ============================================
export {
  configure,
  getConfig,
  getConfigurationProvider,
  validateConfig,
} from './core/config.js';
export { ConfigurationProvider } from './core/config/ConfigurationProvider.js';

// ============================================
// Client Factory
// ============================================
export { getWorkOS } from './core/client/workos.js';

// ============================================
// Type Exports
// ============================================
export * from './core/session/types.js';
export * from './core/config/types.js';
export type {
  User,
  Impersonator,
  Organization,
  WorkOS,
  AuthenticationResponse,
} from '@workos-inc/node';
