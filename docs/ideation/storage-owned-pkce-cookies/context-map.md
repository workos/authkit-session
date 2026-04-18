# Context Map — Phase 1: Storage-Owned PKCE Cookies

## Dimensions

| Dimension                   | Score (1–5) | Rationale                                                                                                                                                                                                                           |
| --------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pattern clarity**         | 5           | Spec cites exact files + line numbers for every change. Existing `saveSession`/`clearSession` shape is the literal template for new `setCookie`/`clearCookie`.                                                                      |
| **Codebase familiarity**    | 5           | Small, focused lib (~14 spec files, 203 tests). All affected files read in full; naming, imports, error hierarchy, and test style are consistent.                                                                                   |
| **Dependencies understood** | 4           | Internal consumers of renamed symbols fully mapped (AuthService, AuthOperations, factory + their specs, pkce spec). Cross-repo adapters (tanstack, sveltekit) are out of scope for Phase 1 but must tolerate changes in Phases 2/3. |
| **Test coverage**           | 5           | Vitest watch mode, globals enabled, `src/**/*.spec.ts` glob, 80% threshold. Every target file already has a spec. Round-trip seal/unseal tests, TTL/skew, Safari SameSite — mature harness.                                         |
| **Risk level**              | 3           | Breaking API rename + signature changes land together. Multi-`Set-Cookie` via `string[]` is library-only (adapter work deferred). The redirectUri-in-sealed-state change crosses seal/unseal boundary — needs careful ordering.     |

## Key Patterns

- **`src/core/session/types.ts:77-106`** — Existing `SessionStorage<TRequest, TResponse, TOptions>` interface. Template for adding `getCookie`/`setCookie`/`clearCookie`. `HeadersBag` already `Record<string, string | string[]>` at line 75.
- **`src/core/session/CookieSessionStorage.ts:50-93`** — `applyHeaders` (protected no-op override point), `buildSetCookie(value, expired?)` (reads instance `cookieName`/`cookieOptions`), `saveSession`/`clearSession` emit `{ response? } | { headers }`. Rename `buildSetCookie` → `serializeCookie(name, value, options, { expired? })`; parameterize.
- **`src/service/AuthService.ts:187-232`** — Current `getAuthorizationUrl`/`getSignInUrl`/`getSignUpUrl` + `getPKCECookieOptions` + `buildPKCEDeleteCookieHeader`. All get renamed/collapsed; the latter two deleted.
- **`src/service/AuthService.ts:252-293`** — `handleCallback` currently takes `cookieValue` in options; reads only session; returns `{ response, headers, returnPathname, state, authResponse }`. After: read verifier via `storage.getCookie`, emit two Set-Cookies, add `mergeHeaderBags` helper (new private util, concat `Set-Cookie` into `string[]`).
- **`src/core/pkce/state.ts:31-37`** — `StateSchema` valibot object. Add `redirectUri: v.optional(v.string())`. `PKCEStateInput = Omit<PKCEState, 'issuedAt'>` auto-picks it up.
- **`src/core/pkce/cookieOptions.ts:19-52`** — `getPKCECookieOptions(config, redirectUri?)` already resolves redirectUri-or-config fallback. Stays internal.
- **`src/core/pkce/generateAuthorizationUrl.ts`** — Drop `cookieOptions` from return. Pass `options.redirectUri` into `sealState` only when caller overrode it.
- **`src/core/AuthKitCore.ts:172-202`** — `verifyCallbackState` signature unchanged per spec. Returns unsealed `PKCEState` — will now include optional `redirectUri` thanks to schema extension.

## Dependencies (Consumers of Renamed/Removed Symbols)

Within `authkit-session/src`:

| Symbol                                                   | Consumers                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getAuthorizationUrl`                                    | `AuthService.ts:190`, `AuthOperations.ts:137`, `factory.ts:75`, `AuthService.spec.ts:205/290/315/336/373`, `AuthOperations.spec.ts:245/256/265/272/286/299/314/322/323`, `factory.spec.ts:43`, `generateAuthorizationUrl.ts:38` (WorkOS SDK call — leave), `client/types.ts:3` (WorkOS client type — leave) |
| `getSignInUrl`                                           | `AuthService.ts:199`, `AuthOperations.ts:151`, `factory.ts:76`, `AuthService.spec.ts:222`, `AuthOperations.spec.ts:331`, `factory.spec.ts:44`                                                                                                                                                               |
| `getSignUpUrl`                                           | `AuthService.ts:208`, `AuthOperations.ts:163`, `factory.ts:77`, `AuthService.spec.ts:237`, `AuthOperations.spec.ts:339`, `factory.spec.ts:45`                                                                                                                                                               |
| `buildPKCEDeleteCookieHeader`                            | `AuthService.ts:226`, `factory.ts:80-81`, `AuthService.spec.ts:263`, `factory.spec.ts:47`                                                                                                                                                                                                                   |
| `serializePKCESetCookie`                                 | `AuthService.ts:6,227`, `cookieOptions.ts:63` (definition), `cookieOptions.spec.ts:4,188/199/205/216/226/236`, `pkce/index.ts:4`, `index.ts:79`                                                                                                                                                             |
| `PKCE_COOKIE_NAME`                                       | `cookieOptions.ts:3,44`, `pkce/index.ts:1`, `constants.ts:1`, `index.ts:76`                                                                                                                                                                                                                                 |
| `getPKCECookieOptions`                                   | `AuthService.ts:5,217-218,228`, `factory.ts:78-79`, `generateAuthorizationUrl.ts:8,54`, `cookieOptions.spec.ts` (many), `pkce/index.ts:3`, `index.ts:78`, `AuthService.spec.ts:245/255`                                                                                                                     |
| `cookieValue`                                            | `AuthService.ts:258,264`, `AuthService.spec.ts:298/323/342/359/380`, `AuthKitCore.ts:174,176,183,189,200` (keep; function signature unchanged), `AuthKitCore.spec.ts:351/360/367` (keep), `pkce.spec.ts:59/80/105/122/130/142/153/179/208`                                                                  |
| `GetAuthorizationUrlResult.sealedState`/`.cookieOptions` | `types.ts:156-160`, `AuthService.spec.ts:290/315/336/373` (destructure `sealedState`), `AuthOperations.spec.ts:249-252/261/278/292/306`, `pkce.spec.ts:47/71/88/112/132/160/166/195`                                                                                                                        |

External consumers of public `index.ts` exports live in adapter repos (Phases 2 and 3) — out of scope here.

## Conventions

- **Imports**: Always `.js` extensions (ESM); relative paths; `import type` used consistently for type-only.
- **File layout**: Each module sits alongside its `.spec.ts`. `src/core/` for pure logic, `src/service/` for framework-generic facade, `src/operations/` for WorkOS API orchestration.
- **Naming**: `class PascalCase`; methods `camelCase`; internal helpers prefixed by domain.
- **Errors**: Extend `AuthKitError` in `src/core/errors.ts`; each subclass sets `this.name`. No new errors required.
- **Types**: Strict TS. Generics ride on `TRequest`/`TResponse`/`TOptions=unknown`. Public types exported via `export *` from `src/index.ts`.
- **Testing**: Vitest with `globals: true` (no import of `describe`/`it`). Mock shape is object literals cast `as any`. Coverage thresholds 80%.
- **Formatting/lint**: `oxfmt` + `oxlint`.

## Risks

1. **Ordering between rename and signature change** — implement `CookieSessionStorage` primitives first (additive), then AuthService methods, then flip call sites. Test file rewrites happen last.
2. **`mergeHeaderBags` subtlety** — must handle all 4 shape combos (string+string, string+string[], string[]+string, string[]+string[]) and shallow-merge other keys.
3. **`redirectUri` in sealed state + clear-path symmetry** — `generateAuthorizationUrl` must only stamp when caller overrode; `handleCallback` passes `unsealed.redirectUri` directly to `getPKCECookieOptions(config, redirectUri)` which already falls back on undefined.
4. **`factory.ts` proxy shape** — factory manually lists every delegated method. `factory.spec.ts:43-49` is the safety net — must be updated in lock-step.
5. **Optional field forward-compat** — adding `redirectUri?` to `StateSchema` is backward-compat for unseal.
6. **`CookieOptions` duplication** — defined in both `src/core/session/types.ts:162-172` AND `src/core/session/CookieSessionStorage.ts:4-14`. Pick canonical location (types.ts is public).
7. **`cookieValue` stays in `AuthKitCore.verifyCallbackState`** — that signature does not change. Only `AuthService.handleCallback` drops the param.
8. **Package version** — `package.json:3` still shows `0.3.4`. Phase 1 must bump to `0.4.0`.

## Test Infrastructure

- `vitest.config.ts` — `include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts']`, `environment: 'node'`, `globals: true`.
- `pnpm test` = `vitest --run`; `pnpm test:watch` = `vitest --watch` (inner loop per spec).

**Verdict**: GO
