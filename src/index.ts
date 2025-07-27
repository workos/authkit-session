export { getWorkOS } from './core/client/WorkOSLite';
export { configure, getConfig } from './core/config';
export { SessionManager } from './core/session/SessionManager';
export { CookieSessionStorage } from './core/session/CookieSessionStorage';
export { createAuthKitFactory } from './core/createAuthKitFactory';
export * from './core/session/types';
export * from './core/config/types';
export type { User, Impersonator, Organization } from '@workos-inc/node';
