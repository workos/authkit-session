# AuthKit SSR

## Core Module Design

The core should handle all framework-agnostic functionality:

1. Session Management
    - Token encryption/encryption (iron-session)
    - JWT validation and parsing (jose)
    - Session Refresh logic
2. Authentication Logic
    - WorkOS client instantiation
    - Authorization URL generation
    - Token refresh flows
    - Session termination
3. Configuration
    - Environment variable handling
    - Default options
    - Type definitions

## Adapter System

The key innovation is a clean adapter pattern that abstracts framework-specific concepts:

```typescript
interface StorageAdapter {
  getSessionData: (request: unknown) => Promise<string | null>;
  createAuthenticatedResponse: (
      createResponseData: unknown,
      sessionData?: string
  ) => unknown;

  clearSession: (request: unknown) => Promise<number>;
}
```

Each framework would provide its own implementation:

```typescript
// Example Next.js adapter (simplified)
class NextjsAdapter implements StorageAdapter {
  getSessionData(request: NextRequest) {
    return request.cookies.get(cookieName)?.value || null;
  }

  createAuthenticatedResponse(response, sessionData) {
    if (sessionData) {
      response.cookies.set(cookieName, sessionData);
    }
    return response;
  }

  clearSession(request) {
    const response = NextResponse.next();
    response.cookies.delete(cookieName);
    return response;
  }
}
```

## Framework Integrations

Each framework implementation would:

1. Implement the storage adapter
2. Provide frmaework-specific middleware/hooks
3. Create convenience wrappers and utilities

---

# Architectural Challenges & Solutions for AuthKit SSR

## 1. Request/Response Abstraction

### Challenge
Each framework has unique request/response patterns:
- Next.js uses `NextRequest` and `NextResponse` objects
- TanStack Start uses its own system based on web standards
- Remix has its own request/response pattern
- Express uses Node's HTTP objects

### Solution Approach
Create a normalized interface that adapters implement:

```typescript
interface RequestAdapter {
  getCookies(request: unknown): Record<string, string>;
  getHeaders(request: unknown): Record<string, string>;
  getUrl(request: unknown): URL;
}

interface ResponseAdapter {
  setCookie(response: unknown, name: string, value: string, options: CookieOptions): void;
  setHeader(response: unknown, name: string, value: string): void;
}
```

The core would work with these normalized interfaces, while framework-specific adapters handle the translation.

## 2. Middleware Patterns

### Challenge
Middleware systems vary significantly across frameworks:
- Next.js has edge middleware
- Express has traditional middleware chains
- TanStack has its own approach
- Remix uses loaders and actions

### Solution Approach
Decouple the core authentication logic from the middleware implementation. The core focuses on:
- Session validation
- Token refresh
- Authorization flows

Then expose composable building blocks that framework adapters can use within their native patterns:
- `validateSession(request, options)`
- `refreshToken(request, options)`
- `createAuthorizationUrl(options)`

This lets each framework handle its own middleware pattern while sharing core logic.

## 3. Environment Access

### Challenge
Frameworks access environment variables differently:
- Some use `process.env`
- Others use platform-specific patterns (Vercel, Netlify, Cloudflare)
- Some require runtime configuration

### Solution Approach
Implement a configurable provider pattern:

1. Default to standard `process.env` access
2. Allow injection of a custom configuration provider:
   ```typescript
   configureAuthKit({
     configProvider: (key) => getYourEnvironmentVariable(key)
   })
   ```
3. Support both imperative and environment-based configuration

This creates flexibility while maintaining simplicity for common cases.

## 4. Redirection Mechanisms

### Challenge
Each framework handles redirects differently:
- Next.js: `NextResponse.redirect()` or `redirect()`
- TanStack: `redirect()` from react-router
- Express: `res.redirect()`

### Solution Approach
Create a redirection abstraction that adapters implement:

```typescript
interface RedirectAdapter {
  redirect(url: string, options?: RedirectOptions): unknown;
}
```

The core would then call `adapter.redirect()` when needed, leaving implementation details to the framework adapter.

## 5. Error Handling 

### Challenge
Error handling patterns differ across frameworks:
- Some use exceptions/throw
- Others use return values
- Some have built-in error boundaries

### Solution Approach
Standardize on a result-based error pattern:

```typescript
type Result<T> = 
  | { success: true; data: T }
  | { success: false; error: AuthKitError }
```

This pattern works with both exception and return-based frameworks while providing structured error information.

## 6. Type Safety

### Challenge
Maintaining strong typing across different framework integrations.

### Solution Approach
Use TypeScript generics to maintain type safety:

```typescript
// Framework adapters specify their types
createAuthKit<NextRequest, NextResponse>({
  adapter: nextAdapter
})
```

This provides type safety while allowing the core to remain framework-agnostic.

## 7. Storage Mechanisms

### Challenge
Different platforms have varying capabilities for storing session data:
- Cookies (size limitations)
- Server-side storage
- Edge vs. Node.js environments

### Solution Approach
Create a storage strategy abstraction:

1. Default to cookie-based storage using iron-session
2. Allow pluggable storage backends through adapter pattern:
   ```typescript
   interface SessionStorage {
     get(key: string): Promise<T | null>;
     set(key: string, value: T): Promise<void>;
     delete(key: string): Promise<void>;
   }
   ```
3. Include built-in adapters for common patterns (cookie, memory, redis)

## 8. Authentication Flow Customization

### Challenge
Different apps need customized authentication flows:
- Some require MFA
- Some need organization selection
- Some need custom claims or tokens

### Solution Approach
Use a hook/event system that allows customization without modifying core:

```typescript
authKit.on('beforeAuthentication', (context) => {
  // Modify authentication parameters
  return context;
})

authKit.on('afterAuthentication', (session) => {
  // Process or enhance session data
  return session;
})
```

This creates extension points for framework-specific needs while maintaining core functionality.

Would you like me to explore any of these areas in more depth?
