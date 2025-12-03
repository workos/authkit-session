import type { AuthKitConfig } from '../config/types.js';
import type { HeadersBag, SessionStorage } from './types.js';

export interface CookieOptions {
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  priority?: 'low' | 'medium' | 'high';
  partitioned?: boolean;
}

export abstract class CookieSessionStorage<TRequest, TResponse>
  implements SessionStorage<TRequest, TResponse>
{
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

  protected buildSetCookie(value: string, expired?: boolean): string {
    const a = [`${this.cookieName}=${encodeURIComponent(value)}`];
    const o = this.cookieOptions;
    if (o.path) a.push(`Path=${o.path}`);
    if (o.domain) a.push(`Domain=${o.domain}`);
    if (o.maxAge || expired) a.push(`Max-Age=${expired ? 0 : o.maxAge}`);
    if (o.httpOnly) a.push('HttpOnly');
    if (o.secure) a.push('Secure');
    if (o.sameSite) {
      const capitalizedSameSite =
        o.sameSite.charAt(0).toUpperCase() + o.sameSite.slice(1).toLowerCase();
      a.push(`SameSite=${capitalizedSameSite}`);
    }
    if (o.priority) a.push(`Priority=${o.priority}`);
    if (o.partitioned) a.push('Partitioned');
    return a.join('; ');
  }

  abstract getSession(request: TRequest): Promise<string | null>;

  async saveSession(
    response: TResponse | undefined,
    sessionData: string,
  ): Promise<{ response?: TResponse; headers?: HeadersBag }> {
    const header = this.buildSetCookie(sessionData);
    const mutated = await this.applyHeaders(response, { 'Set-Cookie': header });
    return mutated ?? { headers: { 'Set-Cookie': header } };
  }

  async clearSession(
    response: TResponse,
  ): Promise<{ response?: TResponse; headers?: HeadersBag }> {
    const header = this.buildSetCookie('', true);
    const mutated = await this.applyHeaders(response, { 'Set-Cookie': header });
    return mutated ?? { headers: { 'Set-Cookie': header } };
  }
}
