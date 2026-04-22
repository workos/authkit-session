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
import { CookieSessionStorage } from '@workos/authkit-session';

export class MyFrameworkStorage extends CookieSessionStorage<
  Request,
  Response
> {
  async getCookie(request: Request, name: string): Promise<string | null> {
    const header = request.headers.get('cookie');
    if (!header) return null;
    for (const part of header.split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k === name) return decodeURIComponent(rest.join('='));
    }
    return null;
  }

  // Optional: override if your framework can mutate responses
  protected async applyHeaders(
    response: Response | undefined,
    headers: Record<string, string | string[]>,
  ): Promise<{ response: Response }> {
    const newResponse = response
      ? new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: new Headers(response.headers),
        })
      : new Response();

    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        for (const v of value) newResponse.headers.append(key, v);
      } else {
        newResponse.headers.append(key, value);
      }
    }

    return { response: newResponse };
  }
}
```

`CookieSessionStorage` provides `this.cookieName`, `this.cookieOptions`, and generic `setCookie`/`clearCookie`/`serializeCookie` primitives. `getSession`/`saveSession`/`clearSession` are one-line wrappers — you only implement `getCookie`.

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
      const setCookie = headers?.['Set-Cookie'];
      if (setCookie) {
        const newResponse = new Response(result.response.body, {
          status: result.response.status,
          statusText: result.response.statusText,
          headers: result.response.headers,
        });
        // Append each entry — never `.set()` with an array (comma-joined
        // Set-Cookie is not a valid single HTTP header).
        for (const v of Array.isArray(setCookie) ? setCookie : [setCookie]) {
          newResponse.headers.append('Set-Cookie', v);
        }
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
| `WORKOS_COOKIE_NAME`      | `cookieName`     | Cookie name (default: `wos-session`) |
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
authService.signOut(sessionId, { returnTo })     // → { logoutUrl, response?, headers? }
authService.refreshSession(session, organizationId?)
authService.switchOrganization(session, organizationId)

// URL Generation — write verifier cookie, return { url, response?, headers? }
authService.createAuthorization(response, options)
authService.createSignIn(response, options)
authService.createSignUp(response, options)

// URL Generation — pure, return { url, cookieName } WITHOUT writing a cookie
authService.getAuthorizationUrl(options)
authService.getSignInUrl(options)
authService.getSignUpUrl(options)

// Error-path cleanup for the PKCE verifier cookie
// `state` is required (from the callback URL) — it identifies which per-flow
// verifier cookie to clear. Skip this call when `state` is absent from the
// callback URL (malformed callback); the 10-minute PKCE TTL handles the orphan.
// (response may be `undefined` for headers-only adapters)
authService.clearPendingVerifier(response, { state, redirectUri? })
```

### Generating URLs without writing a cookie

`getAuthorizationUrl`, `getSignInUrl`, and `getSignUpUrl` return
`{ url, cookieName }` WITHOUT writing the PKCE verifier cookie. Use
these in adapter code paths where the cookie write is wasted — for
example, on non-document requests in a middleware hook. Browsers
don't follow cross-origin redirects from fetch/XHR/RSC/prefetch, so
a cookie write on those requests is noise.

```ts
const { url, cookieName } = await authService.getSignInUrl({
  returnPathname: '/dashboard',
});
// No Set-Cookie emitted. Use createSignIn if you want the cookie written.
```

For regular user-initiated sign-in flows, keep using `createSignIn` /
`createSignUp` / `createAuthorization` — they write the cookie and
return it alongside the URL.

### PKCE verifier cookie (`wos-auth-verifier-<fnv1a>`)

This library binds every OAuth sign-in to a PKCE code verifier, so a leaked
`state` value on its own cannot be used to complete a session hijack.

Each in-flight sign-in gets its own per-flow verifier cookie with a
deterministic suffix derived from the sealed blob, so concurrent
sign-ins from multiple tabs no longer clobber each other.

The verifier is sealed into a single blob that serves two roles:

1. It is sent to WorkOS as the OAuth `state` query parameter.
2. It is set as a short-lived HTTP-only cookie (`wos-auth-verifier-<fnv1a>`, 10 min).

The cookie is written and read through `SessionStorage`. Callers don't see
sealed blobs or cookie options:

```typescript
// Sign in: library writes the verifier cookie via storage, returns the URL + headers
const { url, headers } = await authService.createSignIn(response, {
  returnPathname: '/dashboard',
});
return new Response(null, {
  status: 302,
  headers: { ...headers, Location: url },
});

// Callback: library reads the verifier via storage, byte-compares, then exchanges
await authService.handleCallback(request, response, {
  code,
  state, // from URL
});
```

On success, `handleCallback` returns a `Set-Cookie` entry in `headers` as a
`string[]` with two values — the session cookie AND a clear for the verifier
cookie. Adapters must append each entry as its own `Set-Cookie` HTTP header
(never comma-join). The bag key is case-insensitive — `mergeHeaderBags`
preserves the adapter's casing — so look it up that way:

```ts
const setCookie =
  result.headers?.['Set-Cookie'] ?? result.headers?.['set-cookie'];
if (setCookie) {
  for (const v of Array.isArray(setCookie) ? setCookie : [setCookie]) {
    response.headers.append('Set-Cookie', v);
  }
}
```

Mismatched state and cookie raise `OAuthStateMismatchError`. A missing cookie
(typical cause: Set-Cookie stripped by a proxy) raises
`PKCECookieMissingError`. On either error path — or any early bail-out before
`handleCallback` runs — call
`authService.clearPendingVerifier(response, { state })` with the `state` from
the callback URL to emit a delete header for the correct per-flow cookie:

```ts
if (state) {
  await authService.clearPendingVerifier(response, { state });
}
```

If the callback URL has no `state` (malformed callback), skip this call — the
10-minute PKCE TTL handles the orphan.

### Direct Access (Advanced)

For maximum control, use the primitives directly:

```typescript
import {
  AuthKitCore,
  AuthOperations,
  getConfigurationProvider,
  getWorkOS,
  sessionEncryption,
} from '@workos/authkit-session';

const config = getConfigurationProvider().getConfig();
const client = getWorkOS();
const core = new AuthKitCore(config, client, sessionEncryption);
const operations = new AuthOperations(core, client, config, sessionEncryption);

// Use core.validateAndRefresh(), core.encryptSession(), etc.
```

## Technical Details

- **JWKS Caching**: Keys fetched on-demand, cached for process lifetime. `jose` handles key rotation automatically.
- **Token Refresh**: `validateAndRefresh` refreshes when `verifyToken` fails (i.e. when the access token is expired or invalid). `isTokenExpiring(token, buffer)` is available as a separate helper for callers that want to proactively refresh before expiry.
- **Session Encryption**: AES-256-CBC + SHA-256 HMAC via `iron-webcrypto`.
- **Lazy Initialization**: `createAuthService()` defers initialization until first use, allowing `configure()` to be called later.

## Reference Implementation

See [`@workos/authkit-tanstack-start`](https://github.com/workos/authkit-tanstack-start) for a complete example.

## License

MIT
