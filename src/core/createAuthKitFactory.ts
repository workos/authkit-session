import { once } from '../utils';
import { getWorkOS } from './client/WorkOSLite';
import type { WorkOSClient } from './client/types';
import { getConfig, getConfigurationProvider, getFullConfig } from './config';
import type { AuthKitConfig } from './config/types';
import sessionEncryption from './encryption/ironWebcryptoEncryption';
import { SessionManager } from './session/SessionManager';
import TokenManager from './session/TokenManager';
import type {
  BaseTokenClaims,
  CustomClaims,
  SessionEncryption,
  SessionStorage,
} from './session/types';

export const createAuthKitFactory = once(function createAuthKit<
  TRequest,
  TResponse,
>(options: {
  sessionStorageFactory: (
    config: AuthKitConfig,
  ) => SessionStorage<TRequest, TResponse>;
  sessionEncryptionFactory?: (confg: AuthKitConfig) => SessionEncryption;
  clientFactory?: (config: AuthKitConfig) => WorkOSClient;
}) {
  const {
    sessionStorageFactory,
    clientFactory = () => getWorkOS(),
    sessionEncryptionFactory = () => sessionEncryption,
  } = options;

  const getTokenManager = once(
    () =>
      new TokenManager(getConfig('clientId'), clientFactory(getFullConfig())),
  );

  const getSessionManager = once(
    () =>
      new SessionManager<TRequest, TResponse>(
        getConfigurationProvider(),
        sessionStorageFactory(getFullConfig()),
        getTokenManager(),
        clientFactory(getFullConfig()),
        sessionEncryptionFactory(getFullConfig()),
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

    saveSession: (
      ...args: Parameters<SessionStorage<TRequest, TResponse>['saveSession']>
    ) => sessionStorageFactory(getFullConfig()).saveSession(...args),

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

    switchToOrganization: (
      ...args: Parameters<
        (typeof SessionManager.prototype)['switchToOrganization']
      >
    ) => getSessionManager().switchToOrganization(...args),

    getTokenClaims: async <TCustomClaims = CustomClaims>(
      request: TRequest,
      accessToken?: string,
    ): Promise<Partial<BaseTokenClaims & TCustomClaims>> => {
      if (accessToken) {
        try {
          return getTokenManager().parseTokenClaims<TCustomClaims>(accessToken);
        } catch {
          return {};
        }
      }

      const authResult =
        await getSessionManager().withAuth<TCustomClaims>(request);
      if (!authResult.accessToken) {
        return {};
      }

      try {
        return getTokenManager().parseTokenClaims<TCustomClaims>(
          authResult.accessToken,
        );
      } catch {
        return {};
      }
    },
  };
});
