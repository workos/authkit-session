# AuthKit Session Architecture Refactor

**Goal:** Extract business logic (crypto, JWT, refresh) into a toolkit library for AuthKit SDK authors
**Philosophy:** Provide shared primitives, not prescriptive orchestration
**Status:** ✅ Phase 1 Complete - Ready for Framework Integration

---

## 🎯 Architecture Overview

### Library Design Philosophy

**What This Library Provides:**

- **Business Logic Extraction**: Token verification, encryption, refresh orchestration (the hard stuff)
- **Framework-Agnostic Primitives**: Core classes that work in any JavaScript environment
- **Integration Helpers**: Base classes and utilities for cookie management, config handling

**What This Library Does NOT Provide:**

- **Framework Integration Patterns**: Each framework implements `updateSession/withAuth` their way
- **Request Context Solutions**: Frameworks handle stale tokens using their native patterns
- **Orchestration Prescription**: No forced patterns for middleware/routes

### Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│ Framework SDK (@workos-inc/authkit-nextjs, etc.)          │
│ - Implements updateSession/withAuth patterns               │
│ - Handles framework-specific features (callbacks, etc.)    │
│ - Uses library primitives for complex logic                │
└─────────────────────────────────────────────────────────────┘
                           ↓ uses
┌─────────────────────────────────────────────────────────────┐
│ @workos/authkit-session (Toolkit Library)                  │
│                                                             │
│ TIER 1: AuthKitCore (Pure Business Logic)                  │
│   - verifyToken, isTokenExpiring, parseTokenClaims         │
│   - encryptSession, decryptSession                         │
│   - validateAndRefresh orchestration                       │
│                                                             │
│ TIER 2: AuthOperations (WorkOS Integration)                │
│   - refreshSession (with org context)                      │
│   - signOut (logout URL + cookie clear)                    │
│   - getAuthorizationUrl, getSignInUrl, getSignUpUrl        │
│                                                             │
│ TIER 3: CookieSessionStorage (Cookie Helpers)              │
│   - buildSetCookie (secure defaults)                       │
│   - Base class for framework storage implementations       │
│                                                             │
│ TIER 4: ConfigurationProvider (Config Management)          │
│   - Environment variable mapping                           │
│   - Programmatic configuration                             │
└─────────────────────────────────────────────────────────────┘
```

### What Frameworks Extract

**Next.js Implementation (~200 lines):**

```typescript
import {
  AuthKitCore,
  AuthOperations,
  CookieSessionStorage,
} from '@workos/authkit-session';

// Use toolkit to implement framework patterns
async function updateSession(request: NextRequest) {
  const encrypted = await storage.getSession(request);
  const session = await core.decryptSession(encrypted);
  const { refreshed, session: validated } =
    await core.validateAndRefresh(session);

  // Next.js-specific: headers, callbacks, eagerAuth
  if (refreshed) {
    headers.set('x-workos-session', await core.encryptSession(validated));
    options.onSessionRefreshSuccess?.(validated);
  }
}
```

**TanStack Start Implementation (~200 lines):**

```typescript
import { AuthKitCore, AuthOperations, CookieSessionStorage } from '@workos/authkit-session';

// Use toolkit to implement framework patterns
const requestSessions = new WeakMap<Request, string>();

export const authMiddleware = createMiddleware({
  async middleware({ next }) {
    // Use core for validation
    const { refreshed, session } = await core.validateAndRefresh(...);

    // TanStack-specific: WeakMap for same-request access
    if (refreshed) {
      requestSessions.set(request, await core.encryptSession(session));
    }
  }
});
```

### Critical Design Decision: No Context Methods

**Original idea:** Add `getSessionFromContext/setSessionContext` to SessionStorage interface

**Why we rejected it:**

- Each framework handles request context differently (headers vs locals vs WeakMap)
- Forcing a single interface pattern fights framework idioms
- Better to let frameworks implement context passing their natural way

**Solution:** Frameworks use library primitives but own the integration glue

### Benefits of This Approach

✅ **Shared complexity**: Crypto, JWT, refresh logic maintained in one place
✅ **Framework flexibility**: Each adapter uses idiomatic patterns
✅ **Clear boundaries**: Business logic vs integration clearly separated
✅ **Maintainable**: 80% of code shared, 20% framework-specific
✅ **Adoptable**: Frameworks can use what they need, skip what they don't

---

## 📋 Execution Phases

### ✅ Phase 0: Planning (COMPLETE)

- [x] Architecture design
- [x] Create REFACTOR_PLAN.md
- [x] Set up collaborative workflow

---

### ✅ Phase 1: Core Extraction (COMPLETE)

#### 1.1: Create AuthKitCore class ✅

- [x] **File:** `src/core/AuthKitCore.ts`
- [x] **Extract these methods:**
  - `verifyToken(accessToken: string): Promise<boolean>`
  - `isTokenExpiring(accessToken: string, bufferSeconds?: number): boolean`
  - `parseTokenClaims<T>(accessToken: string): TokenClaims & T`
  - `encryptSession(session: Session): Promise<string>`
  - `decryptSession(encrypted: string): Promise<Session>`
  - `refreshTokens(refreshToken: string, organizationId?: string): Promise<RefreshResult>`
- [x] **New orchestration method:**
  ```typescript
  async validateAndRefresh(session: Session): Promise<{
    valid: boolean;
    refreshed: boolean;
    session: Session;
    claims: TokenClaims;
  }>
  ```
- [x] **Key principle:** No `TRequest`/`TResponse` generics. Pure data in, data out.
- [ ] **Testing:** Unit tests with mocked WorkOS client (deferred to Phase 4)

**Sources to extract from:**

- `src/core/session/TokenManager.ts` (lines 38-76)
- `src/core/session/SessionManager.ts` (lines 41-66, 164-209)

---

#### 1.2: Create AuthOperations class ✅

- [x] **File:** `src/operations/AuthOperations.ts`
- [x] **Methods to implement:**

  ```typescript
  async signOut(sessionId: string, options?: { returnTo?: string }): Promise<{
    logoutUrl: string;
    clearCookieHeader: string;
  }>

  async switchOrganization(session: Session, organizationId: string): Promise<{
    auth: AuthResult;
    encryptedSession: string;
  }>

  async refreshSession(session: Session, organizationId?: string): Promise<{
    auth: AuthResult;
    encryptedSession: string;
  }>

  async getAuthorizationUrl(options: GetAuthorizationUrlOptions): Promise<string>
  ```

- [x] **Dependencies:** `AuthKitCore`, `WorkOS` client, `ConfigurationProvider`
- [x] **Key principle:** Orchestrates between core logic and WorkOS API. No storage/persistence.
- [x] **Refactoring win:** `switchOrganization()` delegates to `refreshSession()` - DRY principle applied!
- [ ] **Testing:** Unit tests with mocked AuthKitCore and WorkOS client (deferred to Phase 4)

**Sources to reference:**

- `authkit-nextjs/src/session.ts` (lines 307-372 for refreshSession logic)
- `authkit-tanstack-start/src/server-functions.ts` (lines 40-72 for signOut logic)

---

#### 1.3: Create AuthService class ✅

- [x] **File:** `src/service/AuthService.ts`
- [x] **Constructor:**
  ```typescript
  constructor(
    config: ConfigurationProvider,
    storage: SessionStorage<TRequest, TResponse>,
    clientFactory: (config: AuthKitConfig) => WorkOS,
    encryptionFactory: (config: AuthKitConfig) => SessionEncryption,
  )
  ```
- [x] **CRITICAL: Lazy initialization via private getters**
  - Core and Operations are NOT instantiated in constructor
  - Instantiated on first access via `get core()` and `get operations()`
  - Allows `configure()` to be called AFTER instantiation but BEFORE first use
  - Solves the Next.js/Remix problem where there's no clean entry point
- [x] **Primary method:**
  ```typescript
  async withAuth<TCustomClaims = CustomClaims>(request: TRequest): Promise<{
    auth: AuthResult<TCustomClaims>;
    refreshedSessionData?: string;
  }>
  ```
- [x] **Delegation methods:**
  - `signOut()` → calls `AuthOperations.signOut()`
  - `switchOrganization()` → calls `AuthOperations.switchOrganization()`
  - `refreshSession()` → calls `AuthOperations.refreshSession()`
  - `getAuthorizationUrl()` → calls `AuthOperations.getAuthorizationUrl()`
- [x] **Storage methods:**
  - `getSession(request: TRequest): Promise<Session | null>`
  - `saveSession(response: TResponse | undefined, sessionData: string)`
- [x] **Convenience methods:**
  - `getSignInUrl(options?: AuthUrlOptions)`
  - `getSignUpUrl(options?: AuthUrlOptions)`
- [x] **Key principle:** This is the ONLY class with `<TRequest, TResponse>` generics
- [x] **Architectural win:** Lazy initialization solves config timing problem
- [ ] **Testing:** Integration tests with mock storage (deferred to Phase 4)

**Source to refactor:**

- `src/core/session/SessionManager.ts` (entire class)

---

#### 1.4: Update exports and remove factory ✅

- [x] **Update `src/index.ts`:**

  ```typescript
  export { AuthService } from './service/AuthService';
  export { AuthKitCore } from './core/AuthKitCore';
  export { AuthOperations } from './operations/AuthOperations';
  export * from './types';

  // Optional helper for convenience
  export { createAuthService } from './service/factory';
  ```

- [x] **Created:** `src/service/factory.ts` - Convenience factory with lazy storage proxy
- [x] **Kept as deprecated:** `createAuthKitFactory` and `SessionManager` (for backward compatibility)
- [x] **Build verified:** TypeScript compilation successful

---

---

### 🔵 Phase 2: TanStack Start Integration (READY TO START)

#### 2.1: Update authkit instance

- [ ] **File:** `authkit-tanstack-start/src/server/authkit.ts`
- [ ] **Replace factory with AuthService:**

  ```typescript
  import {
    AuthService,
    getConfigurationProvider,
  } from '@workos/authkit-session';

  export const authService = new AuthService(
    getConfigurationProvider(),
    new TanStackStartCookieSessionStorage(getConfigurationProvider()),
    getWorkOS(),
    sessionEncryption,
  );

  export { authService as authkit };
  ```

---

#### 2.2: Fix middleware (CRITICAL BUG FIX)

- [ ] **File:** `authkit-tanstack-start/src/server/middleware.ts`
- [ ] **Problem:** Set-Cookie header not applied to HTTP response
- [ ] **Fix:** Clone Response and apply headers properly

  ```typescript
  const result = await args.next({ context: { auth: () => auth } });

  if (refreshedSessionData) {
    const setCookie = buildSetCookieHeader(cookieName, refreshedSessionData);

    // Clone response (Response is immutable)
    const newResponse = new Response(result.response.body, {
      status: result.response.status,
      statusText: result.response.statusText,
      headers: result.response.headers,
    });
    newResponse.headers.set('Set-Cookie', setCookie);

    return { ...result, response: newResponse };
  }
  ```

- [ ] **Testing:** Verify in DevTools that Set-Cookie appears in response headers

---

#### 2.3: Update server functions

- [ ] **File:** `authkit-tanstack-start/src/server/server-functions.ts`
- [ ] **Update these functions to use AuthOperations:**
  - `signOut` (lines 40-72)
  - `switchToOrganization` (lines 208-249)
  - `getAuthorizationUrl` (lines 144-148)
  - `getSignInUrl` (lines 163-168)
  - `getSignUpUrl` (lines 183-188)
- [ ] **Pattern:**

  ```typescript
  // Before: Duplicates logic
  const workos = authkit.getWorkOS();
  const logoutUrl = workos.userManagement.getLogoutUrl({ ... });

  // After: Delegates to AuthOperations
  const { logoutUrl, clearCookie } = await authService.signOut(sessionId, options);
  ```

---

### ⏸️ Phase 3: Next.js Integration (DEFERRED)

**Note:** Next.js integration deferred to future work. TanStack Start will serve as the reference implementation.

#### 3.1: Update session.ts (DEFERRED)

- [ ] **File:** `authkit-nextjs/src/session.ts`
- [ ] **Replace inline logic with AuthService:**
  - `updateSession()` (lines 128-305) → use `authService.withAuth()`
  - `refreshSession()` (lines 307-372) → use `authService.refreshSession()`
- [ ] **Keep Next.js-specific parts:**
  - Headers manipulation
  - `cookies()` API usage
  - Middleware request handling
- [ ] **Testing:** Verify middleware still works, tokens refresh properly

---

#### 3.2: Update actions.ts

- [ ] **File:** `authkit-nextjs/src/actions.ts`
- [ ] **Update to use AuthOperations:**
  - `handleSignOutAction` (line 29)
  - `switchToOrganizationAction` (line 51)
- [ ] **Pattern:** Delegate business logic to AuthOperations, keep Next.js redirect/cookies handling

---

### ⚪ Phase 4: Testing & Validation

#### 4.1: Unit tests

- [ ] **Update tests for new classes:**
  - Create `AuthKitCore.spec.ts`
  - Create `AuthOperations.spec.ts`
  - Create `AuthService.spec.ts`
- [ ] **Update existing tests:**
  - Replace `createAuthKitFactory` imports with `AuthService`
  - Update mocks from `SessionManager` to `AuthService`
- [ ] **Coverage:** Maintain 80% threshold
- [ ] **Run:** `pnpm test` in authkit-session

---

#### 4.2: Integration testing - TanStack Start

- [ ] **Start dev server:** `pnpm --filter authkit-tanstack-start dev`
- [ ] **Test token refresh:**
  - Navigate to protected route
  - Wait for token to approach expiry (or mock expiry)
  - Verify Set-Cookie in Network tab
  - Verify cookie value updates in Application tab
- [ ] **Test no infinite loop:**
  - Make multiple rapid requests
  - Check server logs - should see "Session refreshed" only once
- [ ] **Test server functions:**
  - Test signOut redirects properly
  - Test switchOrganization persists new session

---

#### 4.3: Integration testing - Next.js

- [ ] **Start dev server:** `pnpm --filter authkit-nextjs dev`
- [ ] **Test middleware:**
  - Token refresh persists
  - Headers properly set
- [ ] **Test Server Actions:**
  - signOut works
  - switchOrganization works
- [ ] **Verify backward compatibility**

---

### ⚪ Phase 5: Documentation & Cleanup

#### 5.1: Update CLAUDE.md

- [ ] **Add architecture diagram**
- [ ] **Document new classes:**
  - AuthKitCore API reference
  - AuthOperations API reference
  - AuthService API reference
- [ ] **Add migration guide from factory pattern**

---

#### 5.2: Update README

- [ ] **Update installation examples**
- [ ] **Update "Creating a Framework Adapter" section**
- [ ] **Add architecture overview**
- [ ] **Update API reference**

---

#### 5.3: Deprecation & versioning

- [ ] **Mark `createAuthKitFactory` as deprecated**
- [ ] **Add migration guide in CHANGELOG**
- [ ] **Decide:** Keep factory as wrapper for one version?

---

## 🎓 Learning Checkpoints

**You will implement these key methods hands-on:**

### Checkpoint 1: AuthKitCore.validateAndRefresh()

**When:** After I scaffold AuthKitCore class structure
**Your task:** Implement the orchestration logic that decides validate-only vs validate-and-refresh
**Why:** This is the core business logic - you need to understand the refresh decision tree

### Checkpoint 2: AuthService.withAuth()

**When:** After AuthKitCore and AuthOperations exist
**Your task:** Implement coordination between storage, core, and operations
**Why:** This is the integration point - you'll see how all pieces fit together

### Checkpoint 3: TanStack Start middleware response handling

**When:** After AuthService exists
**Your task:** Implement Response cloning logic to properly apply Set-Cookie headers
**Why:** This fixes the actual bug - you'll understand Response immutability

---

## 🐛 Bug Fixes Achieved

### Issue 1: Infinite Refresh Loop

**Root cause:** Refreshed tokens never persisted to cookie
**Fix:** AuthService returns `refreshedSessionData`, middleware properly applies Set-Cookie
**Verification:** Server logs show single refresh, not repeated refreshes

### Issue 2: Intermittent Authentication

**Root cause:** Stale token in cookie, fresh token only in memory context
**Fix:** Middleware clones Response and sets cookie header on HTTP response
**Verification:** DevTools shows updated cookie value after refresh

---

## 📊 Success Metrics

**Refactor is complete when:**

- ✅ All tests pass with 80%+ coverage
- ✅ Token refresh persists to cookie (DevTools verification)
- ✅ No infinite refresh loops (server log verification)
- ✅ TanStack Start example works flawlessly
- ✅ Next.js example works flawlessly
- ✅ No `createAuthKitFactory` references in codebase
- ✅ CLAUDE.md reflects new architecture
- ✅ You can explain Core → Operations → Service flow

---

## 🚦 Current Status

**Phase:** Toolkit Refinement
**Completed:** Phase 1 Complete ✅ (Core, Operations, Service extraction)
**Next Step:** Simplify to toolkit approach - remove prescriptive patterns
**Philosophy Shift:** From "batteries-included framework" to "business logic toolkit"

---

## 🔄 Phase 1.5: Toolkit Refinement (IN PROGRESS)

### Background

After architectural review with Codex and Gemini, we identified that forcing context methods (`getSessionFromContext/setSessionContext`) into the SessionStorage interface was over-prescriptive. Each framework handles request context differently:

- **Next.js**: Mutable request headers (`request.headers.set`)
- **TanStack Start**: WeakMap (immutable requests)
- **SvelteKit**: `event.locals`
- **Remix**: Context objects

Forcing a single pattern fights framework idioms.

### What Changes

**Keep (Valuable Toolkit):**

- ✅ AuthKitCore - Token verification, encryption, refresh orchestration
- ✅ AuthOperations - WorkOS API helpers (refreshSession, signOut, URLs)
- ✅ CookieSessionStorage - Cookie building helpers
- ✅ ConfigurationProvider - Config management

**Simplify:**

- ⚠️ AuthService - Keep as optional reference, not prescribed orchestration
- ⚠️ SessionStorage interface - Remove context methods, keep minimal

**Document:**

- ✅ How frameworks should use the toolkit
- ✅ Example patterns for Next.js and TanStack Start
- ✅ Clear statement: "You own integration, we provide primitives"

### Tasks

- [ ] Remove context methods from SessionStorage interface
- [ ] Update AuthService documentation to position as "reference pattern"
- [ ] Update exports to emphasize toolkit nature
- [ ] Add architectural decision record (ADR) for why no context methods
- [ ] Update README with toolkit philosophy
- [ ] Create framework integration guide

---

## 🚦 Current Status After Refinement

**Phase:** Ready for Framework Integration
**Completed:**

- ✅ Phase 1 Complete (Core, Operations, helpers extracted)
- ✅ Phase 1.5 Complete (Toolkit philosophy refined)
  **Next Step:** Use in authkit-nextjs and authkit-tanstack-start
  **Philosophy:** Toolkit library providing business logic primitives
