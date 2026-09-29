import type { DevMail, PublicConfig } from '@covibes/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';

import { apiError } from '@server/api/errors';
import { messageRoutes } from '@server/api/messages';
import { projectRoutes } from '@server/api/projects';
import { AUTH_BASE_PATH, gitlabLoginEnabled, type Auth } from '@server/auth/auth';
import type { Database } from '@server/db/database';
import type { ServerEnv } from '@server/env';
import type { MailSetup } from '@server/integrations/mail/mailer';
import type { LivePublisher } from '@server/realtime/realtime';
import { securityHeaders, serveWebApp } from '@server/web-app';

/** Largest request body the API accepts. */
export const API_BODY_LIMIT = 64 * 1024;

export type AppDeps = {
  env: ServerEnv;
  db: Database;
  auth: Auth;
  mail: MailSetup;
  live: LivePublisher;
};

export function createApp({ env, db, auth, mail, live }: AppDeps): Hono {
  const app = new Hono();

  if (env.NODE_ENV === 'production') app.use('*', securityHeaders(env.APP_URL));

  app.get('/health', (c) => c.json({ status: 'ok' }));

  // No API request needs more than this (a message has at most 8000 characters); larger bodies are
  // refused while they are read, so nobody can make the server buffer huge uploads.
  app.use(
    '/api/*',
    bodyLimit({ maxSize: API_BODY_LIMIT, onError: (c) => apiError(c, 'too_large') }),
  );
  // Form-like requests (which browsers send cross-site without asking) must come from the web app.
  // SameSite cookies stop other sites, this also stops sibling subdomains of the same site.
  app.use('/api/*', csrf({ origin: new URL(env.APP_URL).origin }));

  app.on(['GET', 'POST'], `${AUTH_BASE_PATH}/*`, (c) => auth.handler(c.req.raw));

  app.get('/api/config', (c) =>
    c.json<PublicConfig>({
      gitlabLogin: gitlabLoginEnabled(env),
      emailLogin: mail.mailer !== undefined,
      devMailbox: env.NODE_ENV === 'development' && mail.outbox !== undefined,
    }),
  );

  // The development mailbox only exists locally; everywhere else the route is unknown.
  const { outbox } = mail;
  if (env.NODE_ENV === 'development' && outbox) {
    app.get('/api/dev/mails', (c) => c.json<DevMail[]>(outbox.list()));
  }

  app.route('/api/projects/:projectId/messages', messageRoutes(db.app, auth, live));
  app.route('/api/projects', projectRoutes(db.app, auth));

  // In the Docker image the server also delivers the web app (spec 02b); locally Vite does.
  if (env.WEB_DIST_DIR) serveWebApp(app, env.WEB_DIST_DIR);

  app.notFound((c) =>
    c.req.path.startsWith('/api/') ? apiError(c, 'not_found') : c.text('Not found', 404),
  );
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return error.status === 403 ? apiError(c, 'forbidden') : error.getResponse();
    }
    console.error(error);
    return apiError(c, 'internal');
  });

  return app;
}
