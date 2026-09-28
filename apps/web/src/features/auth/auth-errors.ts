export type AuthErrorKey =
  | 'auth.errors.rateLimit'
  | 'auth.errors.invalidEmail'
  | 'auth.errors.invalidLink'
  | 'auth.errors.generic';

/** Maps errors of the login client to i18n keys; raw messages never reach the user. */
export function authErrorKey(error: unknown): AuthErrorKey {
  const status =
    typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0;
  if (status === 429) return 'auth.errors.rateLimit';
  if (status === 400) return 'auth.errors.invalidEmail';
  return 'auth.errors.generic';
}

/** Maps the `error` parameter the server appends when a login link or GitLab login fails. */
export function redirectErrorKey(code: string): AuthErrorKey {
  // Expired and already used links both arrive as INVALID_TOKEN.
  return code === 'INVALID_TOKEN' ? 'auth.errors.invalidLink' : 'auth.errors.generic';
}
