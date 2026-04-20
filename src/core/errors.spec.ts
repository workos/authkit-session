import {
  AuthKitError,
  OAuthStateMismatchError,
  PKCECookieMissingError,
  PKCEPayloadTooLargeError,
  SessionEncryptionError,
  TokenValidationError,
  TokenRefreshError,
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
