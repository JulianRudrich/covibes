import type { MiddlewareHandler } from 'hono';

import type { Auth } from '@server/auth/auth';

export type SessionUser = { id: string; name: string };

export type SessionVariables = { user: SessionUser | null };

/** Looks up the session cookie and makes the signed-in user (or null) available as `user`. */
export function sessionMiddleware(auth: Auth): MiddlewareHandler<{ Variables: SessionVariables }> {
  return async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set('user', session ? { id: session.user.id, name: session.user.name } : null);
    await next();
  };
}
