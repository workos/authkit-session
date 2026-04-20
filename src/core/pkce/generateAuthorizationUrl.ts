import type { WorkOS } from '@workos-inc/node';
import type { AuthKitConfig } from '../config/types.js';
import type {
  CookieOptions,
  GetAuthorizationUrlOptions,
  SessionEncryption,
} from '../session/types.js';
import { getPKCECookieOptions } from './cookieOptions.js';
import { sealState } from './state.js';

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
    cookieOptions: getPKCECookieOptions(config, redirectUri),
  };
}
