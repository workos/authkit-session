/**
 * @workos/authkit-session
 *
 * Framework-agnostic authentication library for WorkOS.
 *
 * Provides authentication business logic (JWT verification, token refresh)
 * with a pluggable storage adapter pattern for framework integration.
 *
 * **What frameworks do:**
 * - Implement storage adapter (SessionStorage<TRequest, TResponse>)
 * - Add middleware for auth validation and refresh
 * - Export framework-specific helpers
 * - Handle session encryption (or use our fallback)
 *
 * **What this library does:**
 * - All authentication logic (AuthService)
 * - JWT verification (JWKS with caching)
 * - Token refresh orchestration
 * - WorkOS API operations
 * - Session encryption fallback (iron-webcrypto, AES-256-CBC)
 */

// ============================================
// Public API
// ============================================
export { AuthService } from './service/AuthService.js';
export { createAuthService } from './service/factory.js';

// ============================================
// Advanced (Internal Layers)
// ============================================
export { AuthKitCore } from './core/AuthKitCore.js';
export { AuthOperations } from './operations/AuthOperations.js';

// ============================================
// Storage Helpers
// ============================================
export { CookieSessionStorage } from './core/session/CookieSessionStorage.js';

// ============================================
// Encryption Fallback
// ============================================
export { default as sessionEncryption } from './core/encryption/ironWebcryptoEncryption.js';

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
