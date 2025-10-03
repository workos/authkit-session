export { getWorkOS } from './core/client/workos.js';
export {
  configure,
  getConfig,
  getConfigurationProvider,
  validateConfig,
} from './core/config.js';
export { SessionManager } from './core/session/SessionManager.js';
export { CookieSessionStorage } from './core/session/CookieSessionStorage.js';
export { createAuthKitFactory } from './core/createAuthKitFactory.js';
export * from './core/session/types.js';
export * from './core/config/types.js';
export type { User, Impersonator, Organization, WorkOS, AuthenticationResponse } from '@workos-inc/node';
