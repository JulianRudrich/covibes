// Writing to a repository (spec 29b), in words that name no host: what the job of a Git request
// needs from wherever the repository is. GitLab does it first (`gitlab/writer.ts`); a second host
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
};

/** The writer of a repository for a person's access token. */
export type RepositoryWriters = (
  target: { baseUrl: string; repositoryId: number },
  token: string,
) => RepositoryWriter;
