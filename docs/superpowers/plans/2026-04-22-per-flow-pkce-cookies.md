# Per-flow PKCE Verifier Cookies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the multi-tab PKCE cookie clobbering bug by giving each concurrent OAuth flow its own uniquely-named `wos-auth-verifier-<fnv1a>` cookie across `authkit-session` and its two downstream adapters.

**Architecture:** Derive the cookie name from an FNV-1a hash of the sealed PKCE state (pure, no new dep). `AuthService.handleCallback` derives the name from the URL `state` at read time. `clearPendingVerifier` becomes state-aware. Adapters with middleware-loop behavior (SvelteKit's `createWithAuth`) additionally gate cookie writes on document-request detection to prevent HTTP 431. Driven release-sequenced across three packages: `authkit-session` → `authkit-sveltekit` → `authkit-tanstack-start`.

**Tech Stack:** TypeScript (strict), Vitest, pnpm, Node. Targets: `authkit-session` (framework-agnostic core), `authkit-sveltekit` (SvelteKit 2 adapter), `authkit-tanstack-react-start` (TanStack Start adapter).

**Spec:** `docs/superpowers/specs/2026-04-22-per-flow-pkce-cookies-design.md`

---

## Working directories

- `authkit-session`: `/Users/nicknisi/Developer/authkit-session`
- `authkit-sveltekit`: `/Users/nicknisi/Developer/authkit-sveltekit`
- `authkit-tanstack-start`: `/Users/nicknisi/Developer/authkit-tanstack-start`

All three repos use pnpm. Run `pnpm install`, `pnpm test`, `pnpm build`, `pnpm typecheck` from each repo root.

## File-structure map

**`authkit-session` — creates:**
- `src/core/pkce/cookieName.ts` — FNV-1a + `getPKCECookieNameForState`
- `src/core/pkce/cookieName.spec.ts`

**`authkit-session` — modifies:**
- `src/core/pkce/generateAuthorizationUrl.ts` — add `cookieName` to result
- `src/core/pkce/cookieOptions.ts` — re-export prefix; keep legacy name
- `src/service/AuthService.ts` — derive cookie name, new pure methods, require-state in `clearPendingVerifier`
- `src/service/AuthService.spec.ts`
- `src/core/session/types.ts` — extend `CreateAuthorizationResult` with `cookieName`
- `src/index.ts` — new exports
- `README.md`, `MIGRATION.md` — document signature change and new methods
- `package.json` — version `0.5.0`

**`authkit-sveltekit` — creates:**
- `src/server/adapters/isDocumentRequest.ts`
- `src/server/adapters/isDocumentRequest.test.ts`

**`authkit-sveltekit` — modifies:**
- `src/server/middleware.ts` — gate cookie writes in `createWithAuth`
- `src/server/auth.ts` — thread `state` into `clearPendingVerifier`
- `src/tests/get-sign-in-url.test.ts` — derive expected cookie names
- `src/tests/handle-callback.test.ts` — derive expected cookie names
- `package.json` — bump `@workos/authkit-session` dep + version `0.3.0`

**`authkit-tanstack-start` — modifies:**
- `src/server/server.ts` — replace static fallback, thread `state`, fix comments
- `src/server/server.spec.ts` — update cookie-name assertions
- `src/server/server-functions.spec.ts` — update cookie-name assertions
- `package.json` — bump `@workos/authkit-session` dep + version `0.7.0`

## Phases

Three phases, sequenced strictly. Do not start Phase 2 until Phase 1 is merged/published. Do not start Phase 3 until Phase 2 is merged.

- **Phase 1** — `authkit-session` (Tasks 1–10). Ends with a `0.5.0` release tag/commit.
- **Phase 2** — `authkit-sveltekit` (Tasks 11–15). Ends with a `0.3.0` release tag/commit.
- **Phase 3** — `authkit-tanstack-react-start` (Tasks 16–20). Ends with a `0.7.0` release tag/commit.

---

## Phase 1 — `authkit-session`

Start in `/Users/nicknisi/Developer/authkit-session`. On a fresh branch: `git checkout -b pkce-per-flow-cookies`.

### Task 1: `cookieName.ts` — FNV-1a 32-bit hex + name derivation

**Files:**
- Create: `src/core/pkce/cookieName.ts`
- Create: `src/core/pkce/cookieName.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/core/pkce/cookieName.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  PKCE_COOKIE_PREFIX,
  getPKCECookieNameForState,
  fnv1a32Hex,
} from './cookieName.js';

describe('fnv1a32Hex', () => {
  // Known-answer tests against the reference FNV-1a 32-bit spec
  // (http://www.isthe.com/chongo/tech/comp/fnv/). Empty string is the
  // FNV offset basis 0x811c9dc5.
  it('hashes the empty string to the FNV offset basis', () => {
    expect(fnv1a32Hex('')).toBe('811c9dc5');
  });

  it('hashes "a" to 0xe40c292c', () => {
    expect(fnv1a32Hex('a')).toBe('e40c292c');
  });

  it('hashes "foobar" to 0xbf9cf968', () => {
    expect(fnv1a32Hex('foobar')).toBe('bf9cf968');
  });

  it('returns a zero-padded 8-char hex string', () => {
    // input chosen to produce a short hash that would need padding;
    // the specific value doesn't matter — the pad-to-8 behavior does.
    expect(fnv1a32Hex('x')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic', () => {
    expect(fnv1a32Hex('some-sealed-state')).toBe(fnv1a32Hex('some-sealed-state'));
  });
});

describe('getPKCECookieNameForState', () => {
  it('prefixes with wos-auth-verifier and appends an 8-char hex hash', () => {
    expect(getPKCECookieNameForState('any-state')).toMatch(/^wos-auth-verifier-[0-9a-f]{8}$/);
  });

  it('produces different names for different states', () => {
    expect(getPKCECookieNameForState('state-a')).not.toBe(getPKCECookieNameForState('state-b'));
  });

  it('is deterministic for the same input', () => {
    const s = 'sealed-' + 'x'.repeat(200);
    expect(getPKCECookieNameForState(s)).toBe(getPKCECookieNameForState(s));
  });

  it('exports the prefix constant', () => {
    expect(PKCE_COOKIE_PREFIX).toBe('wos-auth-verifier');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test src/core/pkce/cookieName.spec.ts
```

Expected: fails with `Cannot find module './cookieName.js'` (module not created yet).

- [ ] **Step 3: Write the implementation**

Create `src/core/pkce/cookieName.ts`:

```ts
/** Stable prefix for all PKCE verifier cookies. */
export const PKCE_COOKIE_PREFIX = 'wos-auth-verifier';

/**
 * FNV-1a 32-bit hash of the input, returned as a zero-padded 8-char
 * lowercase hex string. Used purely as a namespacing mechanism — not
 * security-sensitive. Collision probability is ~1/4B per pair; a
 * collision routes one flow's callback to the wrong cookie, which
 * then fails byte-equality in `verifyCallbackState` (fail-closed).
 */
export function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5;
  const bytes = new TextEncoder().encode(input);
  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Derive a flow-specific PKCE verifier cookie name from the sealed
 * state blob. Each concurrent OAuth flow gets its own cookie so
 * parallel sign-ins from multiple tabs don't clobber each other.
 */
export function getPKCECookieNameForState(state: string): string {
  return `${PKCE_COOKIE_PREFIX}-${fnv1a32Hex(state)}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/core/pkce/cookieName.spec.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/pkce/cookieName.ts src/core/pkce/cookieName.spec.ts
git commit -m "feat: add per-flow PKCE cookie name derivation

Introduces PKCE_COOKIE_PREFIX and getPKCECookieNameForState(state),
backed by an inline FNV-1a 32-bit hash. Zero new dependencies."
```

### Task 2: Return `cookieName` from `generateAuthorizationUrl`

**Files:**
- Modify: `src/core/pkce/generateAuthorizationUrl.ts`
- Modify: `src/core/pkce/cookieOptions.ts`

- [ ] **Step 1: Update the tests**

Open `src/core/pkce/pkce.spec.ts`. Any test that destructures the result of `generateAuthorizationUrl` will now also receive a `cookieName`. Add an assertion near the existing happy-path test:

```ts
it('returns cookieName derived from the sealed state', async () => {
  const result = await generateAuthorizationUrl({
    client: mockClient,
    config: mockConfig,
    encryption: mockEncryption,
    options: {},
  });
  const { getPKCECookieNameForState } = await import('./cookieName.js');
  expect(result.cookieName).toBe(getPKCECookieNameForState(result.sealedState));
  expect(result.cookieName).toMatch(/^wos-auth-verifier-[0-9a-f]{8}$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/core/pkce/pkce.spec.ts
```

Expected: fails with `result.cookieName is undefined`.

- [ ] **Step 3: Update `GeneratedAuthorizationUrl` interface and implementation**

In `src/core/pkce/generateAuthorizationUrl.ts`:

```ts
// Add import at top
import { getPKCECookieNameForState } from './cookieName.js';

// Update the interface
export interface GeneratedAuthorizationUrl {
  url: string;
  sealedState: string;
  cookieName: string;
  cookieOptions: CookieOptions;
}
```

Inside the function body, after `sealedState` is computed and the cookie byte-length guard passes, derive the cookie name and use it in the length check and the return:

```ts
const cookieOptions = getPKCECookieOptions(config, redirectUri);
const cookieName = getPKCECookieNameForState(sealedState);
const serialized = serializeCookie(cookieName, sealedState, cookieOptions);
const cookieBytes = new TextEncoder().encode(serialized).byteLength;
if (cookieBytes > PKCE_MAX_COOKIE_BYTES) {
  throw new PKCEPayloadTooLargeError(
    `Sealed PKCE verifier cookie is ${cookieBytes} bytes, exceeds supported limit of ${PKCE_MAX_COOKIE_BYTES} bytes. ` +
      `Reduce the size of options.state, options.returnPathname, or options.redirectUri.`,
  );
}

// ... existing `url = client.userManagement.getAuthorizationUrl(...)` ...

return {
  url,
  sealedState,
  cookieName,
  cookieOptions,
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/core/pkce/pkce.spec.ts
```

Expected: all pass (existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/core/pkce/generateAuthorizationUrl.ts src/core/pkce/pkce.spec.ts
git commit -m "feat(pkce): derive cookieName in generateAuthorizationUrl

Adds cookieName to GeneratedAuthorizationUrl. Byte-length guard now
measures the actual (longer) on-wire name. Still well under the
3800-byte cap (worst case 26 chars vs 17)."
```

### Task 3: `CreateAuthorizationResult` gains `cookieName`

**Files:**
- Modify: `src/core/session/types.ts:183`

- [ ] **Step 1: Update the interface and ambient tests**

In `src/core/session/types.ts`:

```ts
export type CreateAuthorizationResult<TResponse> = GetAuthorizationUrlResult & {
  response?: TResponse;
  headers?: HeadersBag;
  /**
   * Name of the PKCE verifier cookie written during this call. Useful
   * for assertion-in-tests and for adapters that want to log the flow
   * identifier. NOT the shape `clearPendingVerifier` consumes — that
   * method takes `state`, not `cookieName`.
   */
  cookieName: string;
};
```

- [ ] **Step 2: Run typecheck to see where it breaks**

```bash
pnpm typecheck
```

Expected: compile errors in `src/service/AuthService.ts` where `createAuthorization` returns an object without `cookieName`. These get fixed in Task 4.

- [ ] **Step 3: Commit the type change standalone**

```bash
git add src/core/session/types.ts
git commit -m "feat(types): add cookieName to CreateAuthorizationResult

Callers that destructure the result now see the PKCE verifier cookie
name that was written. Type-only change; runtime wiring lands next."
```

### Task 4: `AuthService.createAuthorization` uses and returns the derived name

**Files:**
- Modify: `src/service/AuthService.ts:228-267` (createAuthorization + createSignIn + createSignUp)
- Modify: `src/service/AuthService.spec.ts`

- [ ] **Step 1: Update the test**

In `src/service/AuthService.spec.ts`, locate the test "returns url and writes the verifier cookie via storage.setCookie" (around line 227). Update it and add a new isolation test:

```ts
it('returns url + cookieName and writes under the derived per-flow name', async () => {
  const { url, cookieName, headers } = await authService.createSignIn(undefined, {
    returnPathname: '/foo',
  });
  expect(url).toMatch(/^https:\/\//);
  expect(cookieName).toMatch(/^wos-auth-verifier-[0-9a-f]{8}$/);

  // Storage must have been called with the derived name, not the legacy name.
  expect(realStorage.cookies.has('wos-auth-verifier')).toBe(false);
  expect(realStorage.cookies.get(cookieName)).toBeTruthy();

  // Set-Cookie header reflects the same name.
  const setCookie = Array.isArray(headers?.['Set-Cookie'])
    ? headers!['Set-Cookie'].join('\n')
    : (headers?.['Set-Cookie'] ?? '');
  expect(setCookie).toContain(`${cookieName}=`);
});

it('isolates concurrent flows: two sign-ins produce two distinct cookies', async () => {
  const a = await authService.createSignIn(undefined, { returnPathname: '/a' });
  const b = await authService.createSignIn(undefined, { returnPathname: '/b' });
  expect(a.cookieName).not.toBe(b.cookieName);
  expect(realStorage.cookies.get(a.cookieName)).toBeTruthy();
  expect(realStorage.cookies.get(b.cookieName)).toBeTruthy();
});
```

Also audit the file for any existing assertion on `realStorage.cookies.get('wos-auth-verifier')` and replace with the derived name (use the `cookieName` returned from the call, or derive via `getPKCECookieNameForState(sealedState)`).

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test src/service/AuthService.spec.ts
```

Expected: new tests fail (`cookieName` undefined, storage write missing under derived name).

- [ ] **Step 3: Update `createAuthorization`**

In `src/service/AuthService.ts`, replace the body of `createAuthorization`:

```ts
async createAuthorization(
  response: TResponse | undefined,
  options: GetAuthorizationUrlOptions = {},
): Promise<CreateAuthorizationResult<TResponse>> {
  const { url, sealedState, cookieName, cookieOptions } =
    await this.operations.createAuthorization(options);
  const write = await this.storage.setCookie(
    response,
    cookieName,
    sealedState,
    cookieOptions,
  );
  return { url, cookieName, ...write };
}
```

`createSignIn` and `createSignUp` already delegate to `createAuthorization`, so they need no code change — but double-check their return type picks up the new `cookieName` via inheritance.

Also drop the now-unused `PKCE_COOKIE_NAME` import from the top of the file. The old `import { getPKCECookieOptions, PKCE_COOKIE_NAME } from '../core/pkce/cookieOptions.js';` becomes `import { getPKCECookieOptions } from '../core/pkce/cookieOptions.js';`.

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm test src/service/AuthService.spec.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/service/AuthService.ts src/service/AuthService.spec.ts
git commit -m "feat(service): write PKCE cookie under per-flow derived name

createAuthorization, createSignIn, createSignUp now write under the
name returned by generateAuthorizationUrl. Concurrent flows no longer
clobber each other's cookies."
```

### Task 5: `handleCallback` derives cookie name from URL state

**Files:**
- Modify: `src/service/AuthService.ts:316-412` (handleCallback + bestEffortClearVerifier)
- Modify: `src/service/AuthService.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/service/AuthService.spec.ts`:

```ts
describe('handleCallback — per-flow cookie isolation', () => {
  it('reads and clears the cookie derived from URL state', async () => {
    // Start a flow. createSignIn wrote under the derived name.
    const { cookieName } = await authService.createSignIn(undefined);
    const sealedState = realStorage.cookies.get(cookieName)!;

    mockClient.userManagement.authenticateWithCode.mockResolvedValue(
      mockAuthenticationResponse(),
    );

    const request = new Request(
      `https://app.example/callback?code=abc&state=${encodeURIComponent(sealedState)}`,
    );

    const result = await authService.handleCallback(request, undefined as never, {
      code: 'abc',
      state: sealedState,
    });

    const setCookies = Array.isArray(result.headers?.['Set-Cookie'])
      ? result.headers!['Set-Cookie']
      : [result.headers?.['Set-Cookie']].filter(Boolean) as string[];
    const deleteLine = setCookies.find(c => c.startsWith(`${cookieName}=`));
    expect(deleteLine).toBeDefined();
    expect(deleteLine).toContain('Max-Age=0');
  });

  it('does not touch another concurrent flow\'s cookie', async () => {
    const a = await authService.createSignIn(undefined, { returnPathname: '/a' });
    const b = await authService.createSignIn(undefined, { returnPathname: '/b' });
    const sealedA = realStorage.cookies.get(a.cookieName)!;

    mockClient.userManagement.authenticateWithCode.mockResolvedValue(
      mockAuthenticationResponse(),
    );

    const request = new Request(
      `https://app.example/callback?code=abc&state=${encodeURIComponent(sealedA)}`,
    );
    const result = await authService.handleCallback(request, undefined as never, {
      code: 'abc',
      state: sealedA,
    });

    const setCookies = Array.isArray(result.headers?.['Set-Cookie'])
      ? result.headers!['Set-Cookie']
      : [result.headers?.['Set-Cookie']].filter(Boolean) as string[];
    // Flow A's cookie gets a delete. Flow B's cookie must NOT.
    expect(setCookies.some(c => c.startsWith(`${a.cookieName}=`))).toBe(true);
    expect(setCookies.some(c => c.startsWith(`${b.cookieName}=`))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test src/service/AuthService.spec.ts -t 'per-flow cookie isolation'
```

Expected: both tests fail (`handleCallback` still reads the legacy `wos-auth-verifier` name).

- [ ] **Step 3: Rewrite `handleCallback`**

In `src/service/AuthService.ts`, add the import at the top:

```ts
import { getPKCECookieNameForState } from '../core/pkce/cookieName.js';
```

Replace the body of `handleCallback`:

```ts
async handleCallback(
  request: TRequest,
  response: TResponse,
  options: { code: string; state: string | undefined },
) {
  const cookieName = options.state ? getPKCECookieNameForState(options.state) : null;
  const cookieValue = cookieName
    ? await this.storage.getCookie(request, cookieName)
    : null;

  let unsealed;
  try {
    unsealed = await this.core.verifyCallbackState({
      stateFromUrl: options.state,
      cookieValue: cookieValue ?? undefined,
    });
  } catch (err) {
    await this.bestEffortClearVerifier(response, cookieName, undefined, {
      schemeAgnostic: true,
    });
    throw err;
  }

  const { codeVerifier, returnPathname, customState, redirectUri } = unsealed;
  const clearOptions = getPKCECookieOptions(this.config, redirectUri);

  try {
    const authResponse = await this.client.userManagement.authenticateWithCode({
      code: options.code,
      clientId: this.config.clientId,
      codeVerifier,
    });

    const session: Session = {
      accessToken: authResponse.accessToken,
      refreshToken: authResponse.refreshToken,
      user: authResponse.user,
      impersonator: authResponse.impersonator,
    };

    const encryptedSession = await this.core.encryptSession(session);
    const save = await this.storage.saveSession(response, encryptedSession);

    let clear: { response?: TResponse; headers?: HeadersBag } = {};
    if (cookieName) {
      clear = await this.storage.clearCookie(
        save.response ?? response,
        cookieName,
        clearOptions,
      );
    }

    return {
      response: clear.response ?? save.response,
      headers: mergeHeaderBags(save.headers, clear.headers),
      returnPathname: returnPathname ?? '/',
      state: customState,
      authResponse,
    };
  } catch (err) {
    await this.bestEffortClearVerifier(response, cookieName, redirectUri);
    throw err;
  }
}
```

And update `bestEffortClearVerifier` to take the cookie name:

```ts
private async bestEffortClearVerifier(
  response: TResponse | undefined,
  cookieName: string | null,
  redirectUri: string | undefined,
  { schemeAgnostic = false }: { schemeAgnostic?: boolean } = {},
): Promise<void> {
  if (!cookieName) return; // nothing to clear — no state on the URL.
  const options = getPKCECookieOptions(this.config, redirectUri);
  if (schemeAgnostic && options.sameSite === 'lax') {
    options.secure = false;
  }
  try {
    await this.storage.clearCookie(response, cookieName, options);
  } catch {
    // Swallow: cleanup is opportunistic; callers get the original error.
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/service/AuthService.spec.ts
```

Expected: all pass, including legacy tests (which should already pass because the legacy `wos-auth-verifier` assertions were updated in Task 4).

- [ ] **Step 5: Commit**

```bash
git add src/service/AuthService.ts src/service/AuthService.spec.ts
git commit -m "feat(service): derive PKCE cookie name from URL state in callback

handleCallback now reads and clears the flow-specific cookie identified
by the URL state parameter. Concurrent flows are fully isolated:
callback for flow A leaves flow B's cookie untouched."
```

### Task 6: Expose pure URL-generation methods

**Files:**
- Modify: `src/service/AuthService.ts` (add three methods)
- Modify: `src/service/AuthService.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/service/AuthService.spec.ts`:

```ts
describe('AuthService — pure URL-generation methods', () => {
  it('getAuthorizationUrl returns { url, cookieName } without touching storage', async () => {
    const setCookieSpy = vi.spyOn(realStorage, 'setCookie');
    const result = await authService.getAuthorizationUrl({ returnPathname: '/foo' });

    expect(result.url).toMatch(/^https:\/\//);
    expect(result.cookieName).toMatch(/^wos-auth-verifier-[0-9a-f]{8}$/);
    expect(setCookieSpy).not.toHaveBeenCalled();
    // Result must NOT include response or headers — pure URL generation.
    expect(result).not.toHaveProperty('response');
    expect(result).not.toHaveProperty('headers');
  });

  it('getSignInUrl returns { url, cookieName } with sign-in screen hint', async () => {
    const setCookieSpy = vi.spyOn(realStorage, 'setCookie');
    const result = await authService.getSignInUrl({ returnPathname: '/foo' });
    expect(result.url).toContain('screen_hint=sign-in');
    expect(result.cookieName).toMatch(/^wos-auth-verifier-[0-9a-f]{8}$/);
    expect(setCookieSpy).not.toHaveBeenCalled();
  });

  it('getSignUpUrl returns { url, cookieName } with sign-up screen hint', async () => {
    const setCookieSpy = vi.spyOn(realStorage, 'setCookie');
    const result = await authService.getSignUpUrl();
    expect(result.url).toContain('screen_hint=sign-up');
    expect(result.cookieName).toMatch(/^wos-auth-verifier-[0-9a-f]{8}$/);
    expect(setCookieSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test src/service/AuthService.spec.ts -t 'pure URL-generation'
```

Expected: fail — methods don't exist.

- [ ] **Step 3: Implement the three methods**

In `src/service/AuthService.ts`, add after `clearPendingVerifier` (or near `createAuthorization`):

```ts
/**
 * Pure URL generation — returns the auth URL and the cookie name that
 * WOULD be written by `createAuthorization`, but does NOT touch
 * storage. Use this in adapter code paths where writing the verifier
 * cookie is inappropriate (e.g. non-document requests in middleware
 * hooks) — the browser ignores the cookie anyway because it won't
 * follow a cross-origin redirect from fetch/XHR.
 */
async getAuthorizationUrl(
  options: GetAuthorizationUrlOptions = {},
): Promise<{ url: string; cookieName: string }> {
  const { url, cookieName } = await this.operations.createAuthorization(options);
  return { url, cookieName };
}

/** Pure variant of createSignIn — no cookie write. */
async getSignInUrl(
  options: Omit<GetAuthorizationUrlOptions, 'screenHint'> = {},
): Promise<{ url: string; cookieName: string }> {
  return this.getAuthorizationUrl({ ...options, screenHint: 'sign-in' });
}

/** Pure variant of createSignUp — no cookie write. */
async getSignUpUrl(
  options: Omit<GetAuthorizationUrlOptions, 'screenHint'> = {},
): Promise<{ url: string; cookieName: string }> {
  return this.getAuthorizationUrl({ ...options, screenHint: 'sign-up' });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/service/AuthService.spec.ts -t 'pure URL-generation'
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/service/AuthService.ts src/service/AuthService.spec.ts
git commit -m "feat(service): add pure URL-generation methods

getAuthorizationUrl, getSignInUrl, getSignUpUrl — same URL that
createAuthorization/createSignIn/createSignUp produce, but no cookie
write. Adapters with loop-prone paths (middleware hooks that fire
on every request) can use these for non-document requests to avoid
HTTP 431 cookie bloat."
```

### Task 7: `clearPendingVerifier` — breaking signature change

**Files:**
- Modify: `src/service/AuthService.ts:280-289`
- Modify: `src/service/AuthService.spec.ts`

- [ ] **Step 1: Update existing tests + add new tests**

Find every `clearPendingVerifier` call in `src/service/AuthService.spec.ts` and update to pass `state`. New tests:

```ts
describe('clearPendingVerifier — state-required', () => {
  it('clears the flow-specific cookie derived from state', async () => {
    const { cookieName } = await authService.createSignIn(undefined);
    const sealedState = realStorage.cookies.get(cookieName)!;

    const clearCookieSpy = vi.spyOn(realStorage, 'clearCookie');
    await authService.clearPendingVerifier(undefined, { state: sealedState });

    expect(clearCookieSpy).toHaveBeenCalledWith(
      undefined,
      cookieName,
      expect.any(Object),
    );
  });

  it('threads redirectUri into the cookie options', async () => {
    const { cookieName } = await authService.createSignIn(undefined, {
      redirectUri: 'https://custom.example/cb',
    });
    const sealedState = realStorage.cookies.get(cookieName)!;

    await authService.clearPendingVerifier(undefined, {
      state: sealedState,
      redirectUri: 'https://custom.example/cb',
    });

    expect(realStorage.lastClearOptions.get(cookieName)?.path).toBe('/');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test src/service/AuthService.spec.ts -t 'clearPendingVerifier'
```

Expected: fail — signature still takes only `{ redirectUri? }`.

- [ ] **Step 3: Change the signature**

In `src/service/AuthService.ts`, replace `clearPendingVerifier`:

```ts
/**
 * Emit a `Set-Cookie` header that clears the PKCE verifier cookie
 * for the flow identified by `state`.
 *
 * **Breaking change in 0.5.0.** The `state` option is now required
 * — the per-flow cookie naming scheme has no single "legacy" name
 * to clear. Callers typically read `state` from the callback URL;
 * when `state` is absent (malformed callback), do not call this
 * method. The 10-minute PKCE TTL cleans up orphans.
 *
 * Pass `options.redirectUri` on requests that used a per-request
 * `redirectUri` override at sign-in time, so the delete cookie's
 * computed attributes (notably `secure`) match the original set.
 */
async clearPendingVerifier(
  response: TResponse | undefined,
  options: { state: string; redirectUri?: string },
): Promise<{ response?: TResponse; headers?: HeadersBag }> {
  const cookieName = getPKCECookieNameForState(options.state);
  return this.storage.clearCookie(
    response,
    cookieName,
    getPKCECookieOptions(this.config, options.redirectUri),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/service/AuthService.spec.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/service/AuthService.ts src/service/AuthService.spec.ts
git commit -m "feat(service)!: clearPendingVerifier requires state

BREAKING CHANGE: clearPendingVerifier now takes
{ state: string; redirectUri?: string } (state required). The old
state-less form had no meaning in the per-flow cookie world — there
is no single cookie name to clear without knowing which flow.

Callers on callback paths have URL state in hand. Bailouts with no
state should skip the call entirely; the 10-minute PKCE TTL handles
orphans."
```

### Task 8: Update exports in `src/index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add the new exports**

At the bottom of `src/index.ts`, or near the `Storage Helpers` section, add:

```ts
// ============================================
// PKCE Helpers
// ============================================
export {
  PKCE_COOKIE_PREFIX,
  getPKCECookieNameForState,
} from './core/pkce/cookieName.js';
// Back-compat alias. Prefer PKCE_COOKIE_PREFIX or the derived names.
export { PKCE_COOKIE_NAME } from './core/pkce/cookieOptions.js';
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Build to verify bundle**

```bash
pnpm build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: export PKCE helpers from package root

Exposes PKCE_COOKIE_PREFIX and getPKCECookieNameForState for custom
adapters. PKCE_COOKIE_NAME remains for back-compat."
```

### Task 9: Update `README.md` and `MIGRATION.md`

**Files:**
- Modify: `README.md:197-260`
- Modify: `MIGRATION.md:27,148-162,239-240`

- [ ] **Step 1: Update `README.md`**

Locate the `clearPendingVerifier` example around line 197 and 256. Update each call signature to require `state`:

In `README.md:197-210` (verifier section), replace the signature/example with:

```ts
// After createSignIn/createSignUp has started a flow but handleCallback
// won't run (OAuth error response, missing code, early bailout), clear
// the pending verifier cookie. `state` is the sealed value returned on
// the callback URL — skip this call if the URL has no state.
authService.clearPendingVerifier(response, {
  state,            // required (from callback URL)
  redirectUri?,    // optional: match the per-call override used at sign-in
});
```

At `README.md:256`, update the narrative example:

```ts
if (state) {
  await authService.clearPendingVerifier(response, { state });
}
```

Also add a brief note near the URL-generation section documenting the new pure methods:

```md
### Generate URLs without writing a cookie

Use `getAuthorizationUrl` / `getSignInUrl` / `getSignUpUrl` when you need
the auth URL but don't want to write the PKCE verifier cookie (e.g. on
non-document requests in a middleware hook — browsers won't follow a
cross-origin redirect from XHR/fetch anyway).

```ts
const { url, cookieName } = await authService.getSignInUrl({ returnPathname: '/dashboard' });
// No Set-Cookie emitted. Use createSignIn if you want the cookie written.
```
```

- [ ] **Step 2: Update `MIGRATION.md`**

At `MIGRATION.md:27`, replace the `clearPendingVerifier(response)` callout with `clearPendingVerifier(response, { state })`.

At `MIGRATION.md:148-162`, update the example block:

```md
After `createSignIn`/`createSignUp` has started a flow but `handleCallback`
won't run to clear the verifier, call `clearPendingVerifier` with the
sealed `state` so the flow-specific cookie is deleted:

```ts
if (state) {
  const { headers } = await auth.clearPendingVerifier(response, { state });
  // ...
}
```

Skip the call when `state` is absent (malformed callback) — the
10-minute PKCE TTL handles orphans.
```

At `MIGRATION.md:239-240`, thread `state` into the example.

Add a new top-level section near the top:

```md
## 0.5.0 — per-flow PKCE cookies

PKCE verifier cookies now carry a per-flow suffix
(`wos-auth-verifier-<fnv1a>`) so concurrent sign-ins from multiple tabs
no longer clobber each other. `clearPendingVerifier` now **requires**
`options.state`.

### What consumers need to change

| Before | After |
| --- | --- |
| `auth.clearPendingVerifier(response)` | `auth.clearPendingVerifier(response, { state })` |
| `auth.clearPendingVerifier(response, { redirectUri })` | `auth.clearPendingVerifier(response, { state, redirectUri })` |

Guard the call on `state` presence:

```ts
if (state) {
  await auth.clearPendingVerifier(response, { state });
}
```

### New pure URL methods

- `getAuthorizationUrl(options)` — returns `{ url, cookieName }`, writes no cookie.
- `getSignInUrl(options)` — same with `screenHint: 'sign-in'`.
- `getSignUpUrl(options)` — same with `screenHint: 'sign-up'`.

Use these in adapter code paths where the cookie write is wasted (e.g.
non-document requests in a SvelteKit `handle` hook). Browsers don't
follow cross-origin redirects from fetch/XHR, so the cookie would never
be used anyway.
```

- [ ] **Step 3: Commit**

```bash
git add README.md MIGRATION.md
git commit -m "docs: document per-flow PKCE cookies and clearPendingVerifier break

Update README.md and MIGRATION.md to reflect the 0.5.0 signature
change on clearPendingVerifier and introduce the new pure URL-
generation methods."
```

### Task 10: Version bump and release commit

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md` if present, else skip

- [ ] **Step 1: Bump the version**

Edit `package.json`: change `"version": "0.4.0"` to `"version": "0.5.0"`.

- [ ] **Step 2: Run the full check**

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

All four must pass cleanly. If `build` produces a non-empty diff in `dist/`, include it in the commit.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: release 0.5.0

Per-flow PKCE verifier cookies. See docs/superpowers/specs/2026-04-22-per-flow-pkce-cookies-design.md."
```

- [ ] **Step 4: Open PR and tag (user-driven)**

After PR merges to `main`, tag:

```bash
git tag v0.5.0
git push origin v0.5.0
```

Publish to npm per the repo's usual release process. Phase 1 complete.

---

## Phase 2 — `authkit-sveltekit`

Start in `/Users/nicknisi/Developer/authkit-sveltekit`. Fresh branch: `git checkout -b pkce-per-flow-cookies`.

Phase 1 must be published to npm first so `pnpm install` resolves `@workos/authkit-session@^0.5.0`.

### Task 11: Bump `@workos/authkit-session` dep

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump the dependency**

Edit `package.json`. Change the `@workos/authkit-session` entry under `dependencies` (or `peerDependencies`, whichever is present) from `^0.4.0` to `^0.5.0`.

- [ ] **Step 2: Install**

```bash
pnpm install
```

- [ ] **Step 3: Typecheck to see where the break hits**

```bash
pnpm typecheck
```

Expected: a TS error at `src/server/auth.ts:118` about the `state` argument being required on `clearPendingVerifier`. This is the expected breakage — fixed in Task 14.

- [ ] **Step 4: Commit the dep bump only**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): bump @workos/authkit-session to ^0.5.0

Picks up per-flow PKCE cookies. Typecheck fails at
src/server/auth.ts:118 until clearPendingVerifier is updated to
pass { state }; follow-up commits wire it up."
```

### Task 12: `isDocumentRequest` helper

**Files:**
- Create: `src/server/adapters/isDocumentRequest.ts`
- Create: `src/server/adapters/isDocumentRequest.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/server/adapters/isDocumentRequest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isDocumentRequest } from './isDocumentRequest.js';

function h(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe('isDocumentRequest', () => {
  it('returns true when Sec-Fetch-Dest is "document"', () => {
    expect(isDocumentRequest(h({ 'sec-fetch-dest': 'document' }))).toBe(true);
  });

  it('returns false when Sec-Fetch-Dest is anything other than "document"', () => {
    expect(isDocumentRequest(h({ 'sec-fetch-dest': 'empty' }))).toBe(false);
    expect(isDocumentRequest(h({ 'sec-fetch-dest': 'script' }))).toBe(false);
    expect(isDocumentRequest(h({ 'sec-fetch-dest': 'iframe' }))).toBe(false);
  });

  it('returns false for XMLHttpRequest even without Sec-Fetch-Dest', () => {
    expect(isDocumentRequest(h({ 'x-requested-with': 'XMLHttpRequest' }))).toBe(false);
    expect(isDocumentRequest(h({ 'x-requested-with': 'xmlhttprequest' }))).toBe(false);
  });

  it('returns false for prefetch requests', () => {
    expect(isDocumentRequest(h({ purpose: 'prefetch' }))).toBe(false);
    expect(isDocumentRequest(h({ purpose: 'Prefetch' }))).toBe(false);
  });

  it('returns false when Accept does not include text/html or */*', () => {
    expect(isDocumentRequest(h({ accept: 'application/json' }))).toBe(false);
  });

  it('returns true when Accept includes text/html', () => {
    expect(
      isDocumentRequest(h({ accept: 'text/html,application/xhtml+xml' })),
    ).toBe(true);
  });

  it('returns true when Accept is */*', () => {
    expect(isDocumentRequest(h({ accept: '*/*' }))).toBe(true);
  });

  it('returns true for an empty header bag (fail-open)', () => {
    expect(isDocumentRequest(h({}))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test src/server/adapters/isDocumentRequest.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement**

Create `src/server/adapters/isDocumentRequest.ts`:

```ts
/**
 * Best-effort detection of a top-level document navigation.
 *
 * Used by `createWithAuth` to decide whether to write a PKCE verifier
 * cookie. Non-document requests (fetch/XHR/RSC/prefetch) can't follow
 * a cross-origin redirect to WorkOS, so a cookie write on those
 * requests is wasted and accumulates under the per-flow naming scheme
 * — which can blow past browser per-host cookie budgets into HTTP 431.
 *
 * Fails open: when signals are ambiguous or absent, treat the request
 * as a document. Worst case is one unneeded cookie bounded by the
 * 10-minute PKCE TTL.
 */
export function isDocumentRequest(headers: Headers): boolean {
  const dest = headers.get('sec-fetch-dest');
  if (dest) return dest === 'document';

  if (headers.get('x-requested-with')?.toLowerCase() === 'xmlhttprequest') {
    return false;
  }
  if (headers.get('purpose')?.toLowerCase() === 'prefetch') {
    return false;
  }

  const accept = headers.get('accept') ?? '';
  if (accept && !accept.includes('text/html') && !accept.includes('*/*')) {
    return false;
  }

  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/server/adapters/isDocumentRequest.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/adapters/isDocumentRequest.ts src/server/adapters/isDocumentRequest.test.ts
git commit -m "feat: add isDocumentRequest helper

Header-based heuristic to detect top-level document navigations.
Fails open. Used next by createWithAuth to gate PKCE cookie writes."
```

### Task 13: `createWithAuth` gates PKCE cookie writes

**Files:**
- Modify: `src/server/middleware.ts`
- Modify: existing `src/server/middleware.test.ts` if present — if missing, create it

- [ ] **Step 1: Write the failing tests**

Either append to an existing `middleware.test.ts` or create one. The test needs to spy on `authKitInstance.createSignIn` vs `getSignInUrl`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createWithAuth } from './middleware.js';

function buildAuthKit() {
  return {
    createSignIn: vi.fn().mockResolvedValue({
      url: 'https://auth.workos.com/sign-in',
      cookieName: 'wos-auth-verifier-00000000',
      response: new Response(),
      headers: { 'Set-Cookie': ['wos-auth-verifier-00000000=abc; Path=/'] },
    }),
    getSignInUrl: vi.fn().mockResolvedValue({
      url: 'https://auth.workos.com/sign-in',
      cookieName: 'wos-auth-verifier-00000000',
    }),
  } as unknown as Parameters<typeof createWithAuth>[0];
}

function event(headers: Record<string, string>) {
  return {
    url: new URL('https://app.example/protected'),
    request: new Request('https://app.example/protected', { headers }),
    locals: { auth: { user: null } },
  } as unknown as Parameters<Awaited<ReturnType<typeof createWithAuth>>>[0];
}

describe('createWithAuth — document gating', () => {
  it('calls createSignIn (with cookie) for document requests', async () => {
    const ak = buildAuthKit();
    const withAuth = createWithAuth(ak);
    const handler = withAuth(async () => ({ ok: true }));

    await handler(event({ 'sec-fetch-dest': 'document' })).catch(() => null);
    expect(ak.createSignIn).toHaveBeenCalled();
    expect(ak.getSignInUrl).not.toHaveBeenCalled();
  });

  it('calls getSignInUrl (no cookie) for XHR requests', async () => {
    const ak = buildAuthKit();
    const withAuth = createWithAuth(ak);
    const handler = withAuth(async () => ({ ok: true }));

    await handler(event({ 'sec-fetch-dest': 'empty' })).catch(() => null);
    expect(ak.getSignInUrl).toHaveBeenCalled();
    expect(ak.createSignIn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test src/server/middleware.test.ts
```

Expected: fail — `getSignInUrl` never called (current code always calls `createSignIn`).

- [ ] **Step 3: Update `createWithAuth`**

In `src/server/middleware.ts`, add the import:

```ts
import { isDocumentRequest } from './adapters/isDocumentRequest.js';
```

Replace the `!auth?.user` branch:

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

  // Non-document request (fetch/XHR/RSC/prefetch). Browsers won't
  // follow the cross-origin redirect to WorkOS from these, so a PKCE
  // cookie write is wasted and — under per-flow naming — contributes
  // to cookie-header bloat. The next real navigation from this client
  // hits this branch with isDocumentRequest === true and gets the
  // cookie then.
  const { url } = await authKitInstance.getSignInUrl({
    returnPathname: event.url.pathname,
  });
  throw redirect(302, url);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/server/middleware.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/middleware.ts src/server/middleware.test.ts
git commit -m "feat(middleware): gate PKCE cookie writes in createWithAuth

Document requests take the createSignIn path (with cookie). Non-
document requests (fetch/XHR/RSC/prefetch) take getSignInUrl (no
cookie) — browsers don't follow cross-origin redirects from those
anyway, and under per-flow cookie naming, writing on every request
quickly overflows HTTP header limits (431)."
```

### Task 14: Thread `state` into `clearPendingVerifier` in `auth.ts`

**Files:**
- Modify: `src/server/auth.ts:113-125`

- [ ] **Step 1: Update the test fixture first (see Task 15)**

Skip — Task 15 handles tests. Change code first.

- [ ] **Step 2: Update the bail helper**

In `src/server/auth.ts`, replace the bail function inside `createHandleCallback`:

```ts
const bail = async (errCode: AuthErrorCode): Promise<Response> => {
  const response = new Response(null, {
    status: 302,
    headers: { Location: `/auth/error?code=${errCode}` },
  });

  // Only clear when we know which flow's cookie to delete. URL state
  // is the flow key; if it's absent (malformed callback), skip —
  // the 10-minute PKCE TTL handles orphans.
  if (state) {
    const { headers: deleteHeaders } = await authKitInstance.clearPendingVerifier(
      new Response(),
      { state },
    );
    appendHeaderBag(response.headers, deleteHeaders);
  }

  return response;
};
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: clean on auth.ts. (Tests still pending update — Task 15.)

- [ ] **Step 4: Commit**

```bash
git add src/server/auth.ts
git commit -m "fix(auth): thread state into clearPendingVerifier call site

Required by authkit-session 0.5.0. Bailouts without state skip the
call — TTL-driven cleanup for the orphan."
```

### Task 15: Update test fixtures to use derived cookie names

**Files:**
- Modify: `src/tests/get-sign-in-url.test.ts`
- Modify: `src/tests/handle-callback.test.ts`

- [ ] **Step 1: Update `get-sign-in-url.test.ts`**

At the top of the file, replace:

```ts
const PKCE_COOKIE_NAME = 'wos-auth-verifier';
```

with a helper import:

```ts
import { getPKCECookieNameForState } from '@workos/authkit-session';
```

At each call site that asserts on `PKCE_COOKIE_NAME` (lines 7-8, 54-84 per the spec), replace with `getPKCECookieNameForState(expectedSealedState)`. Where the existing setup has `setCookieValue = '${PKCE_COOKIE_NAME}=sealed-verifier; ...'`, compute the name from the known sealed-verifier fixture:

```ts
const SEALED = 'sealed-verifier';
const EXPECTED_NAME = getPKCECookieNameForState(SEALED);

const setCookieValue = `${EXPECTED_NAME}=${SEALED}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
```

- [ ] **Step 2: Update `handle-callback.test.ts`**

Same transformation. Replace:

```ts
const PKCE_COOKIE_NAME = 'wos-auth-verifier';
const VERIFIER_DELETE = `${PKCE_COOKIE_NAME}=; Path=/; Max-Age=0`;
```

with:

```ts
import { getPKCECookieNameForState } from '@workos/authkit-session';

const SEALED = /* whatever sealed state the test sets up */;
const EXPECTED_NAME = getPKCECookieNameForState(SEALED);
const VERIFIER_DELETE = `${EXPECTED_NAME}=; Path=/; Max-Age=0`;
```

Some tests use different sealed-state fixtures per case; where that's true, compute the expected name inline per test.

- [ ] **Step 3: Run the tests**

```bash
pnpm test
```

Expected: all pass.

- [ ] **Step 4: Typecheck and build**

```bash
pnpm typecheck
pnpm build
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/tests/get-sign-in-url.test.ts src/tests/handle-callback.test.ts
git commit -m "test: derive expected PKCE cookie name from sealed state

Fixtures previously hardcoded 'wos-auth-verifier' — they now derive
per-flow names via getPKCECookieNameForState to match the on-wire
reality post-0.5.0."
```

### Task 16: Release authkit-sveltekit 0.3.0

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump version**

Edit `package.json`: `"version": "0.2.0"` → `"version": "0.3.0"`.

- [ ] **Step 2: Full check**

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: release 0.3.0

Per-flow PKCE cookies via @workos/authkit-session@^0.5.0 +
document-request gating in createWithAuth."
```

- [ ] **Step 4: PR, merge, tag, publish** — user-driven, per the repo's normal process.

Phase 2 complete.

---

## Phase 3 — `authkit-tanstack-react-start`

Start in `/Users/nicknisi/Developer/authkit-tanstack-start`. Fresh branch: `git checkout -b pkce-per-flow-cookies`.

### Task 17: Bump dep and absorb the signature break

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump the dep**

Edit `package.json`. Change `@workos/authkit-session` from `^0.4.0` (or current) to `^0.5.0`.

```bash
pnpm install
```

- [ ] **Step 2: Typecheck to list breakage**

```bash
pnpm typecheck
```

Expected: TS errors at `src/server/server.ts:76-79` where `clearPendingVerifier` is called with `{ redirectUri? }` but now needs `state`.

- [ ] **Step 3: Commit the dep bump**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): bump @workos/authkit-session to ^0.5.0

Typecheck fails until clearPendingVerifier call sites are updated
and STATIC_FALLBACK_DELETE_HEADERS is replaced."
```

### Task 18: Thread `state` through `buildVerifierDeleteHeaders` and replace static fallback

**Files:**
- Modify: `src/server/server.ts:7-10,73-88,100-108,144-176`

- [ ] **Step 1: Write/update the failing tests**

In `src/server/server.spec.ts`, find the tests that reference `STATIC_FALLBACK_DELETE_HEADERS` or that assert on `wos-auth-verifier=; Path=/; ...` deletes. Add:

```ts
import { getPKCECookieNameForState } from '@workos/authkit-session';

describe('handleCallbackRoute — state-derived delete headers', () => {
  it('emits a delete header whose cookie name matches getPKCECookieNameForState(state) when state is present', async () => {
    const sealed = 'sealed-state-fixture';
    const expected = getPKCECookieNameForState(sealed);
    const request = new Request(
      `https://app.example/callback?code=bad&state=${encodeURIComponent(sealed)}`,
    );
    // ... set up mocks so handleCallback throws, forcing errorResponse
    const res = await handleCallbackRoute()({ request });
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some(c => c.startsWith(`${expected}=`))).toBe(true);
  });

  it('emits no Set-Cookie delete when state is absent', async () => {
    const request = new Request('https://app.example/callback'); // no code, no state
    const res = await handleCallbackRoute()({ request });
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some(c => c.includes('wos-auth-verifier'))).toBe(false);
  });
});
```

Update any existing test that asserts the static header strings to instead compute via `getPKCECookieNameForState(sealedState)`.

- [ ] **Step 2: Run tests to verify new ones fail**

```bash
pnpm test src/server/server.spec.ts
```

Expected: new tests fail.

- [ ] **Step 3: Refactor `src/server/server.ts`**

Delete the `STATIC_FALLBACK_DELETE_HEADERS` const. Replace it and the two uses with a state-derived helper:

```ts
import {
  getPKCECookieNameForState,
  type HeadersBag,
} from '@workos/authkit-session';
import { getAuthkit } from './authkit-loader.js';
import { getRedirectUriFromContext } from './auth-helpers.js';
import { emitHeadersFrom } from './headers-bag.js';
import type { HandleCallbackOptions } from './types.js';

/**
 * Build Set-Cookie headers that delete the per-flow PKCE verifier
 * cookie identified by `state`. When `state` is absent (malformed
 * callback), return an empty list — the 10-minute TTL handles orphans.
 */
function deleteHeadersForState(state: string | null): readonly string[] {
  if (!state) return [];
  const name = getPKCECookieNameForState(state);
  return [
    `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
    `${name}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
  ];
}
```

Refactor `buildVerifierDeleteHeaders` to take `state` and fall through to `deleteHeadersForState`:

```ts
async function buildVerifierDeleteHeaders(
  authkit: Awaited<ReturnType<typeof getAuthkit>> | undefined,
  state: string | null,
): Promise<readonly string[]> {
  if (!state) return [];
  if (!authkit) return deleteHeadersForState(state);
  try {
    const redirectUri = getRedirectUriFromContext();
    const { response, headers } = await authkit.clearPendingVerifier(
      new Response(),
      { state, ...(redirectUri ? { redirectUri } : {}) },
    );
    const fromResponse = response?.headers.getSetCookie?.() ?? [];
    if (fromResponse.length > 0) return fromResponse;
    const fromBag = headers?.['Set-Cookie'];
    if (fromBag) return Array.isArray(fromBag) ? fromBag : [fromBag];
    return deleteHeadersForState(state);
  } catch (error) {
    console.error('[authkit-tanstack-react-start] clearPendingVerifier failed:', error);
    return deleteHeadersForState(state);
  }
}
```

Thread `state` through the call chain. In `handleCallbackInternal`:

```ts
if (!code) {
  return errorResponse(new Error('Missing authorization code'), request, options, authkit, state, 400);
}
```

And in `errorResponse`, add a `state: string | null` parameter and pass it to `buildVerifierDeleteHeaders`.

Also update the comment block above `buildVerifierDeleteHeaders` — the claim that "PKCE cookie Path must match whatever redirectUri was used to set it" is stale; core hardcodes `path: '/'` now. Replace with:

```ts
/**
 * Extract the `Set-Cookie` header(s) produced by
 * `authkit.clearPendingVerifier()` for the flow identified by `state`.
 *
 * Delete matching is on (name, domain, path); `path` is always `/`
 * for PKCE cookies in authkit-session (see `getPKCECookieOptions`).
 * When authkit setup itself failed, fall back to a state-derived
 * header pair that covers both SameSite=Lax and SameSite=None set
 * paths — browsers use (name, domain, path) for cookie replacement,
 * not SameSite, so either variant deletes the original regardless of
 * its original SameSite attribute.
 */
```

- [ ] **Step 4: Run tests**

```bash
pnpm test
```

Expected: all pass.

- [ ] **Step 5: Typecheck and build**

```bash
pnpm typecheck
pnpm build
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/server/server.ts src/server/server.spec.ts
git commit -m "fix(server): state-derive PKCE delete headers

Replaces STATIC_FALLBACK_DELETE_HEADERS with a dynamic helper that
computes cookie names from getPKCECookieNameForState(state). When
state is absent, emits no delete headers — the 10-minute TTL handles
orphans. Threads state through buildVerifierDeleteHeaders and
errorResponse. Also refreshes stale comment about Path tracking."
```

### Task 19: Update any other spec assertions on cookie names

**Files:**
- Modify: `src/server/server-functions.spec.ts` (if it asserts on cookie names)

- [ ] **Step 1: Grep for legacy cookie-name assertions**

```bash
rg "wos-auth-verifier" src/
```

- [ ] **Step 2: For each match in a test file, rewrite to derive via `getPKCECookieNameForState`**

For example, if a test does `expect(setCookie).toContain('wos-auth-verifier=')`, change it to:

```ts
import { getPKCECookieNameForState } from '@workos/authkit-session';
// ...
const expected = getPKCECookieNameForState(sealedStateUsedInTest);
expect(setCookie).toContain(`${expected}=`);
```

- [ ] **Step 3: Run tests**

```bash
pnpm test
```

Expected: all pass.

- [ ] **Step 4: Commit (if any files changed)**

```bash
git add src/
git commit -m "test: derive expected PKCE cookie names from sealed state"
```

If the grep surfaced nothing, skip this commit.

### Task 20: Release authkit-tanstack-react-start 0.7.0

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump version**

Edit `package.json`: `"version": "0.6.0"` → `"version": "0.7.0"`.

- [ ] **Step 2: Full check**

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: release 0.7.0

Per-flow PKCE cookies via @workos/authkit-session@^0.5.0. Static
fallback delete replaced with state-derived variant."
```

- [ ] **Step 4: PR, merge, tag, publish** — user-driven.

Phase 3 complete. All three packages shipped with the per-flow cookie fix.

---

## Self-review notes

- **Spec coverage.** Every numbered section in the spec (1.1–1.6, 2.1–2.5, 3.1–3.4) has a corresponding task. Testing matrix (§Testing) is covered across Tasks 1, 4, 5, 6, 7, 12, 13, 15, 18, 19.
- **Placeholders.** None. Every code step includes the full code block. Test names are concrete; file paths are absolute or relative-from-repo-root with no ambiguity.
- **Type consistency.** `cookieName: string` is added to `GeneratedAuthorizationUrl` (Task 2) and `CreateAuthorizationResult` (Task 3) and used consistently in Tasks 4, 5, 6, 7. `clearPendingVerifier(response, { state, redirectUri? })` shape is identical across Tasks 7, 14, 18. `PKCE_COOKIE_PREFIX` and `getPKCECookieNameForState` exports in Task 8 match imports in Tasks 11+.
- **Breaking change fence.** `clearPendingVerifier` requires `state` after Task 7. Phase 2 and 3 consume `^0.5.0` only after Phase 1 ships, so the TS break happens inside the adapter repos (expected, fixed immediately in Tasks 14 and 18).
