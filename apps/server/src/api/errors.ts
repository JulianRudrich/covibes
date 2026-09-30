import type { ApiErrorBody, ApiErrorCode } from '@covibes/shared';
import type { Context } from 'hono';

// Fixed English messages for developers; the web app shows its own texts based on `code`.
const ERRORS = {
  unauthorized: { status: 401, message: 'Sign-in required.' },
  forbidden: { status: 403, message: 'Not allowed.' },
  not_found: { status: 404, message: 'Not found.' },
  invalid_input: { status: 400, message: 'Invalid input.' },
  too_large: { status: 413, message: 'Request too large.' },
  too_many_requests: { status: 429, message: 'Too many requests, please wait a moment.' },
  limit_reached: { status: 409, message: 'The limit is reached.' },
  internal: { status: 500, message: 'Something went wrong.' },
} as const satisfies Record<ApiErrorCode, { status: number; message: string }>;

export function apiError(c: Context, code: ApiErrorCode) {
  const { status, message } = ERRORS[code];
  return c.json<ApiErrorBody>({ error: { code, message } }, status);
}
