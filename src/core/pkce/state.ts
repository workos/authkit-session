import * as v from 'valibot';
import { SessionEncryptionError } from '../errors.js';
import type { SessionEncryption } from '../session/types.js';
import { PKCE_COOKIE_MAX_AGE } from './constants.js';

/**
 * Clock-skew tolerance (ms) for the payload-level `issuedAt` check.
 *
 * Applied asymmetrically, only to the negative (future-`issuedAt`) side:
 * allows a sign-in issued on node A to be verified on node B whose clock
 * is up to 60s behind without failing a legitimate callback. The upper
 * bound (expiry) is strict — `PKCE_COOKIE_MAX_AGE` with no grace — so
 * this payload check is always at least as strict as iron-webcrypto's
 * symmetric 60s skew on `ttl`, making it the authoritative expiry guard
 * regardless of how a custom `SessionEncryption` adapter treats `ttl`.
 */
const PKCE_CLOCK_SKEW_MS = 60_000;

/**
 * Runtime schema for the sealed PKCE state blob.
 *
 * Validated at unseal time as defense-in-depth against any future code path
 * accidentally sealing the wrong shape. Shape mismatch is treated as an
 * integrity failure (same category as a tampered blob).
 *
 * `issuedAt` (ms since epoch) lets `unsealState` enforce the TTL on its own
 * rather than trusting the encryption adapter's `ttl` handling. Custom
 * `SessionEncryption` implementations may silently ignore the `ttl` field —
 * the payload-level age check closes that gap.
 */
export const StateSchema = v.object({
  nonce: v.string(),
  codeVerifier: v.string(),
  issuedAt: v.number(),
  returnPathname: v.optional(v.string()),
  customState: v.optional(v.string()),
  // Stamped only when a caller passed a per-call `redirectUri` override at
  // `createSignIn` time. Lets `handleCallback` recover the exact cookie path
  // used at sign-in so the verifier-delete `Set-Cookie` `Path` attribute
  // matches — no orphaned cookies under per-call overrides.
  redirectUri: v.optional(v.string()),
});

export type PKCEState = v.InferOutput<typeof StateSchema>;

export type PKCEStateInput = Omit<PKCEState, 'issuedAt'>;

/**
 * Seal a PKCE state object for use as both the OAuth `state` query param
 * and the `wos-auth-verifier` cookie value. Seal embeds a 600s TTL and
 * stamps `issuedAt` so the unseal path can enforce age independently.
 */
export async function sealState(
  encryption: SessionEncryption,
  password: string,
  state: PKCEStateInput,
): Promise<string> {
  return encryption.sealData(
    { ...state, issuedAt: Date.now() },
    {
      password,
      ttl: PKCE_COOKIE_MAX_AGE,
    },
  );
}

/**
 * Unseal a PKCE state blob, enforcing TTL and shape.
 *
 * Age is verified twice:
 * 1. The encryption adapter's `ttl` check (iron-webcrypto enforces this by
 *    default — custom adapters MAY ignore it).
 * 2. A payload-level `issuedAt` comparison against `Date.now()`. This is the
 *    authoritative check — it runs regardless of how the adapter treats
 *    `ttl`.
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

  const ageMs = Date.now() - result.output.issuedAt;
  if (ageMs < -PKCE_CLOCK_SKEW_MS || ageMs > PKCE_COOKIE_MAX_AGE * 1000) {
    throw new SessionEncryptionError('PKCE state expired');
  }

  return result.output;
}
