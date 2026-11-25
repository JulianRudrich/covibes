import type { DB } from '@covibes/db';
import {
  HAND_REASON_MAX_LENGTH,
  MAX_OPEN_HANDS,
  OFFER_KINDS,
  projectSettingsSchema,
  toPhase,
  type DecisionProcess,
  type ChatMessage,
  type Phase,
} from '@covibes/shared';
import type { Task } from 'graphile-worker';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

import {
  describeName,
  findAgent,
  teamDefinitions,
  type AgentDefinition,
} from '@server/agents/catalog';
import { loadCustomAgentNames } from '@server/agents/custom';
import { describePhase } from '@server/agents/phases';
import { loadPrompt } from '@server/agents/prompts';
import type { AgentReplyResult, CompleteRequest } from '@server/ai-gateway';
import { selectMessages, toMessage } from '@server/chat/rows';
import { notifyLive } from '@server/realtime/notifications';
import { loadDecisionContext, type DecisionContext } from '@server/tasks/run-decisions';
import { loadTeam } from '@server/tasks/run-team';
import { UsageLimitError, type UsageGuard } from '@server/usage/limits';

/** Name of the job the database schedules after every human message (migration 0008). */
export const OBSERVE_TASK = 'observe';

/** Short classifications run on the small model (spec 44). */
export const OBSERVER_MODEL = 'claude-haiku-4-5-20251001';

/** While an agent waits or works, the observer looks again this much later … */
const RETRY_MS = 10_000;
/** … but for at most this long, so a stuck run does not keep it waiting forever. */
const MAX_WAIT_MS = 5 * 60_000;
/** Messages of the conversation the observer sees. */
const CONTEXT_MESSAGES = 30;
/** Human messages needed since the previous offer before the moderator offers help again. */
const MESSAGES_BETWEEN_OFFERS = 3;
/** Earlier offers and raised hands the observer sees, so it does not repeat itself. */
const HISTORY = 8;

const OBSERVER_PROMPT = loadPrompt('observer');

const payloadSchema = z.object({
  projectId: z.uuid(),
  /** When the observer first had to wait for agents. */
  waitingSince: z.iso.datetime().optional(),
});

/** The model's answer; anything that does not fit counts as nothing to do. */
const answerSchema = z.object({
  offer: z
    .object({
      kind: z.enum(OFFER_KINDS),
      message: z.string().trim().min(1).max(600),
      action: z.string().trim().min(1).max(40),
      task: z.string().trim().min(1).max(500),
    })
    .nullable()
    .catch(null),
  hands: z
    .array(
      z.object({
        agent: z.string(),
        reason: z.string().trim().min(1).max(HAND_REASON_MAX_LENGTH),
      }),
    )
    .catch([]),
});
export type ObserverAnswer = z.infer<typeof answerSchema>;

/** The JSON object in the model's text, or nothing to do. */
export function parseAnswer(text: string): ObserverAnswer {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const nothing: ObserverAnswer = { offer: null, hands: [] };
  if (start < 0 || end <= start) return nothing;
  try {
    const parsed = answerSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : nothing;
  } catch {
    return nothing;
  }
}

export type ObserverDeps = {
  /** Role covibes_admin: offers, raised hands and runs are written by the worker only. */
  admin: Kysely<DB>;
  /** The gateway's `completeText`; tests pass a scripted model. */
  complete: (request: CompleteRequest) => Promise<AgentReplyResult>;
  /** Schedules the observer of the project again, e.g. while agents work. */
  reschedule: (payload: z.infer<typeof payloadSchema>, runAt: Date) => Promise<void>;
  /** Checks the limits of the AI before the model call (spec 31a); without it nothing is limited. */
  limits?: UsageGuard;
  logger: { error: (message: string) => void };
  signal?: AbortSignal;
  now?: () => Date;
};

export type ObserverOutcome =
  | 'gone'
  | 'off'
  | 'waiting'
  | 'gave_up'
  | 'nothing_new'
  | 'nothing_possible'
  | 'limit_reached'
  | 'failed'
  | 'looked';

/** Chat text is data: it must not close the sections the prompt is built from. */
function asData(text: string): string {
  return text.replace(/<(\/?)(team|decisions|earlier|chat)>/gi, '‹$1$2›');
}

function authorName(message: ChatMessage, names?: ReadonlyMap<string, string>): string {
  if (message.author.kind === 'human') return message.author.name || 'Someone';
  const { agentKey } = message.author;
  return findAgent(agentKey)?.names.en ?? names?.get(agentKey) ?? 'Agent';
}

type History = {
  offers: { kind: string; status: string; message: string }[];
  hands: { agentKey: string; status: string; reason: string }[];
};

/** The observer's context as one text; its instructions come separately as the system prompt. */
export function buildObserverPrompt(context: {
  projectName: string;
  /** Where the project stands (spec 24): the moderator may offer to move on to the next phase. */
  phase?: Phase;
  /** Catalog agents by key or definition, custom agents (spec 19) by definition. */
  team: readonly (string | AgentDefinition)[];
  /** The names of custom agents by key, for the authors of the chat. */
  agentNames?: ReadonlyMap<string, string>;
  messages: readonly ChatMessage[];
  /** Messages after this moment are new since the observer's last look. */
  lastLook: Date | null;
  history: History;
  /** What is decided, open or waiting for confirmation (spec 16a), so it is not offered again. */
  decisions?: DecisionContext;
  /** How the project decides (spec 16b): where it votes, a consensus is offered a vote. */
  process?: DecisionProcess;
  /** Why no offer is possible now, or null when it is. */
  offerBlocked: string | null;
  /** Specialists that may raise a hand now, and how many hands are allowed. */
  canRaise: { agents: readonly string[]; count: number };
}): string {
  const team = teamDefinitions(context.team)
    .map((agent) => `- ${asData(describeName(agent))}, key ${agent.key}: ${asData(agent.role)}`)
    .join('\n');
  const offers =
    context.history.offers.length > 0
      ? context.history.offers
          .map((offer) => `- ${offer.kind}, ${offer.status}: "${offer.message}"`)
          .join('\n')
      : '- none';
  const hands =
    context.history.hands.length > 0
      ? context.history.hands
          .map((hand) => `- ${hand.agentKey}, ${hand.status}: "${hand.reason}"`)
          .join('\n')
      : '- none';
  const chat = context.messages
    .map((message) => {
      const isNew = !context.lastLook || new Date(message.createdAt) > context.lastLook;
      return `${isNew ? '(new) ' : ''}${authorName(message, context.agentNames)}: ${message.content}`;
    })
    .join('\n');
  const allowed = [
    `- An offer of help: ${context.offerBlocked ? `no (${context.offerBlocked})` : 'yes'}`,
    context.canRaise.count > 0 && context.canRaise.agents.length > 0
      ? `- Raised hands: at most ${String(context.canRaise.count)}, by: ${context.canRaise.agents.join(', ')}`
      : '- Raised hands: none',
  ].join('\n');
  const decisions = context.decisions
    ? [
        ...context.decisions.decisions.map((decision) =>
          decision.status === 'decided'
            ? `- ${decision.topic}: ${decision.value ?? ''} (decided)`
            : `- ${decision.topic}: open`,
        ),
        ...context.decisions.pending.map(
          (operation) => `- ${operation.topic}: ${operation.value} (waits for confirmation)`,
        ),
        ...context.decisions.votes.map((vote) => `- ${vote.topic}: a vote is open`),
        ...context.decisions.openVariants.map(
          (open) => `- ${open.topic}: variants wait for the team`,
        ),
      ]
    : [];
  return [
    `Project: ${asData(context.projectName)}`,
    ...(context.phase ? [`<phase>\n${describePhase(context.phase)}\n</phase>`] : []),
    `<team>\n${team}\n</team>`,
    `<decisions>\n${decisions.length > 0 ? asData(decisions.join('\n')) : '- none'}\n</decisions>`,
    `<earlier>\nOffers of the moderator, newest first:\n${asData(offers)}\nRaised hands, newest first:\n${asData(hands)}\n</earlier>`,
    `<chat>\n${asData(chat)}\n</chat>`,
    `Messages marked (new) came after your last look.\nWhat you may start now:\n${allowed}${
      context.process === 'vote'
        ? '\nThis project decides by vote: on consensus, offer to start a vote instead of recording.'
        : ''
    }`,
  ].join('\n\n');
}

/**
 * One look of the observer (spec 15): after a pause in the chat, it decides whether the moderator
 * offers help or specialists raise their hands. It waits while agents work, only looks at new
 * human messages and only asks the model when the limits leave something to start.
 */
export async function runObserver(deps: ObserverDeps, payload: unknown): Promise<ObserverOutcome> {
  const { projectId, waitingSince } = payloadSchema.parse(payload);
  const now = deps.now ?? (() => new Date());
  const { admin } = deps;

  const project = await admin
    .selectFrom('projects')
    .select(['name', 'settings', 'phase'])
    .where('id', '=', projectId)
    .executeTakeFirst();
  if (!project) return 'gone';
  const settings = projectSettingsSchema.safeParse(project.settings);
  if (settings.success && settings.data.observer === false) return 'off';

  // Agents that wait or work get their answer in first, so the observer sees it.
  const active = await admin
    .selectFrom('ai_runs')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('project_id', '=', projectId)
    .where('kind', '=', 'reply')
    .where('status', 'in', ['queued', 'running'])
    .executeTakeFirstOrThrow();
  if (Number(active.count) > 0) {
    const since = waitingSince ? new Date(waitingSince) : now();
    if (now().getTime() - since.getTime() >= MAX_WAIT_MS) return 'gave_up';
    await deps.reschedule(
      { projectId, waitingSince: since.toISOString() },
      new Date(now().getTime() + RETRY_MS),
    );
    return 'waiting';
  }

  const lastRun = await admin
    .selectFrom('ai_runs')
    .select((eb) => eb.fn.max('created_at').as('last'))
    .where('project_id', '=', projectId)
    .where('kind', '=', 'observe')
    .executeTakeFirst();
  const lastLook = lastRun?.last ? new Date(lastRun.last) : null;
  const rows = await selectMessages(admin)
    .where('messages.project_id', '=', projectId)
    .where('messages.status', '=', 'complete')
    .orderBy('messages.created_at', 'desc')
    .orderBy('messages.id', 'desc')
    .limit(CONTEXT_MESSAGES)
    .execute();
  const messages = rows
    .map(toMessage)
    .filter((message) => message !== undefined)
    .reverse();
  const humans = messages.filter((message) => message.author.kind === 'human');
  const newHumans = humans.filter((message) => !lastLook || new Date(message.createdAt) > lastLook);
  // A single first message gives nothing to observe yet.
  if (newHumans.length === 0 || humans.length < 2) return 'nothing_new';

  const [team, decisions, handRows, offerRows] = await Promise.all([
    loadTeam(admin, projectId),
    loadDecisionContext(admin, projectId),
    admin
      .selectFrom('hand_raises')
      .select(['agent_key', 'reason', 'status'])
      .where('project_id', '=', projectId)
      .orderBy('created_at', 'desc')
      .limit(HISTORY)
      .execute(),
    admin
      .selectFrom('offers')
      .innerJoin('messages', 'messages.id', 'offers.message_id')
      .select(['offers.kind', 'offers.status', 'offers.created_at', 'messages.content'])
      .where('offers.project_id', '=', projectId)
      .orderBy('offers.created_at', 'desc')
      .limit(HISTORY)
      .execute(),
  ]);
  const openHands = await admin
    .selectFrom('hand_raises')
    .select('agent_key')
    .where('project_id', '=', projectId)
    .where('status', '=', 'open')
    .execute();

  const lastOffer = offerRows[0];
  const humansSinceOffer = lastOffer
    ? humans.filter((message) => new Date(message.createdAt) > lastOffer.created_at).length
    : Infinity;
  const offerBlocked =
    lastOffer?.status === 'open'
      ? 'an offer is still open'
      : humansSinceOffer < MESSAGES_BETWEEN_OFFERS
        ? 'the last offer was only a moment ago'
        : null;
  const raised = new Set(openHands.map((hand) => hand.agent_key));
  const canRaise = {
    agents: team.members
      .map((member) => member.key)
      .filter((key) => key !== 'moderator' && !raised.has(key)),
    count: Math.max(0, MAX_OPEN_HANDS - openHands.length),
  };
  if (offerBlocked && (canRaise.count === 0 || canRaise.agents.length === 0)) {
    return 'nothing_possible';
  }

  // The database's clock, which also dates the messages the next look compares with.
  const clock = await sql<{ now: Date }>`select clock_timestamp() as now`.execute(admin);
  const startedAt = clock.rows[0]?.now ?? now();
  // At a limit of the AI the observer does not look, and writes nothing (spec 31a). It runs by
  // itself, so only the project's limit counts.
  try {
    await deps.limits?.({ projectId, userId: null });
  } catch (error) {
    if (error instanceof UsageLimitError) return 'limit_reached';
    throw error;
  }
  const pendingRun = await admin
    .insertInto('ai_runs')
    .values({
      project_id: projectId,
      agent_key: 'moderator',
      kind: 'observe',
      status: 'running',
      model: OBSERVER_MODEL,
      created_at: startedAt,
      started_at: startedAt,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const runId = pendingRun.id;
  let result: AgentReplyResult;
  try {
    result = await deps.complete({
      billing: { runId, purpose: 'observe' },
      model: OBSERVER_MODEL,
      system: OBSERVER_PROMPT,
      prompt: buildObserverPrompt({
        projectName: project.name,
        phase: toPhase(project.phase),
        team: team.members.map((member) => member.definition),
        agentNames: await loadCustomAgentNames(
          admin,
          messages.flatMap((message) =>
            message.author.kind === 'agent' ? [message.author.agentKey] : [],
          ),
        ),
        messages,
        lastLook,
        history: {
          offers: offerRows.map((offer) => ({
            kind: offer.kind,
            status: offer.status,
            message: offer.content,
          })),
          hands: handRows.map((hand) => ({
            agentKey: hand.agent_key,
            status: hand.status,
            reason: hand.reason,
          })),
        },
        decisions,
        process: settings.success ? settings.data.decisionProcess : undefined,
        offerBlocked,
        canRaise,
      }),
      signal: deps.signal,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // The look counts, so the same messages do not start another failing look right away.
    await recordLook(admin, runId, { error: reason.slice(0, 1000) });
    deps.logger.error(`The observer of project ${projectId} failed: ${reason}`);
    return 'failed';
  }
  await recordLook(admin, runId, { result });

  const answer = parseAnswer(result.text);
  if (answer.offer && !offerBlocked) await offerHelp(admin, projectId, answer.offer);
  const hands = answer.hands
    .filter(
      (hand, index) =>
        canRaise.agents.some((key) => key === hand.agent) &&
        answer.hands.findIndex((other) => other.agent === hand.agent) === index,
    )
    .slice(0, canRaise.count);
  if (hands.length > 0) await raiseHands(admin, projectId, hands);
  return 'looked';
}

/** Meters the look as a run of the kind `observe`; it starts when the model was asked. */
async function recordLook(
  admin: Kysely<DB>,
  runId: string,
  outcome: { result: AgentReplyResult } | { error: string },
) {
  const result = 'result' in outcome ? outcome.result : null;
  await admin
    .updateTable('ai_runs')
    .set({
      status: result ? 'done' : 'error',
      provider: result?.provider ?? null,
      model: result?.model ?? OBSERVER_MODEL,
      input_tokens: result
        ? result.usage.inputTokens + result.usage.cacheReadTokens + result.usage.cacheWriteTokens
        : 0,
      output_tokens: result?.usage.outputTokens ?? 0,
      cost_usd: (result?.costUsd ?? 0).toFixed(6),
      error: 'error' in outcome ? outcome.error : null,
      finished_at: sql`clock_timestamp()`,
    })
    .where('id', '=', runId)
    .execute();
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === '23505';
}

/** The moderator's offer: its message and the offer in one step, announced to everyone. */
async function offerHelp(
  admin: Kysely<DB>,
  projectId: string,
  offer: NonNullable<ObserverAnswer['offer']>,
) {
  try {
    await admin.transaction().execute(async (trx) => {
      const message = await trx
        .insertInto('messages')
        .values({
          project_id: projectId,
          author_kind: 'agent',
          author_agent_key: 'moderator',
          content: offer.message,
          status: 'complete',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('offers')
        .values({
          project_id: projectId,
          message_id: message.id,
          kind: offer.kind,
          action: offer.action,
          task: offer.task,
        })
        .execute();
      await notifyLive(trx, { kind: 'message', projectId, messageId: message.id });
    });
  } catch (error) {
    // Another offer opened in the meantime; one at a time is enough.
    if (!isUniqueViolation(error)) throw error;
  }
}

async function raiseHands(
  admin: Kysely<DB>,
  projectId: string,
  hands: readonly { agent: string; reason: string }[],
) {
  let raised = 0;
  for (const hand of hands) {
    try {
      await admin
        .insertInto('hand_raises')
        .values({ project_id: projectId, agent_key: hand.agent, reason: hand.reason })
        .execute();
      raised += 1;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  if (raised > 0) await notifyLive(admin, { kind: 'hands', projectId });
}

/** The Graphile Worker task for `observe`. */
export function observeTask(deps: Pick<ObserverDeps, 'admin' | 'complete' | 'limits'>): Task {
  return async (payload, helpers) => {
    await runObserver(
      {
        ...deps,
        logger: helpers.logger,
        signal: helpers.abortSignal,
        reschedule: async (next, runAt) => {
          const key = `observer:${next.projectId}`;
          await helpers.addJob(OBSERVE_TASK, next, {
            queueName: key,
            jobKey: key,
            runAt,
            maxAttempts: 1,
          });
        },
      },
      payload,
    );
  };
}
