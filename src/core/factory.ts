import { ConfigurationProvider } from './config/ConfigurationProvider';
import type { AuthKitConfig } from './config/types';
import { SessionManager } from './session/SessionManager';
import TokenManager from './session/TokenManager';
import type { SessionStorage } from './session/types';
import { getWorkOS } from './workos';

export function createAuthKit<TRequest, TResponse>(options: {
  config?: Partial<AuthKitConfig>;
  storage: SessionStorage<TRequest, TResponse>;
}) {
  const { config, storage } = options;
  const configProvider = new ConfigurationProvider();

  if (config) {
    configProvider.configure(config);
  }

  const workos = getWorkOS();

  const tokenManager = new TokenManager(configProvider.getValue('clientId'));
  const sessionManager = new SessionManager<TRequest, TResponse>(
    configProvider,
    options.storage,
    tokenManager,
    workos,
  );

  return {
    withAuth: sessionManager.withAuth.bind(sessionManager),
    getAuthorizationUrl:
      sessionManager.getAuthorizationUrl.bind(sessionManager),
    refreshSession: sessionManager.refreshSession.bind(sessionManager),
    saveSession: storage.saveSession.bind(storage),
    getSignInUrl: (options: {
      organizationId?: string;
      loginHint?: string;
      redirectUri?: string;
    }) =>
      sessionManager.getAuthorizationUrl({ ...options, screenHint: 'sign-in' }),
    getSignUpUrl: (options: {
      organizationId?: string;
      loginHint?: string;
      redirectUri?: string;
    }) =>
      sessionManager.getAuthorizationUrl({ ...options, screenHint: 'sign-up' }),
  };
}
