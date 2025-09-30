import type { User, Impersonator, WorkOS } from '@workos-inc/node';
export interface UserManagementInterface {
  getAuthorizationUrl: (options: AuthorizationURLOptions) => string;
  authenticateWithCode: (
    options: AuthenticateWithCodeOptions,
  ) => Promise<AuthenticationResponse>;
  authenticateWithRefreshToken: (
    options: AuthenticateWithRefreshTokenOptions,
  ) => Promise<AuthenticationResponse>;
  getLogoutUrl: (options: { sessionId: string; returnTo?: string }) => string;
  revokeSession: (options: { sessionId: string }) => Promise<void>;
}

export interface WorkOSClientConstructor {
  new (apiKey: string, options?: WorkOSOptions): WorkOS;
}

export interface AppInfo {
  name: string;
  version: string;
}

export interface WorkOSOptions {
  apiHostname?: string;
  https?: boolean;
  port?: number;
  config?: RequestInit;
  appInfo?: AppInfo;
  fetchFn?: typeof fetch;
  clientId?: string;
}

export interface AuthenticationResponse {
  user: User;
  organizationId?: string;
  accessToken: string;
  refreshToken: string;
  impersonator?: Impersonator;
  authenticationMethod?: string;
  sealedSession?: string;
}

export interface AuthenticateWithOptionsBase {
  clientId: string;
  ipAddress?: string;
  userAgent?: string;
  session?: {
    cookiePassword?: string;
    sealSession: boolean;
  };
}

export interface AuthenticateWithRefreshTokenOptions
  extends AuthenticateWithOptionsBase {
  refreshToken: string;
  organizationId?: string;
}

export interface AuthenticateWithCodeOptions
  extends AuthenticateWithOptionsBase {
  codeVerifier?: string;
  code: string;
  invitationToken?: string;
}

export interface AuthenticateWithEmailVerificationOptions
  extends AuthenticateWithOptionsBase {
  code: string;
  pendingAuthenticationToken: string;
}

export interface AuthorizationURLOptions {
  clientId: string;
  codeChallenge?: string;
  codeChallengeMethod?: 'S256';
  connectionId?: string;
  context?: string;
  organizationId?: string;
  domainHint?: string;
  loginHint?: string;
  provider?: string;
  redirectUri: string;
  state?: string;
  screenHint?: 'sign-up' | 'sign-in';
}
