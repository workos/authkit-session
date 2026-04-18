# Implementation Spec: Storage-Owned PKCE Cookies — Phase 3 (authkit-sveltekit)

**Contract**: ./contract.md
**Estimated Effort**: S

## Technical Approach

Internal-only refactor of the SvelteKit adapter to consume the new `authkit-session` API. Public surface (`authKit.getSignInUrl(options)` returning `string`, `authKit.handleCallback()` returning a handler, `authKitHandle`, `<AuthKitProvider>`, etc.) is unchanged for end-user apps.

This phase also fixes a **pre-existing latent bug**: `src/server/auth.ts:196-198` currently collapses multi-value `Set-Cookie` headers by doing `Array.isArray(value) ? value.join(', ') : value` followed by `response.headers.set(key, ...)`. After Phase 1, `result.headers['Set-Cookie']` will reliably be `string[]` on the success path — so this bug becomes load-bearing and must be fixed.

Three things happen:

1. `SvelteKitStorage` gains a `getCookie(request, name)` override; `getSession` override is deleted (inherited).
2. `src/server/adapters/pkce-cookies.ts` is deleted entirely — SvelteKit's native `cookies.set/get/delete` is still used, but only via the middleware/error paths, and the library's new shape handles the rest.
3. The header-merging block at `auth.ts:196-198` is rewritten to `headers.append('Set-Cookie', v)` for each array entry.

## Feedback Strategy

**Inner-loop command**: `pnpm test`

**Playground**: Vitest test suite + the SvelteKit example app (`example/`) with the existing pnpm override pointing at the local `authkit-session` checkout.

**Why this approach**: Two PKCE-specific test files already cover the paths that break (`get-sign-in-url.test.ts`, `handle-callback.test.ts`). Example app covers end-to-end.

## File Changes

### New Files

| File Path | Purpose |
| --------- | ------- |
| (none)    | —       |

### Modified Files

| File Path                                  | Changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/adapters/storage.ts`           | Add `getCookie(request, name)` override using `cookie`-header parsing (or route through the `AsyncLocalStorage` request-context to call `event.cookies.get(name)` if cleaner). Delete the `getSession` override at lines 19-25.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/server/auth.ts`                       | Line 34/52: rename `getSignInUrl`/`getSignUpUrl` → `createSignIn`/`createSignUp` (upstream calls). Lines 39, 57: drop `setPKCECookie` calls — replace with `applyCookies(event, mutated, headers)`. Public helper signatures unchanged — still `(options?: SignInOptions): Promise<string>`, event still from `getRequestEvent()`. Lines 143-215: rewrite callback handler per this spec's committed design. Drop `getPKCECookieOptions` call at line 150. Drop `deletePKCECookie` in `bail` — replace with bail that returns a plain `Response` carrying `clearPendingVerifier`'s headers. Drop `cookieValue` from `handleCallback` call at line 172. Line 176: drop manual verifier delete (library handles via storage). Lines 196-198: **fix the multi-Set-Cookie bug** — replace `Array.isArray(value) ? value.join(', ') : value` + `response.headers.set(key, ...)` with explicit append-per-value for `Set-Cookie`. Lines 87-89 (`signOut`): same latent collapse bug — fix in the same pass. |
| `src/server/adapters/set-cookie-parser.ts` | **New file.** Exports `parseSetCookieHeader(raw: string): { name, value, options }`. Small dedicated parser (~30 lines) — the `cookie` npm package is NOT applicable here (it parses request-side `Cookie` headers, not response-side `Set-Cookie`). Alternative: `set-cookie-parser` npm package; decide during implementation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/server/adapters/cookie-forwarding.ts` | **New file (or inline in auth.ts).** Exports `applyCookies(event, mutated?, headers?)` and `appendHeaderBag(headers, bag?)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `src/server/middleware.ts`                 | Line 25-28: rename upstream call; drop `setPKCECookie` (new shape returns headers, apply via `event.setHeaders` or response merge).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/index.ts`                             | Lines 135-140: update JSDoc mentioning PKCE cookie. Drop PKCE export re-exports that no longer exist upstream (`PKCE_COOKIE_NAME`, etc.) — retain error classes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/tests/get-sign-in-url.test.ts`        | Full rewrite: mocks `authkit-session` calls using the new shape (no `sealedState`/`cookieOptions`). Line 8: drop `PKCE_COOKIE_NAME` hardcode if possible.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/tests/handle-callback.test.ts`        | Full rewrite: drop `cookieValue` mock args; drop `getPKCECookieOptions` mock; assert both session cookie and verifier-delete cookie appear in response. Line 10: same cleanup as above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `package.json`                             | Line 47: bump `@workos/authkit-session` from `^0.4.0` to actual published version (or update local link).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### Deleted Files

| File Path                             | Reason                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/server/adapters/pkce-cookies.ts` | `setPKCECookie` and `deletePKCECookie` helpers no longer needed — library owns the cookie lifecycle and `clearPendingVerifier` handles the error path. |

## Implementation Details

### Storage.getCookie override

**Pattern to follow**: Existing `getSession` at `src/server/adapters/storage.ts:19-25` (parses `cookie` header manually).

**Overview**: SvelteKit's `CookieSessionStorage<Request, Response>` generic is keyed on web Request, so cookie parsing comes from the header — not from `event.cookies`. Same strategy as the TanStack adapter.

```ts
export class SvelteKitStorage extends CookieSessionStorage<Request, Response> {
  async getCookie(request: Request, name: string): Promise<string | null> {
    const header = request.headers.get('cookie');
    if (!header) return null;
    const match = header
      .split(';')
      .map(p => p.trim())
      .find(p => p.startsWith(`${name}=`));
    if (!match) return null;
    return decodeURIComponent(match.slice(name.length + 1));
  }
}
```

**Key decisions**:

- Don't use `event.cookies.get` — keeps storage pure against the `Request` generic, same as the existing `getSession` pattern. The `AsyncLocalStorage` request-context detour is more code for the same outcome.
- Return `null` on miss. Contract with the base class.

**Implementation steps**:

1. Open `src/server/adapters/storage.ts`.
2. Delete the `getSession` override (lines 19-25).
3. Add the `getCookie` method.
4. Confirm TS compiles.

**Feedback loop**:

- **Playground**: Any existing tests touching `SvelteKitStorage`.
- **Experiment**: Construct a Request with a known cookie header; call `getCookie` with matching and mismatching names.
- **Check command**: `pnpm test -- storage`

### auth.ts createHandleCallback rewrite

**Pattern to follow**: Current shape at `src/server/auth.ts:143-215`.

**Overview**: Drop all three PKCE-adapter-isms (`cookieOptions`/`deletePKCECookie`/`cookieValue`) and fix the multi-Set-Cookie collapse.

```ts
export function createHandleCallback(authKitInstance: AuthKitInstance) {
  return () => {
    return async (event: RequestEvent): Promise<Response> => {
      const { url, request } = event;
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state') || undefined;
      const oauthError = url.searchParams.get('error');

      // Bail constructs and returns a Response directly (never uses `redirect()`)
      // so the verifier-delete Set-Cookie attaches reliably. SvelteKit handlers
      // can return plain Response objects — `redirect()` is just syntactic sugar
      // for throwing a Redirect exception, which complicates cookie attachment.
      const bail = async (
        errCode: string,
        status: 302 | 303 | 307 | 308 = 302,
      ): Promise<Response> => {
        const { headers: deleteHeaders } =
          await authKitInstance.clearPendingVerifier(new Response());
        const response = new Response(null, {
          status,
          headers: { Location: `/auth/error?code=${errCode}` },
        });
        appendHeaderBag(response.headers, deleteHeaders);
        return response;
      };

      if (oauthError) {
        console.error('OAuth error:', oauthError);
        return bail(
          oauthError === 'access_denied' ? 'ACCESS_DENIED' : 'AUTH_ERROR',
        );
      }

      if (!code) return bail('AUTH_FAILED');

      try {
        const innerResponse = new Response();
        const result = await authKitInstance.handleCallback(
          request,
          innerResponse,
          { code, state },
        );

        const response = new Response(null, {
          status: 302,
          headers: { Location: result.returnPathname },
        });

        // Forward Set-Cookie headers — must append each, never set-collapse
        if (result.response) {
          for (const [key, value] of result.response.headers.entries()) {
            response.headers.append(key, value);
          }
        }
        appendHeaderBag(response.headers, result.headers);
        return response;
      } catch (err) {
        console.error('Authentication error:', err);
        // Preserve the existing distinct error-code mapping — unchanged from 0.3.x
        const errCode =
          err instanceof OAuthStateMismatchError
            ? 'STATE_MISMATCH'
            : err instanceof PKCECookieMissingError
              ? 'PKCE_COOKIE_MISSING'
              : err instanceof SessionEncryptionError
                ? 'SESSION_ENCRYPTION_FAILED'
                : 'AUTH_FAILED';
        return bail(errCode);
      }
    };
  };
}

// Helper: append every Set-Cookie value (and other headers) from a HeadersBag.
function appendHeaderBag(headers: Headers, bag: HeadersBag | undefined): void {
  if (!bag) return;
  for (const [key, value] of Object.entries(bag)) {
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) headers.append(key, v);
  }
}
```

**Key decisions**:

- **Bail returns a manually-constructed `Response` — it does NOT call SvelteKit's `redirect()`.** `redirect()` throws, which complicates attaching `Set-Cookie` to the eventual response. A direct `Response` with status 302 + `Location` header is equivalent, and `response.headers.append('Set-Cookie', ...)` attaches cleanly. SvelteKit handlers are allowed to return plain `Response` objects.
- No upstream `getVerifierCookieName()` helper needed. `clearPendingVerifier` returns the Set-Cookie header directly; the adapter appends it without parsing.
- **Error-code mapping preserved**: `OAuthStateMismatchError` → `STATE_MISMATCH`, `PKCECookieMissingError` → `PKCE_COOKIE_MISSING`, `SessionEncryptionError` → `SESSION_ENCRYPTION_FAILED`, fallback `AUTH_FAILED`. Zero behavioral change from the current adapter.
- `response.headers.append(...)` for every value — this is the fix for the latent collapse bug at the current `auth.ts:196-198`.

**Implementation steps**:

1. Delete the `cookieOptions = authKitInstance.getPKCECookieOptions()` call at line 150.
2. Rewrite `bail` to use `clearPendingVerifier`.
3. Delete the `cookieValue = cookies.get(cookieOptions.name)` read at line 166.
4. Drop the `cookieValue` arg from the `handleCallback` call at line 172.
5. Delete the explicit `deletePKCECookie(cookies, cookieOptions)` at line 176 — library handles it.
6. Rewrite the header-forwarding block at lines 190-199 to use `response.headers.append` for every value, never `set` + `join`.

**Failure modes**:

| Component                   | Failure Mode                                                             | Trigger                                                   | Impact                                     | Mitigation                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bail`                      | Verifier-delete `Set-Cookie` doesn't attach to the redirect response     | —                                                         | —                                          | Resolved: bail returns a plain `Response` directly; `clearPendingVerifier`'s headers appended via `appendHeaderBag`. Never uses SvelteKit's throwing `redirect()`. |
| Multi-Set-Cookie collapse   | Regression to `.set` + `.join(', ')`                                     | Future refactor reverts                                   | Browser loses one cookie                   | Test: assert Response has exactly 2 Set-Cookie entries after success                                                                                               |
| `createSignIn` return shape | Upstream inner response has no cookies (new API returns headers via bag) | Library routes via `headers` not `response` in some cases | Set-Cookie missing from SvelteKit Response | Handle both `result.response` and `result.headers` (code already does)                                                                                             |

**Feedback loop**:

- **Playground**: `src/tests/handle-callback.test.ts` after rewrite.
- **Experiment**: Mock `authKitInstance.handleCallback` to return `{ response, headers: { 'Set-Cookie': ['wos_session=...', 'wos-auth-verifier=; Max-Age=0'] } }`. Assert final Response has both values as separate headers (inspect via `response.headers.getSetCookie()` or iterator).
- **Check command**: `pnpm test -- handle-callback`

### createGetSignInUrl / createGetSignUpUrl rewrite

**Pattern to follow**: Current at `src/server/auth.ts:31-60`. Helper signature is `(options?: SignInOptions): Promise<string>` — event is read internally via `getRequestEvent()` from the `AsyncLocalStorage` populated by `authKitHandle`. **This signature is public and must not change.**

**Overview**: Call upstream's new `createSignIn`/`createSignUp`; forward returned cookies onto the current `RequestEvent.cookies` using `applyCookies`. `setPKCECookie` is deleted.

```ts
export function createGetSignInUrl(authKitInstance: AuthKitInstance) {
  return async (options?: SignInOptions): Promise<string> => {
    const event = getRequestEvent(); // unchanged — AsyncLocalStorage per-request
    const response = new Response();
    const {
      url,
      response: mutated,
      headers,
    } = await authKitInstance.createSignIn(response, {
      returnPathname: options?.returnTo,
      organizationId: options?.organizationId,
      loginHint: options?.loginHint,
    });
    applyCookies(event, mutated, headers);
    return url;
  };
}

function applyCookies(
  event: RequestEvent,
  mutated?: Response,
  headers?: HeadersBag,
): void {
  const setCookieValues: string[] = [];
  if (mutated) {
    // Headers.getSetCookie() (Node 18.14+, standard Web) preserves multi-value without joining
    const multi = mutated.headers.getSetCookie?.() ?? [];
    setCookieValues.push(...multi);
  }
  if (headers) {
    const sc = headers['Set-Cookie'];
    if (Array.isArray(sc)) setCookieValues.push(...sc);
    else if (sc) setCookieValues.push(sc);
  }
  for (const raw of setCookieValues) {
    const parsed = parseSetCookieHeader(raw); // own helper — see below
    event.cookies.set(parsed.name, parsed.value, parsed.options);
  }
}
```

**Key decisions**:

- **Public helper signature unchanged**: `(options?: SignInOptions): Promise<string>`. `event` continues to be sourced from `getRequestEvent()` — zero end-user break. The spec's earlier draft proposing `(event, options)` was wrong and is reverted.
- **Own `parseSetCookieHeader` util** in `src/server/adapters/set-cookie-parser.ts`. The `cookie` npm package parses the request-side `Cookie` header, not the response-side `Set-Cookie` — it's the wrong tool. Alternatives:
  - `set-cookie-parser` (npm, ~20k dl/wk): purpose-built, reliable, tiny. Adds one dep.
  - Custom ~30-line parser: extracts `name=value; Path=/x; HttpOnly; Secure; SameSite=Lax; Max-Age=600`.
  - **Decision**: write the small dedicated parser — no new runtime dep, and the set of attributes we care about is fixed (name, value, path, domain, maxAge, expires, httpOnly, secure, sameSite, priority, partitioned — all covered by the existing `CookieOptions` type in upstream). Open Items has the parser signature sketch.
- Use `mutated.headers.getSetCookie()` (standard Web API in modern Node/runtimes) when present — avoids any comma-join pitfall at the boundary.
- `applyCookies` lives in `src/server/adapters/cookie-forwarding.ts` (or inline if only used once after refactor — verify during implementation).

**Implementation steps**:

1. Delete `setPKCECookie` + `deletePKCECookie` from `pkce-cookies.ts`; delete the file entirely.
2. Add `src/server/adapters/set-cookie-parser.ts` with `parseSetCookieHeader(raw: string): { name: string; value: string; options: CookieSerializeOptions }`.
3. Add `applyCookies` helper (inline in `auth.ts` or separate module).
4. Rewrite `createGetSignInUrl` and `createGetSignUpUrl` bodies to call the upstream's new `createSignIn`/`createSignUp` and use `applyCookies`. Keep the `(options?: SignInOptions): Promise<string>` signature.
5. Update `middleware.ts:25-28` to use `applyCookies` too.
6. **Bonus fix**: `src/server/auth.ts:87-89` (the `signOut` handler) has the same comma-join collapse bug as the callback handler — rewrite to use `Headers.append` for `Set-Cookie` arrays. Pre-existing, but it's adjacent code and worth fixing in the same pass.

**Feedback loop**:

- **Playground**: `src/tests/get-sign-in-url.test.ts`.
- **Experiment**: Mock `authKitInstance.createSignIn` to return a specific set of Set-Cookie headers. Assert `event.cookies.set` is called once per cookie with correct name/value/path.
- **Check command**: `pnpm test -- get-sign-in-url`

## Testing Requirements

### Unit Tests

| Test File                                     | Coverage                                                                                                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/tests/get-sign-in-url.test.ts`           | Rewrite for new upstream shape. Assert `event.cookies.set` called for `wos-auth-verifier`.                                                                       |
| `src/tests/handle-callback.test.ts`           | Rewrite for `handleCallback` no longer taking `cookieValue`. Assert final response has session cookie + verifier-delete cookie as separate `Set-Cookie` headers. |
| `src/tests/storage.spec.ts` (new or existing) | `getCookie(request, name)` parses cookies correctly; inherited `getSession` still works.                                                                         |
| `src/tests/middleware.test.ts` (if exists)    | Cookie-forwarding in middleware works.                                                                                                                           |

**Key test cases**:

- Sign-in → `event.cookies.set('wos-auth-verifier', <sealed>, { path, httpOnly, secure, sameSite: 'lax', maxAge: 600 })`.
- Callback success → final `Response.headers.getSetCookie()` returns array with session + verifier-delete.
- Callback state mismatch → `bail('STATE_MISMATCH')`, returned `Response` has verifier-delete `Set-Cookie` and `Location: /auth/error?code=STATE_MISMATCH`.
- Callback PKCE cookie missing → `bail('PKCE_COOKIE_MISSING')`, same shape.
- Callback session encryption error → `bail('SESSION_ENCRYPTION_FAILED')`, same shape.
- Callback OAuth error param (`?error=access_denied`) → `bail('ACCESS_DENIED')`, verifier-delete emitted.
- Callback OAuth error param (other) → `bail('AUTH_ERROR')`, verifier-delete emitted.
- Callback missing `?code=` → `bail('AUTH_FAILED')`, verifier-delete emitted.
- `storage.getCookie` with missing cookie returns `null`.
- `storage.getCookie` with URL-encoded value decodes correctly.

### Manual Testing

- [ ] SvelteKit example app linked to local `authkit-session`: happy-path sign-in.
- [ ] Inspect Network tab: `Set-Cookie` on `/auth/callback` response shows both cookies.
- [ ] Simulate state mismatch: edit `wos-auth-verifier` value in devtools before callback → expect redirect to `/auth/error?code=STATE_MISMATCH` AND `wos-auth-verifier` cleared.

## Error Handling

| Error Scenario                                                    | Handling Strategy                                          |
| ----------------------------------------------------------------- | ---------------------------------------------------------- |
| `authKitInstance.handleCallback` throws `OAuthStateMismatchError` | `bail('STATE_MISMATCH')`.                                  |
| `authKitInstance.handleCallback` throws `PKCECookieMissingError`  | `bail('PKCE_COOKIE_MISSING')`.                             |
| `authKitInstance.handleCallback` throws `SessionEncryptionError`  | `bail('SESSION_ENCRYPTION_FAILED')`.                       |
| Any other error from `handleCallback`                             | `bail('AUTH_FAILED')` — matches current 0.3.x behavior.    |
| OAuth provider returns `?error=access_denied`                     | `bail('ACCESS_DENIED')` without invoking `handleCallback`. |
| OAuth provider returns any other `?error=`                        | `bail('AUTH_ERROR')`.                                      |
| Missing `?code=` param                                            | `bail('AUTH_FAILED')`.                                     |

## Validation Commands

```bash
# Type checking (if configured)
pnpm run typecheck

# Lint
pnpm run lint

# Tests
pnpm test

# Build
pnpm run build

# Example app
cd example && pnpm dev
```

## Rollout Considerations

- **Coordination**: Blocked by Phase 1. Parallelizable with Phase 2.
- **Rollback plan**: Revert phase commit; re-pin upstream to 0.3.x.

## Open Items

- [ ] Decide whether `applyCookies` / `appendHeaderBag` / `parseSetCookieHeader` live in a small `src/server/adapters/` module or inline. Style call only — behavior identical. Suggested: one new file `src/server/adapters/cookie-forwarding.ts` containing all three.

## Dedicated Set-Cookie parser (signature sketch)

```ts
// src/server/adapters/set-cookie-parser.ts
import type { CookieSerializeOptions } from '@sveltejs/kit'; // or `cookie`-compatible shape

export interface ParsedSetCookie {
  name: string;
  value: string;
  options: CookieSerializeOptions;
}

export function parseSetCookieHeader(raw: string): ParsedSetCookie {
  // Split on ';', first part is name=value, rest are attributes.
  // Attributes to recognize (case-insensitive): Path, Domain, Max-Age, Expires,
  // HttpOnly, Secure, SameSite, Priority, Partitioned.
  // URL-decode the value only if it contains percent-encoded chars.
  // Return { name, value, options } where options shape matches event.cookies.set.
}
```

Tests live in `src/tests/set-cookie-parser.test.ts`. Cover: minimal cookie (`name=value`), full-attribute cookie (all flags), `Max-Age=0` (delete), `SameSite=None; Secure`, percent-encoded value.
