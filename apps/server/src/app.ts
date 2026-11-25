import { MAX_FILE_BYTES, type DevMail, type PublicConfig } from '@covibes/shared';
import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import { agentRoutes } from '@server/api/agents';
import { accountRoutes } from '@server/api/account';
import { agentKnowledgeRoutes } from '@server/api/agent-knowledge';
import { customAgentRoutes } from '@server/api/custom-agents';
import { awayRoutes } from '@server/api/away';
import { boardHistoryRoutes } from '@server/api/board-history';
import { boardRoutes } from '@server/api/boards';
import { criteriaRoutes, decisionRoutes } from '@server/api/decisions';
import { decisionLinkRoutes } from '@server/api/decision-links';
import { apiError } from '@server/api/errors';
import { fileRoutes, UPLOADS_PER_MINUTE } from '@server/api/files';
import {
  INVITATION_MAILS_PER_HOUR,
  invitationRoutes,
  memberRoutes,
  projectInvitationRoutes,
} from '@server/api/invitations';
import { debateRoutes, handRoutes, offerRoutes, voteRoutes } from '@server/api/hands';
import { messageRoutes } from '@server/api/messages';
import { messageHistoryRoutes } from '@server/api/message-history';
import { projectSearchRoutes } from '@server/api/project-search';
import { notificationRoutes } from '@server/api/notifications';
import { gitAccountRoutes, gitCallback, gitRoutes, type GitDeps } from '@server/api/git';
import { GIT_WEBHOOK_PATH, gitWebhook, WEBHOOK_CALLS_PER_MINUTE } from '@server/api/git-sync';
import { packageRoutes } from '@server/api/package';
import { planRoutes } from '@server/api/plan';
import { projectRoutes } from '@server/api/projects';
import { proposalRoutes } from '@server/api/proposals';
import { roadmapRoutes } from '@server/api/roadmap';
import { usageRoutes } from '@server/api/usage';
import { runRoutes } from '@server/api/runs';
import { SHARE_REQUESTS_PER_MINUTE, shareLinkRoutes, shareViewRoutes } from '@server/api/share';
import { AUTH_BASE_PATH, gitlabLoginEnabled, type Auth } from '@server/auth/auth';
import type { BoardDocuments } from '@server/collab/collab';
import type { Database } from '@server/db/database';
import type { ServerEnv } from '@server/env';
import { createGitlabClient } from '@server/integrations/gitlab/client';
import { createGitConnections } from '@server/integrations/gitlab/connections';
import { createGitlabStandIn } from '@server/integrations/gitlab/dev/stand-in';
import { DEV_GITLAB_PATH, GIT_CALLBACK_PATH, gitlabSetup } from '@server/integrations/gitlab/setup';
import {
  DEV_MAILS_PATH,
  INTERNAL_TOKEN_HEADER,
  type MailSetup,
} from '@server/integrations/mail/mailer';
import type { ProjectConnections } from '@server/realtime/connections';
import type { LivePublisher } from '@server/realtime/realtime';
import { createRateLimiter } from '@server/rate-limit';
import type { FileStorage } from '@server/storage/storage';
import { sameSecret } from '@server/secrets';
import { loadInstanceUsageTotal, usageLimitsOf } from '@server/usage/limits';
import { securityHeaders, serveWebApp } from '@server/web-app';

/** A mail the worker hands to the development mailbox. */
const devMailInputSchema = z.object({
  to: z.string().min(3).max(320),
  subject: z.string().min(1).max(300),
  text: z.string().min(1).max(20_000),
});

/** Messages one person may send per minute across all projects. */
export const MESSAGES_PER_MINUTE = 20;

/** Largest request body the API accepts. */
export const API_BODY_LIMIT = 64 * 1024;

/** An upload (spec 20a): the largest file plus the envelope of the form around it. */
export const UPLOAD_BODY_LIMIT = MAX_FILE_BYTES + 64 * 1024;

/**
 * What the development stand-in for GitLab takes in one call: the commit of a plan package
 * (spec 29c), which the worker sends it like it would send it to GitLab.
 */
export const DEV_GITLAB_BODY_LIMIT = 8 * 1024 * 1024;

/**
 * What a webhook call of GitLab may carry (spec 30a). Covibes reads none of it, but GitLab's
 * events are larger than what a page sends.
 */
export const WEBHOOK_BODY_LIMIT = 2 * 1024 * 1024;

/** `POST /api/projects/:projectId/files`, the only route that takes a file. */
const UPLOAD_PATH = /^\/api\/(projects\/[^/]+\/files|agents\/[^/]+\/knowledge\/files)\/?$/;

export type AppDeps = {
  env: ServerEnv;
  db: Database;
  auth: Auth;
  mail: MailSetup;
  live: LivePublisher;
  /** The collaboration server, which removes the canvas of a deleted board. */
  documents: BoardDocuments;
  /** Where the content of uploaded files lies (spec 20a). */
  files: FileStorage;
  /** Closes what someone has open in a project when their access changes (spec 21a). */
  connections: ProjectConnections;
  /**
   * How the server calls GitLab (spec 28a); the global `fetch` unless a test hands in its own,
   * which reaches the stand-in without a network.
   */
  gitlabFetch?: typeof fetch;
};

export function createApp({
  env,
  db,
  auth,
  mail,
  live,
  documents,
  files,
  connections,
  gitlabFetch,
}: AppDeps): Hono {
  const app = new Hono();

  if (env.NODE_ENV === 'production') app.use('*', securityHeaders(env.APP_URL));

  app.get('/health', (c) => c.json({ status: 'ok' }));

  // No API request needs more than this (a message has at most 8000 characters), except an upload;
  // larger bodies are refused while they are read, so nobody can make the server buffer more.
  const apiLimit = bodyLimit({
    maxSize: API_BODY_LIMIT,
    onError: (c) => apiError(c, 'too_large'),
  });
  const uploadLimit = bodyLimit({
    maxSize: UPLOAD_BODY_LIMIT,
    onError: (c) => apiError(c, 'too_large'),
  });
  // Connecting GitLab (spec 28a). In development and tests without an OAuth application, the
  // server answers as a small GitLab itself. Production never serves it.
  const gitSetup = gitlabSetup(env);
  const servesStandIn = gitSetup?.standIn === true && env.NODE_ENV !== 'production';
  const standInLimit = bodyLimit({
    maxSize: DEV_GITLAB_BODY_LIMIT,
    onError: (c) => apiError(c, 'too_large'),
  });
  const webhookLimit = bodyLimit({
    maxSize: WEBHOOK_BODY_LIMIT,
    onError: (c) => apiError(c, 'too_large'),
  });
  const limitBody: MiddlewareHandler = (c, next) =>
    c.req.method === 'POST' && UPLOAD_PATH.test(c.req.path)
      ? uploadLimit(c, next)
      : servesStandIn && c.req.path.startsWith(`${DEV_GITLAB_PATH}/`)
        ? // The stand-in takes what a GitLab takes, e.g. a commit of many files.
          standInLimit(c, next)
        : c.req.path.startsWith(`${GIT_WEBHOOK_PATH}/`)
          ? webhookLimit(c, next)
          : apiLimit(c, next);
  app.use('/api/*', limitBody);
  // The stand-in's routes stand before the check of the origin: the token endpoint takes a form,
  // as GitLab's does, and is called by this server, not by a page.
  const gitClient = createGitlabClient(gitlabFetch);
  const git: GitDeps | undefined = gitSetup
    ? {
        setup: gitSetup,
        client: gitClient,
        connections: createGitConnections({ admin: db.admin, client: gitClient, setup: gitSetup }),
      }
    : undefined;
  const standIn = gitSetup && servesStandIn ? createGitlabStandIn(gitSetup.source) : undefined;
  if (standIn) app.route(DEV_GITLAB_PATH, standIn.routes);

  // Form-like requests (which browsers send cross-site without asking) must come from the web app.
  // SameSite cookies stop other sites, this also stops sibling subdomains of the same site.
  app.use('/api/*', csrf({ origin: new URL(env.APP_URL).origin }));

  app.on(['GET', 'POST'], `${AUTH_BASE_PATH}/*`, (c) => auth.handler(c.req.raw));

  app.get('/api/config', (c) =>
    c.json<PublicConfig>({
      gitlabLogin: gitlabLoginEnabled(env),
      emailLogin: mail.mailer !== undefined,
      devMailbox: env.NODE_ENV === 'development' && mail.outbox !== undefined,
      socialLogins: [
        ...(env.GITHUB_CLIENT_ID ? ['github' as const] : []),
        ...(env.GOOGLE_CLIENT_ID ? ['google' as const] : []),
        ...(gitlabLoginEnabled(env) ? ['gitlab' as const] : []),
      ],
      emailCodeLogin: mail.mailer !== undefined,
      passkeyLogin: true,
      closedBeta: env.NODE_ENV === 'production',
    }),
  );

  // The development mailbox only exists locally; everywhere else the route is unknown.
  const { outbox } = mail;
  if (env.NODE_ENV === 'development' && outbox) {
    app.get(DEV_MAILS_PATH, (c) => c.json<DevMail[]>(outbox.list()));
    // The worker's mails (spec 22b): it is another process and proves itself with the shared
    // secret; a browser cannot send mails into the mailbox.
    app.post(DEV_MAILS_PATH, async (c) => {
      const token = c.req.header(INTERNAL_TOKEN_HEADER);
      if (!env.INTERNAL_TOKEN || !token || !sameSecret(token, env.INTERNAL_TOKEN)) {
        return apiError(c, 'forbidden');
      }
      const body: unknown = await c.req.json().catch(() => undefined);
      const mail = devMailInputSchema.safeParse(body);
      if (!mail.success) return apiError(c, 'invalid_input');
      await outbox.send(mail.data);
      return c.body(null, 204);
    });
  }

  const messageLimiter = createRateLimiter({ limit: MESSAGES_PER_MINUTE, windowMs: 60_000 });
  app.route(
    '/api/projects/:projectId/messages',
    messageRoutes(db.app, auth, live, messageLimiter, (boardId) => documents.readBoard(boardId)),
  );
  app.route('/api/projects/:projectId/message-history', messageHistoryRoutes(db.app, auth));
  app.route('/api/projects/:projectId/search', projectSearchRoutes(db.app, auth, documents));
  app.route('/api/projects/:projectId/runs', runRoutes(db.app, auth));
  const uploadLimiter = createRateLimiter({ limit: UPLOADS_PER_MINUTE, windowMs: 60_000 });
  app.route('/api/projects/:projectId/files', fileRoutes(db.app, auth, files, uploadLimiter));
  app.route('/api/projects/:projectId/boards', boardRoutes(db.app, auth, live, documents));
  app.route(
    '/api/projects/:projectId/boards/:boardId/history',
    boardHistoryRoutes(db.app, auth, documents),
  );
  app.route('/api/projects/:projectId/proposals', proposalRoutes(db.app, auth, live, documents));
  app.route('/api/projects/:projectId/agents', agentRoutes(db.app, auth, live));
  app.route('/api/projects/:projectId/hands', handRoutes(db.app, auth));
  app.route('/api/projects/:projectId/offers', offerRoutes(db.app, auth));
  app.route('/api/projects/:projectId/votes', voteRoutes(db.app, auth));
  app.route('/api/projects/:projectId/debates', debateRoutes(db.app, auth));
  app.route('/api/projects/:projectId/criteria', criteriaRoutes(db.app, auth));
  app.route('/api/projects/:projectId/decisions', decisionRoutes(db.app, auth));
  app.route('/api/projects/:projectId/decision-links', decisionLinkRoutes(db.app, auth, documents));
  app.route('/api/projects/:projectId/away', awayRoutes(db.app, auth, documents));
  app.route('/api/projects/:projectId/plan', planRoutes(db.app, auth, documents));
  app.route('/api/projects/:projectId/roadmap', roadmapRoutes(db.app, auth, live, documents));
  // Whether a limit of the AI is reached (spec 31a).
  app.route(
    '/api/projects/:projectId/usage',
    usageRoutes(db.app, auth, usageLimitsOf(env), undefined, (at) =>
      loadInstanceUsageTotal(db.admin, at),
    ),
  );
  app.route('/api/projects/:projectId/package', packageRoutes(db.app, auth, live, documents));
  app.route(
    '/api/projects/:projectId/git',
    gitRoutes(db.app, auth, git, documents, { admin: db.admin, appUrl: env.APP_URL }),
  );
  // GitLab says that something changed (spec 30a); the call proves itself with the project's
  // secret and carries no session.
  const webhookLimiter = createRateLimiter({ limit: WEBHOOK_CALLS_PER_MINUTE, windowMs: 60_000 });
  app.route(GIT_WEBHOOK_PATH, gitWebhook(db.admin, gitSetup?.tokenKey, webhookLimiter));
  app.route('/api/git/account', gitAccountRoutes(auth, git));
  app.route(GIT_CALLBACK_PATH, gitCallback(auth, env.APP_URL, git));
  const invitationMailLimiter = createRateLimiter({
    limit: INVITATION_MAILS_PER_HOUR,
    windowMs: 60 * 60_000,
  });
  app.route(
    '/api/projects/:projectId/invitations',
    projectInvitationRoutes(db.app, auth, {
      appUrl: env.APP_URL,
      mailer: mail.mailer,
      limiter: invitationMailLimiter,
    }),
  );
  app.route('/api/projects/:projectId/members', memberRoutes(db.app, auth, connections));
  app.route('/api/invitations', invitationRoutes(db.app, auth));
  app.route('/api/notifications', notificationRoutes(db.app, auth));
  app.route('/api/account', accountRoutes(db.app, auth));
  app.route(
    '/api/projects/:projectId/share-link',
    shareLinkRoutes(db.app, auth, { appUrl: env.APP_URL }),
  );
  const shareLimiter = createRateLimiter({ limit: SHARE_REQUESTS_PER_MINUTE, windowMs: 60_000 });
  app.route('/api/share', shareViewRoutes(db.app, documents, shareLimiter));
  app.route('/api/projects', projectRoutes(db.app, auth, live));
  app.route(
    '/api/agents/:agentId/knowledge',
    agentKnowledgeRoutes(db.app, auth, files, uploadLimiter),
  );
  app.route('/api/agents', customAgentRoutes(db.app, auth, live));

  // In the Docker image the server also delivers the web app (spec 02b); locally Vite does.
  if (env.WEB_DIST_DIR) serveWebApp(app, env.WEB_DIST_DIR, env.APP_URL);

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
