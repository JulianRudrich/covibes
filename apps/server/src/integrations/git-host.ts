// Writing to a repository (specs 29b and 29c), in words that name no host: what the job of a Git
// request needs from wherever the repository is. GitLab does it first (`gitlab/writer.ts`); a second host
// is added next to it and the job stays as it is.

/** A milestone that is in the repository now. */
export type WrittenMilestone = {
  /** The host's id of it, which an issue names to belong to it. */
  id: number;
  url: string | null;
  /** It was there before. */
  existed: boolean;
};

/** An issue that is in the repository now. */
export type WrittenIssue = {
  /** Its number there, as people write it: "#12". */
  number: number;
  url: string;
};

/** A commit of files on a branch. */
export type WrittenCommit = {
  /** Where the commit is; null if there was nothing left to commit. */
  url: string | null;
  /** How many files it added and how many it changed. */
  added: number;
  changed: number;
  /** The branch held every file already: nothing was committed. */
  existed: boolean;
};

/** A merge request that is open now. */
export type WrittenMergeRequest = {
  /** Its number in the repository, as people write it: "!7". */
  number: number;
  url: string;
  /** It was open before. */
  existed: boolean;
};

/** A file of a commit: it is added or changed (`write`), or only added when missing (`create`). */
export type FileToWrite = { path: string; content: string; mode: 'write' | 'create' };

/**
 * Why a write did not work: the host refused the access; the repository is gone or out of reach
 * for this person; the host did not take what was sent; it could not be reached; it no longer
 * accepts the person's token; anything else.
 */
export type RepositoryWriteFailure =
  'forbidden' | 'not_found' | 'invalid' | 'unreachable' | 'unauthorized' | 'failed';

export class RepositoryWriteError extends Error {
  constructor(
    readonly code: RepositoryWriteFailure,
    /** What the host said, as text for the log. */
    readonly detail: string,
  ) {
    super(`The repository refused a write (${code}): ${detail}`);
    this.name = 'RepositoryWriteError';
  }
}

/** One repository, written to with one person's access. */
export type RepositoryWriter = {
  /** Makes sure of a milestone with this title: the one that is there, or a new one. */
  ensureMilestone(input: { title: string; description: string }): Promise<WrittenMilestone>;
  createIssue(input: {
    title: string;
    /** Markdown. */
    description: string;
    milestoneId: number | null;
  }): Promise<WrittenIssue>;
  /** The issue whose description carries a mark; undefined if there is none. */
  findIssue(mark: string): Promise<WrittenIssue | undefined>;
  /**
   * Commits files on a branch. A branch that is not there is started from `startBranch`. Files
   * the branch does not hold are added, files that differ are changed, files that are the same
   * are left out; nothing is deleted. If nothing is left to commit, the branch stays as it is.
   */
  commitFiles(input: {
    branch: string;
    startBranch: string;
    message: string;
    files: readonly FileToWrite[];
  }): Promise<WrittenCommit>;
  /** Opens a merge request for a branch; one that is open for it already is used. */
  openMergeRequest(input: {
    sourceBranch: string;
    targetBranch: string;
    title: string;
    /** Markdown. */
    description: string;
  }): Promise<WrittenMergeRequest>;
};

/** The writer of a repository for a person's access token. */
export type RepositoryWriters = (
  target: { baseUrl: string; repositoryId: number },
  token: string,
) => RepositoryWriter;
