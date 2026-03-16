// ─── IIQ HTTP Client ──────────────────────────────────────────────────────────
// Core HTTP client for all SailPoint IdentityIQ API calls.
// Credentials are always sourced from environment variables — never hardcoded.
// Implements retry with exponential backoff, 429 handling, and 404 normalization.

import axios, { AxiosInstance, AxiosResponse } from 'axios';

export interface IIQClientConfig {
  baseUrl: string;
  username: string;
  password: string;
  /** Request timeout in milliseconds. Default: 10000 */
  timeoutMs?: number;
  /** Maximum number of retry attempts for retriable errors. Default: 3 */
  maxRetries?: number;
}

export class IIQClient {
  private http: AxiosInstance;
  private config: Required<IIQClientConfig>;

  constructor(config: IIQClientConfig) {
    // Credentials come from config, which is populated from env vars in the factory.
    // They are never hardcoded in this file or anywhere in the codebase.
    this.config = {
      timeoutMs: 10000,
      maxRetries: 3,
      ...config,
    };

    this.http = axios.create({
      baseURL: config.baseUrl,
      timeout: this.config.timeoutMs,
      auth: {
        username: config.username,
        password: config.password,
      },
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Perform a GET request with automatic retry and backoff.
   * @param path - URL path relative to baseURL
   * @param params - Optional query parameters (undefined values are omitted by axios)
   */
  async get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    return this.requestWithRetry<T>('GET', path, undefined, params);
  }

  /**
   * Perform a POST request with automatic retry and backoff.
   * @param path - URL path relative to baseURL
   * @param data - Request body
   */
  async post<T>(path: string, data: unknown): Promise<T> {
    return this.requestWithRetry<T>('POST', path, data);
  }

  /**
   * Perform a PATCH request with automatic retry and backoff.
   * @param path - URL path relative to baseURL
   * @param data - Request body (partial update)
   */
  async patch<T>(path: string, data: unknown): Promise<T> {
    return this.requestWithRetry<T>('PATCH', path, data);
  }

  /**
   * Internal request executor with retry logic.
   *
   * Retry behaviour:
   *   - 404 → not an error; returns empty result marker (no retry)
   *   - 401 → single retry on attempt 1 (stale session token)
   *   - 429 → waits Retry-After header value (default 60s), then retries
   *   - 5xx / timeout → exponential backoff: 1s, 2s, 4s (up to maxRetries)
   *   - All other errors → thrown immediately (no retry)
   */
  private async requestWithRetry<T>(
    method: string,
    path: string,
    data?: unknown,
    params?: Record<string, string | number | undefined>,
    attempt = 1
  ): Promise<T> {
    try {
      const response: AxiosResponse<T> = await this.http.request({
        method,
        url: path,
        data,
        params,
      });
      return response.data;
    } catch (err: unknown) {
      if (!axios.isAxiosError(err)) throw err;

      const status = err.response?.status;

      // ── 404: Not an error — return an empty result marker ──────────────────
      if (status === 404) {
        console.error(`[IIQClient] 404 on ${method} ${path} — returning empty result`);
        return { exists: false, Resources: [], totalResults: 0 } as unknown as T;
      }

      // ── 401: Single retry (stale session / credentials) ────────────────────
      if (status === 401 && attempt === 1) {
        console.warn(`[IIQClient] 401 on ${path}, retrying once`);
        return this.requestWithRetry<T>(method, path, data, params, 2);
      }

      // ── 429: Rate limited — wait Retry-After, then retry ──────────────────
      if (status === 429 && attempt <= this.config.maxRetries) {
        const retryAfterHeader = err.response?.headers?.['retry-after'] as string | undefined;
        const retryAfter = parseInt(retryAfterHeader ?? '60', 10);
        console.warn(
          `[IIQClient] Rate limited on ${path}, waiting ${retryAfter}s (attempt ${attempt}/${this.config.maxRetries})`
        );
        await this.sleep(retryAfter * 1000);
        return this.requestWithRetry<T>(method, path, data, params, attempt + 1);
      }

      // ── 5xx / timeout: Exponential backoff ────────────────────────────────
      // Covers: 500-599 server errors, ECONNABORTED (timeout), ECONNREFUSED
      const isRetriable =
        !status ||
        status >= 500 ||
        err.code === 'ECONNABORTED' ||
        err.code === 'ECONNREFUSED' ||
        err.code === 'ENOTFOUND';

      if (isRetriable && attempt <= this.config.maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
        console.warn(
          `[IIQClient] ${status ?? err.code ?? 'timeout'} on ${path}, retry ${attempt}/${this.config.maxRetries} in ${delay}ms`
        );
        await this.sleep(delay);
        return this.requestWithRetry<T>(method, path, data, params, attempt + 1);
      }

      // ── Exhausted retries or non-retriable error ───────────────────────────
      throw new Error(
        `IIQ API error ${status ?? 'TIMEOUT'} on ${method} ${path}: ${err.message}`
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ─── Factory Function ─────────────────────────────────────────────────────────
// Reads IIQ_USE_MOCK env to route to mock server or real IIQ.
// All credentials are sourced exclusively from environment variables.

export function createIIQClient(): IIQClient {
  const useMock = process.env['IIQ_USE_MOCK'] === 'true';

  let baseUrl: string;

  if (useMock) {
    const mockUrl = process.env['MOCK_IIQ_URL'] ?? 'http://localhost:3001';
    baseUrl = `${mockUrl}/identityiq`;
    console.error(`[IIQClient] Mode: MOCK → ${baseUrl}`);
  } else {
    baseUrl = process.env['IIQ_BASE_URL'] ?? '';
    if (!baseUrl) {
      throw new Error('IIQ_BASE_URL must be set when IIQ_USE_MOCK=false');
    }
    console.error(`[IIQClient] Mode: PRODUCTION → ${baseUrl}`);
  }

  // Credentials always from env vars — never hardcoded
  const username = process.env['IIQ_USERNAME'] ?? 'svc_api_integration';
  const password = process.env['IIQ_PASSWORD'] ?? '';

  if (!useMock && !password) {
    throw new Error('IIQ_PASSWORD must be set when IIQ_USE_MOCK=false');
  }

  const timeoutMs =
    parseInt(process.env['IIQ_TIMEOUT_SECONDS'] ?? '10', 10) * 1000;
  const maxRetries = parseInt(process.env['IIQ_MAX_RETRIES'] ?? '3', 10);

  return new IIQClient({
    baseUrl,
    username,
    password,
    timeoutMs,
    maxRetries,
  });
}
