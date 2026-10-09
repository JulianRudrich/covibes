import { randomBytes } from 'node:crypto';

import type { DB } from '@covibes/db';
import {
  approveGitRequestsInputSchema,
  buildCodingPackage,
  buildIssueActions,
  buildMergeRequestActions,
  GIT_ACTION_ERRORS,
  GIT_ACTION_KINDS,
  GIT_ACTION_STATUSES,
  GIT_REQUEST_KINDS,
  GIT_REQUEST_STATUSES,
  gitFilesOf,
  gitIssuesInputSchema,
  MAX_GIT_FILES,
  MAX_GIT_FILES_BYTES,
  mergeRequestBranch,
  packageBytes,
  projectIdSchema,
  readRoadmap,
  STALE_SPEC_PATTERN,
  withAssignees,
  type ApiErrorCode,
  type GitAction,
  type GitConnection,
  type GitFileState,
  type GitIssuePlan,
  type GitIssueTask,
  type GitLog,
  type GitMergeRequestPlan,
  type GitRequest,
  type GitRequestCreated,
  type GitRequests,
  type GitRequestsApproved,
} from '@covibes/shared';
import type { Context, Hono } from 'hono';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';

import { apiError } from '@server/api/errors';
import { gatherPackage } from '@server/api/package';
import type { SessionVariables } from '@server/auth/session';
import type { BoardDocuments } from '@server/collab/collab';
import { withUser, type AppDb } from '@server/db/database';
import { fileStates, foldersOf, listBlobs } from '@server/integrations/gitlab/blobs';
import { GitlabError, type GitlabClient } from '@server/integrations/gitlab/client';
import type { GitConnections } from '@server/integrations/gitlab/connections';
import { loadAssignees } from '@server/plan/assignees';

// Git requests and the log of Git actions (specs 29b and 29c). The database decides who makes,
// approves, rejects and takes back a request; these routes word the actions and show what there
// is.

type Env = { Variables: SessionVariables };

/** Requests the log shows at most, the newest first. */
export const GIT_LOG_REQUESTS = 100;

/** A request that was done stays in the list of what waits for this long, as a line with a check. */
const DONE_SHOWN_MS = 60 * 60_000;

const requestKindSchema = z.enum(GIT_REQUEST_KINDS);
const requestStatusSchema = z.enum(GIT_REQUEST_STATUSES);
const actionKindSchema = z.enum(GIT_ACTION_KINDS);
const actionStatusSchema = z.enum(GIT_ACTION_STATUSES);
const actionErrorSchema = z.enum(GIT_ACTION_ERRORS);

function sqlState(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** What a refusal of one of the database's functions is for the API. */
const REFUSALS: Readonly<Record<string, ApiErrorCode>> = {
  '42501': 'forbidden',
  P0002: 'not_found',
  '55000': 'already_decided',
  // A task that has an issue already, or one that waits.
  '23505': 'already_running',
  '22023': 'invalid_input',
  '22P02': 'invalid_input',
  '23514': 'invalid_input',
};

function member(trx: Transaction<DB>, projectId: string, userId: string) {
  return trx
    .selectFrom('project_members')
    .select(['role', 'can_approve_git'])
    .where('project_id', '=', projectId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
}

const canApprove = (row: { role: string; can_approve_git: boolean }) =>
  row.role === 'owner' || row.can_approve_git;

/** The requests of a project with their actions, as members see them, in the order given. */
async function loadRequests(
  trx: Transaction<DB>,
  projectId: string,
  options: { open: boolean; limit: number },
): Promise<GitRequest[]> {
  let query = trx
    .selectFrom('git_requests')
    .selectAll()
    .where('project_id', '=', projectId)
    .limit(options.limit);
  query = options.open
    ? query
        .where((eb) =>
          eb.or([
            eb('status', 'in', ['waiting', 'approved', 'failed']),
            eb.and([
              eb('status', '=', 'done'),
              eb('finished_at', '>', new Date(Date.now() - DONE_SHOWN_MS)),
            ]),
          ]),
        )
        .orderBy('created_at')
        .orderBy('id')
    : query.orderBy('created_at', 'desc').orderBy('id');
  const rows = await query.execute();
  if (rows.length === 0) return [];
  const steps = await trx
    .selectFrom('git_actions')
    .select([
      'id',
      'request_id',
      'kind',
      'title',
      'status',
      'result_number',
      'result_url',
      'result_existed',
      'error_code',
      'error_detail',
    ])
    .where(
      'request_id',
      'in',
      rows.map((row) => row.id),
    )
    .orderBy('position')
    .execute();

  return rows.flatMap((row): GitRequest[] => {
    const kind = requestKindSchema.safeParse(row.kind);
    const status = requestStatusSchema.safeParse(row.status);
    // A row from another version of the app is left out instead of failing the list.
    if (!kind.success || !status.success) return [];
    const decided = status.data !== 'waiting' && status.data !== 'withdrawn';
    return [
      {
        id: row.id,
        kind: kind.data,
        status: status.data,
        repository: { path: row.repository_path, url: row.repository_url },
        requestedBy: { userId: row.requested_by, name: row.requested_by_name },
        decidedBy:
          decided && row.decided_at ? { userId: row.decided_by, name: row.decided_by_name } : null,
        createdAt: row.created_at.toISOString(),
        decidedAt: row.decided_at?.toISOString() ?? null,
        finishedAt: row.finished_at?.toISOString() ?? null,
        actions: steps
          .filter((step) => step.request_id === row.id)
          .flatMap((step): GitAction[] => {
            const stepKind = actionKindSchema.safeParse(step.kind);
            const stepStatus = actionStatusSchema.safeParse(step.status);
            if (!stepKind.success || !stepStatus.success) return [];
            const error = actionErrorSchema.safeParse(step.error_code);
            return [
              {
                id: step.id,
                kind: stepKind.data,
                title: step.title,
                status: stepStatus.data,
                result:
                  stepStatus.data === 'done'
                    ? {
                        number: step.result_number === null ? null : Number(step.result_number),
                        url: step.result_url,
                        existed: step.result_existed,
                      }
                    : null,
                error:
                  stepStatus.data === 'failed' && error.success
                    ? { code: error.data, detail: step.error_detail }
                    : null,
              },
            ];
          }),
      },
    ];
  });
}

type Documents = Pick<
  BoardDocuments,
  'readPlanSections' | 'giveTaskIds' | 'readBoard' | 'readPlan'
>;

/** The folder of the package's feature specs, where those of an earlier package may lie. */
const SPECS_FOLDER = 'context/feature-specs';

/**
 * Adds the routes of Git requests below `/api/projects/:projectId/git` (specs 29b and 29c): what
 * waits, approving, rejecting and taking back; the plan's tasks with their issues and the request
 * for new ones; the package next to the repository and the request for its merge request; the
 * log. `connection` reads the repository of a project as members see it.
 */
export function addGitRequestRoutes(
  routes: Hono<Env>,
  {
    db,
    documents,
    git,
    connection,
  }: {
    db: AppDb;
    documents: Documents;
    /** How the server reaches GitLab; undefined on a server that is not set up for it. */
    git:
      | {
          client: Pick<GitlabClient, 'get'>;
          connections: Pick<GitConnections, 'account' | 'access'>;
        }
      | undefined;
    connection: (trx: Transaction<DB>, projectId: string) => Promise<GitConnection | null>;
  },
) {
  const connections = git?.connections;

  /** The person and the project of a request, or the error to answer with. */
  function asked(c: Context<Env>) {
    const user = c.get('user');
    if (!user) return { error: apiError(c, 'unauthorized') } as const;
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return { error: apiError(c, 'not_found') } as const;
    return { userId: user.id, projectId: projectId.data } as const;
  }

  const hasAccount = async (userId: string) =>
    ((await connections?.account(userId)) ?? null) !== null;

  routes.get('/requests', async (c) => {
    const who = asked(c);
    if ('error' in who) return who.error;
    const found = await withUser(db, who.userId, async (trx) => {
      const row = await member(trx, who.projectId, who.userId);
      if (!row) return undefined;
      return {
        canApprove: canApprove(row),
        requests: await loadRequests(trx, who.projectId, { open: true, limit: 200 }),
      };
    });
    if (!found) return apiError(c, 'not_found');
    return c.json<GitRequests>({ ...found, hasAccount: await hasAccount(who.userId) });
  });

  /** Runs one of the database's functions for the person; a refusal becomes an API error. */
  async function decide<T>(
    c: Context<Env>,
    userId: string,
    call: (trx: Transaction<DB>) => Promise<T>,
  ): Promise<{ value: T } | { error: Response }> {
    try {
      return { value: await withUser(db, userId, call) };
    } catch (error) {
      const state = sqlState(error);
      // Approving needs an own GitLab account; the web app leads to connecting it.
      if (state === '28000') return { error: apiError(c, 'forbidden', 'git_account') };
      const refused = state === undefined ? undefined : REFUSALS[state];
      if (!refused) throw error;
      return { error: apiError(c, refused) };
    }
  }

  /** Approves one or several requests; each becomes a job of the worker. */
  routes.post('/requests/approve', async (c) => {
    const who = asked(c);
    if ('error' in who) return who.error;
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = approveGitRequestsInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'invalid_input');
    const isMember = await withUser(db, who.userId, (trx) =>
      member(trx, who.projectId, who.userId),
    );
    if (!isMember) return apiError(c, 'not_found');

    const outcome = await decide(c, who.userId, async (trx) => {
      const approved = await sql<{ approved: number }>`
        select public.approve_git_requests(
          ${who.projectId}, ${input.data.requestIds}::uuid[]
        ) as approved`.execute(trx);
      return approved.rows[0]?.approved ?? 0;
    });
    if ('error' in outcome) return outcome.error;
    return c.json<GitRequestsApproved>({ approved: outcome.value });
  });

  for (const decision of ['reject', 'withdraw'] as const) {
    routes.post(`/requests/:requestId/${decision}`, async (c) => {
      const who = asked(c);
      if ('error' in who) return who.error;
      const requestId = z.uuid().safeParse(c.req.param('requestId'));
      if (!requestId.success) return apiError(c, 'not_found');
      const isMember = await withUser(db, who.userId, (trx) =>
        member(trx, who.projectId, who.userId),
      );
      if (!isMember) return apiError(c, 'not_found');

      const outcome = await decide(c, who.userId, (trx) =>
        (decision === 'reject'
          ? sql`select public.reject_git_request(${who.projectId}, ${requestId.data})`
          : sql`select public.withdraw_git_request(${who.projectId}, ${requestId.data})`
        ).execute(trx),
      );
      if ('error' in outcome) return outcome.error;
      return c.body(null, 204);
    });
  }

  /** The plan's tasks with their issues in the project's repository, to pick from. */
  routes.get('/issues', async (c) => {
    const who = asked(c);
    if ('error' in who) return who.error;
    const stored = await withUser(db, who.userId, async (trx) => {
      const row = await member(trx, who.projectId, who.userId);
      if (!row) return undefined;
      const repository = await connection(trx, who.projectId);
      const issues = repository
        ? await trx
            .selectFrom('git_actions')
            .innerJoin('git_requests', 'git_requests.id', 'git_actions.request_id')
            .select([
              'git_actions.task_id',
              'git_actions.status',
              'git_actions.result_number',
              'git_actions.result_url',
            ])
            .where('git_actions.project_id', '=', who.projectId)
            .where('git_actions.kind', '=', 'issue')
            .where('git_actions.status', '<>', 'dropped')
            .where('git_requests.base_url', '=', repository.baseUrl)
            .where('git_requests.repository_id', '=', String(repository.repository.id))
            .execute()
        : [];
      return { row, repository, issues };
    });
    if (!stored) return apiError(c, 'not_found');

    const roadmap = readRoadmap(await documents.readPlanSections(who.projectId));
    // A task without an id cannot get an issue; the server gives ids now, and the roadmap is
    // announced again once they are there.
    if (roadmap.milestones.some((milestone) => milestone.tasks.some((task) => task.id === null))) {
      documents.giveTaskIds?.(who.projectId);
    }
    const byTask = new Map(stored.issues.map((issue) => [issue.task_id, issue]));
    return c.json<GitIssuePlan>({
      repository: stored.repository?.repository ?? null,
      canRequest: stored.row.role !== 'viewer',
      canApprove: canApprove(stored.row),
      hasAccount: await hasAccount(who.userId),
      milestones: roadmap.milestones.map((milestone) => ({
        number: milestone.number,
        title: milestone.title,
        tasks: milestone.tasks.map((task): GitIssueTask => {
          const issue = task.id === null ? undefined : byTask.get(task.id);
          const created =
            issue?.status === 'done' && issue.result_number !== null && issue.result_url !== null
              ? { number: Number(issue.result_number), url: issue.result_url }
              : null;
          return {
            id: task.id,
            text: task.text,
            state: created ? 'done' : issue ? 'requested' : 'free',
            issue: created,
          };
        }),
      })),
    });
  });

  /**
   * Makes a request for issues of the chosen tasks. The tasks must be ones of the plan as it
   * stands; their text there is what the issues say. The database checks who asks and that no
   * task gets a second issue.
   */
  routes.post('/issues', async (c) => {
    const who = asked(c);
    if ('error' in who) return who.error;
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = gitIssuesInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'invalid_input');

    const stored = await withUser(db, who.userId, async (trx) => {
      const row = await member(trx, who.projectId, who.userId);
      if (!row) return undefined;
      const project = await trx
        .selectFrom('projects')
        .select(['name', 'language'])
        .where('id', '=', who.projectId)
        .executeTakeFirstOrThrow();
      return {
        row,
        project,
        repository: await connection(trx, who.projectId),
        assignees: await loadAssignees(trx, who.projectId),
      };
    });
    if (!stored) return apiError(c, 'not_found');
    if (stored.row.role === 'viewer') return apiError(c, 'forbidden');
    if (!stored.repository) return apiError(c, 'not_found');

    const taskIds = new Set(input.data.taskIds);
    const actions = buildIssueActions({
      projectName: stored.project.name,
      language: stored.project.language === 'en' ? 'en' : 'de',
      roadmap: withAssignees(
        readRoadmap(await documents.readPlanSections(who.projectId)),
        stored.assignees,
      ),
      taskIds,
      repository: stored.repository.repository,
    });
    // Every chosen task must be one of the plan.
    if (actions.filter((action) => action.kind === 'issue').length !== taskIds.size) {
      return apiError(c, 'invalid_input');
    }

    const outcome = await decide(c, who.userId, async (trx) => {
      const created = await sql<{ id: string }>`
        select public.create_git_request(
          ${who.projectId}, 'issues', ${JSON.stringify(actions)}::jsonb
        ) as id`.execute(trx);
      return created.rows[0]?.id ?? '';
    });
    if ('error' in outcome) return outcome.error;
    return c.json<GitRequestCreated>({ requestId: outcome.value }, 201);
  });

  /**
   * The package of a project next to the default branch of its repository: every file with
   * whether it is new, changed or the same there. It reads with the project's reading access and
   * by Git's marks of the files' content, so no file is fetched.
   */
  async function comparePackage(projectId: string, userId: string, repository: GitConnection) {
    type Compared =
      | { problem: NonNullable<GitMergeRequestPlan['problem']> }
      | {
          problem: null;
          projectName: string;
          language: 'de' | 'en';
          targetBranch: string;
          files: ReturnType<typeof buildCodingPackage>;
          states: { path: string; state: GitFileState }[];
          stale: string[];
        };
    const gathered = await gatherPackage(db, documents, projectId, userId);
    const files = gathered ? buildCodingPackage(gathered.input) : [];
    if (!gathered || files.length === 0) return { problem: 'no_plan' } satisfies Compared;
    if (files.length > MAX_GIT_FILES || packageBytes(files) > MAX_GIT_FILES_BYTES) {
      return { problem: 'too_large' } satisfies Compared;
    }
    const targetBranch = repository.repository.defaultBranch;
    if (!targetBranch) return { problem: 'no_branch' } satisfies Compared;

    let blobs: Map<string, string> | undefined;
    try {
      const access = await git?.connections.access(projectId);
      if (!git || !access) return { problem: 'unreachable' } satisfies Compared;
      blobs = await listBlobs(
        git.client,
        { baseUrl: access.baseUrl, repositoryId: repository.repository.id },
        access.token,
        targetBranch,
        // Earlier feature specs are looked for even if this package has none.
        foldersOf([...files.map((file) => file.path), `${SPECS_FOLDER}/x`]),
      );
    } catch (error) {
      if (!(error instanceof GitlabError)) throw error;
      return { problem: 'unreachable' } satisfies Compared;
    }
    if (!blobs) return { problem: 'no_branch' } satisfies Compared;

    const own = new Set(files.map((file) => file.path));
    return {
      problem: null,
      projectName: gathered.input.projectName,
      language: gathered.input.language,
      targetBranch,
      files,
      states: fileStates(gitFilesOf(files), blobs),
      stale: [...blobs.keys()]
        .filter((path) => STALE_SPEC_PATTERN.test(path) && !own.has(path))
        .sort(),
    } satisfies Compared;
  }

  /** What the dialog of the package shows of the repository before a request is made. */
  routes.get('/merge-request', async (c) => {
    const who = asked(c);
    if ('error' in who) return who.error;
    const stored = await withUser(db, who.userId, async (trx) => {
      const row = await member(trx, who.projectId, who.userId);
      if (!row) return undefined;
      const repository = await connection(trx, who.projectId);
      const pending = await trx
        .selectFrom('git_requests')
        .select('id')
        .where('project_id', '=', who.projectId)
        .where('kind', '=', 'merge_request')
        .where('status', 'in', ['waiting', 'approved', 'failed'])
        .limit(1)
        .executeTakeFirst();
      const last = repository
        ? await trx
            .selectFrom('git_actions')
            .innerJoin('git_requests', 'git_requests.id', 'git_actions.request_id')
            .select(['git_actions.result_number', 'git_actions.result_url'])
            .where('git_actions.project_id', '=', who.projectId)
            .where('git_actions.kind', '=', 'merge_request')
            .where('git_actions.status', '=', 'done')
            .where('git_requests.base_url', '=', repository.baseUrl)
            .where('git_requests.repository_id', '=', String(repository.repository.id))
            .orderBy('git_actions.updated_at', 'desc')
            .limit(1)
            .executeTakeFirst()
        : undefined;
      return { row, repository, pending: pending !== undefined, last };
    });
    if (!stored) return apiError(c, 'not_found');

    const compared = stored.repository
      ? await comparePackage(who.projectId, who.userId, stored.repository)
      : undefined;
    return c.json<GitMergeRequestPlan>({
      repository: stored.repository?.repository ?? null,
      canRequest: stored.row.role !== 'viewer',
      canApprove: canApprove(stored.row),
      hasAccount: await hasAccount(who.userId),
      files: compared?.problem === null ? compared.states : null,
      problem: compared?.problem ?? null,
      stale: compared?.problem === null ? compared.stale : [],
      pending: stored.pending,
      last:
        stored.last?.result_number != null && stored.last.result_url !== null
          ? { number: Number(stored.last.result_number), url: stored.last.result_url }
          : null,
    });
  });

  /**
   * Makes the request that brings the package into the repository: the commit of its files on a
   * branch of its own, and the merge request for it. The package is the one of this moment; what
   * is approved is what the request holds.
   */
  routes.post('/merge-request', async (c) => {
    const who = asked(c);
    if ('error' in who) return who.error;
    const stored = await withUser(db, who.userId, async (trx) => {
      const row = await member(trx, who.projectId, who.userId);
      if (!row) return undefined;
      return { row, repository: await connection(trx, who.projectId) };
    });
    if (!stored) return apiError(c, 'not_found');
    if (stored.row.role === 'viewer') return apiError(c, 'forbidden');
    if (!stored.repository) return apiError(c, 'not_found');

    const compared = await comparePackage(who.projectId, who.userId, stored.repository);
    if (compared.problem === 'too_large') return apiError(c, 'too_large');
    if (compared.problem === 'unreachable') return apiError(c, 'internal');
    if (compared.problem !== null) return apiError(c, 'invalid_input');
    // A package the repository holds already needs no merge request.
    if (compared.states.every(({ state }) => state === 'same' || state === 'kept')) {
      return apiError(c, 'invalid_input');
    }

    const actions = buildMergeRequestActions({
      projectName: compared.projectName,
      language: compared.language,
      files: compared.files,
      branch: mergeRequestBranch(new Date(), randomBytes(3).toString('hex')),
      targetBranch: compared.targetBranch,
      stale: compared.stale,
    });
    const outcome = await decide(c, who.userId, async (trx) => {
      const created = await sql<{ id: string }>`
        select public.create_git_request(
          ${who.projectId}, 'merge_request', ${JSON.stringify(actions)}::jsonb
        ) as id`.execute(trx);
      return created.rows[0]?.id ?? '';
    });
    if ('error' in outcome) return outcome.error;
    return c.json<GitRequestCreated>({ requestId: outcome.value }, 201);
  });

  /** The log of Git actions: every request of the project with its actions, the newest first. */
  routes.get('/log', async (c) => {
    const who = asked(c);
    if ('error' in who) return who.error;
    const requests = await withUser(db, who.userId, async (trx) => {
      if (!(await member(trx, who.projectId, who.userId))) return undefined;
      return await loadRequests(trx, who.projectId, { open: false, limit: GIT_LOG_REQUESTS });
    });
    if (!requests) return apiError(c, 'not_found');
    return c.json<GitLog>({ requests });
  });
}
