import { vi } from 'vitest';

const env = {
  WORKOS_CLIENT_ID: 'client_123',
  WORKOS_REDIRECT_URI: 'http://localhost:3000/callback',
  WORKOS_COOKIE_PASSWORD: 'a'.repeat(32),
};

// Fresh module graph per test: the config provider and getWorkOS() are
// process-wide singletons.
async function load(source: Record<string, string>) {
  const { configure } = await import('../config.js');
  configure(key => source[key]);
  return import('./workos.js');
}

describe('WorkOS client', () => {
  let savedApiKey: string | undefined;

  beforeEach(() => {
    vi.resetModules();
    savedApiKey = process.env.WORKOS_API_KEY;
    // The SDK falls back to process.env.WORKOS_API_KEY; keep it out unless a
    // test sets it on purpose.
    delete process.env.WORKOS_API_KEY;
  });

  afterEach(() => {
    vi.doUnmock('@workos-inc/node');
    if (savedApiKey !== undefined) process.env.WORKOS_API_KEY = savedApiKey;
    else delete process.env.WORKOS_API_KEY;
  });

  describe('constructor arguments', () => {
    let WorkOSMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      WorkOSMock = vi.fn();
      vi.doMock('@workos-inc/node', () => ({ WorkOS: WorkOSMock }));
    });

    it('passes apiKey and clientId in confidential mode', async () => {
      const { createWorkOSInstance } = await load({
        ...env,
        WORKOS_API_KEY: 'sk_test_confidential',
      });
      createWorkOSInstance();

      expect(WorkOSMock).toHaveBeenCalledTimes(1);
      expect(WorkOSMock.mock.calls[0]).toEqual([
        {
          apiKey: 'sk_test_confidential',
          clientId: 'client_123',
          apiHostname: 'api.workos.com',
          https: true,
          port: undefined,
          appInfo: { name: 'authkit-session', version: expect.any(String) },
        },
      ]);
    });

    it('passes clientId and no apiKey in public mode', async () => {
      const { createWorkOSInstance } = await load(env);
      createWorkOSInstance();

      expect(WorkOSMock).toHaveBeenCalledTimes(1);
      expect(WorkOSMock.mock.calls[0]).toHaveLength(1);
      const [options] = WorkOSMock.mock.calls[0]!;
      expect(options.apiKey).toBeUndefined();
      expect(options.clientId).toBe('client_123');
    });
  });

  it('builds a real keyless client in public mode', async () => {
    const { getWorkOS } = await load(env);
    const workos = getWorkOS();

    expect(workos.key).toBeUndefined();
    expect(workos.clientId).toBe('client_123');
  });

  it('builds a real confidential client with a key', async () => {
    const { getWorkOS } = await load({
      ...env,
      WORKOS_API_KEY: 'sk_test_confidential',
    });

    expect(getWorkOS().key).toBe('sk_test_confidential');
  });

  it('picks up WORKOS_API_KEY from process.env even when a custom value source omits it', async () => {
    // Documented behavior: the WorkOS SDK falls back to process.env, so a key
    // in the process environment always ends up on the client.
    process.env.WORKOS_API_KEY = 'sk_test_from_process_env';
    const { getWorkOS } = await load(env);

    expect(getWorkOS().key).toBe('sk_test_from_process_env');
  });
});
