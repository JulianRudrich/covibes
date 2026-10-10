import type { DB } from '@covibes/db';
import {
  buildCodingPackage,
  gitReviewAnswerSchema,
  MAX_REVIEW_CHARS,
  MAX_REVIEW_FILE_CHARS,
  MAX_REVIEW_FINDINGS,
  PACKAGE_PATHS,
  packageSpecRefs,
  readRoadmap,
  planSectionsOf,
  type CodingPackageInput,
  type GitReviewAnswer,
  type PlanLanguage,
} from '@covibes/shared';
import type { Task } from 'graphile-worker';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

import { loadPrompt } from '@server/agents/prompts';
import type { AgentReplyResult } from '@server/ai-gateway';
import type {
  RepositoryDiff,
  RepositoryMergeRequest,
  RepositoryReaders,
} from '@server/integrations/gitlab/repository';
import { encodePlanFailure } from '@server/plan/failure';
import { loadIssueTask } from '@server/plan/task-issues';
import { notifyLive } from '@server/realtime/notifications';

/** Name of the job the database queues for the review of a merge request (migration 0036). */
export const MR_REVIEW_TASK = 'mr_review';

/**
 * The model of a review. It runs by itself for every state of a merge request, so it is the model
 * of the other work that runs by itself (the observer, the summaries).
 */
export const REVIEW_MODEL = 'claude-sonnet-5-5';

/** A longer file of the architecture is cut; the decisions come first in what matters. */
const ARCHITECTURE_MAX_CHARS = 16_000;
const SPEC_MAX_CHARS = 8000;
const DESCRIPTION_MAX_CHARS = 4000;

const PROMPT = loadPrompt('review');

const payloadSchema = z.object({ reviewId: z.uuid(), runId: z.uuid() });

export type MrReviewDeps = {
  /** Role covibes_admin: the worker reads the project and writes the review. */
  admin: Kysely<DB>;
  /** Reads the merge request with the project's reading access (spec 28b). */
  repository: RepositoryReaders;
  /** What the package for coding agents is built from right now; undefined if the project is gone. */
  packageInput: (projectId: string) => Promise<CodingPackageInput | undefined>;
  /** The gateway's `completeText`; tests pass a scripted model. */
  complete: (request: {
    model: string;
    system: string;
    prompt: string;
    signal?: AbortSignal;
  }) => Promise<AgentReplyResult>;
  logger: { error: (message: string) => void };
  signal?: AbortSignal;
};

/**
 * `gone`: no run waits (finished, replaced, or deleted with its project). `outdated`: the merge
 * request got new commits before the review ran; the review of the new state takes its place.
 */
export type MrReviewOutcome = 'gone' | 'outdated' | 'failed' | 'done';

/** What comes from people or the repository is data: it must not close the prompt's sections. */
function asData(text: string): string {
  return text.replace(
    /<(\/?)(architecture|decisions|spec|merge_request|description|changes|file)\b([^<>]*)>/gi,
    '‹$1$2$3›',
  );
}

function cut(text: string, max: number, note: string): string {
  return text.length > max ? `${text.slice(0, max)}\n${note}` : text;
}

export type ReviewContext = {
  projectName: string;
  language: PlanLanguage;
  /** `context/architecture.md` and `context/decisions.md` as the package writes them now. */
  architecture: string;
  decisions: string;
  /** The feature spec of the task the merge request belongs to; null if it belongs to none. */
  spec: string | null;
  mergeRequest: Pick<
    RepositoryMergeRequest,
    'number' | 'title' | 'description' | 'sourceBranch' | 'targetBranch' | 'author'
  >;
  diffs: readonly RepositoryDiff[];
  /** The merge request changes more files than were read. */
  moreDiffs: boolean;
};

/**
 * The changes of a merge request for the prompt, within the bounds of a review: each file's diff
 * up to a length, and all of them up to a total. What was cut or left out is said in place.
 */
export function changesForReview(
  diffs: readonly RepositoryDiff[],
  moreDiffs: boolean,
): { text: string; shown: number; left: number } {
  const parts: string[] = [];
  let used = 0;
  let shown = 0;
  for (const diff of diffs) {
    if (used >= MAX_REVIEW_CHARS) break;
    const room = Math.min(MAX_REVIEW_FILE_CHARS, MAX_REVIEW_CHARS - used);
    const body = diff.diff.trim()
      ? cut(diff.diff, room, '(The rest of this file is not shown.)')
      : '(No text to show: a binary file, or one that is too large.)';
    used += Math.min(diff.diff.length, room);
    shown += 1;
    const from = diff.previousPath ? ` previous="${asData(diff.previousPath)}"` : '';
    parts.push(
      `<file path="${asData(diff.path)}" change="${diff.change}"${from}>\n${asData(body)}\n</file>`,
    );
  }
  const left = diffs.length - shown;
  if (left > 0 || moreDiffs) {
    parts.push(
      `(${left > 0 ? `${String(left)} more changed files` : 'More changed files'} are not shown.)`,
    );
  }
  return { text: parts.join('\n\n'), shown, left };
}

/** The context of a review as one text; the instructions come as the system prompt. */
export function buildReviewPrompt(context: ReviewContext): string {
  const { mergeRequest } = context;
  const changes = changesForReview(context.diffs, context.moreDiffs);
  return [
    `Project: ${asData(context.projectName)}`,
    `Write in: ${context.language === 'en' ? 'English' : 'German'}`,
    `<architecture>\n${asData(
      cut(
        context.architecture.trim() || 'The team has drawn no architecture yet.',
        ARCHITECTURE_MAX_CHARS,
        '(The rest of the architecture is not shown.)',
      ),
    )}\n</architecture>`,
    `<decisions>\n${asData(
      cut(
        context.decisions.trim() || 'The team has decided nothing yet.',
        ARCHITECTURE_MAX_CHARS,
        '(The rest of the decisions is not shown.)',
      ),
    )}\n</decisions>`,
    context.spec === null
      ? 'The merge request belongs to no task of the plan; there is no feature spec for it.'
      : `<spec>\n${asData(
          cut(context.spec.trim(), SPEC_MAX_CHARS, '(The rest of the spec is not shown.)'),
        )}\n</spec>`,
    `<merge_request number="${String(mergeRequest.number)}">\nTitle: ${asData(
      mergeRequest.title,
    )}\nAuthor: ${asData(mergeRequest.author)}\nBranches: ${asData(
      mergeRequest.sourceBranch,
    )} into ${asData(mergeRequest.targetBranch)}\n<description>\n${asData(
      cut(
        mergeRequest.description.trim() || '(none)',
        DESCRIPTION_MAX_CHARS,
        '(The rest of the description is not shown.)',
      ),
    )}\n</description>\n</merge_request>`,
    `<changes>\n${changes.text || '(The merge request changes no files.)'}\n</changes>`,
  ].join('\n\n');
}

/**
 * The review in the model's answer: the one JSON object it holds, checked. Undefined if the
 * answer holds none of that form. A code fence or a sentence around the object is passed over.
 */
export function parseReviewAnswer(answer: string): GitReviewAnswer | undefined {
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(answer.slice(start, end + 1));
  } catch {
    return undefined;
  }
  const parsed = gitReviewAnswerSchema.safeParse(value);
  if (!parsed.success) return undefined;
  return { ...parsed.data, findings: parsed.data.findings.slice(0, MAX_REVIEW_FINDINGS) };
}

/** The file of the package at a path; empty if the package has none there. */
const fileOf = (files: readonly { path: string; content: string }[], path: string) =>
  files.find((file) => file.path === path)?.content ?? '';

/**
 * One review of a merge request against the architecture (spec 30b). It reads the merge request
 * and its changes with the project's reading access, and the architecture as Covibes holds it
 * now; the model says whether the change fits and what goes against it. The result is stored with
 * the review. Nothing in the repository changes, and the model has no tools: whatever the merge
 * request says can change nothing but this review's text. The run is metered, also when it fails.
 */
export async function reviewMergeRequest(
  deps: MrReviewDeps,
  payload: unknown,
): Promise<MrReviewOutcome> {
  const { reviewId, runId } = payloadSchema.parse(payload);
  const { admin } = deps;

  const run = await admin
    .updateTable('ai_runs')
    .set({ status: 'running', started_at: sql`clock_timestamp()` })
    .where('id', '=', runId)
    .where('kind', '=', 'review')
    .where('status', '=', 'queued')
    .returning('project_id')
    .executeTakeFirst();
  if (!run) return 'gone';
  const projectId = run.project_id;

  async function fail(error: unknown): Promise<'failed'> {
    await admin
      .updateTable('ai_runs')
      .set({
        status: 'error',
        error: encodePlanFailure(error),
        finished_at: sql`clock_timestamp()`,
      })
      .where('id', '=', runId)
      .execute();
    await notifyLive(admin, { kind: 'git', projectId });
    deps.logger.error(
      `The review ${reviewId} of project ${projectId} could not be written: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return 'failed';
  }

  try {
    // Only the review this run was started for; one that was started again has another run.
    const review = await admin
      .selectFrom('git_reviews')
      .select(['number', 'sha', 'issue_number'])
      .where('id', '=', reviewId)
      .where('run_id', '=', runId)
      .executeTakeFirst();
    if (!review) return await fail(new Error('The review is gone'));

    const reader = await deps.repository(projectId);
    const read = await reader?.mergeRequest(Number(review.number));
    if (!read) return await fail(new Error('The merge request could not be read'));
    if (read.mergeRequest.sha !== null && read.mergeRequest.sha !== review.sha) {
      // New commits came in meanwhile: what GitLab shows now is not what this review is for. The
      // next reading of the repository's state starts the review of the new state.
      await admin.transaction().execute(async (trx) => {
        await trx.deleteFrom('git_reviews').where('id', '=', reviewId).execute();
        await trx
          .updateTable('ai_runs')
          .set({
            status: 'error',
            error: 'The merge request got new commits before the review ran',
            finished_at: sql`clock_timestamp()`,
          })
          .where('id', '=', runId)
          .execute();
        await notifyLive(trx, { kind: 'git', projectId });
      });
      return 'outdated';
    }

    const input = await deps.packageInput(projectId);
    if (!input) return await fail(new Error('The project is gone'));
    const files = buildCodingPackage(input);
    let spec: string | null = null;
    if (review.issue_number !== null) {
      const taskId = await loadIssueTask(admin, projectId, Number(review.issue_number));
      const path = packageSpecRefs(readRoadmap(planSectionsOf(input.plan)), input.language).find(
        (ref) => ref.taskId !== null && ref.taskId === taskId,
      )?.path;
      spec = path ? fileOf(files, path) || null : null;
    }

    const result = await deps.complete({
      model: REVIEW_MODEL,
      system: PROMPT,
      prompt: buildReviewPrompt({
        projectName: input.projectName,
        language: input.language,
        architecture: fileOf(files, PACKAGE_PATHS.architecture),
        decisions: fileOf(files, PACKAGE_PATHS.decisions),
        spec,
        mergeRequest: read.mergeRequest,
        diffs: read.diffs,
        moreDiffs: read.moreDiffs,
      }),
      signal: deps.signal,
    });

    const answer = parseReviewAnswer(result.text);
    await admin.transaction().execute(async (trx) => {
      await trx
        .updateTable('ai_runs')
        .set({
          status: answer ? 'done' : 'error',
          error: answer ? null : 'The model wrote no review',
          provider: result.provider,
          model: result.model,
          input_tokens:
            result.usage.inputTokens + result.usage.cacheReadTokens + result.usage.cacheWriteTokens,
          output_tokens: result.usage.outputTokens,
          cost_usd: result.costUsd.toFixed(6),
          finished_at: sql`clock_timestamp()`,
        })
        .where('id', '=', runId)
        .execute();
      if (answer) {
        await trx
          .updateTable('git_reviews')
          .set({
            // A review that found something deviates; the verdict cannot say otherwise.
            verdict: answer.findings.length > 0 ? 'deviates' : 'fits',
            summary: answer.summary,
            findings: JSON.stringify(answer.findings),
            finished_at: sql`clock_timestamp()`,
          })
          .where('id', '=', reviewId)
          .where('run_id', '=', runId)
          .execute();
      }
      await notifyLive(trx, { kind: 'git', projectId });
    });
    if (!answer) {
      deps.logger.error(`The review ${reviewId} of project ${projectId} came back in no form`);
      return 'failed';
    }
    return 'done';
  } catch (error) {
    return await fail(error);
  }
}

/** The Graphile Worker task for `mr_review`. */
export function mrReviewTask(
  deps: Pick<MrReviewDeps, 'admin' | 'repository' | 'packageInput' | 'complete'>,
): Task {
  return async (payload, helpers) => {
    await reviewMergeRequest(
      { ...deps, logger: helpers.logger, signal: helpers.abortSignal },
      payload,
    );
  };
}
