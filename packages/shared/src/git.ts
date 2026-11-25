import { z } from 'zod';

// Repository integration contracts (specs 28a, 29a and 46). Tokens never leave the server.

export type GitProvider = 'github' | 'gitlab';

/** A repository in GitLab ("project" there), as far as Covibes shows it. */
export type GitRepository = {
  provider?: GitProvider;
  /** The id GitLab gives it. */
  id: number;
  /** Its path with the namespace, e.g. "verein/app". */
  path: string;
  name: string;
  /** Its address in GitLab, for a link. */
  url: string;
  defaultBranch: string | null;
};

/** The GitLab account a person connected (spec 29a). */
export type GitAccount = {
  /** Where the GitLab is, e.g. "https://gitlab.com". */
  baseUrl: string;
  username: string;
  name: string;
};

/** `GET /api/git/account`: the own account. */
export type GitAccountState = {
  /** The server can reach a GitLab: an OAuth application is set up, or the development stand-in. */
  available: boolean;
  account: GitAccount | null;
};

/** The repository of a project: which one, and with whose account it is reached. */
export type GitConnection = {
  provider?: GitProvider;
  /** Where the GitLab is, e.g. "https://gitlab.com". */
  baseUrl: string;
  /** The account in GitLab the access belongs to. */
  account: { username: string; name: string };
  /** The owner who picked the repository; the agents read with that person's access. */
  connectedBy: { userId: string; name: string };
  connectedAt: string;
  repository: GitRepository;
};

/**
 * When the repository's state was last read (spec 30a): the issues Covibes created, and from part
 * 30b on its merge requests.
 */
export type GitSync = {
  /** When a reading last worked; null if none did yet. */
  syncedAt: string | null;
  /** The last reading did not work. */
  failed: boolean;
};

/** `POST /api/projects/:projectId/git/sync`: asks for a reading; `force` is a person's click. */
export const gitSyncInputSchema = z.object({ force: z.boolean().optional() }).strict();
export type GitSyncInput = z.infer<typeof gitSyncInputSchema>;

/** The answer: whether a reading was queued; not if one ran a moment ago. */
export type GitSyncRequested = { queued: boolean };

/**
 * `GET /api/projects/:projectId/git/webhook`, for owners: what to enter in GitLab so it says at
 * once when something changed.
 */
export type GitWebhook = {
  /** The address GitLab calls. */
  url: string;
  /** The secret GitLab sends with every call ("Secret token" there). */
  secret: string;
};

/** `GET /api/projects/:projectId/git`. */
export type GitState = {
  /** The server can reach a GitLab: an OAuth application is set up, or the development stand-in. */
  available: boolean;
  /** The person picks and removes the repository: owners. */
  canManage: boolean;
  /** The person's own GitLab account, with which an owner picks the repository. */
  account: GitAccount | null;
  connection: GitConnection | null;
  /** When the repository's state was last read; null before the first reading. */
  sync: GitSync | null;
};

/** Where a flow to GitLab was started from, and so where it leads back to. */
export const GIT_ORIGINS = ['repository', 'account'] as const;
export type GitOrigin = (typeof GIT_ORIGINS)[number];

/** `POST /api/git/account/connect`: starts the way to GitLab's consent page. */
export const gitConnectInputSchema = z
  .object({
    /** The dialog the person comes back to: the project's repository, or the own account. */
    origin: z.enum(GIT_ORIGINS),
    /** The project the person is in, to come back to it. */
    projectId: z.uuid().optional(),
  })
  .strict();
export type GitConnectInput = z.infer<typeof gitConnectInputSchema>;

/** The answer: where the browser goes for the consent. */
export type GitConnectStart = { url: string };

/** `GET /api/projects/:projectId/git/repositories?search=`. */
export const gitRepositorySearchSchema = z.string().trim().max(100);

/** `PUT /api/projects/:projectId/git/repository`. */
export const gitRepositoryInputSchema = z
  .object({ repositoryId: z.number().int().positive() })
  .strict();
export type GitRepositoryInput = z.infer<typeof gitRepositoryInputSchema>;

/** GitHub App authorization belongs to the signed-in integration account, separate from login. */
export type GithubAccountState = GitAccountState & { installUrl: string | null };
export type GithubInstallations = {
  installations: {
    id: number;
    account: string;
    permissions: { contents?: string; issues?: string; pull_requests?: string };
  }[];
  more: boolean;
};
export const githubRepositoryInputSchema = z
  .object({
    installationId: z.number().int().positive(),
    repositoryId: z.number().int().positive(),
  })
  .strict();
export type GithubRepositoryInput = z.infer<typeof githubRepositoryInputSchema>;
export const githubRepositoriesQuerySchema = z.object({
  installationId: z.coerce.number().int().positive(),
  search: gitRepositorySearchSchema.default(''),
});

/**
 * How the way back from GitLab ended, as the address says it: `?git=` opens the dialog
 * "Repository", `?gitAccount=` the dialog "GitLab-Konto".
 */
export const GIT_RETURNS = ['connected', 'denied', 'failed'] as const;
export type GitReturn = (typeof GIT_RETURNS)[number];
