// src/core/workos.ts
import { once } from '../../utils';
import { getConfig } from '../config';
import { UserManagement } from './UserManagement';

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
      version: '0.0.1', // You could import this from package.json if needed
    },
  };

  // Initialize the WorkOS client with config values
  const workos = new UserManagement(apiKey, options);

  return workos;
}

/**
 * Create a WorkOS instance with the provided API key and optional settings.
 * This function is lazy loaded to avoid loading the WorkOS SDK when it's not needed.
 */
export const getWorkOS = once(createWorkOSInstance);
