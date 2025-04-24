export interface UserManagementInterface {
  getAuthorizationUrl: (options: AuthorizationURLOptions) => string;
  authenticateWithCode: (
    options: AuthenticateWithCodeOptions,
  ) => Promise<AuthenticationResponse>;
  authenticateWithRefreshToken: (
    options: AuthenticateWithRefreshTokenOptions,
  ) => Promise<AuthenticationResponse>;
  getLogoutUrl: (optoions: { sessionId: string; returnTo?: string }) => string;
}

export interface WorkOSClientConstructor {
  new (apiKey: string, options?: WorkOSOptions): WorkOSClient;
}

export interface WorkOSClient {
  userManagement: UserManagementInterface;
  getJwksUrl: (clientId: string) => string;
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

export interface User {
  object: string;
  id: string;
  email: string;
  emailVerified: boolean;
  profilePictureUrl: string | null;
  firstName: string | null;
  lastName: string | null;
  lastSignInAt: string | null;
  createdAt: string;
  updatedAt: string;
  externalId: string | null;
  metadata: Record<string, string>;
}

export interface Impersonator {
  email: string;
  reason: string | null;
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
