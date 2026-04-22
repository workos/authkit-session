# Per-flow PKCE Verifier Cookies

**Date:** 2026-04-22
**Status:** Approved — ready for implementation plan
**Packages:** `authkit-session`, `authkit-sveltekit`, `authkit-tanstack-start`

## Problem

When a user has multiple tabs open against an app and the session expires (or multiple requests fire concurrently at an unauthenticated session), each request that hits the auth-url-minting code path generates a fresh PKCE verifier and writes it to the single shared `wos-auth-verifier` cookie. Last-write-wins: every callback except one fails with `OAuthStateMismatchError` or `PKCECookieMissingError`.

This is the same bug `authkit-nextjs` fixed in PR [#403](https://github.com/workos/authkit-nextjs/pull/403). `authkit-session` and both downstream adapters (`authkit-sveltekit`, `authkit-tanstack-start`) currently share the bug because the cookie name is a module-level constant.

### Evidence in code

- `authkit-session/src/core/pkce/cookieOptions.ts:5` — `PKCE_COOKIE_NAME = 'wos-auth-verifier'` is a single constant.
- `authkit-session/src/service/AuthService.ts:236,324,368` — `createAuthorization` writes, `handleCallback` reads and clears, all against that one name.
- No concurrency isolation exists in the core or either adapter.

## Goals

1. Eliminate cross-flow clobbering by giving each concurrent PKCE flow its own cookie name.
2. Keep the fix additive in `authkit-session`'s public API except for a single deliberate breaking change to `clearPendingVerifier` (called only inside our own adapters).
3. Avoid HTTP 431 cookie bloat in middleware-loop-prone adapter paths.

## Non-goals

- No legacy cookie fallback. `authkit-session` has negligible real users mid-flow; the upgrade window isn't worth protecting.
- No orphan cleanup at `signOut`. `authkit-tanstack-start` hasn't shipped; `authkit-sveltekit` has no real users. The 10-minute PKCE TTL handles orphans.
- No shared document-request helper in the core. Header heuristics are adapter-specific.

## Design

### 1. `authkit-session` (the core library)

#### 1.1 Cookie name derivation

New file: `src/core/pkce/cookieName.ts`.

```ts
export const PKCE_COOKIE_PREFIX = 'wos-auth-verifier';

function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5;
  const bytes = new TextEncoder().encode(input);
  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function getPKCECookieNameForState(state: string): string {
  return `${PKCE_COOKIE_PREFIX}-${fnv1a32Hex(state)}`;
}
```

Inline FNV-1a 32-bit, no new dependency. Hash isn't security-sensitive — it's a namespacing mechanism. Collision probability is ~1/4B per pair; a collision would route one flow's callback to the wrong cookie, which then fails byte-equality against the URL state (fail-closed via existing `verifyCallbackState` logic).

`PKCE_COOKIE_NAME` stays as an alias export for back-compat; internal code uses `PKCE_COOKIE_PREFIX`.

#### 1.2 Return derived cookie name from URL generation

`src/core/pkce/generateAuthorizationUrl.ts`:

- `GeneratedAuthorizationUrl` gains `cookieName: string`, computed via `getPKCECookieNameForState(sealedState)`.
- The cookie byte-length guard uses the actual (longer) derived name — worst case 26 chars vs 17, still well under the 3800-byte cap.

#### 1.3 Public pure URL-generation API

Expose the side-effect-free path that `AuthOperations` already owns. Callers that don't want to write a cookie can bypass `storage.setCookie` entirely.

`AuthService` gains three new methods:

```ts
getAuthorizationUrl(options?): Promise<{ url: string; cookieName: string }>
getSignInUrl(options?):        Promise<{ url: string; cookieName: string }>
getSignUpUrl(options?):        Promise<{ url: string; cookieName: string }>
```

No response argument, no `Set-Cookie`, no `storage` touched. Thin wrappers around `AuthOperations.createAuthorization` / `createSignIn` / `createSignUp`.

Existing `createAuthorization` / `createSignIn` / `createSignUp` continue to write the cookie, using the derived per-flow name internally. `CreateAuthorizationResult` gains `cookieName: string` for callers that want to track the flow (e.g., to pass back to `clearPendingVerifier`).

No `writeCookie?: boolean` flag — rejected in favor of the cleaner URL-only methods.

#### 1.4 `handleCallback`

`AuthService.handleCallback` derives the cookie name from `options.state` (URL state) and uses it for both the cookie read and any subsequent clear. Pre-unseal error path uses the derived name. Post-unseal error path also uses the same derived name (cheaper than deriving from the unsealed blob, and equivalent by construction).

Happy-path sketch:

```ts
async handleCallback(request, response, options: { code, state }) {
  const cookieName = options.state ? getPKCECookieNameForState(options.state) : null;
  const cookieValue = cookieName
    ? await this.storage.getCookie(request, cookieName)
    : null;

  // verifyCallbackState throws OAuthStateMismatchError when state is missing
  // and PKCECookieMissingError when cookieValue is null — existing behavior.
  const unsealed = await this.core.verifyCallbackState({
    stateFromUrl: options.state,
    cookieValue: cookieValue ?? undefined,
  });
  // ... rest unchanged; clearCookie uses `cookieName`
}
```

Adapters require no change to their `handleCallback` call sites.

#### 1.5 `clearPendingVerifier` — breaking signature change

Today:

```ts
clearPendingVerifier(response, options?: { redirectUri? })
```

Becomes:

```ts
clearPendingVerifier(
  response,
  options: { state: string; redirectUri?: string },
)
```

Rationale: a state-less cleanup is meaningless in the per-flow world — we'd have no cookie name to clear. Rather than silently no-op and hide bugs, force callers to pass `state`. The only callers today are in `authkit-sveltekit/src/server/auth.ts` and `authkit-tanstack-start/src/server/server.ts`, both in callback bailout paths where URL `state` is available.

This is the one deliberate breaking change in the core. It's justified because the old signature encoded an invariant that no longer holds.

#### 1.6 Exports

New public exports from `src/index.ts`:

- `getPKCECookieNameForState`
- `PKCE_COOKIE_PREFIX`

Retained for back-compat: `PKCE_COOKIE_NAME` (aliased to the prefix).

Not exported (deliberately): any document-request helper. Header heuristics are adapter-layer concerns.

### 2. `authkit-sveltekit`

#### 2.1 Adapter-local document-request helper

Ship `src/server/adapters/isDocumentRequest.ts`:

```ts
export function isDocumentRequest(headers: Headers): boolean {
  const dest = headers.get('sec-fetch-dest');
  if (dest) return dest === 'document';
  if (headers.get('x-requested-with')?.toLowerCase() === 'xmlhttprequest') return false;
  if (headers.get('purpose')?.toLowerCase() === 'prefetch') return false;
  const accept = headers.get('accept') ?? '';
  if (accept && !accept.includes('text/html') && !accept.includes('*/*')) return false;
  return true;
}
```

Fail-open: when ambiguous, assume document. Worst case is one extra cookie bounded by the 10-minute TTL.

#### 2.2 `createWithAuth` — the loop-prone path

`src/server/middleware.ts`:

```ts
if (!auth?.user) {
  if (isDocumentRequest(event.request.headers)) {
    const { url, response, headers } = await authKitInstance.createSignIn(
      new Response(),
      { returnPathname: event.url.pathname },
    );
    applyCookies(event, response, headers);
    throw redirect(302, url);
  }

  // Non-document request (fetch/XHR/RSC/prefetch): browsers won't follow
  // a cross-origin redirect to WorkOS anyway, so skip the cookie write to
  // avoid bloat. The next real navigation from this client hits this
  // branch with `isDocumentRequest === true`.
  const { url } = await authKitInstance.getSignInUrl({ returnPathname: event.url.pathname });
  throw redirect(302, url);
}
```

#### 2.3 `createGetSignInUrl` / `createGetSignUpUrl` — no gating

These are explicit user-triggered helpers called once per sign-in click. No middleware loop; no bloat risk. Per-flow names (from core) still protect against the multi-tab race. Leave untouched aside from ambient `cookieName` in the result type.

#### 2.4 `clearPendingVerifier` call sites

Update `src/server/auth.ts` callback-bailout paths to pass `state` from the URL.

### 3. `authkit-tanstack-start`

#### 3.1 No gating

Server functions (`getAuthorizationUrl`, `getSignInUrl`, `getSignUpUrl` in `src/server/server-functions.ts`) are XHR-invoked, but the client then navigates via `window.location.href = url`. Suppressing `Set-Cookie` on the XHR response would break sign-in: the subsequent navigation's callback would find no cookie.

Always write the cookie. Per-flow names (from core) handle the concurrency correctness. Cookie bloat is self-limiting: one server-function call per user click.

#### 3.2 `clearPendingVerifier` call sites

Update `src/server/server.ts` callback bailout paths to pass `state`.

#### 3.3 Stale comment cleanup

`src/server/server.ts:62-71` still claims PKCE cookie `Path` tracks `redirectUri`. `authkit-session/src/core/pkce/cookieOptions.ts:57` hardcodes `path: '/'`. Fix the comments in the same PR that bumps the dep.

## Testing

### `authkit-session`

- `getPKCECookieNameForState` — deterministic, different states produce different names, format matches `/^wos-auth-verifier-[0-9a-f]{8}$/`.
- `fnv1a32Hex` — known-answer tests against a reference implementation for at least 3 inputs.
- `AuthService.handleCallback` — two concurrent flows, two different cookies present, each callback picks its own cookie; the other remains untouched in the cleared Set-Cookie output.
- `AuthService.getAuthorizationUrl` / `getSignInUrl` / `getSignUpUrl` — return `{ url, cookieName }` and do **not** invoke `storage.setCookie` (spy on storage).
- `AuthService.createAuthorization` — returns `cookieName` in the result and writes under that exact name.
- `AuthService.clearPendingVerifier` — requires `state`; compile-time test via `expectTypeOf`; runtime test asserts the cleared cookie name matches `getPKCECookieNameForState(state)`.
- `handleCallback` pre-unseal error path clears the derived cookie, not the prefix-only name.

### `authkit-sveltekit`

- `isDocumentRequest` — matrix of header combinations (document, XHR, RSC, prefetch, bare, `*/*`, missing headers).
- `createWithAuth` — fires `createSignIn` (cookie write) for document requests; fires `getSignInUrl` (no cookie) for XHR. Spy on the instance methods.
- Callback-bailout sites correctly thread URL `state` into `clearPendingVerifier`.

### `authkit-tanstack-start`

- Existing tests continue to pass with per-flow cookie names (cookie name assertions need updating to derive via `getPKCECookieNameForState`).
- Callback-bailout sites correctly thread URL `state` into `clearPendingVerifier`.

## Release

Order: `authkit-session` → `authkit-sveltekit` → `authkit-tanstack-start`.

- `authkit-session` → `0.4.0`. The `clearPendingVerifier` signature change is a breaking change but scoped to in-tree callers; externally the surface grows (new methods, new return field). Minor bump with a CHANGELOG note covering the `clearPendingVerifier` signature.
- `authkit-sveltekit` → patch or minor, depending on version semantics the package uses.
- `authkit-tanstack-start` → patch or minor, same logic.

No user-facing migration required for consumers of the adapters — the fix is transparent to application code.

## Rejected alternatives

- **`writeCookie?: boolean` flag on `createAuthorization`.** Rejected: the pure/side-effect-full seam already exists in `AuthOperations` vs `AuthService`. Exposing a new pure public method is a cleaner API than a flag that toggles side effects.
- **Shared `isLikelyDocumentRequest` in `authkit-session`.** Rejected: header heuristics are adapter semantics, and the nextjs middleware model isn't shared by sveltekit or tanstack-start. Adapters implement whatever detection fits their request model.
- **Document-request gating in `authkit-tanstack-start`.** Rejected: server functions are XHR-invoked, but the client navigates via the returned URL. Suppressing `Set-Cookie` breaks sign-in.
- **Legacy cookie fallback in `handleCallback`.** Rejected: no meaningful at-risk user population; not worth the lingering code path.
- **`clearPendingVerifier` with optional `state` and warn+no-op.** Rejected: half-API that hides bugs. Require `state` or delete the method; we chose require.
- **Orphan cleanup on `signOut`.** Rejected: TTL (10 min) handles orphans; tanstack-start hasn't shipped and sveltekit has no real users.
