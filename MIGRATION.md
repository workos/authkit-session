# Migration Guide

## 0.3.x → 0.4.0

0.4.0 introduces PKCE + a CSRF-bound verifier cookie, AND collapses the verifier-cookie plumbing into `SessionStorage`. The OAuth `state` parameter is now a sealed blob that is byte-matched against an `HttpOnly` `wos-auth-verifier` cookie before the code is exchanged. Callers no longer need to read, write, or delete this cookie themselves — the storage layer owns it.

This is a breaking change for both adapter authors and direct `AuthService` consumers.

---

### TL;DR

| Before                                                         | After                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `getSignInUrl()` returns `{ url, sealedState, cookieOptions }` | `createSignIn(response, options)` returns `{ url, response?, headers? }` |
| `handleCallback({ code, state, cookieValue })`                 | `handleCallback(request, response, { code, state })`                     |
| `auth.buildPKCEDeleteCookieHeader()`                           | `auth.clearPendingVerifier(response, { redirectUri? })`                  |
| Adapter serializes `Set-Cookie` for PKCE manually              | `storage.setCookie` / `storage.clearCookie` handle it                    |
| `state` param = base64 JSON                                    | `state` param = opaque sealed blob                                       |
| `decodeState(state)` for `returnPathname`                      | Removed — use `handleCallback`'s returned `returnPathname`               |
| No extra cookie on the wire                                    | New `wos-auth-verifier` cookie, `HttpOnly`, `Max-Age=600`                |

---

### 1. `createSignIn` / `createSignUp` / `createAuthorization` (renamed)

The three URL-builder methods are renamed and now write the verifier cookie through storage. They take a `response` argument so storage can mutate it (or emit headers) and return `{ url, response?, headers? }`.

**Before**

```ts
import { serializePKCESetCookie } from '@workos/authkit-session';

const { url, sealedState, cookieOptions } = await auth.getSignInUrl({
  returnPathname: '/app',
});

return new Response(null, {
  status: 302,
  headers: {
    Location: url,
    'Set-Cookie': serializePKCESetCookie(cookieOptions, sealedState),
  },
});
```

**After**

```ts
const { url, headers } = await auth.createSignIn(response, {
  returnPathname: '/app',
});

return new Response(null, {
  status: 302,
  headers: {
    ...headers,
    Location: url,
  },
});
```

Method renames:

| Old                        | New                                  |
| -------------------------- | ------------------------------------ |
| `getAuthorizationUrl(...)` | `createAuthorization(response, ...)` |
| `getSignInUrl(...)`        | `createSignIn(response, ...)`        |
| `getSignUpUrl(...)`        | `createSignUp(response, ...)`        |

If you're building on top of a framework adapter (`authkit-tanstack-react-start`, `authkit-sveltekit`, etc.), upgrade the adapter — it handles this for you.

---

### 2. `handleCallback` (no more `cookieValue`)

`handleCallback` reads the verifier cookie through storage now — you don't pass it in.

**Before**

```ts
const cookieValue = readCookie(request, 'wos-auth-verifier');

const result = await auth.handleCallback(request, response, {
  code: url.searchParams.get('code')!,
  state: url.searchParams.get('state') ?? undefined,
  cookieValue,
});
```

**After**

```ts
const result = await auth.handleCallback(request, response, {
  code: url.searchParams.get('code')!,
  state: url.searchParams.get('state') ?? undefined,
});
```

**Adapter requirement**: your `SessionStorage` implementation must now implement `getCookie(request, name): Promise<string | null>`. The existing session `getSession` override is unnecessary — the base class provides it as a one-line wrapper over `getCookie`.

On success, `handleCallback` returns `headers['Set-Cookie']` as a `string[]` — one entry for the session cookie, one entry clearing the verifier. Adapters **must append each value as its own `Set-Cookie` header** (never `.join(', ')`) — otherwise the browser only sees one of the two cookies.

```ts
if (Array.isArray(result.headers?.['Set-Cookie'])) {
  for (const value of result.headers['Set-Cookie']) {
    response.headers.append('Set-Cookie', value);
  }
}
```

---

### 3. `auth.buildPKCEDeleteCookieHeader` → `auth.clearPendingVerifier`

On error paths where `handleCallback` never runs (OAuth error responses, missing `code`, early bail-outs), clear the verifier through storage:

**Before**

```ts
response.headers.append('Set-Cookie', auth.buildPKCEDeleteCookieHeader());
```

**After**

```ts
const { headers } = await auth.clearPendingVerifier(response);
// Apply headers as usual
```

If the original `createSignIn` call used a per-call `redirectUri` override, pass the same value so the emitted `Path=` matches the cookie's original scope:

```ts
await auth.clearPendingVerifier(response, {
  redirectUri: 'https://app.example.com/custom/callback',
});
```

(If the callback actually succeeds, the verifier is cleared automatically by `handleCallback` — the path is recovered from the sealed state so per-call overrides don't leak an orphan cookie.)

---

### 4. Removed public exports

The following are no longer exported. Most are internal now; the rest are replaced by the `clearPendingVerifier` / `SessionStorage.setCookie` pair.

- `PKCE_COOKIE_NAME` — internal constant.
- `getPKCECookieOptions(config, redirectUri?)` — internal helper.
- `serializePKCESetCookie(options, value, { expired? })` — replaced by `SessionStorage.setCookie` / `clearCookie`.
- `PKCECookieOptions` — folded into `CookieOptions`.
- `AuthService.buildPKCEDeleteCookieHeader` — replaced by `clearPendingVerifier`.
- `AuthService.getPKCECookieOptions` — no public replacement (internal only).

---

### 5. `SessionStorage` adds `getCookie` / `setCookie` / `clearCookie`

If you wrote a custom `SessionStorage` (subclass of `CookieSessionStorage` or bare implementation), you need to add `getCookie`. The `CookieSessionStorage` base class provides concrete `setCookie` / `clearCookie` using `applyHeaders`, so subclasses only need to implement the request-side read.

**Before**

```ts
class MyStorage extends CookieSessionStorage<Request, Response> {
  async getSession(request: Request): Promise<string | null> {
    return parseCookie(request.headers.get('cookie'), 'wos-session');
  }
}
```

**After**

```ts
class MyStorage extends CookieSessionStorage<Request, Response> {
  async getCookie(request: Request, name: string): Promise<string | null> {
    return parseCookie(request.headers.get('cookie'), name);
  }
}
```

`getSession` is now a one-line wrapper in the base class that calls `getCookie(request, this.cookieName)` — delete your override.

---

### 6. `decodeState` is removed

If you called `decodeState` to read `returnPathname` outside of `handleCallback`, stop. The state blob is encrypted.

Use the `returnPathname` returned by `handleCallback`:

```ts
const { returnPathname, state: customState } = await auth.handleCallback(...);
return Response.redirect(new URL(returnPathname, origin));
```

If you were passing your own data through `state`, keep using the `state` option on `createSignIn({ state: '...' })` — it round-trips through `handleCallback`'s returned `state` field unchanged.

---

### 7. New typed errors

`handleCallback` can throw these in addition to `SessionEncryptionError`:

- `OAuthStateMismatchError` — state missing from URL, or doesn't match the cookie byte-for-byte.
- `PKCECookieMissingError` — cookie wasn't sent. Typically: proxy stripped it, `Set-Cookie` didn't propagate, or user's browser blocked it.

Both are subclasses of `AuthKitError` and are exported from the root.

```ts
import {
  OAuthStateMismatchError,
  PKCECookieMissingError,
} from '@workos/authkit-session';

try {
  await auth.handleCallback(request, response, { code, state });
} catch (err) {
  if (
    err instanceof OAuthStateMismatchError ||
    err instanceof PKCECookieMissingError
  ) {
    await auth.clearPendingVerifier(response); // reset the flow
    return redirectToSignIn();
  }
  throw err;
}
```

---

### 8. Verifier cookie on the wire

A `wos-auth-verifier` cookie is set during sign-in and read during callback.

- **Name**: `wos-auth-verifier`
- **HttpOnly**, **Secure** (unless explicitly `SameSite=None` without HTTPS)
- **SameSite**: `Lax` (downgraded from `Strict` so it survives the cross-site return from WorkOS). `None` preserved for iframe/embed flows.
- **Max-Age**: `600` (10 minutes)
- **Path**: scoped to the redirect URI's pathname (prevents collisions between multiple AuthKit apps on the same host).

**Checklist**

- [ ] Edge/CDN/firewall allowlists pass the cookie through.
- [ ] Cookie-stripping proxies don't strip `wos-auth-verifier`.
- [ ] Multiple AuthKit apps on the same host have distinct redirect URI paths (or `cookieDomain`s).
- [ ] CSP or cookie-policy banners don't interfere with setting an `HttpOnly` functional cookie during OAuth.

---

### Why

The plaintext `state` → `returnPathname` design was a CSRF gap: an attacker could craft a callback link with a known `code` and any `state`, and the victim's browser would complete the exchange. Binding `state` to an `HttpOnly` cookie set on the same browser at sign-in time closes that gap — the attacker has no way to forge the cookie.

The collapsed API — storage owns all cookies, no PKCE-specific public exports — matches the precedent set by Arctic, openid-client, and every other modern auth library. Callers don't see sealed blobs or cookie options; they see URLs and response mutations.
