# ADR 001: Toolkit Library, Not Framework

**Status:** Accepted
**Date:** 2025-01-14
**Deciders:** Nick Nisi, with review from Codex and Gemini AI

## Context

We're building `@workos/authkit-session` to extract authentication business logic for WorkOS SDK authors building framework-specific packages (Next.js, TanStack Start, SvelteKit, Remix). The question arose: How prescriptive should this library be?

### The Stale Token Problem

When middleware refreshes a token, downstream route handlers in the same request see the old token from the cookie. This can cause bugs:

```typescript
// Middleware refreshes token, writes Set-Cookie
const { session } = await validateAndRefresh(oldSession);
response.headers.set('Set-Cookie', newCookie);

// Route handler (same request) reads from cookie
const cookie = request.cookies.get('session'); // ← OLD token still here
```

The new cookie goes to the browser, but the current request's handlers don't see it yet.

### Proposed Solution (Rejected)

Add context methods to `SessionStorage` interface:

```typescript
interface SessionStorage<TRequest, TResponse> {
  getSession(request): Promise<string | null>
  saveSession(response, data): Promise<{...}>

  // NEW: Pass session within request
  getSessionFromContext(request): Promise<string | null>
  setSessionContext(request, data): void
}
```

Framework implementations:

- Next.js: `request.headers.set('x-workos-session', data)`
- TanStack: `WeakMap<Request, string>`
- SvelteKit: `event.locals.workosSession`

## Decision

**We will NOT add context methods to the SessionStorage interface.**

Instead, this library will be a **toolkit** providing business logic primitives. Framework adapters will implement request context handling using their native patterns.

## Rationale

### 1. Interface Cohesion

`SessionStorage` abstracts cookie persistence (durable state). Adding request-scoped state (ephemeral) creates a hybrid interface that mixes concerns:

```typescript
// Mixed concerns
getSession(request); // Reads durable cookie
getSessionFromContext(request); // Reads ephemeral request data
```

This violates single responsibility principle.

### 2. Framework Patterns Differ Fundamentally

Each framework has idiomatic ways to pass data within a request:

**Next.js (Mutable Headers):**

```typescript
// Middleware
request.headers.set('x-workos-session', data);

// Route
const data = request.headers.get('x-workos-session');
```

**SvelteKit (Locals):**

```typescript
// Hooks
event.locals.workosSession = data;

// Route
const data = event.locals.workosSession;
```

**TanStack Start (WeakMap):**

```typescript
// Middleware
requestSessions.set(request, data);

// Server function
const data = requestSessions.get(request);
```

**Remix (Context):**

```typescript
// Entry
context.workosSession = data;

// Loader
const data = context.workosSession;
```

A single `setSessionContext(request, data): void` signature can't naturally express all these patterns without forcing unnatural implementations.

### 3. WeakMap Limitations

The TanStack WeakMap approach has limitations:

**Memory:** 10k concurrent requests = ~16-20 MB (acceptable) but non-deterministic GC creates spikes

**Edge runtimes:** WeakMap works within an isolate but doesn't bridge different runtime stages

**Single-process:** Doesn't work across serverless instances or multiple bundles

These are acceptable trade-offs for TanStack to make, but shouldn't be forced by the core library interface.

### 4. Type System Complexity

Framework types don't align:

```typescript
// Next.js needs to return modified response
NextResponse.next({ request: { headers: modifiedHeaders } });

// SvelteKit mutates event in-place
event.locals.session = data; // returns void

// Remix uses separate context object
context: AppLoadContext; // not part of request
```

The `<TRequest, TResponse>` generics can't model these different patterns without type gymnastics.

### 5. Real-World Evidence

The Next.js SDK doesn't use this library - they implement `updateSession/withAuth` inline (~300 lines). This signals:

- Frameworks want control over integration patterns
- The complex parts (crypto, JWT, refresh) are what should be shared
- The orchestration parts (middleware/routes) are framework-specific

## Consequences

### What Framework Adapters Must Do

Implement their own `updateSession/withAuth` patterns using toolkit primitives:

```typescript
// Example: Next.js
import {
  AuthKitCore,
  AuthOperations,
  CookieSessionStorage,
} from '@workos/authkit-session';

const core = new AuthKitCore(config, workos, encryption);
const operations = new AuthOperations(core, workos, config);
const storage = new NextCookieStorage(config);

async function updateSession(request: NextRequest) {
  const encrypted = await storage.getSession(request);
  const session = await core.decryptSession(encrypted);
  const { refreshed, session: validated } =
    await core.validateAndRefresh(session);

  if (refreshed) {
    const newEncrypted = await core.encryptSession(validated);

    // Next.js-specific: headers
    request.headers.set('x-workos-session', newEncrypted);
    headers.append('Set-Cookie', storage.buildSetCookie(newEncrypted));

    // Next.js-specific: callbacks
    options.onSessionRefreshSuccess?.(validated);
  }

  return { session: buildAuthResult(validated), headers };
}
```

### What the Library Provides

**Core primitives (shared ~80% of complexity):**

- `AuthKitCore.verifyToken()` - JWKS verification with caching
- `AuthKitCore.encryptSession/decryptSession()` - iron-webcrypto wrapper
- `AuthKitCore.validateAndRefresh()` - Orchestrates validate-then-refresh decision
- `AuthOperations.refreshSession()` - WorkOS API call + org context extraction
- `AuthOperations.signOut()` - Logout URL + cookie clear header
- `CookieSessionStorage.buildSetCookie()` - Secure cookie defaults

**Integration (~20% framework-specific):**

- Framework implements SessionStorage subclass
- Framework implements updateSession/withAuth patterns
- Framework handles request context their way

### Stale Token Handling

Frameworks choose their solution:

**Option 1: Header propagation (Next.js)**

```typescript
headers.set('x-workos-session', encrypted);
```

**Option 2: Locals (SvelteKit)**

```typescript
event.locals.workosSession = encrypted;
```

**Option 3: WeakMap (TanStack Start)**

```typescript
const requestSessions = new WeakMap<Request, string>();
requestSessions.set(request, encrypted);
```

**Option 4: Accept stale token**

```typescript
// Old token is still valid for 60s
// Browser gets new token on next request
// Acceptable for some use cases
```

The library doesn't prescribe - frameworks decide based on their constraints.

## Alternatives Considered

### Alternative 1: Add Context Methods (Required)

Make `getSessionFromContext/setSessionContext` required in SessionStorage interface.

**Rejected because:**

- Forces WeakMap on TanStack (edge runtime limitations)
- Forces header mutation on Next.js (type system complexity)
- Doesn't fit Remix context pattern
- Over-prescriptive for a toolkit library

### Alternative 2: Add Context Methods (Optional)

Make context methods optional with `?` in interface.

**Rejected because:**

- Optional methods signal "nice to have" when this solves a correctness issue
- Creates confusion: "Should I implement these?"
- Still forces a single signature across different patterns

### Alternative 3: Split Interfaces

```typescript
interface SessionPersistence<TRequest, TResponse> {
  /* cookies */
}
interface InRequestSession<TRequest, TResponse> {
  /* context */
}
```

**Rejected because:**

- More interfaces to implement
- More dependencies in AuthService
- Doesn't solve the type system or pattern differences

### Alternative 4: Toolkit Approach (Accepted)

Provide primitives, let frameworks compose their own patterns.

**Accepted because:**

- Clear separation: business logic vs integration
- Framework flexibility preserved
- Type system complexity avoided
- Matches real-world usage (Next.js implements inline)

## Implementation Notes

### For Framework Adapter Authors

When building a framework adapter:

1. **Import toolkit primitives:**

   ```typescript
   import {
     AuthKitCore,
     AuthOperations,
     CookieSessionStorage,
   } from '@workos/authkit-session';
   ```

2. **Extend CookieSessionStorage:**

   ```typescript
   class MyFrameworkStorage extends CookieSessionStorage<Request, Response> {
     async getSession(request: Request): Promise<string | null> {
       // Parse cookie from framework request
     }
   }
   ```

3. **Implement updateSession pattern:**

   ```typescript
   async function updateSession(request) {
     const { refreshed, session } = await core.validateAndRefresh(...);

     if (refreshed) {
       // Handle context YOUR way
       // - Next.js: request.headers.set()
       // - TanStack: WeakMap.set()
       // - SvelteKit: event.locals
     }
   }
   ```

4. **Implement withAuth pattern:**
   ```typescript
   async function withAuth() {
     // Read from context YOUR way
     // Fall back to cookie if no context
   }
   ```

### Memory Considerations

If using WeakMap for request context:

- Monitor memory under load (expect ~16-20 MB for 10k concurrent)
- Consider header propagation for edge deployments
- Document limitations in framework adapter docs

### Type Safety

Each framework's `SessionStorage` implementation uses framework-specific types:

- Next.js: `<NextRequest, NextResponse>`
- TanStack: `<Request, Response>`
- SvelteKit: `<RequestEvent, never>`
- Remix: `<Request, never>`

The generics flow through but stay framework-specific.

## References

- [Architectural discussion](../REFACTOR_PLAN.md#phase-15-toolkit-refinement)
- Next.js implementation: `authkit-nextjs/src/session.ts`
- TanStack implementation: `authkit-tanstack-start/src/cookie-storage.ts`

## Status

**Accepted** - This establishes authkit-session as a toolkit library, not a prescriptive framework.
