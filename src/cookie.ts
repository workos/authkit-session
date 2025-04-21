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

export abstract class CookieManager {
  abstract get(name: string): string | undefined;
  abstract set(name: string, value: string, options?: CookieOptions): void;
  abstract remove(name: string, options?: CookieOptions): void;
  abstract getAll(): Record<string, string>;
}
