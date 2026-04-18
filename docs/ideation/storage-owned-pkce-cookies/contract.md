# Storage-Owned PKCE Cookies Contract

**Created**: 2026-04-18
**Confidence Score**: 98/100
**Status**: Draft
**Supersedes**: None

## Problem Statement

The 0.4.0 draft of `authkit-session` (branch `pkce-csrf`, PR #25) introduces a PKCE-verifier cookie bound to OAuth `state` to close a CSRF gap. The implementation works, tests pass, but the public API has a design inconsistency worth fixing before the release ships.

`SessionStorage` owns the session cookie lifecycle (`getSession`/`saveSession`/`clearSession`). The new PKCE verifier cookie bypasses that abstraction: the library generates sealed state internally, then hands `sealedState` + `cookieOptions` back to the caller to write a `Set-Cookie` header themselves. On the callback side, the caller reads the cookie manually and passes `cookieValue` into `handleCallback`.

No other JS/TS auth library splits responsibility this way. Arctic/openid-client hand out primitives and let the caller own both generation and storage. Auth0/Supabase/Firebase/Amplify/Clerk own the whole dance internally. Splitting generation (library) from storage (caller) is novel, and the novelty is a symptom — the library has a storage abstraction and isn't using it for PKCE.

Consequences of shipping as-drafted:

- Public API exports 5 PKCE-specific helpers (`PKCE_COOKIE_NAME`, `getPKCECookieOptions`, `serializePKCESetCookie`, `PKCECookieOptions`, `buildPKCEDeleteCookieHeader`) that exist only to paper over the split.
- `getSignInUrl` / `getSignUpUrl` / `getAuthorizationUrl` names lie — they return `{ url, sealedState, cookieOptions }`, not a URL string.
- Every adapter must repeat the same 10 lines to serialize/apply/delete the verifier cookie.
- Direct library consumers face a higher-ceremony migration than is necessary.

## Goals

1. Generalize `SessionStorage` with `getCookie` (abstract) / `setCookie` (concrete) / `clearCookie` (concrete) primitives that take a cookie name and per-call options. Keep existing session methods as thin wrappers that forward the baked-in session name + options.
2. Move PKCE verifier cookie read/write/delete into `AuthService` so it flows through storage — callers never see sealed blobs or cookie options.
3. Rename `getSignInUrl` / `getSignUpUrl` / `getAuthorizationUrl` → `createSignIn` / `createSignUp` / `createAuthorization`. Hard rename; matches Arctic's `createAuthorizationURL` and openid-client's `buildAuthorizationUrl` precedent.
4. Remove 5 PKCE-specific public exports (`PKCE_COOKIE_NAME`, `getPKCECookieOptions`, `serializePKCESetCookie`, `PKCECookieOptions`, `buildPKCEDeleteCookieHeader`) plus the `cookieValue` parameter on `handleCallback`.
5. Define an explicit error-path contract for the verifier cookie: callers must still be able to clear the verifier when `handleCallback` throws or never gets called (OAuth error responses, missing code). Exposes a single public method `auth.clearPendingVerifier(response, options?: { redirectUri?: string })` — the only PKCE-facing public surface that survives the collapse. `redirectUri` defaults to `config.redirectUri`; callers who used a per-call override at `createSignIn({ redirectUri })` pass the same value at clear time so the emitted `Path` attribute matches the cookie's original scope. API is intentionally symmetric with `createSignIn`.
6. Ensure multi-`Set-Cookie` emission works: `HeadersBag['Set-Cookie']` is already `string | string[]`, but the contract now requires adapters to `headers.append()` each value (never `set()` + `join(', ')`). Adapters must preserve each `Set-Cookie` as its own HTTP header — otherwise the session cookie and PKCE-delete cookie collide on the callback success path.
7. Update both existing adapters (`authkit-tanstack-start`, `authkit-sveltekit`) internally to consume the new shape. End-user apps using either adapter see zero breaking changes.

## Success Criteria

### `authkit-session`

- [ ] `pnpm test` passes (currently 203/203; expect ~215 after new storage + error-path + multi-cookie tests)
- [ ] `pnpm run typecheck` / `lint` / `format:check` clean
- [ ] `src/index.ts` no longer exports: `PKCE_COOKIE_NAME`, `getPKCECookieOptions`, `serializePKCESetCookie`, `PKCECookieOptions`, `buildPKCEDeleteCookieHeader`
- [ ] `AuthService.handleCallback` signature is `(request, response, { code, state })` — no `cookieValue`
- [ ] `AuthService.createSignIn` / `createSignUp` / `createAuthorization` return `{ url, response?, headers? }` — no `sealedState`, no `cookieOptions`
- [ ] `AuthService.clearPendingVerifier(response, options?: { redirectUri?: string })` exists and returns `{ response?, headers? }`. Default `redirectUri` is `config.redirectUri`; explicit override produces a delete header whose `Path` matches `new URL(redirectUri).pathname`. Test: delete header path matches the path used at `createSignIn({ redirectUri })` for both default and per-call-override cases.
- [ ] `SessionStorage` interface has three new methods with these signatures:
  ```ts
  getCookie(request: TRequest, name: string): Promise<string | null>;
  setCookie(
    response: TResponse | undefined,
    name: string,
    value: string,
    options: CookieOptions,
  ): Promise<{ response?: TResponse; headers?: HeadersBag }>;
  clearCookie(
    response: TResponse | undefined,
    name: string,
    options: CookieOptions,
  ): Promise<{ response?: TResponse; headers?: HeadersBag }>;
  ```
- [ ] `CookieSessionStorage` provides concrete `setCookie`/`clearCookie` using a generalized `serializeCookie(name, value, options, { expired? })` + `applyHeaders`; `getCookie` is abstract
- [ ] `getSession` / `saveSession` / `clearSession` reimplemented as one-line wrappers over the new primitives, using the instance's `cookieName` + `cookieOptions`
- [ ] New test covers: `handleCallback` throws → caller's follow-up `clearPendingVerifier` emits the delete header
- [ ] New test covers: `handleCallback` success returns BOTH a session `Set-Cookie` and a verifier-delete `Set-Cookie` as separate entries in `HeadersBag['Set-Cookie']: string[]`

### `authkit-tanstack-start`

- [ ] Tests pass against the updated upstream
- [ ] `server-functions.ts` and `server.ts` no longer reference `sealedState`, `cookieOptions`, `serializePKCESetCookie`, `buildPKCEDeleteCookieHeader`, or `cookieValue`
- [ ] `errorResponse` uses `authkit.clearPendingVerifier(response)` to obtain the delete header instead of `buildPKCEDeleteCookieHeader()`
- [ ] `TanStackStartCookieSessionStorage` implements `getCookie(request, name)`; the existing `getSession` override is deleted (inherited from the base class as a one-line wrapper over `getCookie`)
- [ ] `appendSessionHeaders` uses `headers.append('Set-Cookie', value)` for every entry when `result.headers['Set-Cookie']` is an array

### `authkit-sveltekit`

- [ ] Tests pass; `src/tests/get-sign-in-url.test.ts` and `src/tests/handle-callback.test.ts` rewritten to match the new shape
- [ ] `src/server/adapters/pkce-cookies.ts` deleted
- [ ] `src/server/adapters/storage.ts` implements `getCookie(request, name)`; the existing `getSession` override is deleted (inherited from the base class)
- [ ] `src/server/auth.ts` uses `authKitInstance.clearPendingVerifier(response)` in the `bail` path instead of calling `deletePKCECookie` directly
- [ ] `src/server/auth.ts:196-198` (the current Set-Cookie–collapsing block) fixed: when `result.headers?.['Set-Cookie']` is a `string[]`, each value is appended via `response.headers.append('Set-Cookie', value)` — no `.join(', ')`

### Cross-cutting

- [ ] Example apps in both adapters unchanged (zero-diff in `example/` directories)
- [ ] `MIGRATION.md` in `authkit-session` updated to reflect the collapsed API surface and the `clearPendingVerifier` helper
- [ ] `README.md` updated to show new method names and simplified call sites

## Scope Boundaries

### In Scope

- `authkit-session` — `SessionStorage` interface + `CookieSessionStorage` base class, `AuthService` + `AuthKitCore` + `AuthOperations`, PKCE internals, public exports, tests, `README.md`, `MIGRATION.md`.
- `authkit-tanstack-start` — internal updates (`server-functions.ts`, `server.ts`, `storage.ts`); bump upstream dep; tests.
- `authkit-sveltekit` — internal updates (`auth.ts`, `middleware.ts`, delete `pkce-cookies.ts`, update `storage.ts`, rewrite the two PKCE-touching test files); bump upstream dep.
- Hard rename (no deprecation aliases).

### Out of Scope

- **Publishing to npm.** Separate release step after all three PRs are green.
- **New adapter packages** (Next.js, Hono, etc.). Not in this cycle.
- **Session-cookie behavior changes.** Session cookie semantics stay identical — `saveSession`/`getSession`/`clearSession` become wrappers, same output.
- **CSRF design changes.** The sealed-state-bound-to-cookie design is untouched; this refactor only relocates _where_ the cookie is written.
- **Breaking changes to iron-webcrypto usage or the `SessionEncryption` interface.**

### Future Considerations

- Surface the new `getCookie`/`setCookie` primitives as the supported extension point for adapter authors adding their own flow cookies (e.g., device trust, rate-limit tokens).
- Consider a top-level `parseCookies(header)` utility if a third adapter lands and all three end up writing the same cookie-header parser.
- Consider tightening `HeadersBag` to `Record<string, string[]>` (always-array) to force callers into correct append-semantics. Out of scope for this refactor — would be a separate breaking change that ripples through `saveSession`/`clearSession` return types.

## Execution Plan

### Dependency Graph

```
Phase 1: authkit-session lib refactor  (blocking)
  ├── Phase 2: authkit-tanstack-start internal update  (parallel)
  └── Phase 3: authkit-sveltekit internal update       (parallel)
```

### Execution Steps

**Strategy**: Hybrid — Phase 1 sequential (blocking), then Phase 2 + Phase 3 run in parallel as an agent team (or sequentially in separate sessions if the user prefers single-session control).

1. **Phase 1** — `authkit-session` lib refactor _(blocking)_

   ```bash
   /execute-spec docs/ideation/storage-owned-pkce-cookies/spec-phase-1.md
   ```

   Ships the new `SessionStorage` primitives, renamed methods, `clearPendingVerifier`, multi-`Set-Cookie` support, and the `redirectUri` PKCE state schema extension. Publish locally (pnpm link or workspace) or to an alpha channel before starting Phase 2/3.

2. **Phases 2 & 3** — adapter internal updates _(parallel after Phase 1)_

   Either use the agent team prompt below, or run sequentially in separate sessions:

   ```bash
   # Adapter repo 1 (TanStack Start)
   /execute-spec docs/ideation/storage-owned-pkce-cookies/spec-phase-2.md

   # Adapter repo 2 (SvelteKit) — independent of Phase 2
   /execute-spec docs/ideation/storage-owned-pkce-cookies/spec-phase-3.md
   ```

   Note: Phase 2 runs in `/Users/nicknisi/Developer/authkit-tanstack-start`; Phase 3 runs in `/Users/nicknisi/Developer/authkit-sveltekit`. Each is a separate repo + PR.

### Agent Team Prompt

```
I'm implementing a coordinated three-repo refactor. Phase 1 (authkit-session) has landed and is available as a local pnpm link (or alpha release on npm — confirm before starting).

Spawn two teammates in parallel:

- **Teammate A** — working in /Users/nicknisi/Developer/authkit-tanstack-start on branch feat/pkce-state-binding. Assignment: /execute-spec /Users/nicknisi/Developer/authkit-session/docs/ideation/storage-owned-pkce-cookies/spec-phase-2.md

- **Teammate B** — working in /Users/nicknisi/Developer/authkit-sveltekit on branch feat/pkce-state-binding. Assignment: /execute-spec /Users/nicknisi/Developer/authkit-session/docs/ideation/storage-owned-pkce-cookies/spec-phase-3.md

The two teammates work on independent repos with no shared files — no coordination needed beyond both consuming the new upstream library.

Approval gates: approve each teammate's plan before execution. Synthesize results at the end — collect the two PR URLs and surface any cross-repo inconsistencies in how the new upstream API is consumed.
```

### Post-implementation checklist

- [ ] Phase 1 merged to `main` on `authkit-session`, version bumped to `0.4.0` (remove any `-alpha`/`-rc` suffixes), published to npm.
- [ ] Both adapter PRs updated to consume the stable `0.4.0` (remove any local links or alpha pins).
- [ ] Both adapter PRs merged and published.
- [ ] `MIGRATION.md` is the canonical migration resource for direct library consumers; adapter consumers see zero change.
