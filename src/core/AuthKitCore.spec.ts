import { RateLimitExceededException } from '@workos-inc/node';
import { AuthKitCore } from './AuthKitCore.js';
import { SessionEncryptionError, TokenRefreshError } from './errors.js';

const mockConfig = {
  cookiePassword: 'test-password-that-is-32-chars-long!!',
  clientId: 'test-client-id',
};

const mockUser = {
  id: 'user_123',
  email: 'test@example.com',
  object: 'user',
  firstName: 'Test',
  lastName: 'User',
  name: 'Test User',
  emailVerified: true,
  profilePictureUrl: null,
  createdAt: '2023-01-01T00:00:00Z',
  updatedAt: '2023-01-01T00:00:00Z',
  lastSignInAt: '2023-01-01T00:00:00Z',
  locale: 'en-US',
  externalId: null,
  metadata: {},
} as const;

const mockClient = {
  userManagement: {
    getJwksUrl: () => 'https://api.workos.com/sso/jwks/test-client-id',
    authenticateWithRefreshToken: async () => ({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      user: mockUser,
      impersonator: undefined,
    }),
  },
};

const mockEncryption = {
  sealData: async () => 'encrypted-session-data',
  unsealData: async () => ({
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    user: mockUser,
    impersonator: undefined,
  }),
};

const newJwt =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyIsInNpZCI6InNlc3Npb25fbmV3IiwiZXhwIjozMDAwMDAwMDAwfQ.sig';

function makeExpiredSession() {
  return {
    accessToken: 'expired-jwt',
    refreshToken: 'rt-1',
    user: mockUser,
    impersonator: undefined,
  };
}

function makeCountingClient(opts?: { fail?: () => boolean }) {
  let callCount = 0;
  const { fail } = opts ?? {};
  const client = {
    userManagement: {
      getJwksUrl: () => 'https://api.workos.com/sso/jwks/test-client-id',
      authenticateWithRefreshToken: async () => {
        callCount++;
        await new Promise(r => setTimeout(r, 50));
        if (fail?.()) throw new Error('Refresh failed');
        return {
          accessToken: newJwt,
          refreshToken: 'new-rt',
          user: mockUser,
          impersonator: undefined,
        };
      },
    },
  };
  return { client, getCallCount: () => callCount };
}

/**
 * Builds a userManagement client whose first refresh attempt throws a
 * RateLimitExceededException. By default the retry succeeds; `onRetry` can make
 * the retry throw another rate-limit error or an arbitrary error instead.
 */
function createRateLimitClient(opts?: {
  retryAfter?: number | null;
  delayMs?: number;
  onRetry?: 'succeed' | 'rateLimit' | Error;
}) {
  const { retryAfter = 1, delayMs = 0, onRetry = 'succeed' } = opts ?? {};
  let callCount = 0;
  const rateLimit = () =>
    new RateLimitExceededException(
      'Too Many Requests',
      'req_1',
      retryAfter as any,
    );
  const client = {
    userManagement: {
      getJwksUrl: () => 'https://api.workos.com/sso/jwks/test-client-id',
      authenticateWithRefreshToken: async () => {
        callCount++;
        if (delayMs) await new Promise(r => setTimeout(r, delayMs));
        if (callCount === 1) throw rateLimit();
        if (onRetry === 'rateLimit') throw rateLimit();
        if (onRetry instanceof Error) throw onRetry;
        return {
          accessToken: newJwt,
          refreshToken: 'new-rt',
          user: mockUser,
          impersonator: undefined,
        };
      },
    },
  };
  return { client, getCallCount: () => callCount };
}

describe('AuthKitCore', () => {
  let core: AuthKitCore;

  beforeEach(() => {
    core = new AuthKitCore(
      mockConfig as any,
      mockClient as any,
      mockEncryption as any,
    );
  });

  describe('constructor', () => {
    it('creates instance with required dependencies', () => {
      expect(core).toBeInstanceOf(AuthKitCore);
    });
  });

  describe('parseTokenClaims()', () => {
    it('parses valid JWT payload', () => {
      const validJwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyIsInNpZCI6InNlc3Npb25fMTIzIiwiZXhwIjoxNzM2Mzc2MDAwfQ.fake-signature';

      const result = core.parseTokenClaims(validJwt);

      expect(result.sub).toBe('user_123');
      expect(result.sid).toBe('session_123');
      expect(result.exp).toBe(1736376000);
    });

    it('throws error for invalid JWT', () => {
      expect(() => core.parseTokenClaims('invalid-jwt')).toThrow(
        'Invalid token',
      );
    });

    it('supports custom claims', () => {
      const customJwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyIsImN1c3RvbUZpZWxkIjoiY3VzdG9tLXZhbHVlIn0.fake-signature';

      const result = core.parseTokenClaims<{ customField: string }>(customJwt);

      expect(result.customField).toBe('custom-value');
    });
  });

  describe('isTokenExpiring()', () => {
    it('returns true when token expires soon', () => {
      // Token expires in 5 seconds, which is within the default 10-second buffer
      const soonExpiry = Math.floor(Date.now() / 1000) + 5;
      const expiringJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${btoa(JSON.stringify({ exp: soonExpiry }))}.fake-signature`;

      const result = core.isTokenExpiring(expiringJwt);

      expect(result).toBe(true);
    });

    it('returns false when token expires later', () => {
      const laterExpiry = Math.floor(Date.now() / 1000) + 3600;
      const validJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${btoa(JSON.stringify({ exp: laterExpiry }))}.fake-signature`;

      const result = core.isTokenExpiring(validJwt);

      expect(result).toBe(false);
    });

    it('uses custom buffer time', () => {
      const expiry = Math.floor(Date.now() / 1000) + 150;
      const jwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${btoa(JSON.stringify({ exp: expiry }))}.fake-signature`;

      const result = core.isTokenExpiring(jwt, 180);

      expect(result).toBe(true);
    });

    it('returns false when token has no expiry', () => {
      const noExpiryJwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyJ9.fake-signature';

      const result = core.isTokenExpiring(noExpiryJwt);

      expect(result).toBe(false);
    });
  });

  describe('verifyToken()', () => {
    it('returns false for invalid tokens', async () => {
      const result = await core.verifyToken('invalid-token');

      expect(result).toBe(false);
    });

    it('returns false for malformed tokens', async () => {
      const result = await core.verifyToken('not.a.jwt');

      expect(result).toBe(false);
    });
  });

  describe('encryptSession()', () => {
    it('encrypts session data', async () => {
      const session = {
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        user: mockUser,
        impersonator: undefined,
      };

      const result = await core.encryptSession(session);

      expect(result).toBe('encrypted-session-data');
    });

    it('throws SessionEncryptionError on failure', async () => {
      const failingEncryption = {
        sealData: async () => {
          throw new Error('Encryption failed');
        },
        unsealData: async () => ({}),
      };
      const failingCore = new AuthKitCore(
        mockConfig as any,
        mockClient as any,
        failingEncryption as any,
      );

      await expect(
        failingCore.encryptSession({
          accessToken: 'test',
          refreshToken: 'test',
          user: mockUser,
          impersonator: undefined,
        }),
      ).rejects.toThrow(SessionEncryptionError);
    });
  });

  describe('decryptSession()', () => {
    it('decrypts session data', async () => {
      const result = await core.decryptSession('encrypted-data');

      expect(result.accessToken).toBe('test-access-token');
      expect(result.user).toEqual(mockUser);
    });

    it('throws SessionEncryptionError on failure', async () => {
      const failingEncryption = {
        sealData: async () => 'encrypted',
        unsealData: async () => {
          throw new Error('Decryption failed');
        },
      };
      const failingCore = new AuthKitCore(
        mockConfig as any,
        mockClient as any,
        failingEncryption as any,
      );

      await expect(failingCore.decryptSession('bad-data')).rejects.toThrow(
        SessionEncryptionError,
      );
    });

    it.each([
      ['string', 'hello'],
      ['number', 42],
      ['null', null],
      ['array', [1, 2, 3]],
      ['empty object', {}],
      ['missing user', { accessToken: 'at', refreshToken: 'rt' }],
      ['null user', { accessToken: 'at', refreshToken: 'rt', user: null }],
      ['missing refreshToken', { accessToken: 'at', user: { id: 'user_123' } }],
    ])(
      'throws SessionEncryptionError for invalid shape: %s',
      async (_label, badValue) => {
        const badEncryption = {
          sealData: async () => 'encrypted',
          unsealData: async () => badValue,
        };
        const badCore = new AuthKitCore(
          mockConfig as any,
          mockClient as any,
          badEncryption as any,
        );

        await expect(badCore.decryptSession('data')).rejects.toThrow(
          SessionEncryptionError,
        );
      },
    );

    it('accepts valid session shape', async () => {
      const result = await core.decryptSession('encrypted-data');

      expect(result.accessToken).toBe('test-access-token');
      expect(result.refreshToken).toBe('test-refresh-token');
      expect(result.user).toEqual(mockUser);
    });
  });

  describe('refreshTokens()', () => {
    it('refreshes tokens via WorkOS', async () => {
      const result = await core.refreshTokens('refresh-token');

      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
      expect(result.user).toEqual(mockUser);
    });

    it('includes organizationId when provided', async () => {
      const clientWithSpy = {
        userManagement: {
          getJwksUrl: () => 'https://api.workos.com/sso/jwks/test-client-id',
          authenticateWithRefreshToken: async ({ organizationId }: any) => ({
            accessToken: organizationId ? 'org-token' : 'regular-token',
            refreshToken: 'new-refresh-token',
            user: mockUser,
            impersonator: undefined,
          }),
        },
      };
      const testCore = new AuthKitCore(
        mockConfig as any,
        clientWithSpy as any,
        mockEncryption as any,
      );

      const result = await testCore.refreshTokens('refresh-token', 'org_123');

      expect(result.accessToken).toBe('org-token');
    });

    it('throws TokenRefreshError on failure', async () => {
      const failingClient = {
        userManagement: {
          getJwksUrl: () => 'https://api.workos.com/sso/jwks/test-client-id',
          authenticateWithRefreshToken: async () => {
            throw new Error('Refresh failed');
          },
        },
      };
      const failingCore = new AuthKitCore(
        mockConfig as any,
        failingClient as any,
        mockEncryption as any,
      );

      await expect(failingCore.refreshTokens('bad-token')).rejects.toThrow(
        TokenRefreshError,
      );
    });

    it('deduplicates concurrent calls with the same refresh token', async () => {
      vi.useFakeTimers();
      const { client, getCallCount } = makeCountingClient();
      const testCore = new AuthKitCore(
        mockConfig as any,
        client as any,
        mockEncryption as any,
      );

      const session = makeExpiredSession();
      const pending = Promise.all([
        testCore.validateAndRefresh(session),
        testCore.validateAndRefresh(session),
        testCore.validateAndRefresh(session),
      ]);

      await vi.advanceTimersByTimeAsync(50);
      const results = await pending;

      expect(getCallCount()).toBe(1);
      for (const r of results) {
        expect(r.refreshed).toBe(true);
        expect(r.session.accessToken).toBe(newJwt);
      }
      vi.useRealTimers();
    });

    it('propagates errors to all concurrent waiters', async () => {
      vi.useFakeTimers();
      const { client, getCallCount } = makeCountingClient({
        fail: () => true,
      });
      const testCore = new AuthKitCore(
        mockConfig as any,
        client as any,
        mockEncryption as any,
      );

      const session = makeExpiredSession();
      const pending = Promise.allSettled([
        testCore.validateAndRefresh(session),
        testCore.validateAndRefresh(session),
        testCore.validateAndRefresh(session),
      ]);

      await vi.advanceTimersByTimeAsync(50);
      const results = await pending;

      expect(getCallCount()).toBe(1);
      for (const r of results) {
        expect(r.status).toBe('rejected');
        if (r.status === 'rejected') {
          expect(r.reason).toBeInstanceOf(TokenRefreshError);
        }
      }
      vi.useRealTimers();
    });

    it('retries after a failed concurrent batch', async () => {
      vi.useFakeTimers();
      let shouldFail = true;
      const { client, getCallCount } = makeCountingClient({
        fail: () => shouldFail,
      });
      const testCore = new AuthKitCore(
        mockConfig as any,
        client as any,
        mockEncryption as any,
      );

      const session = makeExpiredSession();

      const firstBatch = Promise.allSettled([
        testCore.validateAndRefresh(session),
        testCore.validateAndRefresh(session),
      ]);
      await vi.advanceTimersByTimeAsync(50);
      await firstBatch;
      expect(getCallCount()).toBe(1);

      shouldFail = false;
      const retryPending = testCore.validateAndRefresh(session);
      await vi.advanceTimersByTimeAsync(50);
      const result = await retryPending;
      expect(getCallCount()).toBe(2);
      expect(result.refreshed).toBe(true);
      expect(result.session.accessToken).toBe(newJwt);
      vi.useRealTimers();
    });

    it('deduplicates separately per organizationId', async () => {
      vi.useFakeTimers();
      const { client, getCallCount } = makeCountingClient();
      const testCore = new AuthKitCore(
        mockConfig as any,
        client as any,
        mockEncryption as any,
      );

      const session = makeExpiredSession();
      const pending = Promise.all([
        testCore.validateAndRefresh(session, { organizationId: 'org_a' }),
        testCore.validateAndRefresh(session, { organizationId: 'org_b' }),
      ]);

      await vi.advanceTimersByTimeAsync(50);
      await pending;

      expect(getCallCount()).toBe(2);
      vi.useRealTimers();
    });

    it('retries once after a RateLimitExceededException', async () => {
      vi.useFakeTimers();
      const { client, getCallCount } = createRateLimitClient({ retryAfter: 2 });
      const testCore = new AuthKitCore(
        mockConfig as any,
        client as any,
        mockEncryption as any,
      );

      const pending = testCore.refreshTokens('rt-1');
      await vi.advanceTimersByTimeAsync(2000);
      const result = await pending;

      expect(getCallCount()).toBe(2);
      expect(result.accessToken).toBe(newJwt);
      vi.useRealTimers();
    });

    it('honors retryAfter from the exception', async () => {
      vi.useFakeTimers();
      const { client, getCallCount } = createRateLimitClient({ retryAfter: 5 });
      const testCore = new AuthKitCore(
        mockConfig as any,
        client as any,
        mockEncryption as any,
      );

      const pending = testCore.refreshTokens('rt-1');
      // Advance less than the retryAfter — should not have retried yet
      await vi.advanceTimersByTimeAsync(3000);
      expect(getCallCount()).toBe(1);
      // Advance past retryAfter
      await vi.advanceTimersByTimeAsync(2000);
      const result = await pending;

      expect(getCallCount()).toBe(2);
      expect(result.accessToken).toBe(newJwt);
      vi.useRealTimers();
    });

    it('defaults to 1s delay when retryAfter is null', async () => {
      vi.useFakeTimers();
      const { client, getCallCount } = createRateLimitClient({
        retryAfter: null,
      });
      const testCore = new AuthKitCore(
        mockConfig as any,
        client as any,
        mockEncryption as any,
      );

      const pending = testCore.refreshTokens('rt-1');
      await vi.advanceTimersByTimeAsync(1000);
      const result = await pending;

      expect(getCallCount()).toBe(2);
      expect(result.accessToken).toBe(newJwt);
      vi.useRealTimers();
    });

    it('throws TokenRefreshError when retry also hits rate limit', async () => {
      vi.useFakeTimers();
      const { client } = createRateLimitClient({
        retryAfter: 1,
        onRetry: 'rateLimit',
      });
      const testCore = new AuthKitCore(
        mockConfig as any,
        client as any,
        mockEncryption as any,
      );

      const pending = testCore.refreshTokens('rt-1').catch(e => e);
      await vi.advanceTimersByTimeAsync(1000);
      const error = await pending;

      expect(error).toBeInstanceOf(TokenRefreshError);
      expect(error.message).toContain('after rate-limit retry');
      // Cause chain: TokenRefreshError → RateLimitExceededException (retry) → RateLimitExceededException (original)
      expect(error.cause).toBeInstanceOf(RateLimitExceededException);
      expect((error.cause as any).cause).toBeInstanceOf(
        RateLimitExceededException,
      );
      vi.useRealTimers();
    });

    it('caps retryAfter at 10s', async () => {
      vi.useFakeTimers();
      const { client, getCallCount } = createRateLimitClient({
        retryAfter: 300,
      });
      const testCore = new AuthKitCore(
        mockConfig as any,
        client as any,
        mockEncryption as any,
      );

      const pending = testCore.refreshTokens('rt-1');
      // Should be capped at 10s, not 300s
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await pending;

      expect(getCallCount()).toBe(2);
      expect(result.accessToken).toBe(newJwt);
      vi.useRealTimers();
    });

    it('clamps sub-1s retryAfter up to a 1s floor', async () => {
      vi.useFakeTimers();
      const { client, getCallCount } = createRateLimitClient({
        retryAfter: 0.3,
      });
      const testCore = new AuthKitCore(
        mockConfig as any,
        client as any,
        mockEncryption as any,
      );

      const pending = testCore.refreshTokens('rt-1');
      // 0.3s would be enough without a floor — the retry must NOT have fired yet
      await vi.advanceTimersByTimeAsync(300);
      expect(getCallCount()).toBe(1);
      // Past the 1s floor — retry fires
      await vi.advanceTimersByTimeAsync(700);
      const result = await pending;

      expect(getCallCount()).toBe(2);
      expect(result.accessToken).toBe(newJwt);
      vi.useRealTimers();
    });

    it('defaults to 1s for non-finite retryAfter values', async () => {
      vi.useFakeTimers();
      const { client, getCallCount } = createRateLimitClient({
        retryAfter: Infinity,
      });
      const testCore = new AuthKitCore(
        mockConfig as any,
        client as any,
        mockEncryption as any,
      );

      const pending = testCore.refreshTokens('rt-1');
      await vi.advanceTimersByTimeAsync(1000);
      const result = await pending;

      expect(getCallCount()).toBe(2);
      expect(result.accessToken).toBe(newJwt);
      vi.useRealTimers();
    });

    it('wraps non-rate-limit retry errors correctly', async () => {
      vi.useFakeTimers();
      const { client, getCallCount } = createRateLimitClient({
        retryAfter: 1,
        onRetry: new Error('Network failure'),
      });
      const testCore = new AuthKitCore(
        mockConfig as any,
        client as any,
        mockEncryption as any,
      );

      const pending = testCore.refreshTokens('rt-1').catch(e => e);
      await vi.advanceTimersByTimeAsync(1000);
      const error = await pending;

      expect(getCallCount()).toBe(2);
      expect(error).toBeInstanceOf(TokenRefreshError);
      expect(error.message).toContain('after rate-limit retry');
      expect(error.cause).toBeInstanceOf(Error);
      expect((error.cause as Error).message).toBe('Network failure');
      // Original rate-limit error preserved in chain
      expect((error.cause as Error).cause).toBeInstanceOf(
        RateLimitExceededException,
      );
      vi.useRealTimers();
    });

    it('shares retry result with concurrent dedup waiters', async () => {
      vi.useFakeTimers();
      const { client, getCallCount } = createRateLimitClient({
        retryAfter: 1,
        delayMs: 50,
      });
      const testCore = new AuthKitCore(
        mockConfig as any,
        client as any,
        mockEncryption as any,
      );

      const pending = Promise.all([
        testCore.refreshTokens('rt-1'),
        testCore.refreshTokens('rt-1'),
        testCore.refreshTokens('rt-1'),
      ]);

      // First attempt (50ms) + retry delay (1000ms) + retry attempt (50ms)
      await vi.advanceTimersByTimeAsync(1100);
      const results = await pending;

      expect(getCallCount()).toBe(2);
      for (const r of results) {
        expect(r.accessToken).toBe(newJwt);
      }
      vi.useRealTimers();
    });
  });

  describe('validateAndRefresh()', () => {
    const oldJwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyIsInNpZCI6InNlc3Npb25fOTk5IiwiZXhwIjoxMDAwMDAwMDAwLCJvcmdfaWQiOiJvcmdfYWJjIn0.sig';

    function makeRefreshClient(capture?: { opts?: any }) {
      return {
        userManagement: {
          getJwksUrl: () => 'https://api.workos.com/sso/jwks/test-client-id',
          authenticateWithRefreshToken: async (opts: any) => {
            if (capture) capture.opts = opts;
            return {
              accessToken: newJwt,
              refreshToken: 'new-rt',
              user: mockUser,
              impersonator: undefined,
            };
          },
        },
      };
    }

    it('forces refresh when token invalid and returns new session', async () => {
      const testCore = new AuthKitCore(
        mockConfig as any,
        makeRefreshClient() as any,
        mockEncryption as any,
      );
      const session = {
        accessToken: oldJwt,
        refreshToken: 'rt',
        user: mockUser,
        impersonator: undefined,
      };

      const result = await testCore.validateAndRefresh(session);

      expect(result.refreshed).toBe(true);
      expect(result.session.accessToken).toBe(newJwt);
    });

    it('propagates explicit organizationId into refresh', async () => {
      const capture: { opts?: any } = {};
      const testCore = new AuthKitCore(
        mockConfig as any,
        makeRefreshClient(capture) as any,
        mockEncryption as any,
      );

      await testCore.validateAndRefresh(
        {
          accessToken: oldJwt,
          refreshToken: 'rt',
          user: mockUser,
          impersonator: undefined,
        },
        { organizationId: 'org_explicit' },
      );

      expect(capture.opts?.organizationId).toBe('org_explicit');
    });

    it('continues when access token is unparseable', async () => {
      const testCore = new AuthKitCore(
        mockConfig as any,
        makeRefreshClient() as any,
        mockEncryption as any,
      );
      const session = {
        accessToken: 'not-a-jwt',
        refreshToken: 'rt',
        user: mockUser,
        impersonator: undefined,
      };

      const result = await testCore.validateAndRefresh(session);

      expect(result.refreshed).toBe(true);
    });
  });

  describe('verifyCallbackState()', () => {
    it('throws OAuthStateMismatchError when stateFromUrl missing', async () => {
      await expect(
        core.verifyCallbackState({
          stateFromUrl: undefined,
          cookieValue: 'x',
        }),
      ).rejects.toMatchObject({ name: 'OAuthStateMismatchError' });
    });

    it('throws PKCECookieMissingError when cookie missing', async () => {
      await expect(
        core.verifyCallbackState({
          stateFromUrl: 'x',
          cookieValue: undefined,
        }),
      ).rejects.toMatchObject({ name: 'PKCECookieMissingError' });
    });

    it('throws OAuthStateMismatchError when values differ', async () => {
      await expect(
        core.verifyCallbackState({ stateFromUrl: 'a', cookieValue: 'b' }),
      ).rejects.toMatchObject({ name: 'OAuthStateMismatchError' });
    });
  });
});
