import type { AccessToken, User } from '@workos-inc/node';
import type { ConfigurationProvider } from '../config/ConfigurationProvider';
import type { TokenManager } from './TokenManager';
import type { AuthResult, SessionStorage, Session } from './types';
import { unsealData } from 'iron-session';

export class SessionManager<TRequest, TResponse> {
  private readonly config: ConfigurationProvider;
  private readonly storage: SessionStorage<TRequest, TResponse>;
  private readonly tokenManager: TokenManager;

  constructor(
    config: ConfigurationProvider,
    storage: SessionStorage<TRequest, TResponse>,
    tokenManager: TokenManager,
  ) {
    this.config = config;
    this.storage = storage;
    this.tokenManager = tokenManager;
  }

  async withAuth<TCustomClaims = {}>(
    request: TRequest,
  ): Promise<AuthResult<TCustomClaims>> {
    const encryptedSession = await this.storage.getSession(request);

    if (!encryptedSession) {
      return { user: null };
    }

    const session = await unsealData<Session>(encryptedSession, {
      password: this.config.getValue('cookiePassword'),
    });

    const isValid = await this.tokenManager.verifyToken(session.accessToken);

    if (!isValid) {
    }

    const claims = this.tokenManager.parseTokenClaims<
      AccessToken & TCustomClaims
    >(session.accessToken);

    return {
      user: session.user,
      claims,
      sessionId: claims.sid,
    };
  }
}
