When a session's access token has expired and the refresh fails, `withAuth()` now tells the caller whether the failure is temporary or the session is over, so an adapter can keep the cookie through a WorkOS blip instead of signing everyone out.

Closes #65

## What changes for adapter authors

`withAuth()` still never throws. When the refresh fails, it now returns a `refreshError` next to `auth.user === null`:

```ts
const { auth, refreshedSessionData, refreshError } =
  await authService.withAuth(request);

// refreshError?: { retryable: boolean; reason: RefreshFailureReason }
if (refreshError?.retryable) {
  // Network error, timeout, 429 or 5xx. Keep the session cookie and treat
  // this request as signed out; a later request retries the refresh.
} else if (refreshError) {
  // invalid_grant, an authentication step such as mfa_enrollment or
  // sso_required, another 4xx, or an unrecognized error. Clear the cookie
  // and sign in again.
}
```

- `reason` is one of `network_error`, `timeout`, `rate_limited`, `server_error` (all retryable), or `invalid_grant`, the WorkOS authentication-step codes (`email_verification_required`, `organization_selection_required`, `mfa_enrollment`, `mfa_challenge`, `mfa_verification`, `radar_email_challenge`, `radar_sms_challenge`, `sso_required`), `http_error`, `unknown` (all terminal).
- The key is only there when a refresh was attempted and failed. No cookie, an undecryptable cookie, a valid session and a successful refresh return exactly what they did before, with no `refreshError` key.
- `TokenRefreshError` gains readonly `retryable` and `reason` fields, so callers of `refreshSession()` / `switchOrganization()` get the same information. Existing constructor calls keep working: the classification is two new optional fields on the existing context argument, and an error built the old way is terminal with reason `unknown`.
- New exported types: `RefreshFailure`, `RefreshFailureReason`, `TokenRefreshErrorContext`.

## How failures are classified

Classification uses the error's shape (`status`, `error`/`code` strings, `rawData`, `name`, the `cause` chain) rather than `instanceof`, because exception classes differ across the supported `@workos-inc/node` majors (v8 has no `AuthenticationException`, for example).

- Retryable statuses are 408, 429, 500, 502, 503 and 504, the same set authkit-nextjs uses and the v12 SDK retries internally. Other 5xx such as 501 are terminal.
- Network failures are a fetch `TypeError` (also when the SDK wraps it), abort and timeout errors, and Node codes such as `ECONNRESET` or `ETIMEDOUT` anywhere on the cause chain.
- **Unrecognized errors are terminal** (`unknown`), matching authkit-nextjs, so the adapters behave alike.
- **One deliberate difference from authkit-nextjs:** a 5xx whose body isn't JSON (for example a load balancer's HTML 502 page) is retryable here. The SDK reports it as a plain `Error` wrapping a `ParseError` with the real status in `rawStatus`, and authkit-nextjs only reads a top-level `status`, so it treats that case as terminal. Seen with `@workos-inc/node` 12.1.0, and the same wrapping is in the 8.0.0 source.

## What this does not change

- During an outage, each request still waits for the WorkOS SDK's own retries and request timeout, plus this package's one rate-limit retry, before `withAuth()` gives up. This only changes what happens to the cookie afterwards.
- Adapters still have to act on `refreshError`. authkit-tanstack-start and the other adapters need their own follow-up to keep the cookie on retryable failures and clear it on terminal ones.
