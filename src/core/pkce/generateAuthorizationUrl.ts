import type { WorkOS } from '@workos-inc/node';
import type { AuthKitConfig } from '../config/types.js';
import { PKCEPayloadTooLargeError } from '../errors.js';
import { serializeCookie } from '../session/serializeCookie.js';
import type {
  CookieOptions,
  GetAuthorizationUrlOptions,
  SessionEncryption,
} from '../session/types.js';
import { getPKCECookieNameForState } from './cookieName.js';
import { getPKCECookieOptions } from './cookieOptions.js';
import { sealState } from './state.js';

/**
 * Maximum UTF-8 byte length for caller-supplied `options.state`. Enforced
 * as an early, user-facing check so large custom state fails with a clear
 * error before any crypto work — ahead of the authoritative sealed-cookie
 * length guard below.
 */
export const PKCE_MAX_STATE_BYTES = 2048;

/**
 * Maximum serialized `Set-Cookie` header length (bytes) for the verifier.
 * Browsers start dropping cookies past ~4096 bytes per RFC 6265; 3800
 * leaves headroom for proxies that cap lower and for the handful of
 * cookie attributes whose size isn't known until serialization time
 * (notably `Domain=` when `cookieDomain` is set).
 */
export const PKCE_MAX_COOKIE_BYTES = 3800;

/**
 * Internal authorization-URL generation result.
 *
 * Not exported: AuthService consumes `sealedState` + `cookieOptions` to write
 * the verifier cookie via `storage.setCookie`, then returns only `{ url, response?, headers? }`
 * to callers.
 */
export interface GeneratedAuthorizationUrl {
  url: string;
  sealedState: string;
  cookieName: string;
  cookieOptions: CookieOptions;
}

/**
 * Generate a WorkOS authorization URL bound to a PKCE verifier.
 *
 * Returns the URL, the sealed state blob (used as both the OAuth `state`
 * query param AND the cookie value — identical string; the callback does a
 * byte-compare before decrypting), and the cookie options the verifier
 * cookie should be written with.
 */
export async function generateAuthorizationUrl(params: {
  client: WorkOS;
  config: AuthKitConfig;
  encryption: SessionEncryption;
  options: GetAuthorizationUrlOptions;
}): Promise<GeneratedAuthorizationUrl> {
  const { client, config, encryption, options } = params;
  const redirectUri = options.redirectUri ?? config.redirectUri;

  // Early bound on caller-supplied `state` so oversized input fails with a
  // clear error before any crypto work. The authoritative guard on the
  // serialized cookie runs below — this one just avoids confusing users.
  if (options.state !== undefined) {
    const stateBytes = new TextEncoder().encode(options.state).byteLength;
    if (stateBytes > PKCE_MAX_STATE_BYTES) {
      throw new PKCEPayloadTooLargeError(
        `Custom OAuth state is ${stateBytes} bytes, exceeds supported limit of ${PKCE_MAX_STATE_BYTES} bytes. ` +
          `The sealed state is stored as the wos-auth-verifier cookie; oversized values would be silently dropped by the browser.`,
      );
    }
  }

  const pkce = await client.pkce.generate();
  const nonce = crypto.randomUUID();

  const sealedState = await sealState(encryption, config.cookiePassword, {
    nonce,
    codeVerifier: pkce.codeVerifier,
    returnPathname: options.returnPathname,
    customState: options.state,
    // Persisted so handleCallback's verifier-delete cookie uses the same
    // computed attributes as the original setCookie — notably `secure`,
    // which depends on the redirect URI's protocol.
    redirectUri: options.redirectUri,
  });

  // Authoritative guard: measure the actual Set-Cookie header the adapter
  // will emit. Catches cases the input-only check can't, like oversized
  // returnPathname combined with near-max state, or an unusually long
  // cookieDomain attribute.
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

  const url = client.userManagement.getAuthorizationUrl({
    provider: 'authkit',
    clientId: config.clientId,
    redirectUri,
    screenHint: options.screenHint,
    organizationId: options.organizationId,
    loginHint: options.loginHint,
    prompt: options.prompt,
    state: sealedState,
    codeChallenge: pkce.codeChallenge,
    codeChallengeMethod: pkce.codeChallengeMethod,
  });

  return {
    url,
    sealedState,
    cookieName,
    cookieOptions,
  };
}
