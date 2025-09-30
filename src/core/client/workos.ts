import { WorkOS } from '@workos-inc/node';
import { getConfig } from '../config.js';
import { once } from '../../utils.js';
import pkg from '../../../package.json' with { type: 'json' };

/**
 * Create a WorkOS instance with the provided API key and optional settings.
 */
export function createWorkOSInstance() {
  // Get required API key from config
  const apiKey = getConfig('apiKey');

  // Get optional settings
  const apiHostname = getConfig('apiHostname');
  const apiHttps = getConfig('apiHttps');
  const apiPort = getConfig('apiPort');

  const options = {
    apiHostname,
    https: apiHttps,
    port: apiPort,
    appInfo: {
      name: 'authkit-session',
      version: pkg.version,
    },
  };

  // Initialize the WorkOS client with config values
  const workos = new WorkOS(apiKey, options);

  return workos;
}

/**
 * Create a WorkOS instance with the provided API key and optional settings.
 * This function is lazy loaded to avoid loading the WorkOS SDK when it's not needed.
 */
export const getWorkOS = once(createWorkOSInstance);
