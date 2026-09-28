import type { DevMail, PublicConfig } from '@covibes/shared';
import { Hono } from 'hono';

import { apiError } from '@server/api/errors';
import { projectRoutes } from '@server/api/projects';
import { AUTH_BASE_PATH, gitlabLoginEnabled, type Auth } from '@server/auth/auth';
import type { Database } from '@server/db/database';
import type { ServerEnv } from '@server/env';
import type { DevOutbox } from '@server/integrations/mail/mailer';

export type AppDeps = { env: ServerEnv; db: Database; auth: Auth; outbox: DevOutbox };

export function createApp({ env, db, auth, outbox }: AppDeps): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.on(['GET', 'POST'], `${AUTH_BASE_PATH}/*`, (c) => auth.handler(c.req.raw));

  app.get('/api/config', (c) =>
    c.json<PublicConfig>({
      gitlabLogin: gitlabLoginEnabled(env),
      devMailbox: env.NODE_ENV === 'development',
    }),
  );

  // The development mailbox only exists locally; everywhere else the route is unknown.
  if (env.NODE_ENV === 'development') {
    app.get('/api/dev/mails', (c) => c.json<DevMail[]>(outbox.list()));
  }

  app.route('/api/projects', projectRoutes(db.app, auth));

  app.notFound((c) =>
    c.req.path.startsWith('/api/') ? apiError(c, 'not_found') : c.text('Not found', 404),
  );
  app.onError((error, c) => {
    console.error(error);
    return apiError(c, 'internal');
  });

  return app;
}
