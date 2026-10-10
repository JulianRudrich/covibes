import type { DB } from '@covibes/db';
import {
  GIT_REVIEW_VERDICTS,
  projectIdSchema,
  readReviewFindings,
  type ApiErrorCode,
  type GitConnection,
  type GitReview,
  type GitReviews,
  type GitReviewStarted,
  type GitReviewStatus,
  type GitReviewSummary,
} from '@covibes/shared';
import type { Context, Hono } from 'hono';
import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from 'zod';

import { apiError } from '@server/api/errors';
import type { SessionVariables } from '@server/auth/session';
import { withUser, type AppDb } from '@server/db/database';
import { issueOfMergeRequest } from '@server/git/merge-request-issue';
import { GitlabError, type GitlabClient } from '@server/integrations/gitlab/client';
import type { GitConnections } from '@server/integrations/gitlab/connections';
import { readMergeRequest } from '@server/integrations/gitlab/merge-requests';
import { loadTaskIssues } from '@server/plan/task-issues';

// Reviews of merge requests against the architecture (spec 30b): what members read of them, and
// the click that starts one. The review itself is the worker's (`tasks/mr-review.ts`).

type Env = { Variables: SessionVariables };

/** Reviews of open merge requests the overview lists at most. */
const MAX_LISTED_REVIEWS = 30;

/** A run that neither ended nor failed for this long is taken as lost (as the database does). */
const LOST_AFTER_MS = 10 * 60_000;

/** What a refusal of the database's function is for the API. */
const REFUSALS: Readonly<Record<string, ApiErrorCode>> = {
  '42501': 'forbidden',
  P0002: 'not_found',
  // This state of the merge request was reviewed already, or is being reviewed.
  '55000': 'already_running',
  // The reviews of the day are used up.
  '53400': 'limit_reached',
  '23514': 'invalid_input',
};

const verdictSchema = z.enum(GIT_REVIEW_VERDICTS).nullable().catch(null);

function sqlState(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

function reviews(db: Kysely<DB>, projectId: string) {
  return db
    .selectFrom('git_reviews')
    .innerJoin('ai_runs', 'ai_runs.id', 'git_reviews.run_id')
    .leftJoin('users', 'users.id', 'git_reviews.requested_by')
    .select([
      'git_reviews.id',
      'git_reviews.number',
      'git_reviews.sha',
      'git_reviews.title',
      'git_reviews.url',
      'git_reviews.source_branch',
      'git_reviews.author',
      'git_reviews.issue_number',
      'git_reviews.trigger',
      'git_reviews.requested_by',
      'git_reviews.verdict',
      'git_reviews.summary',
      'git_reviews.findings',
      'git_reviews.mr_open',
      'git_reviews.created_at',
      'git_reviews.finished_at',
      'ai_runs.status as run_status',
      'ai_runs.created_at as run_created_at',
      'users.name as requested_by_name',
    ])
    .where('git_reviews.project_id', '=', projectId);
}

type ReviewRow = Awaited<ReturnType<ReturnType<typeof reviews>['execute']>>[number];

function toReview(row: ReviewRow, now = Date.now()): GitReview {
  const verdict = verdictSchema.parse(row.verdict);
  const waiting = row.run_status === 'queued' || row.run_status === 'running';
  const status: GitReviewStatus =
    waiting && now - row.run_created_at.getTime() < LOST_AFTER_MS
      ? row.run_status === 'queued'
        ? 'queued'
        : 'running'
      : row.run_status === 'done' && verdict !== null
        ? 'done'
        : 'failed';
  return {
    id: row.id,
    number: Number(row.number),
    sha: row.sha,
    status,
    verdict: status === 'done' ? verdict : null,
    trigger: row.trigger === 'auto' ? 'auto' : 'manual',
    createdAt: row.created_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
    title: row.title,
    url: row.url,
    sourceBranch: row.source_branch,
    author: row.author,
    issueNumber: row.issue_number === null ? null : Number(row.issue_number),
    requestedBy:
      row.requested_by === null
        ? null
        : { userId: row.requested_by, name: row.requested_by_name ?? '' },
    summary: status === 'done' ? row.summary : null,
    findings: status === 'done' ? readReviewFindings(row.findings) : [],
    open: row.mr_open,
  };
}

/** A review as the list of merge requests shows it. */
export function reviewSummary(review: GitReview): GitReviewSummary {
  return {
    id: review.id,
    number: review.number,
    sha: review.sha,
    status: review.status,
    verdict: review.verdict,
    findings: review.findings.length,
    trigger: review.trigger,
    createdAt: review.createdAt,
    finishedAt: review.finishedAt,
  };
}

/**
 * The latest review of every merge request of the project's repository, by the merge request's
 * number. `db` decides what is visible: a member's transaction.
 */
export async function loadLatestReviews(
  db: Kysely<DB>,
  projectId: string,
  repository: Pick<GitConnection, 'baseUrl' | 'repository'>,
): Promise<Map<number, GitReview>> {
  const rows = await reviews(db, projectId)
    .distinctOn('git_reviews.number')
    .where('git_reviews.base_url', '=', repository.baseUrl)
    .where('git_reviews.repository_id', '=', String(repository.repository.id))
    .orderBy('git_reviews.number')
    .orderBy('git_reviews.created_at', 'desc')
    .execute();
  return new Map(rows.map((row) => [Number(row.number), toReview(row)]));
}

/** Adds the routes of the reviews below `/api/projects/:projectId/git`. */
export function addGitReviewRoutes(
  routes: Hono<Env>,
  {
    db,
    git,
    connection,
  }: {
    db: AppDb;
    /** How the server reaches GitLab; undefined on a server that is not set up for it. */
    git:
      | { client: Pick<GitlabClient, 'get'>; connections: Pick<GitConnections, 'access'> }
      | undefined;
    connection: (trx: Transaction<DB>, projectId: string) => Promise<GitConnection | null>;
  },
) {
  /** The person and the project of a request, or the error to answer with. */
  function asked(c: Context<Env>) {
    const user = c.get('user');
    if (!user) return { error: apiError(c, 'unauthorized') } as const;
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return { error: apiError(c, 'not_found') } as const;
    return { userId: user.id, projectId: projectId.data } as const;
  }

  const roleOf = (trx: Transaction<DB>, projectId: string, userId: string) =>
    trx
      .selectFrom('project_members')
      .select('role')
      .where('project_id', '=', projectId)
      .where('user_id', '=', userId)
      .executeTakeFirst();

  /** The latest review of every merge request that is still open, the newest first. */
  routes.get('/reviews', async (c) => {
    const who = asked(c);
    if ('error' in who) return who.error;
    const found = await withUser(db, who.userId, async (trx) => {
      if (!(await roleOf(trx, who.projectId, who.userId))) return undefined;
      const repository = await connection(trx, who.projectId);
      return repository
        ? [...(await loadLatestReviews(trx, who.projectId, repository)).values()]
        : [];
    });
    if (!found) return apiError(c, 'not_found');
    return c.json<GitReviews>({
      reviews: found
        .filter((review) => review.open)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, MAX_LISTED_REVIEWS),
    });
  });

  /** One review with its findings. */
  routes.get('/reviews/:reviewId', async (c) => {
    const who = asked(c);
    if ('error' in who) return who.error;
    const reviewId = z.uuid().safeParse(c.req.param('reviewId'));
    if (!reviewId.success) return apiError(c, 'not_found');
    const row = await withUser(db, who.userId, async (trx) => {
      if (!(await roleOf(trx, who.projectId, who.userId))) return undefined;
      return await reviews(trx, who.projectId)
        .where('git_reviews.id', '=', reviewId.data)
        .executeTakeFirst();
    });
    if (!row) return apiError(c, 'not_found');
    return c.json<GitReview>(toReview(row));
  });

  /**
   * Starts the review of an open merge request at the state its commits have now, for owners and
   * editors. The server reads the merge request itself; the database checks who asks, that this
   * state has no review yet, and the bounds of the day.
   */
  routes.post('/merge-requests/:number/review', async (c) => {
    const who = asked(c);
    if ('error' in who) return who.error;
    const number = z.coerce.number().int().positive().safeParse(c.req.param('number'));
    if (!number.success) return apiError(c, 'not_found');
    const stored = await withUser(db, who.userId, async (trx) => {
      const row = await roleOf(trx, who.projectId, who.userId);
      if (!row) return undefined;
      return {
        row,
        repository: await connection(trx, who.projectId),
        issues: await loadTaskIssues(trx, who.projectId),
      };
    });
    if (!stored) return apiError(c, 'not_found');
    if (stored.row.role === 'viewer') return apiError(c, 'forbidden');
    if (!stored.repository) return apiError(c, 'not_found');

    let found: Awaited<ReturnType<typeof readMergeRequest>>;
    try {
      const access = await git?.connections.access(who.projectId);
      if (!git || !access) return apiError(c, 'not_found');
      found = await readMergeRequest(
        git.client,
        { baseUrl: access.baseUrl, repositoryId: stored.repository.repository.id },
        access.token,
        number.data,
      );
    } catch (error) {
      if (!(error instanceof GitlabError)) throw error;
      return apiError(c, 'internal');
    }
    if (!found) return apiError(c, 'not_found');
    // A merge request without commits has nothing to review; a merged one is done with.
    if (found.state !== 'opened' || found.sha === null) return apiError(c, 'invalid_input');
    const merge = found;
    const issue = issueOfMergeRequest(
      merge,
      new Set([...stored.issues.values()].map((entry) => entry.number)),
    );

    try {
      const reviewId = await withUser(db, who.userId, async (trx) => {
        const started = await sql<{ id: string }>`
          select public.request_git_review(
            ${who.projectId}, ${merge.number}, ${merge.sha}, ${merge.title || `!${String(merge.number)}`},
            ${merge.url}, ${merge.sourceBranch}, ${merge.author}, ${issue}
          ) as id`.execute(trx);
        return started.rows[0]?.id ?? '';
      });
      return c.json<GitReviewStarted>({ reviewId }, 201);
    } catch (error) {
      const state = sqlState(error);
      const refused = state === undefined ? undefined : REFUSALS[state];
      if (!refused) throw error;
      return apiError(c, refused);
    }
  });
}
