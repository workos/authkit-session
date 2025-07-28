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

    terminateSession: (
      ...args: Parameters<(typeof SessionManager.prototype)['terminateSession']>
    ) => getSessionManager().terminateSession(...args),

    signOut: async (
      request: TRequest,
      response: TResponse,
      options?: { returnTo?: string },
    ) => {
      // Get the current session
      const authResult = await getSessionManager().withAuth(request);

      if (
        !authResult.user ||
        !authResult.accessToken ||
        !authResult.refreshToken
      ) {
        // No session to terminate, just clear cookies
        return sessionStorageFactory(getFullConfig()).clearSession(response);
      }

      // Create session object for termination
      const session = {
        accessToken: authResult.accessToken,
        refreshToken: authResult.refreshToken,
        user: authResult.user,
        impersonator: authResult.impersonator,
      };

      // Terminate the session (this clears cookies and returns logout URL)
      const result = await getSessionManager().terminateSession(
        session,
        response,
        options,
      );

      return result.response;
    },

    switchToOrganization: (
      ...args: Parameters<
        (typeof SessionManager.prototype)['switchToOrganization']
      >
    ) => getSessionManager().switchToOrganization(...args),

    handleCallback: async (
      request: TRequest,
      response: TResponse,
      options: { code: string; state?: string },
    ) => {
      const client = clientFactory(getFullConfig());
      const config = getFullConfig();

      // Authenticate with the OAuth code
      const authResponse = await client.userManagement.authenticateWithCode({
        code: options.code,
        clientId: config.clientId,
      });

      // Create session using SessionManager
      const updatedResponse = await getSessionManager().createSession(
        authResponse,
        response,
      );

      // Decode state if provided
      let returnPathname = '/';
      if (options.state) {
        try {
          const decoded = JSON.parse(atob(options.state));
          returnPathname = decoded.returnPathname || '/';
        } catch {
          // Invalid state, use default
        }
      }

      return {
        response: updatedResponse,
        returnPathname,
        authResponse,
      };
    },

    getTokenClaims: async <TCustomClaims = CustomClaims>(
      request: TRequest,
      accessToken?: string,
    ): Promise<Partial<BaseTokenClaims & TCustomClaims>> => {
      const tokenToUse =
        accessToken ||
        (await getSessionManager().withAuth<TCustomClaims>(request))
          .accessToken;

      if (!tokenToUse) {
        return {};
      }

      try {
        return getTokenManager().parseTokenClaims<TCustomClaims>(tokenToUse);
      } catch {
        return {};
      }
    },
  };
});
