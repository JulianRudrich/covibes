import type { GitlabSource } from '@server/integrations/gitlab/client';

// Which GitLab the server connects projects to (spec 28a): the one an OAuth application is
// configured for, or, in development and tests without one, the stand-in the server serves itself.

/** Where the development stand-in for GitLab answers, below the API like the dev mailbox. */
export const DEV_GITLAB_PATH = '/api/dev/gitlab';

/** Where GitLab sends the person back to after the consent. */
export const GIT_CALLBACK_PATH = '/api/git/callback';

/** The OAuth application of the stand-in; it only exists on the developer's machine. */
export const DEV_GITLAB_CLIENT = { id: 'covibes-dev', secret: 'covibes-dev-secret' } as const;

export type GitlabSetup = {
  source: GitlabSource;
  /** The key the tokens are stored under. */
  tokenKey: string;
  /** The GitLab is the stand-in of this server, not a real one. */
  standIn: boolean;
};

type SetupEnv = {
  NODE_ENV: 'development' | 'test' | 'production';
  APP_URL: string;
  GITLAB_CLIENT_ID?: string | undefined;
  GITLAB_CLIENT_SECRET?: string | undefined;
  GITLAB_ISSUER?: string | undefined;
  TOKEN_KEY?: string | undefined;
};

const withoutSlash = (url: string) => url.replace(/\/+$/, '');

/**
 * How projects connect a repository on this server; undefined if they cannot: without a key for
 * the tokens, or in production without an OAuth application.
 */
export function gitlabSetup(env: SetupEnv): GitlabSetup | undefined {
  if (!env.TOKEN_KEY) return undefined;
  const appUrl = withoutSlash(env.APP_URL);
  const redirectUri = `${appUrl}${GIT_CALLBACK_PATH}`;
  if (env.GITLAB_CLIENT_ID && env.GITLAB_CLIENT_SECRET) {
    return {
      tokenKey: env.TOKEN_KEY,
      standIn: false,
      source: {
        baseUrl: withoutSlash(env.GITLAB_ISSUER ?? 'https://gitlab.com'),
        clientId: env.GITLAB_CLIENT_ID,
        clientSecret: env.GITLAB_CLIENT_SECRET,
        redirectUri,
      },
    };
  }
  if (env.NODE_ENV === 'production') return undefined;
  return {
    tokenKey: env.TOKEN_KEY,
    standIn: true,
    source: {
      baseUrl: `${appUrl}${DEV_GITLAB_PATH}`,
      clientId: DEV_GITLAB_CLIENT.id,
      clientSecret: DEV_GITLAB_CLIENT.secret,
      redirectUri,
    },
  };
}
