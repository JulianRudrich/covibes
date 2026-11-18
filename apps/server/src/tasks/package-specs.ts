import type { DB } from '@covibes/db';
import {
  MAX_MILESTONES,
  MAX_SPECS_PER_RUN,
  PACKAGE_TEXT_KINDS,
  packageTaskKey,
  planToMarkdown,
  readEdges,
  readNodes,
  readPlanSections,
  readRoadmap,
  type PackageTexts,
  type PlanLanguage,
} from '@covibes/shared';
import type { Task } from 'graphile-worker';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

import { MODERATOR } from '@server/agents/catalog';
import { loadPrompt } from '@server/agents/prompts';
import type { AgentReplyResult, CompleteRequest } from '@server/ai-gateway';
import type { BoardAccess } from '@server/collab/board-client';
import { encodePlanFailure } from '@server/plan/failure';
import { readStoredPlan } from '@server/plan/stored-plan';
import { notifyLive } from '@server/realtime/notifications';
import { describeCanvas } from '@server/tasks/agent-turn';
import { cleanPackageText } from '@server/tasks/package-suggest';
import { loadDecisionContext, type DecisionContext } from '@server/tasks/run-decisions';
import { loadTeam } from '@server/tasks/run-team';
import type { UsageGuard } from '@server/usage/limits';

/** Name of the job the database queues for "Ausarbeiten" (migration 0028). */
export const PACKAGE_SPECS_TASK = 'package_specs';

/** A longer plan is cut: the specs need what is built, not every word. */
const PLAN_MAX_CHARS = 16_000;
/** Same limit as the check constraint on `package_specs.task_text`. */
const TASK_TEXT_MAX_LENGTH = 2000;

const SPECS_PROMPT = loadPrompt('package-specs');

const payloadSchema = z.object({
  runId: z.uuid(),
  milestone: z.number().int().min(1).max(MAX_MILESTONES),
});

export type PackageSpecsDeps = {
  /** Role covibes_admin: the worker reads the project and writes the specs. */
  admin: Kysely<DB>;
  /** The boards whose diagrams the specs build on. */
  boards: BoardAccess;
  /** The gateway's `completeText`; tests pass a scripted model. */
  complete: (request: CompleteRequest) => Promise<AgentReplyResult>;
  /** Checks the limits of the AI before the model call (spec 31a); without it nothing is limited. */
  limits?: UsageGuard;
  logger: { error: (message: string) => void };
  signal?: AbortSignal;
};

/** `gone`: no run waits (finished, or deleted with its project). */
export type PackageSpecsOutcome = 'gone' | 'failed' | 'done';

/** Text from people is data: it must not close the sections the prompt is built from. */
function asData(text: string): string {
  return text.replace(
    /<(\/?)(criteria|decisions|canvas|plan|standards|ui|milestone|tasks|spec)\b([^<>]*)>/gi,
    '‹$1$2$3›',
  );
}

export type PackageSpecsContext = {
  projectName: string;
  language: PlanLanguage;
  decisions: DecisionContext;
  /** The boards with something on them, the main canvas first. */
  boards: readonly { title: string; canvas: string }[];
  /** The plan as it stands, as Markdown. */
  plan: string;
  /** The team's code standards and UI direction; empty where it gave none. */
  texts: PackageTexts;
  milestone: { number: number; title: string; goal: string; duration: string | null };
  /** All tasks of the milestone in their order; `write` marks the ones to write out. */
  tasks: readonly { text: string; write: boolean }[];
};

/** The context of a run as one text; the instructions come as the system prompt. */
export function buildPackageSpecsPrompt(context: PackageSpecsContext): string {
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
  const canvas =
    context.boards.length > 0
      ? context.boards.map((board) => `Board "${board.title}":\n${board.canvas}`).join('\n\n')
      : 'The boards are empty.';
  const plan =
    context.plan.length > PLAN_MAX_CHARS
      ? `${context.plan.slice(0, PLAN_MAX_CHARS)}\n(The rest of the plan is not shown.)`
      : context.plan;
  const { milestone } = context;
  const name = milestone.title
    ? `Milestone ${String(milestone.number)}: ${milestone.title}`
    : `Milestone ${String(milestone.number)}`;
  const tasks = context.tasks.map(
    (task, index) =>
      `${String(index + 1)}. [${task.write ? 'write' : 'skip'}] ${packageTaskKey(task.text)}`,
  );
  return [
    `Project: ${asData(context.projectName)}`,
    `Write in: ${context.language === 'en' ? 'English' : 'German'}`,
    `<criteria>\n${asData(criteria)}\n</criteria>`,
    `<decisions>\n${
      decisions.length > 0 ? asData(decisions.join('\n')) : 'Nothing is decided yet.'
    }\n</decisions>`,
    `<canvas>\n${asData(canvas)}\n</canvas>`,
    `<plan>\n${plan ? asData(plan) : 'The plan is empty.'}\n</plan>`,
    `<standards>\n${
      context.texts.code_standards.trim()
        ? asData(context.texts.code_standards.trim())
        : 'The team set no code standards.'
    }\n</standards>`,
    `<ui>\n${
      context.texts.ui_direction.trim()
        ? asData(context.texts.ui_direction.trim())
        : 'The team set no UI direction.'
    }\n</ui>`,
    `<milestone>\n${asData(name)}${
      milestone.duration ? ` (${asData(milestone.duration)})` : ''
    }${milestone.goal.trim() ? `\nGoal: ${asData(milestone.goal.trim())}` : ''}\n</milestone>`,
    `<tasks>\nWrite a spec for every task marked [write], with the number it has here. The tasks marked [skip] get none in this run; they show where the lines between the tasks are.\n${asData(
      tasks.join('\n'),
    )}\n</tasks>`,
  ].join('\n\n');
}

/**
 * The specs of the model's answer by the number of their task, from 1 to `count`. A block for a
 * task that does not exist, a second block for the same task and an empty block are left out.
 */
export function parsePackageSpecs(answer: string, count: number): Map<number, string> {
  const specs = new Map<number, string>();
  for (const match of answer.matchAll(/<spec task="(\d{1,3})">([\s\S]*?)<\/spec>/g)) {
    const number = Number(match[1]);
    const content = cleanPackageText(match[2] ?? '');
    if (number >= 1 && number <= count && content && !specs.has(number)) {
      specs.set(number, content);
    }
  }
  return specs;
}

/**
 * One run that writes the specs of a milestone out (spec 27d). The moderator's model writes a
 * spec for every task of the milestone that has none (at most `MAX_SPECS_PER_RUN`), or for all of
 * them when none is missing, from the criteria, the decisions, the boards, the plan and the
 * team's texts. A spec is kept with the text of its task. Specs of tasks the plan no longer holds
 * are removed. The run is metered, also when it fails.
 */
export async function writePackageSpecs(
  deps: PackageSpecsDeps,
  payload: unknown,
): Promise<PackageSpecsOutcome> {
  const { runId, milestone: number } = payloadSchema.parse(payload);
  const { admin } = deps;

  const run = await admin
    .updateTable('ai_runs')
    .set({ status: 'running', started_at: sql`clock_timestamp()` })
    .where('id', '=', runId)
    .where('kind', '=', 'package')
    .where('status', '=', 'queued')
    .returning(['project_id', 'user_id'])
    .executeTakeFirst();
  if (!run) return 'gone';
  const projectId = run.project_id;

  /** Ends the run without a model call: there was nothing to ask for. */
  async function refuse(reason: string): Promise<PackageSpecsOutcome> {
    await admin
      .updateTable('ai_runs')
      .set({ status: 'error', error: reason, finished_at: sql`clock_timestamp()` })
      .where('id', '=', runId)
      .execute();
    await notifyLive(admin, { kind: 'package', projectId });
    deps.logger.error(`The specs of milestone ${String(number)} of ${projectId}: ${reason}`);
    return 'failed';
  }

  try {
    const [project, team, decisions, boardRows, plan, textRows, written] = await Promise.all([
      admin
        .selectFrom('projects')
        .select(['name', 'language'])
        .where('id', '=', projectId)
        .executeTakeFirstOrThrow(),
      loadTeam(admin, projectId),
      loadDecisionContext(admin, projectId),
      admin
        .selectFrom('boards')
        .select(['id', 'title'])
        .where('project_id', '=', projectId)
        .orderBy('kind', 'desc') // 'main' before 'extra'
        .orderBy('position')
        .orderBy('created_at')
        .execute(),
      readStoredPlan(admin, projectId, (doc) => ({
        markdown: planToMarkdown(doc),
        roadmap: readRoadmap(readPlanSections(doc)),
      })),
      admin
        .selectFrom('package_texts')
        .select(['kind', 'content'])
        .where('project_id', '=', projectId)
        .execute(),
      admin
        .selectFrom('package_specs')
        .select('task_text')
        .where('project_id', '=', projectId)
        .execute(),
    ]);

    const milestone = plan.roadmap.milestones[number - 1];
    // A task whose text cannot be kept has no spec to write.
    const tasks = (milestone?.tasks ?? [])
      .map((task) => packageTaskKey(task.text))
      .filter((text) => text !== '' && text.length <= TASK_TEXT_MAX_LENGTH);
    if (!milestone || tasks.length === 0) return await refuse('The milestone has no tasks');

    const has = new Set(written.map((row) => row.task_text));
    const missing = tasks.filter((text) => !has.has(text));
    // Nothing is missing: the team asked for all of them again.
    const targets = new Set((missing.length > 0 ? missing : tasks).slice(0, MAX_SPECS_PER_RUN));

    const boards = (
      await Promise.all(
        boardRows.map(async (board) => {
          const { nodes, edges } = await deps.boards.withBoard(board.id, (doc) => ({
            nodes: readNodes(doc),
            edges: readEdges(doc),
          }));
          return nodes.length > 0
            ? [{ title: board.title, canvas: describeCanvas(nodes, edges, undefined) }]
            : [];
        }),
      )
    ).flat();
    const texts: PackageTexts = { code_standards: '', ui_direction: '' };
    for (const kind of PACKAGE_TEXT_KINDS) {
      texts[kind] = textRows.find((row) => row.kind === kind)?.content ?? '';
    }
    // The owner's choice for the moderator in this project, or the catalog default.
    const model = team.members.find((member) => member.key === MODERATOR.key)?.model;

    await deps.limits?.({ projectId, userId: run.user_id });
    const result = await deps.complete({
      billing: { runId, purpose: 'package-specs' },
      model: model ?? MODERATOR.model,
      system: SPECS_PROMPT,
      prompt: buildPackageSpecsPrompt({
        projectName: project.name,
        language: project.language === 'en' ? 'en' : 'de',
        decisions,
        boards,
        plan: plan.markdown,
        texts,
        milestone: {
          number,
          title: milestone.title,
          goal: milestone.goal,
          duration: milestone.duration?.text ?? null,
        },
        tasks: tasks.map((text) => ({ text, write: targets.has(text) })),
      }),
      signal: deps.signal,
    });

    // Only what was asked for: a spec for a task that has one already is not taken.
    const specs = [...parsePackageSpecs(result.text, tasks.length)].flatMap(([index, content]) => {
      const text = tasks[index - 1];
      return text !== undefined && targets.has(text) ? [{ text, content }] : [];
    });
    const failed = specs.length === 0;
    // Every task of the plan, so that specs of tasks that are gone can go as well.
    const planTasks = plan.roadmap.milestones.flatMap((entry) =>
      entry.tasks.map((task) => packageTaskKey(task.text)),
    );
    await admin.transaction().execute(async (trx) => {
      await trx
        .updateTable('ai_runs')
        .set({
          status: failed ? 'error' : 'done',
          error: failed ? 'The model wrote no spec' : null,
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
      for (const spec of specs) {
        await sql`
          insert into public.package_specs (project_id, task_text, content, run_id)
          values (${projectId}, ${spec.text}, ${spec.content}, ${runId})
          on conflict (project_id, md5(task_text)) do update
            set task_text = excluded.task_text,
                content = excluded.content,
                run_id = excluded.run_id,
                written_at = now()
        `.execute(trx);
      }
      if (!failed) {
        await trx
          .deleteFrom('package_specs')
          .where('project_id', '=', projectId)
          .where('task_text', 'not in', planTasks)
          .execute();
      }
      await notifyLive(trx, { kind: 'package', projectId });
    });
    if (failed) {
      deps.logger.error(
        `The specs of milestone ${String(number)} of project ${projectId} came back empty`,
      );
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
      `The specs of milestone ${String(number)} of project ${projectId} could not be written: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return 'failed';
  }
}

/** The Graphile Worker task for `package_specs`. */
export function packageSpecsTask(
  deps: Pick<PackageSpecsDeps, 'admin' | 'boards' | 'complete' | 'limits'>,
): Task {
  return async (payload, helpers) => {
    await writePackageSpecs(
      { ...deps, logger: helpers.logger, signal: helpers.abortSignal },
      payload,
    );
  };
}
