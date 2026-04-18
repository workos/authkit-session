# Implementation Spec: Storage-Owned PKCE Cookies — Phase 2 (authkit-tanstack-start)

**Contract**: ./contract.md
**Estimated Effort**: S

## Technical Approach

Internal-only refactor of the TanStack Start adapter to consume the new `authkit-session` API. Public surface (`getSignInUrl` → `string`, `handleCallbackRoute({ onSuccess, onError })`, etc.) is unchanged for end-user apps — all shape collapse happens behind the adapter's boundary.

Three things happen:

1. `TanStackStartCookieSessionStorage` gains a `getCookie(request, name)` override and loses its `getSession` override (now inherited from the base class).
2. Call sites that currently destructure `sealedState`/`cookieOptions`/call `serializePKCESetCookie`/pass `cookieValue`/call `buildPKCEDeleteCookieHeader` are replaced with the new shape.
3. `appendSessionHeaders` is updated (or confirmed correct) to use `headers.append('Set-Cookie', value)` for every array entry — not `.set()` + `.join()`.

## Feedback Strategy

**Inner-loop command**: `pnpm test` (check watch availability — use if present)

**Playground**: Test suite + the local example app (`example/`) linked to the local `authkit-session` checkout.

**Why this approach**: Adapter has a test suite covering the server-fn paths that most depend on upstream shapes (state binding, callback handling). The example app provides end-to-end validation.

## File Changes

### New Files

| File Path | Purpose |
| --------- | ------- |
| (none)    | —       |

### Modified Files

| File Path                        | Changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/server/storage.ts`          | Add `getCookie(request, name)` override that parses the `cookie` header and returns the named value. Delete the existing `getSession` override (inherit from base).                                                                                                                                                                                                                                                                                                      |
| `src/server/server-functions.ts` | Lines 7, 15-24, 185, 212, 236: rename `getSignInUrl` → `createSignIn` (upstream call); drop the `serializePKCESetCookie` import; replace the manual `ctx.__setPendingHeader('Set-Cookie', serializePKCESetCookie(...))` pattern with direct consumption of the new `{ url, response?, headers? }` shape from upstream — forward `headers['Set-Cookie']` through `ctx.__setPendingHeader`, appending each entry if array.                                                 |
| `src/server/server.ts`           | Line 62: replace `authkit.buildPKCEDeleteCookieHeader()` with `await authkit.clearPendingVerifier(response)` — hold the result, use `.headers['Set-Cookie']` as the delete-header source. Line 79: drop the `readPKCECookie(request)` call and the `cookieValue` param to `handleCallback`. Lines 81-85: `handleCallback` call signature is now `{ code, state }`. Ensure `errorResponse` path still calls `clearPendingVerifier` (or equivalent) for the delete header. |
| `src/server/cookie-utils.ts`     | `readPKCECookie` is no longer needed — delete the function if unused elsewhere, or keep as a generic cookie reader if other code uses it (grep first).                                                                                                                                                                                                                                                                                                                   |
| `src/server/server.spec.ts`      | Lines 113, 133: update `handleCallback` mock invocations to drop `cookieValue`. Update any `serializePKCESetCookie`/`PKCE_COOKIE_NAME` references.                                                                                                                                                                                                                                                                                                                       |
| `src/index.ts` or barrel         | If any upstream PKCE names were re-exported (check `src/server/index.ts:31`), remove the re-exports for removed names (`PKCE_COOKIE_NAME`, etc. — keep `OAuthStateMismatchError` and `PKCECookieMissingError`).                                                                                                                                                                                                                                                          |
| `package.json`                   | Bump `@workos/authkit-session` to the new lib version (e.g., `^0.4.0-alpha.1` or whatever Phase 1 publishes; if consuming via workspace/link, update the link reference).                                                                                                                                                                                                                                                                                                |

### Deleted Files

| File Path        | Reason                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| (none confirmed) | Possibly `src/server/cookie-utils.ts` if `readPKCECookie` was its only export. Verify during implementation. |

## Implementation Details

### Storage.getCookie override

**Pattern to follow**: Existing `getSession` override at `src/server/storage.ts:19-25` (quick-exploration reference) — generalize it.

**Overview**: Parse the `cookie` header from a standard Web `Request`, return the named cookie value or null.

```ts
export class TanStackStartCookieSessionStorage extends CookieSessionStorage<
  Request,
  Response
> {
  async getCookie(request: Request, name: string): Promise<string | null> {
    const header = request.headers.get('cookie');
    if (!header) return null;
    const match = header
      .split(';')
      .map(p => p.trim())
      .find(p => p.startsWith(`${name}=`));
    if (!match) return null;
    const rawValue = match.slice(name.length + 1);
    return decodeURIComponent(rawValue);
  }
  // getSession override DELETED — inherited from CookieSessionStorage.
}
```

**Key decisions**:

- Reuse the parsing pattern from the current `getSession`, now parameterized on name.
- Return `null` on missing cookie (contract matches base class's abstract signature).

**Implementation steps**:

1. Open `src/server/storage.ts`.
2. Delete the `getSession` override.
3. Add the `getCookie` method above.
4. Verify TypeScript compiles (the base class now satisfies `getSession` via its wrapper).

**Feedback loop**:

- **Playground**: Any existing `storage.spec.ts` or inline tests.
- **Experiment**: Construct a `Request` with a known cookie header, call `getCookie` with matching and mismatching names.
- **Check command**: `pnpm test -- storage`

### server-functions.ts PKCE refactor

**Pattern to follow**: Current internal destructuring at `src/server/server-functions.ts:15-24, 185, 212, 236`.

**Overview**: The adapter-defined `getSignInUrl` server function stays named `getSignInUrl` for its end-user API, but internally calls upstream's `createSignIn` and stops manually serializing cookies.

```ts
export const getSignInUrl = createServerFn({ method: 'POST' })
  .validator(...)
  .handler(async ({ data }) => {
    const authkit = await getAuthkit();
    const response = new Response();
    const { url, response: mutated, headers } = await authkit.createSignIn(response, {
      returnPathname: data?.returnPathname,
    });
    // Forward every Set-Cookie from the upstream result through __setPendingHeader
    forwardSetCookies(mutated?.headers ?? new Headers(), headers);
    return url;
  });
```

**Key decisions**:

- The adapter's public return type stays `Promise<string>` (the url). Internal destructure + forwarding stays inside the handler.
- Create a small `forwardSetCookies` helper if used in 3+ places (sign-in/sign-up/authorize). Otherwise inline.
- `ctx.__setPendingHeader` — check whether it supports multi-value append. If it uses `.set`, wrap it with explicit append semantics; otherwise multi-cookie collapses.

**Implementation steps**:

1. Remove `serializePKCESetCookie` import at line 7.
2. Replace the destructure at line 15-24 with the new shape.
3. Apply to all three server fns (`getSignInUrl`, `getSignUpUrl`, `getAuthorizationUrl`) at lines 15-24, 185, 212, 236.
4. If `forwardSetCookies` is extracted, place it in a small internal util module.

**Feedback loop**:

- **Playground**: Adapter tests + example app sign-in flow.
- **Experiment**: Trigger `getSignInUrl` via the example app; inspect the response's `Set-Cookie` header — should contain `wos-auth-verifier`.
- **Check command**: `pnpm test -- server-functions`

### server.ts callback refactor

**Pattern to follow**: Current callback handler at `src/server/server.ts:55-112`.

**Overview**: Drop cookieValue read. Replace `buildPKCEDeleteCookieHeader()` with `clearPendingVerifier(response)`. Ensure success path appends both the session cookie and the verifier delete.

```ts
async function handleCallbackInternal(request: Request, options: HandleCallbackOptions): Promise<Response> {
  const authkit = await getAuthkit();
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  // Error-path helper: emit the verifier-delete Set-Cookie
  const clearVerifier = async (resp: Response) => {
    const result = await authkit.clearPendingVerifier(resp);
    return result.headers?.['Set-Cookie'] ?? [];
  };

  if (!code) {
    const resp = new Response();
    const deletes = await clearVerifier(resp);
    return errorResponse(new Error('Missing authorization code'), request, options, deletes, 400);
  }

  try {
    const response = new Response();
    const result = await authkit.handleCallback(request, response, {
      code,
      state: state ?? undefined,
    });

    // Success path — result.headers contains BOTH session Set-Cookie and verifier-delete Set-Cookie
    if (options.onSuccess) await options.onSuccess({ ... });

    const returnPathname = options.returnPathname ?? result.returnPathname ?? '/';
    const redirectUrl = buildRedirectUrl(url, returnPathname);
    const headers = new Headers({ Location: redirectUrl.toString() });
    appendSessionHeaders(headers, result); // must use .append, never .set
    return new Response(null, { status: 307, headers });
  } catch (error) {
    console.error('OAuth callback failed:', error);
    const resp = new Response();
    const deletes = await clearVerifier(resp);
    return errorResponse(error, request, options, deletes, 500);
  }
}
```

**Key decisions**:

- Error path explicitly calls `clearPendingVerifier` — the library no longer auto-deletes on throw.
- `appendSessionHeaders` must be verified/updated to `headers.append('Set-Cookie', v)` for every entry if `result.headers['Set-Cookie']` is an array.

**Implementation steps**:

1. Delete `buildPKCEDeleteCookieHeader()` call at line 62.
2. Delete `readPKCECookie(request)` at line 79.
3. Delete `cookieValue` from the `handleCallback` call at lines 81-85.
4. Add the `clearVerifier` helper (or inline calls to `clearPendingVerifier`).
5. Verify `appendSessionHeaders` iterates arrays correctly — if not, fix.

**Failure modes**:

| Component                      | Failure Mode                                                             | Trigger                        | Impact                                    | Mitigation                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------ | ------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `appendSessionHeaders`         | Uses `headers.set` on `Set-Cookie`                                       | Pre-existing bug or regression | Session or verifier-delete cookie dropped | Test: two Set-Cookie values in the final Response                                             |
| Error path after setup failure | `authkit` itself fails to construct, no `clearPendingVerifier` available | `getAuthkit()` throws          | Verifier cookie lingers                   | Keep existing `STATIC_FALLBACK_DELETE_HEADERS` fallback — grep for this constant, preserve it |

**Feedback loop**:

- **Playground**: `src/server/server.spec.ts` + example app callback.
- **Experiment**: Trigger callback; assert the final Response has two Set-Cookie headers.
- **Check command**: `pnpm test -- server`

## Testing Requirements

### Unit Tests

| Test File                                         | Coverage                                                                                                                                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/server.spec.ts`                       | Remove `cookieValue` mock arg (lines 113, 133). Add: success Response has both session cookie and verifier-delete Set-Cookie. Add: error path (missing code) emits verifier-delete. |
| `src/server/server-functions.spec.ts` (if exists) | Assert `getSignInUrl` result has Set-Cookie forwarded.                                                                                                                              |
| `src/server/storage.spec.ts` (new or existing)    | `getCookie` parses and returns named cookie; returns null on missing cookie/missing header. Inherited `getSession` still works.                                                     |

**Key test cases**:

- Callback success → final `Response` has exactly 2 `Set-Cookie` headers.
- Callback with missing `code` → final `Response` has verifier-delete `Set-Cookie`.
- Callback with `authkit.handleCallback` throwing → final `Response` has verifier-delete `Set-Cookie`.
- `getSignInUrl` adapter → returned URL is a string; ambient response has `wos-auth-verifier` Set-Cookie.

### Manual Testing

- [ ] Run example app linked to local `authkit-session`: sign in, verify cookie lifecycle.
- [ ] Test sign-in with network-level cookie inspection; confirm `HttpOnly` + `Path` + `SameSite=Lax`.
- [ ] Simulate state tampering via devtools — expect redirect to error handler AND verifier cookie cleared.

## Error Handling

| Error Scenario                                    | Handling Strategy                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `getAuthkit()` throws during callback setup       | Keep existing `STATIC_FALLBACK_DELETE_HEADERS` — emit static verifier-delete header so cookie doesn't linger. |
| `handleCallback` throws `OAuthStateMismatchError` | Caught in `try/catch`, calls `clearPendingVerifier`, delegates to `options.onError`.                          |
| `handleCallback` throws `PKCECookieMissingError`  | Same path as above.                                                                                           |
| `forwardSetCookies` receives a string             | Treat as single value, append once.                                                                           |
| `forwardSetCookies` receives a string[]           | Append each entry.                                                                                            |

## Validation Commands

```bash
# Type checking
pnpm run typecheck

# Linting
pnpm run lint

# Unit tests
pnpm test

# Build
pnpm run build

# Example app (manual)
cd example && pnpm dev
```

## Rollout Considerations

- **Coordination**: This phase is blocked by Phase 1 (upstream library must be published or linked first).
- **Rollback plan**: Revert the commit range; re-pin `@workos/authkit-session` to 0.3.x.

## Open Items

- [ ] Confirm `ctx.__setPendingHeader` supports multi-value append — if `.set`-only, need to refactor the adapter's pending-header mechanism.
- [ ] Decide whether `getAuthorizationUrl` (server fn) should also be renamed at the adapter layer or stay as-is to preserve end-user stability.
