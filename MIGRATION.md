# Migration Guide

## 0.5.0 — per-flow PKCE cookies

PKCE verifier cookies now carry a per-flow suffix
(`wos-auth-verifier-<fnv1a>`) so concurrent sign-ins from multiple
tabs no longer clobber each other. `clearPendingVerifier` now
**requires** `options.state`.

### What consumers need to change

| Before                                                 | After                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| `auth.clearPendingVerifier(response)`                  | `auth.clearPendingVerifier(response, { state })`              |
| `auth.clearPendingVerifier(response, { redirectUri })` | `auth.clearPendingVerifier(response, { state, redirectUri })` |

Guard the call on `state` presence:

```ts
if (state) {
  await auth.clearPendingVerifier(response, { state });
}
```

Skip the call entirely when `state` is absent (malformed callback) —
the 10-minute PKCE TTL cleans up orphan cookies.

### Removed exports

- `PKCE_COOKIE_NAME` is gone. The wire cookie is now per-flow (`wos-auth-verifier-<fnv1a>`), so a single static name no longer identifies anything. Use `PKCE_COOKIE_PREFIX` if you need the stable prefix, or `getPKCECookieNameForState(state)` to derive the per-flow name.
- `GetAuthorizationUrlResult` type is gone. The fields are inlined into `CreateAuthorizationResult`, which is what `createAuthorization` / `createSignIn` / `createSignUp` return.

---

## 0.3.x → 0.4.0

0.4.0 introduces OAuth state binding via a PKCE verifier cookie and collapses
verifier-cookie plumbing into `SessionStorage`. The `state` query parameter is
now an opaque sealed blob that is byte-matched against an `HttpOnly`
`wos-auth-verifier` cookie before the authorization code is exchanged.

This is a breaking change for adapter authors and for direct `AuthService`
consumers. Most callers upgrading an existing framework adapter (e.g.
`authkit-tanstack-react-start`, `authkit-sveltekit`) only need to bump the
adapter version.

---

### TL;DR

| Before (0.3.x)                                      | After (0.4.0)                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| `getSignInUrl(options): Promise<string>`            | `createSignIn(response, options)` returns `{ url, response?, headers? }` |
| `handleCallback(req, res, { code, state? })`        | Same signature; `state` is now a sealed blob and **required**            |
| Adapter overrides `getSession(request)`             | Adapter implements `getCookie(request, name)`                            |
| No verifier cookie on the wire                      | New `wos-auth-verifier` cookie, `HttpOnly`, `Max-Age=600`                |
| `handleCallback` emits a single `Set-Cookie` string | Emits `string[]` — session cookie + verifier delete                      |
| `state` = plaintext `{internal}.{userState}`        | `state` = opaque sealed blob (custom `state` still round-trips)          |
| No error-path cleanup helper                        | New: `clearPendingVerifier(response, { state })`                         |

---

### 1. URL builders renamed

`getAuthorizationUrl` / `getSignInUrl` / `getSignUpUrl` are renamed to
`createAuthorization` / `createSignIn` / `createSignUp`. Each now takes a
`response` argument so storage can write the verifier cookie, and returns
`{ url, response?, headers? }` instead of a bare string.

**Before**

```ts
const url = await auth.getSignInUrl({ returnPathname: '/app' });

return new Response(null, {
  status: 302,
  headers: { Location: url },
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

---

### 2. `handleCallback` — same signature, new contract

The public signature (`handleCallback(request, response, { code, state? })`)
is unchanged, but behavior differs in two ways:

**`state` is now required in practice.** The library reads the verifier cookie
via `storage.getCookie` and byte-compares it against `state` before exchanging
the code. If `state` is missing from the URL, `OAuthStateMismatchError` is
thrown. If the cookie is missing, `PKCECookieMissingError` is thrown.

**Success returns a `Set-Cookie` entry as a `string[]`** — one value for
the session cookie, one clearing the verifier. Adapters **must append each
value as its own `Set-Cookie` header** (never `.join(', ')`, never
`headers.set(...)` with an array — a comma-joined `Set-Cookie` is not a
valid single HTTP header, and the browser will reject all but one cookie).

The `headers` bag key is case-insensitive (see Section 8) — `mergeHeaderBags`
preserves the adapter's casing, so check both:

```ts
const result = await auth.handleCallback(request, response, {
  code: url.searchParams.get('code')!,
  state: url.searchParams.get('state') ?? undefined,
});

const setCookie =
  result.headers?.['Set-Cookie'] ?? result.headers?.['set-cookie'];
if (setCookie) {
  for (const v of Array.isArray(setCookie) ? setCookie : [setCookie]) {
    response.headers.append('Set-Cookie', v);
  }
}
```

---

### 3. `SessionStorage` adds `getCookie` / `setCookie` / `clearCookie`

The `SessionStorage` interface now has cookie-level primitives the library
uses to own the verifier cookie lifecycle. If you extend `CookieSessionStorage`:

- **Implement `getCookie(request, name)`.** The base class now provides
  `getSession(request)` as a one-line wrapper over `getCookie(request,
this.cookieName)`.
- **Delete your `getSession` override.**
- **`setCookie` / `clearCookie` are provided by the base class** via
  `applyHeaders`. No action needed.

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

If you wrote a bare `SessionStorage` (no `CookieSessionStorage` base), you
must also implement `setCookie` and `clearCookie`. See `src/core/session/types.ts`.

---

### 4. New: error-path verifier cleanup

On paths where sign-in was initiated but `handleCallback` never runs (OAuth
error responses, missing `code`, early bail-outs), the verifier cookie would
linger until `Max-Age` expires. Call `clearPendingVerifier` with the `state`
from the callback URL to emit a delete for the correct per-flow cookie:

```ts
if (state) {
  const { headers } = await auth.clearPendingVerifier(response, { state });
  // Apply headers the same way you apply any storage output
}
```

For headers-only adapters, pass `undefined` as the response:

```ts
if (state) {
  const { headers } = await auth.clearPendingVerifier(undefined, { state });
}
```

Skip the call entirely when `state` is absent from the callback URL
(malformed callback) — the 10-minute PKCE TTL cleans up orphan cookies.

(On callback success, the verifier is cleared automatically.)

---

### 5. `state` is now opaque

The `state` URL parameter changed from plaintext `{internal}.{userState}` to
an opaque sealed blob. If you decoded `state` yourself (e.g. to read
`returnPathname` outside of `handleCallback`), stop — use the values returned
from `handleCallback`:

```ts
const { returnPathname, state: customState } = await auth.handleCallback(...);
return Response.redirect(new URL(returnPathname, origin));
```

Custom state still round-trips: pass `state: '...'` to `createSignIn` and
receive it unchanged as the returned `state` field from `handleCallback`.

**Supported size for `state`**: 2048 UTF-8 bytes. The value is sealed into
the `wos-auth-verifier` cookie alongside the PKCE verifier, and the
per-cookie browser limit (~4 KB) constrains the total sealed payload.
Values over the supported limit throw `PKCEPayloadTooLargeError` at
sign-in time rather than silently breaking the next callback with a
dropped cookie. Note: `returnPathname`, `redirectUri`, and `cookieDomain`
all share this budget, so a near-limit `state` combined with a long
`returnPathname` can still overflow — the hard failure is on the total
serialized cookie size, not just `state`.

This is a regression from the pre-0.4.0 flow, where `state` lived only in
the URL and could be much larger. Callers carrying more than a couple of
kilobytes of opaque state should move it to server-side storage keyed by
a short ID, and pass only the ID through `state`.

---

### 6. New typed errors

`handleCallback` can throw these in addition to `SessionEncryptionError`:

- `OAuthStateMismatchError` — `state` missing from URL, or doesn't match the
  verifier cookie byte-for-byte.
- `PKCECookieMissingError` — cookie not present on the request. Typically:
  proxy stripped it, `Set-Cookie` didn't propagate, or browser blocked it.

`createAuthorization` / `createSignIn` / `createSignUp` can throw:

- `PKCEPayloadTooLargeError` — `options.state` exceeds 2048 UTF-8 bytes,
  or the total sealed cookie exceeds the per-cookie browser limit.

Both subclass `AuthKitError` and are exported from the package root:

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
    return redirectToSignIn();
  }
  throw err;
}
```

`handleCallback` best-effort clears the verifier cookie on any error after
the cookie is read — state mismatch, tampered seal, exchange failure, or
save failure — so response-mutating adapters don't need to call
`clearPendingVerifier` manually. Headers-only adapters that can't observe
the response mutation should still call `clearPendingVerifier` in the catch
block to capture the delete `Set-Cookie` headers — pass the `state` from
the callback URL so the correct per-flow cookie is cleared, and skip the
call when `state` is absent:

```ts
try {
  await auth.handleCallback(request, response, { code, state });
} catch (err) {
  if (state) {
    await auth.clearPendingVerifier(response, { state });
  }
  throw err;
}
```

---

### 7. Verifier cookie on the wire

A `wos-auth-verifier-<fnv1a>` cookie is set during sign-in and read during
callback. As of 0.5.0 the cookie name carries a per-flow suffix so concurrent
sign-ins from multiple tabs don't clobber each other.

- **Name**: `wos-auth-verifier-<fnv1a>` (per-flow; suffix derived from the sealed blob)
- **HttpOnly**, **Secure** (unless explicitly `SameSite=None` without HTTPS)
- **SameSite**: `Lax` (survives the cross-site return from WorkOS). `None`
  preserved for iframe/embed flows.
- **Max-Age**: `600` (10 minutes)
- **Path**: `/` (cookie is sent on every same-origin request during the
  10-minute window; the DX trade-off is documented in `getPKCECookieOptions`)

**Checklist**

- [ ] Edge/CDN/firewall allowlists pass the cookie through.
- [ ] Cookie-stripping proxies don't strip `wos-auth-verifier-*`.
- [ ] Multiple AuthKit apps on the same host use distinct `cookieDomain`s
      (path-based isolation is not available — the cookie path is always `/`).
- [ ] CSP or cookie-policy banners don't interfere with setting an `HttpOnly`
      functional cookie during OAuth.

---

### 8. Header-bag casing

`HeadersBag` is `Record<string, string | string[]>`. The library merges
`Set-Cookie` entries case-insensitively and preserves the first bag's key
casing — so an adapter that normalizes through `Headers` objects and emits
lowercase `set-cookie` will still get the two-cookie array on callback. If
you read `result.headers?.['Set-Cookie']` in middleware that processes
adapter-produced bags, match whichever casing your adapter emits (the bundled
`CookieSessionStorage` emits capital-S `Set-Cookie`).

---

### Why

The plaintext `state` → `returnPathname` design was a CSRF gap: an attacker
could craft a callback link with a known `code` and any `state`, and the
victim's browser would complete the exchange. Binding `state` to an
`HttpOnly` cookie set on the same browser at sign-in time closes that gap —
the attacker has no way to forge the cookie.

The collapsed API — storage owns all cookies, no PKCE-specific public
exports — matches the precedent set by Arctic, openid-client, and every other
modern auth library. Callers don't see sealed blobs or cookie options; they
see URLs and response mutations.
