# @workos/authkit-session

> [!WARNING]
> This is prerelease software. APIs may change without notice.

A framework-agnostic authentication library for WorkOS with a modular adapter system for server-side rendered applications.

This library serves as the foundation for framework-specific WorkOS authentication packages like `@workos-inc/authkit-nextjs`, `@workos-inc/authkit-remix`, and `@workos-inc/authkit-sveltekit`. By implementing the `SessionStorage` interface for your framework, you can provide WorkOS authentication capabilities with minimal framework-specific code.

## Features

- **Framework-agnostic core**: Common authentication logic that works across platforms
- **Adapter pattern**: Simple interface for framework-specific implementations
- **Session management**: Secure encrypted cookie-based authentication
- **JWT handling**: Token validation, parsing, and refresh
- **Organization switching**: Switch user context between organizations
- **Type-safe API**: Full TypeScript support with custom claims
- **Token claims parsing**: Extract and validate JWT claims

## Installation

```bash
# Using npm
npm install @workos/authkit-session

# Using pnpm
pnpm add @workos/authkit-session

# Using yarn
yarn add @workos/authkit-session
```

## Quick Start

1. Configure AuthKit with your WorkOS credentials:

```typescript
import { configure, createAuthKitFactory } from '@workos/authkit-session';

configure({
  clientId: 'your-client-id',
  apiKey: 'your-workos-api-key',
  redirectUri: 'https://yourdomain.com/auth/callback',
  cookiePassword: 'must-be-at-least-32-characters-long-secret',
});
```

2. Create a storage adapter for your framework:

```typescript
import {
  createAuthKitFactory,
  CookieSessionStorage,
} from '@workos/authkit-session';
import type {
  SessionStorage,
  ConfigurationProvider,
} from '@workos/authkit-session';

// Option 1: Extend CookieSessionStorage (recommended)
class MyFrameworkStorage extends CookieSessionStorage<MyRequest, MyResponse> {
  constructor(config: ConfigurationProvider) {
    super(config);
  }

  async getSession(request: MyRequest): Promise<string | null> {
    // Extract cookie from your framework's request object
    const cookies = request.headers.cookie || '';
    const match = cookies.match(new RegExp(`${this.cookieName}=([^;]+)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  async saveSession(
    response: MyResponse,
    sessionData: string,
  ): Promise<MyResponse> {
    // Set cookie on your framework's response object
    const cookieValue = `${this.cookieName}=${encodeURIComponent(sessionData)}; ${this.getCookieAttributes()}`;
    response.headers['Set-Cookie'] = cookieValue;
    return response;
  }

  async clearSession(response: MyResponse): Promise<MyResponse> {
    // Clear cookie by setting expired date
    const expiredCookie = `${this.cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    response.headers['Set-Cookie'] = expiredCookie;
    return response;
  }

  private getCookieAttributes(): string {
    const attrs = [];
    if (this.cookieOptions.path) attrs.push(`path=${this.cookieOptions.path}`);
    if (this.cookieOptions.domain)
      attrs.push(`domain=${this.cookieOptions.domain}`);
    if (this.cookieOptions.maxAge)
      attrs.push(`max-age=${this.cookieOptions.maxAge}`);
    if (this.cookieOptions.httpOnly) attrs.push('httponly');
    if (this.cookieOptions.secure) attrs.push('secure');
    if (this.cookieOptions.sameSite)
      attrs.push(`samesite=${this.cookieOptions.sameSite}`);
    return attrs.join('; ');
  }
}

// Option 2: Implement SessionStorage interface directly
class CustomStorage implements SessionStorage<MyRequest, MyResponse> {
  async getSession(request: MyRequest): Promise<string | null> {
    // Your custom session retrieval logic
    return getSessionFromRequest(request);
  }

  async saveSession(
    response: MyResponse,
    sessionData: string,
  ): Promise<MyResponse> {
    // Your custom session storage logic
    return saveSessionToResponse(response, sessionData);
  }

  async clearSession(response: MyResponse): Promise<MyResponse> {
    // Your custom session clearing logic
    return clearSessionFromResponse(response);
  }
}

// Create your AuthKit instance
const authKit = createAuthKitFactory<MyRequest, MyResponse>({
  sessionStorageFactory: config => new MyFrameworkStorage(config),
});
```

3. Use AuthKit in your application:

```typescript
// Validate a session
const { user, claims, sessionId, impersonator, accessToken, refreshToken } =
  await authKit.withAuth(request);

// Note: ensureSignedIn option not yet implemented
// Framework adapters should handle redirects when user is null

// Generate an authorization URL
const authUrl = await authKit.getAuthorizationUrl({
  returnPathname: '/dashboard',
  redirectUri: 'https://yourdomain.com/auth/callback',
  screenHint: 'sign-in', // or 'sign-up'
  organizationId: 'org_123', // Optional: pre-select organization
  loginHint: 'user@example.com', // Optional: pre-fill email
  prompt: 'login', // Optional: force re-authentication
});

// Generate sign-in/sign-up URLs (convenience methods)
const signInUrl = await authKit.getSignInUrl({
  returnPathname: '/dashboard',
  redirectUri: 'https://yourdomain.com/auth/callback',
  organizationId: 'org_123', // Optional
});
const signUpUrl = await authKit.getSignUpUrl({
  returnPathname: '/welcome',
  redirectUri: 'https://yourdomain.com/auth/callback',
});

// Get token claims from current session
const claims = await authKit.getTokenClaims(request);
// Or parse specific access token
const specificClaims = await authKit.getTokenClaims(request, accessToken);

// Switch to different organization
const { response: updatedResponse, authResult: newAuth } =
  await authKit.switchToOrganization(request, response, 'org_123');

// Handle OAuth callback
const {
  response: updatedResponse,
  returnPathname,
  authResponse,
} = await authKit.handleCallback(request, response, {
  code: 'oauth_code_from_query',
  state: 'optional_state_from_query',
});

// Sign out (simple session termination)
const clearedResponse = await authKit.signOut(request, response, {
  returnTo: 'https://yourdomain.com',
});

// Terminate session and get logout URL (advanced)
const { response: clearedResponse, logoutUrl } = await authKit.terminateSession(
  session,
  response,
  { returnTo: 'https://yourdomain.com' },
);

// Manually save a session (for custom auth flows)
await authKit.saveSession(response, authResponse);

// Manually refresh session
const refreshedAuth = await authKit.refreshSession(session, organizationId);
```

## For Framework Implementers

If you're building a framework-specific package (like `@workos-inc/authkit-sveltekit`), this library provides everything needed for WorkOS authentication:

### Implementation Steps

1. **Install and configure** `@workos/authkit-session` as a dependency
2. **Create a SessionStorage adapter** for your framework's request/response objects
3. **Export framework-specific helpers** that wrap the core AuthKit functionality
4. **Handle routing** for sign-in, callback, and sign-out endpoints

### Example Framework Package Structure

```typescript
// src/storage.ts - Framework-specific storage adapter
import { CookieSessionStorage } from '@workos/authkit-session';
import type { ConfigurationProvider } from '@workos/authkit-session';

export class SvelteKitStorage extends CookieSessionStorage<RequestEvent, void> {
  // Implement framework-specific cookie handling
}

// src/index.ts - Main exports
import { configure, createAuthKitFactory } from '@workos/authkit-session';
import { SvelteKitStorage } from './storage';

export { configure };

export const authKit = createAuthKitFactory({
  sessionStorageFactory: config => new SvelteKitStorage(config),
});

// Framework-specific helpers
export async function withAuth(event: RequestEvent) {
  return authKit.withAuth(event);
}

export async function handleCallback(event: RequestEvent) {
  const url = new URL(event.request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code) throw new Error('Missing authorization code');

  const result = await authKit.handleCallback(event, undefined, {
    code,
    state,
  });
  // Handle redirect to returnPathname
}
```

### Key Considerations

- **Request/Response Objects**: Adapt your framework's request/response objects to the `SessionStorage` interface
- **Cookie Handling**: Implement secure cookie setting/getting for your framework
- **Routing Integration**: Provide helpers for authentication routes (`/auth/signin`, `/auth/callback`, `/auth/signout`)
- **TypeScript Support**: Export proper types for your framework's patterns
- **Error Handling**: Wrap AuthKit errors in framework-appropriate error types

### Configuration Validation

Framework adapters should validate configuration on startup to provide clear error messages:

```typescript
import { validateConfig } from '@workos/authkit-session';

// In your framework's initialization or middleware
try {
  validateConfig();
} catch (error) {
  // Framework will display helpful error message with all missing/invalid config
  throw error;
}
```

The `validateConfig()` function performs batch validation, collecting all configuration errors before throwing. This provides developers with a complete picture of what needs to be fixed, rather than discovering issues one at a time.

### Accessing Configuration

Framework adapters can access configuration values directly:

```typescript
import { getConfig, getConfigurationProvider } from '@workos/authkit-session';

// Get a single config value
const clientId = getConfig('clientId');

// Get the ConfigurationProvider for more advanced use
const provider = getConfigurationProvider();
const config = provider.getConfig(); // Returns full AuthKitConfig object
```

## Core Concepts

### Session Management

AuthKit SSR uses encrypted cookies to store session information. It handles:

- Token encryption/decryption (using iron-webcrypto)
- JWT validation and parsing
- Session refresh logic
- Session termination

### Adapter System

AuthKit uses an adapter pattern to abstract framework-specific request/response handling. This allows the core authentication logic to remain framework-agnostic while enabling support for any server-side framework.

#### SessionStorage Interface

```typescript
interface SessionStorage<TRequest, TResponse, TOptions = unknown> {
  getSession(request: TRequest): Promise<string | null>;
  saveSession(
    response: TResponse,
    sessionData: string,
    options?: TOptions,
  ): Promise<TResponse>;
  clearSession(response: TResponse, options?: TOptions): Promise<TResponse>;
}
```

#### CookieSessionStorage Base Class

For cookie-based session storage, extend the provided `CookieSessionStorage` class:

```typescript
import { CookieSessionStorage } from '@workos/authkit-session';

abstract class CookieSessionStorage<TRequest, TResponse> {
  protected cookieName: string; // From config: cookieName
  protected cookieOptions: CookieOptions; // Derived from config

  // Implement these methods for your framework
  abstract getSession(request: TRequest): Promise<string | null>;
  abstract saveSession(
    response: TResponse,
    sessionData: string,
  ): Promise<TResponse>;
  abstract clearSession(response: TResponse): Promise<TResponse>;
}

interface CookieOptions {
  path?: string; // Default: '/'
  domain?: string; // From config: cookieDomain
  maxAge?: number; // From config: cookieMaxAge (400 days)
  httpOnly?: boolean; // Default: true
  secure?: boolean; // From config: apiHttps
  sameSite?: 'lax' | 'strict' | 'none'; // From config: cookieSameSite
}
```

#### Framework-Specific Examples

**Express/Node.js:**

```typescript
class ExpressStorage extends CookieSessionStorage<Request, Response> {
  async getSession(request: Request): Promise<string | null> {
    return request.cookies[this.cookieName] || null;
  }

  async saveSession(
    response: Response,
    sessionData: string,
  ): Promise<Response> {
    response.cookie(this.cookieName, sessionData, this.cookieOptions);
    return response;
  }

  async clearSession(response: Response): Promise<Response> {
    response.clearCookie(this.cookieName, { path: this.cookieOptions.path });
    return response;
  }
}
```

**Hono:**

```typescript
class HonoStorage extends CookieSessionStorage<HonoRequest, HonoResponse> {
  async getSession(request: HonoRequest): Promise<string | null> {
    return getCookie(request, this.cookieName) || null;
  }

  async saveSession(
    response: HonoResponse,
    sessionData: string,
  ): Promise<HonoResponse> {
    setCookie(response, this.cookieName, sessionData, this.cookieOptions);
    return response;
  }

  async clearSession(response: HonoResponse): Promise<HonoResponse> {
    deleteCookie(response, this.cookieName);
    return response;
  }
}
```

#### Creating Framework Adapters

When creating an adapter for a new framework:

1. **Choose your approach**: Extend `CookieSessionStorage` for cookie-based storage, or implement `SessionStorage` directly for custom storage
2. **Handle framework request/response objects**: Extract cookies from requests and set cookies on responses
3. **Respect configuration**: Use `this.cookieName` and `this.cookieOptions` from the base class
4. **Test thoroughly**: Ensure session persistence works across requests

#### Factory Configuration

```typescript
const authKit = createAuthKitFactory<MyRequest, MyResponse>({
  sessionStorageFactory: config => new MyFrameworkStorage(config),

  // Optional: Custom session encryption
  sessionEncryptionFactory: config => myCustomEncryption,

  // Optional: Custom WorkOS client
  clientFactory: config => myCustomWorkOSClient,
});
```

## Configuration

AuthKit can be configured in multiple ways:

### Environment Variables

```bash
WORKOS_CLIENT_ID=your-client-id
WORKOS_API_KEY=your-api-key
WORKOS_REDIRECT_URI=https://yourdomain.com/auth/callback
WORKOS_COOKIE_PASSWORD=must-be-at-least-32-characters-long
WORKOS_COOKIE_NAME=wos-session
WORKOS_COOKIE_MAX_AGE=34560000
WORKOS_API_HOSTNAME=api.workos.com
WORKOS_API_HTTPS=true
WORKOS_API_PORT=443
```

**Environment Variable Naming Convention:**
Environment variables follow the pattern: `WORKOS_{PROPERTY_NAME}` where the property name is converted from camelCase to UPPER_SNAKE_CASE.

Examples:

- `clientId` → `WORKOS_CLIENT_ID`
- `redirectUri` → `WORKOS_REDIRECT_URI`
- `cookiePassword` → `WORKOS_COOKIE_PASSWORD`
- `cookieMaxAge` → `WORKOS_COOKIE_MAX_AGE`

Environment variables always take precedence over programmatic configuration.

### Programmatic Configuration

```typescript
import { configure } from '@workos/authkit-session';

configure({
  clientId: 'your-client-id',
  apiKey: 'your-api-key',
  redirectUri: 'https://yourdomain.com/auth/callback',
  cookiePassword: 'must-be-at-least-32-characters-long',
  cookieName: 'wos-session', // Default: 'wos-session'
  cookieMaxAge: 60 * 60 * 24 * 400, // 400 days in seconds
  cookieSameSite: 'lax', // 'strict', 'lax', or 'none'
  cookieDomain: '.yourdomain.com', // Optional: cookie domain
  apiHostname: 'api.workos.com', // Optional: API hostname
  apiHttps: true, // Default: true
  apiPort: 443, // Optional: API port
});
```

## API Reference

### Core API

- `configure(config)`: Set up AuthKit with your WorkOS configuration
- `validateConfig()`: Validate all required configuration values are present and valid (throws descriptive error if not)
- `getConfig(key)`: Get a specific configuration value
- `getConfigurationProvider()`: Get the ConfigurationProvider instance for advanced configuration access
- `createAuthKitFactory(options)`: Create an instance of AuthKit for your framework

### AuthKit Instance API

#### Authentication & Session Management

- `withAuth<TCustomClaims>(request, options?)`: Validate the current session and return `AuthResult<TCustomClaims>`
  - Note: `ensureSignedIn` option not yet implemented - framework adapters should handle redirects
- `handleCallback(request, response, { code, state? })`: Process OAuth callback and create session
- `signOut(request, response, options?)`: Simple session termination with cookie clearing
- `terminateSession(session, response, options?)`: Advanced session termination with logout URL
- `saveSession(response, authResponse)`: Manually save session from `AuthenticationResponse`
- `refreshSession(session, organizationId?)`: Manually refresh session tokens

#### URL Generation

- `getAuthorizationUrl(options)`: Generate a WorkOS authorization URL
  - Options: `returnPathname`, `redirectUri`, `screenHint` ('sign-in' | 'sign-up'), `organizationId`, `loginHint`, `prompt` ('login' | 'none' | 'consent' | 'select_account')
- `getSignInUrl(options)`: Generate a sign-in URL (convenience method with screenHint='sign-in')
  - Options: `returnPathname`, `redirectUri`, `organizationId`, `loginHint`, `prompt`
- `getSignUpUrl(options)`: Generate a sign-up URL (convenience method with screenHint='sign-up')
  - Options: `returnPathname`, `redirectUri`, `organizationId`, `loginHint`, `prompt`

#### Token & Organization Management

- `getTokenClaims<TCustomClaims>(request, accessToken?)`: Parse JWT token claims from session or specific token
- `switchToOrganization(request, response, organizationId)`: Switch user to different organization context

## Advanced Features

### Organization Switching

Switch users between organizations without requiring re-authentication:

```typescript
try {
  const { response: updatedResponse, authResult } =
    await authKit.switchToOrganization(
      request,
      response,
      'org_new_organization_id',
    );

  // Use the updated response and new auth context
  const { user, sessionId, claims } = authResult;
} catch (error) {
  if (error.authUrl) {
    // Handle cases requiring re-authentication (SSO, MFA)
    redirect(error.authUrl);
  }
}
```

### Token Claims Parsing

Extract and validate JWT claims from access tokens:

```typescript
// Parse claims from current session
const claims = await authKit.getTokenClaims<MyCustomClaims>(request);

// Parse claims from specific token
const specificClaims = await authKit.getTokenClaims<MyCustomClaims>(
  request,
  accessToken,
);

// Custom claims interface
interface MyCustomClaims {
  custom_field: string;
  user_metadata: Record<string, unknown>;
}
```

### TypeScript Support

AuthKit provides full TypeScript support with generic type parameters:

```typescript
interface CustomClaims {
  department: string;
  permissions: string[];
}

const { user, claims } = await authKit.withAuth<CustomClaims>(request);
// claims is typed as BaseTokenClaims & CustomClaims
```

### AuthResult Interface

The `withAuth` method returns an `AuthResult` object with the following structure:

```typescript
interface AuthResult<TCustomClaims = Record<string, unknown>> {
  user?: User | null; // WorkOS user object
  claims?: BaseTokenClaims & TCustomClaims; // JWT token claims
  impersonator?: Impersonator; // Impersonation context if any
  accessToken?: string; // JWT access token
  refreshToken?: string; // Refresh token
  sessionId?: string; // Session identifier from claims
}

interface BaseTokenClaims {
  sid: string; // Session ID
  org_id?: string; // Organization ID
  role?: string; // User role
  permissions?: string[]; // User permissions
  entitlements?: string[]; // User entitlements
  feature_flags?: string[]; // Feature flags
}
```

### Additional Exports

The library also exports these components for advanced use cases:

```typescript
import {
  // Core configuration
  configure, // Set up configuration
  validateConfig, // Validate all required config values
  getConfig, // Get specific config value
  getConfigurationProvider, // Get ConfigurationProvider instance
  ConfigurationProvider, // ConfigurationProvider class

  // Session management
  SessionManager, // Core session management class
  CookieSessionStorage, // Abstract cookie storage base class

  // WorkOS client
  getWorkOS, // WorkOS client factory

  // Types
  type SessionStorage,
  type AuthKitConfig,
  type AuthResult,
  type Session,
  type User,
  type Impersonator,
  // ... and more
} from '@workos/authkit-session';
```

## Security

AuthKit uses iron-webcrypto for secure, encrypted cookies with the following security features:

- Encrypted cookies (AES-256-CBC)
- HMAC validation (SHA-256)
- Customizable cookie settings (HttpOnly, SameSite, etc.)
- Token refresh mechanism

## License

MIT
