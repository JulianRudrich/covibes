import { z } from 'zod';

import type { GitRepository } from './git';
import type { GitReviewSummary } from './git-reviews';

// Git actions and their approval (specs 29b to 29e). Everything that changes something in a
// repository is a request that waits for approval; its actions are the single changes, and with
// their outcomes they are the log. Nothing here names a host: an action says what is created, not
// how GitLab is asked for it.

/**
 * What a request is for: issues from the plan, the plan package as a merge request, or merging a
 * merge request.
 */
export const GIT_REQUEST_KINDS = ['issues', 'merge_request', 'merge'] as const;
export type GitRequestKind = (typeof GIT_REQUEST_KINDS)[number];

/**
 * Where a request stands: it waits for approval; it was approved and runs; all of it is done;
 * some of it failed (it can be approved again); someone rejected it; it was taken back, by who
 * made it or because the project's repository changed.
 */
export const GIT_REQUEST_STATUSES = [
  'waiting',
  'approved',
  'done',
  'failed',
  'rejected',
  'withdrawn',
] as const;
export type GitRequestStatus = (typeof GIT_REQUEST_STATUSES)[number];

/**
 * A single change in the repository: a milestone that must be there, a new issue, a commit of
 * files on a branch, a merge request for a branch, or the merging of a merge request.
 */
export const GIT_ACTION_KINDS = ['milestone', 'issue', 'commit', 'merge_request', 'merge'] as const;
export type GitActionKind = (typeof GIT_ACTION_KINDS)[number];

/**
 * Where an action stands: not run yet; started without a known outcome; done; failed; dropped
 * with its request (rejected or taken back before it ran).
 */
export const GIT_ACTION_STATUSES = ['waiting', 'started', 'done', 'failed', 'dropped'] as const;
export type GitActionStatus = (typeof GIT_ACTION_STATUSES)[number];

/**
 * Why an action failed: the host refused the access; the repository is gone; the host did not
 * take what was sent; the host could not be reached; the approver has no account (any more); the
 * milestone of an issue was not there; an action it builds on did not work; anything else.
 */
export const GIT_ACTION_ERRORS = [
  'forbidden',
  'not_found',
  'invalid',
  'unreachable',
  'no_account',
  'milestone',
  'blocked',
  'failed',
] as const;
export type GitActionError = (typeof GIT_ACTION_ERRORS)[number];

/** Issues one request creates at most; a longer plan takes another request. */
export const MAX_GIT_ISSUES = 100;

/** A milestone that must be in the repository; one of the same title is used. */
export const gitMilestonePayloadSchema = z
  .object({
    title: z.string().min(1).max(255),
    description: z.string().max(2000),
  })
  .strict();
export type GitMilestonePayload = z.infer<typeof gitMilestonePayloadSchema>;

/** An issue to create. */
export const gitIssuePayloadSchema = z
  .object({
    title: z.string().min(1).max(255),
    /** Markdown. */
    description: z.string().max(20_000),
    /** The title of its milestone, which an action before it makes sure of; null without one. */
    milestone: z.string().min(1).max(255).nullable(),
    /** The task of the plan the issue is for. */
    taskId: z.uuid(),
  })
  .strict();
export type GitIssuePayload = z.infer<typeof gitIssuePayloadSchema>;

/** Files one commit holds at most, and how much they weigh together as UTF-8. */
export const MAX_GIT_FILES = 600;
export const MAX_GIT_FILES_BYTES = 2 * 1024 * 1024;

/** A path inside a repository: parts with forward slashes, none of them empty, "." or "..". */
function isRepositoryPath(path: string): boolean {
  return (
    !path.includes('\\') &&
    path.split('/').every((part) => part.trim() !== '' && part !== '.' && part !== '..')
  );
}

/**
 * A file of a commit. `write`: it is added, or changed where it differs. `create`: it is only
 * added when it is missing; what the repository holds stays.
 */
export const gitFileSchema = z
  .object({
    /** Its path from the top of the repository, with forward slashes. */
    path: z.string().min(1).max(300).refine(isRepositoryPath),
    content: z.string(),
    mode: z.enum(['write', 'create']),
  })
  .strict();
export type GitFile = z.infer<typeof gitFileSchema>;

/** A commit of files on a branch; the branch is started from another one if it is not there. */
export const gitCommitPayloadSchema = z
  .object({
    /** What the list of actions calls it. */
    title: z.string().min(1).max(255),
    branch: z.string().min(1).max(200),
    startBranch: z.string().min(1).max(255),
    message: z.string().min(1).max(2000),
    files: z.array(gitFileSchema).min(1).max(MAX_GIT_FILES),
  })
  .strict();
export type GitCommitPayload = z.infer<typeof gitCommitPayloadSchema>;

/** A merge request for a branch, which a commit before it made. */
export const gitMergeRequestPayloadSchema = z
  .object({
    title: z.string().min(1).max(255),
    /** Markdown. */
    description: z.string().max(20_000),
    sourceBranch: z.string().min(1).max(200),
    targetBranch: z.string().min(1).max(255),
  })
  .strict();
export type GitMergeRequestPayload = z.infer<typeof gitMergeRequestPayloadSchema>;

/** The merging of a merge request, as it was when the request was made. */
export const gitMergePayloadSchema = z
  .object({
    /** What the list of actions calls it: its number and title, e.g. "!7 Login per Link". */
    title: z.string().min(1).max(255),
    /** Its number in the repository. */
    number: z.number().int().positive(),
    /**
     * Its last commit when the request was made. It is only merged while that is still its last
     * commit: what was approved is what is merged. Null if the host named none.
     */
    sha: z.string().min(1).max(100).nullable(),
  })
  .strict();
export type GitMergePayload = z.infer<typeof gitMergePayloadSchema>;

/** An action as it is asked for, before it has an id and an outcome. */
export const gitActionDraftSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('milestone'), payload: gitMilestonePayloadSchema }).strict(),
  z.object({ kind: z.literal('issue'), payload: gitIssuePayloadSchema }).strict(),
  z.object({ kind: z.literal('commit'), payload: gitCommitPayloadSchema }).strict(),
  z.object({ kind: z.literal('merge_request'), payload: gitMergeRequestPayloadSchema }).strict(),
  z.object({ kind: z.literal('merge'), payload: gitMergePayloadSchema }).strict(),
]);
export type GitActionDraft = z.infer<typeof gitActionDraftSchema>;
/** The actions of a request for issues, and of one for a merge request. */
export type GitIssueActionDraft = Extract<GitActionDraft, { kind: 'milestone' | 'issue' }>;
export type GitMergeRequestActionDraft = Extract<
  GitActionDraft,
  { kind: 'commit' | 'merge_request' }
>;

/** A person as the log names them; the id is gone once the account is. */
export type GitPerson = { userId: string | null; name: string };

/** An action with its outcome, as members see it. */
export type GitAction = {
  id: string;
  kind: GitActionKind;
  /** What it is about: the title of the issue or the milestone. */
  title: string;
  status: GitActionStatus;
  /** What it created, or found: its number in the repository and its address. */
  result: { number: number | null; url: string | null; existed: boolean } | null;
  /** Why it failed; `detail` is what the host said, as text. */
  error: { code: GitActionError; detail: string } | null;
};

/** A request with its actions, as members see it. */
export type GitRequest = {
  id: string;
  kind: GitRequestKind;
  status: GitRequestStatus;
  /** The repository it was made for. */
  repository: { path: string; url: string };
  requestedBy: GitPerson;
  /** The agent that made it (spec 29e); null for a request of a person. */
  agentKey: string | null;
  /** Who approved or rejected it; null while it waits, and when its maker took it back. */
  decidedBy: GitPerson | null;
  createdAt: string;
  decidedAt: string | null;
  finishedAt: string | null;
  actions: GitAction[];
};

/** `GET /api/projects/:projectId/git/requests`: what waits, runs or failed, and what was just done. */
export type GitRequests = {
  /** The person approves and rejects: owners, and editors with the right. */
  canApprove: boolean;
  /** The person has a GitLab account of their own, which approving needs. */
  hasAccount: boolean;
  requests: GitRequest[];
};

/** `POST /api/projects/:projectId/git/requests/approve`: one or several requests at once. */
export const approveGitRequestsInputSchema = z
  .object({ requestIds: z.array(z.uuid()).min(1).max(50) })
  .strict();
export type ApproveGitRequestsInput = z.infer<typeof approveGitRequestsInputSchema>;

/** The answer: how many of them were approved; the others were decided in the meantime. */
export type GitRequestsApproved = { approved: number };

/** A task of the plan with what is known of its issue. */
export type GitIssueTask = {
  /** The id the task carries in the plan; null until the server gave it one. */
  id: string | null;
  text: string;
  /**
   * `free`: it can be chosen. `requested`: an issue for it waits, runs or failed. `done`: it has
   * its issue.
   */
  state: 'free' | 'requested' | 'done';
  /** Its issue, and whether that is closed in the repository (spec 30a). */
  issue: { number: number; url: string; closed: boolean } | null;
};

/** `GET /api/projects/:projectId/git/issues`: the plan's tasks with their issues. */
export type GitIssuePlan = {
  /** The repository the issues go to; null while the project has none. */
  repository: GitRepository | null;
  /** The person makes requests: owners and editors. */
  canRequest: boolean;
  canApprove: boolean;
  hasAccount: boolean;
  milestones: { number: number; title: string; tasks: GitIssueTask[] }[];
};

/** `POST /api/projects/:projectId/git/issues`: a request for issues of these tasks. */
export const gitIssuesInputSchema = z
  .object({ taskIds: z.array(z.uuid()).min(1).max(MAX_GIT_ISSUES) })
  .strict();
export type GitIssuesInput = z.infer<typeof gitIssuesInputSchema>;

export type GitRequestCreated = { requestId: string };

/** `GET /api/projects/:projectId/git/log`: every request, the newest first. */
export type GitLog = { requests: GitRequest[] };

/**
 * A file of the package next to the repository's default branch: it is not there yet; it is
 * there in another form; it is the same; it is there and stays as it is (a file that is only
 * added when missing).
 */
export type GitFileState = 'new' | 'changed' | 'same' | 'kept';

/** `GET /api/projects/:projectId/git/merge-request`: the package next to the repository. */
export type GitMergeRequestPlan = {
  /** The repository the merge request goes to; null while the project has none. */
  repository: GitRepository | null;
  canRequest: boolean;
  canApprove: boolean;
  hasAccount: boolean;
  /** The package's files compared with the default branch; null if there is no comparison. */
  files: { path: string; state: GitFileState }[] | null;
  /**
   * Why there is no comparison: the plan is empty; the repository has no default branch; the
   * package is too large for a request; the repository could not be read.
   */
  problem: 'no_plan' | 'no_branch' | 'too_large' | 'unreachable' | null;
  /** Feature specs of an earlier package that the repository holds and this package does not. */
  stale: string[];
  /** A request for the package waits, runs or failed; a second one has to wait. */
  pending: boolean;
  /** The merge request the last request opened in this repository. */
  last: { number: number; url: string } | null;
};

/** An open merge request of the repository, as the dialog "Merge Requests" lists it (spec 29d). */
export type GitOpenMergeRequest = {
  /** Its number in the repository, as people write it: "!7". */
  number: number;
  title: string;
  /** Its address in GitLab, for a link. */
  url: string;
  sourceBranch: string;
  targetBranch: string;
  /** Who opened it. */
  author: string;
  updatedAt: string | null;
  /** It is marked as not ready; a draft is not merged. */
  draft: boolean;
  /** GitLab says its branches cannot be merged as they are. */
  conflicts: boolean;
  /** A request to merge it waits, runs or failed; a second one has to wait. */
  requested: boolean;
  /** The issue Covibes created that it belongs to (spec 30b); null for someone's own. */
  issueNumber: number | null;
  /** Its latest review against the architecture; null if it has none. */
  review: GitReviewSummary | null;
  /** The review is about the commits the merge request has now. */
  reviewCurrent: boolean;
};

/** `GET /api/projects/:projectId/git/merge-requests`: what can be merged. */
export type GitMergeRequests = {
  /** The repository; null while the project has none. */
  repository: GitRepository | null;
  canRequest: boolean;
  canApprove: boolean;
  hasAccount: boolean;
  /** The person starts reviews: owners and editors (spec 30b). */
  canReview: boolean;
  /** The open merge requests, the latest changed first; null if they could not be read. */
  mergeRequests: GitOpenMergeRequest[] | null;
};
