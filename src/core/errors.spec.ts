import {
  AuthenticationException,
  GenericServerException,
  OauthException,
  RateLimitExceededException,
  UnauthorizedException,
} from '@workos-inc/node';
import {
  AuthKitError,
  classifyRefreshFailure,
  OAuthStateMismatchError,
  PKCECookieMissingError,
  PKCEPayloadTooLargeError,
  SessionEncryptionError,
  TokenValidationError,
  TokenRefreshError,
  type RefreshFailureReason,
} from './errors.js';

describe('AuthKitError', () => {
  it('carries message, cause, and arbitrary data', () => {
    const cause = new Error('Original');
    const data = { userId: '123' };
    const error = new AuthKitError('Test', cause, data);

    expect(error.message).toBe('Test');
    expect(error.name).toBe('AuthKitError');
    expect(error.cause).toBe(cause);
    expect(error.data).toEqual(data);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('TokenRefreshError context', () => {
  it('captures optional userId and sessionId', () => {
    const error = new TokenRefreshError('Refresh failed', undefined, {
      userId: 'user_123',
      sessionId: 'session_456',
    });

    expect(error.userId).toBe('user_123');
    expect(error.sessionId).toBe('session_456');
  });

  it('leaves context fields undefined when omitted', () => {
    const error = new TokenRefreshError('Refresh failed');

    expect(error.userId).toBeUndefined();
    expect(error.sessionId).toBeUndefined();
  });
});

describe('error subclasses', () => {
  const cases: Array<[string, new (msg: string) => AuthKitError]> = [
    ['SessionEncryptionError', SessionEncryptionError],
    ['TokenValidationError', TokenValidationError],
    ['TokenRefreshError', TokenRefreshError],
    ['OAuthStateMismatchError', OAuthStateMismatchError],
    ['PKCECookieMissingError', PKCECookieMissingError],
    ['PKCEPayloadTooLargeError', PKCEPayloadTooLargeError],
  ];

  it.each(cases)(
    '%s preserves name, message, and AuthKitError inheritance',
    (name, Ctor) => {
      const error = new Ctor('msg');

      expect(error.name).toBe(name);
      expect(error.message).toBe('msg');
      expect(error).toBeInstanceOf(Ctor);
      expect(error).toBeInstanceOf(AuthKitError);
      expect(() => {
        throw error;
      }).toThrow(AuthKitError);
    },
  );
});

// How the SDK reports an error response whose body isn't JSON: a plain Error
// wrapping a ParseError (status 500) that has the real status as rawStatus.
function wrappedParseError(rawStatus?: number) {
  const parseError = Object.assign(
    new Error(`Unexpected token '<', "<html>" is not valid JSON`),
    { name: 'ParseError', status: 500 },
    rawStatus === undefined ? {} : { rawStatus },
  );
  return new Error(`Unexpected error: ${parseError}`, { cause: parseError });
}

describe('refresh failure classification', () => {
  const retryable: Array<[string, unknown, RefreshFailureReason]> = [
    [
      'HTTP 408 (SDK request timeout)',
      new OauthException(408, 'req_1', 'Request timeout', undefined, {}),
      'timeout',
    ],
    [
      'HTTP 429',
      new RateLimitExceededException('Too Many Requests', 'req_1', null),
      'rate_limited',
    ],
    [
      'HTTP 500',
      new GenericServerException(500, undefined, {}, 'req_1'),
      'server_error',
    ],
    [
      'HTTP 502',
      new GenericServerException(502, undefined, {}, 'req_1'),
      'server_error',
    ],
    [
      'HTTP 503',
      new GenericServerException(503, undefined, {}, 'req_1'),
      'server_error',
    ],
    [
      'HTTP 504',
      new GenericServerException(504, undefined, {}, 'req_1'),
      'server_error',
    ],
    [
      'a bare network TypeError',
      new TypeError('fetch failed'),
      'network_error',
    ],
    [
      'a network TypeError wrapped by the SDK',
      new Error('Unexpected error: TypeError: fetch failed', {
        cause: new TypeError('fetch failed'),
      }),
      'network_error',
    ],
    [
      // The wrapper is a plain Error, so only the cause's code can match.
      'a Node connection error code on a nested cause',
      new Error('Unexpected error', {
        cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }),
      }),
      'network_error',
    ],
    [
      'a Node timeout error code on a nested cause',
      new Error('Unexpected error', {
        cause: Object.assign(new Error('connect'), { code: 'ETIMEDOUT' }),
      }),
      'timeout',
    ],
    [
      'an AbortError',
      new DOMException('This operation was aborted', 'AbortError'),
      'timeout',
    ],
    [
      'a TimeoutError',
      new DOMException('The operation timed out', 'TimeoutError'),
      'timeout',
    ],
    [
      'ETIMEDOUT under a fetch TypeError',
      new TypeError('fetch failed', {
        cause: Object.assign(new Error('connect'), { code: 'ETIMEDOUT' }),
      }),
      'timeout',
    ],
    [
      'a plain object with a retryable status (shape, not instanceof)',
      { status: 503 },
      'server_error',
    ],
  ];

  it.each(retryable)('%s is retryable', (_label, error, reason) => {
    expect(classifyRefreshFailure(error)).toEqual({ retryable: true, reason });
  });

  const terminal: Array<[string, unknown, RefreshFailureReason]> = [
    [
      'invalid_grant',
      new OauthException(
        400,
        'req_1',
        'invalid_grant',
        'Session has already ended.',
        {},
      ),
      'invalid_grant',
    ],
    [
      'mfa_enrollment',
      new AuthenticationException(
        403,
        { code: 'mfa_enrollment', message: 'Enroll in MFA' },
        'req_1',
      ),
      'mfa_enrollment',
    ],
    [
      'sso_required',
      new AuthenticationException(
        403,
        { error: 'sso_required', error_description: 'SSO required' },
        'req_1',
      ),
      'sso_required',
    ],
    [
      'sso_required as an OauthException (pre-v12 shape)',
      new OauthException(403, 'req_1', 'sso_required', 'SSO required', {}),
      'sso_required',
    ],
    [
      'an auth code only in rawData (v8 GenericServerException shape)',
      new GenericServerException(
        403,
        'Email verification required',
        { code: 'email_verification_required' },
        'req_1',
      ),
      'email_verification_required',
    ],
    [
      'a plain 400',
      new GenericServerException(400, 'Bad request', {}, 'req_1'),
      'http_error',
    ],
    ['a plain 401', new UnauthorizedException('req_1'), 'http_error'],
    [
      'a plain 403',
      new GenericServerException(403, 'Forbidden', {}, 'req_1'),
      'http_error',
    ],
    [
      'a 5xx the SDK does not retry (501)',
      new GenericServerException(501, 'Not Implemented', {}, 'req_1'),
      'http_error',
    ],
    ['a bare Error', new Error('x'), 'unknown'],
    [
      'a programming TypeError',
      new TypeError("Cannot read properties of undefined (reading 'x')"),
      'unknown',
    ],
    ['a string', 'boom', 'unknown'],
    ['undefined', undefined, 'unknown'],
  ];

  it.each(terminal)('%s is terminal', (_label, error, reason) => {
    expect(classifyRefreshFailure(error)).toEqual({ retryable: false, reason });
  });

  it('treats a wrapped non-JSON 502 as a retryable server_error', () => {
    expect(classifyRefreshFailure(wrappedParseError(502))).toEqual({
      retryable: true,
      reason: 'server_error',
    });
  });

  it('treats a wrapped non-JSON 403 as terminal', () => {
    expect(classifyRefreshFailure(wrappedParseError(403))).toEqual({
      retryable: false,
      reason: 'http_error',
    });
  });

  it('treats a wrapped parse error with no rawStatus as terminal', () => {
    expect(classifyRefreshFailure(wrappedParseError())).toEqual({
      retryable: false,
      reason: 'unknown',
    });
  });

  it('stops on a cause cycle', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    a.cause = b;

    expect(classifyRefreshFailure(a)).toEqual({
      retryable: false,
      reason: 'unknown',
    });
  });

  it('TokenRefreshError built with the old arguments is terminal and unknown', () => {
    const cause = new TypeError('fetch failed');
    const error = new TokenRefreshError('Refresh failed', cause, {
      userId: 'user_123',
      sessionId: 'session_456',
    });

    expect(error.message).toBe('Refresh failed');
    expect(error.cause).toBe(cause);
    expect(error.userId).toBe('user_123');
    expect(error.sessionId).toBe('session_456');
    expect(error.retryable).toBe(false);
    expect(error.reason).toBe('unknown');
    expect(new TokenRefreshError('msg').retryable).toBe(false);
    expect(new TokenRefreshError('msg').reason).toBe('unknown');
  });

  it('TokenRefreshError carries a classification passed in its context', () => {
    const error = new TokenRefreshError('Refresh failed', undefined, {
      userId: 'user_123',
      retryable: true,
      reason: 'server_error',
    });

    expect(error.userId).toBe('user_123');
    expect(error.retryable).toBe(true);
    expect(error.reason).toBe('server_error');
  });
});
