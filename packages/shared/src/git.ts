import { z } from 'zod';

// GitLab in Covibes (specs 28a and 29a): the account a person connected, and the repository of a
// project, as the web app shows them. Tokens never leave the server.

/** A repository in GitLab ("project" there), as far as Covibes shows it. */
export type GitRepository = {
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
  /** Where the GitLab is, e.g. "https://gitlab.com". */
  baseUrl: string;
  /** The account in GitLab the access belongs to. */
  account: { username: string; name: string };
  /** The owner who picked the repository; the agents read with that person's access. */
  connectedBy: { userId: string; name: string };
  connectedAt: string;
  repository: GitRepository;
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

/**
 * How the way back from GitLab ended, as the address says it: `?git=` opens the dialog
 * "Repository", `?gitAccount=` the dialog "GitLab-Konto".
 */
export const GIT_RETURNS = ['connected', 'denied', 'failed'] as const;
export type GitReturn = (typeof GIT_RETURNS)[number];
