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
 * **Core Toolkit (Recommended):**
 * - AuthKitCore: Token verification, encryption, refresh orchestration
 * - AuthOperations: WorkOS API operations (signOut, refreshSession, URLs)
 * - CookieSessionStorage: Cookie building helpers
 * - ConfigurationProvider: Environment variable and config management
 *
 * **Optional Reference:**
 * - AuthService: Example orchestration pattern (frameworks can implement their own)
 */

// ============================================
// TIER 1: Core Business Logic (Required)
// ============================================
export { AuthKitCore } from './core/AuthKitCore.js';

// ============================================
// TIER 2: WorkOS Operations (Recommended)
// ============================================
export { AuthOperations } from './operations/AuthOperations.js';

// ============================================
// TIER 3: Storage Helpers (Recommended)
// ============================================
export { CookieSessionStorage } from './core/session/CookieSessionStorage.js';

// ============================================
// TIER 4: Configuration (Utility)
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

// ============================================
// Optional Reference Implementation
// ============================================
export { AuthService } from './service/AuthService.js';
export { createAuthService } from './service/factory.js';

// ============================================
// Legacy (Deprecated)
// ============================================
// These will be removed in the next major version.
// Migrate to AuthKitCore + AuthOperations instead.
export { SessionManager } from './core/session/SessionManager.js';
export { createAuthKitFactory } from './core/createAuthKitFactory.js';
