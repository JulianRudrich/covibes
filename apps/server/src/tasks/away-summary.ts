import type { DB } from '@covibes/db';
import type { Task } from 'graphile-worker';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

import { findAgent } from '@server/agents/catalog';
import { loadCustomAgentNames } from '@server/agents/custom';
import { loadPrompt } from '@server/agents/prompts';
import type { AgentReplyResult } from '@server/ai-gateway';
import { UsageLimitError, type UsageGuard } from '@server/usage/limits';

/** Name of the job the database schedules when a member comes back (migration 0020). */
export const AWAY_SUMMARY_TASK = 'away_summary';

/**
 * The model of the summaries: like the observer (spec 15) it runs often, for every person who
 * comes back, and it sums up instead of judging.
 */
export const SUMMARY_MODEL = 'claude-sonnet-5-5';

/** The latest messages of the absence the moderator reads; earlier ones are only counted. */
export const MAX_MESSAGES = 120;
/** A longer message is cut: the summary needs what it is about, not every word. */
const MESSAGE_MAX_CHARS = 700;
/** The text is asked to stay within 60 words, for a narrow column; a much longer one is cut. */
export const TEXT_MAX_CHARS = 700;

const AWAY_PROMPT = loadPrompt('away-summary');

const payloadSchema = z.object({ projectId: z.uuid(), userId: z.uuid() });

export type AwaySummaryDeps = {
  /** Role covibes_admin: the worker reads the conversation and writes the summary. */
  admin: Kysely<DB>;
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
 * `gone`: no summary waits (closed, replaced or the member left); `nothing`: nothing was said
 * after all; `failed`: the model gave no usable text.
 */
export type AwaySummaryOutcome = 'gone' | 'nothing' | 'failed' | 'done';

/** Chat text is data: it must not close the sections the prompt is built from. */
function asData(text: string): string {
  return text.replace(/<(\/?)(decisions|waiting|chat)>/gi, '‹$1$2›');
}

function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** How long the person was away, in words the model can repeat. */
function duration(from: Date, until: Date): string {
  const hours = Math.max(1, Math.round((until.getTime() - from.getTime()) / (60 * 60_000)));
  if (hours < 36) return hours === 1 ? 'about 1 hour' : `about ${String(hours)} hours`;
  return `about ${String(Math.round(hours / 24))} days`;
}

export type SummaryContext = {
  projectName: string;
  person: string;
  locale: string;
  from: Date;
  until: Date;
  /** The messages of the absence, oldest first. */
  messages: readonly { author: string; content: string; mentionsPerson: boolean }[];
  /** Messages of the absence that are older than the ones given. */
  earlier: number;
  decisions: readonly {
    kind: string;
    topic: string;
    value: string | null;
    reason: string | null;
  }[];
  /** How much waits for the person's say now. */
  waiting: number;
};

/** The context of a summary as one text; the instructions come separately as the system prompt. */
export function buildSummaryPrompt(context: SummaryContext): string {
  const decisions =
    context.decisions.length > 0
      ? context.decisions
          .map((entry) =>
            entry.kind === 'reopened'
              ? `- reopened: ${entry.topic} (was: ${entry.value ?? '?'})${
                  entry.reason ? `, reason: ${entry.reason}` : ''
                }`
              : `- decided: ${entry.topic}: ${entry.value ?? ''}`,
          )
          .join('\n')
      : '- none';
  const chat = context.messages
    .map(
      (message) =>
        `${message.mentionsPerson ? '(mentions the person) ' : ''}${message.author}: ${oneLine(
          message.content,
          MESSAGE_MAX_CHARS,
        )}`,
    )
    .join('\n');
  return [
    `Project: ${asData(context.projectName)}`,
    `The person who was away: ${asData(context.person || 'a member')}`,
    `Away from ${context.from.toISOString()} to ${context.until.toISOString()} (${duration(
      context.from,
      context.until,
    )}).`,
    `Write in: ${context.locale === 'en' ? 'English' : 'German'}`,
    `<decisions>\nRecorded in the decision log while the person was away, oldest first:\n${asData(
      decisions,
    )}\n</decisions>`,
    `<waiting>\n${
      context.waiting > 0
        ? `${String(context.waiting)} open item(s) wait for this person's say (proposals, raised hands, votes). The app lists them.`
        : 'Nothing waits for this person.'
    }\n</waiting>`,
    `<chat>\n${
      context.earlier > 0
        ? `(${String(context.earlier)} earlier messages of the absence are not shown.)\n`
        : ''
    }${asData(chat)}\n</chat>`,
  ].join('\n\n');
}

/** The model's answer as the text the section shows: one paragraph, without quotes around it. */
export function cleanSummary(text: string): string {
  const paragraph = text.replace(/\s+/g, ' ').trim();
  // Quotes around the whole answer go; quotes inside it are part of what was said.
  const quoted = /^["„“»]([^"„“”»«]*)["“”«]$/u.exec(paragraph);
  const line = (quoted?.[1] ?? paragraph).trim();
  return line.length > TEXT_MAX_CHARS ? `${line.slice(0, TEXT_MAX_CHARS - 1)}…` : line;
}

/**
 * The moderator's words for one return (spec 23): reads what was said and decided while the
 * member was away, asks the model for a few sentences and stores them with the absence. It writes
 * only while that summary still waits: one that was closed or replaced meanwhile is left alone.
 */
export async function writeAwaySummary(
  deps: AwaySummaryDeps,
  payload: unknown,
): Promise<AwaySummaryOutcome> {
  const { projectId, userId } = payloadSchema.parse(payload);
  const { admin } = deps;

  const noted = await admin
    .selectFrom('away_summaries')
    .innerJoin('projects', 'projects.id', 'away_summaries.project_id')
    .innerJoin('users', 'users.id', 'away_summaries.user_id')
    .select([
      'away_summaries.away_from',
      'away_summaries.back_at',
      'away_summaries.dismissed_at',
      // With its microseconds, so the summary is stored for exactly this return.
      sql<string>`away_summaries.back_at::text`.as('back_at_exact'),
      'projects.name as project_name',
      'users.name as user_name',
      'users.locale',
    ])
    .where('away_summaries.project_id', '=', projectId)
    .where('away_summaries.user_id', '=', userId)
    .where('away_summaries.text_status', '=', 'pending')
    .executeTakeFirst();
  if (!noted) return 'gone';

  /** Stores the outcome, unless the member came back again or the summary is gone. */
  const store = (values: { text: string | null; text_status: string }) =>
    admin
      .updateTable('away_summaries')
      .set(values)
      .where('project_id', '=', projectId)
      .where('user_id', '=', userId)
      .where('text_status', '=', 'pending')
      .where(sql<boolean>`back_at = ${noted.back_at_exact}::timestamptz`)
      .execute();

  // Closed before the moderator got to it: nobody would read the text.
  if (noted.dismissed_at) {
    await store({ text: null, text_status: 'none' });
    return 'gone';
  }

  const inPeriod = admin
    .selectFrom('messages')
    .where('messages.project_id', '=', projectId)
    .where('messages.status', '=', 'complete')
    .where('messages.created_at', '>', noted.away_from)
    .where('messages.created_at', '<=', noted.back_at)
    .where((eb) =>
      eb.or([
        eb('messages.author_user_id', 'is', null),
        eb('messages.author_user_id', '<>', userId),
      ]),
    );
  const [rows, total, log, waiting] = await Promise.all([
    inPeriod
      .leftJoin('users', 'users.id', 'messages.author_user_id')
      .select([
        'messages.author_kind',
        'messages.author_agent_key',
        'messages.content',
        'messages.mentioned_users',
        'users.name as author_name',
      ])
      .orderBy('messages.created_at', 'desc')
      .orderBy('messages.id', 'desc')
      .limit(MAX_MESSAGES)
      .execute(),
    inPeriod.select((eb) => eb.fn.countAll<string>().as('count')).executeTakeFirstOrThrow(),
    admin
      .selectFrom('decision_log')
      .select(['kind', 'topic', 'value', 'details'])
      .where('project_id', '=', projectId)
      .where('kind', 'in', ['decided', 'reopened'])
      .where('created_at', '>', noted.away_from)
      .where('created_at', '<=', noted.back_at)
      .orderBy('created_at')
      .orderBy('id')
      .execute(),
    sql<{
      project_id: string;
      waiting: number;
    }>`select project_id, waiting from public.waiting_for_user(${userId})`.execute(admin),
  ]);
  if (rows.length === 0) {
    await store({ text: null, text_status: 'none' });
    return 'nothing';
  }

  const agentNames = await loadCustomAgentNames(
    admin,
    rows.flatMap((row) => (row.author_agent_key ? [row.author_agent_key] : [])),
  );
  const locale = noted.locale === 'en' ? 'en' : 'de';
  const prompt = buildSummaryPrompt({
    projectName: noted.project_name,
    person: noted.user_name,
    locale,
    from: noted.away_from,
    until: noted.back_at,
    messages: rows.reverse().map((row) => ({
      author:
        row.author_kind === 'human'
          ? row.author_name || 'Someone'
          : ((row.author_agent_key
              ? (findAgent(row.author_agent_key)?.names[locale] ??
                agentNames.get(row.author_agent_key))
              : undefined) ?? 'Agent'),
      content: row.content,
      mentionsPerson: row.mentioned_users.includes(userId),
    })),
    earlier: Math.max(0, Number(total.count) - rows.length),
    decisions: log.map((entry) => {
      const reason = (entry.details as { reason?: unknown } | null)?.reason;
      return {
        kind: entry.kind,
        topic: entry.topic ?? '',
        value: entry.value,
        reason: typeof reason === 'string' ? reason : null,
      };
    }),
    waiting: waiting.rows.find((row) => row.project_id === projectId)?.waiting ?? 0,
  });

  // The database's clock, like every other run.
  const clock = await sql<{ now: Date }>`select clock_timestamp() as now`.execute(admin);
  const startedAt = clock.rows[0]?.now ?? new Date();
  // At a limit of the AI the summary comes without the moderator's text (spec 31a).
  try {
    await deps.limits?.({ projectId, userId });
  } catch (error) {
    if (!(error instanceof UsageLimitError)) throw error;
    await store({ text: null, text_status: 'failed' });
    return 'failed';
  }
  let result: AgentReplyResult;
  try {
    result = await deps.complete({
      model: SUMMARY_MODEL,
      system: AWAY_PROMPT,
      prompt,
      signal: deps.signal,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await recordRun(admin, projectId, userId, startedAt, { error: reason.slice(0, 1000) });
    await store({ text: null, text_status: 'failed' });
    deps.logger.error(`The summary for a return to project ${projectId} failed: ${reason}`);
    return 'failed';
  }
  await recordRun(admin, projectId, userId, startedAt, { result });

  const text = cleanSummary(result.text);
  if (text === '') {
    await store({ text: null, text_status: 'failed' });
    return 'failed';
  }
  await store({ text, text_status: 'done' });
  return 'done';
}

/** Meters the summary as a run of the kind `summary`, for the person it is written for. */
async function recordRun(
  admin: Kysely<DB>,
  projectId: string,
  userId: string,
  startedAt: Date,
  outcome: { result: AgentReplyResult } | { error: string },
) {
  const result = 'result' in outcome ? outcome.result : null;
  await admin
    .insertInto('ai_runs')
    .values({
      project_id: projectId,
      user_id: userId,
      agent_key: 'moderator',
      kind: 'summary',
      status: result ? 'done' : 'error',
      provider: result?.provider ?? null,
      model: result?.model ?? SUMMARY_MODEL,
      input_tokens: result
        ? result.usage.inputTokens + result.usage.cacheReadTokens + result.usage.cacheWriteTokens
        : 0,
      output_tokens: result?.usage.outputTokens ?? 0,
      cost_usd: (result?.costUsd ?? 0).toFixed(6),
      error: 'error' in outcome ? outcome.error : null,
      created_at: startedAt,
      started_at: startedAt,
      finished_at: sql`clock_timestamp()`,
    })
    .execute();
}

/** The Graphile Worker task for `away_summary`. */
export function awaySummaryTask(
  deps: Pick<AwaySummaryDeps, 'admin' | 'complete' | 'limits'>,
): Task {
  return async (payload, helpers) => {
    await writeAwaySummary(
      { ...deps, logger: helpers.logger, signal: helpers.abortSignal },
      payload,
    );
  };
}
