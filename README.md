# @workos/authkit-session

> [!WARNING]
> This is prerelease software. APIs may change without notice.

**A toolkit library for building WorkOS AuthKit integrations.**

This library extracts the complex business logic (JWT verification, session encryption, token refresh orchestration) that WorkOS SDK authors need when building framework-specific authentication packages like `@workos-inc/authkit-nextjs`, `@workos-inc/authkit-tanstack-start`, and `@workos-inc/authkit-sveltekit`.

## Philosophy

**We provide the hard stuff:**
- Token verification with JWKS and caching
- Session encryption/decryption (iron-webcrypto)
- Token refresh orchestration (when to refresh, how to preserve org context)
- WorkOS API integration helpers (signOut, refreshSession, authorization URLs)
- Cookie building with secure defaults
- Configuration management (environment variables, validation)

**You own the integration:**
- Implement `updateSession/withAuth` patterns that fit your framework
- Handle request context (headers, locals, WeakMap) your way
- Add framework-specific features (callbacks, debug logging, eager auth)
- Control middleware and route handler patterns

**Result:** Share 80% of the complexity, keep 100% control over framework integration.

## Features

- **Business Logic Extraction**: JWT, crypto, and refresh logic in one place
- **Framework-Agnostic Primitives**: Works in any JavaScript environment (Node.js, edge, Deno)
- **Toolkit, Not Framework**: Use what you need, implement patterns your way
- **Type-Safe**: Full TypeScript support with custom claims and generics
- **Production-Ready**: 80%+ test coverage, comprehensive error handling
- **Zero Framework Opinions**: No prescribed middleware/route patterns

## Architecture

This library provides a **three-layer toolkit** for building authentication:

### Layer 1: Core Business Logic (`AuthKitCore`)

Pure functions for the hard stuff - no framework dependencies:

- **Token Operations**
  - `verifyToken()` - JWT verification against JWKS (with caching)
  - `isTokenExpiring()` - Check if token needs refresh soon
  - `parseTokenClaims()` - Extract and decode JWT claims

- **Session Encryption**
  - `encryptSession()` - AES-256-CBC encryption for cookies
  - `decryptSession()` - Decrypt and validate session data

- **Refresh Orchestration**
  - `refreshTokens()` - Call WorkOS API to refresh tokens
  - `validateAndRefresh()` - **Core orchestration**: validate token → refresh if expiring

```typescript
import { AuthKitCore } from '@workos/authkit-session';

const core = new AuthKitCore(config, client, encryption);

// Validate and potentially refresh in one call
const { valid, refreshed, session, claims } =
  await core.validateAndRefresh(session);
```

### Layer 2: WorkOS Operations (`AuthOperations`)

High-level operations combining core logic with WorkOS API calls:

- **Sign Out**: `signOut()` - Generate logout URL + cookie clear header
- **Refresh Session**: `refreshSession()` - Refresh tokens with org context preservation
- **Switch Organization**: `switchOrganization()` - Refresh with new org ID
- **URL Generation**: `getAuthorizationUrl()`, `getSignInUrl()`, `getSignUpUrl()`

```typescript
import { AuthOperations } from '@workos/authkit-session';

const operations = new AuthOperations(core, client, config);

// Sign out returns everything you need
const { logoutUrl, clearCookieHeader } =
  await operations.signOut(sessionId, { returnTo: '/' });
```

### Layer 3: Helpers

- **`CookieSessionStorage`** - Base class with secure cookie defaults
- **`ConfigurationProvider`** - Environment variable mapping and validation

### Orchestration (Your Choice)

- **`AuthService`** - One orchestration pattern (used by `@workos/authkit-tanstack-start`)
- **Build your own** - Use Core + Operations directly with custom orchestration

**Key Design Decision:** We don't force context methods (`getSessionFromContext`) into interfaces. Each framework handles request context differently:
- Next.js: Mutable headers (`request.headers.set()`)
- TanStack Start: WeakMap (immutable requests)
- SvelteKit: `event.locals`
- Remix: Context objects

Let frameworks implement context passing idiomatically.

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

### 1. Configure AuthKit

Set up your WorkOS credentials using environment variables (recommended):

```bash
WORKOS_CLIENT_ID=your-client-id
WORKOS_API_KEY=your-api-key
WORKOS_REDIRECT_URI=https://yourdomain.com/auth/callback
WORKOS_COOKIE_PASSWORD=must-be-at-least-32-characters-long-secret
```

Or configure programmatically:

```typescript
import { configure } from '@workos/authkit-session';

configure({
  clientId: 'your-client-id',
  apiKey: 'your-api-key',
  redirectUri: 'https://yourdomain.com/auth/callback',
  cookiePassword: 'must-be-at-least-32-characters-long-secret',
});
```

### 2. Create a Storage Adapter

Extend `CookieSessionStorage` for your framework's request/response objects:

```typescript
import { CookieSessionStorage, getConfigurationProvider } from '@workos/authkit-session';

// Web-standard Request/Response example
class MyFrameworkStorage extends CookieSessionStorage<Request, Response> {
  async getSession(request: Request): Promise<string | null> {
    const cookieHeader = request.headers.get('cookie');
    if (!cookieHeader) return null;

    // Parse cookies
    const cookies = Object.fromEntries(
      cookieHeader.split(';').map((cookie) => {
        const [key, ...valueParts] = cookie.trim().split('=');
        return [key, valueParts.join('=')];
      }),
    );

    const value = cookies[this.cookieName];
    return value ? decodeURIComponent(value) : null;
  }

  protected async applyHeaders(
    response: Response | undefined,
    headers: Record<string, string>,
  ): Promise<{ response: Response }> {
    // Create or clone response to apply headers
    const newResponse = response
      ? new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: new Headers(response.headers),
        })
      : new Response();

    // Apply headers
    Object.entries(headers).forEach(([key, value]) => {
      newResponse.headers.append(key, value);
    });

    return { response: newResponse };
  }
}
```

**Note:** `CookieSessionStorage` provides:
- `this.cookieName` - Cookie name from config
- `this.cookieOptions` - Secure defaults (HttpOnly, Secure, SameSite)
- `buildSetCookie(value, expired?)` - Helper for Set-Cookie header strings
- `saveSession()` / `clearSession()` - Implemented using `applyHeaders()` + `buildSetCookie()`

You only need to implement:
- `getSession(request)` - Extract encrypted session from cookies
- `applyHeaders(response, headers)` - Apply headers to framework's response (optional, defaults to returning headers)

### 3. Create AuthService Instance

```typescript
import { createAuthService } from '@workos/authkit-session';

const authService = createAuthService({
  sessionStorageFactory: (config) => new MyFrameworkStorage(config),
});
```

### 4. Use in Your Application

**Check authentication:**

```typescript
const { auth, refreshedSessionData } = await authService.withAuth(request);

if (!auth.user) {
  // User not authenticated - redirect to sign in
  return redirect('/sign-in');
}

// TypeScript knows: auth.user exists, so sessionId, accessToken, etc. exist too
console.log(auth.sessionId);     // string (no ! needed)
console.log(auth.accessToken);   // string
console.log(auth.claims.org_id); // string | undefined
```

**Apply refreshed session (if token was refreshed):**

```typescript
if (refreshedSessionData) {
  const { headers } = await authService.saveSession(undefined, refreshedSessionData);
  // Apply headers['Set-Cookie'] to your framework's response
  response.headers.set('Set-Cookie', headers['Set-Cookie']);
}
```

**Generate authentication URLs:**

```typescript
// Get sign-in URL
const signInUrl = await authService.getSignInUrl({
  returnPathname: '/dashboard',
});

// Get sign-up URL
const signUpUrl = await authService.getSignUpUrl({
  returnPathname: '/welcome',
});

// Get authorization URL (advanced)
const authUrl = await authService.getAuthorizationUrl({
  returnPathname: '/dashboard',
  screenHint: 'sign-in', // or 'sign-up'
  organizationId: 'org_123', // Optional: pre-select organization
  loginHint: 'user@example.com', // Optional: pre-fill email
});
```

**Handle OAuth callback:**

```typescript
const code = url.searchParams.get('code');
const state = url.searchParams.get('state');

const result = await authService.handleCallback(
  request,
  response,
  { code, state },
);

// result.returnPathname - Where to redirect after auth
// result.authResponse - Full auth response with user, tokens, etc.
// result.headers - Set-Cookie header to apply
```

**Sign out:**

```typescript
const { logoutUrl, clearCookieHeader } = await authService.signOut(
  auth.sessionId,
  { returnTo: '/' },
);

// Redirect to WorkOS logout URL with cookie clear header
return redirect(logoutUrl, {
  headers: { 'Set-Cookie': clearCookieHeader },
});
```

**Switch organization:**

```typescript
const session = await authService.getSession(request);
const result = await authService.switchOrganization(session, 'org_123');

// result.auth - New auth with org-specific claims
// result.encryptedSession - New session to save
```

## For Framework Implementers

If you're building a framework-specific package (like `@workos/authkit-tanstack-start`), this library provides all the business logic you need. You just add framework-specific glue.

### Option 1: Use AuthService

One orchestration approach is `createAuthService()` with a storage adapter (used by `@workos/authkit-tanstack-start`):

```typescript
// src/storage.ts - Your framework's storage adapter
import { CookieSessionStorage } from '@workos/authkit-session';

export class MyFrameworkStorage extends CookieSessionStorage<Request, Response> {
  async getSession(request: Request): Promise<string | null> {
    // Extract cookie from request
    const cookieHeader = request.headers.get('cookie');
    if (!cookieHeader) return null;

    const cookies = this.parseCookies(cookieHeader);
    return cookies[this.cookieName] ? decodeURIComponent(cookies[this.cookieName]) : null;
  }

  protected async applyHeaders(
    response: Response | undefined,
    headers: Record<string, string>,
  ): Promise<{ response: Response }> {
    // Clone response and apply headers (Response objects are immutable)
    const newResponse = response
      ? new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: new Headers(response.headers),
        })
      : new Response();

    Object.entries(headers).forEach(([key, value]) => {
      newResponse.headers.append(key, value);
    });

    return { response: newResponse };
  }

  private parseCookies(header: string): Record<string, string> {
    return Object.fromEntries(
      header.split(';').map((c) => {
        const [key, ...parts] = c.trim().split('=');
        return [key, parts.join('=')];
      }),
    );
  }
}

// src/index.ts - Create auth instance
import { createAuthService, getConfigurationProvider } from '@workos/authkit-session';
import { MyFrameworkStorage } from './storage.js';

const authService = createAuthService({
  sessionStorageFactory: (config) => new MyFrameworkStorage(getConfigurationProvider()),
});

// Export framework-specific wrappers
export async function withAuth(request: Request) {
  return authService.withAuth(request);
}

export async function getSignInUrl(returnPathname?: string) {
  return authService.getSignInUrl({ returnPathname });
}

export async function signOut(sessionId: string, returnTo?: string) {
  return authService.signOut(sessionId, { returnTo });
}
```

### Middleware Pattern (Critical for Token Refresh)

Your middleware should:
1. Validate current session (auto-refreshes if expiring)
2. Store auth in framework context for downstream handlers
3. Apply `Set-Cookie` header if session was refreshed

```typescript
// Example: TanStack Start-style middleware
export const authMiddleware = () => {
  return createMiddleware().server(async (args) => {
    // Validate and potentially refresh session
    const { auth, refreshedSessionData } = await authService.withAuth(args.request);

    // Pass auth to downstream via framework context
    const result = await args.next({
      context: { auth: () => auth },
    });

    // CRITICAL: Apply Set-Cookie if session was refreshed
    if (refreshedSessionData) {
      const { headers } = await authService.saveSession(undefined, refreshedSessionData);

      if (headers?.['Set-Cookie']) {
        // Clone immutable Response and add Set-Cookie header
        const newResponse = new Response(result.response.body, {
          status: result.response.status,
          statusText: result.response.statusText,
          headers: result.response.headers,
        });
        newResponse.headers.set('Set-Cookie', headers['Set-Cookie']);

        return { ...result, response: newResponse };
      }
    }

    return result;
  });
};
```

**Why this matters:** If you don't apply the `Set-Cookie` header, refreshed tokens stay in memory but never persist to the cookie. This causes infinite refresh loops because the next request has the old (expired) token.

### Option 2: Use Core + Operations Directly

Build your own orchestration using the toolkit primitives:

```typescript
import { AuthKitCore, AuthOperations, getWorkOS, getConfigurationProvider } from '@workos/authkit-session';

const config = getConfigurationProvider();
const client = getWorkOS(config.getConfig());
const core = new AuthKitCore(config, client, encryption);
const operations = new AuthOperations(core, client, config);

// In your middleware
async function middleware(request: Request) {
  const encrypted = await storage.getSession(request);
  if (!encrypted) {
    return { auth: { user: null } };
  }

  const session = await core.decryptSession(encrypted);
  const { valid, refreshed, session: validated, claims } =
    await core.validateAndRefresh(session);

  if (!valid) {
    return { auth: { user: null } };
  }

  // Handle refresh using your framework's patterns
  if (refreshed) {
    const encryptedSession = await core.encryptSession(validated);
    // Apply Set-Cookie using headers, locals, WeakMap, etc.
  }

  return {
    auth: {
      user: validated.user,
      sessionId: claims.sid,
      accessToken: validated.accessToken,
      refreshToken: validated.refreshToken,
      claims,
      impersonator: validated.impersonator,
    },
  };
}
```

### Key Considerations

- **Request Context**: Each framework handles context differently (headers, locals, WeakMap). Use your framework's idiomatic approach.
- **Response Immutability**: Web-standard Response objects are immutable. Clone before modifying headers.
- **Cookie Parsing**: Implement robust cookie parsing (handle edge cases like values with `=` signs).
- **Set-Cookie Application**: Ensure refreshed sessions actually write to the HTTP response, not just memory.
- **TypeScript**: Export proper types (`AuthResult`, `User`, etc.) for your framework's patterns.
- **Configuration Validation**: Call `validateConfig()` early (first request) with helpful error messages.

### Reference Implementation

See `@workos/authkit-tanstack-start` for a complete example:
- Storage adapter with `applyHeaders()` override
- Middleware with proper Set-Cookie handling
- Server functions delegating to AuthOperations
- Dynamic imports orchestrator (if your bundler needs it)

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

When creating a storage adapter:

1. **Extend `CookieSessionStorage`** for cookie-based storage (recommended)
2. **Implement `getSession()`** to extract encrypted session from cookies
3. **Optionally override `applyHeaders()`** to apply headers in framework-specific ways
4. **Use provided helpers**: `this.cookieName`, `this.cookieOptions`, `buildSetCookie()`
5. **Test thoroughly**: Ensure session persistence works across requests, especially after refresh

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

### Toolkit API (Recommended)

#### Core Configuration

- `configure(config)`: Set up AuthKit with your WorkOS configuration
- `validateConfig()`: Validate all required configuration values (throws descriptive error if invalid)
- `getConfig(key)`: Get a specific configuration value
- `getConfigurationProvider()`: Get the ConfigurationProvider instance

#### Toolkit Classes

**Core primitives:**
- **`AuthKitCore`** - Pure business logic (JWT, crypto, refresh orchestration)
- **`AuthOperations`** - WorkOS API operations (signOut, refreshSession, authorization URLs)
- **`CookieSessionStorage`** - Base class for cookie-based session storage

**Orchestration (optional):**
- **`AuthService`** - One orchestration pattern (used by `@workos/authkit-tanstack-start`)
- **`createAuthService(options)`** - Factory for creating AuthService instances

See the [Architecture](#architecture) section for detailed usage.

### AuthService Instance API

When using `createAuthService()`, you get these methods:

#### Authentication & Session Management

- **`withAuth<TCustomClaims>(request)`** - Validate session and auto-refresh if expiring
  - Returns: `{ auth: AuthResult<TCustomClaims>; refreshedSessionData?: string }`
  - `auth` is a discriminated union (see [AuthResult Type](#authresult-type-discriminated-union))
  - `refreshedSessionData` is present if token was refreshed (must be persisted via `saveSession()`)

- **`handleCallback(request, response, { code, state? })`** - Process OAuth callback
  - Returns: `{ response, headers, returnPathname, authResponse }`

- **`getSession(request)`** - Get decrypted session from request
  - Returns: `Session | null`

- **`saveSession(response, sessionData)`** - Save encrypted session to storage
  - Returns: `{ response?: TResponse; headers?: HeadersBag }`

- **`clearSession(response)`** - Clear session from storage
  - Returns: `{ response?: TResponse; headers?: HeadersBag }`

#### WorkOS Operations (Delegated to AuthOperations)

- **`signOut(sessionId, options?)`** - Generate logout URL + cookie clear header
  - Returns: `{ logoutUrl: string; clearCookieHeader: string }`

- **`refreshSession(session, organizationId?)`** - Manually refresh session tokens
  - Returns: `{ auth: AuthResult; encryptedSession: string }`

- **`switchOrganization(session, organizationId)`** - Switch to different organization
  - Returns: `{ auth: AuthResult; encryptedSession: string }`

#### URL Generation (Delegated to AuthOperations)

- **`getAuthorizationUrl(options)`** - Generate WorkOS authorization URL
  - Options: `returnPathname`, `redirectUri`, `screenHint`, `organizationId`, `loginHint`, `prompt`

- **`getSignInUrl(options)`** - Generate sign-in URL (screenHint='sign-in')
  - Options: `returnPathname`, `redirectUri`, `organizationId`, `loginHint`, `prompt`

- **`getSignUpUrl(options)`** - Generate sign-up URL (screenHint='sign-up')
  - Options: `returnPathname`, `redirectUri`, `organizationId`, `loginHint`, `prompt`

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

### AuthResult Type (Discriminated Union)

The `withAuth` method returns `{ auth: AuthResult; refreshedSessionData?: string }` where `AuthResult` is a **discriminated union** that TypeScript can narrow based on the `user` property:

```typescript
type AuthResult<TCustomClaims = Record<string, unknown>> =
  | {
      user: null; // Not authenticated
    }
  | {
      user: User;                               // Authenticated user
      sessionId: string;                         // Session ID from JWT claims
      accessToken: string;                       // JWT access token
      refreshToken: string;                      // Refresh token
      claims: BaseTokenClaims & TCustomClaims;  // Full JWT claims
      impersonator?: Impersonator;              // Present if impersonating
    };

interface BaseTokenClaims {
  sid: string;              // Session ID
  org_id?: string;          // Organization ID
  role?: string;            // User role
  roles?: string[];         // User roles (array)
  permissions?: string[];   // User permissions
  entitlements?: string[];  // User entitlements
  feature_flags?: string[]; // Feature flags
}
```

**Why a discriminated union?**

This pattern makes **impossible states unrepresentable**. You can't have a user without a sessionId, or a sessionId without a user. TypeScript enforces this at compile time.

**Type narrowing in action:**

```typescript
const { auth } = await authService.withAuth(request);

if (!auth.user) {
  // TypeScript knows: auth is { user: null }
  // No other properties exist in this branch
  return redirect('/login');
}

// TypeScript knows: auth.user exists, so ALL required properties exist
console.log(auth.sessionId);     // ✅ string (no ! needed)
console.log(auth.accessToken);   // ✅ string
console.log(auth.refreshToken);  // ✅ string
console.log(auth.claims.sid);    // ✅ string
console.log(auth.claims.org_id); // ✅ string | undefined (optional claim)

// This would be a TypeScript error in the !auth.user branch:
// console.log(auth.sessionId); // ❌ Property 'sessionId' does not exist
```

**Benefits:**
- No more optional chaining (`auth.user?.id`)
- No more null assertions (`auth.sessionId!`)
- Impossible to access properties that don't exist
- Compiler catches bugs before runtime

### Additional Exports

The library also exports these components for advanced use cases:

```typescript
import {
  // Core toolkit
  AuthKitCore,              // Pure business logic (JWT, crypto, refresh)
  AuthOperations,           // WorkOS API operations
  CookieSessionStorage,     // Base class for cookie storage

  // Configuration
  configure,                // Set up configuration
  validateConfig,           // Validate required config values
  getConfig,                // Get specific config value
  getConfigurationProvider, // Get ConfigurationProvider instance
  ConfigurationProvider,    // ConfigurationProvider class

  // WorkOS client
  getWorkOS,                // WorkOS client factory

  // Types
  type SessionStorage,
  type AuthKitConfig,
  type AuthResult,
  type Session,
  type User,
  type Impersonator,
  type BaseTokenClaims,
  type GetAuthorizationUrlOptions,
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
