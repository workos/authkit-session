import type { ConfigurationProvider } from '../config/ConfigurationProvider';
import type { SessionStorage } from './types';

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

  constructor(config: ConfigurationProvider) {
    this.cookieName = config.getValue('cookieName') || 'workos_session';
    this.cookieOptions = {
      path: '/',
      httpOnly: true,
      sameSite: config.getValue('cookieSameSite') ?? 'lax',
      secure: config.getValue('apiHttps') ?? true,
      maxAge: config.getValue('cookieMaxAge') || 60 * 60 * 24 * 400, // 400 days
      domain: config.getValue('cookieDomain'),
    };
  }

  abstract getSession(request: TRequest): Promise<string | null>;

  abstract saveSession(
    response: TResponse,
    sessionData: string,
  ): Promise<TResponse>;

  abstract clearSession(response: TResponse): Promise<TResponse>;
}
