# @workos/authkit-session

> [!WARNING]
> This is prerelease software. APIs may change without notice.

**Toolkit for building WorkOS AuthKit framework integrations.**

Handles JWT verification, session encryption, and token refresh orchestration. You build the framework-specific glue.

## Installation

```bash
pnpm add @workos/authkit-session
```

## What This Library Provides

| Layer         | Class                  | Purpose                                                                                             |
| ------------- | ---------------------- | --------------------------------------------------------------------------------------------------- |
| Core          | `AuthKitCore`          | JWT verification (JWKS with caching), session encryption (AES-256-CBC), token refresh orchestration |
| Operations    | `AuthOperations`       | WorkOS API calls: signOut, refreshSession, authorization URLs                                       |
| Helpers       | `CookieSessionStorage` | Base class with secure cookie defaults                                                              |
| Orchestration | `AuthService`          | Reference implementation combining all layers                                                       |

## Quick Start

### 1. Configure

```bash
WORKOS_CLIENT_ID=your-client-id
WORKOS_API_KEY=your-api-key
WORKOS_REDIRECT_URI=https://yourdomain.com/auth/callback
WORKOS_COOKIE_PASSWORD=must-be-at-least-32-characters-long-secret
```

Or programmatically:

```typescript
import { configure } from '@workos/authkit-session';

configure({
  clientId: 'your-client-id',
  apiKey: 'your-api-key',
  redirectUri: 'https://yourdomain.com/auth/callback',
  cookiePassword: 'must-be-at-least-32-characters-long-secret',
});
```

### 2. Create Storage Adapter

```typescript
import {
  CookieSessionStorage,
  parseCookieHeader,
} from '@workos/authkit-session';

export class MyFrameworkStorage extends CookieSessionStorage<
  Request,
  Response
> {
  async getSession(request: Request): Promise<string | null> {
    const cookieHeader = request.headers.get('cookie');
    if (!cookieHeader) return null;
    return parseCookieHeader(cookieHeader)[this.cookieName] ?? null;
  }

  // Optional: override if your framework can mutate responses
  protected async applyHeaders(
    response: Response | undefined,
    headers: Record<string, string>,
  ): Promise<{ response: Response }> {
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
}
```

`CookieSessionStorage` provides `this.cookieName`, `this.cookieOptions`, `buildSetCookie()`, and implements `saveSession()`/`clearSession()` using your `applyHeaders()`.

### 3. Create Service

```typescript
import { createAuthService } from '@workos/authkit-session';

export const authService = createAuthService({
  sessionStorageFactory: config => new MyFrameworkStorage(config),
});
```

### 4. Implement Middleware

```typescript
export const authMiddleware = () => {
  return createMiddleware().server(async args => {
    const { auth, refreshedSessionData } = await authService.withAuth(
      args.request,
    );

    const result = await args.next({
      context: { auth: () => auth },
    });

    // CRITICAL: Persist refreshed tokens to cookie
    if (refreshedSessionData) {
      const { headers } = await authService.saveSession(
        undefined,
        refreshedSessionData,
      );
      if (headers?.['Set-Cookie']) {
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

**If you skip applying `Set-Cookie`, refreshed tokens never persist.** Next request sees the old expired token → infinite refresh loop.

## AuthResult Type

`withAuth()` returns a discriminated union. If `auth.user` exists, all other properties exist:

```typescript
const { auth } = await authService.withAuth(request);

if (!auth.user) {
  return redirect('/login');
}

// TypeScript knows these exist (no ! needed)
auth.sessionId; // string
auth.accessToken; // string
auth.claims.sid; // string
```

## Configuration Options

| Environment Variable      | Config Key       | Description                          |
| ------------------------- | ---------------- | ------------------------------------ |
| `WORKOS_CLIENT_ID`        | `clientId`       | WorkOS client ID                     |
| `WORKOS_API_KEY`          | `apiKey`         | WorkOS API key                       |
| `WORKOS_REDIRECT_URI`     | `redirectUri`    | OAuth callback URL                   |
| `WORKOS_COOKIE_PASSWORD`  | `cookiePassword` | 32+ char encryption key              |
| `WORKOS_COOKIE_NAME`      | `cookieName`     | Cookie name (default: `wos_session`) |
| `WORKOS_COOKIE_MAX_AGE`   | `cookieMaxAge`   | Cookie lifetime in seconds           |
| `WORKOS_COOKIE_DOMAIN`    | `cookieDomain`   | Cookie domain                        |
| `WORKOS_COOKIE_SAME_SITE` | `cookieSameSite` | `lax`, `strict`, or `none`           |

Environment variables override programmatic config.

## API Overview

### AuthService Methods

```typescript
// Authentication
authService.withAuth(request)                    // → { auth, refreshedSessionData? }
authService.handleCallback(request, response, { code, state })
authService.getSession(request)                  // → Session | null
authService.saveSession(response, sessionData)   // → { response?, headers? }
authService.clearSession(response)

// WorkOS Operations
authService.signOut(sessionId, { returnTo })     // → { logoutUrl, clearCookieHeader }
authService.refreshSession(session, organizationId?)
authService.switchOrganization(session, organizationId)

// URL Generation
authService.getAuthorizationUrl(options)
authService.getSignInUrl(options)
authService.getSignUpUrl(options)
```

### Direct Access (Advanced)

For maximum control, use the primitives directly:

```typescript
import {
  AuthKitCore,
  AuthOperations,
  getWorkOS,
  getConfigurationProvider,
} from '@workos/authkit-session';

const config = getConfigurationProvider();
const client = getWorkOS(config.getConfig());
const core = new AuthKitCore(config, client, encryption);
const operations = new AuthOperations(core, client, config);

// Use core.validateAndRefresh(), core.encryptSession(), etc.
```

## Technical Details

- **JWKS Caching**: Keys fetched on-demand, cached for process lifetime. `jose` handles key rotation automatically.
- **Token Expiry Buffer**: 60 seconds default. Tokens refresh before actual expiry.
- **Session Encryption**: AES-256-CBC + SHA-256 HMAC via `iron-webcrypto`.
- **Lazy Initialization**: `createAuthService()` defers initialization until first use, allowing `configure()` to be called later.

## Reference Implementation

See [`@workos/authkit-tanstack-start`](https://github.com/workos/authkit-tanstack-start) for a complete example.

## License

MIT
