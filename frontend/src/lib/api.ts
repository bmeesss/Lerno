/**
 * API client — talks to the Lerno backend using the JSON envelope
 * { data } / { error: { code, message } } (spec §14).
 *
 * All HTTP details live here so services/components never touch fetch directly.
 */
import { config } from './config';

const TOKEN_KEY = 'lerno.auth';
const REFRESH_KEY = 'lerno.auth.refresh';

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setTokens(accessToken: string, refreshToken: string | null): void {
  localStorage.setItem(TOKEN_KEY, accessToken);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  else localStorage.removeItem(REFRESH_KEY);
}

export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  /** Optional machine-readable context from the API (e.g. the duplicate match). */
  readonly details: Record<string, unknown> | null;

  constructor(
    message: string,
    code: string,
    status: number,
    details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${config.apiBaseUrl}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal ?? null,
    });
  } catch {
    throw new ApiError('Could not reach the Lerno server. Check your connection.', 'NETWORK', 0);
  }

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const err = (
      payload as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null
    )?.error;
    throw new ApiError(
      err?.message ?? `Request failed (${response.status})`,
      err?.code ?? 'UNKNOWN',
      response.status,
      err?.details ?? null,
    );
  }

  return (payload as { data: T }).data;
}

/** Multipart upload helper; the browser supplies the boundary Content-Type. */
export async function apiUpload<T>(
  path: string,
  body: FormData,
  signal?: AbortSignal,
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(buildUrl(path), {
      method: 'POST',
      headers,
      body,
      signal: signal ?? null,
    });
  } catch {
    throw new ApiError('Could not reach the Lerno server. Check your connection.', 'NETWORK', 0);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const err = (
      payload as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null
    )?.error;
    throw new ApiError(
      err?.message ?? `Request failed (${response.status})`,
      err?.code ?? 'UNKNOWN',
      response.status,
      err?.details ?? null,
    );
  }
  return (payload as { data: T }).data;
}

export interface UploadOptions {
  /** Real upload progress (0-100) reported by the browser for large files. */
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/**
 * Multipart upload with progress. XMLHttpRequest is used because `fetch` cannot
 * report upload progress — file uploads are the one place the student needs to
 * see how far along they are.
 */
export function apiUploadWithProgress<T>(
  path: string,
  body: FormData,
  options: UploadOptions = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', buildUrl(path));
    request.setRequestHeader('Accept', 'application/json');
    const token = getAccessToken();
    if (token) request.setRequestHeader('Authorization', `Bearer ${token}`);

    request.upload.onprogress = (event) => {
      if (!options.onProgress || !event.lengthComputable) return;
      options.onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    request.onerror = () =>
      reject(new ApiError('Could not reach the Lerno server. Check your connection.', 'NETWORK', 0));
    request.onabort = () => reject(new ApiError('The upload was cancelled.', 'ABORTED', 0));
    request.ontimeout = () =>
      reject(new ApiError('The upload took too long. Check your connection and try again.', 'TIMEOUT', 0));
    request.onload = () => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(request.responseText) as unknown;
      } catch {
        payload = null;
      }
      if (request.status < 200 || request.status >= 300) {
        const err = (
          payload as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null
        )?.error;
        reject(
          new ApiError(
            err?.message ?? `Upload failed (${request.status})`,
            err?.code ?? 'UNKNOWN',
            request.status,
            err?.details ?? null,
          ),
        );
        return;
      }
      resolve((payload as { data: T }).data);
    };

    if (options.signal) {
      options.signal.addEventListener('abort', () => request.abort(), { once: true });
    }
    request.send(body);
  });
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) =>
    apiRequest<T>(path, { method: 'GET', query }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};
