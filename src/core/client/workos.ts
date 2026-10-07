import { WorkOS } from '@workos-inc/node';
import { getConfig } from '../config.js';
import { once } from '../../utils.js';
import pkg from '../../../package.json' with { type: 'json' };

/**
 * Create a WorkOS instance from the AuthKit configuration.
 *
 * With an API key this is a confidential client. Without one it is a PKCE
 * public client: sign-in, callback, refresh and sign-out work, but WorkOS
 * management APIs throw an `ApiKeyRequiredException` before any request.
 *
 * Note: when no API key is configured, the WorkOS SDK itself falls back to
 * `process.env.WORKOS_API_KEY`. So if that variable is set in the process
 * environment, a key is always in play, even when a custom value source
 * passed to `configure()` doesn't provide one.
 */
export function createWorkOSInstance() {
  return new WorkOS({
    // Optional: absent means public-client (keyless) mode
    apiKey: getConfig('apiKey'),
    clientId: getConfig('clientId'),
    apiHostname: getConfig('apiHostname'),
    https: getConfig('apiHttps'),
    port: getConfig('apiPort'),
    appInfo: {
      name: 'authkit-session',
      version: pkg.version,
    },
  });
}

/**
 * Returns the shared WorkOS client used by AuthKit.
 * This function is lazy loaded to avoid loading the WorkOS SDK when it's not needed.
 *
 * Calling WorkOS management APIs directly (e.g. `getWorkOS().organizations`,
 * `getWorkOS().userManagement.getUser`) requires an API key
 * (`WORKOS_API_KEY` or `configure({ apiKey })`). In public-client (keyless)
 * mode those calls throw an `ApiKeyRequiredException` before any request.
 */
export const getWorkOS = once(createWorkOSInstance);
