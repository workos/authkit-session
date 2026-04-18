# Implementation Spec: Storage-Owned PKCE Cookies — Phase 1 (authkit-session)

**Contract**: ./contract.md
**Estimated Effort**: M

## Technical Approach

Generalize `SessionStorage` so it owns arbitrary named cookies, then route the PKCE verifier cookie through that abstraction. The surface area of the change is mostly in three files (`types.ts`, `CookieSessionStorage.ts`, `AuthService.ts`), plus `AuthOperations`/`AuthKitCore` to wire PKCE read/write through storage, plus the public `src/index.ts` barrel.

The refactor is mechanical once the new interface is in place: every PKCE cookie operation today calls `serializePKCESetCookie` + returns the header for a caller to apply; after, every PKCE operation calls `storage.setCookie`/`storage.clearCookie`/`storage.getCookie` and receives a `{ response?, headers? }` shape identical to what `saveSession`/`clearSession` already return. The three session methods become one-line wrappers over the new generic primitives.

The rename (`getSignInUrl` → `createSignIn` et al.) is a pure symbol rename that rides along with the refactor because both touch `AuthService` and `AuthOperations` — no reason to spread the pain across two releases.

## Feedback Strategy

**Inner-loop command**: `pnpm test:watch`

**Playground**: Vitest watch mode (`package.json:38`). 14 existing spec files, 203 tests — run-on-save gives per-edit feedback in under a second.

**Why this approach**: This is a pure library refactor with extensive existing test coverage. Nothing to render, no HTTP to curl — the test suite IS the playground. Vitest's watch mode re-runs only affected files, so the loop stays tight even as the suite grows.

## File Changes

### New Files

| File Path | Purpose |
| --------- | ------- |
| (none)    | —       |

### Modified Files

| File Path                                                    | Changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/session/types.ts`                                  | Add `getCookie`/`setCookie`/`clearCookie` to `SessionStorage<TRequest, TResponse, TOptions>`. Fold `PKCECookieOptions` into `CookieOptions`. Remove `GetAuthorizationUrlResult.sealedState` + `.cookieOptions` fields; keep only `url`.                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/core/session/CookieSessionStorage.ts`                   | Generalize `buildSetCookie` → `serializeCookie(name, value, options, { expired? })`. Make `getCookie` abstract. Provide concrete `setCookie`/`clearCookie` using `serializeCookie` + `applyHeaders`. Reimplement `getSession`/`saveSession`/`clearSession` as wrappers.                                                                                                                                                                                                                                                                                                                                                     |
| `src/service/AuthService.ts`                                 | Rename `getSignInUrl`/`getSignUpUrl`/`getAuthorizationUrl` → `createSignIn`/`createSignUp`/`createAuthorization`. Change return shape to `{ url, response?, headers? }` — internally writes verifier via `storage.setCookie`. Remove `cookieValue` param from `handleCallback`; read via `storage.getCookie`. Add `clearPendingVerifier(response, options?: { redirectUri?: string })`. Remove `buildPKCEDeleteCookieHeader` and `getPKCECookieOptions` methods. `handleCallback` success emits BOTH session-cookie Set-Cookie AND verifier-delete Set-Cookie by calling `storage.clearCookie` after `storage.saveSession`. |
| `src/operations/AuthOperations.ts`                           | `getAuthorizationUrl`/`getSignInUrl`/`getSignUpUrl` renamed on this class too (it's the delegate). Consume new `GetAuthorizationUrlResult` shape (url only).                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/core/AuthKitCore.ts`                                    | `verifyCallbackState` signature unchanged (still takes `stateFromUrl` + `cookieValue`). It's a pure function — the cookie read stays in AuthService.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/core/pkce/generateAuthorizationUrl.ts`                  | Return only `{ url }` from the internal API. Caller (AuthService) handles sealedState + cookieOptions and passes them straight into `storage.setCookie`. When a per-call `redirectUri` override is provided, include it in the sealed PKCE state so `handleCallback` can recover it for a path-accurate clear.                                                                                                                                                                                                                                                                                                              |
| `src/core/pkce/state.ts`                                     | Extend `StateSchema` with optional `redirectUri: string`. Update `PKCEState` / `PKCEStateInput` types accordingly. `sealState` stamps it when provided; `unsealState` returns it.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/core/pkce/cookieOptions.ts`                             | Keep `getPKCECookieOptions` as an internal (non-exported) helper. Types fold into `CookieOptions`. Delete `serializePKCESetCookie` entirely — replaced by storage's generic `serializeCookie`.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/core/pkce/constants.ts`                                 | `PKCE_COOKIE_NAME` becomes an internal constant, no longer re-exported from `index.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/index.ts`                                               | Remove exports: `PKCE_COOKIE_NAME`, `getPKCECookieOptions`, `serializePKCESetCookie`, `PKCECookieOptions`, `GetAuthorizationUrlResult`'s old shape. Keep: `OAuthStateMismatchError`, `PKCECookieMissingError`.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/service/factory.ts`                                     | Delegation methods renamed to match (`createSignIn` etc.), plus new `clearPendingVerifier`. Drop `buildPKCEDeleteCookieHeader`/`getPKCECookieOptions` passthroughs.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/service/AuthService.spec.ts`                            | Rename all `getSignInUrl`/`getSignUpUrl`/`getAuthorizationUrl` call sites. Drop `sealedState`/`cookieOptions` destructuring (L290, 315, 336, 373). Drop `cookieValue` from `handleCallback` tests (L298, 323, 342, 359, 380). Add tests for `clearPendingVerifier`. Add test that success path emits `Set-Cookie` as `string[]` with both session and PKCE-delete entries. Update storage mocks to implement new methods.                                                                                                                                                                                                   |
| `src/operations/AuthOperations.spec.ts`                      | Rename call sites. Drop old return-shape destructuring.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/core/session/CookieSessionStorage.spec.ts`              | Add tests for `getCookie`/`setCookie`/`clearCookie`. Confirm `getSession`/`saveSession`/`clearSession` still work (wrapper contract).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/core/pkce/pkce.spec.ts`                                 | Drop `cookieValue` parameter from `handleCallback` tests (L59, 80, 105, 122, 142, 153, 179, 208) — replace with a storage mock that pre-seeds the verifier cookie.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `src/core/AuthKitCore.spec.ts`                               | `verifyCallbackState` tests unchanged (L351, 360, 367) — function still takes `cookieValue` directly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/core/pkce/generateAuthorizationUrl.spec.ts` (if exists) | Update for new return shape.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `MIGRATION.md`                                               | Rewrite 0.3.x → 0.4.0 section for collapsed API. Document `createSignIn` rename, `handleCallback` signature, `clearPendingVerifier` helper. Remove references to `serializePKCESetCookie`/`getPKCECookieOptions`/`PKCE_COOKIE_NAME`.                                                                                                                                                                                                                                                                                                                                                                                        |
| `README.md`                                                  | Update lines 177-224 (sign-in/callback examples) for new method names and simplified call sites.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `package.json`                                               | Version bump from `0.3.4` → `0.4.0` (already on branch; confirm no regression).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### Deleted Files

| File Path | Reason                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------- |
| (none)    | All cleanup happens via Modified Files. `cookieOptions.ts`/`constants.ts` stay as internal-only modules. |

## Implementation Details

### SessionStorage interface

**Pattern to follow**: `src/core/session/types.ts:77-106` (existing shape)

**Overview**: Three new primitives take a cookie name and per-call options, enabling the storage layer to manage arbitrary cookies (session + PKCE verifier today; extensible later).

```ts
export interface SessionStorage<TRequest, TResponse, TOptions = unknown> {
  // New generic primitives — adapters implement getCookie, inherit others
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

  // Existing session methods — now wrappers over the above
  getSession(request: TRequest): Promise<string | null>;
  saveSession(
    response: TResponse | undefined,
    data: string,
    options?: TOptions,
  ): Promise<{ response?: TResponse; headers?: HeadersBag }>;
  clearSession(
    response: TResponse | undefined,
    options?: TOptions,
  ): Promise<{ response?: TResponse; headers?: HeadersBag }>;
}
```

**Key decisions**:

- `getCookie` stays abstract because parsing cookies from a request is inherently framework-specific.
- `setCookie`/`clearCookie` have default concrete implementations in `CookieSessionStorage` using `applyHeaders` — no adapter change needed.
- `PKCECookieOptions` folds into `CookieOptions` (it was always a subset). No separate type.

**Implementation steps**:

1. Add three new methods to the interface at `src/core/session/types.ts:77`.
2. In `CookieSessionStorage.ts`, rename `buildSetCookie` → `serializeCookie(name, value, options, { expired? })`. Accept name + options as parameters instead of reading instance state.
3. Implement concrete `setCookie`/`clearCookie` in the base class using `serializeCookie` + `applyHeaders` — mirror the shape of existing `saveSession`/`clearSession`.
4. Declare `getCookie` as abstract.
5. Reimplement `getSession` as `this.getCookie(request, this.cookieName)`.
6. Reimplement `saveSession` as `this.setCookie(response, this.cookieName, data, this.cookieOptions)`.
7. Reimplement `clearSession` as `this.clearCookie(response, this.cookieName, this.cookieOptions)`.

**Feedback loop**:

- **Playground**: `src/core/session/CookieSessionStorage.spec.ts` — 11 existing tests will exercise the wrapper path; add 3-4 new tests for the primitive methods directly.
- **Experiment**: Instantiate a concrete subclass with a mocked `applyHeaders`. Call `setCookie('foo', 'bar', { path: '/x', maxAge: 60 })` and assert the emitted header string matches `foo=bar; Path=/x; Max-Age=60; ...`.
- **Check command**: `pnpm test -- CookieSessionStorage`

### AuthService.createSignIn (and siblings)

**Pattern to follow**: `src/service/AuthService.ts:187-215` (current shape on branch pkce-csrf)

**Overview**: Rename + collapse return shape. Internally generate the PKCE state, write the verifier via `storage.setCookie`, return `{ url, response?, headers? }`.

```ts
async createSignIn(
  response: TResponse | undefined,
  options: Omit<GetAuthorizationUrlOptions, 'screenHint'> = {},
): Promise<{ url: string; response?: TResponse; headers?: HeadersBag }> {
  const { url, sealedState, cookieOptions } =
    await this.operations.getAuthorizationUrl({ ...options, screenHint: 'sign-in' });
  const write = await this.storage.setCookie(
    response,
    PKCE_COOKIE_NAME, // internal constant, not exported
    sealedState,
    cookieOptions,
  );
  return { url, ...write };
}
```

**Key decisions**:

- Sign-in takes a `response` arg so storage can mutate it. Matches `handleCallback`'s existing shape.
- `operations.getAuthorizationUrl` internally still returns `{ url, sealedState, cookieOptions }` because it's pure core logic — AuthService is the layer that dispatches to storage.
- `createAuthorization` is the generic form; `createSignIn`/`createSignUp` call it with `screenHint`.

**Implementation steps**:

1. Rename the three methods on `AuthService`.
2. Thread `response` into signatures.
3. Call `storage.setCookie` after `operations.getAuthorizationUrl` returns.
4. Return `{ url, response?, headers? }` — match the shape of `saveSession`.
5. Mirror in `factory.ts` delegation.

**Feedback loop**:

- **Playground**: `src/service/AuthService.spec.ts` — rename call sites, update assertions.
- **Experiment**: Assert the mocked storage's `setCookie` was called with `PKCE_COOKIE_NAME`, a non-empty string, and options with the expected path.
- **Check command**: `pnpm test -- AuthService`

### AuthService.handleCallback

**Pattern to follow**: Current `src/service/AuthService.ts:256-310` on branch pkce-csrf

**Overview**: Drop `cookieValue` from the options arg. Read via `storage.getCookie`. On success, emit BOTH a session-cookie Set-Cookie AND a verifier-delete Set-Cookie.

```ts
async handleCallback(
  request: TRequest,
  response: TResponse,
  options: { code: string; state: string | undefined },
) {
  const cookieValue = await this.storage.getCookie(request, PKCE_COOKIE_NAME);
  const { codeVerifier, returnPathname, customState, redirectUri: sealedRedirectUri } =
    await this.core.verifyCallbackState({
      stateFromUrl: options.state,
      cookieValue: cookieValue ?? undefined,
    });
  const authResponse = await this.client.userManagement.authenticateWithCode({ ... });
  const session: Session = { ... };
  const encryptedSession = await this.encryption.sealData(session, { password: this.config.cookiePassword });
  const save = await this.storage.saveSession(response, encryptedSession);
  // Use the redirectUri sealed into the state at sign-in time so the clear's Path matches
  // the cookie's original scope — covers per-call redirectUri overrides exactly.
  const clear = await this.storage.clearCookie(
    save.response ?? response,
    PKCE_COOKIE_NAME,
    getPKCECookieOptions(this.config, sealedRedirectUri),
  );
  // Merge headers — both Set-Cookie values preserved as string[]
  const merged = mergeHeaderBags(save.headers, clear.headers);
  return {
    response: clear.response ?? save.response,
    headers: merged,
    returnPathname: returnPathname ?? '/',
    state: customState,
    authResponse,
  };
}
```

**Key decisions**:

- Merging two `{ response?, headers? }` results requires a helper: when both have `headers['Set-Cookie']`, coerce to `string[]` and concat. Implement `mergeHeaderBags` as a private util in AuthService.
- If the adapter's `applyHeaders` returns a mutated response, the second storage call uses that response so both cookies attach to the same underlying object.
- **Verifier-clear path matches sign-in exactly**: `createSignIn` stamps `redirectUri` into the sealed state when a per-call override is used. `handleCallback` reads it back and passes it to `getPKCECookieOptions` so the emitted `Path=` matches the cookie's original scope. No orphan-cookie risk under per-call overrides. The redirectUri is inside the encrypted blob — no exposure.

**Implementation steps**:

1. Delete `cookieValue` from the options type.
2. Add the storage.getCookie read at the top.
3. After `saveSession`, add `clearCookie` for the verifier.
4. Add `mergeHeaderBags` helper — concat `Set-Cookie` arrays, shallow-merge other keys.
5. Update tests to drop `cookieValue` args and assert both cookies land.

**Failure modes**:

| Component                     | Failure Mode                                                                              | Trigger                                                           | Impact                                                                                                                              | Mitigation                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `storage.getCookie`           | Returns null when cookie present                                                          | Adapter bug or proxy stripped the cookie                          | `PKCECookieMissingError` thrown — callback fails                                                                                    | Surface error, caller uses `clearPendingVerifier` to reset                                                                              |
| Double Set-Cookie merge       | `headers.set('Set-Cookie', joined)` collapses to single header                            | Downstream adapter uses `.set` instead of `.append`               | Browser only sees one cookie — either session OR verifier-delete, not both                                                          | Contract's success criterion forces adapter to append; library emits `string[]`                                                         |
| Per-call redirectUri override | Sign-in used `redirectUri='/a/callback'`, callback lands via config default `/b/callback` | App routes sign-in to a different callback than the global config | `handleCallback` reads `redirectUri` from the sealed state and uses it for the clear; `Path=/a/callback` matches the original scope | Resolved: `redirectUri` sealed into PKCE state at sign-in; recovered at callback. Test covers both default and per-call-override paths. |

**Feedback loop**:

- **Playground**: `src/service/AuthService.spec.ts` + `src/core/pkce/pkce.spec.ts`
- **Experiment**: Stub a storage whose `getCookie` returns a known sealed blob. Assert `handleCallback` returns headers with exactly two `Set-Cookie` values.
- **Check command**: `pnpm test -- handleCallback`

### PKCEState schema — add `redirectUri`

**Pattern to follow**: `src/core/pkce/state.ts:27-33` (existing valibot schema).

**Overview**: Seal the per-call `redirectUri` override into the PKCE state so `handleCallback` can recover the exact cookie path at clear-time. The redirectUri lives inside the encrypted blob — no exposure.

```ts
export const StateSchema = v.object({
  nonce: v.string(),
  codeVerifier: v.string(),
  issuedAt: v.number(),
  returnPathname: v.optional(v.string()),
  customState: v.optional(v.string()),
  redirectUri: v.optional(v.string()), // NEW — stamped only when caller passed an override
});
```

**Key decisions**:

- `redirectUri` is `optional` — omitted entirely when the caller uses the default `config.redirectUri`. Saves ciphertext bytes for the common case and preserves forward/backward compat for schema migrations.
- `generateAuthorizationUrl` passes `options.redirectUri` into `sealState` only when the caller provided one; otherwise omits the field.
- `handleCallback` reads the unsealed `redirectUri` and passes it to `getPKCECookieOptions(config, redirectUri)`. The helper already falls back to `config.redirectUri` when its argument is undefined — no branch needed at the call site.

**Implementation steps**:

1. Add `redirectUri: v.optional(v.string())` to `StateSchema` in `src/core/pkce/state.ts`.
2. Update `PKCEStateInput` type (`Omit<PKCEState, 'issuedAt'>` already picks it up).
3. In `src/core/pkce/generateAuthorizationUrl.ts`, when `options.redirectUri` is provided, include it in the `sealState` input.
4. In `AuthService.handleCallback`, destructure `redirectUri` from the unsealed state; pass as 2nd arg to `getPKCECookieOptions`.

**Feedback loop**:

- **Playground**: `src/core/pkce/state.spec.ts`.
- **Experiment**: Seal with `{ ..., redirectUri: 'https://x.example/custom' }`; unseal; assert the field survives the round trip. Seal without redirectUri; unseal; assert the field is undefined.
- **Check command**: `pnpm test -- state.spec`

### AuthService.clearPendingVerifier

**Overview**: New public method for error-path cleanup.

```ts
async clearPendingVerifier(
  response: TResponse,
  options?: { redirectUri?: string },
): Promise<{ response?: TResponse; headers?: HeadersBag }> {
  const cookieOptions = getPKCECookieOptions(
    this.config,
    options?.redirectUri, // defaults to config.redirectUri inside the helper
  );
  return this.storage.clearCookie(response, PKCE_COOKIE_NAME, cookieOptions);
}
```

**Key decisions**:

- Signature symmetric with `createSignIn({ redirectUri })`.
- Returns the same `{ response?, headers? }` shape adapters already consume.
- `getPKCECookieOptions` stays internal-only.

**Implementation steps**:

1. Add method to `AuthService`.
2. Mirror in `factory.ts`.
3. Write tests asserting (a) default path matches `config.redirectUri`'s pathname, (b) per-call override produces a matching `Path`.

**Feedback loop**:

- **Playground**: New describe block in `src/service/AuthService.spec.ts`.
- **Experiment**: Call `clearPendingVerifier(response)` vs `clearPendingVerifier(response, { redirectUri: 'https://x.example/custom' })`. Assert emitted `Set-Cookie` strings differ only in `Path=`.
- **Check command**: `pnpm test -- clearPendingVerifier`

### HeadersBag multi-Set-Cookie

**Pattern to follow**: Existing `Record<string, string | string[]>` shape at `src/core/session/types.ts:75`

**Overview**: Ensure every path that could produce multiple `Set-Cookie` values uses `string[]`, not comma-joined `string`.

**Key decisions**:

- `mergeHeaderBags` helper: when merging two `HeadersBag`s and both have `Set-Cookie`, concat to `string[]`. When only one side has it as `string`, wrap in array if the other is adding one.
- Library never emits comma-joined `Set-Cookie`. Document this in a doc comment on `HeadersBag`.

**Implementation steps**:

1. Add a single doc comment on the `HeadersBag` type alias explaining that `Set-Cookie` MUST be represented as `string[]` when multiple values exist.
2. Implement `mergeHeaderBags` in a new util file or inline in AuthService.
3. Add a dedicated test: mock storage that returns `headers: { 'Set-Cookie': 'session=...' }` for `saveSession` and `headers: { 'Set-Cookie': 'wos-auth-verifier=; Max-Age=0' }` for `clearCookie`. After `handleCallback`, assert returned `headers['Set-Cookie']` is an array of length 2.

## Testing Requirements

### Unit Tests

| Test File                                       | Coverage                                                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/session/CookieSessionStorage.spec.ts` | New: `getCookie`/`setCookie`/`clearCookie` direct tests; existing `getSession`/`saveSession`/`clearSession` still pass (wrapper proof).      |
| `src/service/AuthService.spec.ts`               | Rename coverage; `clearPendingVerifier` default + override paths; multi-`Set-Cookie` assertion on success path; `cookieValue` param removal. |
| `src/operations/AuthOperations.spec.ts`         | Rename coverage; new return-shape assertions.                                                                                                |
| `src/core/pkce/pkce.spec.ts`                    | `handleCallback` tests use a storage mock that pre-seeds the verifier; no more `cookieValue` parameter.                                      |
| `src/core/AuthKitCore.spec.ts`                  | Unchanged — `verifyCallbackState` keeps its current signature.                                                                               |

**Key test cases**:

- `createSignIn` with default config → emitted Set-Cookie has `Path=` matching `config.redirectUri`'s pathname.
- `createSignIn({ redirectUri: X })` → emitted Set-Cookie has `Path=` matching X's pathname.
- `handleCallback` success → returned `headers['Set-Cookie']` is `string[]` with exactly two entries (session cookie + verifier delete).
- `handleCallback` success after `createSignIn({ redirectUri: '/a/callback' })` → verifier-delete `Set-Cookie` has `Path=/a/callback` (matches the sealed `redirectUri`, not `config.redirectUri`).
- `handleCallback` success with default `redirectUri` → verifier-delete `Set-Cookie` has `Path=` matching `config.redirectUri`'s pathname.
- `handleCallback` with missing cookie → throws `PKCECookieMissingError`.
- `clearPendingVerifier(response)` → emits verifier delete with config-default path.
- `clearPendingVerifier(response, { redirectUri: X })` → emits verifier delete with X's path.
- Wrapper proof: `getSession` and `getCookie(cookieName)` return identical values for the same request.

### Manual Testing

- [ ] Link `authkit-session` into `authkit-tanstack-start`'s example app (already set up via pnpm override in sveltekit; do same for tanstack or run tanstack Phase 2 first)
- [ ] Complete happy-path sign-in in the example app; verify `wos-auth-verifier` is set and cleared.
- [ ] Simulate state mismatch (edit the cookie); verify adapter's error path calls `clearPendingVerifier`.

## Error Handling

| Error Scenario                                                    | Handling Strategy                                                                                                 |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `storage.getCookie` returns null when verifier cookie expected    | Throw `PKCECookieMissingError` (existing behavior, now triggered inside `handleCallback` instead of the adapter). |
| Two `Set-Cookie` emissions on success but adapter collapses them  | Contract-level test catches at the adapter layer (Phases 2 & 3), not at the library. Library emits correctly.     |
| Per-call `redirectUri` override at sign-in, default path at clear | `redirectUri` stored in sealed PKCE state; `handleCallback` recovers it so the clear's path matches. No orphan.   |

## Validation Commands

```bash
# Type checking
pnpm run typecheck

# Linting
pnpm run lint

# Format
pnpm run format:check

# Unit tests
pnpm test

# Watch mode during dev
pnpm test:watch
```

## Rollout Considerations

- **Feature flag**: None.
- **Monitoring**: None — library does not emit telemetry.
- **Rollback plan**: Revert the phase-1 commit range. Phase 2 and 3 (adapters) must land as a coordinated set; if lib rolls back, adapters roll back too.

## Open Items

- [ ] Confirm export order in `src/index.ts` preserves alphabetical grouping after removals.
- [ ] Decide whether `MIGRATION.md` covers direct-consumer migration AND adapter-consumer migration in one file, or splits them.
