import type { WorkOS } from '@workos-inc/node';
import type { AuthKitConfig } from '../config/types.js';
import type {
  GetAuthorizationUrlOptions,
  GetAuthorizationUrlResult,
  SessionEncryption,
} from '../session/types.js';
import { getPKCECookieOptions } from './cookieOptions.js';
import { sealState } from './state.js';

/**
 * Generate a WorkOS authorization URL bound to a PKCE verifier.
 *
 * Returns the URL, the sealed state blob (used as both the OAuth `state`
 * query param AND the cookie value — identical string; the callback does a
 * byte-compare before decrypting), and the cookie options the adapter should
 * apply when setting `wos-auth-verifier`.
 */
export async function generateAuthorizationUrl(params: {
  client: WorkOS;
  config: AuthKitConfig;
  encryption: SessionEncryption;
  options: GetAuthorizationUrlOptions;
}): Promise<GetAuthorizationUrlResult> {
  const { client, config, encryption, options } = params;
  const redirectUri = options.redirectUri ?? config.redirectUri;

  const pkce = await client.pkce.generate();
  const nonce = crypto.randomUUID();

  const sealedState = await sealState(encryption, config.cookiePassword, {
    nonce,
    codeVerifier: pkce.codeVerifier,
    returnPathname: options.returnPathname,
    customState: options.state,
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
