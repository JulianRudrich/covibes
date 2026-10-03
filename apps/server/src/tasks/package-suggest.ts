import type { DB } from '@covibes/db';
import {
  PACKAGE_TEXT_MAX_LENGTH,
  packageTextKindSchema,
  planToMarkdown,
  type PackageTextKind,
  type PlanLanguage,
} from '@covibes/shared';
import type { Task } from 'graphile-worker';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

import { MODERATOR } from '@server/agents/catalog';
import { loadPrompt } from '@server/agents/prompts';
import type { AgentReplyResult } from '@server/ai-gateway';
import { encodePlanFailure } from '@server/plan/failure';
import { readStoredPlan } from '@server/plan/stored-plan';
import { notifyLive } from '@server/realtime/notifications';
import { loadDecisionContext, type DecisionContext } from '@server/tasks/run-decisions';
import { loadTeam } from '@server/tasks/run-team';

/** Name of the job the database queues for "Vorschlag vom Moderator" (migration 0027). */
export const PACKAGE_SUGGEST_TASK = 'package_suggest';

/** A longer plan is cut: the standards need what is built, not every task. */
const PLAN_MAX_CHARS = 12_000;

const PROMPTS: Readonly<Record<PackageTextKind, string>> = {
  code_standards: loadPrompt('package-code-standards'),
  ui_direction: loadPrompt('package-ui-direction'),
};

const payloadSchema = z.object({ runId: z.uuid(), kind: packageTextKindSchema });

export type PackageSuggestDeps = {
  /** Role covibes_admin: the worker reads the project and writes the suggestion. */
  admin: Kysely<DB>;
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

/** `gone`: no run waits (finished, or deleted with its project). */
export type PackageSuggestOutcome = 'gone' | 'failed' | 'done';

/** Text from people is data: it must not close the sections the prompt is built from. */
function asData(text: string): string {
  return text.replace(/<(\/?)(criteria|decisions|plan|current)\b([^<>]*)>/gi, '‹$1$2$3›');
}

export type PackageTextContext = {
  projectName: string;
  language: PlanLanguage;
  decisions: DecisionContext;
  /** The plan as it stands, as Markdown; empty for an empty plan. */
  plan: string;
  /** What the team has in the field already; empty if nothing. */
  current: string;
};

/** The context of a suggestion as one text; the instructions come as the system prompt. */
export function buildPackageTextPrompt(context: PackageTextContext): string {
  const criteria =
    context.decisions.criteria.length > 0
      ? context.decisions.criteria.map((criterion) => `- ${criterion.text}`).join('\n')
      : 'The team has stated no criteria.';
  const decisions = [
    ...context.decisions.decisions.map((decision) =>
      decision.status === 'decided'
        ? `- ${decision.topic}: ${decision.value ?? ''}${
            decision.reasoning ? ` (${decision.reasoning})` : ''
          }`
        : `- ${decision.topic}: open, not decided yet`,
    ),
    ...context.decisions.pending.map(
      (operation) => `- ${operation.topic}: ${operation.value} (not confirmed yet)`,
    ),
    ...context.decisions.votes.map((vote) => `- ${vote.topic}: a vote is open`),
    ...context.decisions.openVariants.map((open) => `- ${open.topic}: variants wait for the team`),
  ];
  const plan =
    context.plan.length > PLAN_MAX_CHARS
      ? `${context.plan.slice(0, PLAN_MAX_CHARS)}\n(The rest of the plan is not shown.)`
      : context.plan;
  return [
    `Project: ${asData(context.projectName)}`,
    `Write in: ${context.language === 'en' ? 'English' : 'German'}`,
    `<criteria>\n${asData(criteria)}\n</criteria>`,
    `<decisions>\n${
      decisions.length > 0 ? asData(decisions.join('\n')) : 'Nothing is decided yet.'
    }\n</decisions>`,
    `<plan>\n${plan ? asData(plan) : 'The plan is empty.'}\n</plan>`,
    `<current>\n${
      context.current.trim()
        ? `What the team wrote already; keep what it says and complete it:\n${asData(context.current.trim())}`
        : 'The team wrote nothing yet.'
    }\n</current>`,
  ].join('\n\n');
}

/**
 * The model's answer as the text of a suggestion: without a code fence around the whole of it and
 * without a title of its own (the file has one), within the limit of the field.
 */
export function cleanPackageText(answer: string): string {
  let text = answer.replace(/\r\n?/g, '\n').trim();
  const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(text);
  if (fenced?.[1] !== undefined) text = fenced[1].trim();
  // A title for the whole text: a first line that is a heading of the first level.
  text = text.replace(/^# [^\n]*\n+/, '').trim();
  if (text.length <= PACKAGE_TEXT_MAX_LENGTH) return text;
  const cut = text.slice(0, PACKAGE_TEXT_MAX_LENGTH);
  const end = cut.lastIndexOf('\n');
  return (end > PACKAGE_TEXT_MAX_LENGTH / 2 ? cut.slice(0, end) : cut).trim();
}

/**
 * One suggestion for a text of the package (spec 27c). The moderator's model writes the code
 * standards or the UI direction from the criteria, the decisions, the plan and what the team has
 * in the field. The text is stored with the suggestion that waits for it; nothing is written into
 * the team's text itself. The run is metered, also when it fails.
 */
export async function suggestPackageText(
  deps: PackageSuggestDeps,
  payload: unknown,
): Promise<PackageSuggestOutcome> {
  const { runId, kind } = payloadSchema.parse(payload);
  const { admin } = deps;

  const run = await admin
    .updateTable('ai_runs')
    .set({ status: 'running', started_at: sql`clock_timestamp()` })
    .where('id', '=', runId)
    .where('kind', '=', 'package')
    .where('status', '=', 'queued')
    .returning('project_id')
    .executeTakeFirst();
  if (!run) return 'gone';
  const projectId = run.project_id;

  try {
    const [project, team, decisions, plan, current] = await Promise.all([
      admin
        .selectFrom('projects')
        .select(['name', 'language'])
        .where('id', '=', projectId)
        .executeTakeFirstOrThrow(),
      loadTeam(admin, projectId),
      loadDecisionContext(admin, projectId),
      readStoredPlan(admin, projectId, planToMarkdown),
      admin
        .selectFrom('package_texts')
        .select('content')
        .where('project_id', '=', projectId)
        .where('kind', '=', kind)
        .executeTakeFirst(),
    ]);
    // The owner's choice for the moderator in this project, or the catalog default.
    const model = team.members.find((member) => member.key === MODERATOR.key)?.model;

    const result = await deps.complete({
      model: model ?? MODERATOR.model,
      system: PROMPTS[kind],
      prompt: buildPackageTextPrompt({
        projectName: project.name,
        language: project.language === 'en' ? 'en' : 'de',
        decisions,
        plan,
        current: current?.content ?? '',
      }),
      signal: deps.signal,
    });

    const text = cleanPackageText(result.text);
    const failed = text === '';
    await admin.transaction().execute(async (trx) => {
      await trx
        .updateTable('ai_runs')
        .set({
          status: failed ? 'error' : 'done',
          error: failed ? 'The model wrote no text' : null,
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
      if (!failed) {
        // Only the suggestion this run was asked for: one that was dismissed meanwhile, or
        // replaced by a later request, gets nothing.
        await trx
          .updateTable('package_suggestions')
          .set({ content: text })
          .where('project_id', '=', projectId)
          .where('kind', '=', kind)
          .where('run_id', '=', runId)
          .execute();
      }
      await notifyLive(trx, { kind: 'package', projectId });
    });
    if (failed) {
      deps.logger.error(`The suggestion for ${kind} of project ${projectId} came back empty`);
      return 'failed';
    }
    return 'done';
  } catch (error) {
    await admin
      .updateTable('ai_runs')
      .set({
        status: 'error',
        error: encodePlanFailure(error),
        finished_at: sql`clock_timestamp()`,
      })
      .where('id', '=', runId)
      .execute();
    await notifyLive(admin, { kind: 'package', projectId });
    deps.logger.error(
      `The suggestion for ${kind} of project ${projectId} could not be written: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return 'failed';
  }
}

/** The Graphile Worker task for `package_suggest`. */
export function packageSuggestTask(deps: Pick<PackageSuggestDeps, 'admin' | 'complete'>): Task {
  return async (payload, helpers) => {
    await suggestPackageText(
      { ...deps, logger: helpers.logger, signal: helpers.abortSignal },
      payload,
    );
  };
}
