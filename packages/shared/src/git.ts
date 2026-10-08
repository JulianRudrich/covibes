import { z } from 'zod';

// The connection of a project to GitLab (spec 28a): what the web app shows of it. The tokens of a
// connection never leave the server.

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

/** The connection of a project: whose access it is and which repository it reaches. */
export type GitConnection = {
  /** Where the GitLab is, e.g. "https://gitlab.com". */
  baseUrl: string;
  /** The account in GitLab the access belongs to. */
  account: { username: string; name: string };
  /** The owner who connected. */
  connectedBy: { userId: string; name: string };
  connectedAt: string;
  /** The repository; null until the owner picked one. */
  repository: GitRepository | null;
};

/** `GET /api/projects/:projectId/git`. */
export type GitState = {
  /** The server can reach a GitLab: an OAuth application is set up, or the development stand-in. */
  available: boolean;
  /** The person connects, picks and disconnects: owners. */
  canManage: boolean;
  connection: GitConnection | null;
};

/** `POST /api/projects/:projectId/git/connect`: where the browser goes for the consent. */
export type GitConnectStart = { url: string };

/** `GET /api/projects/:projectId/git/repositories?search=`. */
export const gitRepositorySearchSchema = z.string().trim().max(100);

/** `PUT /api/projects/:projectId/git/repository`. */
export const gitRepositoryInputSchema = z
  .object({ repositoryId: z.number().int().positive() })
  .strict();
export type GitRepositoryInput = z.infer<typeof gitRepositoryInputSchema>;

/** How the way back from GitLab ended, as the project's address says it (`?git=`). */
export const GIT_RETURNS = ['connected', 'denied', 'failed'] as const;
export type GitReturn = (typeof GIT_RETURNS)[number];
