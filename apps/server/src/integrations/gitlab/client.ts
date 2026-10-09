import type { GitRepository } from '@covibes/shared';
import { z } from 'zod';

// A small client for GitLab (spec 28a): the OAuth flow and the few calls of its API that Covibes
// makes. It talks to any GitLab by its address, the real one and the development stand-in alike,
// and checks every answer before it passes it on.

/** A GitLab the server can reach as an OAuth application. */
export type GitlabSource = {
  /** Where the GitLab is, without a slash at the end, e.g. "https://gitlab.com". */
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** Where GitLab sends the person back to. */
  redirectUri: string;
};

/** The scope a connection asks for: reading and writing through the API (spec 29 writes). */
export const GITLAB_SCOPE = 'api';

/** Repositories offered to pick from, per search. */
export const REPOSITORIES_PER_SEARCH = 20;

/**
 * The lowest access the account must have to a repository it connects: Developer, since Covibes
 * later opens merge requests and issues with it (spec 29).
 */
const MIN_ACCESS_LEVEL = 30;

/** GitLab answered with an error; `status` is its HTTP status. */
export class GitlabError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GitlabError';
  }
}

export type GitlabTokens = {
  accessToken: string;
  refreshToken: string | null;
  /** When the access token ends; null if GitLab named no time. */
  expiresAt: Date | null;
  scope: string;
};

export type GitlabAccount = { id: number; username: string; name: string };

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).nullish(),
  expires_in: z.number().positive().nullish(),
  scope: z.string().nullish(),
});

const userSchema = z.object({
  id: z.number().int(),
  username: z.string().min(1),
  name: z.string().nullish(),
});

const projectSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  path_with_namespace: z.string().min(1),
  web_url: z.url(),
  default_branch: z.string().nullish(),
});

function toRepository(project: z.infer<typeof projectSchema>): GitRepository {
  return {
    id: project.id,
    path: project.path_with_namespace,
    name: project.name,
    url: project.web_url,
    defaultBranch: project.default_branch || null,
  };
}

export type GitlabClient = ReturnType<typeof createGitlabClient>;

export function createGitlabClient(fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  /** Sends a request and reads the answer as JSON; an error status becomes a `GitlabError`. */
  async function call(url: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(url, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      throw new GitlabError(0, `GitLab is not reachable: ${String(error)}`);
    }
    if (!response.ok) {
      // The body may name the reason; it never holds a token of ours.
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      throw new GitlabError(
        response.status,
        `GitLab answered ${String(response.status)} ${detail}`,
      );
    }
    return response.status === 204 ? undefined : await response.json().catch(() => undefined);
  }

  async function token(source: GitlabSource, grant: Record<string, string>) {
    const answer = await call(`${source.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        client_id: source.clientId,
        client_secret: source.clientSecret,
        redirect_uri: source.redirectUri,
        ...grant,
      }).toString(),
    });
    const parsed = tokenSchema.safeParse(answer);
    if (!parsed.success) throw new GitlabError(502, 'GitLab sent no tokens');
    return {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token ?? null,
      expiresAt: parsed.data.expires_in ? new Date(now() + parsed.data.expires_in * 1000) : null,
      scope: parsed.data.scope ?? '',
    } satisfies GitlabTokens;
  }

  const api = (baseUrl: string, path: string, accessToken: string) =>
    call(`${baseUrl}/api/v4${path}`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    });

  return {
    /**
     * One reading call of the API with a token: the answer as JSON, unchecked. The reading of a
     * repository (spec 28b) builds on it and checks what it gets.
     */
    get: api,

    /** Where the browser goes for the consent. */
    authorizeUrl(source: GitlabSource, state: string): string {
      const query = new URLSearchParams({
        client_id: source.clientId,
        redirect_uri: source.redirectUri,
        response_type: 'code',
        scope: GITLAB_SCOPE,
        state,
      });
      return `${source.baseUrl}/oauth/authorize?${query.toString()}`;
    },

    /** Trades the code of the way back for tokens. */
    exchangeCode(source: GitlabSource, code: string): Promise<GitlabTokens> {
      return token(source, { grant_type: 'authorization_code', code });
    },

    /** Trades a refresh token for new tokens; GitLab retires the old refresh token with it. */
    refresh(source: GitlabSource, refreshToken: string): Promise<GitlabTokens> {
      return token(source, { grant_type: 'refresh_token', refresh_token: refreshToken });
    },

    /** Tells GitLab that a token is no longer used. */
    async revoke(source: GitlabSource, accessToken: string): Promise<void> {
      await call(`${source.baseUrl}/oauth/revoke`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams({
          client_id: source.clientId,
          client_secret: source.clientSecret,
          token: accessToken,
        }).toString(),
      });
    },

    /** Whose account a token belongs to. */
    async account(baseUrl: string, accessToken: string): Promise<GitlabAccount> {
      const parsed = userSchema.safeParse(await api(baseUrl, '/user', accessToken));
      if (!parsed.success) throw new GitlabError(502, 'GitLab sent no account');
      return { id: parsed.data.id, username: parsed.data.username, name: parsed.data.name ?? '' };
    },

    /** The repositories the account works in, the latest active first, narrowed by a search. */
    async repositories(
      baseUrl: string,
      accessToken: string,
      search: string,
    ): Promise<GitRepository[]> {
      const query = new URLSearchParams({
        membership: 'true',
        simple: 'true',
        archived: 'false',
        min_access_level: String(MIN_ACCESS_LEVEL),
        order_by: 'last_activity_at',
        per_page: String(REPOSITORIES_PER_SEARCH),
        ...(search ? { search } : {}),
      });
      const answer = await api(baseUrl, `/projects?${query.toString()}`, accessToken);
      const parsed = z.array(z.unknown()).safeParse(answer);
      if (!parsed.success) throw new GitlabError(502, 'GitLab sent no list of repositories');
      // An entry GitLab words differently is left out instead of failing the whole list.
      return parsed.data.flatMap((entry) => {
        const project = projectSchema.safeParse(entry);
        return project.success ? [toRepository(project.data)] : [];
      });
    },

    /** One repository by its id; undefined if the account cannot reach it. */
    async repository(
      baseUrl: string,
      accessToken: string,
      id: number,
    ): Promise<GitRepository | undefined> {
      try {
        const parsed = projectSchema.safeParse(
          await api(baseUrl, `/projects/${String(id)}`, accessToken),
        );
        return parsed.success ? toRepository(parsed.data) : undefined;
      } catch (error) {
        if (error instanceof GitlabError && (error.status === 404 || error.status === 403)) {
          return undefined;
        }
        throw error;
      }
    },
  };
}
