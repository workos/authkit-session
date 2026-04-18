import type { AuthKitConfig } from '../config/types.js';
import type { CookieOptions, HeadersBag, SessionStorage } from './types.js';

export type { CookieOptions } from './types.js';

export abstract class CookieSessionStorage<
  TRequest,
  TResponse,
> implements SessionStorage<TRequest, TResponse> {
  protected cookieName: string;
  protected readonly cookieOptions: CookieOptions;

  constructor(config: AuthKitConfig) {
    this.cookieName = config.cookieName ?? 'wos_session';

    const sameSite = config.cookieSameSite ?? 'lax';

    // Infer secure flag from redirectUri protocol
    // sameSite='none' requires secure=true (browser requirement)
    let secure = true;
    if (sameSite.toLowerCase() !== 'none') {
      try {
        const url = new URL(config.redirectUri);
        secure = url.protocol === 'https:';
      } catch {
        // Invalid URL - keep secure=true (safer default)
      }
    }

    this.cookieOptions = {
      path: '/',
      httpOnly: true,
      sameSite,
      secure,
      maxAge: config.cookieMaxAge ?? 60 * 60 * 24 * 400, // 400 days
      domain: config.cookieDomain,
    };
  }

  protected async applyHeaders(
    _response: TResponse | undefined,
    _headers: HeadersBag,
  ): Promise<{ response: TResponse } | void> {
    /* default no-op. Adapters can override if they CAN mutate a native response */
  }

  protected serializeCookie(
    name: string,
    value: string,
    options: CookieOptions,
    { expired }: { expired?: boolean } = {},
  ): string {
    const a = [`${name}=${encodeURIComponent(value)}`];
    if (options.path) a.push(`Path=${options.path}`);
    if (options.domain) a.push(`Domain=${options.domain}`);
    if (options.maxAge != null || expired)
      a.push(`Max-Age=${expired ? 0 : options.maxAge}`);
    if (options.httpOnly) a.push('HttpOnly');
    if (options.secure) a.push('Secure');
    if (options.sameSite) {
      const capitalizedSameSite =
        options.sameSite.charAt(0).toUpperCase() +
        options.sameSite.slice(1).toLowerCase();
      a.push(`SameSite=${capitalizedSameSite}`);
    }
    if (options.priority) a.push(`Priority=${options.priority}`);
    if (options.partitioned) a.push('Partitioned');
    return a.join('; ');
  }

  abstract getCookie(request: TRequest, name: string): Promise<string | null>;

  async setCookie(
    response: TResponse | undefined,
    name: string,
    value: string,
    options: CookieOptions,
  ): Promise<{ response?: TResponse; headers?: HeadersBag }> {
    const header = this.serializeCookie(name, value, options);
    const mutated = await this.applyHeaders(response, { 'Set-Cookie': header });
    return mutated ?? { headers: { 'Set-Cookie': header } };
  }

  async clearCookie(
    response: TResponse | undefined,
    name: string,
    options: CookieOptions,
  ): Promise<{ response?: TResponse; headers?: HeadersBag }> {
    const header = this.serializeCookie(name, '', options, { expired: true });
    const mutated = await this.applyHeaders(response, { 'Set-Cookie': header });
    return mutated ?? { headers: { 'Set-Cookie': header } };
  }

  getSession(request: TRequest): Promise<string | null> {
    return this.getCookie(request, this.cookieName);
  }

  saveSession(
    response: TResponse | undefined,
    sessionData: string,
  ): Promise<{ response?: TResponse; headers?: HeadersBag }> {
    return this.setCookie(
      response,
      this.cookieName,
      sessionData,
      this.cookieOptions,
    );
  }

  clearSession(
    response: TResponse | undefined,
  ): Promise<{ response?: TResponse; headers?: HeadersBag }> {
    return this.clearCookie(response, this.cookieName, this.cookieOptions);
  }
}
