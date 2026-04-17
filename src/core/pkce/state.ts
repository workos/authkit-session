import * as v from 'valibot';
import { SessionEncryptionError } from '../errors.js';
import type { SessionEncryption } from '../session/types.js';
import { PKCE_COOKIE_MAX_AGE } from './constants.js';

/**
 * Runtime schema for the sealed PKCE state blob.
 *
 * Validated at unseal time as defense-in-depth against any future code path
 * accidentally sealing the wrong shape. Shape mismatch is treated as an
 * integrity failure (same category as a tampered blob).
 */
export const StateSchema = v.object({
  nonce: v.string(),
  codeVerifier: v.string(),
  returnPathname: v.optional(v.string()),
  customState: v.optional(v.string()),
});

export type PKCEState = v.InferOutput<typeof StateSchema>;

/**
 * Seal a PKCE state object for use as both the OAuth `state` query param
 * and the `wos-auth-verifier` cookie value. Seal embeds a 600s TTL.
 */
export async function sealState(
  encryption: SessionEncryption,
  password: string,
  state: PKCEState,
): Promise<string> {
  return encryption.sealData(state, {
    password,
    ttl: PKCE_COOKIE_MAX_AGE,
  });
}

/**
 * Unseal a PKCE state blob, enforcing TTL and shape.
 *
 * Any failure — expired TTL, tamper, wrong password, or schema mismatch —
 * is wrapped as `SessionEncryptionError`. Callers differentiate via the
 * `cause` chain, not the message string.
 */
export async function unsealState(
  encryption: SessionEncryption,
  password: string,
  sealed: string,
): Promise<PKCEState> {
  let raw: unknown;
  try {
    raw = await encryption.unsealData<unknown>(sealed, {
      password,
      ttl: PKCE_COOKIE_MAX_AGE,
    });
  } catch (cause) {
    throw new SessionEncryptionError('Failed to unseal PKCE state', cause);
  }

  const result = v.safeParse(StateSchema, raw);
  if (!result.success) {
    throw new SessionEncryptionError(
      'Malformed PKCE state payload',
      result.issues,
    );
  }
  return result.output;
}
