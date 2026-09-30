import type { ApiErrorBody, ApiErrorCode } from '@covibes/shared';

/** Failed API call with the stable code from the server (`network` if it was not reachable). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'network',
  ) {
    super(`API request failed: ${String(status)} ${code}`);
    this.name = 'ApiError';
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const { error } = value;
  return typeof error === 'object' && error !== null && 'code' in error;
}

/** Calls the Covibes server under `/api` (same origin, so the session cookie is sent along). */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body !== undefined) headers.set('content-type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network');
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    throw new ApiError(response.status, isApiErrorBody(body) ? body.error.code : 'internal');
  }
  // "No content", e.g. after deleting something.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
