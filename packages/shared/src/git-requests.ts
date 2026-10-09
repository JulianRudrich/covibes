import { z } from 'zod';

import type { GitRepository } from './git';

// Git actions and their approval (spec 29b). Everything that changes something in a repository is
// a request that waits for approval; its actions are the single changes, and with their outcomes
// they are the log. Nothing here names a host: an action says what is created, not how GitLab is
// asked for it.

/** What a request is for. */
export const GIT_REQUEST_KINDS = ['issues'] as const;
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

/** A single change in the repository: a milestone that must be there, or a new issue. */
export const GIT_ACTION_KINDS = ['milestone', 'issue'] as const;
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
 * milestone of an issue was not there; anything else.
 */
export const GIT_ACTION_ERRORS = [
  'forbidden',
  'not_found',
  'invalid',
  'unreachable',
  'no_account',
  'milestone',
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

/** An action as it is asked for, before it has an id and an outcome. */
export const gitActionDraftSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('milestone'), payload: gitMilestonePayloadSchema }).strict(),
  z.object({ kind: z.literal('issue'), payload: gitIssuePayloadSchema }).strict(),
]);
export type GitActionDraft = z.infer<typeof gitActionDraftSchema>;

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
  issue: { number: number; url: string } | null;
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
