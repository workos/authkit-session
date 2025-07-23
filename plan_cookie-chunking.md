# Cookie Chunking Implementation Plan

## Problem Statement

As session tokens grow larger with additional user data and claims, they approach browser cookie size limits (~4KB). This creates authentication failures and user experience issues when tokens exceed these limits.

## Analysis and Approach

### Why Cookie Chunking?
Cookie chunking is the most appropriate solution because:
- **Maintains current architecture**: No need for external session stores
- **Framework agnostic**: Works with existing adapter pattern
- **Proven approach**: Successfully used by NextAuth and other libraries
- **Transparent to consumers**: No API changes required

### Framework Compatibility Assessment
The existing `SessionStorage<TRequest, TResponse>` interface and adapter pattern makes cookie chunking naturally framework-compatible:
- **Next.js**: Uses Next.js cookies API through adapter
- **SvelteKit**: Uses SvelteKit cookie utilities through adapter  
- **Nuxt**: Uses H3 cookie utilities through adapter
- **Hono**: Uses Hono cookie utilities through adapter
- **Chrome Extension**: Uses Chrome cookies API through adapter

By implementing chunking in the base `CookieSessionStorage` class, all framework adapters automatically inherit the functionality without modification.

### Backward Compatibility Strategy
Critical requirement: No forced re-authentication during rollout
- **Reading**: Support both chunked and non-chunked cookies simultaneously
- **Writing**: Use chunking only when session size exceeds threshold
- **Migration**: Existing sessions continue working unchanged
- **Fallback**: Graceful handling of corrupted or partial chunks

## Technical Implementation Plan

### 1. Create Standalone Cookie Chunking Utility
**File**: `src/core/session/CookieChunker.ts`

**Core Functionality**:
```typescript
class CookieChunker {
  private readonly maxChunkSize: number;
  private readonly baseName: string;
  
  // Split large cookie value into manageable chunks
  chunk(value: string): ChunkedCookie[];
  
  // Reconstruct original value from cookie chunks
  reconstruct(cookies: Record<string, string>): string | null;
  
  // Generate cleanup cookies for old chunks
  generateCleanupCookies(): ChunkedCookie[];
}
```

**Key Implementation Details**:
- **Chunk size**: 3072 bytes (3KB) to stay well under 4KB browser limit
- **Naming pattern**: `{baseName}.{index}` (e.g., `workos_session.0`, `workos_session.1`)
- **Chunk ordering**: Numeric suffixes for predictable reconstruction
- **Size calculation**: Account for cookie metadata (name, attributes) in size limits
- **Cleanup logic**: Remove old chunks when session changes from chunked to non-chunked

### 2. Extend CookieSessionStorage Base Class
**File**: `src/core/session/CookieSessionStorage.ts`

**Enhanced Methods**:
```typescript
abstract class CookieSessionStorage<TRequest, TResponse> {
  protected chunker?: CookieChunker;
  
  // Enhanced to handle both chunked and non-chunked cookies
  protected getSessionValue(request: TRequest): Promise<string | null>;
  
  // Enhanced to use chunking when session exceeds size limit
  protected setSessionValue(response: TResponse, value: string): Promise<TResponse>;
  
  // Enhanced to clean up both regular and chunked cookies
  protected clearSessionValue(response: TResponse): Promise<TResponse>;
}
```

**Backward Compatibility**:
- Existing adapters work unchanged
- No new abstract methods required
- Chunking is internal implementation detail
- Falls back gracefully to single cookie when chunks missing

### 3. Configuration Integration
**File**: `src/core/config/types.ts`

**New Configuration Options**:
```typescript
interface AuthKitConfig {
  // Existing config...
  
  // Cookie chunking configuration
  cookieMaxSize?: number;        // Default: 3072 bytes
  enableCookieChunking?: boolean; // Default: true
}
```

**Environment Variable Mapping**:
- `WORKOS_COOKIE_MAX_SIZE`: Override default chunk size
- `WORKOS_ENABLE_COOKIE_CHUNKING`: Disable chunking if needed

### 4. Factory Pattern Integration
**File**: `src/core/createAuthKitFactory.ts`

**Configuration Flow**:
- Pass chunking configuration to storage factory
- Ensure settings are available to all adapter types
- Maintain singleton pattern with chunking state

### 5. Framework Adapter Updates (Optional)
**Files**: Various adapter implementations

**Enhanced Functionality**:
- Adapters can override chunking behavior if needed
- Framework-specific cookie utilities remain unchanged
- Chunking logic is transparent to framework integration

## Implementation Steps

### Phase 1: Core Chunking Utility
1. **Create CookieChunker class** with chunking/reconstruction logic
2. **Add comprehensive unit tests** for all chunking scenarios
3. **Test with various session sizes** to validate chunk sizing

### Phase 2: Base Class Integration  
1. **Extend CookieSessionStorage** with chunking support
2. **Ensure backward compatibility** with existing sessions
3. **Add integration tests** with real session data

### Phase 3: Configuration and Factory
1. **Add configuration options** for chunking behavior
2. **Update factory pattern** to pass chunking config
3. **Add environment variable support**

### Phase 4: Testing and Validation
1. **Cross-framework testing** with all adapters
2. **Large session testing** to verify chunking works
3. **Migration testing** to ensure no re-authentication required
4. **Performance testing** to measure chunking overhead

### Phase 5: Documentation and Migration Guide
1. **Document chunking behavior** in README
2. **Create migration guide** for authkit-nextjs adoption
3. **Add troubleshooting guide** for chunking issues

## Key Design Decisions

### 1. NextAuth Compatibility
- **Proven patterns**: Use NextAuth's successful chunking approach
- **Naming convention**: Follow `{name}.{index}` pattern for consistency
- **Size limits**: Use conservative 3KB chunks for reliability

### 2. Transparency Principle
- **No API changes**: Existing `SessionStorage` interface unchanged
- **Automatic behavior**: Chunking happens when needed, not forced
- **Graceful fallback**: Handle edge cases without breaking sessions

### 3. Framework Agnostic Design
- **Adapter independence**: Works with all current and future adapters
- **Cookie abstraction**: Chunking logic separate from framework details
- **Pluggable architecture**: Can be disabled or customized per use case

### 4. Standalone Utility Approach
- **Extraction ready**: Designed for potential move to authkit-nextjs
- **Self-contained**: Minimal dependencies on authkit-ssr internals
- **Testable**: Clear interfaces for comprehensive testing

## Migration Path for authkit-nextjs

When ready to adopt cookie chunking in authkit-nextjs:

1. **Extract chunking utility**: Move `CookieChunker` to shared location
2. **Update cookie handling**: Replace current cookie read/write with chunking versions
3. **Maintain compatibility**: Ensure existing authkit-nextjs sessions continue working
4. **Configuration mapping**: Map Next.js config to chunking options

## Expected Benefits

### Immediate Benefits
- **Prevents authentication failures** from oversized cookies
- **Framework agnostic solution** works across all adapters
- **Backward compatible** - no forced re-authentication
- **Transparent operation** - no API changes required

### Long-term Benefits  
- **Scalable session management** - handles growing token sizes
- **Proven architecture** - based on successful NextAuth patterns
- **Easy adoption** - minimal changes required for authkit-nextjs
- **Configurable behavior** - can be tuned per deployment needs

## Risk Mitigation

### Technical Risks
- **Chunk corruption**: Graceful fallback to re-authentication
- **Browser compatibility**: Conservative chunk sizes for broad support
- **Performance impact**: Minimal overhead from chunking logic

### Deployment Risks
- **Session migration**: Gradual rollout with backward compatibility
- **Configuration errors**: Sensible defaults with validation
- **Framework issues**: Isolated chunking logic minimizes integration risk

This plan provides a comprehensive approach to implementing robust cookie chunking that solves the immediate problem while setting up future flexibility for adoption across the WorkOS authentication ecosystem.