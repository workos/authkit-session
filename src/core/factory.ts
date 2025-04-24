import { once } from '../utils';
import { getWorkOS } from './client/client';
import type { WorkOSClient } from './client/types';
import { getConfig, getConfigurationProvider } from './config';
import { SessionEncryption as WebSessionEncryption } from './iron';
import { SessionManager } from './session/SessionManager';
import TokenManager from './session/TokenManager';
import type { SessionEncryption, SessionStorage } from './session/types';

export const createAuthKit = once(function createAuthKit<
  TRequest,
  TResponse,
>(options: {
  storage: SessionStorage<TRequest, TResponse>;
  encryptionFactory?: () => SessionEncryption;
  clientFactory?: () => WorkOSClient;
}) {
  const {
    storage,
    clientFactory = () => getWorkOS(),
    encryptionFactory = () => new WebSessionEncryption(),
  } = options;

  const getTokenManager = once(
    () => new TokenManager(getConfig('clientId'), clientFactory()),
  );

  const getSessionManager = once(
    () =>
      new SessionManager<TRequest, TResponse>(
        getConfigurationProvider(),
        options.storage,
        getTokenManager(),
        clientFactory(),
        encryptionFactory(),
      ),
  );

  return {
    withAuth: (
      ...args: Parameters<(typeof SessionManager.prototype)['withAuth']>
    ) => getSessionManager().withAuth(...args),

    getAuthorizationUrl: (
      ...args: Parameters<
        (typeof SessionManager.prototype)['getAuthorizationUrl']
      >
    ) => getSessionManager().getAuthorizationUrl(...args),

    refreshSession: (
      ...args: Parameters<(typeof SessionManager.prototype)['refreshSession']>
    ) => getSessionManager().refreshSession(...args),

    saveSession: storage.saveSession.bind(storage),

    getSignInUrl: (options: {
      organizationId?: string;
      loginHint?: string;
      redirectUri?: string;
    }) =>
      getSessionManager().getAuthorizationUrl({
        ...options,
        screenHint: 'sign-in',
      }),

    getSignUpUrl: (options: {
      organizationId?: string;
      loginHint?: string;
      redirectUri?: string;
    }) =>
      getSessionManager().getAuthorizationUrl({
        ...options,
        screenHint: 'sign-up',
      }),

    getLogoutUrl: (
      ...args: Parameters<(typeof SessionManager.prototype)['terminateSession']>
    ) => getSessionManager().terminateSession(...args),
  };
});
