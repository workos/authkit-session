type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

interface RequestOptions {
  method: HttpMethod;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
  credentials?: RequestCredentials;
  mode?: RequestMode;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Record<string, string>;
  ok: boolean;
}

export interface ApiError {
  message: string;
  status?: number;
  details?: unknown;
}

interface ClientConfig {
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  timeout?: number;
  credentials?: RequestCredentials;
}

export class HttpClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;
  private timeout: number;
  private credentials: RequestCredentials;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...config.defaultHeaders,
    };
    this.timeout = config.timeout || 30_000; // Default timeout of 30 seconds
    this.credentials = config.credentials || 'same-origin';
  }

  private createError(
    message: string,
    status?: number,
    details?: unknown,
  ): ApiError {
    return { message, status, details };
  }

  private async request<T>(
    endpoint: string,
    options: RequestOptions,
  ): Promise<ApiResponse<T>> {
    let url = `${this.baseUrl}${endpoint}`;
    const headers = { ...this.defaultHeaders, ...options.headers };
    const fetchOptions: RequestInit = {
      method: options.method,
      headers,
      credentials: options.credentials ?? this.credentials,
      mode: options.mode ?? 'cors',
    };

    if (options.params) {
      url += new URLSearchParams(options.params).toString();
    }

    if (options.body) {
      if (options.body instanceof FormData) {
        fetchOptions.body = options.body;
        const headerRecord = fetchOptions.headers as Record<string, string>;
        delete headerRecord['Content-Type'];
      } else {
        fetchOptions.body =
          typeof options.body === 'string'
            ? options.body
            : JSON.stringify(options.body);
      }
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseData = await response.json();
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return {
        data: responseData,
        status: response.status,
        headers: responseHeaders,
        ok: response.ok,
      } satisfies ApiResponse<T>;
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortController') {
          throw this.createError('Request timeout', 408);
        }
        throw this.createError(error.message);
      }
      throw this.createError('Unknown error occurred');
    }
  }

  async get<T>(
    endpoint: string,
    options: Partial<RequestOptions> = {},
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  async post<T>(
    endpoint: string,
    body?: unknown,
    options: Partial<RequestOptions> = {},
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'POST', body });
  }

  async put<T>(
    endpoint: string,
    body?: unknown,
    options: Partial<RequestOptions> = {},
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'PUT', body });
  }

  async delete<T>(
    endpoint: string,
    options: Partial<RequestOptions> = {},
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }

  async patch<T>(
    endpoint: string,
    body?: unknown,
    options: Partial<RequestOptions> = {},
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'PATCH', body });
  }
}

export default HttpClient;
