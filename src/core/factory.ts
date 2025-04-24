import { once } from '../utils';
import { getWorkOS } from './client/client';
import type { WorkOSClient } from './client/types';
import { configure, getConfig, getConfigurationProvider } from './config';
import type { AuthKitConfig } from './config/types';
import { SessionEncryption as WebSessionEncryption } from './iron';
import { SessionManager } from './session/SessionManager';
import TokenManager from './session/TokenManager';
import type { SessionEncryption, SessionStorage } from './session/types';

export const createAuthKit = once(function createAuthKit<
  TRequest,
  TResponse,
>(options: {
  config?: Partial<AuthKitConfig>;
  storage: SessionStorage<TRequest, TResponse>;
  client: WorkOSClient;
  encryption: SessionEncryption;
}) {
  const { config, storage, encryption = new WebSessionEncryption() } = options;

  if (config) {
    configure(config);
  }

  const workos = options.client ?? getWorkOS();

  const tokenManager = new TokenManager(getConfig('clientId'), workos);
  const sessionManager = new SessionManager<TRequest, TResponse>(
    getConfigurationProvider(),
    options.storage,
    tokenManager,
    workos,
    encryption,
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
});
