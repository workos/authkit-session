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

interface Cookie {
  name: string;
  value: string;
  options?: CookieOptions;
}

const MAX_COOKIE_SIZE = 4096; // Maximum size of a cookie in bytes
const CHUNK_OVERHEAD = 160; // Overhead for chunking metadata
const CHUNK_SIZE = MAX_COOKIE_SIZE - CHUNK_OVERHEAD;
const CHUNK_PATTERN = /\.(\d+)$/;

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

  protected abstract getCookie(
    request: TRequest,
    name: string,
  ): string | undefined;
  protected abstract setCookie(
    response: TResponse,
    name: string,
    value: string,
    options: CookieOptions,
  ): TResponse;

  async getSession(request: TRequest): Promise<string | null> {
    const directValue = this.getCookie(request, this.cookieName);
  }

  abstract saveSession(
    response: TResponse,
    sessionData: string,
  ): Promise<TResponse>;

  abstract clearSession(response: TResponse): Promise<TResponse>;

  protected getChunkedCookieValue(
    cookies: Record<string, string>,
  ): string | null {
    const chunks: Array<[number, string]> = [];
    let hasChunks = false;

    for (const [name, value] of Object.entries(cookies)) {
      if (name === this.cookieName) {
        if (!(`${this.cookieName}.0` in cookies)) {
          return value || null;
        }
      } else if (name.startsWith(`${this.cookieName}.`)) {
        const [, match] = name.match(CHUNK_PATTERN) ?? [];
        if (match) {
          hasChunks = true;
          chunks.push([parseInt(match, 10), value]);
        }
      }
    }

    if (!hasChunks) {
      return cookies[this.cookieName] || null;
    }

    return chunks
      .sort(([a], [b]) => a - b)
      .map(([, value]) => value)
      .join('');
  }

  protected chunkValue(
    value: string,
    existingCookies: Record<string, string> = {},
    options: CookieOptions = {},
  ): Array<Cookie> {
    const cookies: Array<Cookie> = [];
    const finalOptions = { ...this.cookieOptions, ...options };

    const existingChunks = Object.keys(existingCookies).filter(
      name =>
        name.startsWith(`${this.cookieName}.`) && name.match(CHUNK_PATTERN),
    );

    if (value.length <= CHUNK_SIZE) {
      cookies.push({ name: this.cookieName, value, options: finalOptions });
      existingChunks.forEach(name => {
        cookies.push(this.createExpiredCokie(name, finalOptions));
      });

      return cookies;
    }

    const chunkCount = Math.ceil(value.length / CHUNK_SIZE);

    for (let i = 0; i < chunkCount; ++i) {
      const start = i * CHUNK_SIZE;
      const end = start + CHUNK_SIZE;
      cookies.push({
        name: `${this.cookieName}.${i}`,
        value: value.slice(start, end),
        options: finalOptions,
      });
    }

    existingChunks.forEach(name => {
      const [, match] = name.match(CHUNK_PATTERN) || [];
      if (match && parseInt(match, 10) >= chunkCount) {
        cookies.push(this.createExpiredCokie(name, finalOptions));
      }
    });

    return cookies;
  }

  private createExpiredCokie(
    name: string,
    options: CookieOptions = {},
  ): Cookie {
    return {
      name,
      value: '',
      options: {
        ...options,
        ...this.cookieOptions,
        maxAge: 0,
        expires: new Date(0),
      },
    };
  }
}
