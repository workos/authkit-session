import HttpClient from '../../HttpClient';
import type {
  AuthenticationResponse,
  AuthenticateWithRefreshTokenOptions,
  AuthenticateWithCodeOptions,
  AuthenticateWithEmailVerificationOptions,
  AuthorizationURLOptions,
} from './types';

export class UserManagement {
  private client: HttpClient;
  private baseURL: string;
  private key: string;
  readonly clientId: string | undefined;
  // readonly ironSessionProvider: IronSessionProvider;

  constructor(
    apiKey: string,
    options: {
      apiHostname?: string;
      https?: boolean;
      port?: number;
      clientId?: string;
      appInfo?: { name: string; version: string };
    } = {},
  ) {
    this.key = apiKey;
    this.clientId = options.clientId;

    const hostname = options.apiHostname || 'api.workos.com';
    const protocol = options.https !== false ? 'https' : 'http';
    const port = options.port ? `:${options.port}` : '';

    this.baseURL = `${protocol}://${hostname}${port}`;
    // this.ironSessionProvider = new IronSessionProvider();

    this.client = new HttpClient({
      baseUrl: this.baseURL,
      defaultHeaders: {
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': options.appInfo
          ? `${options.appInfo.name}/${options.appInfo.version}`
          : 'authkit-ssr',
      },
    });
  }

  // Helper method to create a query string
  private toQueryString(params: Record<string, string | undefined>): string {
    const searchParams = new URLSearchParams();
    const keys = Object.keys(params).sort();

    for (const key of keys) {
      const value = params[key];
      if (value) {
        searchParams.append(key, value);
      }
    }

    return searchParams.toString();
  }

  getJwksUrl(clientId: string): string {
    if (!clientId) {
      throw TypeError('clientId must be a valid clientId');
    }

    return `${this.baseURL}/sso/jwks/${clientId}`;
  }

  getLogoutUrl({
    sessionId,
    returnTo,
  }: {
    sessionId: string;
    returnTo?: string;
  }): string {
    if (!sessionId) {
      throw new TypeError(`Incomplete arguments. Need to specify 'sessionId'.`);
    }

    const url = new URL(`${this.baseURL}/user_management/sessions/logout`);
    url.searchParams.set('session_id', sessionId);

    if (returnTo) {
      url.searchParams.set('return_to', returnTo);
    }

    return url.toString();
  }

  getAuthorizationUrl({
    connectionId,
    codeChallenge,
    codeChallengeMethod,
    context,
    clientId,
    domainHint,
    loginHint,
    organizationId,
    provider,
    redirectUri,
    state,
    screenHint,
  }: AuthorizationURLOptions): string {
    if (!provider && !connectionId && !organizationId) {
      throw new TypeError(
        `Incomplete arguments. Need to specify either a 'connectionId', 'organizationId', or 'provider'.`,
      );
    }

    if (provider !== 'authkit' && screenHint) {
      throw new TypeError(
        `'screenHint' is only supported for 'authkit' provider`,
      );
    }

    const query = this.toQueryString({
      connection_id: connectionId,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      context,
      organization_id: organizationId,
      domain_hint: domainHint,
      login_hint: loginHint,
      provider,
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
      screen_hint: screenHint,
    });

    return `${this.baseURL}/user_management/authorize?${query}`;
  }

  async authenticateWithRefreshToken(
    options: AuthenticateWithRefreshTokenOptions,
  ): Promise<AuthenticationResponse> {
    const { data } = await this.client.post<any>(
      '/user_management/authenticate',
      {
        grant_type: 'refresh_token',
        client_id: options.clientId,
        client_secret: this.key,
        refresh_token: options.refreshToken,
        organization_id: options.organizationId,
        ip_address: options.ipAddress,
        user_agent: options.userAgent,
      },
    );

    return this.deserializeAuthResponse(data);
  }

  async authenticateWithCode(
    options: AuthenticateWithCodeOptions,
  ): Promise<AuthenticationResponse> {
    const { data } = await this.client.post<any>(
      '/user_management/authenticate',
      {
        grant_type: 'authorization_code',
        client_id: options.clientId,
        client_secret: this.key,
        code: options.code,
        code_verifier: options.codeVerifier,
        invitation_token: options.invitationToken,
        ip_address: options.ipAddress,
        user_agent: options.userAgent,
      },
    );

    return this.deserializeAuthResponse(data);
  }

  async authenticateWithEmailVerification(
    options: AuthenticateWithEmailVerificationOptions,
  ): Promise<AuthenticationResponse> {
    const { data } = await this.client.post<any>(
      '/user_management/authenticate',
      {
        grant_type: 'urn:workos:oauth:grant-type:email-verification:code',
        client_id: options.clientId,
        client_secret: this.key,
        pending_authentication_token: options.pendingAuthenticationToken,
        code: options.code,
        ip_address: options.ipAddress,
        user_agent: options.userAgent,
      },
    );

    return this.deserializeAuthResponse(data);
  }

  // Helper to deserialize auth response
  private deserializeAuthResponse(data: any): AuthenticationResponse {
    return {
      user: {
        object: data.user.object,
        id: data.user.id,
        email: data.user.email,
        emailVerified: data.user.email_verified,
        firstName: data.user.first_name,
        profilePictureUrl: data.user.profile_picture_url,
        lastName: data.user.last_name,
        lastSignInAt: data.user.last_sign_in_at,
        createdAt: data.user.created_at,
        updatedAt: data.user.updated_at,
        externalId: data.user.external_id ?? null,
        metadata: data.user.metadata ?? {},
      },
      organizationId: data.organization_id,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      impersonator: data.impersonator,
      authenticationMethod: data.authentication_method,
    };
  }
}
