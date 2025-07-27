export class AuthKitError extends Error {
  data?: Record<string, any>;

  constructor(message: string, cause?: unknown, data?: Record<string, any>) {
    super(message);
    this.name = 'AuthKitError';
    this.cause = cause;
    this.data = data;
  }
}

export class SessionEncryptionError extends AuthKitError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'SessionEncryptionError';
  }
}

export class TokenValidationError extends AuthKitError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'TokenValidationError';
  }
}

export class TokenRefreshError extends AuthKitError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'TokenRefreshError';
  }
}
