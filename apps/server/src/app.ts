import type { DevMail, PublicConfig } from '@covibes/shared';
import { Hono } from 'hono';

import { apiError } from '@server/api/errors';
import { projectRoutes } from '@server/api/projects';
import { AUTH_BASE_PATH, gitlabLoginEnabled, type Auth } from '@server/auth/auth';
import type { Database } from '@server/db/database';
import type { ServerEnv } from '@server/env';
import type { MailSetup } from '@server/integrations/mail/mailer';
import { securityHeaders, serveWebApp } from '@server/web-app';

export type AppDeps = { env: ServerEnv; db: Database; auth: Auth; mail: MailSetup };

export function createApp({ env, db, auth, mail }: AppDeps): Hono {
  const app = new Hono();

  if (env.NODE_ENV === 'production') app.use('*', securityHeaders(env.APP_URL));

  app.get('/health', (c) => c.json({ status: 'ok' }));

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

  app.route('/api/projects', projectRoutes(db.app, auth));

  // In the Docker image the server also delivers the web app (spec 02b); locally Vite does.
  if (env.WEB_DIST_DIR) serveWebApp(app, env.WEB_DIST_DIR);

  app.notFound((c) =>
    c.req.path.startsWith('/api/') ? apiError(c, 'not_found') : c.text('Not found', 404),
  );
  app.onError((error, c) => {
    console.error(error);
    return apiError(c, 'internal');
  });

  return app;
}
