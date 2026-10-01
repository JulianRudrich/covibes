import type { DevMail, PublicConfig } from '@covibes/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';

import { agentRoutes } from '@server/api/agents';
import { boardRoutes } from '@server/api/boards';
import { criteriaRoutes, decisionRoutes } from '@server/api/decisions';
import { apiError } from '@server/api/errors';
import { debateRoutes, handRoutes, offerRoutes, voteRoutes } from '@server/api/hands';
import { messageRoutes } from '@server/api/messages';
import { projectRoutes } from '@server/api/projects';
import { proposalRoutes } from '@server/api/proposals';
import { runRoutes } from '@server/api/runs';
import { AUTH_BASE_PATH, gitlabLoginEnabled, type Auth } from '@server/auth/auth';
import type { BoardDocuments } from '@server/collab/collab';
import type { Database } from '@server/db/database';
import type { ServerEnv } from '@server/env';
import type { MailSetup } from '@server/integrations/mail/mailer';
import type { LivePublisher } from '@server/realtime/realtime';
import { createRateLimiter } from '@server/rate-limit';
import { securityHeaders, serveWebApp } from '@server/web-app';

/** Messages one person may send per minute across all projects. */
export const MESSAGES_PER_MINUTE = 20;

/** Largest request body the API accepts. */
export const API_BODY_LIMIT = 64 * 1024;

export type AppDeps = {
  env: ServerEnv;
  db: Database;
  auth: Auth;
  mail: MailSetup;
  live: LivePublisher;
  /** The collaboration server, which removes the canvas of a deleted board. */
  documents: BoardDocuments;
};

export function createApp({ env, db, auth, mail, live, documents }: AppDeps): Hono {
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

  const messageLimiter = createRateLimiter({ limit: MESSAGES_PER_MINUTE, windowMs: 60_000 });
  app.route('/api/projects/:projectId/messages', messageRoutes(db.app, auth, live, messageLimiter));
  app.route('/api/projects/:projectId/runs', runRoutes(db.app, auth));
  app.route('/api/projects/:projectId/boards', boardRoutes(db.app, auth, live, documents));
  app.route('/api/projects/:projectId/proposals', proposalRoutes(db.app, auth, live, documents));
  app.route('/api/projects/:projectId/agents', agentRoutes(db.app, auth, live));
  app.route('/api/projects/:projectId/hands', handRoutes(db.app, auth));
  app.route('/api/projects/:projectId/offers', offerRoutes(db.app, auth));
  app.route('/api/projects/:projectId/votes', voteRoutes(db.app, auth));
  app.route('/api/projects/:projectId/debates', debateRoutes(db.app, auth));
  app.route('/api/projects/:projectId/criteria', criteriaRoutes(db.app, auth));
  app.route('/api/projects/:projectId/decisions', decisionRoutes(db.app, auth));
  app.route('/api/projects', projectRoutes(db.app, auth, live));

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
