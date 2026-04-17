import {
  AuthKitError,
  OAuthStateMismatchError,
  PKCECookieMissingError,
  SessionEncryptionError,
  TokenValidationError,
  TokenRefreshError,
} from './errors.js';

describe('AuthKitError', () => {
  it('creates error with message', () => {
    const error = new AuthKitError('Test error');

    expect(error.message).toBe('Test error');
    expect(error.name).toBe('AuthKitError');
    expect(error).toBeInstanceOf(Error);
  });

  it('creates error with cause', () => {
    const originalError = new Error('Original error');
    const error = new AuthKitError('Test error', originalError);

    expect(error.cause).toBe(originalError);
  });

  it('creates error with data', () => {
    const data = { userId: '123', action: 'login' };
    const error = new AuthKitError('Test error', undefined, data);

    expect(error.data).toEqual(data);
  });

  it('creates error with cause and data', () => {
    const originalError = new Error('Original error');
    const data = { userId: '123' };
    const error = new AuthKitError('Test error', originalError, data);

    expect(error.cause).toBe(originalError);
    expect(error.data).toEqual(data);
  });
});

describe('SessionEncryptionError', () => {
  it('creates error with correct name', () => {
    const error = new SessionEncryptionError('Encryption failed');

    expect(error.name).toBe('SessionEncryptionError');
    expect(error.message).toBe('Encryption failed');
    expect(error).toBeInstanceOf(AuthKitError);
    expect(error).toBeInstanceOf(Error);
  });

  it('creates error with cause', () => {
    const originalError = new Error('Crypto error');
    const error = new SessionEncryptionError(
      'Encryption failed',
      originalError,
    );

    expect(error.cause).toBe(originalError);
  });
});

describe('TokenValidationError', () => {
  it('creates error with correct name', () => {
    const error = new TokenValidationError('Token invalid');

    expect(error.name).toBe('TokenValidationError');
    expect(error.message).toBe('Token invalid');
    expect(error).toBeInstanceOf(AuthKitError);
    expect(error).toBeInstanceOf(Error);
  });

  it('creates error with cause', () => {
    const originalError = new Error('JWT malformed');
    const error = new TokenValidationError('Token invalid', originalError);

    expect(error.cause).toBe(originalError);
  });
});

describe('TokenRefreshError', () => {
  it('creates error with correct name', () => {
    const error = new TokenRefreshError('Refresh failed');

    expect(error.name).toBe('TokenRefreshError');
    expect(error.message).toBe('Refresh failed');
    expect(error).toBeInstanceOf(AuthKitError);
    expect(error).toBeInstanceOf(Error);
  });

  it('creates error with cause', () => {
    const originalError = new Error('Network error');
    const error = new TokenRefreshError('Refresh failed', originalError);

    expect(error.cause).toBe(originalError);
  });

  it('creates error with userId and sessionId', () => {
    const error = new TokenRefreshError('Refresh failed', undefined, {
      userId: 'user_123',
      sessionId: 'session_456',
    });

    expect(error.userId).toBe('user_123');
    expect(error.sessionId).toBe('session_456');
  });

  it('creates error with cause and context', () => {
    const originalError = new Error('Network error');
    const error = new TokenRefreshError('Refresh failed', originalError, {
      userId: 'user_123',
      sessionId: 'session_456',
    });

    expect(error.cause).toBe(originalError);
    expect(error.userId).toBe('user_123');
    expect(error.sessionId).toBe('session_456');
  });

  it('creates error with partial context (userId only)', () => {
    const error = new TokenRefreshError('Refresh failed', undefined, {
      userId: 'user_123',
    });

    expect(error.userId).toBe('user_123');
    expect(error.sessionId).toBeUndefined();
  });

  it('creates error with partial context (sessionId only)', () => {
    const error = new TokenRefreshError('Refresh failed', undefined, {
      sessionId: 'session_456',
    });

    expect(error.userId).toBeUndefined();
    expect(error.sessionId).toBe('session_456');
  });

  it('has undefined properties when no context provided', () => {
    const error = new TokenRefreshError('Refresh failed');

    expect(error.userId).toBeUndefined();
    expect(error.sessionId).toBeUndefined();
  });
});

describe('OAuthStateMismatchError', () => {
  it('creates error with correct name', () => {
    const error = new OAuthStateMismatchError('OAuth state mismatch');

    expect(error.name).toBe('OAuthStateMismatchError');
    expect(error.message).toBe('OAuth state mismatch');
    expect(error).toBeInstanceOf(AuthKitError);
    expect(error).toBeInstanceOf(Error);
  });

  it('creates error with cause', () => {
    const originalError = new Error('Upstream');
    const error = new OAuthStateMismatchError('mismatch', originalError);

    expect(error.cause).toBe(originalError);
  });
});

describe('PKCECookieMissingError', () => {
  it('creates error with correct name', () => {
    const error = new PKCECookieMissingError('Cookie missing');

    expect(error.name).toBe('PKCECookieMissingError');
    expect(error.message).toBe('Cookie missing');
    expect(error).toBeInstanceOf(AuthKitError);
    expect(error).toBeInstanceOf(Error);
  });

  it('creates error with cause', () => {
    const originalError = new Error('Upstream');
    const error = new PKCECookieMissingError('Cookie missing', originalError);

    expect(error.cause).toBe(originalError);
  });
});

describe('error inheritance', () => {
  it('maintains proper inheritance chain', () => {
    const sessionError = new SessionEncryptionError('test');
    const tokenError = new TokenValidationError('test');
    const refreshError = new TokenRefreshError('test');
    const stateError = new OAuthStateMismatchError('test');
    const cookieError = new PKCECookieMissingError('test');

    expect(sessionError).toBeInstanceOf(SessionEncryptionError);
    expect(sessionError).toBeInstanceOf(AuthKitError);
    expect(sessionError).toBeInstanceOf(Error);

    expect(tokenError).toBeInstanceOf(TokenValidationError);
    expect(tokenError).toBeInstanceOf(AuthKitError);
    expect(tokenError).toBeInstanceOf(Error);

    expect(refreshError).toBeInstanceOf(TokenRefreshError);
    expect(refreshError).toBeInstanceOf(AuthKitError);
    expect(refreshError).toBeInstanceOf(Error);

    expect(stateError).toBeInstanceOf(OAuthStateMismatchError);
    expect(stateError).toBeInstanceOf(AuthKitError);
    expect(stateError).toBeInstanceOf(Error);

    expect(cookieError).toBeInstanceOf(PKCECookieMissingError);
    expect(cookieError).toBeInstanceOf(AuthKitError);
    expect(cookieError).toBeInstanceOf(Error);
  });

  it('can be caught as AuthKitError', () => {
    const errors = [
      new SessionEncryptionError('test'),
      new TokenValidationError('test'),
      new TokenRefreshError('test'),
      new OAuthStateMismatchError('test'),
      new PKCECookieMissingError('test'),
    ];

    errors.forEach(error => {
      expect(() => {
        throw error;
      }).toThrow(AuthKitError);
    });
  });
});
