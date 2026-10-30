import { jwtVerify } from 'jose';
import { AuthKitCore } from './AuthKitCore.js';

vi.mock('jose', async importOriginal => {
  const actual = await importOriginal<typeof import('jose')>();
  return {
    ...actual,
    jwtVerify: vi.fn().mockResolvedValue({ payload: {}, protectedHeader: {} }),
  };
});

const mockClient = {
  userManagement: {
    getJwksUrl: () => 'https://api.workos.com/sso/jwks/test-client-id',
  },
};

const mockEncryption = {
  sealData: async () => 'encrypted-session-data',
  unsealData: async () => ({}),
};

const baseConfig = {
  cookiePassword: 'test-password-that-is-32-chars-long!!',
  clientId: 'test-client-id',
};

function createCore(config: Record<string, unknown>) {
  return new AuthKitCore(
    config as any,
    mockClient as any,
    mockEncryption as any,
  );
}

describe('AuthKitCore.verifyToken() issuer validation', () => {
  beforeEach(() => {
    vi.mocked(jwtVerify).mockClear();
  });

  it('does not validate the issuer claim by default', async () => {
    const core = createCore(baseConfig);

    await expect(core.verifyToken('some.jwt.token')).resolves.toBe(true);

    expect(jwtVerify).toHaveBeenCalledTimes(1);
    expect(jwtVerify).toHaveBeenCalledWith(
      'some.jwt.token',
      expect.any(Function),
      undefined,
    );
  });

  it('validates the issuer claim when issuer is configured', async () => {
    const core = createCore({
      ...baseConfig,
      issuer: 'https://auth.example.com',
    });

    await expect(core.verifyToken('some.jwt.token')).resolves.toBe(true);

    expect(jwtVerify).toHaveBeenCalledTimes(1);
    expect(jwtVerify).toHaveBeenCalledWith(
      'some.jwt.token',
      expect.any(Function),
      { issuer: 'https://auth.example.com' },
    );
  });

  it('passes a list of issuers through to jwtVerify', async () => {
    const issuer = [
      'https://auth.example.com',
      'https://api.workos.com/user_management/test-client-id',
    ];
    const core = createCore({ ...baseConfig, issuer });

    await expect(core.verifyToken('some.jwt.token')).resolves.toBe(true);

    expect(jwtVerify).toHaveBeenCalledWith(
      'some.jwt.token',
      expect.any(Function),
      { issuer },
    );
  });

  it('returns false when jwtVerify rejects the issuer', async () => {
    vi.mocked(jwtVerify).mockRejectedValueOnce(
      new Error('unexpected "iss" claim value'),
    );
    const core = createCore({
      ...baseConfig,
      issuer: 'https://auth.example.com',
    });

    await expect(core.verifyToken('some.jwt.token')).resolves.toBe(false);
  });
});
