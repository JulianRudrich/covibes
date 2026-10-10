import type { DB } from '@covibes/db';
import {
  PLAN_SECTIONS,
  planNodeSchema,
  planNodesFromMarkdown,
  planNodesToMarkdown,
  planToMarkdown,
  readEdges,
  readNodes,
  readPlanSections,
  samePlanText,
  type PlanLanguage,
  type PlanNode,
  type PlanSection,
} from '@covibes/shared';
import type { Task } from 'graphile-worker';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

import { findAgent, MODERATOR } from '@server/agents/catalog';
import { loadCustomAgentNames } from '@server/agents/custom';
import { loadPrompt } from '@server/agents/prompts';
import type { AgentReplyResult } from '@server/ai-gateway';
import { selectMessages, toMessage } from '@server/chat/rows';
import type { BoardAccess } from '@server/collab/board-client';
import { encodePlanFailure } from '@server/plan/failure';
import { readStoredPlan } from '@server/plan/stored-plan';
import { notifyLive } from '@server/realtime/notifications';
import { describeCanvas } from '@server/tasks/agent-turn';
import { loadDecisionContext, type DecisionContext } from '@server/tasks/run-decisions';
import { loadTeam } from '@server/tasks/run-team';
import type { UsageGuard } from '@server/usage/limits';

/** Name of the job the database queues for "Plan erzeugen" and "Aktualisieren" (migration 0024). */
export const PLAN_GENERATE_TASK = 'plan_generate';

/** The latest messages of the conversation the moderator reads for the plan. */
const CONTEXT_MESSAGES = 40;
/** A longer message is cut: the plan needs what was said, not every word. */
const MESSAGE_MAX_CHARS = 500;
/** Changes an update is told about; older ones are counted. */
const MAX_CHANGES = 30;

const PLAN_PROMPT = loadPrompt('plan');
const PLAN_UPDATE_PROMPT = loadPrompt('plan-update');

const payloadSchema = z.object({
  runId: z.uuid(),
  /** Jobs queued before updates existed have no kind and generate. */
  kind: z.enum(['generate', 'update']).default('generate'),
});

const storedContentSchema = z.array(planNodeSchema);

export type PlanGenerateDeps = {
  /** Role covibes_admin: the worker reads the project and writes the suggestions. */
  admin: Kysely<DB>;
  /** The boards whose diagrams the plan builds on. */
  boards: BoardAccess;
  /** The gateway's `completeText`; tests pass a scripted model. */
  complete: (request: {
    model: string;
    system: string;
    prompt: string;
    signal?: AbortSignal;
  }) => Promise<AgentReplyResult>;
  /** Checks the limits of the AI before the model call (spec 31a); without it nothing is limited. */
  limits?: UsageGuard;
  logger: { error: (message: string) => void };
  signal?: AbortSignal;
};

/**
 * `gone`: no run waits (finished, or deleted with its project); `current`: an update found
 * nothing in the plan to change.
 */
export type PlanGenerateOutcome = 'gone' | 'failed' | 'done' | 'current';

/** Text from people is data: it must not close the sections the prompt is built from. */
function asData(text: string): string {
  return text.replace(
    /<(\/?)(criteria|decisions|changes|manual|canvas|chat|plan|section)\b([^<>]*)>/gi,
    '‹$1$2$3›',
  );
}

function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** What an update brings the plan up to date with (spec 25c). */
export type PlanUpdateContext = {
  /** What the decision log recorded since the plan was last written, oldest first. */
  changes: readonly string[];
  /** Changes of the period that are older than the ones given. */
  earlierChanges: number;
  /** The sections people changed by hand since the moderator last wrote them. */
  handEdited: readonly PlanSection[];
};

export type PlanContext = {
  projectName: string;
  language: PlanLanguage;
  decisions: DecisionContext;
  /** The boards with something on them, the main canvas first. */
  boards: readonly { title: string; canvas: string }[];
  /** The latest messages, oldest first. */
  messages: readonly { author: string; content: string }[];
  /** The plan as it stands, as Markdown; empty for an empty plan. */
  plan: string;
  /** For an update only. */
  update?: PlanUpdateContext;
};

/** The context of a generation or update as one text; the instructions come as the system prompt. */
export function buildPlanPrompt(context: PlanContext): string {
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
  const chat =
    context.messages.length > 0
      ? context.messages
          .map((message) => `${message.author}: ${oneLine(message.content, MESSAGE_MAX_CHARS)}`)
          .join('\n')
      : 'Nobody has written yet.';
  const { update } = context;
  return [
    `Project: ${asData(context.projectName)}`,
    `Write in: ${context.language === 'en' ? 'English' : 'German'}`,
    ...(update
      ? [
          `<changes>\nWhat changed since the plan was last written, oldest first:\n${
            update.earlierChanges > 0
              ? `(${String(update.earlierChanges)} earlier changes are not listed; the decisions below show how they stand.)\n`
              : ''
          }${asData(update.changes.join('\n'))}\n</changes>`,
          `<manual>\n${
            update.handEdited.length > 0
              ? `People changed these sections by hand since you last wrote them: ${update.handEdited.join(', ')}.`
              : 'No section was changed by hand since you last wrote it.'
          }\n</manual>`,
        ]
      : []),
    `<criteria>\n${asData(criteria)}\n</criteria>`,
    `<decisions>\n${
      decisions.length > 0 ? asData(decisions.join('\n')) : 'Nothing is decided yet.'
    }\n</decisions>`,
    `<canvas>\n${asData(canvas)}\n</canvas>`,
    `<chat>\nThe latest messages of the conversation, oldest first:\n${asData(chat)}\n</chat>`,
    `<plan>\n${
      context.plan ? `The plan as it stands:\n${asData(context.plan)}` : 'The plan is empty so far.'
    }\n</plan>`,
  ].join('\n\n');
}

const SECTION_BLOCK = /<section\s+key\s*=\s*["']?(\w+)["']?\s*>([\s\S]*?)<\/section\s*>/gi;

function isSection(value: string): value is PlanSection {
  return (PLAN_SECTIONS as readonly string[]).includes(value);
}

/**
 * The sections in the model's answer, in the order of the plan. A section the answer names twice
 * counts once, an unknown or empty one not at all.
 */
export function parsePlanAnswer(answer: string): { section: PlanSection; content: PlanNode[] }[] {
  const found = new Map<PlanSection, PlanNode[]>();
  for (const [, key = '', text = ''] of answer.matchAll(SECTION_BLOCK)) {
    const section = key.toLowerCase();
    if (!isSection(section) || found.has(section)) continue;
    const content = planNodesFromMarkdown(text);
    if (content.length > 0) found.set(section, content);
  }
  return PLAN_SECTIONS.flatMap((section) => {
    const content = found.get(section);
    return content ? [{ section, content }] : [];
  });
}

/** A change of the decision log as a line for the update. */
function describeChange(entry: {
  kind: string;
  topic: string | null;
  value: string | null;
  details: unknown;
}): string {
  const details = (entry.details ?? {}) as { reason?: unknown; previous?: unknown };
  const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined);
  switch (entry.kind) {
    case 'decided':
      return `- decided: ${entry.topic ?? ''}: ${entry.value ?? ''}`;
    case 'reopened': {
      const reason = text(details.reason);
      return `- reopened: ${entry.topic ?? ''} (it was: ${entry.value ?? '?'})${
        reason ? `, reason: ${reason}` : ''
      }`;
    }
    case 'criterion_added':
      return `- criterion added: ${entry.value ?? ''}`;
    case 'criterion_removed':
      return `- criterion removed: ${entry.value ?? ''}`;
    case 'criterion_changed':
      return `- criterion changed: ${text(details.previous) ?? '?'} → ${entry.value ?? ''}`;
    default:
      return `- ${entry.kind}: ${entry.topic ?? entry.value ?? ''}`;
  }
}

/**
 * One generation or update of the plan (specs 25b and 25c). The moderator's model writes sections
 * from the criteria, the decisions, the boards, the conversation and the plan as it stands: all
 * five for a generation, only those a change affects for an update. The result is stored as one
 * open suggestion per section, in place of an open one for the same section; nothing is written
 * into the plan itself. The run is metered, also when it fails.
 */
export async function generatePlan(
  deps: PlanGenerateDeps,
  payload: unknown,
): Promise<PlanGenerateOutcome> {
  const { runId, kind: wanted } = payloadSchema.parse(payload);
  const { admin } = deps;

  const run = await admin
    .updateTable('ai_runs')
    .set({ status: 'running', started_at: sql`clock_timestamp()` })
    .where('id', '=', runId)
    .where('kind', '=', 'plan')
    .where('status', '=', 'queued')
    .returning(['project_id', 'created_at', 'user_id'])
    .executeTakeFirst();
  if (!run) return 'gone';
  const projectId = run.project_id;

  try {
    const [project, team, decisions, boardRows, messageRows, plan, written, accepted] =
      await Promise.all([
        admin
          .selectFrom('projects')
          .select(['name', 'language'])
          .where('id', '=', projectId)
          .executeTakeFirstOrThrow(),
        loadTeam(admin, projectId),
        loadDecisionContext(admin, projectId),
        admin
          .selectFrom('boards')
          .select(['id', 'title', 'kind'])
          .where('project_id', '=', projectId)
          .orderBy('kind', 'desc') // 'main' before 'extra'
          .orderBy('position')
          .orderBy('created_at')
          .execute(),
        selectMessages(admin)
          .where('messages.project_id', '=', projectId)
          .where('messages.status', '=', 'complete')
          .orderBy('messages.created_at', 'desc')
          .orderBy('messages.id', 'desc')
          .limit(CONTEXT_MESSAGES)
          .execute(),
        readStoredPlan(admin, projectId, (doc) => ({
          markdown: planToMarkdown(doc),
          sections: readPlanSections(doc),
        })),
        // The run the plan was last written or updated by.
        admin
          .selectFrom('ai_runs')
          .select('created_at')
          .where('project_id', '=', projectId)
          .where('kind', '=', 'plan')
          .where('status', '=', 'done')
          .orderBy('created_at', 'desc')
          .limit(1)
          .executeTakeFirst(),
        // What the moderator last wrote into each section, newest first.
        admin
          .selectFrom('plan_suggestions')
          .select(['section', 'content'])
          .where('project_id', '=', projectId)
          .where('status', '=', 'accepted')
          .orderBy('decided_at', 'desc')
          .execute(),
      ]);

    // A section is changed by hand when it says something else than what the moderator last
    // wrote into it; a section the moderator never wrote is the team's own if it holds text.
    const handEdited = PLAN_SECTIONS.filter((section) => {
      const current = plan.sections[section] ?? [];
      const last = accepted.find((row) => row.section === section);
      if (!last) return planNodesToMarkdown(current) !== '';
      const content = storedContentSchema.safeParse(last.content);
      return !content.success || !samePlanText(current, content.data);
    });

    // Without a plan to update, an update is a generation.
    const kind = wanted === 'update' && written && plan.markdown !== '' ? 'update' : 'generate';
    const log =
      kind === 'update' && written
        ? await admin
            .selectFrom('decision_log')
            .select(['kind', 'topic', 'value', 'details'])
            .where('project_id', '=', projectId)
            .where('created_at', '>', written.created_at)
            .where('created_at', '<=', run.created_at)
            .orderBy('created_at')
            .orderBy('id')
            .execute()
        : [];

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
    const messages = messageRows
      .map(toMessage)
      .filter((message) => message !== undefined)
      .reverse();
    const agentNames = await loadCustomAgentNames(
      admin,
      messages.flatMap((message) =>
        message.author.kind === 'agent' ? [message.author.agentKey] : [],
      ),
    );
    const language: PlanLanguage = project.language === 'en' ? 'en' : 'de';
    // The owner's choice for the moderator in this project, or the catalog default.
    const model = team.members.find((member) => member.key === MODERATOR.key)?.model;

    await deps.limits?.({ projectId, userId: run.user_id });
    const result = await deps.complete({
      model: model ?? MODERATOR.model,
      system: kind === 'update' ? PLAN_UPDATE_PROMPT : PLAN_PROMPT,
      prompt: buildPlanPrompt({
        projectName: project.name,
        language,
        decisions,
        boards,
        messages: messages.map((message) => ({
          author:
            message.author.kind === 'human'
              ? message.author.name || 'Someone'
              : (findAgent(message.author.agentKey)?.names[language] ??
                agentNames.get(message.author.agentKey) ??
                'Agent'),
          content: message.content,
        })),
        plan: plan.markdown,
        ...(kind === 'update'
          ? {
              update: {
                changes: log.slice(-MAX_CHANGES).map(describeChange),
                earlierChanges: Math.max(0, log.length - MAX_CHANGES),
                handEdited,
              },
            }
          : {}),
      }),
      signal: deps.signal,
    });

    // An update only suggests what really changes a section.
    const sections = parsePlanAnswer(result.text).filter(
      ({ section, content }) =>
        kind === 'generate' || !samePlanText(plan.sections[section] ?? [], content),
    );
    // A generation without a section is no plan; an update without one found the plan current.
    const failed = kind === 'generate' && sections.length === 0;
    await admin.transaction().execute(async (trx) => {
      await trx
        .updateTable('ai_runs')
        .set({
          status: failed ? 'error' : 'done',
          error: failed ? 'The model wrote no section of the plan' : null,
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
      if (sections.length > 0) {
        // A new suggestion takes the place of what was open: all of it after a generation, the
        // same sections after an update.
        await trx
          .updateTable('plan_suggestions')
          .set({ status: 'replaced', decided_at: sql`now()` })
          .where('project_id', '=', projectId)
          .where('status', '=', 'open')
          .$if(kind === 'update', (query) =>
            query.where(
              'section',
              'in',
              sections.map(({ section }) => section),
            ),
          )
          .execute();
        await trx
          .insertInto('plan_suggestions')
          .values(
            sections.map(({ section, content }) => ({
              project_id: projectId,
              run_id: runId,
              section,
              content: JSON.stringify(content),
              kind,
              hand_edited: handEdited.includes(section),
            })),
          )
          .execute();
      }
      await notifyLive(trx, { kind: 'plan', projectId });
    });
    if (failed) {
      deps.logger.error(`The plan of project ${projectId} came back without a section`);
      return 'failed';
    }
    return sections.length > 0 ? 'done' : 'current';
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
    await notifyLive(admin, { kind: 'plan', projectId });
    deps.logger.error(
      `The plan of project ${projectId} could not be generated: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return 'failed';
  }
}

/** The Graphile Worker task for `plan_generate`. */
export function planGenerateTask(
  deps: Pick<PlanGenerateDeps, 'admin' | 'boards' | 'complete' | 'limits'>,
): Task {
  return async (payload, helpers) => {
    await generatePlan({ ...deps, logger: helpers.logger, signal: helpers.abortSignal }, payload);
  };
}
