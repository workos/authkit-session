# @workos-inc/authkit-ssr

> [!WARNING]
>This is prerelease software. APIs may change without notice.

A framework-agnostic authentication library for WorkOS with a modular adapter system for server-side rendered applications.

## Features

- **Framework-agnostic core**: Common authentication logic that works across platforms
- **Adapter pattern**: Simple interface for framework-specific implementations
- **Session management**: Secure cookie-based authentication
- **JWT handling**: Token validation, parsing, and refresh
- **Type-safe API**: Full TypeScript support

## Installation

```bash
# Using npm
npm install @workos-inc/authkit-ssr

# Using pnpm
pnpm add @workos-inc/authkit-ssr

# Using yarn
yarn add @workos-inc/authkit-ssr
```

## Quick Start

1. Configure AuthKit with your WorkOS credentials:

```typescript
import { configure, createAuthKitFactory } from '@workos-inc/authkit-ssr';

configure({
  clientId: 'your-client-id',
  apiKey: 'your-workos-api-key',
  redirectUri: 'https://yourdomain.com/auth/callback',
  cookiePassword: 'must-be-at-least-32-characters-long-secret',
});
```

2. Create a storage adapter for your framework:

```typescript
import { createAuthKitFactory } from '@workos-inc/authkit-ssr';
import type { SessionStorage } from '@workos-inc/authkit-ssr';

// Create your framework-specific storage adapter
class MyFrameworkStorage implements SessionStorage<MyRequest, MyResponse> {
  cookieName: string;
  
  constructor(cookieName = 'wos-session') {
    this.cookieName = cookieName;
  }

  async getSession(request: MyRequest): Promise<string | null> {
    // Framework-specific implementation to get cookie
    return getCookieFromRequest(request, this.cookieName);
  }

  async saveSession(response: MyResponse, sessionData: string): Promise<MyResponse> {
    // Framework-specific implementation to set cookie
    return setCookieOnResponse(response, this.cookieName, sessionData);
  }

  async clearSession(response: MyResponse): Promise<MyResponse> {
    // Framework-specific implementation to clear cookie
    return clearCookieOnResponse(response, this.cookieName);
  }
}

// Create your AuthKit instance
const authKit = createAuthKitFactory<MyRequest, MyResponse>({
  sessionStorageFactory: (config) => new MyFrameworkStorage(),
});
```

3. Use AuthKit in your application:

```typescript
// Validate a session
const authResult = await authKit.withAuth(request);
const { user, claims, accessToken, refreshToken, sessionId, impersonator } = authResult;

// Generate an authorization URL
const authUrl = await authKit.getAuthorizationUrl({
  returnPathname: '/dashboard',
  redirectUri: 'https://yourdomain.com/auth/callback',
  screenHint: 'sign-in', // or 'sign-up'
});

// Refresh a session
const refreshResult = await authKit.refreshSession(session);
const { user, sessionId, organizationId, role, permissions, entitlements, impersonator, accessToken, claims, sessionData, session: newSession } = refreshResult;
```

## Core Concepts

### Session Management

AuthKit SSR uses encrypted cookies to store session information. It handles:

- Token encryption/decryption (using iron-webcrypto)
- JWT validation and parsing
- Session refresh logic
- Session termination

### Adapter System

The adapter pattern uses a storage interface to abstract framework-specific concepts:

```typescript
interface SessionStorage<TRequest, TResponse, TOptions = unknown> {
  getSession(request: TRequest): Promise<string | null>;
  saveSession(response: TResponse, sessionData: string, options?: TOptions): Promise<TResponse>;
  clearSession(response: TResponse, options?: TOptions): Promise<TResponse>;
}
```

Each framework adapter implements this interface to handle its specific request/response objects.

## Configuration

AuthKit can be configured in multiple ways:

### Environment Variables

```
WORKOS_CLIENT_ID=your-client-id
WORKOS_API_KEY=your-api-key
WORKOS_REDIRECT_URI=https://yourdomain.com/auth/callback
WORKOS_COOKIE_PASSWORD=must-be-at-least-32-characters-long
```

### Programmatic Configuration

```typescript
import { configure } from '@workos-inc/authkit-ssr';

configure({
  clientId: 'your-client-id',
  apiKey: 'your-api-key',
  redirectUri: 'https://yourdomain.com/auth/callback',
  cookiePassword: 'must-be-at-least-32-characters-long',
  cookieName: 'your-custom-cookie-name', // Default: 'wos-session'
  cookieMaxAge: 60 * 60 * 24 * 30, // 30 days in seconds
  cookieSameSite: 'lax', // 'strict', 'lax', or 'none'
});
```

## API Reference

### Core API

- `configure(config)`: Set up AuthKit with your WorkOS configuration
- `getConfig(key)`: Get a specific configuration value
- `createAuthKitFactory(options)`: Create an instance of AuthKit for your framework

### AuthKit Instance API

- `withAuth(request)`: Validate the current session and return `AuthResult` with user, claims, tokens, and session info
- `getAuthorizationUrl(options)`: Generate a WorkOS authorization URL with `returnPathname`, `redirectUri`, and `screenHint`
- `getSignInUrl(options)`: Generate a sign-in URL (calls `getAuthorizationUrl` with `screenHint: 'sign-in'`)
- `getSignUpUrl(options)`: Generate a sign-up URL (calls `getAuthorizationUrl` with `screenHint: 'sign-up'`)
- `refreshSession(session)`: Refresh an existing session and return updated session data
- `saveSession(response, sessionData)`: Save session data to a response
- `getLogoutUrl(session, response, options)`: End a user session and return logout URL with updated response

## Security

AuthKit uses iron-webcrypto for secure, encrypted cookies with the following security features:

- Encrypted cookies (AES-256-CBC)
- HMAC validation (SHA-256)
- Customizable cookie settings (HttpOnly, SameSite, etc.)
- Token refresh mechanism

## License

MIT
