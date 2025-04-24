import { version } from '../../../package.json';
import { WorkOSLite } from './WorkOSLite';
import { once } from '../../utils';
import { getConfig } from '../config';

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
  const clientId = getConfig('clientId');

  const options = {
    apiHostname,
    https: apiHttps,
    port: apiPort,
    clientId,
    appInfo: {
      name: 'authkit-ssr',
      version,
    },
  };

  // Initialize the WorkOS client with config values
  // TODO: allow this to use the client from @workos-inc/node
  const workos = new WorkOSLite(apiKey, options);

  return workos;
}

/**
 * Create a WorkOS instance with the provided API key and optional settings.
 * This function is lazy loaded to avoid loading the WorkOS SDK when it's not needed.
 */
export const getWorkOS = once(createWorkOSInstance);
