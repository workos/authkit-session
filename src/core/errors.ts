export class AuthKitError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'AuthKitError';
    this.cause = cause;
  }
}

export class SessionEcnryptionError extends AuthKitError {
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
