import { createHmac, randomBytes } from 'node:crypto';

import { Hono } from 'hono';

import type { GitlabSource } from '@server/integrations/gitlab/client';
import {
  addExampleRepositoryRoutes,
  createExampleStore,
} from '@server/integrations/gitlab/dev/example-repository';
import { sameSecret } from '@server/secrets';

// A stand-in for GitLab on the developer's machine (spec 28a), like the development mailbox: the
// consent page, the tokens and the few calls of the API that Covibes makes, with one example
// account and example repositories. It is never served in production. Its answers have the form
// of GitLab's, so the same client talks to both.

/** The one account of the stand-in. */
export const DEV_ACCOUNT = { id: 1, username: 'olga.beispiel', name: 'Olga Beispiel' } as const;

type DevRepository = {
  id: number;
  name: string;
  path_with_namespace: string;
  default_branch: string;
  /** Whether the repository has issues; creating one is refused where they are switched off. */
  issues_enabled: boolean;
};

/** The repositories the example account works in, the latest active first. */
export const DEV_REPOSITORIES: readonly DevRepository[] = [
  {
    id: 101,
    name: 'Vereins-App',
    path_with_namespace: 'beispiel-verein/vereins-app',
    default_branch: 'main',
    issues_enabled: true,
  },
  {
    id: 102,
    name: 'Website',
    path_with_namespace: 'beispiel-verein/website',
    default_branch: 'main',
    // To see a refusal: this repository takes no issues (spec 29b).
    issues_enabled: false,
  },
  {
    id: 103,
    name: 'Notizen',
    path_with_namespace: 'olga.beispiel/notizen',
    default_branch: 'master',
    issues_enabled: true,
  },
];

/** How long an access token of the stand-in holds, like GitLab's: two hours. */
const ACCESS_TOKEN_SECONDS = 2 * 60 * 60;
/** How long the code of the consent page can be traded. */
const CODE_SECONDS = 10 * 60;

type TokenKind = 'code' | 'access' | 'refresh';

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}

/** A page of the stand-in: it is plain on purpose and says that it is no real GitLab. */
function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { margin: 0; display: grid; min-height: 100vh; place-items: center; font: 15px/1.5 system-ui, sans-serif; }
      main { max-width: 420px; padding: 24px; border: 1px solid; border-radius: 12px; }
      h1 { margin: 0 0 4px; font-size: 18px; }
      p { margin: 8px 0; }
      .actions { display: flex; gap: 12px; margin-top: 16px; }
      a { padding: 6px 14px; border: 1px solid; border-radius: 8px; color: inherit; text-decoration: none; }
      a.allow { font-weight: 600; }
      small { opacity: 0.7; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <small>Nur in der Entwicklung. Hier antwortet Covibes selbst, kein echtes GitLab.</small>
      ${body}
    </main>
  </body>
</html>`;
}

export type GitlabStandIn = ReturnType<typeof createGitlabStandIn>;

/**
 * The stand-in as routes to mount below its address. `source` is the OAuth application it
 * accepts: its client, and the one address it sends people back to.
 */
export function createGitlabStandIn(
  source: Pick<GitlabSource, 'baseUrl' | 'clientId' | 'clientSecret' | 'redirectUri'>,
  now: () => number = Date.now,
) {
  // A token says what it is and when it was issued, and is signed. So it needs no memory and
  // still holds after the server restarted; otherwise every restart of the development server
  // would end the connections made before it.
  const sign = (text: string) =>
    createHmac('sha256', `covibes-dev:${source.clientSecret}`).update(text).digest('base64url');
  /** What this process issued, to count and to end tokens in tests. */
  const issued = new Map<string, TokenKind>();
  /** Codes and refresh tokens that were traded, and tokens that were revoked or forgotten. */
  const spent = new Set<string>();
  /** Access tokens a test let run out. */
  const ended = new Set<string>();

  function mint(kind: TokenKind): string {
    const body = `${kind}.${String(now())}.${randomBytes(9).toString('base64url')}`;
    const token = `${body}.${sign(body)}`;
    issued.set(token, kind);
    return token;
  }

  /** Whether a token is one of this stand-in, of the kind asked for, and still holds. */
  function holds(token: string, kind: TokenKind, seconds: number | null): boolean {
    const [given, issuedAt, nonce, signature, ...rest] = token.split('.');
    if (given !== kind || !issuedAt || !nonce || !signature || rest.length > 0) return false;
    if (!sameSecret(signature, sign(`${given}.${issuedAt}.${nonce}`))) return false;
    if (spent.has(token) || ended.has(token)) return false;
    return seconds === null || Number(issuedAt) + seconds * 1000 > now();
  }

  function issue() {
    return {
      access_token: mint('access'),
      token_type: 'bearer',
      expires_in: ACCESS_TOKEN_SECONDS,
      refresh_token: mint('refresh'),
      scope: 'api',
      created_at: Math.floor(now() / 1000),
    };
  }

  const repository = (entry: DevRepository) => ({
    ...entry,
    web_url: `${source.baseUrl}/${entry.path_with_namespace}`,
  });

  const routes = new Hono();

  /** The consent page: one account, allow or deny. */
  routes.get('/oauth/authorize', (c) => {
    const { client_id, redirect_uri, response_type, state = '', scope = '' } = c.req.query();
    // Like GitLab, it sends people back only to the address the application registered.
    if (
      client_id !== source.clientId ||
      redirect_uri !== source.redirectUri ||
      response_type !== 'code'
    ) {
      return c.text('The client application is unknown or the redirect URI is not valid.', 400);
    }
    const back = (params: Record<string, string>) =>
      `${source.redirectUri}?${new URLSearchParams({ ...params, state }).toString()}`;
    return c.html(
      page(
        'GitLab-Stellvertreter',
        `<p>Covibes möchte als <strong>${escapeHtml(DEV_ACCOUNT.name)}</strong> (@${escapeHtml(
          DEV_ACCOUNT.username,
        )}) auf die API zugreifen${scope ? ` (Umfang: <code>${escapeHtml(scope)}</code>)` : ''}.</p>
      <div class="actions">
        <a class="allow" href="${escapeHtml(back({ code: mint('code') }))}">Zugriff erlauben</a>
        <a href="${escapeHtml(
          back({ error: 'access_denied', error_description: 'The user denied the request' }),
        )}">Ablehnen</a>
      </div>`,
      ),
    );
  });

  /** Trades a code or a refresh token for tokens; each of them works once. */
  routes.post('/oauth/token', async (c) => {
    const body = await c.req.parseBody();
    const field = (name: string) => {
      const value = body[name];
      return typeof value === 'string' ? value : '';
    };
    if (field('client_id') !== source.clientId || field('client_secret') !== source.clientSecret) {
      return c.json({ error: 'invalid_client' }, 401);
    }
    const grant = field('grant_type');
    if (grant === 'authorization_code') {
      const code = field('code');
      if (field('redirect_uri') !== source.redirectUri || !holds(code, 'code', CODE_SECONDS)) {
        return c.json({ error: 'invalid_grant' }, 400);
      }
      spent.add(code);
      return c.json(issue());
    }
    if (grant === 'refresh_token') {
      const refresh = field('refresh_token');
      if (!holds(refresh, 'refresh', null)) return c.json({ error: 'invalid_grant' }, 400);
      spent.add(refresh);
      return c.json(issue());
    }
    return c.json({ error: 'unsupported_grant_type' }, 400);
  });

  routes.post('/oauth/revoke', async (c) => {
    const body = await c.req.parseBody();
    if (typeof body.token === 'string') spent.add(body.token);
    return c.json({});
  });

  /** The API answers only to an access token that still holds. */
  routes.use('/api/v4/*', async (c, next) => {
    const token = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1];
    if (!token || !holds(token, 'access', ACCESS_TOKEN_SECONDS)) {
      return c.json({ message: '401 Unauthorized' }, 401);
    }
    await next();
  });

  routes.get('/api/v4/user', (c) => c.json(DEV_ACCOUNT));

  routes.get('/api/v4/projects', (c) => {
    const search = (c.req.query('search') ?? '').toLowerCase();
    return c.json(
      DEV_REPOSITORIES.filter(
        (entry) =>
          entry.name.toLowerCase().includes(search) ||
          entry.path_with_namespace.toLowerCase().includes(search),
      ).map(repository),
    );
  });

  routes.get('/api/v4/projects/:id', (c) => {
    const found = DEV_REPOSITORIES.find((entry) => String(entry.id) === c.req.param('id'));
    return found ? c.json(repository(found)) : c.json({ message: '404 Project Not Found' }, 404);
  });

  // What the example repositories hold: files, issues and merge requests (spec 28b), and the
  // milestones and issues that were created since the stand-in started (spec 29b).
  const store = createExampleStore(now);
  addExampleRepositoryRoutes(
    routes,
    (id) => {
      const found = DEV_REPOSITORIES.find((entry) => entry.id === id);
      return found
        ? {
            defaultBranch: found.default_branch,
            webUrl: repository(found).web_url,
            issuesEnabled: found.issues_enabled,
          }
        : undefined;
    },
    store,
  );

  const byPath = (namespace: string, name: string) =>
    DEV_REPOSITORIES.find((entry) => entry.path_with_namespace === `${namespace}/${name}`);

  /** Where the link of an issue leads: its title and text, as the stand-in holds them. */
  routes.get('/:namespace/:name/-/issues/:iid', (c) => {
    const found = byPath(c.req.param('namespace'), c.req.param('name'));
    const issue = found
      ? store.issuesOf(found.id).find((entry) => String(entry.iid) === c.req.param('iid'))
      : undefined;
    if (!found || !issue) {
      return c.html(
        page(
          'Issue nicht gefunden',
          '<p>Diesen Issue kennt der Stellvertreter nicht (mehr): Was angelegt wurde, merkt er sich nur bis zum Neustart.</p>',
        ),
        404,
      );
    }
    return c.html(
      page(
        `#${String(issue.iid)} ${issue.title}`,
        `<p><strong>${escapeHtml(found.path_with_namespace)}</strong>${
          issue.milestone ? ` · ${escapeHtml(issue.milestone.title)}` : ''
        } · ${escapeHtml(issue.author.name)}</p>
      <pre style="white-space: pre-wrap; font: inherit">${escapeHtml(issue.description)}</pre>`,
      ),
    );
  });

  /** Where the link of a milestone leads. */
  routes.get('/:namespace/:name/-/milestones/:iid', (c) => {
    const found = byPath(c.req.param('namespace'), c.req.param('name'));
    const milestone = found
      ? store.milestonesOf(found.id).find((entry) => String(entry.iid) === c.req.param('iid'))
      : undefined;
    if (!found || !milestone) {
      return c.html(
        page(
          'Meilenstein nicht gefunden',
          '<p>Diesen Meilenstein kennt der Stellvertreter nicht (mehr): Was angelegt wurde, merkt er sich nur bis zum Neustart.</p>',
        ),
        404,
      );
    }
    const issues = store.issuesOf(found.id).filter((issue) => issue.milestone?.id === milestone.id);
    return c.html(
      page(
        milestone.title,
        `<p><strong>${escapeHtml(found.path_with_namespace)}</strong> · ${String(issues.length)} Issues</p>
      <p>${escapeHtml(milestone.description)}</p>`,
      ),
    );
  });

  /** Where the link of a connected repository leads: a page that says which one it stands for. */
  routes.get('/:namespace/:name', (c) => {
    const found = byPath(c.req.param('namespace'), c.req.param('name'));
    if (!found) return c.text('404 Not Found', 404);
    return c.html(
      page(
        found.name,
        `<p>Das Beispiel-Repository <strong>${escapeHtml(found.path_with_namespace)}</strong> von ${escapeHtml(
          DEV_ACCOUNT.name,
        )}, Standard-Branch <code>${escapeHtml(found.default_branch)}</code>.</p>`,
      ),
    );
  });

  const accessTokens = () =>
    [...issued].filter(([, kind]) => kind === 'access').map(([token]) => token);

  return {
    routes,
    /** For tests: every access token ends now, as if two hours had passed. */
    expireAccessTokens() {
      for (const token of accessTokens()) ended.add(token);
    },
    /** For tests: GitLab forgets every token, as if the person revoked the application. */
    forgetTokens() {
      for (const token of issued.keys()) spent.add(token);
    },
    /** For tests: how many access tokens hold, to see a revocation. */
    get accessTokenCount() {
      return accessTokens().filter((token) => holds(token, 'access', ACCESS_TOKEN_SECONDS)).length;
    },
  };
}
