import type { ApiErrorBody, ApiErrorCode } from '@covibes/shared';

/** Failed API call with the stable code from the server (`network` if it was not reachable). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'network',
    /** What the server adds for the text, e.g. the name of someone editing a block. */
    readonly detail?: string,
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
  // JSON unless the body is a form (an upload), whose type and boundary the browser sets.
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network');
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    throw isApiErrorBody(body)
      ? new ApiError(response.status, body.error.code, body.error.detail)
      : new ApiError(response.status, 'internal');
  }
  // Nothing to read: "no content", e.g. after deleting something, or "accepted" for work that
  // only starts, e.g. a generation of the plan.
  const text = await response.text();
  return (text === '' ? undefined : JSON.parse(text)) as T;
}
