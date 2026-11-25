// Bounded repository-reading contracts shared by GitHub and GitLab (spec 46).

/** Entries of a folder that are shown at most. */
export const MAX_TREE_ENTRIES = 200;
/** Issues or merge requests a list shows at most. */
export const MAX_LISTED = 30;
/** Comments of an issue or merge request that are read at most. */
export const MAX_NOTES = 20;
/** Changed files of a merge request that are read at most. */
export const MAX_DIFFS = 30;
/** A file larger than this is not read. */
export const MAX_FILE_BYTES = 1024 * 1024;

export type RepositoryEntry = { name: string; path: string; kind: 'folder' | 'file' };

export type RepositoryFile =
  | { kind: 'text'; path: string; size: number; text: string }
  /** The file is no text, or too large to read. */
  | { kind: 'unreadable'; path: string; size: number; reason: 'binary' | 'too_large' };

export type RepositoryIssue = {
  number: number;
  title: string;
  state: string;
  description: string;
  labels: string[];
  assignees: string[];
  author: string;
  updatedAt: string | null;
};

export type RepositoryNote = { author: string; body: string; createdAt: string | null };

export type RepositoryMergeRequest = {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  sourceBranch: string;
  targetBranch: string;
  description: string;
  author: string;
  updatedAt: string | null;
  /** Its last commit; null if GitLab named none. */
  sha: string | null;
};

export type RepositoryDiff = {
  path: string;
  /** Where the file was before, if it was renamed. */
  previousPath: string | null;
  change: 'added' | 'deleted' | 'renamed' | 'changed';
  diff: string;
};

/** The connection of the project ended, e.g. its owner disconnected or GitLab refused it. */
export class RepositoryGoneError extends Error {
  constructor() {
    super('The project has no connection to a repository any more');
    this.name = 'RepositoryGoneError';
  }
}

export type IssueState = 'open' | 'closed' | 'all';
export type MergeRequestState = 'open' | 'merged' | 'closed' | 'all';

/** The repository of one project, as the agents' tools read it. */
export type RepositoryReader = {
  /** Which repository it is, for the agent's context. */
  repository: { path: string; name: string; defaultBranch: string | null };
  /** The entries of a folder, folders first; undefined if the folder or the ref does not exist. */
  tree(
    path: string,
    ref?: string,
  ): Promise<{ entries: RepositoryEntry[]; more: boolean } | undefined>;
  /** A file; undefined if it does not exist at that ref. */
  file(path: string, ref?: string): Promise<RepositoryFile | undefined>;
  issues(options: { state: IssueState; search?: string }): Promise<RepositoryIssue[]>;
  issue(number: number): Promise<{ issue: RepositoryIssue; notes: RepositoryNote[] } | undefined>;
  mergeRequests(options: { state: MergeRequestState }): Promise<RepositoryMergeRequest[]>;
  mergeRequest(number: number): Promise<
    | {
        mergeRequest: RepositoryMergeRequest;
        diffs: RepositoryDiff[];
        /** The merge request changes more files than were read. */
        moreDiffs: boolean;
        notes: RepositoryNote[];
      }
    | undefined
  >;
};

export type RepositoryReaders = (projectId: string) => Promise<RepositoryReader | undefined>;
